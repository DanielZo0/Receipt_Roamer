
# Receipt & Bill Tracker

A single-user web app to upload receipts/bills, auto-extract key fields with AI, auto-assign them to a condominium/owners association, and review totals.

## Pages

- **/** — Dashboard: totals per association, recent uploads, quick upload.
- **/upload** — Drag/drop or pick a file (image or PDF). Shows extraction progress, then a confirmation card with extracted fields + auto-assigned association (editable before save).
- **/expenses** — Filterable/searchable table (association, supplier, date range, free text). CSV export of current filter.
- **/associations** — CRUD for the list of owners associations (name, optional address/notes/keywords).

## Core flow

1. User uploads file → stored in Cloud Storage (private bucket), original kept for later viewing.
2. Server function sends the file to Lovable AI (Gemini 3 Flash, multimodal) with a structured-output schema → returns `{ date, supplier, amount, currency, category_hint }` + chosen `association_id` from the current list (the prompt includes id, name, and keywords for each association).
3. Record is saved automatically with the AI's pick. User can edit any field on the expense detail row.

## Data model (Lovable Cloud)

- `associations` — id, name, address, notes, keywords (text[]), created_at.
- `expenses` — id, association_id (fk, nullable), supplier, expense_date, amount (numeric), currency, category, file_path, file_mime, raw_extraction (jsonb), created_at.
- Storage bucket `receipts` (private) for originals; signed URLs for viewing.
- Single-user: permissive RLS (no auth yet); structured so auth can be added later.

## Tech

- TanStack Start routes + server functions for upload/extract.
- Lovable Cloud: Postgres + Storage.
- Lovable AI Gateway: `google/gemini-3-flash-preview` with structured output (Zod schema) for extraction + allocation in one call.
- shadcn/ui (table, dialog, form, input, drag-drop area), TanStack Query for data.
- CSV export client-side from filtered rows.

## Out of scope (for now)

- Multi-user/login, multi-page PDFs beyond first 10 pages, OCR fallback for unreadable scans, recurring-bill detection, accounting export beyond CSV.
