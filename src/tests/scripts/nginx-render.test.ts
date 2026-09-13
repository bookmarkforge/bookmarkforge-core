/**
 * Integration tests for scripts/nginx-render.mjs invoked through the real
 * npm script (`npm run nginx:render`, i.e. `node scripts/nginx-render.mjs
 * --write`), against a temp-dir scaffold that mirrors the repo layout:
 * public/nginx.conf + public/_headers + netlify.toml + public/sitemap.xml +
 * public/robots.txt (committed copies), the renderer and the canonical
 * csp-config.js it imports, plus a package.json wiring the npm script.
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
    copyFileSync(
      join(REPO, "public", "nginx.conf"),
      join(renderDir, "public", "nginx.conf"),
    );
    copyFileSync(
      join(REPO, "public", "_headers"),
      join(renderDir, "public", "_headers"),
    );
    copyFileSync(
      join(REPO, "netlify.toml"),
      join(renderDir, "netlify.toml"),
    );
    copyFileSync(
      join(REPO, "public", "sitemap.xml"),
      join(renderDir, "public", "sitemap.xml"),
    );
    copyFileSync(
      join(REPO, "public", "robots.txt"),
      join(renderDir, "public", "robots.txt"),
    );
    // Public static pages + PWA manifest (surgical domain replacement)
    copyFileSync(
      join(REPO, "public", "404.html"),
      join(renderDir, "public", "404.html"),
    );
    copyFileSync(
      join(REPO, "public", "privacy-and-terms.html"),
      join(renderDir, "public", "privacy-and-terms.html"),
    );
    // Localized legal pages (surgical domain replacement, same as the EN one)
    for (const lang of ["es", "fr", "de", "pt", "it"]) {
      mkdirSync(join(renderDir, "public", lang), { recursive: true });
      copyFileSync(
        join(REPO, "public", lang, "privacy-and-terms.html"),
        join(renderDir, "public", lang, "privacy-and-terms.html"),
      );
    }
    copyFileSync(
      join(REPO, "public", "manifest.json"),
      join(renderDir, "public", "manifest.json"),
    );
    // Extension files (surgical domain replacement)
    copyFileSync(
      join(REPO, "extension", "background.js"),
      join(renderDir, "extension", "background.js"),
    );
    copyFileSync(
      join(REPO, "extension", "popup.js"),
      join(renderDir, "extension", "popup.js"),
    );
    copyFileSync(
      join(REPO, "extension", "popup.html"),
      join(renderDir, "extension", "popup.html"),
    );
    copyFileSync(
      join(REPO, "extension", "manifest.json"),
      join(renderDir, "extension", "manifest.json"),
    );
    copyFileSync(
      join(REPO, "extension", "manifest-firefox.json"),
      join(renderDir, "extension", "manifest-firefox.json"),
    );
    // Extension privacy policy (domain references)
    copyFileSync(
      join(REPO, "extension", "PRIVACY.md"),
      join(renderDir, "extension", "PRIVACY.md"),
    );
    copyFileSync(
      join(REPO, "scripts", "nginx-render.mjs"),
      join(renderDir, "scripts", "nginx-render.mjs"),
    );
    copyFileSync(
      join(REPO, "scripts", "csp-config.js"),
      join(renderDir, "scripts", "csp-config.js"),
    );
    writeFileSync(
      join(renderDir, "package.json"),
      JSON.stringify(
        { scripts: { "nginx:render": "node scripts/nginx-render.mjs --write" } },
        null,
        2,
      ) + "\n",
    );

    // Inject drift into the committed _headers copy (real difference, not
    // whitespace — the renderer normalizes trailing spaces + CRLF).
    const headersPath = join(renderDir, "public", "_headers");
    writeFileSync(
      headersPath,
      readFileSync(headersPath, "utf8").replace(
        "X-Frame-Options: DENY",
        "X-Frame-Options: SAMEORIGIN",
      ),
    );

    // Inject drift into netlify.toml's CSP-derived lines so the surgical
    // replacement is exercised end-to-end (not just the full-file renders).
    const tomlPath = join(renderDir, "netlify.toml");
    writeFileSync(
      tomlPath,
      readFileSync(tomlPath, "utf8").replace(
        "https://bookmarkforge.com/csp-report",
        "https://stale.example/csp-report",
      ),
    );

    // Inject drift into sitemap.xml and robots.txt so the full-render domain
    // substitution is exercised end-to-end (not just the CSP-derived files).
    const sitemapPath = join(renderDir, "public", "sitemap.xml");
    writeFileSync(
      sitemapPath,
      readFileSync(sitemapPath, "utf8").replace(
        "bookmarkforge.com",
        "stale.example",
      ),
    );
    const robotsPath = join(renderDir, "public", "robots.txt");
    writeFileSync(
      robotsPath,
      readFileSync(robotsPath, "utf8").replace(
        "bookmarkforge.com",
        "stale.example",
      ),
    );

    // Inject drift into the surgical targets (public HTML + manifest +
    // extension files) so the --write path is exercised for every target.
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
      join(renderDir, "extension", "PRIVACY.md"),
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

  it("verify fails on the injected drift; npm run nginx:render repairs it and exits 0", () => {
    const before = runVerify(renderDir);
    expect(before.status).toBe(1);
    // All 14 surgical targets + 4 full-rendered targets should show drift.
    const driftedTargets = [
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
    for (const t of driftedTargets) {
      expect(before.stderr).toContain(`DRIFT ${t}`);
    }

    // The --write flag must reach the renderer through the npm script (not
    // just a direct `node scripts/nginx-render.mjs --write` invocation).
    const fix = runNpm(renderDir, "nginx:render");
    expect(fix.status).toBe(0);
    const wroteTargets = [
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
    for (const t of wroteTargets) {
      expect(fix.stdout).toContain(`[nginx-render] wrote ${t}`);
    }

    // netlify.toml's CSP-derived lines are repaired, not rewritten wholesale.
    const tomlAfter = readFileSync(join(renderDir, "netlify.toml"), "utf8");
    expect(tomlAfter).toContain("https://bookmarkforge.com/csp-report");
    expect(tomlAfter).not.toContain("stale.example");

    // sitemap.xml / robots.txt have their domain restored, not just drifted.
    const sitemapAfter = readFileSync(join(renderDir, "public", "sitemap.xml"), "utf8");
    expect(sitemapAfter).toContain("https://bookmarkforge.com/");
    expect(sitemapAfter).not.toContain("stale.example");
    const robotsAfter = readFileSync(join(renderDir, "public", "robots.txt"), "utf8");
    expect(robotsAfter).toContain("Sitemap: https://bookmarkforge.com/sitemap.xml");
    expect(robotsAfter).not.toContain("stale.example");

    // Verify mode is green again.
    const after = runVerify(renderDir);
    expect(after.status).toBe(0);
  });

  it("leaves no residual drift (idempotent second npm run)", () => {
    const headersPath = join(renderDir, "public", "_headers");
    const contentBefore = readFileSync(headersPath, "utf8");

    const again = runNpm(renderDir, "nginx:render");
    expect(again.status).toBe(0);

    // Re-rendering an already-canonical file changes nothing, byte-for-byte.
    const contentAfter = readFileSync(headersPath, "utf8");
    expect(contentAfter).toBe(contentBefore);
    expect(runVerify(renderDir).status).toBe(0);
  });

  it("round-trip: BOOKMARKFORGE_DOMAIN changes all 19 files and restores cleanly", () => {
    // Start from a canonical state (the test above already left it clean,
    // but an explicit npm run makes this test order-independent).
    const clean = runNpm(renderDir, "nginx:render");
    expect(clean.status).toBe(0);

    // Act — change the domain to something custom.
    const changed = runWrite(renderDir, { BOOKMARKFORGE_DOMAIN: "custom.example" });
    expect(changed.status).toBe(0);

    // Each file must carry the custom domain.
    // nginx.conf and _headers have static prose comments mentioning
    // bookmarkforge.com — those aren't rendered, so we only assert the
    // custom needle is present there. Fully-generated files (sitemap,
    // robots) and the surgically-edited netlify.toml are checked for
    // absence of the default domain.
    const checks: Record<string, { path: string; needle: string; fullyRendered: boolean }> = {
      nginx: {
        path: join(renderDir, "public", "nginx.conf"),
        needle: "wss://signal.custom.example",
        fullyRendered: false,
      },
      headers: {
        path: join(renderDir, "public", "_headers"),
        needle: "https://custom.example/csp-report",
        fullyRendered: false,
      },
      netlify: {
        path: join(renderDir, "netlify.toml"),
        needle: "https://custom.example/csp-report",
        fullyRendered: true,
      },
      sitemap: {
        path: join(renderDir, "public", "sitemap.xml"),
        needle: "https://custom.example/",
        fullyRendered: true,
      },
      robots: {
        path: join(renderDir, "public", "robots.txt"),
        needle: "Sitemap: https://custom.example/sitemap.xml",
        fullyRendered: true,
      },
      html404: {
        path: join(renderDir, "public", "404.html"),
        needle: "https://custom.example/404.html",
        fullyRendered: false,
      },
      privacy: {
        path: join(renderDir, "public", "privacy-and-terms.html"),
        needle: "https://custom.example/privacy-and-terms.html",
        fullyRendered: false,
      },
      privacyEs: {
        path: join(renderDir, "public", "es", "privacy-and-terms.html"),
        needle: "https://custom.example/es/privacy-and-terms.html",
        fullyRendered: false,
      },
      privacyFr: {
        path: join(renderDir, "public", "fr", "privacy-and-terms.html"),
        needle: "https://custom.example/fr/privacy-and-terms.html",
        fullyRendered: false,
      },
      privacyDe: {
        path: join(renderDir, "public", "de", "privacy-and-terms.html"),
        needle: "https://custom.example/de/privacy-and-terms.html",
        fullyRendered: false,
      },
      privacyPt: {
        path: join(renderDir, "public", "pt", "privacy-and-terms.html"),
        needle: "https://custom.example/pt/privacy-and-terms.html",
        fullyRendered: false,
      },
      privacyIt: {
        path: join(renderDir, "public", "it", "privacy-and-terms.html"),
        needle: "https://custom.example/it/privacy-and-terms.html",
        fullyRendered: false,
      },
      pwaManifest: {
        path: join(renderDir, "public", "manifest.json"),
        needle: "https://custom.example",
        fullyRendered: false,
      },
      extBg: {
        path: join(renderDir, "extension", "background.js"),
        needle: "https://custom.example",
        fullyRendered: false,
      },
      extPopup: {
        path: join(renderDir, "extension", "popup.js"),
        needle: "https://custom.example",
        fullyRendered: false,
      },
      extPopupHtml: {
        path: join(renderDir, "extension", "popup.html"),
        needle: "https://custom.example",
        fullyRendered: false,
      },
      extManifest: {
        path: join(renderDir, "extension", "manifest.json"),
        needle: "https://custom.example",
        fullyRendered: false,
      },
      extManifestFx: {
        path: join(renderDir, "extension", "manifest-firefox.json"),
        needle: "https://custom.example",
        fullyRendered: false,
      },
      extPrivacy: {
        path: join(renderDir, "extension", "PRIVACY.md"),
        needle: "https://custom.example",
        fullyRendered: false,
      },
    };

    for (const [, check] of Object.entries(checks)) {
      const content = readFileSync(check.path, "utf8");
      expect(content).toContain(check.needle);
      if (check.fullyRendered) {
        expect(content).not.toContain("bookmarkforge.com");
      }
    }

    // Verify mode with the same custom env must be green.
    const verifyCustom = runVerify(renderDir, { BOOKMARKFORGE_DOMAIN: "custom.example" });
    expect(verifyCustom.status).toBe(0);

    // Restore to default domain.
    const restored = runWrite(renderDir);
    expect(restored.status).toBe(0);

    for (const [, check] of Object.entries(checks)) {
      const content = readFileSync(check.path, "utf8");
      expect(content).toContain("bookmarkforge.com");
    }

    // Default verify is green again.
    expect(runVerify(renderDir).status).toBe(0);
  });
});
