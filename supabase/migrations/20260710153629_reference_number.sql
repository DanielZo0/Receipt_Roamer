-- Support extracting an invoice/receipt/reference number from documents.
ALTER TABLE public.expenses
  ADD COLUMN reference_number text NULL;

ALTER TABLE public.extraction_audit_log
  ADD COLUMN extracted_reference_number text NULL;
