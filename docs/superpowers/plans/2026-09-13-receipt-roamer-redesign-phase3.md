# Receipt Roamer Redesign — Phase 3 (Dashboard, Login, Rule Priority) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add headline "at a glance" stat cards to the Dashboard, bring the Login page's form controls in line with the rest of the app's shadcn components, and add priority reordering to the `/rules` automation list — the last three concrete gaps identified in the Receipt Roamer redesign spec.

**Architecture:** Dashboard gains a small local `StatCard` component (mirroring the existing pattern already used on `/upload-logs`) rendering three tiles from data the page already fetches — no new queries. Login swaps three raw HTML form elements for the app's existing `Input`/`Button` components — pure markup, no behavior change. Rules priority reordering adds one new mutation that renumbers every rule's `priority` column sequentially (0..n-1) to match a new order, plus up/down icon buttons per row — chosen over drag-and-drop because it's simpler, works identically on touch and desktop, and needs no new dependency.

**Tech Stack:** TanStack Start / React 19 / TanStack Router, shadcn/ui + Tailwind v4, `@tanstack/react-query`, Supabase JS client.

**Scope note:** This is Phase 3 of the Receipt Roamer redesign. Phases 1 and 2 (navigation, theme toggle, `DataTable` component, rule-builder decomposition + live preview, and the three `DataTable` migrations) are complete and merged. The original Phase 1 spec also called for visual passes on Upload and Insights — both were re-examined before writing this plan and found to already be well-styled and consistent with the design system (Upload already has a clear per-file status system; Insights doesn't use `recharts` at all, contrary to an earlier assumption, and is already a clean Card/Badge layout) — per an explicit decision with the user, those two pages are out of scope for this plan. Expenses, Income, and Upload Logs remain deferred from Phase 2 (custom mobile layouts that don't fit `DataTable`'s current shape) and are also out of scope here.

No task in this plan changes a Supabase migration or a mutation's write behavior beyond adding sequential `priority` values to existing rules (an additive, non-destructive update to a column that already exists and already defaults to `0`) — consistent with the no-data-loss constraint that applies to all work in this repository.

---

## Task 1: Add headline stat cards to the Dashboard

**Files:**
- Modify: `src/routes/index.tsx`

- [ ] **Step 1: Add the new icon imports**

Old (line 7):
```tsx
import { Upload, FileText, DollarSign } from "lucide-react";
```
New:
```tsx
import { Upload, FileText, DollarSign, ReceiptText, AlertTriangle } from "lucide-react";
```

- [ ] **Step 2: Add a local `StatCard` component**

Insert this new function directly above `function Index() {` (currently line 23):

```tsx
function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`rounded-md p-2 ${tone === "warning" ? "bg-amber-500/10" : "bg-primary/10"}`}>
        <Icon
          className={`h-4 w-4 ${tone === "warning" ? "text-amber-600 dark:text-amber-400" : "text-primary"}`}
        />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold leading-tight">{value}</p>
      </div>
    </Card>
  );
}

```

This mirrors the `StatCard` pattern already shipped and working on `/upload-logs` (icon in a tinted rounded box, label + bold value) — kept as its own small local component here rather than shared, consistent with this codebase's existing tolerance for small, independent duplicated patterns (e.g. `AssocReceipts`/`CatReceipts` before their `DataTable` migration) rather than a premature shared abstraction for two call sites.

- [ ] **Step 3: Replace the header subtitle and insert the stats row**

Old (currently lines 95-124):
```tsx
  return (
    <AppShell maxWidth="6xl">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {totals?.totalCount ?? 0} expenses tracked
              {totals?.unassignedCount ? ` · ${totals.unassignedCount} unassigned` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/upload">
                <Upload className="h-4 w-4 mr-1" /> Upload receipt
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/income">
                <DollarSign className="h-4 w-4 mr-1" /> Add income
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/expenses">
                <FileText className="h-4 w-4 mr-1" /> All expenses
              </Link>
            </Button>
          </div>
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Totals per association
        </h2>
```
New:
```tsx
  return (
    <AppShell maxWidth="6xl">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Overview of your receipts and income.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/upload">
                <Upload className="h-4 w-4 mr-1" /> Upload receipt
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/income">
                <DollarSign className="h-4 w-4 mr-1" /> Add income
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/expenses">
                <FileText className="h-4 w-4 mr-1" /> All expenses
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          <StatCard
            icon={ReceiptText}
            label="Expenses tracked"
            value={String(totals?.totalCount ?? 0)}
          />
          <StatCard
            icon={AlertTriangle}
            label="Unassigned expenses"
            value={String(totals?.unassignedCount ?? 0)}
            tone={totals?.unassignedCount ? "warning" : "default"}
          />
          <StatCard
            icon={DollarSign}
            label="Unmatched payments"
            value={String(incomeTotals?.unmatchedCount ?? 0)}
            tone={incomeTotals?.unmatchedCount ? "warning" : "default"}
          />
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Totals per association
        </h2>
```

The old subtitle's counts are now redundant with the new stat cards, so it's replaced with a plain tagline. `totals` and `incomeTotals` are the existing `useQuery` results already fetched earlier in this component — no new query is added.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open `/` (Dashboard). Confirm: three stat cards render at the top (Expenses tracked, Unassigned expenses, Unmatched payments) with correct counts matching what's shown further down the page (the association totals grid and the "N unmatched payments →" link), and that the "Unassigned expenses"/"Unmatched payments" cards visually switch to the amber/warning tint when their count is greater than zero (and back to the default tint if you temporarily have zero of either).

- [ ] **Step 5: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat: add headline stat cards to Dashboard"
```

---

## Task 2: Bring Login page's form controls to shadcn `Input`/`Button`

**Files:**
- Modify: `src/routes/login.tsx`

- [ ] **Step 1: Add imports**

Old (lines 1-5):
```tsx
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { loginFn } from "../lib/auth";
```
New:
```tsx
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { loginFn } from "../lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
```

- [ ] **Step 2: Replace the raw `<input>` elements with `Input`**

Old (currently lines 55-63, the email field):
```tsx
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="admin@example.com"
              required
            />
```
New:
```tsx
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
            />
```

Old (currently lines 70-78, the password field):
```tsx
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="••••••••"
              required
            />
```
New:
```tsx
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
```

- [ ] **Step 3: Replace the raw `<button>` with `Button`**

Old (currently lines 81-87):
```tsx
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex w-full mt-4 items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            {isLoading ? "Authenticating..." : "Sign In"}
          </button>
```
New:
```tsx
          <Button type="submit" className="w-full mt-4" disabled={isLoading}>
            {isLoading ? "Authenticating..." : "Sign In"}
          </Button>
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, log out (or open an incognito/private window) and view `/login`. Confirm: the page looks visually unchanged (same rounded card, same spacing) since `Input`/`Button` use the same design tokens as the hand-written classes they replace, the email/password fields still accept input, the submit button still shows "Authenticating..." while pending and submits correctly, and a failed login still shows the error toast.

- [ ] **Step 5: Commit**

```bash
git add src/routes/login.tsx
git commit -m "refactor: use shadcn Input/Button on Login page"
```

---

## Task 3: Add priority reordering to Automation Rules

**Files:**
- Modify: `src/routes/rules.tsx`

- [ ] **Step 1: Add `ArrowUp`/`ArrowDown` icon imports**

Old (currently line 26):
```tsx
import { Trash2, Pencil, Plus, X, Save } from "lucide-react";
```
New:
```tsx
import { Trash2, Pencil, Plus, X, Save, ArrowUp, ArrowDown } from "lucide-react";
```

- [ ] **Step 2: Add the reorder mutation and `moveRule` helper**

Insert this directly after the existing `markRead` mutation (currently ending at line 185, right before `const assocName = ...` on line 187):

```tsx

  const reorder = useMutation({
    mutationFn: async (newOrder: RuleRow[]) => {
      const updates = newOrder
        .map((r, idx) => ({ id: r.id, priority: idx, changed: r.priority !== idx }))
        .filter((u) => u.changed);
      for (const u of updates) {
        const { error } = await supabase.from("rules").update({ priority: u.priority }).eq("id", u.id);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  function moveRule(index: number, direction: -1 | 1) {
    if (!rules) return;
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const reordered = [...rules];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    reorder.mutate(reordered);
  }
```

This renumbers every rule's `priority` sequentially (`0..n-1`) to match the requested new order, rather than swapping just the two moved rules' raw `priority` values — the rules table's `priority` column defaults to `0` for every row (see `supabase/migrations/20260908010000_ifttt_rules.sql`), so a naive two-row swap between two rules that both still have the default `0` would be a no-op and the reorder would appear to do nothing. Renumbering the whole list guarantees a real, persisted, distinct ordering regardless of the rules' current priority values.

- [ ] **Step 3: Track each rule's index and add the up/down buttons**

Old (currently line 228):
```tsx
              {rules.map((r) =>
```
New:
```tsx
              {rules.map((r, index) =>
```

Old (the desktop action-button group, currently lines 249-281):
```tsx
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Switch
                          checked={r.active}
                          onCheckedChange={(checked) =>
                            toggleActive.mutate({ id: r.id, active: checked })
                          }
                        />
                        <Button size="icon" variant="ghost" onClick={() => setEditingId(r.id)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
```
New:
```tsx
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={index === 0}
                          onClick={() => moveRule(index, -1)}
                          title="Move up in priority"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={index === rules.length - 1}
                          onClick={() => moveRule(index, 1)}
                          title="Move down in priority"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Switch
                          checked={r.active}
                          onCheckedChange={(checked) =>
                            toggleActive.mutate({ id: r.id, active: checked })
                          }
                        />
                        <Button size="icon" variant="ghost" onClick={() => setEditingId(r.id)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
```

Old (the mobile action-button row, currently lines 296-299):
```tsx
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setEditingId(r.id)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
```
New:
```tsx
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={index === 0}
                          onClick={() => moveRule(index, -1)}
                          title="Move up in priority"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={index === rules.length - 1}
                          onClick={() => moveRule(index, 1)}
                          title="Move down in priority"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditingId(r.id)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
```

(There are two occurrences of `<Button size="icon" variant="ghost" onClick={() => setEditingId(r.id)}>` in the file — one inside the `hidden md:flex` desktop block and one inside the `md:hidden` mobile block. Apply the matching edit to each based on which action-button group it's part of; use the surrounding `Switch`/`flex justify-end gap-1` context shown above to tell them apart.)

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open `/rules` with at least 2 rules. Confirm: the up arrow is disabled on the first rule and the down arrow is disabled on the last rule, clicking a working arrow moves that rule up/down in the list (the list re-renders in the new order after the mutation succeeds), and reloading the page preserves the new order (confirming `priority` was actually persisted, not just reordered client-side). Test this with rules that started with the same default `priority` value (the common case) to confirm the sequential-renumbering approach actually produces a visible reorder rather than a no-op.

- [ ] **Step 5: Commit**

```bash
git add src/routes/rules.tsx
git commit -m "feat: add priority reordering to Automation Rules"
```

---

## Task 4: Full Phase 3 QA pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all 31 pre-existing tests still pass (this phase adds no new pure logic — the reorder renumbering logic is simple enough to verify by manual inspection and live testing per Task 3 Step 4, consistent with how this repo scopes Vitest to pure-logic units only).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: only the 2 pre-existing, unrelated errors in `src/routes/__root.tsx` — nothing new from any file touched in this plan.

- [ ] **Step 3: Full manual walkthrough**

Run: `npm run dev`. Visit `/` and confirm the three stat cards render correctly alongside the existing association/income totals. Log out and confirm `/login` still works end-to-end (successful login, failed login shows a toast) with its new shadcn form controls. On `/rules`, reorder at least two rules up and down, reload, and confirm the order persisted.

- [ ] **Step 4: Confirm no destructive data changes were introduced**

Run: `git diff master --stat -- supabase/`
Expected: empty output — this phase adds no migrations; the only data write introduced (Task 3's `priority` renumbering) uses the existing `rules.priority` column via a normal `update`, not a schema change.
