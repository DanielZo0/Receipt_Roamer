/** `2026-09-20` → `20-09-2026`. Returns the input unchanged if it isn't an ISO date. */
export function formatIsoDateDmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}-${m}-${y}` : iso;
}

/** Read-only money display, e.g. `41.78 EUR`. Em dash when there is no amount. */
export function formatMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  return `${amount.toFixed(2)} ${currency ?? ""}`.trim();
}
