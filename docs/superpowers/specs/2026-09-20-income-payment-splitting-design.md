# Splitting income payments across owners and flats

*2026-09-20*

## Context

A single bank transfer often covers more than one owner's contribution — a landlord paying for several flats, or two owners settling together. Today `income_payments` holds exactly one `owner_id` and one `amount`, so such a payment has to be attributed to one owner, and the per-association totals are wrong by construction.

There is no units/flats table in this schema: a "flat" is the `apartment` text column on an `owners` row. Multiple flats belonging to one person are already multiple `owners` rows. So **allocations keyed on `owner_id` cover both requested cases with one mechanism** — no new concept of a unit is needed.

This spec follows the mobile/edit-toggle work in PR #36, and builds directly on the edit mode that shipped there.

## Decisions taken

| Question | Decision |
|---|---|
| Must allocations balance? | No — a remainder is allowed and surfaced as "partially allocated" |
| Where does splitting live? | Inside the existing Income edit mode; the owner row becomes a list |
| CondoTracker feed shape | One feed item per allocation |
| `owners.contribution_paid` | Receipt Roamer stops writing it; the feed carries allocations and CondoTracker decides |

## The `contribution_paid` finding

`src/lib/condotracker-sync.ts` states its own invariant: *"CondoTracker is the source of truth — this sync never writes back to it."* Its owner upsert includes `contribution_paid = EXCLUDED.contribution_paid`, so every sync overwrites whatever Receipt Roamer put there.

That makes the existing write at `src/lib/extraction/income-pipeline.ts:77-84` a **latent no-op** — it marks an owner paid, and the next sync silently reverts it. This is a pre-existing bug, not something splitting introduces.

**This spec deletes that write** rather than extending it. Coverage is CondoTracker's call to make, and the feed will give it the per-owner amounts it needs to make it.

## Data model

New table, additive only — nothing is dropped or rewritten.

```sql
CREATE TABLE public.income_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.income_payments(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES public.owners(id) ON DELETE SET NULL,
  condominium_id UUID REFERENCES public.associations(id),
  amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Grants, RLS policies and indexes mirror `income_payments` exactly — see `supabase/migrations/20260717000000_owners_and_income.sql:41-48`. Index `payment_id`, `owner_id` and `condominium_id`.

`ON DELETE CASCADE` on `payment_id` is deliberate: allocations have no meaning without their payment, and deleting a payment already removes its file.

### Backfill

```sql
INSERT INTO public.income_payment_allocations (payment_id, owner_id, condominium_id, amount)
SELECT id, owner_id, condominium_id, amount
FROM public.income_payments
WHERE owner_id IS NOT NULL;
```

Payments with no owner get no allocation rows and read as unallocated — which is what they already are. **No existing row is modified or deleted.**

### The legacy columns stay

`income_payments.owner_id` and `.condominium_id` are kept, never dropped. They become a **mirror of the single-allocation case**: set to the sole allocation's owner when there is exactly one, `NULL` when there are zero or many. Every in-app read moves to allocations; the columns remain so nothing outside this codebase breaks and no history is lost.

### Derived status

Computed, not stored:

- `allocated = SUM(allocations.amount)`
- `remainder = payment.amount - allocated`
- `unallocated` — no allocation rows
- `partial` — `|remainder| >= 0.005`
- `allocated` — otherwise

The 0.005 tolerance avoids float noise on a `NUMERIC(14,2)` column. Put this in one place — `src/lib/income-allocations.ts` — and unit-test it; it is the only genuinely tricky logic here, and the repo's test suite is pure-logic, so it fits.

### Atomic writes

Supabase's JS client has no transactions, and a delete-then-insert that fails halfway would leave a payment with *fewer* allocations than the user saw. Add a Postgres function:

```sql
CREATE FUNCTION public.set_payment_allocations(p_payment_id UUID, p_allocations JSONB)
RETURNS void
```

It replaces the payment's allocations and refreshes the legacy mirror columns in one statement. The client calls it via `supabase.rpc(...)`.

## UI

### Income card and row, edit mode

The single `OwnerCombobox` becomes a list of allocation rows, each `[OwnerCombobox] [amount] [remove]`, plus **+ Add owner**. A live footer shows `Unallocated: 120.00 EUR` in amber, or `Fully allocated` in muted green.

Save is **never blocked** by a remainder — that was the explicit decision. The remainder is information, not a gate.

Outside edit mode the card keeps today's behaviour for the common case: one allocation renders as the current directly-usable owner picker, so single-owner matching does not gain a click. Two or more render as a read-only list with a `Split xN` badge.

### Filtering

The existing `All / Unmatched` toggle becomes `All / Needs attention`, where "needs attention" means `unallocated` **or** `partial`. Bulk assign keeps working, replacing all allocations with one covering the full amount.

## Consumers to update

Five, all identified:

| Consumer | File | Change |
|---|---|---|
| Dashboard totals | `src/routes/index.tsx:92` | Group allocations by `condominium_id`; count unallocated separately |
| CondoTracker feed | `src/lib/condotracker-feed.server.ts:89` | One `FeedItem` per allocation |
| CSV export + filter | `src/routes/income.tsx` | One row per allocation; add an `Allocated Amount` column beside `Amount` |
| Ingest auto-match | `src/lib/extraction/income-pipeline.ts:55` | Insert one full-amount allocation on a confident match; **delete the `contribution_paid` write** |
| Owner sync | `src/lib/condotracker-sync.ts` | No change — confirms CondoTracker owns the flag |

### Feed details

`sourceId` must stay unique per item: use the **allocation id**. `amount` is the allocation's amount, `condotrackerOwnerId` that allocation's owner. An unallocated payment still emits one item with a null owner and the full amount, preserving today's behaviour.

**Open risk worth resolving during implementation:** the feed's incremental `since` filter uses `income_payments.created_at`. An allocation edited after the payment was first fed would be missed. Filter on `GREATEST(payment.created_at, allocation.updated_at)` so re-allocations are picked up — this is why the table carries `updated_at`.

## Verification

```bash
npm run test && npm run lint && npx tsc --noEmit && npm run build
```

Note `tsc` reports 2 pre-existing errors in `__root.tsx`; confirm the count is unchanged rather than zero.

Migration, against a copy first:

1. Apply, then assert `COUNT(*)` of allocations equals `COUNT(*)` of payments with a non-null `owner_id`.
2. Assert `SUM(allocations.amount)` equals `SUM(amount)` over those same payments — **totals must not move for any already-matched payment**.
3. Assert no `income_payments` row was modified: row count and `amount` sums unchanged.

Then in the browser at 375px and desktop:

4. Split a payment across two owners; confirm the remainder line updates live and Save persists after a hard reload.
5. Leave a deliberate remainder; confirm it shows as partial and appears under "Needs attention".
6. Confirm a single-owner payment still assigns directly, without entering edit mode.
7. Confirm dashboard per-association totals match a hand-sum of allocations, and that a split payment contributes to two associations correctly.
8. Confirm CSV emits one row per allocation and the amounts sum to the payment total.
9. Re-check `document.documentElement.scrollWidth <= clientWidth` on `/income` at 375px — the allocation rows are new layout.

## Out of scope

- Splitting **expenses** across associations. Same shape, but no one has asked.
- Per-allocation notes or references.
- Auto-suggesting a split from the reference string (e.g. "Flt 09 + Flt 11"). The matcher stays single-owner; worth revisiting once real split data exists.
