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

// ── Shared extraction pipeline (src/lib/extraction/) ─────────────────────────

import { runExtractionPipeline } from "@/lib/extraction/pipeline";

async function extractAndSaveAttachment(
  supabase: ReturnType<typeof getSupabase>,
  fileName: string,
  mimeType: string,
  fileBuffer: Buffer,
) {
  const fileSize = fileBuffer.byteLength;
  const fileBase64 = fileBuffer.toString("base64");

  // Upload to Supabase Storage
  const storagePath = `${crypto.randomUUID()}-${fileName.replace(/[^\w.\-]/g, "_")}`;
  const { error: upErr } = await supabase.storage
    .from("receipts")
    .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  try {
    const { expense, inputTokens, outputTokens, estimatedCostUsd } = await runExtractionPipeline(
      supabase,
      {
        fileName,
        fileMime: mimeType,
        fileBase64,
        filePath: storagePath,
        fileSize,
      },
    );

    await supabase.from("upload_logs").insert({
      file_name: fileName,
      file_size: fileSize,
      file_mime: mimeType,
      status: "success",
      expense_id: expense.id,
      error_message: null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimatedCostUsd,
      source: "email",
    } as never);

    console.log(`[email-inbound] Saved expense ${expense.id} from attachment "${fileName}"`);
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
  }
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
