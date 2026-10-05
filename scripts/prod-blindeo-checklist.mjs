#!/usr/bin/env node
/**
 * scripts/prod-blindeo-checklist.mjs — Checklist de blindaje completo (11 puntos)
 *
 * Ejecuta todos los gates que rompen producción a último minuto: build:ci +
 * SRI, env, rxdb17, chunks, CSP, typecheck, test:fast, lint, test:rollback,
 * el gate de calidad completo (npm run check — i18n, audit-drift,
 * license-keys, boundaries, english-only, no-unbounded-text, tailwind-drift,
 * inspector-freeze) y el artefacto de extensión MV3/MV2 (build fresco +
 * tests + smoke en Chromium real). Con esto, "TODO BLINDADO" implica que
 * npm run check también pasa: el checklist ES el gate final.
 * Cada punto es independiente y reporta PASS/FAIL con comando exacto.
 *
 * Uso: node scripts/prod-blindeo-checklist.mjs
 *      node scripts/prod-blindeo-checklist.mjs --json
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
  if (typeof output !== "string") return "sin salida";
  const trimmed = output.trim();
  if (!trimmed) return "sin salida";
  return trimmed.length <= maxLen ? trimmed : "\u2026" + trimmed.slice(-maxLen);
}

// El flujo principal solo corre cuando se ejecuta directamente, no al ser
// importado por los tests unitarios.
const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {

const results = [];

console.log(isJson ? "" : "\n🔒 BOOKMARKFORGE — CHECKLIST DE BLINDAJE (11 puntos)\n");

// 1. Integridad SRI + manifest + SW — build:ci ya hace vite build + verifica SRI/manifest/SW/chunks/bundle-size
{
  const bc = run(process.execPath, [join(ROOT, "scripts/build-ci.mjs")], { timeout: 180000 });
  const htmlOk = existsSync(join(ROOT, "dist/index.html")) && readFileSync(join(ROOT, "dist/index.html"), "utf8").includes("__BMF_INTEGRITY_MANIFEST__");
  const sriOk = existsSync(join(ROOT, "dist/index.html")) && readFileSync(join(ROOT, "dist/index.html"), "utf8").includes('integrity="sha256-');
  const swOk = existsSync(join(ROOT, "dist/sw.js"));
  results.push(check("1. Bundle integrity (SRI + manifest + SW)", bc.ok && htmlOk && sriOk && swOk, bc.ok ? "build:ci OK" : "build:ci FAIL — " + (bc.stdout.slice(-300) || "")));
}

// 2. Secrets no filtrados
{
  const r = run(process.execPath, [join(ROOT, "scripts/check-env-config.mjs")]);
  results.push(check("2. Secrets no filtrados (check:env)", r.ok, r.ok ? "env OK" : "revisa check-env-config"));
}

// 3. RxDB 17
{
  const r = run(process.execPath, [join(ROOT, "scripts/check-rxdb17.mjs")]);
  results.push(check("3. RxDB 17 migración segura", r.ok, r.ok ? "rxdb17 OK" : r.stdout.slice(0, 120)));
}

// 4. Chunk boundaries + bundle size
{
  const c = run(process.execPath, [join(ROOT, "scripts/check-chunk-boundaries.mjs"), "--require-dist"]);
  const b = run(process.execPath, [join(ROOT, "scripts/check-bundle-size.mjs")]);
  results.push(check("4. Chunks + bundle size", c.ok && b.ok, c.ok && b.ok ? "chunks OK" : "revisa chunk boundaries"));
}

// 5. CSP sync
{
  const c1 = run(process.execPath, [join(ROOT, "scripts/check-csp-sync.mjs")]);
  const c2 = run(process.execPath, [join(ROOT, "scripts/check-extension-csp.mjs")]);
  const detail = c1.ok && c2.ok ? "CSP OK" : `csp desincronizada — app=${c1.ok ? "OK" : "FAIL"} ext=${c2.ok ? "OK" : "FAIL"}${c2.ok ? "" : " — " + (c2.stdout.slice(-200) || "")}`;
  results.push(check("5. CSP sincronizada (app + extensión)", c1.ok && c2.ok, detail));
}

// 6. Typecheck
{
  const r = run(process.execPath, [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "--noEmit"], { timeout: 60000 });
  results.push(check("6. TypeScript sin errores", r.ok, r.ok ? "typecheck OK" : "tsc FAIL"));
}

// 7. Tests críticos — el presupuesto propio del perfil fast es 600 s
// (scripts/test-bounded.mjs); en CI la suite tarda ~200 s, así que un tope de
// 120 s mataba la re-ejecución en el runner aunque estuviera en verde.
{
  const r = run(process.execPath, [join(ROOT, "scripts/test-fast.mjs")], { timeout: 600000 });
  results.push(check("7. Tests críticos (test:fast)", r.ok, r.ok ? "tests OK" : "test:fast FAIL"));
}

// 8. Lint — el gate original solo cubría typecheck; un regresión de lint (o
// un archivo nuevo que lo viole) no bloqueaba el deploy. Ejecuta el executor
// acotado canónico (scripts/tooling/lint-bounded.mjs) y NO un `eslint .`
// monolítico: el monolito puede superar el heap en máquinas de desarrollo y
// no reutiliza la caché compartida que la cadena ya mantiene caliente
// (node_modules/.cache/bookmarkforge-eslint).
{
  const r = run(process.execPath, [join(ROOT, "scripts", "tooling", "lint-bounded.mjs")], { timeout: 300000 });
  results.push(check("8. Lint (lint-bounded)", r.ok, r.ok ? "lint OK" : "eslint FAIL — " + (r.stdout.slice(0, 200) || "")));
}

// 9. Tests de rollback — routing CAMINO A/B, extractSha, --auto. El drill E2E
// los complementa (necesita docker); aquí se cubre la lógica pura en CI.
{
  const r = run(process.execPath, [join(ROOT, "node_modules", "vitest", "vitest.mjs"), "run", join(ROOT, "scripts", "__tests__", "rollback.test.mjs")], { timeout: 120000 });
  results.push(check("9. Tests de rollback (test:rollback)", r.ok, r.ok ? "rollback OK" : "test:rollback FAIL — " + (r.stdout.slice(0, 200) || "")));
}

// 10. Gate de calidad completo (npm run check) — i18n, audit-drift,
// license-keys, boundaries, e2e-helpers, english-only, no-unbounded-text,
// tailwind-drift, inspector-freeze… Los puntos 2-5 y 8 ya cubren parte de su
// contenido (env/csp/rxdb17/chunks/lint); este punto es la autoridad final:
// si npm run check falla, NO se declara blindado.
{
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = run(npmCmd, ["run", "check"], { timeout: 600000, shell: process.platform === "win32" });
  results.push(check("10. Gate completo (npm run check)", r.ok, r.ok ? "check OK" : "check FAIL — " + (r.stdout.slice(-300) || "")));
}

// 11. Extensión MV3/MV2 — build fresco del paquete, tests unitarios y smoke
// en Chromium real contra el artefacto empaquetado (dist-extension). El smoke
// valida que el manifest parsea, cada archivo referenciado viaja en el dist,
// el service worker arranca y el popup renderiza — la capa que los tests
// jsdom con chrome mockeado no pueden cazar (errores de empaquetado).
{
  const b = run(process.execPath, [join(ROOT, "scripts/build-extension.cjs")], { timeout: 180000 });
  const t = run(process.execPath, [join(ROOT, "node_modules", "vitest", "vitest.mjs"), "run", "--config=vitest.extension.config.ts"], { timeout: 180000 });
  const s = run(process.execPath, [join(ROOT, "scripts/extension-smoke.mjs")], { timeout: 240000 });
  const okAll = b.ok && t.ok && s.ok;
  const detail = okAll
    ? "extensión OK (build + tests + smoke)"
    : `extensión FAIL — build=${b.ok ? "OK" : "FAIL"} tests=${t.ok ? "OK" : "FAIL"} smoke=${s.ok ? "OK" : "FAIL"}${s.ok ? "" : " — " + (s.stdout.slice(-200) || "")}`;
  results.push(check("11. Extensión MV3/MV2 (build + tests + smoke)", okAll, detail));
}

const { ok } = evaluateChecklist(results);
if (isJson) {
  console.log(JSON.stringify({ ok, results, at: new Date().toISOString() }, null, 2));
} else {
  console.log(`\n${ok ? "✅ TODO BLINDADO — listo para deploy" : "❌ BLOQUEADO — corrige los FAIL antes de deploy"}\n`);
  if (!ok) console.log("Comando completo: npm run ci:local\n");
}
process.exit(ok ? 0 : 1);

} // fin if (isMain)
