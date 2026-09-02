#!/usr/bin/env node
/**
 * scripts/run-e2e-batched.mjs
 *
 * Runs the Playwright E2E suite in category batches, one batch at a time,
 * so heavyweight suites (vault/KDF, text-fit visual, crisis/companion) never
 * contend with each other for CPU, the shared Vite dev server, or ports.
 *
 * Usage:
 *   node scripts/run-e2e-batched.mjs                 # run all batches
 *   node scripts/run-e2e-batched.mjs vault text-fit  # only named batches
 *   node scripts/run-e2e-batched.mjs --list          # show batches and exit
 *
 * Env:
 *   E2E_BATCH_TIMEOUT_MS   per-batch timeout (default 900000 = 15 min)
 *   E2E_TIMEOUT_MULTIPLIER passed through to the specs (vault-helpers reads it)
 *
 * Exit code is non-zero if any batch failed. Each batch runs `playwright test`
 * with its own spec files; Playwright's webServer block still boots the shared
 * Vite + signaling servers once per batch invocation (reuseExistingServer
 * keeps a manually started server alive across batches).
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const E2E_DIR = "tests/e2e";

// ── Category definitions ────────────────────────────────────────────────
// Each category lists spec files that must NOT run concurrently with each
// other, because they contend for the same resources:
//   - vault-*: KDF/Argon2id-heavy, shared browser crypto
//   - text-fit*: visual baselines, per-view stabilization, long runtimes
//   - crisis-containment: spawns its own companion server on port 8799
//   - *-nightly: run under the dedicated nightly config (own Vite on 5175)
const CATEGORIES = {
  vault: {
    description: "Vault KDF/lock/persistence flows (KDF-heavy)",
    specs: [
      "vault-init.spec.ts",
      "vault-lock-button.spec.ts",
      "vault-change-password.spec.ts",
      "vault-wrong-password.spec.ts",
      "vault-skip-password.spec.ts",
      "vault-auto-lock.spec.ts",
      "vault-auto-lock-s9-guard.spec.ts",
      "vault-backup-flow.spec.ts",
      "vault-corruption-recovery.spec.ts",
      "vault-focus-mode.spec.ts",
      "vault-idb-persistence.spec.ts",
      "vault-locale-switch.spec.ts",
      "vault-lock-ai-guard.spec.ts",
      "vault-lock-no-key-exfil.spec.ts",
      "vault-migration-progress.spec.ts",
      "vault-nuclear-forget-s9-guard.spec.ts",
      "vault-recovery-restore.spec.ts",
      "vault-security-regression.spec.ts",
      "vault-sidebar-toggle.spec.ts",
      "vault-theme-switch.spec.ts",
      "vault-auth-encryption-migration.spec.ts",
    ],
  },
  "text-fit": {
    description: "Cross-locale overflow audits + visual baselines",
    specs: ["text-fit.spec.ts", "text-fit-fuzz.spec.ts"],
  },
  crisis: {
    description: "Crisis containment (spawns its own companion server on 8799)",
    specs: ["crisis-containment.spec.ts"],
  },
  a11y: {
    description: "Accessibility audit",
    specs: ["a11y.spec.ts"],
  },
  navigation: {
    description: "Views, sidebar, theme, locale switching",
    specs: [
      "navigation-views.spec.ts",
      "sidebar-collapse-layout.spec.ts",
      "vault-theme-switch.spec.ts",
      "vault-locale-switch.spec.ts",
      "vault-sidebar-toggle.spec.ts",
    ],
  },
  ai: {
    description: "AI panels, guards, chat, first-boot flows",
    specs: [
      "ai-copilot.spec.ts",
      "ai-first-boot.spec.ts",
      "privacy-ai-guard.spec.ts",
      "chat-panel.spec.ts",
      "vault-lock-ai-guard.spec.ts",
    ],
  },
  sync: {
    description: "WebRTC sync and signaling",
    specs: ["vault-sync-real.spec.ts", "vault-sync-signaling.spec.ts"],
  },
  extension: {
    description: "Browser extension flows",
    specs: ["extension.spec.ts", "extension-config.spec.ts"],
  },
  misc: {
    description: "Capture sanitization, quota, diagnostics, export/import, phases",
    specs: [
      "capture-sanitization.spec.ts",
      "storage-quota-warning.spec.ts",
      "diag-integrity.spec.ts",
      "export-import.spec.ts",
      "drill-backup-restore.spec.ts",
      "phase1-critical-e2e.spec.ts",
      "phase2-cache-e2e.spec.ts",
      "webrtc-handshake-diagnostics.spec.ts",
    ],
  },
  nightly: {
    description:
      "Nightly-only suites (own Vite on 5175 via playwright.nightly.config.ts)",
    config: "playwright.nightly.config.ts",
    specs: [
      "text-fit.nightly.spec.ts",
      "ai-first-boot.nightly.spec.ts",
      "ai-startup.nightly.spec.ts",
      "audit-scan.nightly.spec.ts",
      "crosslang-scan.nightly.spec.ts",
      "perf-scale.nightly.spec.ts",
    ],
  },
};

// Batch order: cheap/fast first, heavyweight last so a slow tail doesn't
// block quick signal early.
const BATCH_ORDER = [
  "a11y",
  "navigation",
  "misc",
  "extension",
  "sync",
  "ai",
  "text-fit",
  "vault",
  "crisis",
  "nightly",
];

// ── CLI ─────────────────────────────────────────────────────────────────
const BATCH_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.E2E_BATCH_TIMEOUT_MS ?? "900000", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 900_000;
})();

const args = process.argv.slice(2);

if (args.includes("--list")) {
  console.log("Available batches (in run order):\n");
  for (const name of BATCH_ORDER) {
    const cat = CATEGORIES[name];
    console.log(`  ${name.padEnd(10)} ${cat.specs.length} spec(s) — ${cat.description}`);
  }
  console.log("\nUsage: node scripts/run-e2e-batched.mjs [batch ...]  (default: all)");
  process.exit(0);
}

const requested = args.filter((a) => !a.startsWith("-"));
const unknown = requested.filter((a) => !CATEGORIES[a]);
if (unknown.length > 0) {
  console.error(`Unknown batch(es): ${unknown.join(", ")}`);
  console.error(`Known batches: ${BATCH_ORDER.join(", ")}`);
  process.exit(1);
}
const selectedBatches = requested.length > 0 ? requested : BATCH_ORDER;

// ── Spec discovery: fail early if a category references a missing file ──
const available = new Set(
  readdirSync(join(ROOT, E2E_DIR)).filter((f) => f.endsWith(".spec.ts")),
);
for (const name of selectedBatches) {
  const missing = CATEGORIES[name].specs.filter((s) => !available.has(s));
  if (missing.length > 0) {
    console.error(`[run-e2e-batched] batch "${name}" references missing spec file(s): ${missing.join(", ")}`);
    process.exit(1);
  }
}

// ── Runner ──────────────────────────────────────────────────────────────
function runBatch(name, batchIndex) {
  const cat = CATEGORIES[name];
  const specPaths = cat.specs.map((s) => `${E2E_DIR}/${s}`);
  const passthrough = process.argv
    .slice(2)
    .filter((a) => a.startsWith("--") && !requested.includes(a));

  const cmdArgs = [
    "test",
    ...passthrough,
    ...(cat.config ? ["--config", cat.config] : []),
    ...specPaths,
  ];

  console.log(
    `\n[run-e2e-batched] ▶ batch ${batchIndex}/${selectedBatches.length}: ` +
      `${name} — ${cat.description}`,
  );
  console.log(`[run-e2e-batched]   specs: ${cat.specs.join(" ")}`);
  console.log(
    `[run-e2e-batched]   timeout: ${BATCH_TIMEOUT_MS / 1000}s\n`,
  );

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn("npx", ["playwright", ...cmdArgs], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    const timer = setTimeout(() => {
      console.error(
        `[run-e2e-batched] ✗ batch "${name}" exceeded ${BATCH_TIMEOUT_MS / 1000}s — killing`,
      );
      child.kill("SIGKILL");
      resolve({ name, status: 1, elapsed: Date.now() - startedAt, timedOut: true });
    }, BATCH_TIMEOUT_MS);

    child.once("error", (error) => {
      clearTimeout(timer);
      console.error(`[run-e2e-batched] failed to start batch "${name}":`, error);
      resolve({ name, status: 1, elapsed: Date.now() - startedAt, timedOut: false });
    });
    child.once("exit", (status) => {
      clearTimeout(timer);
      resolve({
        name,
        status: status ?? 1,
        elapsed: Date.now() - startedAt,
        timedOut: false,
      });
    });
  });
}

const suiteStartedAt = Date.now();
const results = [];
let batchIndex = 0;

for (const name of selectedBatches) {
  batchIndex += 1;
  const result = await runBatch(name, batchIndex);
  results.push(result);
  if (result.status !== 0) {
    console.error(
      `[run-e2e-batched] batch "${name}" failed — continuing with remaining batches\n`,
    );
  }
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log("\n════════ E2E batch summary ════════");
for (const r of results) {
  const status = r.status === 0 ? "PASS" : r.timedOut ? "TIMEOUT" : "FAIL";
  console.log(
    `  ${status.padEnd(8)} ${r.name.padEnd(10)} ${String(Math.round(r.elapsed / 1000)).padStart(6)}s`,
  );
}
const failed = results.filter((r) => r.status !== 0);
console.log(
  `\n[run-e2e-batched] ${results.length - failed.length}/${results.length} batches passed ` +
    `in ${((Date.now() - suiteStartedAt) / 1000).toFixed(0)}s`,
);
process.exit(failed.length > 0 ? 1 : 0);
