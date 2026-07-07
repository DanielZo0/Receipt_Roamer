import { z } from "zod";

export const LedgerLineItemSchema = z.object({
  supplier: z.string().nullable().describe("Property/association/payee name as written on this line"),
  amount: z.number().nullable().describe("Amount for this line item (positive number)"),
  expense_date: z
    .string()
    .nullable()
    .describe("Date for this line item in YYYY-MM-DD format, if present on the line; otherwise null"),
  currency: z.string().nullable().describe("ISO 4217 currency code for this line item, e.g. EUR, USD"),
  notes: z.string().nullable().describe("Raw text of the line (e.g. day numbers like \"3-10-17-24\"), for audit purposes"),
});

export type LedgerLineItem = z.infer<typeof LedgerLineItemSchema>;

export const ExtractionSchema = z.object({
  document_type: z
    .enum(["single_receipt", "multi_line_ledger"])
    .nullable()
    .describe("single_receipt for a normal bill/invoice, multi_line_ledger for a document listing multiple payees/properties each with their own amount"),
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
  line_items: z
    .array(LedgerLineItemSchema)
    .nullable()
    .describe("Only populated when document_type is multi_line_ledger: one entry per row in the ledger"),
  grand_total: z
    .number()
    .nullable()
    .describe("Only for multi_line_ledger: the stated grand total at the bottom of the document, if present"),
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
    document_type: parsed.document_type ?? null,
    supplier: parsed.supplier ?? null,
    expense_date: parsed.expense_date ?? null,
    amount: parsed.amount == null ? null : Number(parsed.amount),
    currency: parsed.currency ?? null,
    category: parsed.category ?? null,
    association_id: parsed.association_id ?? null,
    reasoning: parsed.reasoning ?? null,
    line_items: Array.isArray(parsed.line_items)
      ? parsed.line_items.map((li: Record<string, unknown>) => ({
          supplier: (li.supplier as string) ?? null,
          amount: li.amount == null ? null : Number(li.amount),
          expense_date: (li.expense_date as string) ?? null,
          currency: (li.currency as string) ?? null,
          notes: (li.notes as string) ?? null,
        }))
      : null,
    grand_total: parsed.grand_total == null ? null : Number(parsed.grand_total),
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

  const userPrompt = `You are reading a receipt, utility bill, invoice, acknowledgement, or handwritten ledger. Read ALL text in the document carefully (header, body, totals, footer, fine print) before answering.

First, determine document_type:
- "multi_line_ledger": the document lists MULTIPLE distinct properties/associations/payees, each with its own amount (e.g. a handwritten ledger page, a list of cleaning/service jobs billed to different properties, a summary sheet with one row per client). This is true when there are 3 or more clearly separate name+amount rows.
- "single_receipt": everything else — a normal bill/invoice/receipt for ONE purchase or ONE payee, even if it lists several purchased items or taxes as sub-lines of the SAME single total. When in doubt, prefer "single_receipt".

If document_type is "single_receipt", extract these fields (as before):
- supplier: the merchant / company / issuer name as printed. Prefer the legal/brand name at the top of the document, not a parent group or payment processor.
- expense_date: the invoice/issue date (NOT the due date, NOT the period covered). Format strictly as YYYY-MM-DD. Convert from any locale format (e.g. "14/03/2025" -> "2025-03-14", "March 14, 2025" -> "2025-03-14").
- amount: the FINAL total the customer must pay, taxes included. Look for labels like "Total", "Total à payer", "Importe total", "Total TTC", "Grand total", "Amount due". Return a positive number using a dot as decimal separator (e.g. 1234.56). Ignore subtotals, previous balance, or per-line amounts.
- currency: ISO 4217 code (EUR, USD, GBP, CHF...). Infer from the symbol (€=EUR, $=USD, £=GBP) or country if not explicit.
- category: pick the SINGLE best matching category from the list below by comparing the supplier name and line items against each category's name and keywords. If nothing fits, use "Other" (or null if "Other" is not in the list).
- association_id: pick the SINGLE best matching association from the list below by comparing the bill's supplier, addressee, billing address, postal code, references, or any keyword. If no association clearly matches, set null — do not guess.
- reasoning: 1-2 sentences explaining which clues led to the association choice (or why none matched).
Leave line_items and grand_total null.

If document_type is "multi_line_ledger", instead populate line_items: one entry per row in the document, in the order they appear, without merging or skipping any row. For each line item:
- supplier: transcribe the property/association/payee name text verbatim as written.
- amount: the amount printed for that specific line (a positive number, dot decimal separator).
- expense_date: a per-line date if one is written on that row, formatted YYYY-MM-DD; otherwise null (a document-level date will be used as fallback if you can find one).
- currency: the currency for that line if inferable, otherwise null (a document-level currency will be used as fallback).
- notes: the raw text of the line item that isn't the name/amount (e.g. day numbers like "3-10-17-24" or "18"), for audit purposes.
Also set grand_total to the stated total at the bottom of the document if one is written, otherwise null. In this case the top-level supplier/amount/association_id/category fields can be left null (they are not used for ledgers).

Associations:
${list || "(none)"}

Categories:
${catList || "(none — return null)"}

Return ONLY a single JSON object with exactly these keys: document_type, supplier, expense_date, amount, currency, category, association_id, reasoning, line_items, grand_total. Use null for any field that doesn't apply. Do not wrap the JSON in markdown.`;

  return { systemPrompt, userPrompt };
}
