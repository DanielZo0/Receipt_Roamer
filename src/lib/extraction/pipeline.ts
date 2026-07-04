import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildExtractionPrompt, callGeminiForExtraction, type Extraction } from "./gemini";
import { validateExtractedFields, shouldTriggerLLMRecheck, type ValidationError } from "./validation";
import {
  matchAssociation,
  shouldLLMRecheckAssociation,
  type AssociationRow,
  type AssociationMatchResult,
} from "./association-matching";
import { matchLearnedRule, type AssociationRuleRow } from "./learned-rules";
import { recheckExtraction } from "./llm-recheck";

/**
 * Combines Phase 3 (heuristic keyword/exact-name matching) with learned rules
 * from prior user corrections. A learned-rule hit is treated as certain
 * (confidence 1.0) and takes priority over the heuristic match.
 */
function matchAssociationWithLearnedRules(
  supplier: string | null,
  associations: AssociationRow[],
  learnedRules: AssociationRuleRow[],
): AssociationMatchResult {
  const learned = matchLearnedRule(supplier, learnedRules);
  if (learned.association_id) {
    const assoc = associations.find((a) => a.id === learned.association_id);
    return {
      association_id: learned.association_id,
      association_name: assoc?.name ?? null,
      confidence: 1.0,
      reasons: [`Matched learned rule: "${learned.matched_pattern}"`],
      matched_by: [`learned_rule(${learned.matched_pattern})`],
    };
  }
  return matchAssociation({ supplier }, associations);
}

export interface RunExtractionPipelineParams {
  fileName: string;
  fileMime: string;
  fileBase64: string;
  filePath: string;
  fileSize?: number | null;
}

export interface RunExtractionPipelineResult {
  expense: Database["public"]["Tables"]["expenses"]["Row"];
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}

/**
 * Shared extraction pipeline used by both the manual upload path
 * (src/lib/expenses.functions.ts) and the Mailgun inbound webhook
 * (src/lib/email-inbound.server.ts).
 *
 * Phases:
 *  1. Gemini extraction
 *  2. Deterministic validation
 *  3. Rule-based association matching (independent of the LLM's guess)
 *  4. LLM re-check (only if phase 2 failed or phase 3 confidence is low)
 *  5. Insert expense + write extraction_audit_log
 *
 * Throws on unrecoverable failure (missing API key, Gemini error, DB insert
 * error) — callers are responsible for their own upload_logs bookkeeping.
 */
export async function runExtractionPipeline(
  supabase: SupabaseClient<Database>,
  params: RunExtractionPipelineParams,
): Promise<RunExtractionPipelineResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const [{ data: associationRows }, { data: categoryRows }, { data: ruleRows }] = await Promise.all([
    supabase.from("associations").select("id, name, address, keywords, notes"),
    supabase.from("categories").select("name, keywords").order("name"),
    supabase.from("association_rules").select("id, supplier_pattern, association_id, active").eq("active", true),
  ]);
  const associations: AssociationRow[] = associationRows ?? [];
  const categories = categoryRows ?? [];
  const learnedRules: AssociationRuleRow[] = ruleRows ?? [];

  const file = { mime: params.fileMime, base64: params.fileBase64 };

  // ─── Phase 1: Gemini extraction ─────────────────────────────────────────
  const { systemPrompt, userPrompt } = buildExtractionPrompt(associations, categories);
  let { extracted, inputTokens, outputTokens, estimatedCostUsd } = await callGeminiForExtraction({
    apiKey,
    systemPrompt,
    userPrompt,
    file,
  });

  // ─── Phase 2: Deterministic validation ──────────────────────────────────
  let validation = validateExtractedFields(extracted);

  // ─── Phase 3: Rule-based association matching (+ learned rules) ─────────
  let ruleMatch = matchAssociationWithLearnedRules(extracted.supplier, associations, learnedRules);

  // ─── Phase 4: LLM re-check (only if needed) ─────────────────────────────
  const needsRecheck =
    shouldTriggerLLMRecheck(validation) || shouldLLMRecheckAssociation(ruleMatch.confidence);

  let recheckPerformed = false;
  if (needsRecheck) {
    recheckPerformed = true;
    const recheckResult = await recheckExtraction({
      apiKey,
      file,
      original: extracted,
      errors: validation.errors,
      lowConfidenceAssociation: shouldLLMRecheckAssociation(ruleMatch.confidence),
    });
    extracted = recheckResult.extracted;
    inputTokens = (inputTokens ?? 0) + (recheckResult.inputTokens ?? 0);
    outputTokens = (outputTokens ?? 0) + (recheckResult.outputTokens ?? 0);
    estimatedCostUsd = (estimatedCostUsd ?? 0) + (recheckResult.estimatedCostUsd ?? 0);
    validation = validateExtractedFields(extracted);
    ruleMatch = matchAssociationWithLearnedRules(extracted.supplier, associations, learnedRules);
  }

  // Validate the (possibly re-checked) association_id the LLM returned exists.
  const validIds = new Set(associations.map((a) => a.id));
  const llmAssocId =
    extracted.association_id && validIds.has(extracted.association_id)
      ? extracted.association_id
      : null;
  // Prefer the rule-based match when it's confident; otherwise fall back to the LLM's pick.
  const finalAssociationId = ruleMatch.association_id ?? llmAssocId;

  // Normalise category to one of the known names (case-insensitive)
  const catNames = categories.map((c) => c.name);
  let category = extracted.category;
  if (category && catNames.length) {
    const match = catNames.find((n) => n.toLowerCase() === category!.toLowerCase());
    category = match ?? category;
  }

  const { data: inserted, error } = await supabase
    .from("expenses")
    .insert({
      association_id: finalAssociationId,
      supplier: extracted.supplier,
      expense_date: extracted.expense_date,
      amount: extracted.amount,
      currency: extracted.currency,
      category,
      file_path: params.filePath,
      file_mime: params.fileMime,
      raw_extraction: extracted as never,
    })
    .select()
    .single();

  if (error || !inserted) {
    throw new Error(error?.message ?? "Failed to insert expense");
  }

  await writeAuditLog(supabase, {
    expenseId: inserted.id,
    fileName: params.fileName,
    extracted,
    validation,
    ruleMatch,
    recheckPerformed,
    llmModel: "gemini-2.5-flash",
    inputTokens,
    outputTokens,
    estimatedCostUsd,
  });

  return { expense: inserted, inputTokens, outputTokens, estimatedCostUsd };
}

async function writeAuditLog(
  supabase: SupabaseClient<Database>,
  params: {
    expenseId: string;
    fileName: string;
    extracted: Extraction;
    validation: { valid: boolean; errors: ValidationError[]; warnings: ValidationError[] };
    ruleMatch: { association_id: string | null; confidence: number; matched_by: string[] };
    recheckPerformed: boolean;
    llmModel: string;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostUsd: number | null;
  },
) {
  const { expenseId, fileName, extracted, validation, ruleMatch, recheckPerformed, llmModel, inputTokens, outputTokens, estimatedCostUsd } =
    params;

  const { error } = await supabase.from("extraction_audit_log").insert({
    expense_id: expenseId,
    file_name: fileName,
    extracted_supplier: extracted.supplier,
    extracted_expense_date: extracted.expense_date,
    extracted_amount: extracted.amount,
    extracted_currency: extracted.currency,
    extracted_category: extracted.category,
    extracted_association_id: extracted.association_id,
    phase: recheckPerformed ? "llm_recheck" : "llm_extraction",
    validation_errors: validation.errors.length ? (validation.errors as never) : null,
    validation_warnings: validation.warnings.length ? (validation.warnings as never) : null,
    association_match_confidence: ruleMatch.confidence,
    association_match_signals: ruleMatch.matched_by,
    llm_model: llmModel,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: estimatedCostUsd,
    extraction_reasoning: extracted.reasoning,
    pipeline_trace: { validation, ruleMatch, recheckPerformed } as never,
  } as never);

  if (error) {
    console.error("Failed to write extraction_audit_log", error);
  }
}
