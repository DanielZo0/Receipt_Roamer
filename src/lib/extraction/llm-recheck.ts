import { callGeminiForExtraction, type Extraction, type GeminiCallResult } from "./gemini";
import type { ValidationError } from "./validation";

/**
 * Phase 4: re-asks Gemini to fix only the fields flagged by Phase 2 (validation
 * errors) or Phase 3 (low-confidence association match). Reuses the same file
 * part so the model can re-read the document, but narrows the question to the
 * specific problems found.
 */
export async function recheckExtraction(params: {
  apiKey: string;
  file: { mime: string; base64: string };
  original: Extraction;
  errors: ValidationError[];
  lowConfidenceAssociation: boolean;
}): Promise<GeminiCallResult> {
  const { apiKey, file, original, errors, lowConfidenceAssociation } = params;

  const issues: string[] = errors.map(
    (e) => `- ${e.field}: "${String(e.value)}" is invalid — ${e.reason}`,
  );
  if (lowConfidenceAssociation) {
    issues.push(
      `- association_id: your previous guess ("${original.association_id ?? "null"}") was low-confidence — re-examine the document for supplier name, billing address, and any reference numbers.`,
    );
  }

  const systemPrompt =
    "You are a meticulous accounting assistant correcting a prior extraction. Re-read the attached document carefully and fix ONLY the fields listed as problematic. Keep all other fields as given unless you find them to also be wrong. Always respond with a single JSON object matching the requested schema.";

  const userPrompt = `Your previous extraction of this document was:
${JSON.stringify(original, null, 2)}

The following fields have problems:
${issues.join("\n")}

Re-examine the attached document and return a corrected JSON object with exactly these keys: supplier, expense_date, amount, currency, category, association_id, reasoning. Use null for any field you genuinely cannot determine. Do not wrap the JSON in markdown.`;

  return callGeminiForExtraction({ apiKey, systemPrompt, userPrompt, file });
}
