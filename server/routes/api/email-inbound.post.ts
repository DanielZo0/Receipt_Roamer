/**
 * server/routes/api/email-inbound.post.ts
 *
 * Nitro server route — POST /api/email-inbound
 *
 * This file uses the Nitro file-based routing convention:
 *   <filename>.<method>.ts → handles only that HTTP method.
 *
 * Mailgun posts multipart/form-data to this URL whenever an email arrives
 * at the configured inbound address. Verification, sender filtering, and
 * attachment extraction live in src/lib/email-inbound.server.ts.
 */
import { handleMailgunWebhook } from "../../src/lib/email-inbound.server";

export default defineEventHandler(async (event) => {
  // Read raw body bytes so we can reconstruct a standard Request for our handler.
  const rawBody = await readRawBody(event, false); // false = return Buffer/Uint8Array
  const headers = new Headers();
  for (const [key, value] of Object.entries(getHeaders(event))) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const url = new URL(
    getRequestURL(event).href || `http://localhost/api/email-inbound`,
  );

  const request = new Request(url, {
    method: "POST",
    headers,
    body: rawBody ?? undefined,
  });

  const response = await handleMailgunWebhook(request);
  const text = await response.text();

  setResponseStatus(event, response.status);
  return text;
});
