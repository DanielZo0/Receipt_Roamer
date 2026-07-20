import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { runIncomeExtractionPipeline } from "@/lib/extraction/income-pipeline";

function getSupabase() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

export const extractAndSaveIncomePayment = createServerFn({ method: "POST" })
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
      const { payment } = await runIncomeExtractionPipeline(supabase, {
        fileName: data.file_name,
        fileMime: data.file_mime,
        fileBase64: data.file_base64,
        filePath: data.file_path,
      });

      return { payment };
    } catch (e) {
      console.error("Income extraction failed", e);
      throw new Error(`Income extraction failed: ${(e as Error).message}`);
    }
  });
