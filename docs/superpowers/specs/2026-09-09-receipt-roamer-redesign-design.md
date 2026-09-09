# Receipt Roamer Redesign — Design

## Context

Receipt Roamer has grown to 12 pages (Dashboard, Upload, Upload Logs, Expenses,
Income, Associations, Categories, Rules, Corrections, Insights, Settings,
Login) without a corresponding investment in UI structure. Each page
duplicates its own layout wrapper, container width, and heading styles;
navigation is three grouped dropdown menus that don't scale well past a
handful of pages; responsive tables are hand-duplicated (separate desktop
`<Table>` and mobile card markup) on every data page; dark-mode CSS tokens
exist but are unreachable; and the `/rules` automation engine — a
condition/action "if this then that" system — is exposed only as a flat CRUD
form with no way to preview what a rule would actually match.

The goal of this redesign is to clean up navigation, layout, and shared
components so the app reads and behaves consistently across all 12 pages, on
both desktop and the mobile PWA, while making no destructive changes to any
data — this is a UI/presentation-layer redesign, not a data model rework.

Note: Receipt Roamer is a single responsive web app (TanStack Start + React
19 + shadcn/ui + Tailwind v4, Supabase backend), delivered to mobile as an
installable PWA rendering the same UI — there is no separate native mobile
codebase.

## 1. Layout & Navigation

- Introduce a shared `AppShell` layout (wrapping all authenticated routes,
  likely via `__root.tsx` or a route-group layout) that owns the page
  container (consistent max-width, padding) and heading conventions, so
  individual route files stop re-declaring `<div className="min-h-screen
  bg-background">` + ad-hoc `max-w-*` wrappers.
- Desktop: persistent left sidebar built on the existing-but-unused
  `src/components/ui/sidebar.tsx`, replacing `AppNav.tsx`'s dropdown menus.
  Groups: Dashboard/Upload at top, **Money** (Income, Expenses), **Setup**
  (Associations, Categories, Settings), **History** (Upload Logs,
  Automations/Rules, Corrections, Insights).
- Mobile (< `md`): sidebar collapses into a hamburger drawer with the same
  grouped list — same mental model as desktop, just a different presentation.
- Both sidebar and drawer render from one shared nav-config data file
  (route/group/icon/label), eliminating the current duplication between
  `AppNav.tsx`'s desktop dropdown markup and its separate mobile `Sheet`
  markup.

## 2. Visual Style & Design Tokens

- Keep the existing shadcn "new-york" neutral/slate base — no new brand
  accent color. Focus on consistency: one heading scale, one spacing rhythm,
  one container width, enforced by the shared shell from section 1 rather
  than copy-pasted per page.
- Add a light/dark/system theme toggle (sidebar footer, near
  account/logout), using the `.dark` CSS variables already defined in
  `src/styles.css` — just needs a toggle component, a `.dark` class
  application on `<html>`, and **localStorage** persistence (no schema
  change; explicitly decided against server-side persistence).
- Status/semantic colors (destructive red, review-flag amber, etc.) stay as
  sparing accents against the neutral base, using existing tokens
  (`--color-destructive` etc.) — no new tokens introduced.
- Replace native `confirm()` dialogs (e.g. sender-email delete in
  `settings.tsx`) with the app's existing `AlertDialog` component for
  consistency with the rest of the design system.

## 3. Shared Responsive `DataTable` Component

- New component (e.g. `src/components/data-table.tsx`) that owns the
  desktop `<Table>` / mobile `MobileCardList` split internally, replacing
  the hand-duplicated markup currently repeated across `expenses.tsx`,
  `income.tsx`, `settings.tsx`, `corrections.tsx`, `upload-logs.tsx`,
  `associations.tsx`, and `categories.tsx`.
- Takes columns + rows and supports what these pages already do: sorting,
  filtering hooks, row actions (edit/delete via the `AlertDialog` from
  section 2), empty states, and export where applicable (Expenses).
- **Presentation-only refactor** — no changes to queries, mutations, or how
  data is fetched/stored. Each page passes its existing data/columns into
  the new component; nothing about how data is persisted changes.

## 4. Visual Rule Builder (`/rules`)

- Replace the flat CRUD form with a filter-style builder: condition rows
  (field → operator → value, using the existing `RuleCondition` union —
  supplier/amount/category/currency/association_id/sender_email) chained
  together, with action rows below (`set_category`, `set_association`,
  `flag_for_review`, `notify`).
- Drag-to-reorder rule priority — the `rules` table already has a `priority
  integer` column (added in `20260908010000_ifttt_rules.sql`), so this is a
  UI-only change against existing data, no migration needed.
- **Live preview panel**: as conditions are built, query existing expenses
  and show which would match, using the same evaluation logic as
  `src/lib/extraction/rule-engine.ts` (imported/reused, not reimplemented)
  so the preview never drifts from real rule-engine behavior.
- Rule list view becomes a card list with plain-English summaries (e.g. "If
  supplier contains 'Shell' → set category to Fuel"), generated from the
  existing `name` column when present, or synthesized from
  conditions/actions when not. Priority order visible and editable via drag
  handles.
- Only the UI around `rule-engine.ts` changes — condition/action types,
  stored rules, and evaluation logic are untouched; existing rules keep
  working unmodified.

## 5. Remaining Pages — Targeted Passes

Presentation-only cleanup under the new shell/tokens from sections 1–2, no
functional or data changes:

- **Dashboard** (`index.tsx`): reorganize into clear stat cards (totals,
  unassigned count, recent activity) with consistent card styling.
- **Upload** (`upload.tsx`): clearer per-file batch status (queued /
  extracting / done / error) using consistent status colors; extraction
  pipeline itself is untouched.
- **Income** (`income.tsx`): adopt the shared `DataTable` (section 3) for
  the payment-match list.
- **Insights** (`insights.tsx`): keep `recharts`, restyle using the existing
  chart color tokens to match the new visual language.
- **Login** (`login.tsx`): minor alignment with the new shell; low priority.

## Explicitly Out of Scope

- No new brand/accent color (declined in favor of refined neutral).
- No server-persisted theme preference / new `user_preferences` table
  (declined in favor of localStorage-only persistence).
- No changes to the extraction pipeline, IMAP polling, rule-engine
  evaluation logic, Supabase schema (beyond what's already in place), or any
  data mutation/deletion behavior. This redesign is UI/presentation only.

## Verification

- Run the app locally (`npm run dev` or equivalent) and manually walk every
  route under the new shell: sidebar/drawer navigation on both desktop and a
  mobile viewport, dark/light/system toggle, and the shared `DataTable` on
  each page that adopts it (sorting, row actions, empty states).
- Exercise the rule builder end-to-end: build a rule with 2+ conditions,
  confirm the live preview matches the same expenses the existing
  `rule-engine.ts` would flag, save it, and confirm it still evaluates
  correctly against new incoming expenses (no regression in stored
  conditions/actions/priority).
- Confirm no destructive migrations are introduced — this spec calls for
  none; any future schema touch must follow the existing pattern in
  `20260908010000_ifttt_rules.sql` (backfill + rename, never drop).
