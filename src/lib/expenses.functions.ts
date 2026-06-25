import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

function getSupabase() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

const ExtractionSchema = z.object({
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

export const extractAndSaveExpense = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        file_path: z.string(),
        file_mime: z.string(),
        file_base64: z.string(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const supabase = getSupabase();
    const [{ data: associations }, { data: categories }] = await Promise.all([
      supabase.from("associations").select("id, name, address, keywords, notes"),
      supabase.from("categories").select("name, keywords").order("name"),
    ]);

    const list = (associations ?? [])
      .map(
        (a) =>
          `- id=${a.id} | name="${a.name}"${a.address ? ` | address="${a.address}"` : ""}${a.keywords?.length ? ` | keywords=${a.keywords.join(", ")}` : ""}${a.notes ? ` | notes=${a.notes}` : ""}`,
      )
      .join("\n");

    const catList = (categories ?? [])
      .map(
        (c) =>
          `- "${c.name}"${c.keywords?.length ? ` (keywords: ${c.keywords.join(", ")})` : ""}`,
      )
      .join("\n");
    const catNames = (categories ?? []).map((c) => c.name);

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

    // Build the Gemini API parts array.
    // Both images and PDFs are passed as inline_data (base64) — Gemini 2.5 Pro handles both natively.
    const parts: Array<Record<string, unknown>> = [
      { text: systemPrompt + "\n\n" + userPrompt },
      {
        inline_data: {
          mime_type: data.file_mime,
          data: data.file_base64,
        },
      },
    ];

    let extracted: z.infer<typeof ExtractionSchema>;
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts }],
            generationConfig: {
              response_mime_type: "application/json",
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
      // Gemini response shape: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
      const rawText: string =
        json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      const parsed = typeof rawText === "string" ? JSON.parse(rawText) : rawText;

      extracted = ExtractionSchema.parse({
        supplier: parsed.supplier ?? null,
        expense_date: parsed.expense_date ?? null,
        amount: parsed.amount == null ? null : Number(parsed.amount),
        currency: parsed.currency ?? null,
        category: parsed.category ?? null,
        association_id: parsed.association_id ?? null,
        reasoning: parsed.reasoning ?? null,
      });
    } catch (e) {
      console.error("AI extraction failed", e);
      extracted = {
        supplier: null,
        expense_date: null,
        amount: null,
        currency: null,
        category: null,
        association_id: null,
        reasoning: null,
      };
    }

    // Validate association_id exists in our list
    const validIds = new Set((associations ?? []).map((a) => a.id));
    const assocId =
      extracted.association_id && validIds.has(extracted.association_id)
        ? extracted.association_id
        : null;

    // Normalise category to one of the known names (case-insensitive)
    let category = extracted.category;
    if (category && catNames.length) {
      const match = catNames.find(
        (n) => n.toLowerCase() === category!.toLowerCase(),
      );
      category = match ?? category;
    }

    const { data: inserted, error } = await supabase
      .from("expenses")
      .insert({
        association_id: assocId,
        supplier: extracted.supplier,
        expense_date: extracted.expense_date,
        amount: extracted.amount,
        currency: extracted.currency,
        category,
        file_path: data.file_path,
        file_mime: data.file_mime,
        raw_extraction: extracted as never,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return inserted;
  });