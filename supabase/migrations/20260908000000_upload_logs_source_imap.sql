-- Allow 'imap' as a third upload_logs.source value, for receipts pulled
-- directly from a mailbox via IMAP polling (e.g. Yahoo Mail, which doesn't
-- support forwarding to the Mailgun inbound address).
ALTER TABLE public.upload_logs
  DROP CONSTRAINT IF EXISTS upload_logs_source_check;

ALTER TABLE public.upload_logs
  ADD CONSTRAINT upload_logs_source_check
    CHECK (source IN ('upload', 'email', 'imap'));
