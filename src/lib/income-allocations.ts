/** The slice of an allocation this module needs. Both saved rows and unsaved
 *  drafts satisfy it, so the same maths drives the DB state and the live editor. */
export type AllocationLike = { amount: number | null };

export type AllocationStatus = "unallocated" | "partial" | "allocated";

/** Half a cent. Amounts are NUMERIC(14,2) in Postgres but arrive as JS floats,
 *  so 0.1 + 0.1 + 0.1 must still count as 0.3. */
export const CENT_TOLERANCE = 0.005;

export function allocatedTotal(allocations: readonly AllocationLike[]): number {
  return allocations.reduce((sum, a) => sum + (a.amount ?? 0), 0);
}

export function remainderOf(
  paymentAmount: number | null,
  allocations: readonly AllocationLike[],
): number {
  return (paymentAmount ?? 0) - allocatedTotal(allocations);
}

export function allocationStatus(
  paymentAmount: number | null,
  allocations: readonly AllocationLike[],
): AllocationStatus {
  if (allocations.length === 0) return "unallocated";
  return Math.abs(remainderOf(paymentAmount, allocations)) < CENT_TOLERANCE
    ? "allocated"
    : "partial";
}

/** Payments needing a human: nothing allocated, or the split does not balance. */
export function needsAttention(
  paymentAmount: number | null,
  allocations: readonly AllocationLike[],
): boolean {
  return allocationStatus(paymentAmount, allocations) !== "allocated";
}
