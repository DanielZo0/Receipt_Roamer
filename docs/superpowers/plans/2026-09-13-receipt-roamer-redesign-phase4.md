# Receipt Roamer Redesign — Phase 4 (Shared Delete Confirmation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the `AlertDialog`-based delete-confirmation pattern (already repeated 6 times across Settings, Associations, Categories, and Rules ×2) into one shared `ConfirmDeleteButton` component, migrate all 6 existing call sites onto it, and use it to finally replace the remaining native `confirm()` calls on the Expenses and Income pages.

**Architecture:** One new presentational component (`src/components/confirm-delete-button.tsx`) wrapping the exact `AlertDialog`/`AlertDialogTrigger`/`AlertDialogContent` structure every existing call site already uses, parameterized by title/description/confirm-label/disabled-state/callback. Every migration in this plan is a pure call-site swap — no mutation, query, or business logic changes anywhere.

**Tech Stack:** TanStack Start / React 19 / TanStack Router, shadcn/ui + Tailwind v4, `@tanstack/react-query`, Supabase JS client.

**Scope note:** This is Phase 4 of the Receipt Roamer redesign, following an explicit decision that Expenses, Income, and Upload Logs should NOT be forced onto the `DataTable` component from Phase 1/2 — their mobile card layouts are intentionally structured differently (grouped sections, prominent header fields, checkbox selection, popovers, comboboxes) for real UX reasons, and their desktop cells are inline-editable inputs wired directly to mutations rather than display values, so `DataTable`'s column abstraction wouldn't remove any real duplication there. What Phase 4 *does* pick up from that deferred list is the one clearly valuable, low-risk item: replacing Expenses' and Income's remaining native `confirm()` calls with the same `AlertDialog` pattern already used everywhere else in the redesign — and since that pattern is about to appear an 8th, 9th, and 10th time, this is also the point multiple prior code reviews flagged as "worth extracting now." Upload Logs has no delete action (only retry/cancel), so it isn't touched by this plan.

No task in this plan changes a Supabase migration or any mutation's write behavior — every change replaces a confirmation UI (native `confirm()` or an inline `AlertDialog`) with a call to the same shared component wrapping the identical `AlertDialog` primitive, consistent with the no-data-loss constraint that applies to all work in this repository.

---

## Task 1: Create the shared `ConfirmDeleteButton` component

**Files:**
- Create: `src/components/confirm-delete-button.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export function ConfirmDeleteButton({
  title,
  description,
  confirmLabel = "Delete",
  disabled = false,
  disabledReason,
  triggerTitle,
  onConfirm,
}: {
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  triggerTitle?: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          disabled={disabled}
          title={disabled ? disabledReason : triggerTitle}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

`disabled`/`disabledReason`/`triggerTitle` exist specifically to cover the Settings page's "at least one allowed sender is required" case (the only existing call site that disables its delete button and shows a title tooltip) — every other call site simply omits those three props and gets today's plain, always-enabled icon button.

- [ ] **Step 2: Manual verification**

This component isn't wired into any page yet — verification is via `npx tsc --noEmit`, confirming the file compiles with no errors and no unused-import warnings, and a quick read-through confirming the JSX structure is byte-for-byte the same `AlertDialog` shape already used (and already visually verified) at every existing call site.

- [ ] **Step 3: Commit**

```bash
git add src/components/confirm-delete-button.tsx
git commit -m "feat: add shared ConfirmDeleteButton component"
```

---

## Task 2: Migrate Settings, Associations, and Categories onto `ConfirmDeleteButton`

**Files:**
- Modify: `src/routes/settings.tsx`
- Modify: `src/routes/associations.tsx`
- Modify: `src/routes/categories.tsx`

- [ ] **Step 1: `settings.tsx`**

Remove the now-unused `AlertDialog` import block and `Trash2` import, add `ConfirmDeleteButton`:

Old (currently lines 8-21):
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
```
New:
```tsx
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
```

Replace the `rowActions` callback body (currently lines 141-169):
```tsx
        rowActions={(r) => {
          const isLast = (rows?.length ?? 0) === 1;
          return (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={isLast}
                  title={isLast ? "At least one allowed sender is required" : "Remove"}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {r.email}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Emails from this address will no longer be accepted by the inbound-email pipeline.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => del.mutate(r.id)}>Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          );
        }}
```
New:
```tsx
        rowActions={(r) => {
          const isLast = (rows?.length ?? 0) === 1;
          return (
            <ConfirmDeleteButton
              title={`Remove ${r.email}?`}
              description="Emails from this address will no longer be accepted by the inbound-email pipeline."
              confirmLabel="Remove"
              disabled={isLast}
              disabledReason="At least one allowed sender is required"
              triggerTitle="Remove"
              onConfirm={() => del.mutate(r.id)}
            />
          );
        }}
```

- [ ] **Step 2: `associations.tsx`**

Remove the now-unused `AlertDialog` import block and the `Trash2` entry from the lucide-react import, add `ConfirmDeleteButton`:

Old (currently lines 9-19, the AlertDialog import):
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
New:
```tsx
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
```

`Trash2` is imported as part of a larger lucide-react icon list in this file (alongside `ChevronDown`, `ChevronUp`, `ExternalLink`, `FileText`, `Pencil`, `Plus`, `X`, `Save`, `RefreshCw`) — remove only the `Trash2,` entry from that list, keep the rest exactly as-is.

Replace the delete block (currently lines 225-245):
```tsx
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
```
New:
```tsx
                      <ConfirmDeleteButton
                        title={`Delete "${a.name}"?`}
                        description="Linked expenses will be kept but unassigned. This can't be undone."
                        onConfirm={() => del.mutate(a.id)}
                      />
```

- [ ] **Step 3: `categories.tsx`**

Remove the now-unused `AlertDialog` import block and the `Trash2` entry from the lucide-react import, add `ConfirmDeleteButton`:

Old (currently lines 8-18, the AlertDialog import):
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
New:
```tsx
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
```

Old (currently line 23):
```tsx
import { ChevronDown, ChevronUp, ExternalLink, FileText, Pencil, Trash2, Plus, X, Save } from "lucide-react";
```
New:
```tsx
import { ChevronDown, ChevronUp, ExternalLink, FileText, Pencil, Plus, X, Save } from "lucide-react";
```

Replace the delete block (currently lines 167-188):
```tsx
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
                              Existing receipts will keep this category as text, but it won't be
                              manageable from this list anymore. This can't be undone.
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
```
New:
```tsx
                      <ConfirmDeleteButton
                        title={`Delete "${c.name}"?`}
                        description="Existing receipts will keep this category as text, but it won't be manageable from this list anymore. This can't be undone."
                        onConfirm={() => del.mutate(c.id)}
                      />
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. On `/settings`, confirm the "Remove" dialog still shows the email address, the disabled state and tooltip still work when only one sender remains, and Remove/Cancel both still work. On `/associations` and `/categories`, confirm the delete dialogs still show the correct name and description, Cancel/Delete both work, and the row's expand/collapse click guard still isn't triggered by opening the dialog (same behavior verified in Phase 2).

- [ ] **Step 5: Commit**

```bash
git add src/routes/settings.tsx src/routes/associations.tsx src/routes/categories.tsx
git commit -m "refactor: migrate Settings/Associations/Categories delete dialogs to ConfirmDeleteButton"
```

---

## Task 3: Migrate Rules onto `ConfirmDeleteButton`

**Files:**
- Modify: `src/routes/rules.tsx`

- [ ] **Step 1: Update imports**

Remove the now-unused `AlertDialog` import block, remove `Trash2` from the lucide-react import, add `ConfirmDeleteButton`:

Old (currently lines 9-19, the AlertDialog import):
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
New:
```tsx
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
```

Old (currently line 26):
```tsx
import { Trash2, Pencil, Plus, X, Save, ArrowUp, ArrowDown } from "lucide-react";
```
New:
```tsx
import { Pencil, Plus, X, Save, ArrowUp, ArrowDown } from "lucide-react";
```

- [ ] **Step 2: Replace both delete blocks (desktop and mobile)**

Old (the desktop block, currently lines 300-321):
```tsx
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {r.name ?? "This rule"} will stop running against incoming receipts.
                                This can't be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => del.mutate(r.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
```
New:
```tsx
                        <ConfirmDeleteButton
                          title="Delete this rule?"
                          description={`${r.name ?? "This rule"} will stop running against incoming receipts. This can't be undone.`}
                          onConfirm={() => del.mutate(r.id)}
                        />
```

Old (the mobile block, currently lines 359-380 — identical structure to the desktop block above, same text):
```tsx
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {r.name ?? "This rule"} will stop running against incoming receipts.
                                This can't be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => del.mutate(r.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
```
New:
```tsx
                        <ConfirmDeleteButton
                          title="Delete this rule?"
                          description={`${r.name ?? "This rule"} will stop running against incoming receipts. This can't be undone.`}
                          onConfirm={() => del.mutate(r.id)}
                        />
```

(Since both blocks are textually identical, use surrounding context to place each edit correctly: the desktop one sits inside the `hidden md:flex` action group right after the Pencil `Button`, before the closing of that `<div className="flex items-center gap-1 flex-shrink-0">`; the mobile one sits inside the `md:hidden` action group, right after the Pencil `Button` that follows the up/down priority buttons, before the closing of `<div className="flex justify-end gap-1">`.)

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open `/rules`. Confirm the delete dialog still shows the correct rule name (or "This rule" for unnamed ones) in its description, Cancel/Delete both work, and this doesn't interfere with the priority up/down buttons or the edit button next to it. Check both desktop and mobile (resize to <768px) layouts.

- [ ] **Step 4: Commit**

```bash
git add src/routes/rules.tsx
git commit -m "refactor: migrate Rules delete dialogs to ConfirmDeleteButton"
```

---

## Task 4: Replace Expenses' `confirm()` calls with `ConfirmDeleteButton`

**Files:**
- Modify: `src/routes/expenses.tsx`

- [ ] **Step 1: Add the import**

Add to the existing import block in `src/routes/expenses.tsx` (after the `AppShell` import):
```tsx
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
```

- [ ] **Step 2: Replace the desktop delete button**

Old (currently lines 556-566, inside the desktop `<TableCell>` for row actions):
```tsx
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Delete this expense?")) del.mutate(e);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
```
New:
```tsx
                    <TableCell>
                      <ConfirmDeleteButton
                        title="Delete this expense?"
                        description={`This will permanently remove ${e.supplier ?? "this expense"}${e.file_path ? " and its attached receipt file" : ""}. This can't be undone.`}
                        onConfirm={() => del.mutate(e)}
                      />
                    </TableCell>
```

- [ ] **Step 3: Replace the mobile delete button**

Old (currently lines 694-702, inside the mobile card's footer row, right after the file-open/file-icon `Button`):
```tsx
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Delete this expense?")) del.mutate(e);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
```
New:
```tsx
                    <ConfirmDeleteButton
                      title="Delete this expense?"
                      description={`This will permanently remove ${e.supplier ?? "this expense"}${e.file_path ? " and its attached receipt file" : ""}. This can't be undone.`}
                      onConfirm={() => del.mutate(e)}
                    />
```

- [ ] **Step 4: Check whether `Trash2` is still used elsewhere in this file**

Run: `grep -n "Trash2" src/routes/expenses.tsx`. If the only remaining match is the import line itself (`import { Download, Trash2, FileText, ExternalLink, Info } from "lucide-react";`), remove `Trash2` from that import list (leaving `Download, FileText, ExternalLink, Info`). If any other `<Trash2` usage remains, leave the import as-is.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open `/expenses`. Confirm: clicking the trash icon on a row (desktop) opens an `AlertDialog` (not a native browser confirm) naming the supplier, Cancel/Delete both work. Resize to mobile and repeat for the mobile card's delete button. Confirm the delete mutation still behaves exactly as before (removes the row, cleans up the storage file if one existed) — this task only changes how the confirmation is triggered, not what `del.mutate(e)` does.

- [ ] **Step 6: Commit**

```bash
git add src/routes/expenses.tsx
git commit -m "refactor: replace Expenses delete confirm() with ConfirmDeleteButton"
```

---

## Task 5: Replace Income's `confirm()` calls with `ConfirmDeleteButton`

**Files:**
- Modify: `src/routes/income.tsx`

- [ ] **Step 1: Add the import**

Add to the existing import block in `src/routes/income.tsx` (after the `AppShell` import, following the same placement convention used in Task 4 for `expenses.tsx`):
```tsx
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
```

- [ ] **Step 2: Replace the desktop delete button**

Old (currently around lines 598-608, inside the desktop `<TableCell>` for row actions):
```tsx
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                if (confirm("Delete this payment?")) del.mutate(p);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
```
New:
```tsx
                          <TableCell>
                            <ConfirmDeleteButton
                              title="Delete this payment?"
                              description={`This will permanently remove the payment from ${p.payer_name ?? "this payer"}${p.file_path ? " and its attached file" : ""}. This can't be undone.`}
                              onConfirm={() => del.mutate(p)}
                            />
                          </TableCell>
```

- [ ] **Step 3: Replace the mobile delete button**

Old (currently around lines 677-685, inside the mobile card's footer row, right after the optional file-open `Button`):
```tsx
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            if (confirm("Delete this payment?")) del.mutate(p);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
```
New:
```tsx
                        <ConfirmDeleteButton
                          title="Delete this payment?"
                          description={`This will permanently remove the payment from ${p.payer_name ?? "this payer"}${p.file_path ? " and its attached file" : ""}. This can't be undone.`}
                          onConfirm={() => del.mutate(p)}
                        />
```

- [ ] **Step 4: Check whether `Trash2` is still used elsewhere in this file**

Run: `grep -n "Trash2" src/routes/income.tsx`. If the only remaining match is the import line itself, remove `Trash2` from that lucide-react import list, keeping every other icon name in it unchanged. If any other `<Trash2` usage remains, leave the import as-is.

Read the current import line first (don't guess its exact contents) before editing it.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open `/income`. Confirm: clicking the trash icon on a payment row (desktop) opens an `AlertDialog` naming the payer, Cancel/Delete both work. Resize to mobile and repeat for the mobile card's delete button. Confirm the delete mutation still behaves exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/routes/income.tsx
git commit -m "refactor: replace Income delete confirm() with ConfirmDeleteButton"
```

---

## Task 6: Full Phase 4 QA pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all 31 pre-existing tests still pass (this phase adds no new pure logic — `ConfirmDeleteButton` is a thin presentational wrapper around the already-stable `AlertDialog` primitive).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: only the 2 pre-existing, unrelated errors in `src/routes/__root.tsx`.

- [ ] **Step 3: Confirm zero native `confirm()` calls remain anywhere in the app**

Run: `grep -rn "confirm(" src/routes/`
Expected: zero matches. Before this plan, `expenses.tsx` (×2) and `income.tsx` (×2) were the last remaining call sites in the entire app — every other page was already migrated in Phases 1 and 2.

- [ ] **Step 4: Confirm all 10 delete-confirmation call sites now use `ConfirmDeleteButton`**

Run: `grep -rln "ConfirmDeleteButton" src/routes/`
Expected: `settings.tsx`, `associations.tsx`, `categories.tsx`, `rules.tsx`, `expenses.tsx`, `income.tsx` — 6 files (Rules and Expenses and Income each use it twice, once per responsive layout, but that only requires 1 import per file).

- [ ] **Step 5: Full manual walkthrough**

Run: `npm run dev`. Visit `/settings`, `/associations`, `/categories`, `/rules`, `/expenses`, `/income` and confirm each page's delete confirmation dialog still opens correctly, shows the right name/description, and Cancel/Delete both work — at both desktop and mobile (<768px) widths for the pages that have a distinct mobile layout.

- [ ] **Step 6: Confirm no destructive data changes were introduced**

Run: `git diff master --stat -- supabase/`
Expected: empty output — this phase touched no migrations and no mutation logic, only how each existing delete action is triggered.
