# Income Payment Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one income payment be split across several owners (and therefore several flats), with per-association totals, CSV export and the CondoTracker feed all reporting the split correctly.

**Architecture:** A new `income_payment_allocations` table holds one row per owner slice. `income_payments.owner_id`/`condominium_id` are kept as a mirror of the single-allocation case so nothing outside this codebase breaks. Allocation writes go through one Postgres function for atomicity, and the CondoTracker feed reads a view that unions allocated and unallocated payments under a single sortable timestamp.

**Tech Stack:** Supabase/Postgres, TanStack Start + React, react-query, vitest (pure-logic tests only — this repo has no component tests).

**Spec:** `docs/superpowers/specs/2026-09-20-income-payment-splitting-design.md`

---

## Read this before Task 10

The CondoTracker feed dedupes on `(source_system, source_id)`. Today an income item's `source_id` is the **payment id**. If allocations naively became the source id, every already-matched payment would re-send under a fresh id and **duplicate in CondoTracker**.

This plan therefore uses:

- exactly one allocation → `source_id = payment.id` (unchanged from history, no duplicates on migration)
- two or more → `source_id = payment.id || ':' || allocation.id`

**Residual case needing CondoTracker's side to agree:** when a payment goes from one allocation to two, the original `payment.id` item already sent to CondoTracker becomes stale, and two new `payment.id:alloc.id` items arrive. CondoTracker must either treat a `payment.id:*` item as superseding the bare `payment.id` item, or tolerate the stale row. **Confirm this before deploying Task 10.** Tasks 1–9 and 11 are safe to ship without it.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260920000000_income_payment_allocations.sql` | Create table, RLS, indexes, backfill |
| `supabase/migrations/20260920000001_set_payment_allocations.sql` | Atomic write function + legacy mirror refresh |
| `supabase/migrations/20260920000002_condotracker_income_feed.sql` | Feed view unioning allocated + unallocated |
| `src/lib/income-allocations.ts` | Pure allocation maths and status derivation |
| `src/lib/income-allocations.test.ts` | Unit tests for the above |
| `src/lib/income-types.ts` | Add `AllocationRow`, `AllocationDraft` |
| `src/components/income/allocation-editor.tsx` | The owner+amount row list used in edit mode |
| `src/routes/income.tsx` | Allocations query, save via RPC, filter, CSV |
| `src/components/income/payment-mobile-card.tsx` | Swap owner picker for the editor |
| `src/components/income/payment-table-row.tsx` | Same, desktop |
| `src/routes/index.tsx` | Dashboard totals from allocations |
| `src/lib/condotracker-feed.server.ts` | Read the feed view |
| `src/lib/extraction/income-pipeline.ts` | Insert an allocation; delete the `contribution_paid` write |

---

## Task 1: Allocations table and backfill

**Files:**
- Create: `supabase/migrations/20260920000000_income_payment_allocations.sql`

- [ ] **Step 1: Write the migration**

Mirrors the grants/RLS/index shape of `supabase/migrations/20260717000000_owners_and_income.sql:41-48`.

```sql
CREATE TABLE public.income_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.income_payments(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES public.owners(id) ON DELETE SET NULL,
  condominium_id UUID REFERENCES public.associations(id),
  -- Nullable on purpose: a payment can be attributed to an owner before its
  -- amount is known (extraction can fail to read the figure). Forcing 0 here
  -- would make "unknown" indistinguishable from a genuine zero in totals.
  amount NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.income_payment_allocations TO anon, authenticated;
ALTER TABLE public.income_payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read income_payment_allocations"
  ON public.income_payment_allocations FOR SELECT USING (true);
CREATE POLICY "Public insert income_payment_allocations"
  ON public.income_payment_allocations FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update income_payment_allocations"
  ON public.income_payment_allocations FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete income_payment_allocations"
  ON public.income_payment_allocations FOR DELETE USING (true);

CREATE INDEX income_payment_allocations_payment_idx
  ON public.income_payment_allocations(payment_id);
CREATE INDEX income_payment_allocations_owner_idx
  ON public.income_payment_allocations(owner_id);
CREATE INDEX income_payment_allocations_condominium_idx
  ON public.income_payment_allocations(condominium_id);
CREATE INDEX income_payment_allocations_updated_idx
  ON public.income_payment_allocations(updated_at);

-- Backfill: one allocation per already-matched payment. Additive only --
-- no existing income_payments row is read-modified or deleted.
INSERT INTO public.income_payment_allocations (payment_id, owner_id, condominium_id, amount)
SELECT id, owner_id, condominium_id, amount
FROM public.income_payments
WHERE owner_id IS NOT NULL;
```

Also add the `updated_at` trigger. The outbound feed pages incrementally on `updated_at`, so a row changed by a plain `UPDATE` without advancing it would never be sent — silently, and permanently. Enforce it in the schema rather than trusting every future writer:

```sql
CREATE FUNCTION public.touch_income_payment_allocations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER income_payment_allocations_set_updated_at
  BEFORE UPDATE ON public.income_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.touch_income_payment_allocations_updated_at();
```

Do **not** add a unique index on `(payment_id, owner_id)`. Two allocation lines for the same owner under one payment is legitimate (two separate charges), and a hard database error is the wrong way to surface a UI mistake.

- [ ] **Step 2: Apply against a copy of the database first**

Never run this against production before the assertions below pass on a copy.

- [ ] **Step 3: Assert the backfill did not move any money**

Run each; all three must return `t`.

```sql
-- same number of allocations as matched payments
SELECT (SELECT count(*) FROM public.income_payment_allocations)
     = (SELECT count(*) FROM public.income_payments WHERE owner_id IS NOT NULL) AS ok;

-- same total value
SELECT COALESCE((SELECT sum(amount) FROM public.income_payment_allocations), 0)
     = COALESCE((SELECT sum(amount) FROM public.income_payments WHERE owner_id IS NOT NULL), 0) AS ok;

-- every allocation points at the owner its payment already had
SELECT NOT EXISTS (
  SELECT 1 FROM public.income_payment_allocations a
  JOIN public.income_payments p ON p.id = a.payment_id
  WHERE a.owner_id IS DISTINCT FROM p.owner_id
) AS ok;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260920000000_income_payment_allocations.sql
git commit -m "feat: add income_payment_allocations table and backfill"
```

---

## Task 2: Allocation maths (TDD)

**Files:**
- Create: `src/lib/income-allocations.ts`
- Test: `src/lib/income-allocations.test.ts`

This is the only genuinely tricky logic in the feature, and it is pure — exactly what this repo's test suite covers.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { allocationStatus, allocatedTotal, remainderOf } from "./income-allocations";

const alloc = (amount: number) => ({ amount });

describe("allocatedTotal", () => {
  it("is 0 for no allocations", () => {
    expect(allocatedTotal([])).toBe(0);
  });

  it("sums allocation amounts", () => {
    expect(allocatedTotal([alloc(100), alloc(50.5)])).toBe(150.5);
  });

  it("treats a null amount as 0", () => {
    expect(allocatedTotal([{ amount: null }])).toBe(0);
  });
});

describe("remainderOf", () => {
  it("is the payment amount when nothing is allocated", () => {
    expect(remainderOf(550, [])).toBe(550);
  });

  it("is 0 when fully allocated", () => {
    expect(remainderOf(550, [alloc(300), alloc(250)])).toBe(0);
  });

  it("is negative when over-allocated", () => {
    expect(remainderOf(100, [alloc(150)])).toBe(-50);
  });

  it("treats a null payment amount as 0", () => {
    expect(remainderOf(null, [alloc(10)])).toBe(-10);
  });
});

describe("allocationStatus", () => {
  it("is 'unallocated' with no allocation rows", () => {
    expect(allocationStatus(550, [])).toBe("unallocated");
  });

  it("is 'allocated' when the remainder is zero", () => {
    expect(allocationStatus(550, [alloc(300), alloc(250)])).toBe("allocated");
  });

  it("is 'partial' when money is left over", () => {
    expect(allocationStatus(550, [alloc(300)])).toBe("partial");
  });

  it("is 'partial' when over-allocated", () => {
    expect(allocationStatus(550, [alloc(600)])).toBe("partial");
  });

  it("tolerates sub-cent float noise", () => {
    expect(allocationStatus(0.3, [alloc(0.1), alloc(0.1), alloc(0.1)])).toBe("allocated");
  });

  it("does not tolerate a whole cent", () => {
    expect(allocationStatus(550, [alloc(549.99)])).toBe("partial");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/income-allocations.test.ts`
Expected: FAIL — `Failed to resolve import "./income-allocations"`.

- [ ] **Step 3: Write the implementation**

```ts
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
  // An unknown total or an unknown slice means the split is not settled --
  // without this, remainderOf's null-to-zero coercion makes "nothing is known"
  // look identical to "it balances".
  if (hasUnknownAmount(paymentAmount, allocations)) return "partial";
  return Math.abs(remainderOf(paymentAmount, allocations)) < CENT_TOLERANCE
    ? "allocated"
    : "partial";
}

/** True when the total or any slice is still unknown, so no remainder can be
 *  computed honestly. Callers show "amount unknown" rather than a figure. */
export function hasUnknownAmount(
  paymentAmount: number | null,
  allocations: readonly AllocationLike[],
): boolean {
  return paymentAmount === null || allocations.some((a) => a.amount === null);
}

/** Payments needing a human: nothing allocated, or the split does not balance. */
export function needsAttention(
  paymentAmount: number | null,
  allocations: readonly AllocationLike[],
): boolean {
  return allocationStatus(paymentAmount, allocations) !== "allocated";
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/income-allocations.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/income-allocations.ts src/lib/income-allocations.test.ts
git commit -m "feat: add allocation total, remainder and status helpers"
```

---

## Task 3: Atomic allocation writes

**Files:**
- Create: `supabase/migrations/20260920000001_set_payment_allocations.sql`

The Supabase JS client has no transactions. A delete-then-insert that fails halfway would leave a payment with fewer allocations than the user saw on screen.

- [ ] **Step 1: Write the function**

```sql
-- Replaces a payment's allocations and refreshes the legacy mirror columns in
-- one statement. p_allocations is a JSON array of
--   { "owner_id": uuid|null, "condominium_id": uuid|null, "amount": numeric }
CREATE OR REPLACE FUNCTION public.set_payment_allocations(
  p_payment_id UUID,
  p_allocations JSONB
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_count INT;
  v_owner UUID;
  v_condo UUID;
BEGIN
  -- A missing payment must not look like a successful no-op -- that is the
  -- exact failure this function exists to prevent for allocation writes.
  IF NOT EXISTS (SELECT 1 FROM public.income_payments WHERE id = p_payment_id) THEN
    RAISE EXCEPTION 'income_payments row % not found', p_payment_id;
  END IF;

  DELETE FROM public.income_payment_allocations WHERE payment_id = p_payment_id;

  -- condominium_id is derived from the owner rather than trusted from the
  -- caller: an allocation pointing at a condominium its owner does not belong
  -- to would silently misattribute money between associations.
  INSERT INTO public.income_payment_allocations (payment_id, owner_id, condominium_id, amount)
  SELECT
    p_payment_id,
    parsed.owner_id,
    CASE WHEN parsed.owner_id IS NOT NULL THEN o.condominium_id ELSE parsed.condominium_id END,
    parsed.amount
  FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) AS a
  CROSS JOIN LATERAL (
    SELECT
      NULLIF(a->>'owner_id', '')::UUID AS owner_id,
      NULLIF(a->>'condominium_id', '')::UUID AS condominium_id,
      NULLIF(a->>'amount', '')::NUMERIC AS amount
  ) AS parsed
  LEFT JOIN public.owners o ON o.id = parsed.owner_id;

  -- Legacy mirror: populated only when there is exactly one allocation, so
  -- readers that still use income_payments.owner_id stay correct for the
  -- single-owner case and see NULL rather than a misleading owner for a split.
  SELECT count(*) INTO v_count
  FROM public.income_payment_allocations WHERE payment_id = p_payment_id;

  IF v_count = 1 THEN
    SELECT owner_id, condominium_id INTO STRICT v_owner, v_condo
    FROM public.income_payment_allocations WHERE payment_id = p_payment_id;
  ELSE
    v_owner := NULL;
    v_condo := NULL;
  END IF;

  UPDATE public.income_payments
  SET owner_id = v_owner, condominium_id = v_condo
  WHERE id = p_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_payment_allocations(UUID, JSONB) TO anon, authenticated;
```

- [ ] **Step 2: Verify against a copy**

```sql
-- pick any payment id, split it, confirm the mirror goes NULL
SELECT public.set_payment_allocations(
  '<payment-uuid>',
  '[{"owner_id":"<owner-a>","condominium_id":"<condo>","amount":300},
    {"owner_id":"<owner-b>","condominium_id":"<condo>","amount":250}]'::jsonb
);
SELECT owner_id IS NULL AS mirror_cleared FROM public.income_payments WHERE id = '<payment-uuid>';
SELECT count(*) = 2 AS two_allocations FROM public.income_payment_allocations WHERE payment_id = '<payment-uuid>';

-- collapse back to one, confirm the mirror repopulates
SELECT public.set_payment_allocations(
  '<payment-uuid>',
  '[{"owner_id":"<owner-a>","condominium_id":"<condo>","amount":550}]'::jsonb
);
SELECT owner_id = '<owner-a>' AS mirror_restored FROM public.income_payments WHERE id = '<payment-uuid>';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260920000001_set_payment_allocations.sql
git commit -m "feat: add set_payment_allocations for atomic allocation writes"
```

---

## Task 4: Types

**Files:**
- Modify: `src/lib/income-types.ts`
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Add the allocation types**

Append to `src/lib/income-types.ts`:

```ts
/** A saved allocation row. */
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
```

- [ ] **Step 2: Add the table to the generated Supabase types**

Add this entry to `Tables` in `src/integrations/supabase/types.ts`, directly after the `income_payments` block (which ends around line 270):

```ts
      income_payment_allocations: {
        Row: {
          id: string;
          payment_id: string;
          owner_id: string | null;
          condominium_id: string | null;
          amount: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          payment_id: string;
          owner_id?: string | null;
          condominium_id?: string | null;
          amount?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          payment_id?: string;
          owner_id?: string | null;
          condominium_id?: string | null;
          amount?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "income_payment_allocations_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "income_payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "income_payment_allocations_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "owners";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "income_payment_allocations_condominium_id_fkey";
            columns: ["condominium_id"];
            isOneToOne: false;
            referencedRelation: "associations";
            referencedColumns: ["id"];
          },
        ];
      };
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exactly 2 errors, both in `src/routes/__root.tsx`. These are pre-existing — confirm the count is unchanged, not zero.

- [ ] **Step 4: Commit**

```bash
git add src/lib/income-types.ts src/integrations/supabase/types.ts
git commit -m "feat: add allocation row and draft types"
```

---

## Task 5: Allocation editor component

**Files:**
- Create: `src/components/income/allocation-editor.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OwnerCombobox, type AssociationLite, type OwnerLite } from "@/components/OwnerCombobox";
import { allocationStatus, remainderOf } from "@/lib/income-allocations";
import { type AllocationDraft, emptyDraft } from "@/lib/income-types";
import { formatMoney } from "@/lib/format";
import { Plus, X } from "lucide-react";

export function AllocationEditor({
  allocations,
  onChange,
  owners,
  associations,
  paymentAmount,
  currency,
  preferredCondominiumId,
}: {
  allocations: AllocationDraft[];
  onChange: (next: AllocationDraft[]) => void;
  owners: OwnerLite[];
  associations: AssociationLite[];
  paymentAmount: number | null;
  currency: string | null;
  preferredCondominiumId: string | null;
}) {
  const remainder = remainderOf(paymentAmount, allocations);
  const status = allocationStatus(paymentAmount, allocations);

  function update(key: string, patch: Partial<AllocationDraft>) {
    onChange(allocations.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  }

  return (
    <div className="space-y-2">
      {allocations.map((a) => (
        <div key={a.key} className="flex items-center gap-1">
          <OwnerCombobox
            owners={owners}
            associations={associations}
            value={a.owner_id}
            onChange={(ownerId) =>
              update(a.key, {
                owner_id: ownerId,
                condominium_id: owners.find((o) => o.id === ownerId)?.condominium_id ?? null,
              })
            }
            preferredCondominiumId={preferredCondominiumId}
            className="flex-1 min-w-0"
          />
          <AllocationAmountInput
            amount={a.amount}
            label={rowLabel}
            onCommit={(amount) => update(a.key, { amount })}
          />
          <Button
            size="icon"
            variant="ghost"
            className="flex-shrink-0"
            title="Remove"
            onClick={() => onChange(allocations.filter((x) => x.key !== a.key))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...allocations, emptyDraft()])}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add owner
        </Button>

        {allocations.length > 0 && (
          <span
            className={`text-xs ${status === "allocated" ? "text-muted-foreground" : "text-amber-600"}`}
          >
            {status === "allocated"
              ? "Fully allocated"
              : hasUnknownAmount(paymentAmount, allocations)
                ? "Amount unknown"
                : `Unallocated: ${formatMoney(remainder, currency)}`}
          </span>
        )}
      </div>
    </div>
  );
}
```

Note `min-w-0` on the combobox and `flex-shrink-0` on the amount and remove button — without them this row reintroduces exactly the overflow bug fixed in PR #36. (Verified: `cn` is `twMerge`, and because `className` is merged last, `min-w-0` beats `OwnerCombobox`'s own `min-w-44`. Without that, the row's minimum would be ~318px against ~318px available — a hairline failure.)

**The amount field must buffer its own text.** A controlled `type="number"` bound straight to a `number` cannot hold an in-progress `"12."` or `"-"`: the decimal point is erased as fast as it is typed, and `Number("-")` commits `NaN`, which `?? 0` does not guard, poisoning the whole split's remainder. Add this sub-component in the same file and give each row a distinct accessible name:

```tsx
function AllocationAmountInput({
  amount,
  label,
  onCommit,
}: {
  amount: number | null;
  label: string;
  onCommit: (amount: number | null) => void;
}) {
  const [text, setText] = useState(amount === null ? "" : String(amount));

  // Resync only when the numeric value genuinely changes elsewhere. A no-op
  // parse like Number("12.") === 12 leaves `amount` equal, so this does not
  // fire and the user's in-progress text survives.
  useEffect(() => {
    setText(amount === null ? "" : String(amount));
  }, [amount]);

  return (
    <Input
      type="number"
      step="0.01"
      value={text}
      onChange={(ev) => {
        const raw = ev.target.value;
        setText(raw);
        if (raw === "") {
          onCommit(null);
          return;
        }
        const parsed = Number(raw);
        if (!Number.isNaN(parsed)) onCommit(parsed);
      }}
      className="w-24 flex-shrink-0"
      aria-label={label}
    />
  );
}
```

Every button in this component needs `type="button"` — this codebase's `Button` does not default it, so inside a form they would submit.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 2 pre-existing `__root.tsx` errors only.

- [ ] **Step 3: Commit**

```bash
git add src/components/income/allocation-editor.tsx
git commit -m "feat: add allocation editor row list"
```

---

## Task 6: Wire allocations into the Income page

**Files:**
- Modify: `src/routes/income.tsx`

- [ ] **Step 1: Add the allocations query**

Beside the existing `income_payments` query (around line 154):

```ts
const { data: allocations } = useQuery({
  queryKey: ["income_payment_allocations"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("income_payment_allocations")
      .select("*")
      .order("created_at");
    if (error) throw error;
    return data as AllocationRow[];
  },
});

const allocationsByPayment = useMemo(() => {
  const map = new Map<string, AllocationRow[]>();
  for (const a of allocations ?? []) {
    if (!map.has(a.payment_id)) map.set(a.payment_id, []);
    map.get(a.payment_id)!.push(a);
  }
  return map;
}, [allocations]);
```

- [ ] **Step 2: Hold allocation drafts alongside the field draft**

`useRowEditor` covers scalar fields only, so allocations get their own state next to it:

```ts
const [allocationDraft, setAllocationDraft] = useState<AllocationDraft[]>([]);

function startEdit(p: PaymentRow) {
  editor.start(p, PAYMENT_EDITABLE_FIELDS);
  setAllocationDraft((allocationsByPayment.get(p.id) ?? []).map(draftFromRow));
}

function cancelEdit() {
  editor.cancel();
  setAllocationDraft([]);
}
```

Replace the `onEdit` / `onCancel` entries in `paymentProps` with `startEdit(p)` / `cancelEdit`.

- [ ] **Step 3: Save fields and allocations together**

Replace `saveRow`:

```ts
const saveAllocations = useMutation({
  mutationFn: async ({ payment, fields, allocations }: {
    payment: PaymentRow;
    fields: Partial<PaymentRow>;
    allocations: AllocationDraft[];
  }) => {
    const scalarFields = { ...fields };
    delete scalarFields.owner_id;       // owner now lives in allocations
    delete scalarFields.condominium_id; // and the mirror is set by the RPC

    if (Object.keys(scalarFields).length > 0) {
      const { error } = await supabase
        .from("income_payments")
        .update(scalarFields)
        .eq("id", payment.id);
      if (error) throw error;
    }

    const { error: rpcError } = await supabase.rpc("set_payment_allocations", {
      p_payment_id: payment.id,
      p_allocations: allocations
        .filter((a) => a.owner_id !== null || a.amount !== null)
        .map((a) => ({
          owner_id: a.owner_id,
          condominium_id: a.condominium_id,
          amount: a.amount,
        })),
    });
    if (rpcError) throw rpcError;
  },
  onSuccess: () => {
    cancelEdit();
    qc.invalidateQueries({ queryKey: ["income_payments"] });
    qc.invalidateQueries({ queryKey: ["income_payment_allocations"] });
  },
  onError: (e: Error) => toast.error(e.message),
});

function saveRow(p: PaymentRow) {
  saveAllocations.mutate({ payment: p, fields: editor.draft, allocations: allocationDraft });
}
```

- [ ] **Step 4: Keep direct owner assignment working outside edit mode**

`onAssignOwner` must now write an allocation, not a column:

```ts
const assignOwner = useMutation({
  mutationFn: async ({ payment, ownerId }: { payment: PaymentRow; ownerId: string | null }) => {
    const owner = ownerId ? owners?.find((o) => o.id === ownerId) : undefined;
    const { error } = await supabase.rpc("set_payment_allocations", {
      p_payment_id: payment.id,
      p_allocations: ownerId
        ? [{
            owner_id: ownerId,
            condominium_id: owner?.condominium_id ?? null,
            amount: payment.amount,
          }]
        : [],
    });
    if (error) throw error;
  },
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ["income_payments"] });
    qc.invalidateQueries({ queryKey: ["income_payment_allocations"] });
  },
  onError: (e: Error) => toast.error(e.message),
});
```

Apply the same change to `bulkAssign`: loop the selected ids through the RPC rather than a single `.in()` update.

- [ ] **Step 5: Pass allocations through `paymentProps`**

Add to the object returned by `paymentProps`:

```ts
allocations: allocationsByPayment.get(p.id) ?? [],
allocationDraft,
onAllocationChange: setAllocationDraft,
ownerName,
```

`ownerName` is the existing helper at `src/routes/income.tsx:167`. The card components have no access to the owners list, so the lookup is passed in.

Add the imports this task needs at the top of the file:

```ts
import { type AllocationDraft, type AllocationRow, draftFromRow } from "@/lib/income-types";
import { needsAttention } from "@/lib/income-allocations";
```

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: 2 pre-existing `__root.tsx` errors only.

```bash
git add src/routes/income.tsx
git commit -m "feat: read and write income allocations from the Income page"
```

---

## Task 7: Render allocations in the card and row

**Files:**
- Modify: `src/components/income/payment-mobile-card.tsx`
- Modify: `src/components/income/payment-table-row.tsx`

- [ ] **Step 1: Extend `PaymentRowProps`**

```ts
allocations: AllocationRow[];
allocationDraft: AllocationDraft[];
onAllocationChange: (next: AllocationDraft[]) => void;
```

- [ ] **Step 2: Read mode — one allocation behaves exactly as today**

Replace the read-mode `OwnerCombobox` block in `payment-mobile-card.tsx` with:

```tsx
{allocations.length <= 1 ? (
  // The common case keeps a directly-usable picker: assigning an owner is this
  // page's main job and must not gain a click.
  <OwnerCombobox
    owners={owners}
    associations={associations}
    value={allocations[0]?.owner_id ?? null}
    onChange={onAssignOwner}
    preferredCondominiumId={p.condominium_id}
    className="w-full"
  />
) : (
  <div className="space-y-1">
    <div className="flex items-center justify-between gap-2">
      <MobileCardLabel>Split</MobileCardLabel>
      <Badge variant="outline" className="flex-shrink-0">
        {allocations.length} owners
      </Badge>
    </div>
    {allocations.map((a) => (
      <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">{ownerName(a.owner_id)}</span>
        <span className="flex-shrink-0 font-mono">{formatMoney(a.amount, p.currency)}</span>
      </div>
    ))}
  </div>
)}
```

`ownerName` must be passed in as a prop (the card has no access to the owners lookup used in `income.tsx`); add `ownerName: (id: string | null) => string` to `PaymentRowProps` and supply it from `paymentProps`.

- [ ] **Step 3: Show a partial-allocation warning in read mode**

Directly under the block above:

```tsx
{needsAttention(p.amount, allocations) && allocations.length > 0 && (
  <p className="text-xs text-amber-600">
    Unallocated: {formatMoney(remainderOf(p.amount, allocations), p.currency)}
  </p>
)}
```

- [ ] **Step 4: Edit mode — swap the picker for the editor**

Replace the edit-mode Owner block with:

```tsx
<div>
  <MobileCardLabel>Owners</MobileCardLabel>
  <div className="mt-1">
    <AllocationEditor
      allocations={allocationDraft}
      onChange={onAllocationChange}
      owners={owners}
      associations={associations}
      paymentAmount={draft.amount ?? p.amount}
      currency={draft.currency ?? p.currency}
      preferredCondominiumId={p.condominium_id}
    />
  </div>
</div>
```

Note `paymentAmount` reads the **draft** amount first, so editing the payment total updates the remainder live.

- [ ] **Step 5: Apply the same two modes to `payment-table-row.tsx`**

Replace the Owner `TableCell` body in `payment-table-row.tsx` with:

```tsx
<TableCell className="min-w-64">
  {isEditing ? (
    <AllocationEditor
      allocations={allocationDraft}
      onChange={onAllocationChange}
      owners={owners}
      associations={associations}
      paymentAmount={draft.amount ?? p.amount}
      currency={draft.currency ?? p.currency}
      preferredCondominiumId={p.condominium_id}
    />
  ) : allocations.length <= 1 ? (
    <OwnerCombobox
      owners={owners}
      associations={associations}
      value={allocations[0]?.owner_id ?? null}
      onChange={onAssignOwner}
      preferredCondominiumId={p.condominium_id}
    />
  ) : (
    <div className="space-y-0.5">
      {allocations.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">{ownerName(a.owner_id)}</span>
          <span className="flex-shrink-0 font-mono">{formatMoney(a.amount, p.currency)}</span>
        </div>
      ))}
      {needsAttention(p.amount, allocations) && (
        <span className="text-xs text-amber-600">
          Unallocated: {formatMoney(remainderOf(p.amount, allocations), p.currency)}
        </span>
      )}
    </div>
  )}
</TableCell>
```

`paymentAmount` reads `draft.amount` before `p.amount` here too — the same single source of truth as the mobile card, so the remainder agrees across both viewports.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add src/components/income/payment-mobile-card.tsx src/components/income/payment-table-row.tsx
git commit -m "feat: render splits in the income card and table row"
```

---

## Task 8: Filter and CSV export

**Files:**
- Modify: `src/routes/income.tsx`

- [ ] **Step 1: Replace the unmatched filter**

```ts
const filteredPayments = useMemo(
  () =>
    (payments ?? []).filter(
      (p) =>
        !showUnmatchedOnly ||
        needsAttention(p.amount, allocationsByPayment.get(p.id) ?? []),
    ),
  [payments, showUnmatchedOnly, allocationsByPayment],
);
```

Relabel the toggle buttons from `All` / `Unmatched` to `All` / `Needs attention`, and change the count to:

```ts
payments?.filter((p) => needsAttention(p.amount, allocationsByPayment.get(p.id) ?? [])).length ?? 0
```

- [ ] **Step 2: One CSV row per allocation**

```ts
const headers = [
  "Date", "Payer", "Payment Amount", "Allocated Amount",
  "Currency", "Reference", "Condo", "Owner",
];
const rows = toExport.flatMap((p) => {
  const allocs = allocationsByPayment.get(p.id) ?? [];
  if (allocs.length === 0) {
    return [[
      p.payment_date ? formatIsoDateDmy(p.payment_date) : "",
      p.payer_name ?? "",
      p.amount?.toString() ?? "",
      "",
      p.currency ?? "",
      p.reference_string ?? "",
      condoName(p.condominium_id),
      "",
    ]];
  }
  return allocs.map((a) => [
    p.payment_date ? formatIsoDateDmy(p.payment_date) : "",
    p.payer_name ?? "",
    p.amount?.toString() ?? "",
    a.amount?.toString() ?? "",
    p.currency ?? "",
    p.reference_string ?? "",
    condoName(a.condominium_id),
    ownerName(a.owner_id),
  ]);
});
```

A split payment now occupies several rows that repeat the payment total — summing `Allocated Amount` gives the true per-association figure, and summing `Payment Amount` would double-count. Keep the column names distinct for exactly that reason.

- [ ] **Step 3: Verify manually**

Export with a split payment present. Confirm it produces N rows, that `Allocated Amount` sums to `Payment Amount`, and that each row names the right condo.

- [ ] **Step 4: Commit**

```bash
git add src/routes/income.tsx
git commit -m "feat: filter on allocation status and export one CSV row per allocation"
```

---

## Task 9: Dashboard totals

**Files:**
- Modify: `src/routes/index.tsx:87-113`

Import `CENT_TOLERANCE` from `@/lib/income-allocations` rather than re-typing `0.005` — one definition of "a cent" across the app.

- [ ] **Step 1: Total from allocations, not payments**

```ts
const { data: incomeTotals, isLoading: incomeTotalsLoading } = useQuery({
  queryKey: ["income_totals"],
  queryFn: async () => {
    const [{ data: assocs }, { data: payments }, { data: allocations }] = await Promise.all([
      supabase.from("associations").select("id,name").order("name"),
      supabase.from("income_payments").select("id,amount,currency"),
      supabase.from("income_payment_allocations").select("payment_id,condominium_id,amount"),
    ]);

    const currencyByPayment = new Map((payments ?? []).map((p) => [p.id, p.currency ?? "—"]));
    const allocatedByPayment = new Map<string, number>();
    const byAssoc = new Map<string, Map<string, number>>();

    for (const a of allocations ?? []) {
      allocatedByPayment.set(
        a.payment_id,
        (allocatedByPayment.get(a.payment_id) ?? 0) + Number(a.amount ?? 0),
      );
      if (!a.condominium_id) continue;
      const cur = currencyByPayment.get(a.payment_id) ?? "—";
      if (!byAssoc.has(a.condominium_id)) byAssoc.set(a.condominium_id, new Map());
      byAssoc.get(a.condominium_id)!.set(
        cur,
        (byAssoc.get(a.condominium_id)!.get(cur) ?? 0) + Number(a.amount ?? 0),
      );
    }

    // "Needs attention" = nothing allocated, or the split does not balance.
    const unmatchedCount = (payments ?? []).filter((p) => {
      const allocated = allocatedByPayment.get(p.id) ?? 0;
      return Math.abs(Number(p.amount ?? 0) - allocated) >= CENT_TOLERANCE;
    }).length;

    return {
      totalCount: payments?.length ?? 0,
      unmatchedCount,
      associations: assocs ?? [],
      byAssoc,
    };
  },
});
```

- [ ] **Step 2: Verify the numbers did not move**

Before splitting anything, load the dashboard and confirm every per-association total is **identical** to what it showed before this task. The backfill made allocations mirror payments exactly, so any change here is a bug in this query, not in the data.

- [ ] **Step 3: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat: compute dashboard income totals from allocations"
```

---

## Task 10: CondoTracker feed

**Read the "Read this before Task 10" section at the top before starting.**

**Files:**
- Create: `supabase/migrations/20260920000002_condotracker_income_feed.sql`
- Modify: `src/lib/condotracker-feed.server.ts:88-95, 124-141`

- [ ] **Step 1: Create the feed view**

A view keeps the `GREATEST` and the `NOT EXISTS` in SQL, where PostgREST can filter on a single column.

```sql
CREATE OR REPLACE VIEW public.condotracker_income_feed AS
-- Allocated: one row per allocation. source_id stays the payment id while
-- there is only one allocation, so nothing already sent to CondoTracker
-- re-sends under a new id and duplicates.
SELECT
  CASE
    WHEN (SELECT count(*) FROM public.income_payment_allocations x
          WHERE x.payment_id = a.payment_id) = 1
    THEN p.id::text
    ELSE p.id::text || ':' || a.id::text
  END                                     AS source_id,
  a.amount                                AS amount,
  p.currency, p.payment_date, p.payer_name, p.reference_string,
  p.match_confidence, p.match_signals, p.file_path, p.file_mime,
  GREATEST(p.created_at, a.updated_at)    AS source_created_at,
  assoc.condotracker_id                   AS condotracker_condominium_id,
  o.condotracker_id                       AS condotracker_owner_id
FROM public.income_payment_allocations a
JOIN public.income_payments p   ON p.id = a.payment_id
LEFT JOIN public.associations assoc ON assoc.id = a.condominium_id
LEFT JOIN public.owners o           ON o.id = a.owner_id

UNION ALL

-- Unallocated: unchanged from today -- payment id, full amount, no owner.
SELECT
  p.id::text, p.amount, p.currency, p.payment_date, p.payer_name,
  p.reference_string, p.match_confidence, p.match_signals, p.file_path,
  p.file_mime, p.created_at,
  assoc.condotracker_id, NULL
FROM public.income_payments p
LEFT JOIN public.associations assoc ON assoc.id = p.condominium_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.income_payment_allocations a WHERE a.payment_id = p.id
);

GRANT SELECT ON public.condotracker_income_feed TO anon, authenticated, service_role;
```

- [ ] **Step 2: Point the feed at the view**

Replace the income query (currently `.from("income_payments")` at line 89):

```ts
supabaseAdmin
  .from("condotracker_income_feed")
  .select(
    "source_id, amount, currency, payer_name, payment_date, reference_string, match_confidence, match_signals, file_path, file_mime, source_created_at, condotracker_condominium_id, condotracker_owner_id",
  )
  .gte("source_created_at", since)
  .order("source_created_at", { ascending: true })
  .limit(perStream),
```

And the mapping (currently lines 124-141):

```ts
const income: FeedItem[] = (incomeResult.data ?? []).map((row) => ({
  sourceId: row.source_id,
  sourceKind: "income" as const,
  condotrackerCondominiumId: row.condotracker_condominium_id,
  amount: row.amount,
  currency: row.currency,
  date: row.payment_date,
  supplier: row.payer_name,
  category: null,
  reference: row.reference_string,
  condotrackerOwnerId: row.condotracker_owner_id,
  ownerMatchConfidence: row.match_confidence,
  ownerMatchSignals: row.match_signals,
  filePath: row.file_path,
  fileMime: row.file_mime,
  fileUrl: null,
  sourceCreatedAt: row.source_created_at,
}));
```

`embeddedCondotrackerId` is no longer needed for income — the view flattens the joins. Leave the helper in place; the expense stream still uses it.

- [ ] **Step 3: Verify the feed did not change for unsplit data**

Before splitting anything, call the feed endpoint with an old `since` and confirm the income items are **byte-identical** to what it returned before this task — same `sourceId`s, same amounts, same count. Then split one payment and confirm it now yields two items whose amounts sum to the original.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260920000002_condotracker_income_feed.sql src/lib/condotracker-feed.server.ts
git commit -m "feat: emit one CondoTracker feed item per income allocation"
```

---

## Task 11: Ingest pipeline

**Files:**
- Modify: `src/lib/extraction/income-pipeline.ts:54-86`

- [ ] **Step 1: Create an allocation on a confident match**

After the payment insert succeeds and before the return:

```ts
if (ownerMatch.owner_id) {
  const { error: allocError } = await supabase
    .from("income_payment_allocations")
    .insert({
      payment_id: inserted.id,
      owner_id: ownerMatch.owner_id,
      condominium_id: ownerMatch.condominium_id,
      amount: extracted.amount,
    });
  if (allocError) {
    console.error("Failed to create income payment allocation", allocError);
  }
}
```

A failure here is logged, not thrown: the payment itself is saved and shows as unallocated, which is recoverable in the UI. Losing the whole extraction over it is not.

- [ ] **Step 2: Delete the `contribution_paid` write**

Remove this block entirely (currently lines 77-84):

```ts
if (ownerMatch.owner_id && ownerMatch.confidence >= RULES.owner_matching.combined_threshold) {
  const { error: updateError } = await supabase
    .from("owners")
    .update({ contribution_paid: true })
    .eq("id", ownerMatch.owner_id);
  if (updateError) {
    console.error("Failed to mark owner contribution_paid", updateError);
  }
}
```

`owners.contribution_paid` belongs to CondoTracker — `condotracker-sync.ts` states *"CondoTracker is the source of truth — this sync never writes back to it"* and its upsert overwrites the column on every run, so this write was already being silently reverted. CondoTracker now gets the per-owner amounts through the feed and decides coverage itself.

Check whether `RULES` is still used elsewhere in the file after the deletion; if not, remove the now-unused import.

- [ ] **Step 3: Update the file's doc comment**

The comment at the bottom of the file says the pipeline "marks the owner's contribution as paid when the match is confident". Replace that clause with "and records the match as a payment allocation".

- [ ] **Step 4: Typecheck, lint, test**

```bash
npx tsc --noEmit && npm run test && npx eslint src/lib/extraction/income-pipeline.ts
```

Expected: 2 pre-existing `__root.tsx` type errors; all tests pass; eslint clean apart from the repo-wide CRLF noise.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extraction/income-pipeline.ts
git commit -m "feat: allocate on ingest and stop writing CondoTracker-owned contribution_paid"
```

---

## Final verification

- [ ] **Full suite**

```bash
npm run test && npx tsc --noEmit && npm run build
```

Expected: 31+ tests pass (13 new from Task 2), exactly 2 pre-existing `__root.tsx` type errors, build succeeds.

- [ ] **Mobile layout has not regressed**

The allocation rows are new layout on a page that was just fixed for overflow. At a 375px viewport on `/income`:

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

Must be true both in read mode and with a card open in edit mode showing three allocation rows.

- [ ] **End-to-end**

1. Split a payment across two owners; the remainder line updates as you type; Save persists after a hard reload.
2. Leave a deliberate remainder; the card shows the unallocated amount and appears under "Needs attention".
3. A single-owner payment still assigns directly from the read-mode picker, without entering edit mode.
4. Bulk-assign several payments via the checkboxes; each gets one full-amount allocation.
5. Dashboard per-association totals match a hand-sum of allocations, and a split payment contributes to two associations.
6. CSV gives one row per allocation; `Allocated Amount` sums to `Payment Amount`.
7. Delete a split payment; confirm its allocations are gone (`ON DELETE CASCADE`).
