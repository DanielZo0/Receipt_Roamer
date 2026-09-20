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

/** A saved allocation row. `amount` is nullable because a payment can be
 *  attributed to an owner before its figure is known. */
export type AllocationRow = {
  id: string;
  payment_id: string;
  owner_id: string | null;
  condominium_id: string | null;
  amount: number | null;
  created_at: string;
  updated_at: string;
};

/** An allocation being edited. `key` is a client-side identity for React,
 *  because an unsaved row has no database id yet. */
export type AllocationDraft = {
  key: string;
  owner_id: string | null;
  condominium_id: string | null;
  amount: number | null;
};

export function draftFromRow(row: AllocationRow): AllocationDraft {
  return {
    key: row.id,
    owner_id: row.owner_id,
    condominium_id: row.condominium_id,
    amount: row.amount,
  };
}

export function emptyDraft(): AllocationDraft {
  return { key: crypto.randomUUID(), owner_id: null, condominium_id: null, amount: null };
}
