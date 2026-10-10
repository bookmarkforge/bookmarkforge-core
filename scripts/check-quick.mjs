#!/usr/bin/env node
/**
 * scripts/check-quick.mjs — the sub-second pre-commit tier of the gate chain.
 *
 * `npm run check` runs the full chain serially and finishes in about a minute
 * on this checkout (measured 2026-09-17: 61.8 s total; `lint` 21.0 s +
 * `check:no-unbounded-text` 13.4 s = 55% of it; the other 38 gates average
 * ~0.6 s). That is the right cadence for CI and pre-push, but too slow for the
 * save-edit loop. This tier runs the sub-second registered gates (security
 * core, plus the boundaries meta gate) in the order the git history says they
 * fail most often and prints a per-gate duration table, so the answer to
 * "what will CI reject?" costs under 5 seconds.
 *
 * Contract (keep it honest):
 *   - Additive only: this script is NOT part of the `npm run check` chain, so
 *     the inspector freeze (O-1, scripts/check-inspector-freeze.mjs) does not
 *     see it and no ADR is required.
 *   - Read-only selectors of existing gates: every entry here is already a
 *     registered KNOWN_GATES security gate — this script re-runs them, it does
 *     not re-implement anything.
 *   - Sub-second subset only: gates that cost >1 s (CVE scans hit the
 *     registry, check:audit-drift scans history) stay in the full chain.
 *   - It can never replace `npm run check`: it is a fast signal, not the gate.
 *
 * Reorder candidates: when a gate here fails, remember which one — the person
 * who hits a failure should not also pay for a re-ordered list that ignores
 * history. Move the most frequently failing gate first and say so in the PR.
 *
 * Testability: QUICK_GATES and runQuickChecks are exported with an injectable
 * `spawn`, so scripts/__tests__/check-quick.test.mjs can drive the tier
 * against in-memory fixtures without spawning a single process (same pattern
 * as runInspectorFreezeChecks in check-inspector-freeze.mjs).
 *
 * Usage:
 *   npm run check:quick            # security fast tier
 *   node scripts/check-quick.mjs   # same, direct
 */
import { spawnSync } from "node:child_process";

/**
 * Fast tier of registered gates (security core + the boundaries meta gate),
 * ordered by "fails first in practice". Categories per
 * scripts/check-inspector-freeze.mjs KNOWN_GATES.
 * Keep each entry well under ~1 s; slow gates belong only in `npm run check`.
 */
export const QUICK_GATES = [
  // 1. Boundary drift is the most common first failure: it catches a new
  //    runtime import edge (components→workers/db/memory) instantly.
  { gate: "check:boundaries", script: "scripts/check-context-boundaries.cjs" },
  // 2. Env contract: removed subsystems resurrected in .env / compose / docs.
  { gate: "check:env", script: "scripts/check-env-config.mjs" },
  // 3. Open Core export boundary (classified files, Pro leakage).
  { gate: "check:open-core", script: "scripts/check-open-core-export.mjs" },
  // 4. Runtime Pro seam (static Pro imports outside the pro-access seam).
  { gate: "check:pro-imports", script: "scripts/check-pro-imports.mjs" },
  // 5. Container config (compose/runtime variables, removed AI config).
  { gate: "check:compose-config", script: "scripts/validate-compose-config.mjs" },
  { gate: "check:runtime-config", script: "scripts/validate-runtime-config.mjs" },
  // 6. License keys parity (src/services ↔ server/src public key copies).
  //    --check keeps it read-only: the generator must never write from here.
  { gate: "check:license-keys", script: "scripts/generate-license-keys.mjs", args: ["--check"] },
  // 7. Server log IP privacy.
  { gate: "check:server-log-ip-privacy", script: "scripts/check-server-log-ip-privacy.mjs" },
];

/**
 * Run the tier against in-memory fixtures. Every gate runs under the SAME
 * node executable (no shell), output is piped, and the loop is fail-fast:
 * the first red gate stops the tier because its output is the answer.
 *
 * @param {{ gates?: typeof QUICK_GATES, spawn?: typeof spawnSync }} [deps]
 * @returns {{ failed: boolean, rows: Array<{gate: string, ms: number, status: string, out: string}>, total: number, summary: string }}
 */
export function runQuickChecks({ gates = QUICK_GATES, spawn = spawnSync } = {}) {
  const rows = [];
  let failed = false;
  for (const { gate, script, args = [] } of gates) {
    const t0 = Date.now();
    const result = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    const ms = Math.max(0, Date.now() - t0);
    const status = result.status === 0 ? "PASS" : `FAIL(exit ${result.status})`;
    if (result.status !== 0) failed = true;
    const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    rows.push({ gate, ms, status, out });
    console.log(`${gate.padEnd(28)} ${String(ms).padStart(6)} ms  ${status}`);
    if (result.status !== 0) {
      const text = out.trimEnd();
      if (text) console.log(text.split("\n").map((l) => `  │ ${l}`).join("\n"));
      // Fail fast: the first red gate is the answer; keep the loop short.
      break;
    }
  }

  const total = rows.reduce((sum, r) => sum + r.ms, 0);
  const passed = rows.filter((r) => r.status === "PASS").length;
  const summary =
    `[check:quick] ${passed}/${gates.length} gates en ${total} ms` +
    (failed ? " — FAIL (full chain: npm run check)" : " — continue with npm run check before pushing");
  console.log(summary);
  return { failed, rows, total, summary };
}

// ── CLI wrapper ──────────────────────────────────────────────────────
const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const { failed } = runQuickChecks();
  process.exit(failed ? 1 : 0);
}
