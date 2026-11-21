/**
 * api/_csp-report-core.js — shared CSP violation collector logic.
 *
 * every shipped CSP advertises `/csp-report`
 * (report-uri + report-to), but only the self-hosted nginx had a collector.
 * On Vercel the endpoint was a stub that answered 200 and discarded the
 * report; Netlify answered 404. The operator believed violation telemetry was
 * being collected when it was being thrown away.
 *
 * Every host that serves that CSP now gets a real endpoint built on this
 * module: `api/csp-report.js` (Vercel, Node) and `functions/csp-report.mjs`
 * (Netlify Functions + Cloudflare Pages Functions). The collector validates,
 * bounds, redacts and records — it never stores the client IP, raw script
 * samples or full document URLs.
 *
 * Dependency-free on purpose: it runs on Node 22+ and on the Workers runtime
 * (WebCrypto only, no node:crypto/fs imports).
 */

/** Largest body accepted; browsers send a few hundred bytes per violation. */
export const CSP_REPORT_BODY_MAX_BYTES = 16_384;
/** Reports accepted per client per window (per isolate — best effort). */
export const CSP_REPORT_LIMIT = 30;
export const CSP_REPORT_WINDOW_MS = 60_000;
/** Recent reports retained in memory for diagnostics/tests. */
export const CSP_REPORT_MAX = 200;
/** Cardinality cap on the rate-limit map, so spoofed IPs cannot grow it. */
export const CSP_REPORT_RATE_MAX_ENTRIES = 10_000;

/** Origin only: path, query and fragment are dropped (they can carry data). */
export function redactOrigin(value) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return "opaque";
  }
}

function boundedString(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Accept both wire shapes:
 * - `report-uri` (legacy): { "csp-report": {... } }
 * - Reporting API (report-to): { type: "csp-violation", body: {... } }
 * Anything else is a malformed report and is rejected.
 */
export function parseCspReport(raw) {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "invalid_report" };
  const violation =
    parsed["csp-report"] ??
    (parsed.type === "csp-violation" && parsed.body && typeof parsed.body === "object"
      ? parsed.body
      : null);
  if (!violation || typeof violation !== "object") {
    return { ok: false, reason: "missing_csp_report" };
  }
  return { ok: true, violation };
}

/** Turn a violation into the bounded, redacted record that is logged. */
export function toStoredReport(violation, { ipHash, timestamp }) {
  return {
    timestamp,
    ipHash,
    blockedOrigin: redactOrigin(violation["blocked-uri"] ?? violation.blockedURL),
    documentOrigin: redactOrigin(violation["document-uri"] ?? violation.documentURL),
    violatedDirective: boundedString(
      violation["effective-directive"] ?? violation.effectiveDirective ?? violation["violated-directive"],
      200,
    ),
    disposition: boundedString(violation.disposition, 32) || "enforce",
  };
}

/**
 * One-way IP fingerprint. The salt is per-instance when the deployment does not
 * configure one — an empty salt made IPv4 hashes
 * enumerable offline, so the default is now a random per-isolate salt
 * (crypto.randomUUID, available on Node 19+ and Workers). With a random salt
 * an IP can never be recovered from the record and hashes are not comparable
 * across instances; set CSP_REPORT_IP_HASH_SALT for stable cross-instance
 * correlation.
 */
export async function hashIp(ip, salt = "") {
  const input = new TextEncoder().encode(`${salt}:${ip}`);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "unhashed";
  const digest = await subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Monotonic fixed-window limiter with a FIFO prune (expired windows are always
 * a prefix) and a hard entry cap. Per isolate: a documented best-effort control,
 * like the license limiter.
 */
export function createRateLimiter({
  limit = CSP_REPORT_LIMIT,
  windowMs = CSP_REPORT_WINDOW_MS,
  maxEntries = CSP_REPORT_RATE_MAX_ENTRIES,
  now = () => Date.now(),
} = {}) {
  const windows = new Map();
  const prune = (current) => {
    const cutoff = current - windowMs;
    while (windows.size > 0) {
      const oldest = windows.entries().next().value;
      if (!oldest || oldest[1].start >= cutoff) break;
      windows.delete(oldest[0]);
    }
  };
  return {
    /** @returns {boolean} true when this client is over its window budget */
    limited(ip) {
      const current = now();
      prune(current);
      const entry = windows.get(ip);
      if (entry && current - entry.start < windowMs) {
        if (entry.count >= limit) return true;
        entry.count += 1;
        return false;
      }
      if (windows.size >= maxEntries) return true;
      windows.set(ip, { count: 1, start: current });
      return false;
    },
    size: () => windows.size,
  };
}

/**
 * Build a collector. `accept()` is the whole endpoint contract:
 * 204 accepted · 400 malformed · 413 too large · 429 rate limited.
 * The only side effect is one structured log line per accepted report.
 */
export function createCspCollector({ salt = "", now = () => Date.now() } = {}) {
  // never hash with an empty salt — fall back to a random per-isolate
  // salt so logged ipHash values are not offline-enumerable.
  const resolvedSalt =
    salt ||
    (typeof globalThis.crypto?.randomUUID === "function"
      ? `isolate:${globalThis.crypto.randomUUID()}`
      : "");
  const rateLimiter = createRateLimiter({ now });
  const reports = [];
  let accepted = 0;
  let rejected = 0;
  let rateLimited = 0;

  async function accept(ip, rawBody, saltOverride) {
    if (rateLimiter.limited(ip)) {
      rateLimited += 1;
      return { status: 429 };
    }
    const size = typeof rawBody === "string" ? rawBody.length : 0;
    if (size > CSP_REPORT_BODY_MAX_BYTES) return { status: 413 };
    const parsed = parseCspReport(rawBody);
    if (!parsed.ok) {
      rejected += 1;
      return { status: 400, reason: parsed.reason };
    }
    const effectiveSalt = saltOverride || resolvedSalt;
    const stored = toStoredReport(parsed.violation, {
      ipHash: await hashIp(ip, effectiveSalt),
      timestamp: new Date(now()).toISOString(),
    });
    if (reports.length >= CSP_REPORT_MAX) {
      reports.splice(0, reports.length - CSP_REPORT_MAX + 1);
    }
    reports.push(stored);
    accepted += 1;
    // Structured log: the only place a violation becomes observable in a
    // serverless runtime (no persistent collector). Never raw IP, never
    // script-sample, never a full document URL.
    console.error(JSON.stringify({ event: "csp_violation", ...stored }));
    return { status: 204, stored };
  }

  return {
    accept,
    stats: () => ({ accepted, rejected, rateLimited, retained: reports.length }),
    recent: () => reports.slice(-50),
  };
}
