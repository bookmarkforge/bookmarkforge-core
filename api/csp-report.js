/**
 * api/csp-report.js — CSP violation collector for Vercel deployments.
 *
 * P1-2 (review 2026-11-11): this file used to answer `200 {}` without reading
 * the report ("silences 404 errors in Vercel logs"). Every shipped CSP
 * advertises `/csp-report` through `report-uri` and `report-to`, so a stub here
 * turned the security telemetry the headers promise into a silent discard.
 *
 * The Node adapter is intentionally thin: api/_csp-report-core.js owns the
 * validation, bounds, redaction and rate limiting, and this file only moves
 * bytes between Node's req/res and that contract.
 */
import {
  CSP_REPORT_BODY_MAX_BYTES,
  createCspCollector,
} from "./_csp-report-core.js";

// Per-instance singleton, like the license handler: a warm lambda keeps one
// rate-limit window instead of rebuilding it on every request.
const collector = createCspCollector({ salt: process.env.CSP_REPORT_IP_HASH_SALT ?? "" });

const NO_STORE = "no-store";

function clientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = typeof raw === "string" ? raw.split(",")[0] : "";
  return (first || req.socket?.remoteAddress || "unknown").trim().slice(0, 128);
}

function respond(res, status, text) {
  res.statusCode = status;
  res.setHeader("Cache-Control", NO_STORE);
  if (text) res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text ?? "");
}

/** Read the body with a hard cap; Vercel may have pre-parsed it into req.body. */
async function readBoundedBody(req) {
  if (req.body !== undefined) {
    const raw = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
    return raw.length > CSP_REPORT_BODY_MAX_BYTES
      ? { tooLarge: true }
      : { raw: raw.toString("utf8") };
  }
  const declared = Number(req.headers?.["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > CSP_REPORT_BODY_MAX_BYTES) {
    return { tooLarge: true };
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > CSP_REPORT_BODY_MAX_BYTES) return { tooLarge: true };
    chunks.push(chunk);
  }
  return { raw: Buffer.concat(chunks).toString("utf8") };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return respond(res, 405, "Method Not Allowed");
  }
  const body = await readBoundedBody(req);
  if (body.tooLarge) {
    return respond(res, 413, "Payload Too Large");
  }
  const result = await collector.accept(clientIp(req), body.raw);
  if (result.status === 204) return respond(res, 204);
  if (result.status === 429) return respond(res, 429, "Too Many Requests");
  if (result.status === 413) return respond(res, 413, "Payload Too Large");
  return respond(res, 400, "Bad Request");
}

export { collector };
