/**
 * functions/csp-report.mjs — CSP violation collector for the two function
 * runtimes this repo ships side by side.
 *
 * P1-2 (review 2026-11-11): netlify.toml and public/_headers advertise
 * `/csp-report`, but no endpoint existed on either static host (Netlify 404,
 * Vercel answered 200 and discarded). Rather than retract the headers, every
 * host that advertises the endpoint now has a collector:
 *
 *   - `handler(event)`          → Netlify Functions (AWS-event signature)
 *   - `onRequest(context)`      → Cloudflare Pages Functions (fetch signature)
 *
 * Both delegate to api/_csp-report-core.js so validation, bounds, redaction
 * and rate limiting cannot drift between hosts. This file is the one place
 * where the two runtimes' request shapes are translated; nothing is stored
 * longer than the isolate lives, and each accepted violation is emitted as a
 * structured `csp_violation` log line.
 */
import { createCspCollector } from "../api/_csp-report-core.js";

const collector = createCspCollector({ salt: process.env?.CSP_REPORT_IP_HASH_SALT ?? "" });

const NO_STORE = "no-store";
const TEXT = "text/plain; charset=utf-8";

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) ?? "";
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] : String(value ?? "");
  }
  return "";
}

function clientIp(headers) {
  // M-5 (audit 2026-11-14): platform-attested headers first — cf-connecting-ip
  // (Cloudflare) and x-nf-client-connection-ip (Netlify) cannot be spoofed by
  // the client, unlike a leading X-Forwarded-For entry.
  const cfIp = headerValue(headers, "cf-connecting-ip").trim();
  if (cfIp) return cfIp.slice(0, 128);
  const nfIp = headerValue(headers, "x-nf-client-connection-ip").trim();
  if (nfIp) return nfIp.split(",")[0].slice(0, 128);
  const forwarded = headerValue(headers, "x-forwarded-for");
  const first = forwarded.split(",")[0];
  return (first || "unknown").trim().slice(0, 128);
}

function statusText(status) {
  if (status === 413) return "Payload Too Large";
  if (status === 429) return "Too Many Requests";
  if (status === 400) return "Bad Request";
  return "";
}

/** Netlify Functions entry point. */
export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Cache-Control": NO_STORE, "Content-Type": TEXT },
      body: "Method Not Allowed",
    };
  }
  const rawBody = event.isBase64Encoded
    ? typeof Buffer !== "undefined"
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : atob(event.body ?? "")
    : (event.body ?? "");
  const result = await collector.accept(clientIp(event.headers), rawBody);
  return {
    statusCode: result.status,
    headers: { "Cache-Control": NO_STORE, "Content-Type": TEXT },
    body: statusText(result.status),
  };
}

/** Cloudflare Pages Functions entry point. */
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "Cache-Control": NO_STORE, "Content-Type": TEXT },
    });
  }
  const rawBody = await request.text();
  const result = await collector.accept(
    clientIp(request.headers),
    rawBody,
    env?.CSP_REPORT_IP_HASH_SALT,
  );
  // The Workers Response constructor rejects a body with 204, so the accepted
  // path must send none (a body on 204 is a protocol error anyway).
  return new Response(result.status === 204 ? null : statusText(result.status), {
    status: result.status,
    headers: { "Cache-Control": NO_STORE, "Content-Type": TEXT },
  });
}

export { collector };
