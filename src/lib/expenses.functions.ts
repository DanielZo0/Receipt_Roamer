import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { runExtractionPipeline } from "@/lib/extraction/pipeline";

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

    try {
      const { expense, inputTokens, outputTokens, estimatedCostUsd } = await runExtractionPipeline(
        supabase,
        {
          fileName: data.file_name,
          fileMime: data.file_mime,
          fileBase64: data.file_base64,
          filePath: data.file_path,
          fileSize: data.file_size ?? null,
        },
      );

      await supabase.from("upload_logs").insert({
        file_name: data.file_name,
        file_size: data.file_size ?? null,
        file_mime: data.file_mime,
        status: "success",
        expense_id: expense.id,
        error_message: null,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: estimatedCostUsd,
      });

      return expense;
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
  });