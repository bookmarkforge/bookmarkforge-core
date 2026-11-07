#!/usr/bin/env node
/**
 * scripts/local-smoke.mjs — Docker-free local verification.
 *
 * Starts the isolated license mock and the companion server as child processes
 * (wired with the same env docker-compose.prod.yml uses), waits for them to
 * become ready, then runs the production API-surface smoke checks (shared with
 * production-smoke.mjs) against the bare server — no Docker or nginx required.
 *
 * Usage:
 *   node scripts/local-smoke.mjs        # or: npm run local-smoke
 *
 * Env (optional overrides):
 *   API_PORT=8787             companion server port
 *   LICENSE_MOCK_PORT=8082    license mock port
 *   LICENSE_MOCK_KEY
 *
 * The license activate/validate checks need the gitignored signing key:
 *   node scripts/generate-license-keys.mjs --write   # once
 * Without it the license checks are skipped (with a warning); everything else
 * still runs.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runApiSurfaceChecks } from "./production-smoke.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PORT = Number(process.env.API_PORT ?? 8787);
const LICENSE_MOCK_PORT = Number(process.env.LICENSE_MOCK_PORT ?? 8082);
const LICENSE_MOCK_KEY = process.env.LICENSE_MOCK_KEY ?? "license-mock-key";
const BASE_URL = `http://127.0.0.1:${SERVER_PORT}`;

const signingKeyFile =
  process.env.LICENSE_SIGNING_PRIVATE_KEY_FILE ??
  join(ROOT, "server", ".license-signing-key.pkcs8");
const signingConfigured = existsSync(signingKeyFile);
if (!signingConfigured) {
  console.warn(`[local-smoke] WARN license signing key absent (${signingKeyFile}) — license checks will be skipped.`);
  console.warn("[local-smoke] Generate one with: node scripts/generate-license-keys.mjs --write");
}

const children = [];

function spawnChild(command, args, env, label) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push({ child, label });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  return child;
}

async function waitForReady(url, attempts = 60, intervalMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function teardown() {
  // Let the WebSocket close frame flush before asking the companion to shut
  // down; immediately killing it on Windows can trigger a libuv assertion.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const pending = children.filter(({ child }) => child.exitCode === null);
  for (const { child, label } of pending) {
    child.kill(label === "api" ? "SIGINT" : "SIGTERM");
  }
  await Promise.all(pending.map(({ child }) => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill();
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  })));
}

async function main() {
  const onSignal = (code) => async () => {
    await teardown();
    process.exit(code);
  };
  process.on("SIGINT", onSignal(130));
  process.on("SIGTERM", onSignal(143));

  try {
    // ── Mock upstreams ──────────────────────────────────────────────
    spawnChild(
      process.execPath,
      [join(ROOT, "scripts", "license-mock.mjs")],
      { LICENSE_MOCK_PORT: String(LICENSE_MOCK_PORT), LICENSE_MOCK_KEY },
      "license-mock",
    );

    // ── Companion server (same env as docker-compose.prod.yml) ──────
    const serverEnv = {
      NODE_ENV: "staging",
      PORT: String(SERVER_PORT),
      HOST: "127.0.0.1",
      TRUST_PROXY: "0",
      WHOP_LICENSE_API_URL: `http://127.0.0.1:${LICENSE_MOCK_PORT}/license`,
      WHOP_API_KEY: LICENSE_MOCK_KEY,
      LICENSE_PROVIDER_ALLOW_HTTP: "1",
    };
    if (signingConfigured) {
      serverEnv.LICENSE_SIGNING_PRIVATE_KEY_FILE = signingKeyFile;
    }
    spawnChild(
      process.execPath,
      ["--import", "tsx", join(ROOT, "server", "src", "index.ts")],
      serverEnv,
      "api",
    );

    // ── Readiness (both processes) ──────────────────────────────────
    const targets = [
      { label: "license-mock", url: `http://127.0.0.1:${LICENSE_MOCK_PORT}/health` },
      { label: "api", url: `${BASE_URL}/health` },
    ];
    for (const target of targets) {
      if (!(await waitForReady(target.url))) {
        console.error(`[local-smoke] ${target.label} did not become ready (${target.url}) — check for port conflicts.`);
        teardown();
        process.exit(1);
      }
    }

    // ── Run the production API-surface checks ───────────────────────
    const result = await runApiSurfaceChecks({
      baseUrl: BASE_URL,
      skipLicense: !signingConfigured,
    });

    await teardown();
    if (result.ok) {
      console.log(`All ${result.checks.length} local smoke checks passed.`);
      process.exit(0);
    }
    console.error("[local-smoke] some checks failed.");
    process.exit(1);
  } catch (error) {
    await teardown();
    console.error("[local-smoke] failed:", error);
    process.exit(1);
  }
}

await main();
