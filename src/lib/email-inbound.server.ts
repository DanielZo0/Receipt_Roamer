/**
 * email-inbound.server.ts
 *
 * Parses and verifies a Mailgun Inbound Webhook, then processes each valid
 * image/PDF attachment through the existing AI extraction pipeline.
 *
 * Security:
 *   - Verifies Mailgun's HMAC-SHA256 signature on every request.
 *   - Silently ignores any email NOT sent from ALLOWED_SENDER.
 *   - Rejects attachments that are not images or PDFs, or exceed MAX_BYTES.
 */

import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Database } from "@/integrations/supabase/types";

// ── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_SENDER = "danzammit1@gmail.com";
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per attachment
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/tiff",
  "application/pdf",
]);

// ── Supabase client (server-side only) ──────────────────────────────────────

function getSupabase() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

// ── Mailgun HMAC verification ────────────────────────────────────────────────

/**
 * Verifies the Mailgun webhook signature.
 * https://documentation.mailgun.com/en/latest/user_manual.html#webhooks
 */
function verifyMailgunSignature(
  signingKey: string,
  timestamp: string,
  token: string,
  signature: string,
): boolean {
  const value = timestamp + token;
  const expected = createHmac("sha256", signingKey).update(value).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// ── Shared Gemini + Supabase extraction (mirrors expenses.functions.ts) ──────

import { z } from "zod";

const ExtractionSchema = z.object({
  supplier: z.string().nullable(),
  expense_date: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  category: z.string().nullable(),
  association_id: z.string().nullable(),
  reasoning: z.string().nullable(),
});

async function extractAndSaveAttachment(
  supabase: ReturnType<typeof getSupabase>,
  fileName: string,
  mimeType: string,
  fileBuffer: Buffer,
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const fileSize = fileBuffer.byteLength;
  const fileBase64 = fileBuffer.toString("base64");

  // Upload to Supabase Storage
  const storagePath = `${crypto.randomUUID()}-${fileName.replace(/[^\w.\-]/g, "_")}`;
  const { error: upErr } = await supabase.storage
    .from("receipts")
    .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  // Fetch associations + categories for the AI prompt
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
- expense_date: the invoice/issue date (NOT the due date, NOT the period covered). Format strictly as YYYY-MM-DD.
- amount: the FINAL total the customer must pay, taxes included. Look for labels like "Total", "Total à payer", "Importe total", "Total TTC", "Grand total", "Amount due". Return a positive number using a dot as decimal separator.
- currency: ISO 4217 code (EUR, USD, GBP, CHF...).
- category: pick the SINGLE best matching category from the list below. If nothing fits, use "Other" (or null if "Other" is not in the list).
- association_id: pick the SINGLE best matching association from the list below. If no association clearly matches, set null — do not guess.
- reasoning: 1-2 sentences explaining the association choice.

Associations:
${list || "(none)"}

Categories:
${catList || "(none — return null)"}

Return ONLY a single JSON object with exactly these keys: supplier, expense_date, amount, currency, category, association_id, reasoning. Use null for any field you genuinely cannot determine. Do not wrap the JSON in markdown.`;

  const parts: Array<Record<string, unknown>> = [
    { text: systemPrompt + "\n\n" + userPrompt },
    { inline_data: { mime_type: mimeType, data: fileBase64 } },
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
    const usageMeta = json?.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
    inputTokens = usageMeta?.promptTokenCount ?? null;
    outputTokens = usageMeta?.candidatesTokenCount ?? null;
    estimatedCostUsd =
      inputTokens != null && outputTokens != null
        ? (inputTokens / 1_000_000) * 0.3 + (outputTokens / 1_000_000) * 2.5
        : null;

    if (!rawPart) throw new Error(`Gemini returned no content. Full response: ${JSON.stringify(json)}`);

    const cleaned =
      typeof rawPart === "string"
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
  } catch (e) {
    console.error("[email-inbound] AI extraction failed", e);
    await supabase.from("upload_logs").insert({
      file_name: fileName,
      file_size: fileSize,
      file_mime: mimeType,
      status: "error",
      expense_id: null,
      error_message: (e as Error).message ?? "Unknown error",
      input_tokens: null,
      output_tokens: null,
      estimated_cost_usd: null,
      source: "email",
    } as never);
    return;
  }

  // Validate association_id
  const validIds = new Set((associations ?? []).map((a) => a.id));
  const assocId =
    extracted.association_id && validIds.has(extracted.association_id)
      ? extracted.association_id
      : null;

  // Normalise category
  let category = extracted.category;
  if (category && catNames.length) {
    const match = catNames.find((n) => n.toLowerCase() === category!.toLowerCase());
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
      file_path: storagePath,
      file_mime: mimeType,
      raw_extraction: extracted as never,
    })
    .select()
    .single();

  if (error) {
    await supabase.from("upload_logs").insert({
      file_name: fileName,
      file_size: fileSize,
      file_mime: mimeType,
      status: "error",
      expense_id: null,
      error_message: error.message,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimatedCostUsd,
      source: "email",
    } as never);
    return;
  }

  await supabase.from("upload_logs").insert({
    file_name: fileName,
    file_size: fileSize,
    file_mime: mimeType,
    status: "success",
    expense_id: inserted?.id ?? null,
    error_message: null,
    input_tokens: inputTokens!,
    output_tokens: outputTokens!,
    estimated_cost_usd: estimatedCostUsd,
    source: "email",
  } as never);

  console.log(`[email-inbound] Saved expense ${inserted?.id} from attachment "${fileName}"`);
}

// ── Main webhook handler ─────────────────────────────────────────────────────

export async function handleMailgunWebhook(request: Request): Promise<Response> {
  // Mailgun sends multipart/form-data
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Bad request — could not parse form data", { status: 400 });
  }

  // 1. Verify signature
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    console.error("[email-inbound] Missing MAILGUN_WEBHOOK_SIGNING_KEY");
    return new Response("Server misconfigured", { status: 500 });
  }

  const timestamp = form.get("timestamp") as string | null;
  const token = form.get("token") as string | null;
  const signature = form.get("signature") as string | null;

  if (!timestamp || !token || !signature) {
    return new Response("Missing signature fields", { status: 400 });
  }

  if (!verifyMailgunSignature(signingKey, timestamp, token, signature)) {
    console.warn("[email-inbound] Invalid Mailgun signature — rejecting");
    return new Response("Forbidden", { status: 403 });
  }

  // 2. Check sender
  const sender = (form.get("sender") as string | null)?.toLowerCase().trim() ?? "";
  if (sender !== ALLOWED_SENDER.toLowerCase()) {
    console.log(`[email-inbound] Ignored email from disallowed sender: ${sender}`);
    // Return 200 so Mailgun doesn't retry — we just don't process it
    return new Response("OK", { status: 200 });
  }

  // 3. Collect attachment files from the form (Mailgun names them attachment-1, attachment-2, …)
  const attachments: { name: string; mime: string; buffer: Buffer }[] = [];

  for (const [key, value] of form.entries()) {
    if (!key.startsWith("attachment-")) continue;
    if (!(value instanceof File)) continue;

    const mime = value.type || "application/octet-stream";
    if (!ALLOWED_MIME.has(mime)) {
      console.log(`[email-inbound] Skipping attachment "${value.name}" with unsupported MIME: ${mime}`);
      continue;
    }

    if (value.size > MAX_BYTES) {
      console.log(`[email-inbound] Skipping attachment "${value.name}" — too large (${value.size} bytes)`);
      continue;
    }

    const arrayBuf = await value.arrayBuffer();
    attachments.push({
      name: value.name || key,
      mime,
      buffer: Buffer.from(arrayBuf),
    });
  }

  if (attachments.length === 0) {
    console.log("[email-inbound] Email had no processable attachments");
    return new Response("OK — no processable attachments", { status: 200 });
  }

  // 4. Process attachments asynchronously (don't block the response)
  const supabase = getSupabase();
  Promise.all(
    attachments.map((att) =>
      extractAndSaveAttachment(supabase, att.name, att.mime, att.buffer).catch((err) =>
        console.error(`[email-inbound] Failed to process "${att.name}":`, err),
      ),
    ),
  );

  return new Response("OK", { status: 200 });
}
