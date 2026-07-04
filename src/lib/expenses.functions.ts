import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { loadMasterData } from "@/lib/master-data/loader";
import { validateExtractedFields, shouldTriggerLLMRecheck } from "@/lib/master-data/deterministic-validation";
import { matchAssociation, shouldLLMRecheckAssociation } from "@/lib/master-data/association-matching";

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

interface AuditTraceEntry {
  phase: string;
  timestamp: string;
  action: string;
  details: Record<string, unknown>;
}

export const extractAndSaveExpense = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        file_path: z.string(),
        file_name: z.string(),
        file_size: z.number().optional(),
        file_mime: z.string(),
        file_base64: z.string(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const supabase = getSupabase();
    
    // Load master data once at the start
    const masterData = loadMasterData();
    const associations = masterData.associations;
    const categories = masterData.categories;
    
    const pipelineTrace: AuditTraceEntry[] = [];

    const list = associations
      .map(
        (a) =>
          `- id=${a.id} | name="${a.name}"${a.address ? ` | address="${a.address}"` : ""}${a.keywords?.length ? ` | keywords=${a.keywords.join(", ")}` : ""}`,
      )
      .join("\n");

    const catList = categories
      .map(
        (c) =>
          `- "${c.name}"${c.keywords?.length ? ` (keywords: ${c.keywords.join(", ")})` : ""}`,
      )
      .join("\n");
    const catNames = categories.map((c) => c.name);

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

    // ─── PHASE 1: GEMINI EXTRACTION ────────────────────────────────────────
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
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let estimatedCostUsd: number | null = null;
    
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts }],
            generationConfig: {
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
      const usageMeta = json?.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      inputTokens = usageMeta?.promptTokenCount ?? null;
      outputTokens = usageMeta?.candidatesTokenCount ?? null;
      estimatedCostUsd =
        inputTokens != null && outputTokens != null
          ? (inputTokens / 1_000_000) * 0.3 + (outputTokens / 1_000_000) * 2.5
          : null;
          
      if (!rawPart) {
        throw new Error(`Gemini returned no content. Full response: ${JSON.stringify(json)}`);
      }
      
      const cleaned = typeof rawPart === "string"
        ? rawPart.replace(/^```[\w]*\n?/m, "").replace(/```$/m, "").trim()
        : rawPart;
      const parsed = typeof cleaned === "string" ? JSON.parse(cleaned) : cleaned;

      extracted = ExtractionSchema.parse({
        supplier: parsed.supplier ?? null,
        expense_date: parsed.expense_date ?? null,
        amount: parsed.amount == null ? null : Number(parsed.amount),
        currency: parsed.currency ?? null,
        category: parsed.category ?? null,
        association_id: parsed.association_id ?? null,
        reasoning: parsed.reasoning ?? null,
      });

      pipelineTrace.push({
        phase: "gemini_extraction",
        timestamp: new Date().toISOString(),
        action: "extracted_from_gemini",
        details: { extracted },
      });
    } catch (e) {
      console.error("AI extraction failed", e);
      await supabase.from("upload_logs").insert({
        file_name: data.file_name,
        file_size: data.file_size ?? null,
        file_mime: data.file_mime,
        status: "error",
        expense_id: null,
        error_message: (e as Error).message ?? "Unknown error",
        input_tokens: null,
        output_tokens: null,
        estimated_cost_usd: null,
      });
      throw new Error(`AI extraction failed: ${(e as Error).message}`);
    }

    // ─── PHASE 2: DETERMINISTIC VALIDATION ─────────────────────────────────
    const validationResult = validateExtractedFields({
      supplier: extracted.supplier,
      expense_date: extracted.expense_date,
      amount: extracted.amount,
      currency: extracted.currency,
      category: extracted.category,
      association_id: extracted.association_id,
    });

    pipelineTrace.push({
      phase: "deterministic_validation",
      timestamp: new Date().toISOString(),
      action: "validated_extraction",
      details: {
        valid: validationResult.valid,
        errors: validationResult.errors,
        warnings: validationResult.warnings,
      },
    });

    // ─── PHASE 3: RULE-BASED ASSOCIATION MATCHING ──────────────────────────
    const associationMatch = matchAssociation({
      supplier: extracted.supplier,
      postal_code: null,  // TODO: Extract postal code from receipt if available
      address: null,      // TODO: Extract address from receipt if available
    });

    // Use deterministic match if confidence exceeds threshold, otherwise use Gemini's suggestion
    const finalAssociationId = associationMatch.confidence >= 0.6
      ? associationMatch.association_id
      : extracted.association_id;

    pipelineTrace.push({
      phase: "association_matching",
      timestamp: new Date().toISOString(),
      action: "matched_association",
      details: {
        deterministic_match: associationMatch,
        gemini_suggestion: extracted.association_id,
        final_association_id: finalAssociationId,
      },
    });

    // Validate that final association ID exists
    const validIds = new Set(associations.map((a) => a.id));
    const assocId = finalAssociationId && validIds.has(finalAssociationId) ? finalAssociationId : null;

    // Normalise category to one of the known names (case-insensitive)
    let category = extracted.category;
    if (category && catNames.length) {
      const match = catNames.find(
        (n) => n.toLowerCase() === category!.toLowerCase(),
      );
      category = match ?? category;
    }

    // ─── SAVE EXPENSE ──────────────────────────────────────────────────────
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

    // ─── LOG TO EXTRACTION AUDIT LOG ──────────────────────────────────────
    pipelineTrace.push({
      phase: "expense_saved",
      timestamp: new Date().toISOString(),
      action: "saved_to_database",
      details: {
        expense_id: inserted?.id,
        association_id: assocId,
      },
    });

    await supabase.from("extraction_audit_log").insert({
      expense_id: inserted?.id!,
      file_name: data.file_name,
      extracted_supplier: extracted.supplier,
      extracted_expense_date: extracted.expense_date,
      extracted_amount: extracted.amount,
      extracted_currency: extracted.currency,
      extracted_category: extracted.category,
      extracted_association_id: extracted.association_id,
      phase: "complete",
      validation_errors: validationResult.errors.length > 0 ? validationResult.errors : null,
      validation_warnings: validationResult.warnings.length > 0 ? validationResult.warnings : null,
      association_match_confidence: associationMatch.confidence,
      association_match_signals: associationMatch.matched_by,
      llm_model: "gemini-2.5-flash",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimatedCostUsd,
      extraction_reasoning: extracted.reasoning,
      pipeline_trace: pipelineTrace,
    });

    // ─── LOG TO UPLOAD LOGS ────────────────────────────────────────────────
    await supabase.from("upload_logs").insert({
      file_name: data.file_name,
      file_size: data.file_size ?? null,
      file_mime: data.file_mime,
      status: "success",
      expense_id: inserted?.id ?? null,
      error_message: null,
      input_tokens: inputTokens!,
      output_tokens: outputTokens!,
      estimated_cost_usd: estimatedCostUsd,
    });

    return inserted;
  });