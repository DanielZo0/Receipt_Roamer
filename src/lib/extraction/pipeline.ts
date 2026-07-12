import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildExtractionPrompt, callGeminiForExtraction, type Extraction } from "./gemini";
import { validateExtractedFields, shouldTriggerLLMRecheck, type ValidationError } from "./validation";
import {
  shouldLLMRecheckAssociation,
  matchAssociationWithLearnedRules,
  type AssociationRow,
} from "./association-matching";
import { type AssociationRuleRow } from "./learned-rules";
import { matchLearnedCategoryRule, type CategoryRuleRow } from "./learned-category-rules";
import { recheckExtraction } from "./llm-recheck";
import { findPossibleDuplicate } from "./duplicate-detection";
import { matchLineItem } from "./ledger-line-matching";

export interface RunExtractionPipelineParams {
  fileName: string;
  fileMime: string;
  fileBase64: string;
  filePath: string;
  fileSize?: number | null;
}

export interface RunExtractionPipelineResult {
  /** First inserted row — kept for backward compat with single-receipt callers. */
  expense: Database["public"]["Tables"]["expenses"]["Row"];
  /** All rows inserted for this upload (length 1 for a normal single receipt). */
  expenses: Database["public"]["Tables"]["expenses"]["Row"][];
  ledgerGroupId: string | null;
  /** Difference between the document's stated grand total and the sum of line items (null if not a ledger, or no grand total was found). */
  totalMismatch: { grandTotal: number; sumOfLineItems: number } | null;
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

  const [{ data: associationRows }, { data: categoryRows }, { data: ruleRows }, { data: categoryRuleRows }] =
    await Promise.all([
      supabase.from("associations").select("id, name, address, keywords, notes"),
      supabase.from("categories").select("name, keywords").order("name"),
      supabase.from("association_rules").select("id, supplier_pattern, association_id, active").eq("active", true),
      supabase.from("category_rules").select("id, supplier_pattern, category, active").eq("active", true),
    ]);
  const associations: AssociationRow[] = associationRows ?? [];
  const categories = categoryRows ?? [];
  const learnedRules: AssociationRuleRow[] = ruleRows ?? [];
  const learnedCategoryRules: CategoryRuleRow[] = categoryRuleRows ?? [];

  const file = { mime: params.fileMime, base64: params.fileBase64 };

  // ─── Phase 1: Gemini extraction ─────────────────────────────────────────
  const { systemPrompt, userPrompt } = buildExtractionPrompt(associations, categories);
  let { extracted, inputTokens, outputTokens, estimatedCostUsd } = await callGeminiForExtraction({
    apiKey,
    systemPrompt,
    userPrompt,
    file,
  });

  // ─── Multi-line ledger path: fan out into one expense per line item ─────
  if (extracted.document_type === "multi_line_ledger" && extracted.line_items?.length) {
    return runLedgerBranch(supabase, params, {
      extracted,
      associations,
      learnedRules,
      learnedCategoryRules,
      categories,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
    });
  }

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

  // Learned category rules take priority over Gemini's guess.
  const learnedCategoryMatch = matchLearnedCategoryRule(extracted.supplier, learnedCategoryRules);
  if (learnedCategoryMatch.category) {
    category = learnedCategoryMatch.category;
  }

  // Duplicate-receipt detection: same reference number, or same supplier + amount within +/-1 day of an existing expense.
  const possibleDuplicateOf = await findPossibleDuplicate(supabase, {
    supplier: extracted.supplier,
    amount: extracted.amount,
    expenseDate: extracted.expense_date,
    referenceNumber: extracted.reference_number,
  });

  const { data: inserted, error } = await supabase
    .from("expenses")
    .insert({
      association_id: finalAssociationId,
      supplier: extracted.supplier,
      expense_date: extracted.expense_date,
      amount: extracted.amount,
      currency: extracted.currency,
      category,
      reference_number: extracted.reference_number,
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
    possibleDuplicateOf,
  });

  return {
    expense: inserted,
    expenses: [inserted],
    ledgerGroupId: null,
    totalMismatch: null,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
  };
}

/**
 * Multi-line ledger branch: inserts one expenses row per line item, each
 * independently matched to an association/category. Skips the Phase 4 LLM
 * recheck (cost control) — low-confidence line items are left unassigned
 * for manual review in the upload UI instead.
 */
async function runLedgerBranch(
  supabase: SupabaseClient<Database>,
  params: RunExtractionPipelineParams,
  ctx: {
    extracted: Extraction;
    associations: AssociationRow[];
    learnedRules: AssociationRuleRow[];
    learnedCategoryRules: CategoryRuleRow[];
    categories: { name: string; keywords: string[] }[];
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostUsd: number | null;
  },
): Promise<RunExtractionPipelineResult> {
  const { extracted, associations, learnedRules, learnedCategoryRules, categories, inputTokens, outputTokens, estimatedCostUsd } = ctx;
  const lineItems = extracted.line_items ?? [];
  const ledgerGroupId = crypto.randomUUID();
  const catNames = categories.map((c) => c.name);

  const insertedRows: Database["public"]["Tables"]["expenses"]["Row"][] = [];

  for (let i = 0; i < lineItems.length; i++) {
    const lineItem = lineItems[i];
    const expenseDate = lineItem.expense_date ?? extracted.expense_date;
    const currency = lineItem.currency ?? extracted.currency;

    const { associationMatch, category: matchedCategory } = matchLineItem(
      lineItem.supplier,
      associations,
      learnedRules,
      learnedCategoryRules,
      null,
    );

    let category = matchedCategory;
    if (category && catNames.length) {
      const match = catNames.find((n) => n.toLowerCase() === category!.toLowerCase());
      category = match ?? category;
    }

    const possibleDuplicateOf = await findPossibleDuplicate(supabase, {
      supplier: lineItem.supplier,
      amount: lineItem.amount,
      expenseDate,
      referenceNumber: lineItem.reference_number,
    });

    const rawExtraction = {
      document_type: extracted.document_type,
      grand_total: extracted.grand_total,
      ledger_group_id: ledgerGroupId,
      line_item: lineItem,
    };

    const { data: inserted, error } = await supabase
      .from("expenses")
      .insert({
        association_id: associationMatch.association_id,
        supplier: lineItem.supplier,
        expense_date: expenseDate,
        amount: lineItem.amount,
        currency,
        category,
        reference_number: lineItem.reference_number,
        file_path: params.filePath,
        file_mime: params.fileMime,
        raw_extraction: rawExtraction as never,
        ledger_group_id: ledgerGroupId,
        source_line_index: i,
      })
      .select()
      .single();

    if (error || !inserted) {
      throw new Error(error?.message ?? `Failed to insert ledger line item ${i}`);
    }
    insertedRows.push(inserted);

    await writeAuditLog(supabase, {
      expenseId: inserted.id,
      fileName: params.fileName,
      extracted: {
        ...extracted,
        supplier: lineItem.supplier,
        expense_date: expenseDate,
        amount: lineItem.amount,
        currency,
        category,
        association_id: associationMatch.association_id,
        reference_number: lineItem.reference_number,
      },
      validation: { valid: true, errors: [], warnings: [] },
      ruleMatch: associationMatch,
      recheckPerformed: false,
      llmModel: "gemini-2.5-flash",
      inputTokens: i === 0 ? inputTokens : null,
      outputTokens: i === 0 ? outputTokens : null,
      estimatedCostUsd: i === 0 ? estimatedCostUsd : null,
      possibleDuplicateOf,
    });
  }

  const sumOfLineItems = lineItems.reduce((sum, li) => sum + (li.amount ?? 0), 0);
  const totalMismatch =
    extracted.grand_total != null && Math.abs(extracted.grand_total - sumOfLineItems) > 0.01
      ? { grandTotal: extracted.grand_total, sumOfLineItems }
      : null;

  return {
    expense: insertedRows[0],
    expenses: insertedRows,
    ledgerGroupId,
    totalMismatch,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
  };
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
    possibleDuplicateOf: string | null;
  },
) {
  const {
    expenseId,
    fileName,
    extracted,
    validation,
    ruleMatch,
    recheckPerformed,
    llmModel,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    possibleDuplicateOf,
  } = params;

  const { error } = await supabase.from("extraction_audit_log").insert({
    expense_id: expenseId,
    file_name: fileName,
    extracted_supplier: extracted.supplier,
    extracted_expense_date: extracted.expense_date,
    extracted_amount: extracted.amount,
    extracted_currency: extracted.currency,
    extracted_category: extracted.category,
    extracted_association_id: extracted.association_id,
    extracted_reference_number: extracted.reference_number,
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
    pipeline_trace: { validation, ruleMatch, recheckPerformed, possibleDuplicateOf } as never,
    possible_duplicate_of: possibleDuplicateOf,
  } as never);

  if (error) {
    console.error("Failed to write extraction_audit_log", error);
  }
}
