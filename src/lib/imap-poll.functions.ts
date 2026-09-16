import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { triggerImapPollNow } from "@/lib/email-imap-poll.server";

const COOKIE_NAME = "receipt_roamer_auth_session";

/** Runs one Yahoo IMAP poll cycle immediately — the "Poll now" button on the
 *  Upload Logs page, for checking the poller without waiting for its daily
 *  interval. */
export const runImapPollNow = createServerFn({ method: "POST" }).handler(async () => {
  if (getCookie(COOKIE_NAME) !== "true") {
    throw new Error("Not authenticated");
  }

  return await triggerImapPollNow();
});
