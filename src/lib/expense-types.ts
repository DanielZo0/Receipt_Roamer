export type ExpenseRow = {
  id: string;
  association_id: string | null;
  supplier: string | null;
  expense_date: string | null;
  amount: number | null;
  currency: string | null;
  category: string | null;
  reference_number: string | null;
  file_path: string | null;
  file_mime: string | null;
  exported_at: string | null;
  created_at: string;
};

/** The fields edit mode unlocks — also what a Save patch is allowed to contain. */
export const EXPENSE_EDITABLE_FIELDS = [
  "expense_date",
  "supplier",
  "amount",
  "currency",
  "category",
  "reference_number",
  "association_id",
] as const satisfies readonly (keyof ExpenseRow)[];

export type AssociationLite = { id: string; name: string };
