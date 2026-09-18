#!/usr/bin/env node
/**
 * scripts/run-launch-smoke.mjs
 *
 * Launch-day critical-path battery runner. Wraps the Playwright profile
 * playwright.launch-smoke.config.ts (tests/e2e/launch-smoke-critical-paths.spec.ts)
 * so release day has ONE command whose outcome is a yes/no release decision.
 *
 * Usage:
 *   node scripts/run-launch-smoke.mjs            # test mode: dev server,
 *                                                # fast Argon2id, minutes
 *   node scripts/run-launch-smoke.mjs --prod     # prod mode: builds the real
 *                                                # bundle first, then previews
 *                                                # it (strong Argon2id)
 *   --report   also write PLAYWRIGHT_JSON_RESULTS (CI artifact)
 *
 * Env knobs (all optional): PLAYWRIGHT_PORT, CRISIS_COMPANION_PORT,
 * LICENSE_MOCK_PORT, E2E_TIMEOUT_MULTIPLIER, BMF_LAUNCH_SMOKE_LICENSE_KEY.
 *
 * Prerequisites checked before anything runs:
 *   - Playwright chromium browser installed
 *   - license signing key (server/.license-signing-key.pkcs8) — license
 *     tests are SKIPPED with a marker without it, never silent
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { checkReleaseTarget, remediesFor } from "./check-release-target.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROD = process.argv.includes("--prod");
const WRITE_REPORT = process.argv.includes("--report");
const CONFIG = join(ROOT, "playwright.launch-smoke.config.ts");

function step(message) {
  process.stdout.write(`\n[launch-smoke] ${message}\n`);
}

function fail(message, hint) {
  process.stderr.write(`\n[launch-smoke] FAIL: ${message}\n`);
  if (hint) {
    process.stderr.write(`[launch-smoke] hint: ${hint}\n`);
  }
  process.exit(1);
}

// ── Prerequisites ──────────────────────────────────────────────────────────

// Release target first (ADR-058): a launch-day battery whose outcome is a
// yes/no release decision must not run against an unconfirmed repository
// target — a green battery would certify a release whose clone URL points at a
// repository nobody confirmed.
const targetResult = checkReleaseTarget({ root: ROOT });
if (!targetResult.ok) {
  fail(
    `release target is not confirmed (${targetResult.findings.length} finding(s))`,
    [
      ...targetResult.findings.map(
        (finding) => `${finding.location} → ${finding.value ?? "—"}: ${finding.reason}`,
      ),
      ...remediesFor(targetResult.findings),
    ].join(" | "),
  );
}
step(`release target confirmed: ${targetResult.declaredTarget}`);

if (!existsSync(join(ROOT, "node_modules", "@playwright", "test"))) {
  fail("Playwright is not installed", "run: npm ci");
}
const playwrightCli = join(
  ROOT,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);

/**
 * Kill stale listeners on the battery's ports. A dev server leaked by a
 * previous crashed run silently poisons every later run: Playwright's
 * reuseExistingServer finds the port alive and reuses it — WITH THE OLD
 * process.env (e.g. a wrong /api proxy target) — instead of booting a fresh
 * server with the current config. Launch day must run against what THIS
 * config says, not what a dead run left behind.
 */
function killStaleListeners(ports) {
  const netstat = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
  if (netstat.status !== 0 || !netstat.stdout) {
    return;
  }
  const pids = new Set();
  for (const line of netstat.stdout.split(/\r?\n/)) {
    // TCP    127.0.0.1:4173   0.0.0.0:0    LISTENING    12345
    const match = line.match(
      /\s(?:TCP|UDP)\s+\S*?:(\d+)\s+\S+\s+(?:LISTENING|LISTEN)\s+(\d+)\s*$/i,
    );
    if (!match) continue;
    const [, portStr, pidStr] = match;
    if (ports.includes(Number(portStr))) {
      pids.add(Number(pidStr));
    }
  }
  for (const pid of pids) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, "SIGKILL");
      process.stdout.write(
        `[launch-smoke] killed stale listener pid ${pid} on a battery port\n`,
      );
    } catch {
      /* already gone / not ours — fine */
    }
  }
}

const BATTERY_PORTS = [
  Number(process.env.PLAYWRIGHT_PORT ?? 4173),
  Number(process.env.SIGNALING_PORT ?? 8787),
  Number(process.env.LICENSE_MOCK_PORT ?? 8082),
];
if (PROD) {
  BATTERY_PORTS.push(BATTERY_PORTS[0] + 1); // 4174 in prod mode
}
killStaleListeners(BATTERY_PORTS);
const probe = spawnSync(process.execPath, [playwrightCli, "install", "--dry-run", "chromium"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (probe.status !== 0) {
  // The dry-run probe can fail on older versions; fall back to the
  // executable check so we never hard-block on a cosmetic difference.
  const msPlaywright = join(
    process.env.LOCALAPPDATA ?? join(process.env.HOME ?? "", "AppData", "Local"),
    "ms-playwright",
  );
  if (!existsSync(msPlaywright)) {
    fail("Playwright chromium browser not found", "run: npx playwright install chromium");
  }
}

if (!existsSync(join(ROOT, "server", ".license-signing-key.pkcs8")) &&
    !process.env.LICENSE_SIGNING_PRIVATE_KEY_FILE &&
    !process.env.LICENSE_SIGNING_PRIVATE_KEY_PKCS8) {
  step("No license signing key found — license activation tests will SKIP.");
  step("Generate one with: node scripts/generate-license-keys.mjs --write");
}

// ── Prod mode: build the real bundle first ────────────────────────────────
if (PROD) {
  step("prod mode: building the production bundle (build:ci + preview diagnostics)…");
  const build = spawnSync(process.execPath, [join(ROOT, "scripts", "build-ci.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      // Durable-backend guard needs the diagnostic hook in the prod bundle.
      VITE_E2E_PREVIEW_DIAGNOSTICS: "true",
    },
  });
  if (build.status !== 0) {
    fail("production build failed", "fix the build before running launch smoke");
  }
  step("production build OK.");
}

// ── Run the battery ────────────────────────────────────────────────────────
step(PROD ? "running launch smoke against the PRODUCTION build…" : "running launch smoke (test mode)…");

const args = ["--config", CONFIG, "--project=chromium"];
if (WRITE_REPORT) {
  process.env.PLAYWRIGHT_JSON_OUTPUT_NAME = join(ROOT, "launch-smoke-results.json");
  args.unshift("--reporter=json");
}

const run = spawnSync(process.execPath, [playwrightCli, "test", ...args], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});

if (run.status !== 0) {
  fail(
    "critical-path smoke FAILED — do not release",
    "inspect test-results/ for traces; the failing path is the release blocker",
  );
}

step("ALL CRITICAL PATHS GREEN — cleared to release.");
