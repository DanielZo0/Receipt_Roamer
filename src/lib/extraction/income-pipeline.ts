import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildPaymentExtractionPrompt, callGeminiForPaymentExtraction } from "./payment-gemini";
import { matchOwner, type OwnerRow } from "./owner-matching";
import { type AssociationRow } from "./association-matching";
import { RULES } from "./rules";

export interface RunIncomeExtractionPipelineParams {
  fileName: string;
  fileMime: string;
  fileBase64: string;
  filePath: string;
}

export interface RunIncomeExtractionPipelineResult {
  payment: Database["public"]["Tables"]["income_payments"]["Row"];
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}

/**
 * Extraction pipeline for owner payment screenshots (e.g. Wise transfer
 * confirmations). Mirrors runExtractionPipeline() in pipeline.ts but for the
 * income side: extracts payer/amount/reference, matches against owners
 * (see owner-matching.ts), and marks the owner's contribution as paid when
 * the match is confident.
 */
export async function runIncomeExtractionPipeline(
  supabase: SupabaseClient<Database>,
  params: RunIncomeExtractionPipelineParams,
): Promise<RunIncomeExtractionPipelineResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const [{ data: ownerRows }, { data: associationRows }] = await Promise.all([
    supabase.from("owners").select("id, condominium_id, name, apartment"),
    supabase.from("associations").select("id, name, address, keywords, notes"),
  ]);
  const owners: OwnerRow[] = ownerRows ?? [];
  const associations: AssociationRow[] = associationRows ?? [];

  const file = { mime: params.fileMime, base64: params.fileBase64 };

  const { systemPrompt, userPrompt } = buildPaymentExtractionPrompt();
  const { extracted, inputTokens, outputTokens, estimatedCostUsd } = await callGeminiForPaymentExtraction({
    apiKey,
    systemPrompt,
    userPrompt,
    file,
  });

  const ownerMatch = matchOwner(
    { payer_name: extracted.payer_name, reference_string: extracted.reference_string },
    owners,
    associations,
  );

  const { data: inserted, error } = await supabase
    .from("income_payments")
    .insert({
      owner_id: ownerMatch.owner_id,
      condominium_id: ownerMatch.condominium_id,
      payer_name: extracted.payer_name,
      amount: extracted.amount,
      currency: extracted.currency,
      payment_date: extracted.payment_date,
      reference_string: extracted.reference_string,
      match_confidence: ownerMatch.confidence,
      match_signals: ownerMatch.matched_by,
      file_path: params.filePath,
      file_mime: params.fileMime,
      raw_extraction: extracted as never,
    })
    .select()
    .single();

  if (error || !inserted) {
    throw new Error(error?.message ?? "Failed to insert income payment");
  }

  if (ownerMatch.owner_id && ownerMatch.confidence >= RULES.owner_matching.combined_threshold) {
    const { error: updateError } = await supabase
      .from("owners")
      .update({ contribution_paid: true })
      .eq("id", ownerMatch.owner_id);
    if (updateError) {
      console.error("Failed to mark owner contribution_paid", updateError);
    }
  }

  return {
    payment: inserted,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
  };
}
