-- Tracks the last IMAP UID processed per mailbox for the Yahoo IMAP poller
-- (src/lib/email-imap-poll.server.ts). Previously the poller searched for
-- \Seen-flag "unseen" mail, which on a real personal inbox also matched years
-- of unread marketing email (thousands of messages) and caused the Yahoo IMAP
-- connection to drop mid-poll. Tracking a UID watermark instead means the
-- poller only ever looks at mail that arrived after it started running.
CREATE TABLE public.imap_poll_state (
  mailbox TEXT NOT NULL PRIMARY KEY,
  last_uid BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.imap_poll_state TO anon, authenticated;
GRANT ALL ON public.imap_poll_state TO service_role;

ALTER TABLE public.imap_poll_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read imap_poll_state"   ON public.imap_poll_state FOR SELECT USING (true);
CREATE POLICY "Public insert imap_poll_state" ON public.imap_poll_state FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update imap_poll_state" ON public.imap_poll_state FOR UPDATE USING (true) WITH CHECK (true);
