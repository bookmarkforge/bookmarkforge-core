/**
 * Integration tests for scripts/nginx-render.mjs invoked through the real
 * npm script (`npm run nginx:render`, i.e. `node scripts/nginx-render.mjs
 * --write`), against a temp-dir scaffold that mirrors the repo layout.
 *
 * Ownership contract after A9-1 (docs/audit.md):
 *   - public/nginx.conf, public/robots.txt — generated WHOLESALE (single
 *     owner: this renderer).
 *   - public/_headers, public/sitemap.xml, netlify.toml + the surgical
 *     targets — HAND-MAINTAINED; the renderer only rewrites CSP-derived
 *     values / URL hosts / domain-bearing substrings and must NEVER
 *     regenerate the file. A9-1 regression guards assert the per-path
 *     _headers blocks and the 61-URL sitemap survive a --write intact.
 *   - A safety guard that refuses a target aborts the whole --write
 *     (all-or-nothing): scripts/rollback.mjs runs this during incidents.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runNpm } from "./run-npm";

const REPO = process.cwd();
const SCRIPT = join(REPO, "scripts", "nginx-render.mjs");

/** Run the renderer in verify mode (no --write) in the given cwd.
 * Optional `env` overrides are merged onto process.env (used for
 * BOOKMARKFORGE_DOMAIN round-trip tests). */
function runVerify(
  cwd: string,
  env?: Record<string, string>,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [SCRIPT], {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : undefined,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Run the renderer in --write mode with optional env overrides. */
function runWrite(
  cwd: string,
  env?: Record<string, string>,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [SCRIPT, "--write"], {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : undefined,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const ALL_TARGETS = [
  "public/nginx.conf",
  "public/_headers",
  "netlify.toml",
  "public/sitemap.xml",
  "public/robots.txt",
  "public/404.html",
  "public/privacy-and-terms.html",
  "public/es/privacy-and-terms.html",
  "public/fr/privacy-and-terms.html",
  "public/de/privacy-and-terms.html",
  "public/pt/privacy-and-terms.html",
  "public/it/privacy-and-terms.html",
  "public/manifest.json",
  "extension/background.js",
  "extension/popup.js",
  "extension/popup.html",
  "extension/manifest.json",
  "extension/manifest-firefox.json",
  "extension/PRIVACY.md",
];

describe("npm run nginx:render integration", () => {
  let renderDir: string;

  beforeAll(() => {
    renderDir = join(tmpdir(), `bmf-nginxrender-npm-${process.pid}`);
    rmSync(renderDir, { recursive: true, force: true });
    mkdirSync(join(renderDir, "public"), { recursive: true });
    mkdirSync(join(renderDir, "scripts"), { recursive: true });
    mkdirSync(join(renderDir, "extension"), { recursive: true });

    // Mirror the real repo layout: committed copies + the renderer + the
    // canonical CSP source it imports (csp-config.js has no imports).
    for (const rel of ALL_TARGETS) {
      const dest = join(renderDir, rel);
      mkdirSync(join(dest, ".."), { recursive: true });
      copyFileSync(join(REPO, rel), dest);
    }
    copyFileSync(
      join(REPO, "scripts", "nginx-render.mjs"),
      join(renderDir, "scripts", "nginx-render.mjs"),
    );
    copyFileSync(
      join(REPO, "scripts", "csp-config.js"),
      join(renderDir, "scripts", "csp-config.js"),
    );
    // The renderer imports the locale registry, which imports csp-config.js.
    copyFileSync(
      join(REPO, "scripts", "landing-registry.mjs"),
      join(renderDir, "scripts", "landing-registry.mjs"),
    );
    writeFileSync(
      join(renderDir, "package.json"),
      JSON.stringify(
        { scripts: { "nginx:render": "node scripts/nginx-render.mjs --write" } },
        null,
        2,
      ) + "\n",
    );

    // _headers drift in a CSP-derived value (Report-To endpoint URL) — the
    // surgical repair must fix exactly these header lines.
    const headersPath = join(renderDir, "public", "_headers");
    writeFileSync(
      headersPath,
      readFileSync(headersPath, "utf8").replaceAll(
        "https://bookmarkforge.com/csp-report",
        "https://stale.example/csp-report",
      ),
    );

    // netlify.toml's CSP-derived lines drift (surgical replacement).
    const tomlPath = join(renderDir, "netlify.toml");
    writeFileSync(
      tomlPath,
      readFileSync(tomlPath, "utf8").replace(
        "https://bookmarkforge.com/csp-report",
        "https://stale.example/csp-report",
      ),
    );

    // sitemap.xml drift: every URL host goes stale (loc + xhtml:link).
    const sitemapPath = join(renderDir, "public", "sitemap.xml");
    writeFileSync(
      sitemapPath,
      readFileSync(sitemapPath, "utf8").replaceAll(
        "bookmarkforge.com",
        "stale.example",
      ),
    );

    // robots.txt is a wholesale-render target: full regeneration expected.
    const robotsPath = join(renderDir, "public", "robots.txt");
    writeFileSync(
      robotsPath,
      readFileSync(robotsPath, "utf8").replace(
        "bookmarkforge.com",
        "stale.example",
      ),
    );

    // Surgical targets (HTML + manifest + extension files) drift.
    const surgicalDriftTargets = [
      join(renderDir, "public", "404.html"),
      join(renderDir, "public", "privacy-and-terms.html"),
      ...["es", "fr", "de", "pt", "it"].map((lang) =>
        join(renderDir, "public", lang, "privacy-and-terms.html"),
      ),
      join(renderDir, "public", "manifest.json"),
      join(renderDir, "extension", "background.js"),
      join(renderDir, "extension", "popup.js"),
      join(renderDir, "extension", "popup.html"),
      join(renderDir, "extension", "manifest.json"),
      join(renderDir, "extension", "manifest-firefox.json"),
    ];
    for (const p of surgicalDriftTargets) {
      writeFileSync(
        p,
        readFileSync(p, "utf8").replace(
          "bookmarkforge.com",
          "stale.example",
        ),
      );
    }
  });

  afterAll(() => {
    rmSync(renderDir, { recursive: true, force: true });
  });

  it("verify fails on the injected drift; npm run nginx:render repairs it surgically and exits 0", () => {
    const before = runVerify(renderDir);
    expect(before.status).toBe(1);
    // nginx.conf and robots.txt are wholesale targets: their on-disk copies
    // match the template (copied from the repo), so only the surgical files
    // report drift here.
    for (const t of [
      "public/_headers",
      "netlify.toml",
      "public/sitemap.xml",
      "public/robots.txt",
      "public/404.html",
      "public/privacy-and-terms.html",
      "public/es/privacy-and-terms.html",
      "public/fr/privacy-and-terms.html",
      "public/de/privacy-and-terms.html",
      "public/pt/privacy-and-terms.html",
      "public/it/privacy-and-terms.html",
      "public/manifest.json",
      "extension/background.js",
      "extension/popup.js",
      "extension/popup.html",
      "extension/manifest.json",
      "extension/manifest-firefox.json",
    ]) {
      expect(before.stderr).toContain(`DRIFT ${t}`);
    }

    // The --write flag must reach the renderer through the npm script (not
    // just a direct `node scripts/nginx-render.mjs --write` invocation).
    const fix = runNpm(renderDir, "nginx:render");
    expect(fix.status).toBe(0);
    for (const t of ALL_TARGETS) {
      expect(fix.stdout).toContain(`[nginx-render] wrote ${t}`);
    }

    // ── A9-1 headline: _headers repaired ONLY in its CSP-derived values ──
    const headersAfter = readFileSync(join(renderDir, "public", "_headers"), "utf8");
    expect(headersAfter).toContain("https://bookmarkforge.com/csp-report");
    expect(headersAfter).not.toContain("stale.example");
    // Per-path structure survives (Cloudflare Pages most-specific-rule):
    // every path block keeps its repeated security headers and the noindex
    // rules, and the prose comments are untouched. (File is CRLF on disk;
    // match single lines instead of multi-line literals.)
    expect(headersAfter).toMatch(/^\/\*\.html\r?\n {2}Cache-Control: no-cache, must-revalidate$/m);
    expect(headersAfter).toContain("/app/*\r\n  X-Robots-Tag: noindex");
    expect(headersAfter).toContain("`https://license.bookmarkforge.com`");
    expect(headersAfter).toContain(
      "# Each path-specific block MUST repeat all security headers",
    );

    // ── A9-1 headline: sitemap repaired, NOT truncated to the old template ──
    const sitemapAfter = readFileSync(join(renderDir, "public", "sitemap.xml"), "utf8");
    expect(sitemapAfter).toContain("https://bookmarkforge.com/");
    expect(sitemapAfter).not.toContain("stale.example");
    const locs = [...sitemapAfter.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBe(61); // the old renderSitemap emitted 13 — that was the destruction
    expect(locs).toContain("https://bookmarkforge.com/ar/privacy-and-terms.html");
    expect(sitemapAfter).toContain('hreflang="x-default"');
    // Namespace URIs are never localised.
    expect(sitemapAfter).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(sitemapAfter).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');

    // netlify.toml's CSP-derived lines are repaired, not rewritten wholesale.
    const tomlAfter = readFileSync(join(renderDir, "netlify.toml"), "utf8");
    expect(tomlAfter).toContain("https://bookmarkforge.com/csp-report");
    expect(tomlAfter).not.toContain("stale.example");

    // robots.txt is regenerated wholesale: domain restored everywhere.
    const robotsAfter = readFileSync(join(renderDir, "public", "robots.txt"), "utf8");
    expect(robotsAfter).toContain("Sitemap: https://bookmarkforge.com/sitemap.xml");
    expect(robotsAfter).not.toContain("stale.example");

    // Verify mode is green again.
    const after = runVerify(renderDir);
    expect(after.status).toBe(0);
  });

  it("leaves no residual drift (idempotent second npm run, byte-for-byte)", () => {
    const before: Record<string, string> = {};
    for (const rel of [
      "public/_headers",
      "public/sitemap.xml",
      "public/nginx.conf",
      "public/robots.txt",
    ]) {
      before[rel] = readFileSync(join(renderDir, rel), "utf8");
    }

    const again = runNpm(renderDir, "nginx:render");
    expect(again.status).toBe(0);

    // Re-rendering an already-canonical file changes nothing, byte-for-byte.
    for (const rel of Object.keys(before)) {
      expect(readFileSync(join(renderDir, rel), "utf8")).toBe(before[rel]);
    }
    expect(runVerify(renderDir).status).toBe(0);
  });

  it("round-trip: BOOKMARKFORGE_DOMAIN changes every file and restores cleanly", () => {
    // Start from a canonical state (the tests above already left it clean,
    // but an explicit npm run makes this test order-independent).
    const clean = runNpm(renderDir, "nginx:render");
    expect(clean.status).toBe(0);

    // Act — change the domain to something custom.
    const changed = runWrite(renderDir, { BOOKMARKFORGE_DOMAIN: "custom.example" });
    expect(changed.status).toBe(0);

    // Each file must carry the custom domain. Wholesale targets must not
    // keep the default domain anywhere; surgical targets carry it only in
    // the lines the renderer owns (prose comments are deliberately out of
    // scope — that is the A9-1 ownership contract).
    const sitemapCustom = readFileSync(join(renderDir, "public", "sitemap.xml"), "utf8");
    expect(sitemapCustom).toContain("https://custom.example/ar/");
    expect(sitemapCustom).not.toContain("bookmarkforge.com");

    const robotsCustom = readFileSync(join(renderDir, "public", "robots.txt"), "utf8");
    expect(robotsCustom).toContain("Sitemap: https://custom.example/sitemap.xml");
    expect(robotsCustom).not.toContain("bookmarkforge.com");

    const headersCustom = readFileSync(join(renderDir, "public", "_headers"), "utf8");
    expect(headersCustom).toContain("https://custom.example/csp-report");
    // Surgical scope: the hand-written prose comment is NOT rewritten…
    expect(headersCustom).toContain("`https://license.bookmarkforge.com`");
    // …while every CSP-derived header line is.
    expect(headersCustom).not.toMatch(/^ {2}(Reporting-Endpoints|Report-To|Content-Security-Policy): .*bookmarkforge\.com/m);
    expect(headersCustom).toContain("wss://signal.custom.example");

    const tomlCustom = readFileSync(join(renderDir, "netlify.toml"), "utf8");
    expect(tomlCustom).toContain("https://custom.example/csp-report");

    const nginxCustom = readFileSync(join(renderDir, "public", "nginx.conf"), "utf8");
    expect(nginxCustom).toContain("wss://signal.custom.example");

    for (const rel of [
      "public/404.html",
      "public/privacy-and-terms.html",
      "public/es/privacy-and-terms.html",
      "public/manifest.json",
      "extension/background.js",
    ]) {
      expect(readFileSync(join(renderDir, rel), "utf8")).toContain(
        "custom.example",
      );
    }

    // Verify mode with the same custom env must be green.
    const verifyCustom = runVerify(renderDir, { BOOKMARKFORGE_DOMAIN: "custom.example" });
    expect(verifyCustom.status).toBe(0);

    // Restore to default domain.
    const restored = runWrite(renderDir);
    expect(restored.status).toBe(0);

    for (const rel of [
      "public/404.html",
      "public/privacy-and-terms.html",
      "public/es/privacy-and-terms.html",
      "public/manifest.json",
      "extension/background.js",
      "public/robots.txt",
    ]) {
      expect(readFileSync(join(renderDir, rel), "utf8")).toContain(
        "bookmarkforge.com",
      );
    }

    // Default verify is green again.
    expect(runVerify(renderDir).status).toBe(0);
  });
});

describe("A9-1 guards: --write refuses damaged inputs and writes NOTHING", () => {
  let guardDir: string;

  beforeAll(() => {
    guardDir = join(tmpdir(), `bmf-nginxrender-guard-${process.pid}`);
    rmSync(guardDir, { recursive: true, force: true });
    mkdirSync(join(guardDir, "public"), { recursive: true });
    mkdirSync(join(guardDir, "scripts"), { recursive: true });
    for (const rel of ALL_TARGETS) {
      const dest = join(guardDir, rel);
      mkdirSync(join(dest, ".."), { recursive: true });
      copyFileSync(join(REPO, rel), dest);
    }
    copyFileSync(join(REPO, "scripts", "nginx-render.mjs"), join(guardDir, "scripts", "nginx-render.mjs"));
    copyFileSync(join(REPO, "scripts", "csp-config.js"), join(guardDir, "scripts", "csp-config.js"));

    // Damage 1: _headers restructured so the CSP-derived header lines are
    // gone (the exact "file doesn't look like itself" scenario).
    const headersPath = join(guardDir, "public", "_headers");
    writeFileSync(
      headersPath,
      readFileSync(headersPath, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(Report-To|Reporting-Endpoints):/.test(l))
        .join("\n"),
    );

    // Damage 2: sitemap replaced by something that is not the committed
    // sitemap (no <urlset> element).
    writeFileSync(join(guardDir, "public", "sitemap.xml"), "<broken/>");
  });

  afterAll(() => {
    rmSync(guardDir, { recursive: true, force: true });
  });

  it("verify reports FAIL (not DRIFT) for guard rejections and exits 1", () => {
    const r = runVerify(guardDir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAIL public/_headers");
    expect(r.stderr).toContain('no "Reporting-Endpoints:", "Report-To:" header line(s) found');
    expect(r.stderr).toContain("FAIL public/sitemap.xml");
    expect(r.stderr).toContain("no <urlset> element");
  });

  it("--write aborts all-or-nothing: damaged files and neighbours are untouched", () => {
    const snapshot: Record<string, string> = {};
    for (const rel of ["public/_headers", "public/sitemap.xml", "public/nginx.conf", "public/robots.txt", "netlify.toml"]) {
      snapshot[rel] = readFileSync(join(guardDir, rel), "utf8");
    }

    const r = runWrite(guardDir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ABORT --write");
    expect(r.stderr).toContain("nothing was written");
    expect(r.stdout).not.toContain("[nginx-render] wrote");

    for (const rel of Object.keys(snapshot)) {
      expect(readFileSync(join(guardDir, rel), "utf8")).toBe(snapshot[rel]);
    }
  });
});
