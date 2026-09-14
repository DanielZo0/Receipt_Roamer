# Receipt Roamer Redesign — Phase 2 (Simple Table Migrations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the three pages whose tables genuinely fit the existing `DataTable` component's shape (Corrections, and the read-only receipts sub-panels inside Associations and Categories) onto `DataTable`, and replace the two remaining native `confirm()` delete-confirmations in Associations and Categories with `AlertDialog` — continuing the pattern established in Phase 1's Settings and Rules migrations.

**Architecture:** Same `DataTable` component from Phase 1 (`src/components/data-table.tsx`), no changes to it. Each migration replaces a page's hand-duplicated desktop-`<Table>`/mobile-list pair with a `columns` array + `<DataTable>` call. `AlertDialog` replacements follow the exact pattern already shipped in `src/routes/settings.tsx` and `src/routes/rules.tsx`.

**Tech Stack:** TanStack Start / React 19 / TanStack Router, shadcn/ui + Tailwind v4, `@tanstack/react-query`, Supabase JS client.

**Scope note:** This is Phase 2 of the Receipt Roamer redesign. Phase 1 (`docs/superpowers/plans/2026-09-09-receipt-roamer-redesign-phase1.md`) built the sidebar/drawer navigation, theme toggle, the `DataTable` component itself (proven on Settings), and the rule-builder decomposition + live preview — all already merged.

Of the six pages Phase 1's scope note deferred, three (Expenses, Income, Upload Logs) have genuinely custom mobile card layouts — grouped headers, footers, row-selection checkboxes, inline-editable cells — that don't fit `DataTable`'s current uniform "one row per column" mobile shape. Forcing them in would require extending `DataTable` with new slots (a card header/footer, selection support), which is real additional design work. Per an explicit decision with the user, those three pages are left bespoke for now and are out of scope for this plan. This plan covers only the three pages confirmed to be simple, low-risk fits for `DataTable` as it exists today: **Corrections**, and the receipts sub-panels inside **Associations** and **Categories**.

One accepted visual trade-off: `DataTable`'s mobile card view renders every column as a uniform label/value row. The Corrections page's current mobile card combines two fields (supplier + date) into an unlabeled header line for visual hierarchy — that hand-tuned layout is intentionally given up for consistency with every other `DataTable`-based page, per the redesign's stated goal. This is a cosmetic change only; no functionality is lost.

No task in this plan changes a Supabase migration, a query, or a mutation's behavior — every change is presentation-layer only, consistent with the no-data-loss constraint that applies to all work in this repository.

---

## Task 1: Migrate Corrections page to `DataTable`

**Files:**
- Modify: `src/routes/corrections.tsx`

- [ ] **Step 1: Update imports**

Old (lines 1-22):
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppShell } from "@/components/AppShell";
import { MobileCardList, MobileCard, MobileCardRow } from "@/components/ui/responsive-table";
import { supabase } from "@/integrations/supabase/client";
```
New:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppShell } from "@/components/AppShell";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { supabase } from "@/integrations/supabase/client";
```

(`Card`, the `Table` family, and `MobileCardList`/`MobileCard`/`MobileCardRow` are no longer used anywhere else in this file once Step 2 lands — removing them now is correct, not premature.)

- [ ] **Step 2: Replace the table/mobile-card markup with `DataTable`**

Replace the entire block from `<Card className="overflow-x-auto hidden md:block">` (currently line 139) through the closing `</MobileCardList>` and its surrounding `)}` (currently line 220) with:

```tsx
        <DataTable
          columns={
            [
              {
                key: "created_at",
                header: "Date",
                cell: (c) => new Date(c.created_at).toLocaleString(),
                className: "whitespace-nowrap",
              },
              {
                key: "expense",
                header: "Expense",
                cell: (c) => {
                  const expense = expenseById.get(c.expense_id);
                  return (
                    <>
                      {expense?.supplier ?? "—"}
                      {expense?.expense_date ? ` (${expense.expense_date})` : ""}
                    </>
                  );
                },
              },
              {
                key: "field",
                header: "Field",
                cell: (c) => <span className="font-mono">{c.field}</span>,
              },
              {
                key: "original",
                header: "Original",
                cell: (c) => (
                  <span className="text-muted-foreground">
                    {displayValue(c.field, c.original_value)}
                  </span>
                ),
              },
              {
                key: "corrected",
                header: "Corrected",
                cell: (c) => displayValue(c.field, c.corrected_value),
              },
            ] satisfies DataTableColumn<CorrectionRow>[]
          }
          rows={filtered}
          isLoading={isLoading}
          emptyMessage="No corrections recorded yet."
        />
```

`filtered` (from the existing `useMemo`) is always an array, `CorrectionRow` already has an `id` field satisfying `DataTable`'s `T extends { id: string }` constraint — no type changes needed. `expenseById` and `displayValue` are pre-existing in this file and untouched.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open `/corrections`. Confirm: the table renders on desktop with all 5 columns (Date, Expense, Field, Original, Corrected), the field filter Select still works (filters rows), the mobile card view (resize to <768px) renders one card per correction with labeled rows, and the empty state ("No corrections recorded yet.") shows correctly if you temporarily filter to a field with no matches.

- [ ] **Step 4: Commit**

```bash
git add src/routes/corrections.tsx
git commit -m "refactor: migrate Corrections page to DataTable"
```

---

## Task 2: Replace Associations delete confirmation with `AlertDialog`

**Files:**
- Modify: `src/routes/associations.tsx`

- [ ] **Step 1: Add `AlertDialog` imports**

Add to the existing import block in `src/routes/associations.tsx` (after the `Card` import, before `Table`):

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
```

- [ ] **Step 2: Replace the delete button's `confirm()` with `AlertDialog`**

Old (inside the association-list `<Card>` item, currently lines 217-236):
```tsx
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditingId(a.id)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (
                            confirm(
                              `Delete "${a.name}"? Linked expenses will be kept but unassigned.`,
                            )
                          ) {
                            del.mutate(a.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
```
New:
```tsx
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditingId(a.id)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete "{a.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Linked expenses will be kept but unassigned. This can't be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => del.mutate(a.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
```

This sits inside a parent `<div onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; toggleExpand(a.id); }}>` (the expand/collapse row) — that guard still works correctly here because `AlertDialogTrigger asChild` renders the `Button` itself as the actual DOM element, so `closest("button")` still matches and the row won't spuriously expand/collapse when opening the dialog.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open `/associations`. Confirm: clicking the trash icon on an association opens an `AlertDialog` (not a native browser confirm) with the association's name in the title, Cancel closes it without deleting, confirming deletes it, and clicking the trash icon does NOT also toggle the row's expand/collapse state.

- [ ] **Step 4: Commit**

```bash
git add src/routes/associations.tsx
git commit -m "refactor: replace Associations delete confirm() with AlertDialog"
```

---

## Task 3: Migrate Associations receipts panel to `DataTable`

**Files:**
- Modify: `src/routes/associations.tsx`

- [ ] **Step 1: Update imports**

Remove the `Table` family import (no longer used anywhere in the file after this task) and add `DataTable`:

Old (currently lines 9-16):
```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
```
New:
```tsx
import { DataTable, type DataTableColumn } from "@/components/data-table";
```

- [ ] **Step 2: Replace `AssocReceipts`'s body with `DataTable`**

Replace the entire `AssocReceipts` function body from `if (isLoading) {` through its closing `);` (currently lines 295-377) with:

```tsx
  return (
    <DataTable
      columns={
        [
          {
            key: "date",
            header: "Date",
            cell: (e) => e.expense_date ?? "—",
            className: "whitespace-nowrap",
          },
          { key: "supplier", header: "Supplier", cell: (e) => e.supplier ?? "—" },
          {
            key: "amount",
            header: "Amount",
            cell: (e) =>
              e.amount != null
                ? `${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${e.currency ?? ""}`
                : "—",
          },
          { key: "category", header: "Category", cell: (e) => e.category ?? "—" },
          {
            key: "file",
            header: "File",
            className: "w-10",
            cell: (e) =>
              e.file_path ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => openFile(e.file_path)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              ),
          },
        ] satisfies DataTableColumn<ExpenseRow>[]
      }
      rows={data}
      isLoading={isLoading}
      emptyMessage="No receipts assigned to this association yet."
    />
  );
```

This removes the two manual early-return blocks (`if (isLoading) return <p>...`, `if (!data || data.length === 0) return <p>...`) since `DataTable` now owns loading/empty-state rendering itself — `openFile` stays exactly as it was, just called from inside the new `file` column's `cell`.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open `/associations`, click an association row to expand it. Confirm: the receipts table renders with Date/Supplier/Amount/Category/File columns on desktop, the mobile card view (resize to <768px) shows one card per receipt, clicking the file icon opens the signed URL in a new tab (for a receipt that has a file), and expanding an association with zero receipts shows "No receipts assigned to this association yet."

- [ ] **Step 4: Commit**

```bash
git add src/routes/associations.tsx
git commit -m "refactor: migrate Associations receipts panel to DataTable"
```

---

## Task 4: Replace Categories delete confirmation with `AlertDialog`

**Files:**
- Modify: `src/routes/categories.tsx`

- [ ] **Step 1: Add `AlertDialog` imports**

Add to the existing import block in `src/routes/categories.tsx` (after the `Card` import, before `Table`):

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
```

- [ ] **Step 2: Replace the delete button's `confirm()` with `AlertDialog`**

Old (inside the category-list `<Card>` item, currently lines 159-172):
```tsx
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditingId(c.id)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete "${c.name}"?`)) del.mutate(c.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
```
New:
```tsx
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditingId(c.id)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete "{c.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This can't be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => del.mutate(c.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
```

Same expand/collapse-guard reasoning as Task 2 applies here (`closest("button")` still matches through `asChild`).

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open `/categories`. Confirm: clicking the trash icon on a category opens an `AlertDialog` with the category's name in the title, Cancel/Delete both work correctly, and the row's expand/collapse isn't triggered by the click.

- [ ] **Step 4: Commit**

```bash
git add src/routes/categories.tsx
git commit -m "refactor: replace Categories delete confirm() with AlertDialog"
```

---

## Task 5: Migrate Categories receipts panel to `DataTable`

**Files:**
- Modify: `src/routes/categories.tsx`

- [ ] **Step 1: Update imports**

Remove the `Table` family import (no longer used anywhere in the file after this task) and add `DataTable`:

Old (currently lines 8-15):
```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
```
New:
```tsx
import { DataTable, type DataTableColumn } from "@/components/data-table";
```

- [ ] **Step 2: Replace `CatReceipts`'s body with `DataTable`**

Replace the entire block from `if (isLoading) {` through the function's closing `);` (currently lines 248-332) with:

```tsx
  return (
    <DataTable
      columns={
        [
          {
            key: "date",
            header: "Date",
            cell: (e) => e.expense_date ?? "—",
            className: "whitespace-nowrap",
          },
          { key: "supplier", header: "Supplier", cell: (e) => e.supplier ?? "—" },
          {
            key: "amount",
            header: "Amount",
            cell: (e) =>
              e.amount != null
                ? `${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${e.currency ?? ""}`
                : "—",
          },
          {
            key: "association",
            header: "Association",
            cell: (e) => assocName(e.association_id),
          },
          {
            key: "file",
            header: "File",
            className: "w-10",
            cell: (e) =>
              e.file_path ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => openFile(e.file_path)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              ),
          },
        ] satisfies DataTableColumn<ExpenseRow>[]
      }
      rows={data}
      isLoading={isLoading}
      emptyMessage="No receipts in this category yet."
    />
  );
```

`assocName` and `openFile` are pre-existing in this file (the `associations` query and its lookup helper) and untouched — this task only replaces the render, same as Task 3's mirror-image change in `associations.tsx`.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open `/categories`, expand a category. Confirm: the receipts table renders with Date/Supplier/Amount/Association/File columns on desktop, the mobile card view shows correctly, the Association column resolves the correct association name (not a raw UUID), and the empty state shows for a category with zero receipts.

- [ ] **Step 4: Commit**

```bash
git add src/routes/categories.tsx
git commit -m "refactor: migrate Categories receipts panel to DataTable"
```

---

## Task 6: Full Phase 2 QA pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all 31 pre-existing tests still pass (this phase adds no new pure logic, so no new tests are introduced — every change here is presentation-layer JSX verified manually per-task above).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: only the 2 pre-existing, unrelated errors in `src/routes/__root.tsx` (present since before Phase 1) — nothing new from any file touched in this plan.

- [ ] **Step 3: Full manual walkthrough**

Run: `npm run dev`. Visit `/corrections`, `/associations`, and `/categories` at both desktop and mobile (<768px) widths. On Associations and Categories: expand at least one item with receipts and one with none, confirm both the DataTable-rendered table and the empty state look right, and confirm both pages' delete `AlertDialog`s (Cancel and Delete) work correctly and don't interfere with the row expand/collapse click handler. On Corrections: confirm the field filter still works against the migrated table.

- [ ] **Step 4: Confirm no data-affecting changes were introduced**

Run: `git diff master --stat -- supabase/`
Expected: empty output (beyond whatever Phase 1 already touched, which was also nothing) — this phase touched no migrations, confirming the no-data-loss constraint held.
