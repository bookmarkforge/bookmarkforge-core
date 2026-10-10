/**
 * scripts/csp-config.js — canonical CSP profiles.
 *
 * Single source of truth for the runtime CSP meta-override
 * (src/utils/cspReportThrottle.ts reads the __CSP_*__ defines this file
 * feeds via `define` in vite.config.ts / vitest.config.ts).
 *
 * Reconstructed from the shipped production policy (dist/_headers):
 *   - MODERATE is EXACTLY the production header policy (no-op at runtime),
 *     directive order included.
 *   - STRICT is the privacy-maximal variant: no cloud AI provider hosts in
 *     connect-src (self + own signaling + cloud-sync OAuth only).
 *   - OPEN is the development profile (unsafe-inline/unsafe-eval + localhost);
 *     cspReportThrottle degrades OPEN to MODERATE in production builds.
 *
 * NOTE: every directive is `;`-separated — a missing separator makes the
 * whole policy invalid per the CSP spec (the meta override would be
 * silently dropped).
 */

/**
 * Primary domain for this deployment. Override at build/deploy time with
 * BOOKMARKFORGE_DOMAIN (no trailing slash); defaults to the product domain.
 * Drives the CSP report-uri endpoint and the self-hosted P2P signaling host.
 */
export const APP_DOMAIN = (
  process.env.BOOKMARKFORGE_DOMAIN ?? "bookmarkforgeapp.com"
).replace(/\/+$/, "");
const SIGNALING_WS = `wss://signal.${APP_DOMAIN}`;

/** Directives before connect-src (matches the _headers order). */
const BASE =
  "default-src 'self';" +
  " script-src 'self' 'wasm-unsafe-eval';" +
  " style-src 'self';" +
  " style-src-attr 'unsafe-inline';" +
  " font-src 'self' data:;" +
  " img-src 'self' blob: data:;" +
  " connect-src 'self'";

/** Directives after connect-src (matches the _headers order). */
const TAIL =
  " media-src 'self' blob:;" +
  " worker-src 'self' blob:; child-src 'self' blob:;" +
  " manifest-src 'self'; base-uri 'self'; form-action 'self';" +
  " frame-src 'none'; frame-ancestors 'none'; object-src 'none';" +
  " upgrade-insecure-requests";

/** Cloud AI + sync hosts allowed by the default (MODERATE) profile. */
const CLOUD_AI_AND_SYNC =
  " https://api.openai.com https://api.anthropic.com https://api.groq.com" +
  " https://openrouter.ai https://generativelanguage.googleapis.com" +
  " https://huggingface.co https://oauth2.googleapis.com" +
  " https://www.googleapis.com https://api.dropboxapi.com" +
  " https://content.dropboxapi.com https://graph.microsoft.com" +
  " https://api.box.com https://upload.box.com https://api.pcloud.com" +
  " https://signaling.rxdb.info wss://signaling.rxdb.info" +
  " https://signaling.pubnub.com wss://signaling.pubnub.com/v1/subscribe" +
  ` ${SIGNALING_WS}`;

/**
 * Optional Sentry ingest host for remote error reporting. Derived from the
 * operator's VITE_SENTRY_DSN at build time; when unset (default) the CSP is
 * unchanged and error reporting stays strictly local. Only added to the
 * MODERATE profile — CSP_STRICT stays privacy-maximal (see check:csp-sync).
 * After changing it, regenerate the shipped copies: `npm run nginx:render`.
 */
const SENTRY_DSN = process.env.VITE_SENTRY_DSN ?? "";
const SENTRY_HOST = (() => {
  if (!SENTRY_DSN) return "";
  try {
    return new URL(SENTRY_DSN).host;
  } catch {
    return "";
  }
})();
const SENTRY_CONNECT = SENTRY_HOST ? ` https://${SENTRY_HOST}` : "";

/** Identical to the shipped production header policy (dist/_headers). */
// report-uri endpoint — declared here so CSP_MODERATE/CSP_STRICT can
// reference it inline.
const REPORT_URI = `https://${APP_DOMAIN}/csp-report`;

// B2 (audit 2026-08-13): CSP3 `report-to` group, kept ALONGSIDE report-uri.
// Per the CSP spec, when both directives are present `report-to` takes
// precedence in supporting engines (Chrome 96+, Firefox 96+); Safari and
// other legacy engines keep delivering via `report-uri`. The group must be
// defined by a `Report-To` HTTP response header (REPORT_TO_HEADER below) on
// every deployment path — check:csp enforces it in all five copies.
const REPORT_TO_GROUP = "csp-endpoint";

/**
 * `Report-To` HTTP response header value defining the group referenced by
 * the `report-to` CSP directive. Shipped alongside CSP on every deployment
 * path (nginx, Cloudflare Pages, Netlify) so modern browsers can deliver
 * violation reports to the same collector.
 */
export const REPORT_TO_HEADER = JSON.stringify({
  group: REPORT_TO_GROUP,
  max_age: 86400,
  endpoints: [{ url: REPORT_URI }],
});

// Reporting API's current header syntax. Keep Report-To as a compatibility
// header for browsers that still implement the older endpoint-group format.
// The Reporting-Endpoints URL is RELATIVE to the document origin: browsers
// resolve it against whatever domain serves the app, so self-hosted
// deployments deliver violation reports to their own /csp-report collector
// instead of leaking browser metadata to the product domain. (report-uri
// below stays absolute because the CSP spec requires it; report-to takes
// precedence in modern browsers.)
export const REPORTING_ENDPOINTS_HEADER =
  `${REPORT_TO_GROUP}="/csp-report"`;

export const CSP_MODERATE =
  `${BASE}${CLOUD_AI_AND_SYNC}${SENTRY_CONNECT};${TAIL}` +
  `; report-uri ${REPORT_URI}; report-to ${REPORT_TO_GROUP}`;

/** Privacy-maximal: no cloud AI providers in connect-src. */
export const CSP_STRICT =
  `${BASE} https://oauth2.googleapis.com https://www.googleapis.com` +
  ` ${SIGNALING_WS};${TAIL}` +
  `; report-uri ${REPORT_URI}; report-to ${REPORT_TO_GROUP}`;

/** Development-only profile (degraded to MODERATE in production). */
export const CSP_OPEN =
  "default-src 'self' http://localhost:* ws://localhost:*;" +
  " script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*;" +
  " style-src 'self' 'unsafe-inline';" +
  " font-src 'self' data: http: https:;" +
  " img-src 'self' blob: data: http: https:;" +
  " connect-src 'self' http://localhost:* ws://localhost:* http: https: ws: wss:;" +
  " media-src 'self' blob:;" +
  " worker-src 'self' blob: http://localhost:*;" +
  " child-src 'self' blob:;" +
  " manifest-src 'self'; base-uri 'self'; form-action *; frame-src *;" +
  " frame-ancestors *; object-src 'none'";

// ─── Cross-origin isolation headers (not CSP directives) ────────────
//
// COEP + COOP enable cross-origin isolation for the browsing context.
// Required for SharedArrayBuffer (WebLLM / transformers.js WASM
// threading) and closes XS-Leaks / Spectre-style side-channel vectors.
// These are HTTP response headers — they cannot be enforced via <meta>
// and are shipped as part of the security-header block alongside CSP.

export const COEP = "require-corp";
export const COOP = "same-origin";

/**
 * CSP violation report endpoint. Browsers POST JSON violation reports
 * here when the CSP blocks a resource or script (via the modern
 * Reporting-Endpoints header, the Report-To compatibility header, or the
 * legacy report-uri fallback). Operators can deploy a
 * collector at this path (e.g. a Cloudflare Worker, nginx log, or the
 * optional companion server) to monitor for misconfiguration and attacks.
 */
export const CSP_REPORT_URI = REPORT_URI;
