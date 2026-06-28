
CREATE TABLE public.upload_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  file_mime TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  error_message TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd NUMERIC(10, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.upload_logs TO anon, authenticated;
GRANT ALL ON public.upload_logs TO service_role;

ALTER TABLE public.upload_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read upload_logs"   ON public.upload_logs FOR SELECT USING (true);
CREATE POLICY "Public insert upload_logs" ON public.upload_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update upload_logs" ON public.upload_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete upload_logs" ON public.upload_logs FOR DELETE USING (true);

CREATE INDEX upload_logs_created_at_idx ON public.upload_logs(created_at DESC);
CREATE INDEX upload_logs_status_idx     ON public.upload_logs(status);
