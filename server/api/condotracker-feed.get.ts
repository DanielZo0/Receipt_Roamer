/**
 * server/api/condotracker-feed.get.ts
 *
 * Nitro server route -- GET /api/condotracker-feed
 *
 * Machine-to-machine feed polled by CondoTracker's nightly sync. Auth is a
 * shared secret in the X-CondoTracker-Key header: the app's cookie session is
 * for humans, and the Supabase JWT middleware in src/integrations/supabase/
 * is unused scaffolding, so neither fits a server-to-server caller.
 *
 * Query params:
 *   since  ISO timestamp; returns rows created strictly after it (required)
 *   limit  page size, default 200, max 500
 *
 * NOTE: like /api/email-inbound, this handler is only reachable once it is
 * registered in the nitro({ handlers: [...] }) array in vite.config.ts.
 */
import { timingSafeEqual } from "node:crypto";
import { defineEventHandler, getQuery, getRequestHeader, setResponseStatus } from "h3";
import {
  getPendingForCondoTracker,
  MAX_LIMIT,
} from "../../src/lib/condotracker-feed.server";

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, and the length itself is not
  // worth protecting here.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default defineEventHandler(async (event) => {
  const expected = process.env.CONDOTRACKER_API_KEY;
  if (!expected) {
    console.error("[condotracker-feed] CONDOTRACKER_API_KEY is not set; refusing requests.");
    setResponseStatus(event, 503);
    return { message: "Integration not configured" };
  }

  const provided = getRequestHeader(event, "x-condotracker-key");
  if (!provided || !secretMatches(provided, expected)) {
    setResponseStatus(event, 401);
    return { message: "Unauthorized" };
  }

  const query = getQuery(event);
  const since = typeof query.since === "string" ? query.since : "";
  if (!since || Number.isNaN(Date.parse(since))) {
    setResponseStatus(event, 400);
    return { message: "Query param 'since' must be an ISO timestamp" };
  }

  const parsedLimit = Number.parseInt(String(query.limit ?? ""), 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(parsedLimit, MAX_LIMIT) : undefined;

  try {
    return await getPendingForCondoTracker(since, limit);
  } catch (err) {
    console.error(
      "[condotracker-feed] Failed to build feed:",
      err instanceof Error ? err.message : err,
    );
    setResponseStatus(event, 500);
    return { message: "Failed to build feed" };
  }
});
