/**
 * Unit + integration tests for scripts/check-csp-sync.mjs
 *
 * Unit: `runCspSyncChecks` is a pure function — fixtures are in-memory
 * (CSP constants + per-copy contents). Integration: the CLI is spawned
 * (a) against the real repo (exit 0) and (b) against a temp-dir scaffold
 * where one copy is missing the canonical CSP (exit 1).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runCspSyncChecks,
} from "../../../scripts/check-csp-sync.mjs";
import { runNpm } from "./run-npm";

// ─── Fixtures ────────────────────────────────────────────────────────

// 19 directives — matches the real gate's directive-count invariant.
const MODERATE = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' wss://signal.bookmarkforge.com",
  "media-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "child-src blob:",
  "upgrade-insecure-requests",
  "report-uri /api/csp-report",
  "report-to csp-endpoint",
].join("; ");

const OPEN = "default-src *; script-src * 'unsafe-inline' 'unsafe-eval'";
const STRICT =
  "default-src 'self'; connect-src 'self' https://oauth2.googleapis.com https://www.googleapis.com wss://signal.bookmarkforge.com; script-src 'self'";
const COEP = "require-corp";
const COOP = "same-origin";const REPORT_TO =
  '{"group":"csp-endpoint","max_age":86400,"endpoints":[{"url":"https://bookmarkforge.com/csp-report"}]}';
const REPORTING_ENDPOINTS =
  'csp-endpoint="https://bookmarkforge.com/csp-report"';

const HEADERS = `Content-Security-Policy: ${MODERATE}\nCross-Origin-Embedder-Policy: ${COEP}\nCross-Origin-Opener-Policy: ${COOP}\nReporting-Endpoints: ${REPORTING_ENDPOINTS}\nReport-To: ${REPORT_TO}\n`;

// Every copy carries CSP_MODERATE + COEP + COOP (the real files do too — the
// gate requires all three in each deployment copy).
function copies(headers = HEADERS): Array<{ label: string; content: string | null }> {
  return [
    { label: "public/_headers", content: headers },
    { label: "public/nginx.conf", content: `add_header Content-Security-Policy "${MODERATE}";\nadd_header Cross-Origin-Embedder-Policy "${COEP}";\nadd_header Cross-Origin-Opener-Policy "${COOP}";\nadd_header Reporting-Endpoints '${REPORTING_ENDPOINTS}';\nadd_header Report-To '${REPORT_TO}';` },
    { label: "netlify.toml", content: `X-Frame-Options = "DENY"\nContent-Security-Policy = "${MODERATE}"\nCross-Origin-Embedder-Policy = "${COEP}"\nCross-Origin-Opener-Policy = "${COOP}"\nReporting-Endpoints = '${REPORTING_ENDPOINTS}'\nReport-To = '${REPORT_TO}'` },
  ];
}

const GREEN = {
  cspModerate: MODERATE,
  cspOpen: OPEN,
  cspStrict: STRICT,
  coep: COEP,
  coop: COOP,
  reportToHeader: REPORT_TO,
  reportingEndpointsHeader: REPORTING_ENDPOINTS,
  copies: copies(),
};

// ─── Unit: pure function ─────────────────────────────────────────────

describe("runCspSyncChecks (unit)", () => {
  it("passes when every copy carries CSP_MODERATE verbatim", () => {
    const result = runCspSyncChecks(GREEN);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.oks).toContain("public/_headers: CSP_MODERATE verbatim");
    expect(result.oks).toContain("CSP_MODERATE: style-src-attr allows inline style attributes only");
    expect(result.oks).toContain("CSP_MODERATE: 19 directives");
    expect(result.oks).toContain("CSP_STRICT: 3 hosts (own OAuth + signaling only)");
  });

  it("fails when a copy drifts from the canonical policy", () => {
    const c = copies();
    c[0]!.content = `Content-Security-Policy: default-src 'none'\n`;
    const result = runCspSyncChecks({ ...GREEN, copies: c });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "public/_headers: CSP_MODERATE not found verbatim",
    );
  });

  it("fails when the dev-only CSP_OPEN ships in a copy", () => {
    const c = copies();
    c[1]!.content = `add_header Content-Security-Policy "${OPEN}";`;
    const result = runCspSyncChecks({ ...GREEN, copies: c });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "public/nginx.conf: CSP_OPEN (dev profile) must never ship",
    );
  });

  it("fails when CSP_STRICT connect-src is widened", () => {
    const widened =
      "default-src 'self'; connect-src 'self' https://evil.example.com; script-src 'self'";
    const result = runCspSyncChecks({ ...GREEN, cspStrict: widened });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "CSP_STRICT connect-src widened: https://evil.example.com",
    );
  });

  it("allows inline style attributes but rejects inline/eval scripts and style blocks", () => {
    const weakened = MODERATE
      .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
      .replace("script-src 'self' 'wasm-unsafe-eval'", "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'");
    const result = runCspSyncChecks({ ...GREEN, cspModerate: weakened });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "CSP_MODERATE contains forbidden 'unsafe-inline' directive",
    );
    expect(result.failures).toContain(
      "CSP_MODERATE contains forbidden 'unsafe-eval' directive",
    );
  });

  it("fails when the directive count drifts from 19", () => {
    const short = "default-src 'self'; script-src 'self'";
    const result = runCspSyncChecks({ ...GREEN, cspModerate: short });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "CSP_MODERATE: expected 19 directives, got 2",
    );
  });

  it("fails when style-src-attr no longer explicitly allows React style attributes", () => {
    const withoutStyleAttr = MODERATE.replace("; style-src-attr 'unsafe-inline'", "");
    const result = runCspSyncChecks({ ...GREEN, cspModerate: withoutStyleAttr });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "CSP_MODERATE: style-src-attr must explicitly allow 'unsafe-inline'",
    );
  });

  it("fails when a copy lacks the Report-To header (report-to group undefined)", () => {
    const c = copies();
    c[0]!.content = `Content-Security-Policy: ${MODERATE}\nCross-Origin-Embedder-Policy: ${COEP}\nCross-Origin-Opener-Policy: ${COOP}\n`;
    const result = runCspSyncChecks({ ...GREEN, copies: c });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "public/_headers: Report-To header missing (report-to group undefined)",
    );
  });

  it("fails when COEP/COOP are missing from a copy", () => {
    const c = copies();
    c[0]!.content = `Content-Security-Policy: ${MODERATE}\n`;
    const result = runCspSyncChecks({ ...GREEN, copies: c });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("public/_headers: COEP not found");
    expect(result.failures).toContain("public/_headers: COOP not found");
  });

  it("fails when a forbidden host is re-added (ignoring comments)", () => {
    const c = copies();
    c[0]!.content = HEADERS + "\n# api.microlink.io was removed for privacy\n";
    let result = runCspSyncChecks({ ...GREEN, copies: c });
    expect(result.ok).toBe(true);
    // Now a live (non-comment) reference.
    c[0]!.content = HEADERS + "\nconnect-src 'self' https://api.microlink.io\n";
    result = runCspSyncChecks({ ...GREEN, copies: c });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      'public/_headers: forbidden host "api.microlink.io" found — must not be re-added',
    );
  });

  it("skips absent copies (optional-file handling is the CLI's job)", () => {
    const c = copies();
    c[2]!.content = null;
    const result = runCspSyncChecks({ ...GREEN, copies: c });
    expect(result.ok).toBe(true);
  });
});

// ─── Integration: CLI as a subprocess ────────────────────────────────

const CLI = join(process.cwd(), "scripts", "check-csp-sync.mjs");

function runCli(cwd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [CLI], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("check-csp-sync.mjs CLI integration", () => {
  let driftDir: string;

  beforeAll(() => {
    driftDir = join(tmpdir(), `bmf-csp-drift-${process.pid}`);
    rmSync(driftDir, { recursive: true, force: true });
    mkdirSync(join(driftDir, "public"), { recursive: true });
    // One copy (public/_headers) carries a stale policy — the gate must catch it.
    writeFileSync(
      join(driftDir, "public", "_headers"),
      `Content-Security-Policy: default-src 'none'\nCross-Origin-Embedder-Policy: ${COEP}\nCross-Origin-Opener-Policy: ${COOP}\nReporting-Endpoints: ${REPORTING_ENDPOINTS}\nReport-To: ${REPORT_TO}\n`,
    );
    writeFileSync(
      join(driftDir, "public", "nginx.conf"),
      `add_header Content-Security-Policy "${MODERATE}";\nadd_header Cross-Origin-Embedder-Policy "${COEP}";\nadd_header Cross-Origin-Opener-Policy "${COOP}";\nadd_header Reporting-Endpoints '${REPORTING_ENDPOINTS}';\nadd_header Report-To '${REPORT_TO}';`,
    );
  });

  afterAll(() => {
    rmSync(driftDir, { recursive: true, force: true });
  });

  it("exits 0 against the real repo", () => {
    const { status, stdout } = runCli(process.cwd());
    expect(status).toBe(0);
    expect(stdout).toContain("all copies in sync");
  });

  it("exits 1 against a drifted scaffold and reports the copy", () => {
    const { status, stderr } = runCli(driftDir);
    expect(status).toBe(1);
    expect(stderr).toContain("public/_headers: CSP_MODERATE not found verbatim");
  });
});

describe("npm run check:csp integration", () => {
  let npmDir: string;

  beforeAll(() => {
    npmDir = join(tmpdir(), `bmf-csp-npm-${process.pid}`);
    rmSync(npmDir, { recursive: true, force: true });
    mkdirSync(join(npmDir, "public"), { recursive: true });
    mkdirSync(join(npmDir, "scripts"), { recursive: true });
    // Mirror the real repo: package.json wires the documented npm script.
    writeFileSync(
      join(npmDir, "package.json"),
      JSON.stringify(
        { scripts: { "check:csp": "node scripts/check-csp-sync.mjs" } },
        null,
        2,
      ) + "\n",
    );
    // One copy (public/_headers) carries a stale policy — the gate must catch it.
    writeFileSync(
      join(npmDir, "public", "_headers"),
      `Content-Security-Policy: default-src 'none'\nCross-Origin-Embedder-Policy: ${COEP}\nCross-Origin-Opener-Policy: ${COOP}\nReporting-Endpoints: ${REPORTING_ENDPOINTS}\nReport-To: ${REPORT_TO}\n`,
    );
    writeFileSync(
      join(npmDir, "public", "nginx.conf"),
      `add_header Content-Security-Policy "${MODERATE}";\nadd_header Cross-Origin-Embedder-Policy "${COEP}";\nadd_header Cross-Origin-Opener-Policy "${COOP}";\nadd_header Reporting-Endpoints '${REPORTING_ENDPOINTS}';\nadd_header Report-To '${REPORT_TO}';`,
    );
    // The npm script resolves `node scripts/check-csp-sync.mjs` relative to
    // cwd; the script imports the canonical CSP from ./csp-config.js.
    copyFileSync(
      join(process.cwd(), "scripts", "check-csp-sync.mjs"),
      join(npmDir, "scripts", "check-csp-sync.mjs"),
    );
    copyFileSync(
      join(process.cwd(), "scripts", "csp-config.js"),
      join(npmDir, "scripts", "csp-config.js"),
    );
  });

  afterAll(() => {
    rmSync(npmDir, { recursive: true, force: true });
  });

  it("npm run check:csp exits 0 against the real repo", () => {
    const { status, stdout } = runNpm(process.cwd(), "check:csp");
    expect(status).toBe(0);
    expect(stdout).toContain("all copies in sync");
  });

  it("npm run check:csp exits 1 against the drifted scaffold", () => {
    const { status, stderr } = runNpm(npmDir, "check:csp");
    expect(status).toBe(1);
    expect(stderr).toContain("public/_headers: CSP_MODERATE not found verbatim");
  });
});
