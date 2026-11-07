#!/usr/bin/env node
/**
 * scripts/live-routes-contract.mjs — the SPA route contract, checked against a
 * DEPLOYED host instead of the shipped config files.
 *
 * check:spa-routes (scripts/check-spa-routes.mjs + scripts/spa-route-contract.mjs)
 * is offline by contract: it proves the four host configs *say* the right thing.
 * It cannot see what a host actually *does* with them. Both defects this repo
 * has already paid for lived exactly in that gap:
 *
 *   - Cloudflare's `_redirects` parser silently dropped the app-route block
 *     because it sat after the first dynamic rule, so /security and /settings
 *     answered 404 on the real host while every offline check was green;
 *   - a host that keeps a blanket document fallback answers a typo with the
 *     marketing page and a 200 — a soft 404 that no config-level gate notices
 *     and that a crawler reads as a real page.
 *
 * This module turns the same contract into a request matrix and judges the
 * responses by the HTML they actually serve:
 *
 *   - every client route (scripts/app-routes.mjs, parsed from AppRoutes.tsx —
 *     never retyped) and its trailing-slash twin must be 200 and the SPA shell;
 *   - the public surface (landing, localized landings, legal, help, offline,
 *     Pocket comparison) must be 200 and must NOT be the shell;
 *   - an unknown path must be a real 404 carrying the 404 document.
 *
 * The markers are structural, not marketing copy: the shell is the only page
 * with the React mount point (`id="root"`) — the static landings have none — and
 * the 404 document is the title dist/404.html ships. scripts/check-live-routes.mjs
 * performs the requests; this module is pure so tests can drive it without a
 * network.
 *
 * Node-core only (no deps): the CLI and the tests both import it.
 */
import {
  pathVariants,
  readClientRoutes,
  shellRoutes,
} from "./app-routes.mjs";

/** The React mount point — present in the app shell (dist/app.html), absent from every static landing. */
export const SHELL_MARKER = 'id="root"';

/** The title dist/404.html ships; the 404 document is what an unknown path must answer with. */
export const NOTFOUND_MARKER = "404 - Page Not Found";

/**
 * The public surface, as representative URLs. Each must answer 200 with its own
 * static page and never the private shell. The localized subtrees are included
 * because they own their whole path space (a stale /es/<anything> link lands on
 * the locale's landing — see the _redirects notes) and must still not be the
 * app shell.
 */
export const PUBLIC_SURFACE_PATHS = [
  "/",
  "/es",
  "/es/",
  "/privacy",
  "/terms",
  "/help",
  "/offline",
  "/pocket-alternative",
];

/**
 * Unknown paths. Deliberately root-level or nested-but-not-a-route, and never
 * under a locale prefix: the localized subtree legitimately answers with that
 * locale's landing, so it would be a false positive here.
 *
 * Deliberately NO attack-path probes (/wp-admin, /.env, …). A host's WAF may
 * answer those with 403 — Vercel does exactly that on some projects — and a 403
 * is a security policy, not a routing mistake: it still is not a soft-404
 * landing, which is the failure this list exists to catch. Keeping them here
 * would make the gate fail on host WAF configuration it does not own.
 */
export const UNKNOWN_PATHS = [
  "/no-such-page-lol",
  "/no-such-page-lol/",
  "/no-such-page/extra/deep",
  "/missing.js",
  "/missing.css",
  "/missing.png",
  "/settingsz",
  "/nope/deep/typo",
];

/** Expected outcomes of a matrix case. */
export const EXPECT = {
  SHELL: "shell",
  NOT_SHELL: "not-shell",
  NOTFOUND: "404-page",
};

/**
 * Classify a response body. Only 200 and 404 carry a body worth reading in this
 * contract: a 3xx or a 5xx is already a mismatch on status, and an empty kind
 * keeps that visible instead of mislabeling it.
 *
 * @param {number} status
 * @param {string} body
 * @returns {"shell"|"404-page"|"other"}
 */
export function classifyResponse(status, body) {
  if (status !== 200 && status !== 404) return "other";
  const text = String(body ?? "");
  if (text.includes(NOTFOUND_MARKER)) return "404-page";
  if (text.includes(SHELL_MARKER)) return "shell";
  return "other";
}

/**
 * Build the request matrix: what to ask a deployed host, and what each answer
 * must be. Paths come from the app (shellRoutes parses AppRoutes.tsx), so a new
 * client route is covered by this gate the moment it is declared.
 *
 * @param {string[]} [clientRoutes]
 */
export function buildLiveMatrix(clientRoutes = readClientRoutes()) {
  const cases = [];
  for (const route of shellRoutes(clientRoutes)) {
    for (const path of pathVariants(route)) {
      cases.push({ path, status: 200, expect: EXPECT.SHELL });
    }
  }
  for (const path of PUBLIC_SURFACE_PATHS) {
    cases.push({ path, status: 200, expect: EXPECT.NOT_SHELL });
  }
  for (const path of UNKNOWN_PATHS) {
    cases.push({ path, status: 404, expect: EXPECT.NOTFOUND });
  }
  return cases;
}

/**
 * Judge the responses collected for the matrix.
 *
 * @param {Array<{path:string,status:number,expect:string}>} cases
 * @param {Map<string,{status:number,body:string,error?:string}>} responses
 * @returns {{ok:boolean, failures:string[], checks:number}}
 */
export function assessLiveResults(cases, responses) {
  const failures = [];
  for (const testCase of cases) {
    const { path, status: wantStatus, expect } = testCase;
    const response = responses.get(path);
    if (!response) {
      failures.push(`${path} — no response recorded`);
      continue;
    }
    if (response.error) {
      failures.push(`${path} — request failed: ${response.error}`);
      continue;
    }
    if (response.status !== wantStatus) {
      failures.push(`${path} — expected HTTP ${wantStatus}, got ${response.status}`);
      continue;
    }
    const kind = classifyResponse(response.status, response.body);
    if (expect === EXPECT.SHELL && kind !== "shell") {
      failures.push(`${path} — expected the SPA shell, got ${kind}`);
    } else if (expect === EXPECT.NOT_SHELL && kind === "shell") {
      failures.push(
        `${path} — the public surface must never be answered by the app shell`,
      );
    } else if (expect === EXPECT.NOTFOUND && kind !== "404-page") {
      failures.push(`${path} — expected the 404 document, got ${kind}`);
    }
  }
  return { ok: failures.length === 0, failures, checks: cases.length };
}

/**
 * Validate the base URL a gate run points at. Read-only GETs, so any host is
 * acceptable — but it has to be a plain HTTPS origin: credentials, a port, a
 * query or a fragment would silently probe a different resource than the one
 * the matrix describes.
 *
 * @param {unknown} value
 * @returns {string|null} the normalized origin, or null when unusable
 */
export function validateBaseUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash || url.port) {
      return null;
    }
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}
