# Stop treating income_payments.owner_id / condominium_id as one thing

*2026-09-21*

## Context

Splitting income payments across owners shipped in #37. It kept `income_payments.owner_id` and `.condominium_id` and described both as a **mirror of the single-allocation case** — set when a payment has exactly one allocation, NULL when it has zero or many.

That description was wrong about one of them, and the error is now live.

Four separate bugs during #37 came from code reading these columns as if they answered "is this payment matched?" — the filter tab, the amber row background, the confidence badge and the condo label. Each was fixed individually. This spec removes the cause rather than the symptoms.

## The bug

`matchOwner` in `src/lib/extraction/owner-matching.ts` has three return paths. Only the first sets an owner:

| Path | `owner_id` | `condominium_id` |
|---|---|---|
| Confident match (line ~150) | the owner | that owner's association |
| Low-confidence candidate (line ~164) | **null** | **the matched association** |
| No candidate at all (line ~178) | **null** | **the matched association** |

So a payment can legitimately know its association without knowing its owner. `condominium_id` is not a mirror of anything — it is the AI's association-level match, and it is the only place that information exists.

`set_payment_allocations` does not know this. Its final statement is:

```sql
  UPDATE public.income_payments
  SET owner_id = v_owner, condominium_id = v_condo, allocations_updated_at = now()
  WHERE id = p_payment_id;
```

with `v_condo := NULL` whenever the payment has zero or several allocations.

**Reproduction:** ingest a payment the AI matches to an association but not to an owner. `condominium_id` is set, `owner_id` is null. Assign an owner from the Income page, then clear it. The RPC runs twice; the second run writes `condominium_id = NULL`. The association match is gone, unrecoverably — nothing else records it.

This also degrades the outbound feed. Its unallocated branch reads `p.condominium_id` to resolve `condotracker_condominium_id`, so a payment that lost its match is now sent to CondoTracker with no association at all.

## The distinction to draw

| Column | What it actually is | Who may write it |
|---|---|---|
| `owner_id` | A true mirror of the single-allocation case. Every in-app read was removed during #37; it is retained only so anything outside this codebase keeps working. | The RPC, as today |
| `condominium_id` | The AI's association-level match, recorded once at ingest. Independent of allocations, and meaningful precisely when there is no owner. | **Ingest only. Never the RPC.** |

## Changes

### 1. The RPC stops writing `condominium_id`

```sql
  UPDATE public.income_payments
  SET owner_id = v_owner, allocations_updated_at = now()
  WHERE id = p_payment_id;
```

`v_condo` and its `SELECT ... INTO` become unnecessary; drop them. A new migration with `CREATE OR REPLACE FUNCTION`, not an edit to the applied one.

Allocations already carry their own `condominium_id`, derived from the owner inside the same function, so nothing that needs per-slice association loses anything.

### 2. Backfill what the existing data lost

Any payment whose `condominium_id` was nulled by a clear-then-reassign cycle can be partly recovered from its allocations, which kept theirs:

```sql
UPDATE public.income_payments p
SET condominium_id = a.condominium_id
FROM (
  SELECT DISTINCT ON (payment_id) payment_id, condominium_id
  FROM public.income_payment_allocations
  WHERE condominium_id IS NOT NULL
  ORDER BY payment_id, created_at
) a
WHERE a.payment_id = p.id AND p.condominium_id IS NULL;
```

This cannot recover a payment that never had an allocation — that information is already gone. Given the current data is 3 payments each with one allocation, the practical exposure is nil; the backfill exists so the fix is complete rather than forward-only.

### 3. Rename `condominium_id` to say what it means

`ALTER TABLE ... RENAME COLUMN condominium_id TO matched_condominium_id`. A rename, never a drop — the standing project rule.

This is what stops the confusion recurring. Four bugs came from the name implying "the association this money belongs to", which is what allocations answer. The new name says "what the matcher thought", which is what it is.

Touches `src/integrations/supabase/types.ts`, `scripts/expected-schema.ts`, the feed view's unallocated branch, `income-pipeline.ts`, and the `preferredCondominiumId` fallbacks in the two card components.

### 4. Stop reading `owner_id` entirely

Only two references remain and both are comments explaining why the column is unusable. Once the rename lands, delete them — the name no longer invites the mistake. `PaymentRow` keeps both fields so the types still describe the table.

## What is deliberately not changing

- **Neither column is dropped.** The no-data-loss rule holds; `owner_id` stays as a mirror for anything outside this codebase.
- **The feed contract is untouched.** `source_group_id` and supersede-by-group stay exactly as agreed with CondoTracker.
- **No change to the allocations table or the editor.**

## Verification

```bash
npm run db:apply -- --dry-run <the two new migrations>
npm run test && npx tsc --noEmit && npm run build
npm run db:check
```

Then against the database:

1. `SELECT count(*) FROM income_payments WHERE matched_condominium_id IS NULL` — compare before and after the backfill; it must not increase.
2. Assign an owner to a payment, clear it, and confirm `matched_condominium_id` is unchanged throughout. This is the bug; it must not reproduce.
3. `SELECT count(DISTINCT source_group_id) FROM condotracker_income_feed` still equals the payment count.
4. Confirm the feed still resolves `condotracker_condominium_id` for an unallocated payment.
