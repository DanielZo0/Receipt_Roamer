/**
 * email-inbound.server.ts
 *
 * Parses and verifies a Mailgun Inbound Webhook, then processes each valid
 * image/PDF attachment through the existing AI extraction pipeline.
 *
 * Security:
 *   - Verifies Mailgun's HMAC-SHA256 signature on every request.
 *   - Silently ignores any email NOT sent from an address in allowed_sender_emails.
 *   - Rejects attachments that are not images or PDFs, or exceed MAX_BYTES.
 */

import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Database } from "@/integrations/supabase/types";

// ── Constants ────────────────────────────────────────────────────────────────

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
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
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

// ── Shared extraction pipelines (src/lib/extraction/) ────────────────────────

import { runExtractionPipeline, runExtractionPipelineFromText } from "@/lib/extraction/pipeline";
import { ExtractionCancelledError } from "@/lib/extraction/gemini";
import {
  runIncomeExtractionPipeline,
  runIncomeExtractionPipelineFromText,
} from "@/lib/extraction/income-pipeline";

/** Subject line convention to route an inbound email to the income pipeline
 *  instead of the default expense pipeline — e.g. "Income: owner payment". */
const INCOME_SUBJECT_RE = /\b(income|payment|received)\b/i;

async function extractAndSaveAttachment(
  supabase: ReturnType<typeof getSupabase>,
  fileName: string,
  mimeType: string,
  fileBuffer: Buffer,
  emailSubject: string | null,
) {
  const fileSize = fileBuffer.byteLength;
  const fileBase64 = fileBuffer.toString("base64");

  // Upload to Supabase Storage
  const storagePath = `${crypto.randomUUID()}-${fileName.replace(/[^\w.\-]/g, "_")}`;
  const { error: upErr } = await supabase.storage
    .from("receipts")
    .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const { data: logRow, error: logInsertErr } = await supabase
    .from("upload_logs")
    .insert({
      file_name: fileName,
      file_size: fileSize,
      file_mime: mimeType,
      status: "processing",
      source: "email",
    } as never)
    .select()
    .single();
  if (logInsertErr || !logRow) {
    console.error("[email-inbound] Failed to create upload_logs row", logInsertErr);
  }
  const uploadLogId = (logRow as { id?: string } | null)?.id;

  try {
    const { expense, inputTokens, outputTokens, estimatedCostUsd } = await runExtractionPipeline(
      supabase,
      {
        fileName,
        fileMime: mimeType,
        fileBase64,
        filePath: storagePath,
        fileSize,
        emailSubject,
        uploadLogId,
      },
    );

    if (uploadLogId) {
      await supabase
        .from("upload_logs")
        .update({
          status: "success",
          expense_id: expense.id,
          error_message: null,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: estimatedCostUsd,
        } as never)
        .eq("id", uploadLogId);
    }

    console.log(`[email-inbound] Saved expense ${expense.id} from attachment "${fileName}"`);
  } catch (e) {
    const cancelled = e instanceof ExtractionCancelledError;
    if (!cancelled) console.error("[email-inbound] AI extraction failed", e);
    if (uploadLogId) {
      await supabase
        .from("upload_logs")
        .update({
          status: cancelled ? "cancelled" : "error",
          expense_id: null,
          error_message: cancelled ? null : ((e as Error).message ?? "Unknown error"),
        } as never)
        .eq("id", uploadLogId);
    }
  }
}

async function extractAndSaveIncomeAttachment(
  supabase: ReturnType<typeof getSupabase>,
  fileName: string,
  mimeType: string,
  fileBuffer: Buffer,
) {
  const fileSize = fileBuffer.byteLength;
  const fileBase64 = fileBuffer.toString("base64");

  const storagePath = `${crypto.randomUUID()}-${fileName.replace(/[^\w.\-]/g, "_")}`;
  const { error: upErr } = await supabase.storage
    .from("receipts")
    .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const { data: logRow, error: logInsertErr } = await supabase
    .from("upload_logs")
    .insert({
      file_name: fileName,
      file_size: fileSize,
      file_mime: mimeType,
      status: "processing",
      pipeline: "income",
      source: "email",
    } as never)
    .select()
    .single();
  if (logInsertErr || !logRow) {
    console.error("[email-inbound] Failed to create upload_logs row", logInsertErr);
  }
  const uploadLogId = (logRow as { id?: string } | null)?.id;

  try {
    const { payment, inputTokens, outputTokens, estimatedCostUsd } =
      await runIncomeExtractionPipeline(supabase, {
        fileName,
        fileMime: mimeType,
        fileBase64,
        filePath: storagePath,
        uploadLogId,
      });

    if (uploadLogId) {
      await supabase
        .from("upload_logs")
        .update({
          status: "success",
          income_payment_id: payment.id,
          error_message: null,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: estimatedCostUsd,
        } as never)
        .eq("id", uploadLogId);
    }

    console.log(`[email-inbound] Saved income payment ${payment.id} from attachment "${fileName}"`);
  } catch (e) {
    const cancelled = e instanceof ExtractionCancelledError;
    if (!cancelled) console.error("[email-inbound] Income extraction failed", e);
    if (uploadLogId) {
      await supabase
        .from("upload_logs")
        .update({
          status: cancelled ? "cancelled" : "error",
          income_payment_id: null,
          error_message: cancelled ? null : ((e as Error).message ?? "Unknown error"),
        } as never)
        .eq("id", uploadLogId);
    }
  }
}

/** Handles an "income"/"payment" email that has no usable attachment, by
 *  reading the payment details straight out of the forwarded email's plain
 *  text body (e.g. a forwarded Wise "Money received" notification). */
async function extractAndSaveIncomeFromText(
  supabase: ReturnType<typeof getSupabase>,
  subject: string | null,
  emailBodyText: string,
) {
  const logName = subject ?? "(no subject)";

  const { data: logRow, error: logInsertErr } = await supabase
    .from("upload_logs")
    .insert({
      file_name: logName,
      file_size: emailBodyText.length,
      file_mime: "text/plain",
      status: "processing",
      pipeline: "income",
      source: "email",
    } as never)
    .select()
    .single();
  if (logInsertErr || !logRow) {
    console.error("[email-inbound] Failed to create upload_logs row", logInsertErr);
  }
  const uploadLogId = (logRow as { id?: string } | null)?.id;

  try {
    const { payment, inputTokens, outputTokens, estimatedCostUsd } =
      await runIncomeExtractionPipelineFromText(supabase, { emailBodyText, uploadLogId });

    if (uploadLogId) {
      await supabase
        .from("upload_logs")
        .update({
          status: "success",
          income_payment_id: payment.id,
          error_message: null,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: estimatedCostUsd,
        } as never)
        .eq("id", uploadLogId);
    }

    console.log(`[email-inbound] Saved income payment ${payment.id} from email body text`);
  } catch (e) {
    const cancelled = e instanceof ExtractionCancelledError;
    if (!cancelled) console.error("[email-inbound] Income text extraction failed", e);
    if (uploadLogId) {
      await supabase
        .from("upload_logs")
        .update({
          status: cancelled ? "cancelled" : "error",
          income_payment_id: null,
          error_message: cancelled ? null : ((e as Error).message ?? "Unknown error"),
        } as never)
        .eq("id", uploadLogId);
    }
  }
}

/** Handles a (non-income) email that has no usable attachment, by reading
 *  the payment details straight out of the forwarded email's plain text
 *  body (e.g. a forwarded Wise "Transfer sent" outgoing-payment notification). */
async function extractAndSaveExpenseFromText(
  supabase: ReturnType<typeof getSupabase>,
  subject: string | null,
  emailBodyText: string,
) {
  const logName = subject ?? "(no subject)";

  const { data: logRow, error: logInsertErr } = await supabase
    .from("upload_logs")
    .insert({
      file_name: logName,
      file_size: emailBodyText.length,
      file_mime: "text/plain",
      status: "processing",
      pipeline: "expense",
      source: "email",
    } as never)
    .select()
    .single();
  if (logInsertErr || !logRow) {
    console.error("[email-inbound] Failed to create upload_logs row", logInsertErr);
  }
  const uploadLogId = (logRow as { id?: string } | null)?.id;

  try {
    const { expense, inputTokens, outputTokens, estimatedCostUsd } = await runExtractionPipelineFromText(
      supabase,
      { emailBodyText, emailSubject: subject, uploadLogId },
    );

    if (uploadLogId) {
      await supabase
        .from("upload_logs")
        .update({
          status: "success",
          expense_id: expense.id,
          error_message: null,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: estimatedCostUsd,
        } as never)
        .eq("id", uploadLogId);
    }

    console.log(`[email-inbound] Saved expense ${expense.id} from email body text`);
  } catch (e) {
    const cancelled = e instanceof ExtractionCancelledError;
    if (!cancelled) console.error("[email-inbound] Expense text extraction failed", e);
    if (uploadLogId) {
      await supabase
        .from("upload_logs")
        .update({
          status: cancelled ? "cancelled" : "error",
          expense_id: null,
          error_message: cancelled ? null : ((e as Error).message ?? "Unknown error"),
        } as never)
        .eq("id", uploadLogId);
    }
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

  // 2. Check sender against the allowed_sender_emails table (managed via the Settings page).
  const supabase = getSupabase();
  const sender = (form.get("sender") as string | null)?.toLowerCase().trim() ?? "";

  const { data: allowed, error: allowedErr } = await supabase.from("allowed_sender_emails").select("email");

  if (allowedErr || !allowed || allowed.length === 0) {
    console.error("[email-inbound] Could not load allowed senders — rejecting (fail closed)", allowedErr);
    // Return 200 so Mailgun doesn't retry — we just don't process it
    return new Response("OK", { status: 200 });
  }

  const allowedSenders = new Set(allowed.map((r) => r.email.toLowerCase().trim()));
  if (!allowedSenders.has(sender)) {
    console.log(`[email-inbound] Ignored email from disallowed sender: ${sender}`);

    // TEMP DEBUG: surface disallowed-sender emails in the Upload Logs page so
    // their subject/body can be inspected (e.g. Gmail forwarding verification
    // emails). Remove this block once no longer needed.
    const debugSubject = (form.get("subject") as string | null)?.trim() || "(no subject)";
    const debugBody =
      ((form.get("stripped-text") as string | null) || (form.get("body-plain") as string | null) || "").slice(
        0,
        5000,
      );
    await supabase.from("upload_logs").insert({
      file_name: `[DEBUG] from ${sender}: ${debugSubject}`,
      file_size: null,
      file_mime: null,
      status: "error",
      pipeline: "expense",
      error_message: debugBody || "(no body text found)",
      input_tokens: null,
      output_tokens: null,
      estimated_cost_usd: null,
      source: "email",
    } as never);

    // Return 200 so Mailgun doesn't retry — we just don't process it
    return new Response("OK", { status: 200 });
  }

  // 2b. Grab the subject line — used as a fallback for association matching
  // when the receipt image itself doesn't name the condominium, and to route
  // to the income pipeline when it mentions "income"/"payment".
  const subject = (form.get("subject") as string | null)?.trim() || null;
  const isIncome = !!subject && INCOME_SUBJECT_RE.test(subject);

  // 3. Collect attachment files from the form (Mailgun names them attachment-1, attachment-2, …)
  const attachments: { name: string; mime: string; buffer: Buffer }[] = [];

  for (const [key, value] of form.entries()) {
    if (!key.startsWith("attachment-")) continue;
    if (!(value instanceof File)) continue;

    const mime = value.type || "application/octet-stream";
    if (!ALLOWED_MIME.has(mime)) {
      console.log(
        `[email-inbound] Skipping attachment "${value.name}" with unsupported MIME: ${mime}`,
      );
      continue;
    }

    if (value.size > MAX_BYTES) {
      console.log(
        `[email-inbound] Skipping attachment "${value.name}" — too large (${value.size} bytes)`,
      );
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
    // No attachment — for income emails, fall back to reading the payment
    // details straight out of the forwarded email's plain-text body (e.g. a
    // forwarded Wise "Money received" notification with no screenshot).
    const bodyText =
      (
        (form.get("stripped-text") as string | null) || (form.get("body-plain") as string | null)
      )?.trim() || null;

    if (isIncome && bodyText) {
      console.log("[email-inbound] No attachment — extracting income payment from email body text");
      await extractAndSaveIncomeFromText(supabase, subject, bodyText);
      return new Response("OK", { status: 200 });
    }

    if (bodyText) {
      console.log("[email-inbound] No attachment — extracting expense from email body text");
      await extractAndSaveExpenseFromText(supabase, subject, bodyText);
      return new Response("OK", { status: 200 });
    }

    console.log("[email-inbound] Email had no processable attachments");
    await supabase.from("upload_logs").insert({
      file_name: subject ?? "(no subject)",
      file_size: null,
      file_mime: null,
      status: "error",
      pipeline: isIncome ? "income" : "expense",
      income_payment_id: null,
      error_message: isIncome
        ? "Income email had no attachment and no readable body text to extract payment details from."
        : "Email had no processable attachment — a screenshot or PDF of the receipt/payment must be attached.",
      input_tokens: null,
      output_tokens: null,
      estimated_cost_usd: null,
      source: "email",
    } as never);
    return new Response("OK — no processable attachments", { status: 200 });
  }

  // 4. Process attachments asynchronously (don't block the response).
  // Subject line decides which pipeline: "income"/"payment" in the subject
  // routes to the income pipeline, everything else stays on expenses (the
  // existing default behavior is unchanged).
  Promise.all(
    attachments.map((att) =>
      (isIncome
        ? extractAndSaveIncomeAttachment(supabase, att.name, att.mime, att.buffer)
        : extractAndSaveAttachment(supabase, att.name, att.mime, att.buffer, subject)
      ).catch((err) => console.error(`[email-inbound] Failed to process "${att.name}":`, err)),
    ),
  );

  return new Response("OK", { status: 200 });
}
