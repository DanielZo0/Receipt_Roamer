import { z } from "zod";

export const ExtractionSchema = z.object({
  supplier: z.string().nullable().describe("Merchant/supplier/issuer name"),
  expense_date: z
    .string()
    .nullable()
    .describe("Date of the receipt/bill in YYYY-MM-DD format"),
  amount: z.number().nullable().describe("Total amount paid (positive number)"),
  currency: z.string().nullable().describe("ISO 4217 currency code, e.g. EUR, USD"),
  category: z
    .string()
    .nullable()
    .describe("Short category like Utilities, Cleaning, Maintenance, Insurance, Tax, Other"),
  association_id: z
    .string()
    .nullable()
    .describe("UUID of the best-matching association from the provided list, or null"),
  reasoning: z.string().nullable().describe("Brief reason for the chosen association"),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

export interface GeminiCallResult {
  extracted: Extraction;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}

/**
 * Calls Gemini with the given system/user prompt and (optionally) an inline
 * file part, and parses the response against ExtractionSchema.
 * Shared by the initial extraction (Phase 1) and the Phase 4 LLM re-check.
 */
export async function callGeminiForExtraction(params: {
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  file?: { mime: string; base64: string };
}): Promise<GeminiCallResult> {
  const { apiKey, systemPrompt, userPrompt, file } = params;

  const parts: Array<Record<string, unknown>> = [{ text: systemPrompt + "\n\n" + userPrompt }];
  if (file) {
    parts.push({ inline_data: { mime_type: file.mime, data: file.base64 } });
  }

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          // Note: do NOT set response_mime_type when using inline_data (file) parts —
          // it conflicts with multimodal requests on some Gemini versions.
          temperature: 0,
        },
      }),
    },
  );

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${txt}`);
  }

  const json = await resp.json();
  const rawPart = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  const usageMeta = json?.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number }
    | undefined;
  const inputTokens = usageMeta?.promptTokenCount ?? null;
  const outputTokens = usageMeta?.candidatesTokenCount ?? null;
  // Gemini 2.5 Flash pricing: $0.30/1M input tokens, $2.50/1M output tokens (as of mid-2025)
  const estimatedCostUsd =
    inputTokens != null && outputTokens != null
      ? (inputTokens / 1_000_000) * 0.3 + (outputTokens / 1_000_000) * 2.5
      : null;

  if (!rawPart) {
    throw new Error(`Gemini returned no content. Full response: ${JSON.stringify(json)}`);
  }

  const cleaned =
    typeof rawPart === "string"
      ? rawPart.replace(/^```[\w]*\n?/m, "").replace(/```$/m, "").trim()
      : rawPart;
  const parsed = typeof cleaned === "string" ? JSON.parse(cleaned) : cleaned;

  const extracted = ExtractionSchema.parse({
    supplier: parsed.supplier ?? null,
    expense_date: parsed.expense_date ?? null,
    amount: parsed.amount == null ? null : Number(parsed.amount),
    currency: parsed.currency ?? null,
    category: parsed.category ?? null,
    association_id: parsed.association_id ?? null,
    reasoning: parsed.reasoning ?? null,
  });

  return { extracted, inputTokens, outputTokens, estimatedCostUsd };
}

export interface AssociationForPrompt {
  id: string;
  name: string;
  address: string | null;
  keywords: string[];
  notes: string | null;
}

export interface CategoryForPrompt {
  name: string;
  keywords: string[];
}

/** Builds the shared system/user prompt used for the initial extraction call. */
export function buildExtractionPrompt(
  associations: AssociationForPrompt[],
  categories: CategoryForPrompt[],
) {
  const list = associations
    .map(
      (a) =>
        `- id=${a.id} | name="${a.name}"${a.address ? ` | address="${a.address}"` : ""}${a.keywords?.length ? ` | keywords=${a.keywords.join(", ")}` : ""}${a.notes ? ` | notes=${a.notes}` : ""}`,
    )
    .join("\n");

  const catList = categories
    .map((c) => `- "${c.name}"${c.keywords?.length ? ` (keywords: ${c.keywords.join(", ")})` : ""}`)
    .join("\n");

  const systemPrompt =
    "You are a meticulous accounting assistant that performs OCR and structured extraction on receipts, utility bills, and acknowledgements in any language. You read every visible character before answering and always respond with a single JSON object matching the requested schema. Never invent values — use null when uncertain.";

  const userPrompt = `You are reading a receipt, utility bill, invoice or acknowledgement. Read ALL text in the document carefully (header, body, totals, footer, fine print) before answering.

Extract these fields:
- supplier: the merchant / company / issuer name as printed. Prefer the legal/brand name at the top of the document, not a parent group or payment processor.
- expense_date: the invoice/issue date (NOT the due date, NOT the period covered). Format strictly as YYYY-MM-DD. Convert from any locale format (e.g. "14/03/2025" -> "2025-03-14", "March 14, 2025" -> "2025-03-14").
- amount: the FINAL total the customer must pay, taxes included. Look for labels like "Total", "Total à payer", "Importe total", "Total TTC", "Grand total", "Amount due". Return a positive number using a dot as decimal separator (e.g. 1234.56). Ignore subtotals, previous balance, or per-line amounts.
- currency: ISO 4217 code (EUR, USD, GBP, CHF...). Infer from the symbol (€=EUR, $=USD, £=GBP) or country if not explicit.
- category: pick the SINGLE best matching category from the list below by comparing the supplier name and line items against each category's name and keywords. If nothing fits, use "Other" (or null if "Other" is not in the list).
- association_id: pick the SINGLE best matching association from the list below by comparing the bill's supplier, addressee, billing address, postal code, references, or any keyword. If no association clearly matches, set null — do not guess.
- reasoning: 1-2 sentences explaining which clues led to the association choice (or why none matched).

Associations:
${list || "(none)"}

Categories:
${catList || "(none — return null)"}

Return ONLY a single JSON object with exactly these keys: supplier, expense_date, amount, currency, category, association_id, reasoning. Use null for any field you genuinely cannot determine. Do not wrap the JSON in markdown.`;

  return { systemPrompt, userPrompt };
}
