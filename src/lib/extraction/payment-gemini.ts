import { z } from "zod";

export const PaymentExtractionSchema = z.object({
  payer_name: z.string().nullable().describe("Name of the person/entity who sent the money, as printed"),
  amount: z.number().nullable().describe("Amount received (positive number)"),
  currency: z.string().nullable().describe("ISO 4217 currency code, e.g. EUR, USD"),
  payment_date: z
    .string()
    .nullable()
    .describe("Date the payment was received, in YYYY-MM-DD format"),
  reference_string: z
    .string()
    .nullable()
    .describe("The reference/memo/note text attached to the transfer, verbatim"),
  reasoning: z.string().nullable().describe("Brief note on anything ambiguous about the extraction"),
});

export type PaymentExtraction = z.infer<typeof PaymentExtractionSchema>;

export interface PaymentGeminiCallResult {
  extracted: PaymentExtraction;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}

const SYSTEM_PROMPT =
  "You are a meticulous accounting assistant that performs OCR and structured extraction on payment/transfer confirmation screenshots (e.g. Wise, Revolut, bank apps) in any language. You read every visible character before answering and always respond with a single JSON object matching the requested schema. Never invent values — use null when uncertain.";

const USER_PROMPT = `You are reading a screenshot of a money-transfer confirmation (e.g. "You were sent...", "Money added", "Transaction details"). Read ALL visible text carefully before answering.

Extract:
- payer_name: the name of the sender, as printed (e.g. "MR JORDAN PHILIPPE DUBOIS"). Do not include titles like "MR"/"MRS" in a separate field — return the name exactly as shown.
- amount: the amount received (look for "You received", "You were sent", or the large headline amount). Return a positive number with a dot decimal separator.
- currency: ISO 4217 code inferred from the amount label (e.g. "EUR", "USD", "GBP").
- payment_date: the "Received on" / "Date" field, in YYYY-MM-DD format. Convert from any locale/format (e.g. "Thursday, May 14, 2026" -> "2026-05-14").
- reference_string: the "Reference" / "Note" / "Memo" field, transcribed verbatim including any run-together words (do not add spaces that aren't there).
- reasoning: 1 sentence on anything unclear.

Return ONLY a single JSON object with exactly these keys: payer_name, amount, currency, payment_date, reference_string, reasoning. Use null for any field that doesn't apply. Do not wrap the JSON in markdown.`;

export function buildPaymentExtractionPrompt() {
  return { systemPrompt: SYSTEM_PROMPT, userPrompt: USER_PROMPT };
}

/**
 * Calls Gemini for payment-screenshot extraction. Mirrors
 * callGeminiForExtraction in gemini.ts but parses against
 * PaymentExtractionSchema instead of the expense ExtractionSchema.
 */
export async function callGeminiForPaymentExtraction(params: {
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  file: { mime: string; base64: string };
}): Promise<PaymentGeminiCallResult> {
  const { apiKey, systemPrompt, userPrompt, file } = params;

  const parts: Array<Record<string, unknown>> = [
    { text: systemPrompt + "\n\n" + userPrompt },
    { inline_data: { mime_type: file.mime, data: file.base64 } },
  ];

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0 },
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

  const extracted = PaymentExtractionSchema.parse({
    payer_name: parsed.payer_name ?? null,
    amount: parsed.amount == null ? null : Number(parsed.amount),
    currency: parsed.currency ?? null,
    payment_date: parsed.payment_date ?? null,
    reference_string: parsed.reference_string ?? null,
    reasoning: parsed.reasoning ?? null,
  });

  return { extracted, inputTokens, outputTokens, estimatedCostUsd };
}
