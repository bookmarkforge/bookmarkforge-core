#!/usr/bin/env node
/**
 * scripts/run-mobile-smoke.mjs
 *
 * Mobile-device battery runner: builds the production bundle WITH the two
 * E2E diagnostic flags (durable-backend guard + KDF profile proof) and runs
 * the emulated-Android spec (tests/e2e/pwa-mobile-android.spec.ts) against
 * it via playwright.mobile.config.ts. One command, yes/no outcome:
 *
 *   node scripts/run-mobile-smoke.mjs        # build + mobile battery
 *   npm run e2e:mobile                       # same
 *   node scripts/run-mobile-smoke.mjs --no-build   # reuse an existing
 *                                                  # correctly-flagged dist/
 *
 * What it proves: on an emulated Android (Pixel 7), the vault KDF resolves
 * the 64 MiB mobile Argon2id profile (not the 8 MiB test params, not the
 * 128 MiB desktop profile) and the PWA install surface works (manifest,
 * service worker, deferred install prompt consumed by the Header button).
 *
 * The build flags are E2E-ONLY (see src/env.config.ts): neither is ever set
 * in real production builds, so the diagnostic hooks ship nowhere.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const NO_BUILD = process.argv.includes("--no-build");
const CONFIG = join(ROOT, "playwright.mobile.config.ts");

function step(message) {
  process.stdout.write(`\n[mobile-smoke] ${message}\n`);
}

function fail(message, hint) {
  process.stderr.write(`\n[mobile-smoke] FAIL: ${message}\n`);
  if (hint) {
    process.stderr.write(`[mobile-smoke] hint: ${hint}\n`);
  }
  process.exit(1);
}

// ── Prerequisites ────────────────────────────────────────────────────────
if (!existsSync(join(ROOT, "node_modules", "@playwright", "test"))) {
  fail("Playwright is not installed", "run: npm ci");
}

// ── Prod build with the E2E diagnostic flags ─────────────────────────────
if (!NO_BUILD) {
  step("building the production bundle with E2E diagnostics flags…");
  const build = spawnSync(process.execPath, [join(ROOT, "scripts", "build-ci.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      // The prod-build contract of this runner is absolute: the 64 MiB KDF
      // profile only exists where isProdBuild() && !isTestMode(), and a
      // NODE_ENV=test inherited from CI (e.g. a workflow `env:` block) both
      // empties the Workbox precache manifest and flips Vite's mode
      // resolution — the build then fails the chunk-boundary gate with "0
      // precache entries". Force the production NODE_ENV for the build
      // regardless of what the calling environment sets.
      NODE_ENV: "production",
      // Durable-backend guard + KDF profile proof channels.
      VITE_E2E_PREVIEW_DIAGNOSTICS: "true",
      VITE_E2E_KDF_DIAGNOSTICS: "true",
    },
  });
  if (build.status !== 0) {
    fail("production build failed", "fix the build before running mobile smoke");
  }
  step("production build OK.");
} else {
  // --no-build: the caller asserts the existing dist/ was built with the
  // flags; the KDF test itself fail-closes if the hook is absent.
  step("skipping build (--no-build) — assuming dist/ was built with the diagnostic flags.");
}

// ── Run the mobile battery ───────────────────────────────────────────────
step("running the emulated-Android battery (KDF profile + PWA surface)…");

const args = ["--config", CONFIG];
if (process.argv.includes("--report")) {
  process.env.PLAYWRIGHT_JSON_OUTPUT_NAME = join(ROOT, "mobile-smoke-results.json");
  args.unshift("--reporter=json");
}

const run = spawnSync(process.execPath, [join(ROOT, "node_modules", "@playwright", "test", "cli.js"), "test", ...args], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});

if (run.status !== 0) {
  fail(
    "mobile battery FAILED — inspect test-results/ for traces",
    "if the KDF proof failed, confirm dist/ was built with VITE_E2E_KDF_DIAGNOSTICS=true (drop --no-build)",
  );
}

step("MOBILE CRITICAL SURFACE GREEN — 64 MiB KDF profile proven on Android, PWA install surface OK.");
