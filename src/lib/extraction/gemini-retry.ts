import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Thrown when a user cancels an in-progress Gemini retry via the upload_logs row. */
export class ExtractionCancelledError extends Error {
  constructor() {
    super("Extraction cancelled by user");
    this.name = "ExtractionCancelledError";
  }
}

export const MAX_ATTEMPTS = 3;
export const MAX_DELAY_MS = 30_000;
const CANCEL_POLL_INTERVAL_MS = 2_000;

/** Parses the Gemini quota-error body for the RetryInfo.retryDelay hint (e.g. "22s"). */
export function parseRetryDelaySeconds(errorJson: unknown): number | null {
  const details = (errorJson as { error?: { details?: unknown } })?.error?.details;
  if (!Array.isArray(details)) return null;
  for (const d of details) {
    const entry = d as { "@type"?: string; retryDelay?: string };
    if (entry?.["@type"]?.includes("RetryInfo") && entry.retryDelay) {
      const match = /^(\d+(?:\.\d+)?)s$/.exec(entry.retryDelay);
      if (match) return parseFloat(match[1]);
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sleeps in short slices, checking cancel_requested between each so a user's
 *  cancel click takes effect promptly instead of waiting out the full delay. */
export async function sleepWithCancelCheck(
  ms: number,
  checkCancelled: () => Promise<boolean>,
): Promise<void> {
  let remaining = ms;
  while (remaining > 0) {
    const step = Math.min(CANCEL_POLL_INTERVAL_MS, remaining);
    await sleep(step);
    remaining -= step;
    if (await checkCancelled()) throw new ExtractionCancelledError();
  }
}

/** Builds a cancellation-check function that reads cancel_requested off the
 *  given upload_logs row (or always returns false if either is missing). */
export function makeCancelChecker(
  supabase: SupabaseClient<Database> | undefined,
  uploadLogId: string | undefined,
): () => Promise<boolean> {
  return async () => {
    if (!supabase || !uploadLogId) return false;
    const { data } = await supabase
      .from("upload_logs")
      .select("cancel_requested")
      .eq("id", uploadLogId)
      .single();
    return !!data?.cancel_requested;
  };
}

/** Records a retry attempt (count + next_retry_at) on the upload_logs row, if provided. */
export async function recordRetryAttempt(
  supabase: SupabaseClient<Database> | undefined,
  uploadLogId: string | undefined,
  attempt: number,
  delayMs: number,
): Promise<void> {
  if (!supabase || !uploadLogId) return;
  await supabase
    .from("upload_logs")
    .update({
      retry_count: attempt,
      next_retry_at: new Date(Date.now() + delayMs).toISOString(),
    })
    .eq("id", uploadLogId);
}
