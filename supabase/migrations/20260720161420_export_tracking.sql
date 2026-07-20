-- Track when a row has been exported to CSV, so re-exporting only pulls new rows.
ALTER TABLE public.expenses
  ADD COLUMN exported_at timestamptz NULL;

ALTER TABLE public.income_payments
  ADD COLUMN exported_at timestamptz NULL;
