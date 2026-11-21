#!/usr/bin/env node
/**
 * scripts/run-human-like-preview.mjs
 *
 * Production-preview runner for the human-like suite: builds the production
 * bundle WITH the E2E preview-diagnostics flag (durable-backend guard) and
 * runs the platform-behavior specs (service workers, offline) against `vite preview` — the real Workbox artifacts, not the
 * dev server where service workers are blocked by playwright.config.ts.
 *
 *   node scripts/run-human-like-preview.mjs          # build + preview specs
 *   npm run e2e:human-like-preview                    # same
 *   node scripts/run-human-like-preview.mjs --no-build   # reuse dist/
 *
 * The full human-like suite is too heavy for a single worker against the
 * preview server, so only the specs that specifically exercise production
 * behavior are scheduled; everything else already runs in dev via the
 * human-like-sharded nightly job.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const NO_BUILD = process.argv.includes("--no-build");
const CONFIG = join(ROOT, "playwright.human-like-preview.config.ts");

// Specs whose assertions only hold against the production bundle: the dev
// server never registers the Workbox service worker and playwright.config.ts
// blocks SWs entirely, so these are the production-only surface.
const PREVIEW_SPECS = [
  "src/tests/human-like/examples/advanced-service-workers-tests.spec.ts",
  "src/tests/human-like/examples/advanced-offline-tests.spec.ts",
];

function step(message) {
  process.stdout.write(`\n[preview-smoke] ${message}\n`);
}

function fail(message, hint) {
  process.stderr.write(`\n[preview-smoke] FAIL: ${message}\n`);
  if (hint) {
    process.stderr.write(`[preview-smoke] hint: ${hint}\n`);
  }
  process.exit(1);
}

if (!existsSync(join(ROOT, "node_modules", "@playwright", "test"))) {
  fail("Playwright is not installed", "run: npm ci");
}

if (!NO_BUILD) {
  step("building the production bundle with E2E preview diagnostics…");
  const build = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "build-ci.mjs")],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "production",
        VITE_E2E_PREVIEW_DIAGNOSTICS: "true",
      },
    },
  );
  if (build.status !== 0) {
    fail("production build failed", "fix the build before running preview specs");
  }
  step("production build OK.");
} else {
  step("skipping build (--no-build) — assuming dist/ was built with the diagnostics flag.");
}

step("running production-preview specs (SW / offline / PWA / workers)…");

const run = spawnSync(
  process.execPath,
  [
    join(ROOT, "node_modules", "@playwright", "test", "cli.js"),
    "test",
    "--config",
    CONFIG,
    ...PREVIEW_SPECS,
  ],
  { cwd: ROOT, stdio: "inherit", env: process.env },
);

if (run.status !== 0) {
  fail(
    "preview specs FAILED — inspect test-results-human-like-preview/ for traces",
    "if the storage-backend guard failed, rebuild without --no-build so VITE_E2E_PREVIEW_DIAGNOSTICS=true is baked in",
  );
}

step("PREVIEW SURFACE GREEN — production bundle + Workbox SW verified.");
process.exit(0);
