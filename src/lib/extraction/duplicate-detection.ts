import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const DUPLICATE_WINDOW_DAYS = 1;

/**
 * Checks whether an expense with the same supplier (case-insensitive) and
 * amount already exists within +/- DUPLICATE_WINDOW_DAYS of the given date.
 * Returns the id of the first match, or null if none found.
 */
export async function findPossibleDuplicate(
  supabase: SupabaseClient<Database>,
  params: { supplier: string | null; amount: number | null; expenseDate: string | null },
): Promise<string | null> {
  const { supplier, amount, expenseDate } = params;
  if (!supplier || amount == null || !expenseDate) return null;

  const date = new Date(expenseDate);
  if (isNaN(date.getTime())) return null;

  const from = new Date(date);
  from.setDate(from.getDate() - DUPLICATE_WINDOW_DAYS);
  const to = new Date(date);
  to.setDate(to.getDate() + DUPLICATE_WINDOW_DAYS);

  const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("expenses")
    .select("id, supplier, amount")
    .eq("amount", amount)
    .gte("expense_date", toIsoDate(from))
    .lte("expense_date", toIsoDate(to));

  const supplierLower = supplier.trim().toLowerCase();
  const match = (data ?? []).find((e) => e.supplier?.trim().toLowerCase() === supplierLower);
  return match?.id ?? null;
}
