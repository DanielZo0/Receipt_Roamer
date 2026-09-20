/** The slice of an allocation this module needs. Both saved rows and unsaved
 *  drafts satisfy it, so the same maths drives the DB state and the live editor. */
export type AllocationLike = { amount: number | null };

export type AllocationStatus = "unallocated" | "partial" | "allocated";

/** Half a cent. Amounts are NUMERIC(14,2) in Postgres but arrive as JS floats,
 *  so 0.1 + 0.1 + 0.1 must still count as 0.3. */
export const CENT_TOLERANCE = 0.005;

/** Sums allocation amounts, coercing a null (not-yet-known) slice to 0. */
export function allocatedTotal(allocations: readonly AllocationLike[]): number {
  return allocations.reduce((sum, a) => sum + (a.amount ?? 0), 0);
}

/** Payment amount minus allocated total, coercing a null payment amount to 0 -- what the live editor renders as the amount still to assign. */
export function remainderOf(
  paymentAmount: number | null,
  allocations: readonly AllocationLike[],
): number {
  return (paymentAmount ?? 0) - allocatedTotal(allocations);
}

/** True when the total or any slice is still unknown, so no remainder can be
 *  computed honestly. Callers show "amount unknown" rather than a figure. */
export function hasUnknownAmount(
  paymentAmount: number | null,
  allocations: readonly AllocationLike[],
): boolean {
  return paymentAmount === null || allocations.some((a) => a.amount === null);
}

/** "unallocated" with no rows; otherwise "allocated" only if the total and every slice are known and balance, else "partial" -- an unknown amount is never treated as settled. */
export function allocationStatus(
  paymentAmount: number | null,
  allocations: readonly AllocationLike[],
): AllocationStatus {
  if (allocations.length === 0) return "unallocated";
  // An unknown total or an unknown slice means the split is not settled --
  // without this, remainderOf's null-to-zero coercion makes "nothing is known"
  // look identical to "it balances".
  if (hasUnknownAmount(paymentAmount, allocations)) return "partial";
  return Math.abs(remainderOf(paymentAmount, allocations)) < CENT_TOLERANCE
    ? "allocated"
    : "partial";
}

/** True for the "Needs attention" tab: anything other than a fully-known, balanced allocation. */
export function needsAttention(
  paymentAmount: number | null,
  allocations: readonly AllocationLike[],
): boolean {
  return allocationStatus(paymentAmount, allocations) !== "allocated";
}
