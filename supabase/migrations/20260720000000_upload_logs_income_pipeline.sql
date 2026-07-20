-- Extend upload_logs to also record income-pipeline attempts (owner payment
-- screenshots routed by subject line), so failures there are visible on the
-- Upload Logs dashboard instead of only server console output.
ALTER TABLE public.upload_logs
  ADD COLUMN IF NOT EXISTS pipeline TEXT NOT NULL DEFAULT 'expense'
    CHECK (pipeline IN ('expense', 'income')),
  ADD COLUMN IF NOT EXISTS income_payment_id UUID REFERENCES public.income_payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS upload_logs_pipeline_idx ON public.upload_logs(pipeline);
