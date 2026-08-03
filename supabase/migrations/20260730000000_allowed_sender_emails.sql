-- Emails allowed to trigger the inbound-email receipt/income pipeline, managed via the
-- in-app Settings page instead of the previous hardcoded ALLOWED_SENDER constant.
CREATE TABLE public.allowed_sender_emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.allowed_sender_emails TO anon, authenticated;
GRANT ALL ON public.allowed_sender_emails TO service_role;

ALTER TABLE public.allowed_sender_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read allowed_sender_emails"   ON public.allowed_sender_emails FOR SELECT USING (true);
CREATE POLICY "Public insert allowed_sender_emails" ON public.allowed_sender_emails FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update allowed_sender_emails" ON public.allowed_sender_emails FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete allowed_sender_emails" ON public.allowed_sender_emails FOR DELETE USING (true);

-- Preserve current out-of-the-box behavior.
INSERT INTO public.allowed_sender_emails (email) VALUES ('danzammit1@gmail.com')
  ON CONFLICT (email) DO NOTHING;
