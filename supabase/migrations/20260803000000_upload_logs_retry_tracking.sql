-- Track in-progress Gemini retries on upload_logs so the UI can show live
-- progress ("Retrying, attempt 2/3...") and let the user cancel a stuck retry.
ALTER TABLE public.upload_logs
  DROP CONSTRAINT IF EXISTS upload_logs_status_check;

ALTER TABLE public.upload_logs
  ADD CONSTRAINT upload_logs_status_check
    CHECK (status IN ('success', 'error', 'processing', 'cancelled'));

ALTER TABLE public.upload_logs
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT false;
