-- Support multi-line ledger receipts: multiple expenses generated from a
-- single uploaded file, grouped together and ordered by their position in
-- the source document.
ALTER TABLE public.expenses
  ADD COLUMN ledger_group_id uuid NULL,
  ADD COLUMN source_line_index integer NULL;

CREATE INDEX expenses_ledger_group_id_idx ON public.expenses (ledger_group_id);
