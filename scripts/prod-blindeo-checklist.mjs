#!/usr/bin/env node
/**
 * scripts/prod-blindeo-checklist.mjs — Full hardening checklist (11 checkpoints)
 *
 * Runs every gate that breaks production at the last minute: build:ci +
 * SRI, env, rxdb17, chunks, CSP, typecheck, test:fast, lint, test:rollback,
 * the full quality gate (npm run check — i18n, audit-drift,
 * license-keys, boundaries, english-only, no-unbounded-text, tailwind-drift,
 * inspector-freeze) and the MV3/MV2 extension artifact (fresh build +
 * tests + smoke in real Chromium). With this, "ALL HARDENED" implies that
 * npm run check passes too: the checklist IS the final gate.
 * Each checkpoint is independent and reports PASS/FAIL with the exact command.
 *
 * Usage: node scripts/prod-blindeo-checklist.mjs
 *        node scripts/prod-blindeo-checklist.mjs --json
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const isJson = process.argv.includes("--json");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: isJson ? "pipe" : "pipe", ...opts });
  return { ok: r.status === 0, stdout: (r.stdout || "") + (r.stderr || ""), status: r.status };
}

export function check(label, ok, detail = "") {
  const icon = ok ? "✓ PASS" : "✗ FAIL";
  if (!isJson) console.log(`${icon} ${label}${detail ? ` — ${detail}` : ""}`);
  return { label, ok, detail };
}

export function evaluateChecklist(results) {
  const ok = results.every((r) => r.ok);
  return { ok, results };
}

export function tailOutput(output, maxLen = 200) {
  if (typeof output !== "string") return "no output";
  const trimmed = output.trim();
  if (!trimmed) return "no output";
  return trimmed.length <= maxLen ? trimmed : "\u2026" + trimmed.slice(-maxLen);
}

// The main flow only runs when executed directly, not when imported by unit
// tests.
const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {

const results = [];

console.log(isJson ? "" : "\n🔒 BOOKMARKFORGE — HARDENING CHECKLIST (11 checkpoints)\n");

// 1. SRI + manifest + SW integrity — build:ci already runs vite build + verifies SRI/manifest/SW/chunks/bundle-size
{
  const bc = run(process.execPath, [join(ROOT, "scripts/build-ci.mjs")], { timeout: 180000 });
  const htmlOk = existsSync(join(ROOT, "dist/index.html")) && readFileSync(join(ROOT, "dist/index.html"), "utf8").includes("__BMF_INTEGRITY_MANIFEST__");
  // SRI rides on the SPA page (dist/app.html) since the marketing/SPA split.
  const sriOk = existsSync(join(ROOT, "dist/app.html")) && readFileSync(join(ROOT, "dist/app.html"), "utf8").includes('integrity="sha256-');
  const swOk = existsSync(join(ROOT, "dist/sw.js"));
  results.push(check("1. Bundle integrity (SRI + manifest + SW)", bc.ok && htmlOk && sriOk && swOk, bc.ok ? "build:ci OK" : "build:ci FAIL — " + (bc.stdout.slice(-300) || "")));
}

// 2. No leaked secrets
{
  const r = run(process.execPath, [join(ROOT, "scripts/check-env-config.mjs")]);
  results.push(check("2. No leaked secrets (check:env)", r.ok, r.ok ? "env OK" : "review check-env-config"));
}

// 3. RxDB 17
{
  const r = run(process.execPath, [join(ROOT, "scripts/check-rxdb17.mjs")]);
  results.push(check("3. RxDB 17 safe migration", r.ok, r.ok ? "rxdb17 OK" : r.stdout.slice(0, 120)));
}

// 4. Chunk boundaries + bundle size
{
  const c = run(process.execPath, [join(ROOT, "scripts/check-chunk-boundaries.mjs"), "--require-dist"]);
  const b = run(process.execPath, [join(ROOT, "scripts/check-bundle-size.mjs")]);
  results.push(check("4. Chunks + bundle size", c.ok && b.ok, c.ok && b.ok ? "chunks OK" : "review chunk boundaries"));
}

// 5. CSP sync
{
  const c1 = run(process.execPath, [join(ROOT, "scripts/check-csp-sync.mjs")]);
  const c2 = run(process.execPath, [join(ROOT, "scripts/check-extension-csp.mjs")]);
  const detail = c1.ok && c2.ok ? "CSP OK" : `CSP out of sync — app=${c1.ok ? "OK" : "FAIL"} ext=${c2.ok ? "OK" : "FAIL"}${c2.ok ? "" : " — " + (c2.stdout.slice(-200) || "")}`;
  results.push(check("5. CSP in sync (app + extension)", c1.ok && c2.ok, detail));
}

// 6. Typecheck
{
  const r = run(process.execPath, [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "--noEmit"], { timeout: 60000 });
  results.push(check("6. TypeScript without errors", r.ok, r.ok ? "typecheck OK" : "tsc FAIL"));
}

// 7. Critical tests — the fast profile's own budget is 600 s
// (scripts/test-bounded.mjs); in CI the suite takes ~200 s, so a 120 s cap
// killed re-runs on the runner even when everything was green.
{
  const r = run(process.execPath, [join(ROOT, "scripts/test-fast.mjs")], { timeout: 600000 });
  results.push(check("7. Tests críticos (test:fast)", r.ok, r.ok ? "tests OK" : "test:fast FAIL"));
}

// 8. Lint — the original gate only covered typecheck; a lint regression (or
// a new file violating it) did not block the deploy. Runs the canonical
// bounded executor (scripts/tooling/lint-bounded.mjs), NOT a monolithic
// `eslint .`: the monolith can exceed the heap on development machines and
// does not reuse the shared cache the chain keeps warm
// (node_modules/.cache/bookmarkforge-eslint).
{
  const r = run(process.execPath, [join(ROOT, "scripts", "tooling", "lint-bounded.mjs")], { timeout: 300000 });
  results.push(check("8. Lint (lint-bounded)", r.ok, r.ok ? "lint OK" : "eslint FAIL — " + (r.stdout.slice(0, 200) || "")));
}

// 9. Rollback tests — A/B PATH routing, extractSha, --auto. The E2E drill
// complements them (it needs docker); here CI covers the pure logic.
{
  const r = run(process.execPath, [join(ROOT, "node_modules", "vitest", "vitest.mjs"), "run", join(ROOT, "scripts", "__tests__", "rollback.test.mjs")], { timeout: 120000 });
  results.push(check("9. Rollback tests (test:rollback)", r.ok, r.ok ? "rollback OK" : "test:rollback FAIL — " + (r.stdout.slice(0, 200) || "")));
}

// 10. Full quality gate (npm run check) — i18n, audit-drift,
// license-keys, boundaries, e2e-helpers, english-only, no-unbounded-text,
// tailwind-drift, inspector-freeze… Checkpoints 2-5 and 8 already cover part
// of its content (env/csp/rxdb17/chunks/lint); this checkpoint is the final
// authority: if npm run check fails, NOTHING is declared hardened.
{
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = run(npmCmd, ["run", "check"], { timeout: 600000, shell: process.platform === "win32" });
  results.push(check("10. Gate completo (npm run check)", r.ok, r.ok ? "check OK" : "check FAIL — " + (r.stdout.slice(-300) || "")));
}

// 11. MV3/MV2 extension — fresh package build, unit tests and smoke in real
// Chromium against the packaged artifact (dist-extension). The smoke checks
// that the manifest parses, every referenced file ships in the dist, the
// service worker boots and the popup renders — the layer jsdom tests with a
// mocked chrome cannot catch (packaging errors).
{
  const b = run(process.execPath, [join(ROOT, "scripts/build-extension.cjs")], { timeout: 180000 });
  const t = run(process.execPath, [join(ROOT, "node_modules", "vitest", "vitest.mjs"), "run", "--config=vitest.extension.config.ts"], { timeout: 180000 });
  const s = run(process.execPath, [join(ROOT, "scripts/extension-smoke.mjs")], { timeout: 240000 });
  const okAll = b.ok && t.ok && s.ok;
  const detail = okAll
    ? "extension OK (build + tests + smoke)"
    : `extension FAIL — build=${b.ok ? "OK" : "FAIL"} tests=${t.ok ? "OK" : "FAIL"} smoke=${s.ok ? "OK" : "FAIL"}${s.ok ? "" : " — " + (s.stdout.slice(-200) || "")}`;
  results.push(check("11. MV3/MV2 extension (build + tests + smoke)", okAll, detail));
}

const { ok } = evaluateChecklist(results);
if (isJson) {
  console.log(JSON.stringify({ ok, results, at: new Date().toISOString() }, null, 2));
} else {
  console.log(`\n${ok ? "✅ ALL HARDENED — ready to deploy" : "❌ BLOCKED — fix the FAILs before deploy"}\n`);
  if (!ok) console.log("Full command: npm run ci:local\n");
}
process.exit(ok ? 0 : 1);

} // end if (isMain)
