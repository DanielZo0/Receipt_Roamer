export type PaymentRow = {
  id: string;
  owner_id: string | null;
  condominium_id: string | null;
  payer_name: string | null;
  amount: number | null;
  currency: string | null;
  payment_date: string | null;
  reference_string: string | null;
  match_confidence: number | null;
  match_signals: string[] | null;
  file_path: string | null;
  exported_at: string | null;
  created_at: string;
};

/** The fields edit mode unlocks — also what a Save patch is allowed to contain. */
export const PAYMENT_EDITABLE_FIELDS = [
  "payment_date",
  "payer_name",
  "amount",
  "currency",
  "reference_string",
  "owner_id",
] as const satisfies readonly (keyof PaymentRow)[];
