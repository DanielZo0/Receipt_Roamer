-- Track how each receipt was submitted: 'upload' (manual) or 'email' (inbound email).
ALTER TABLE public.upload_logs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload'
    CHECK (source IN ('upload', 'email'));

CREATE INDEX IF NOT EXISTS upload_logs_source_idx ON public.upload_logs(source);
