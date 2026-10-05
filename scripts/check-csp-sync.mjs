/**
 * scripts/check-csp-sync.mjs — CSP sync gate.
 *
 * The Content-Security-Policy is security-critical and exists in four
 * shipped copies (the runtime meta-override in src/utils/cspReportThrottle.ts
 * is fed from the same source):
 *
 *   1. scripts/csp-config.js            (canonical CSP_MODERATE)
 *   2. public/_headers                  (Cloudflare Pages)
 *   3. public/nginx.conf                (self-hosted Docker / nginx)
 *   4. netlify.toml                     (Netlify)
 *
 * Drift between copies means one deployment path serves a stale policy.
 * This gate verifies every copy carries CSP_MODERATE verbatim, that
 * CSP_STRICT stays privacy-maximal (own OAuth + signaling only), and that
 * the dev-only CSP_OPEN never ships.
 *
 * The check logic is a pure function (`runCspSyncChecks`) that receives the
 * CSP constants and per-copy contents, so unit tests can drive it with
 * in-memory fixtures; the CLI wrapper below performs the file I/O.
 *
 * Usage: node scripts/check-csp-sync.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APP_DOMAIN,
  CSP_MODERATE,
  CSP_OPEN,
  CSP_STRICT,
  COEP,
  COOP,
  REPORT_TO_HEADER,
  REPORTING_ENDPOINTS_HEADER,
} from "./csp-config.js";

const ROOT = process.cwd();

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\const ROOT = process.cwd();");
}

// Hosts that were deliberately removed for privacy/security must never
// be re-added to any CSP copy. This gate catches accidental re-introduction.
export const FORBIDDEN_HOSTS = [
  "api.microlink.io", // removed for zero-knowledge privacy (see MetadataService.ts)
];

// ── Pure check logic (unit-testable with in-memory fixtures) ─────────

/**
 * Run all invariants against in-memory fixtures.
 *
 * @param {object} inputs
 * @param {string} inputs.cspModerate  canonical CSP_MODERATE value
 * @param {string} inputs.cspOpen      dev-only CSP_OPEN value
 * @param {string} inputs.cspStrict    CSP_STRICT value
 * @param {string} inputs.coep         canonical COEP value
 * @param {string} inputs.coop         canonical COOP value
 * @param {string} inputs.reportToHeader canonical Report-To header value
 * @param {string} inputs.reportingEndpointsHeader canonical Reporting-Endpoints header value
 * @param {string[]} inputs.forbiddenHosts hosts that must never appear
 * @param {Array<{label: string, content: string|null}>} inputs.copies
 *   label + file content (null = file absent)
 * @returns {{ ok: boolean, oks: string[], failures: string[] }}
 */
export function runCspSyncChecks({
  cspModerate,
  cspOpen,
  cspStrict,
  coep,
  coop,
  reportToHeader,
  reportingEndpointsHeader,
  forbiddenHosts = FORBIDDEN_HOSTS,
  copies,
}) {
  const failures = [];
  const oks = [];
  const fail = (msg) => failures.push(msg);
  const ok = (msg) => oks.push(msg);

  // ─── 1. Every copy carries CSP_MODERATE verbatim ─────────────────────
  for (const copy of copies) {
    if (copy.content === null) {
      // Missing-file policy is decided by the CLI wrapper (optional vs required).
      continue;
    }
    const content = copy.content;
    if (content.includes(cspModerate)) {
      ok(`${copy.label}: CSP_MODERATE verbatim`);
    } else {
      fail(`${copy.label}: CSP_MODERATE not found verbatim`);
    }
    // The dev profile must never be served by a deployment path.
    if (content.includes(cspOpen)) {
      fail(`${copy.label}: CSP_OPEN (dev profile) must never ship`);
    }
  }

  // ─── 2. CSP_STRICT stays privacy-maximal ─────────────────────────────
  const strictConnect = cspStrict.match(/connect-src 'self'[^;]*/)?.[0] ?? "";
  const strictHosts = strictConnect
    .replace("connect-src 'self'", "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const ALLOWED_STRICT_HOSTS = new Set([
    "https://oauth2.googleapis.com",
    "https://www.googleapis.com",
    `wss://signal.${APP_DOMAIN}`,
  ]);
  const unknown = strictHosts.filter((h) => !ALLOWED_STRICT_HOSTS.has(h));
  if (unknown.length > 0) {
    fail(`CSP_STRICT connect-src widened: ${unknown.join(", ")}`);
  } else {
    ok(`CSP_STRICT: ${strictHosts.length} hosts (own OAuth + signaling only)`);
  }

  // ─── 3. Inline/eval hardening + directive count sanity ────────────────
  // React emits dynamic `style={{...}}` as HTML style attributes. Permit that
  // narrowly through CSP3 `style-src-attr`, while keeping inline style blocks
  // and every form of inline/eval script forbidden.
  const directives = new Map(
    [...cspModerate.matchAll(/(?:^|;)[ ]*([a-z-]+)[ ]+([^;]*)/gi)].map((match) => [
      match[1].toLowerCase(),
      match[2].trim().split(" ").filter(Boolean),
    ]),
  );
  for (const [directive, tokens] of directives) {
    if (tokens.includes("'unsafe-eval'")) {
      fail(`CSP_MODERATE contains forbidden 'unsafe-eval' directive`);
    }
    if (tokens.includes("'unsafe-inline'") && directive !== "style-src-attr") {
      fail(`CSP_MODERATE contains forbidden 'unsafe-inline' directive`);
    }
  }
  const styleAttrTokens = directives.get("style-src-attr") ?? [];
  if (styleAttrTokens.length !== 1 || !styleAttrTokens.includes("'unsafe-inline'")) {
    fail("CSP_MODERATE: style-src-attr must explicitly allow 'unsafe-inline'");
  } else {
    ok("CSP_MODERATE: style-src-attr allows inline style attributes only");
  }
  const directiveCount = cspModerate.split(";").filter((d) => d.trim().length > 0).length;
  if (directiveCount !== 19) {
    fail(`CSP_MODERATE: expected 19 directives, got ${directiveCount}`);
  } else {
    ok(`CSP_MODERATE: ${directiveCount} directives`);
  }

  // ─── 4. Cross-origin isolation headers (COEP + COOP) ─────────────
  for (const copy of copies) {
    if (copy.content === null) continue;
    const content = copy.content;
    const coepRE = new RegExp(
      `Cross-Origin-Embedder-Policy\\s*[:=]?\\s*"?${escapeRegExp(coep)}"?`,
    );
    const coopRE = new RegExp(
      `Cross-Origin-Opener-Policy\\s*[:=]?\\s*"?${escapeRegExp(coop)}"?`,
    );
    if (!coepRE.test(content)) fail(`${copy.label}: COEP not found`);
    if (!coopRE.test(content)) fail(`${copy.label}: COOP not found`);
    // B2: the `report-to` directive is useless without a Report-To header
    // defining the group — modern browsers silently drop reports.
    if (!content.includes(reportingEndpointsHeader)) {
      fail(`${copy.label}: Reporting-Endpoints header missing (modern reporting group undefined)`);
    }
    if (!content.includes(reportToHeader)) {
      fail(`${copy.label}: Report-To header missing (report-to group undefined)`);
    }
  }
  ok(`COEP=${coep} COOP=${coop} Reporting-Endpoints + Report-To in all copies`);

  // ─── 5. Forbidden hosts regression guard ──────────────────────────
  for (const copy of copies) {
    if (copy.content === null) continue;
    const content = copy.content;
    // Exclude comment lines so documentation references (e.g. "was
    // removed") don't trigger false positives.
    const nonCommentLines = content
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return (
          !trimmed.startsWith("#") &&
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("/*") &&
          !trimmed.startsWith("*")
        );
      })
      .join("\n");
    for (const host of forbiddenHosts) {
      if (nonCommentLines.includes(host)) {
        fail(`${copy.label}: forbidden host "${host}" found — must not be re-added`);
      }
    }
  }
  ok(`no forbidden hosts: ${forbiddenHosts.join(", ")}`);

  return { ok: failures.length === 0, oks, failures };
}

// ── CLI wrapper (file I/O + output) ──────────────────────────────────

const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const copies = [
    { label: "public/_headers", path: join(ROOT, "public", "_headers"), required: true },
    { label: "public/nginx.conf", path: join(ROOT, "public", "nginx.conf"), required: true },
    { label: "netlify.toml", path: join(ROOT, "netlify.toml"), required: false },
    // dist/_headers is emitted by the build; validate it when present so a
    // freshly built artifact is verified without forcing a build on every run.
    { label: "dist/_headers", path: join(ROOT, "dist", "_headers"), required: false },
  ];

  const withContents = copies.map((c) => ({
    label: c.label,
    content: existsSync(c.path) ? readFileSync(c.path, "utf8") : null,
    required: c.required,
  }));

  // Missing required copies are failures reported before the pure check.
  const missingRequired = withContents.filter((c) => c.content === null && c.required);
  for (const c of missingRequired) {
    console.error(`[check-csp-sync] FAIL ${c.label}: file missing`);
  }
  for (const c of withContents) {
    if (c.content === null && !c.required) {
      console.log(`[check-csp-sync] ${c.label}: absent (optional)`);
    }
  }

  const result = runCspSyncChecks({
    cspModerate: CSP_MODERATE,
    cspOpen: CSP_OPEN,
    cspStrict: CSP_STRICT,
    coep: COEP,
    coop: COOP,
    reportToHeader: REPORT_TO_HEADER,
    reportingEndpointsHeader: REPORTING_ENDPOINTS_HEADER,
    copies: withContents.map(({ label, content }) => ({ label, content })),
  });
  for (const o of result.oks) console.log(`[check-csp-sync] ok ${o}`);
  for (const f of result.failures) console.error(`[check-csp-sync] FAIL ${f}`);

  const totalFailures = result.failures.length + missingRequired.length;
  if (totalFailures > 0) {
    console.error(`[check-csp-sync] ${totalFailures} failure(s) — fix the copy before deploying`);
    process.exit(1);
  }
  console.log("[check-csp-sync] all copies in sync");
}
