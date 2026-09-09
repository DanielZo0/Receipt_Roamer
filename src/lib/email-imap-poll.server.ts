/**
 * email-imap-poll.server.ts
 *
 * Polls a mailbox (Yahoo Mail, which has no working forwarding option on
 * free personal accounts) via IMAP on an interval, and feeds newly-arrived
 * mail through the same extraction pipeline helpers the Mailgun webhook uses
 * (src/lib/email-inbound.server.ts).
 *
 * "Newly arrived" is tracked via a UID watermark (imap_poll_state table),
 * NOT the \Seen flag — an earlier version searched for \Seen-flag "unseen"
 * mail, which on a real personal inbox also matched thousands of old unread
 * marketing emails and made the Yahoo server drop the connection mid-poll.
 * The watermark means the poller only ever looks at mail that arrived after
 * it first ran; on that very first run it just baselines and skips the
 * existing backlog entirely rather than processing it.
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

const DEFAULT_POLL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day

// Upper bound on how many new messages a single poll cycle will fetch, so a
// large backlog (e.g. the watermark somehow resets) gets worked through a
// batch at a time on subsequent cycles instead of hammering the IMAP server.
const MAX_MESSAGES_PER_CYCLE = 50;

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

/** Reads the stored watermark for a mailbox. `ok: false` means the read
 *  itself failed (caller should skip the cycle); `lastUid: null` means no
 *  watermark has been stored yet (this mailbox has never been polled). */
async function getLastUid(
  supabase: ReturnType<typeof getSupabase>,
  mailbox: string,
): Promise<{ ok: true; lastUid: number | null } | { ok: false }> {
  const { data, error } = await supabase
    .from("imap_poll_state")
    .select("last_uid")
    .eq("mailbox", mailbox)
    .maybeSingle();
  if (error) {
    console.error("[imap-poll] Failed to read imap_poll_state — skipping this cycle", error);
    return { ok: false };
  }
  return { ok: true, lastUid: data?.last_uid ?? null };
}

async function setLastUid(
  supabase: ReturnType<typeof getSupabase>,
  mailbox: string,
  lastUid: number,
) {
  const { error } = await supabase
    .from("imap_poll_state")
    .upsert(
      { mailbox, last_uid: lastUid, updated_at: new Date().toISOString() },
      { onConflict: "mailbox" },
    );
  if (error) {
    console.error("[imap-poll] Failed to persist imap_poll_state", error);
  }
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
      const mailbox = user.toLowerCase().trim();
      const uidNext = (client.mailbox as { uidNext: number }).uidNext;

      const lastUidResult = await getLastUid(supabase, mailbox);
      if (!lastUidResult.ok) return; // read failed — already logged
      const storedLastUid = lastUidResult.lastUid;

      if (storedLastUid === null) {
        // First run ever for this mailbox: baseline at the current high-water
        // mark and skip the existing backlog entirely — we only want mail
        // that arrives from now on.
        await setLastUid(supabase, mailbox, uidNext - 1);
        console.log(
          `[imap-poll] First run for ${mailbox} — baselining at UID ${uidNext - 1}, skipping existing backlog`,
        );
        return;
      }

      if (uidNext - 1 <= storedLastUid) {
        return; // nothing new since last cycle
      }

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

      const uids = await client.search({ uid: `${storedLastUid + 1}:*` }, { uid: true });
      if (!uids || uids.length === 0) {
        await setLastUid(supabase, mailbox, uidNext - 1);
        return;
      }

      uids.sort((a, b) => a - b);
      const batch = uids.slice(0, MAX_MESSAGES_PER_CYCLE);
      console.log(
        `[imap-poll] Found ${uids.length} new message(s) for ${mailbox}, processing ${batch.length}`,
      );

      let maxAttemptedUid = storedLastUid;
      for (const uid of batch) {
        try {
          await processMessage(client, supabase, uid, allowedSenders);
        } catch (err) {
          console.error(`[imap-poll] Failed to process UID ${uid}`, err);
        }
        maxAttemptedUid = Math.max(maxAttemptedUid, uid);
      }

      // Advance the watermark past everything attempted this cycle (success
      // or failure) so a single bad message can't stall the poller forever.
      // If there's more backlog than MAX_MESSAGES_PER_CYCLE, the watermark
      // only advances to the end of this batch, and the rest is picked up on
      // the next cycle.
      const newLastUid = batch.length < uids.length ? maxAttemptedUid : uidNext - 1;
      await setLastUid(supabase, mailbox, newLastUid);
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
  if (!content) {
    throw new Error(`Empty download response for UID ${uid} (message may no longer exist)`);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of content) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);

  const parsed = await simpleParser(raw);
  const sender = (parsed.from?.value?.[0]?.address || "").toLowerCase().trim();

  if (!sender || !allowedSenders.has(sender)) {
    console.log(`[imap-poll] Ignoring email from disallowed sender: ${sender || "(unknown)"}`);
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
          sender,
          "imap",
        );
      }
    }
  } else {
    const bodyText = parsed.text?.trim() || null;
    if (isIncome && bodyText) {
      await extractAndSaveIncomeFromText(supabase, subject, bodyText, "imap");
    } else if (bodyText) {
      await extractAndSaveExpenseFromText(supabase, subject, bodyText, sender, "imap");
    } else {
      console.log(
        `[imap-poll] Email "${subject ?? "(no subject)"}" had no processable attachment or body text`,
      );
    }
  }
}
