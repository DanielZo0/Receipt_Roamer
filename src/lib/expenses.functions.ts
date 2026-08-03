import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { runExtractionPipeline } from "@/lib/extraction/pipeline";
import { ExtractionCancelledError } from "@/lib/extraction/gemini";

function getSupabase() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
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
    const supabase = getSupabase();

    const { data: logRow, error: logInsertErr } = await supabase
      .from("upload_logs")
      .insert({
        file_name: data.file_name,
        file_size: data.file_size ?? null,
        file_mime: data.file_mime,
        status: "processing",
      })
      .select()
      .single();
    if (logInsertErr || !logRow) {
      console.error("Failed to create upload_logs row", logInsertErr);
    }
    const uploadLogId = logRow?.id;

    try {
      const { expenses, ledgerGroupId, totalMismatch, inputTokens, outputTokens, estimatedCostUsd } =
        await runExtractionPipeline(supabase, {
          fileName: data.file_name,
          fileMime: data.file_mime,
          fileBase64: data.file_base64,
          filePath: data.file_path,
          fileSize: data.file_size ?? null,
          uploadLogId,
        });

      if (uploadLogId) {
        await supabase
          .from("upload_logs")
          .update({
            status: "success",
            expense_id: expenses[0].id,
            error_message: null,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            estimated_cost_usd: estimatedCostUsd,
          })
          .eq("id", uploadLogId);
      }

      return { expenses, ledgerGroupId, totalMismatch };
    } catch (e) {
      const cancelled = e instanceof ExtractionCancelledError;
      if (!cancelled) console.error("AI extraction failed", e);
      if (uploadLogId) {
        await supabase
          .from("upload_logs")
          .update({
            status: cancelled ? "cancelled" : "error",
            expense_id: null,
            error_message: cancelled ? null : ((e as Error).message ?? "Unknown error"),
          })
          .eq("id", uploadLogId);
      }
      throw new Error(cancelled ? "Extraction cancelled" : `AI extraction failed: ${(e as Error).message}`);
    }
  });