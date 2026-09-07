/**
 * email-imap-poll.server.ts
 *
 * Polls a mailbox (Yahoo Mail, which has no working forwarding option on
 * free personal accounts) via IMAP on an interval, and feeds unseen mail
 * through the same extraction pipeline helpers the Mailgun webhook uses
 * (src/lib/email-inbound.server.ts).
 *
 * Requires YAHOO_IMAP_USER + YAHOO_IMAP_APP_PASSWORD (a Yahoo "app password",
 * not the account password — see Yahoo Account Info → Account Security).
 * If unset, the poller simply doesn't start.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  ALLOWED_MIME,
  MAX_BYTES,
  INCOME_SUBJECT_RE,
  getSupabase,
  extractAndSaveAttachment,
  extractAndSaveIncomeAttachment,
  extractAndSaveIncomeFromText,
  extractAndSaveExpenseFromText,
} from "@/lib/email-inbound.server";

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Starts the IMAP poll loop once per server process. No-op if already
 *  started, or if the required env vars aren't configured. */
export function startImapPoller() {
  if (pollTimer) return;

  const host = process.env.YAHOO_IMAP_HOST || "imap.mail.yahoo.com";
  const user = process.env.YAHOO_IMAP_USER;
  const pass = process.env.YAHOO_IMAP_APP_PASSWORD;
  const intervalMs = Number(process.env.IMAP_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS;

  if (!user || !pass) {
    console.log(
      "[imap-poll] YAHOO_IMAP_USER/YAHOO_IMAP_APP_PASSWORD not set — IMAP polling disabled",
    );
    return;
  }

  console.log(`[imap-poll] Starting IMAP poller for ${user} (every ${intervalMs}ms)`);

  const runCycle = () => {
    pollOnce(host, user, pass).catch((err) => console.error("[imap-poll] Poll cycle failed", err));
  };

  runCycle(); // run once immediately on boot
  pollTimer = setInterval(runCycle, intervalMs);
}

async function pollOnce(host: string, user: string, pass: string) {
  const client = new ImapFlow({
    host,
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const supabase = getSupabase();
      const { data: allowed, error: allowedErr } = await supabase
        .from("allowed_sender_emails")
        .select("email");

      if (allowedErr || !allowed || allowed.length === 0) {
        console.error(
          "[imap-poll] Could not load allowed senders — skipping this cycle (fail closed)",
          allowedErr,
        );
        return;
      }

      const allowedSenders = new Set(allowed.map((r) => r.email.toLowerCase().trim()));

      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids || uids.length === 0) return;

      console.log(`[imap-poll] Found ${uids.length} unseen message(s)`);

      for (const uid of uids) {
        try {
          await processMessage(client, supabase, uid, allowedSenders);
        } catch (err) {
          // Leave unseen so it's retried on the next cycle.
          console.error(`[imap-poll] Failed to process UID ${uid} — will retry next cycle`, err);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

async function processMessage(
  client: ImapFlow,
  supabase: ReturnType<typeof getSupabase>,
  uid: number,
  allowedSenders: Set<string>,
) {
  const { content } = await client.download(uid, undefined, { uid: true });
  const chunks: Buffer[] = [];
  for await (const chunk of content) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);

  const parsed = await simpleParser(raw);
  const sender = (parsed.from?.value?.[0]?.address || "").toLowerCase().trim();

  if (!sender || !allowedSenders.has(sender)) {
    console.log(`[imap-poll] Ignoring email from disallowed sender: ${sender || "(unknown)"}`);
    await client.messageFlagsAdd([uid], ["\\Seen"], { uid: true });
    return;
  }

  const subject = parsed.subject?.trim() || null;
  const isIncome = !!subject && INCOME_SUBJECT_RE.test(subject);

  const attachments = (parsed.attachments || []).filter(
    (att) => ALLOWED_MIME.has(att.contentType) && att.size <= MAX_BYTES,
  );

  if (attachments.length > 0) {
    for (const att of attachments) {
      const fileName = att.filename || "attachment";
      if (isIncome) {
        await extractAndSaveIncomeAttachment(
          supabase,
          fileName,
          att.contentType,
          att.content,
          "imap",
        );
      } else {
        await extractAndSaveAttachment(
          supabase,
          fileName,
          att.contentType,
          att.content,
          subject,
          "imap",
        );
      }
    }
  } else {
    const bodyText = parsed.text?.trim() || null;
    if (isIncome && bodyText) {
      await extractAndSaveIncomeFromText(supabase, subject, bodyText, "imap");
    } else if (bodyText) {
      await extractAndSaveExpenseFromText(supabase, subject, bodyText, "imap");
    } else {
      console.log(
        `[imap-poll] Email "${subject ?? "(no subject)"}" had no processable attachment or body text`,
      );
    }
  }

  await client.messageFlagsAdd([uid], ["\\Seen"], { uid: true });
}
