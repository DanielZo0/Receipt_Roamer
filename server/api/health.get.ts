/**
 * server/api/health.get.ts
 *
 * Nitro server route — GET /api/health
 *
 * Railway's healthcheck target. It deliberately does no work: no database
 * call, no session lookup, no React render. It answers the one question the
 * platform is asking — "is this replica accepting HTTP?" — and nothing else.
 *
 * This exists because the healthcheck used to point at "/", which the auth
 * gate in src/routes/__root.tsx answers with a 307 to /login for any
 * unauthenticated caller. Railway reads that redirect as unhealthy, so every
 * deploy failed once login was introduced. An unauthenticated endpoint that
 * cannot redirect is the fix.
 *
 * NOTE: like the other handlers, this is only reachable once registered in the
 * nitro({ handlers: [...] }) array in vite.config.ts.
 */
import { defineEventHandler } from "h3";

export default defineEventHandler(() => ({
  status: "ok",
  uptime: Math.round(process.uptime()),
}));
