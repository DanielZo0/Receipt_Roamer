import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const DUPLICATE_WINDOW_DAYS = 1;

/**
 * Checks whether an expense that looks like a duplicate of the given one
 * already exists. Two strategies, tried in order:
 *  1. Same reference/invoice number (case-insensitive, trimmed) — a strong
 *     signal regardless of date, since a resent invoice can carry a
 *     different amount or date typo.
 *  2. Same supplier (case-insensitive) and amount within
 *     +/- DUPLICATE_WINDOW_DAYS of the given date.
 * Returns the id of the first match, or null if none found.
 */
export async function findPossibleDuplicate(
  supabase: SupabaseClient<Database>,
  params: {
    supplier: string | null;
    amount: number | null;
    expenseDate: string | null;
    referenceNumber?: string | null;
  },
): Promise<string | null> {
  const { supplier, amount, expenseDate, referenceNumber } = params;

  if (referenceNumber && referenceNumber.trim()) {
    const refLower = referenceNumber.trim().toLowerCase();
    const { data: refMatches } = await supabase
      .from("expenses")
      .select("id, reference_number")
      .ilike("reference_number", referenceNumber.trim());
    const refMatch = (refMatches ?? []).find(
      (e) => e.reference_number?.trim().toLowerCase() === refLower,
    );
    if (refMatch) return refMatch.id;
  }

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
