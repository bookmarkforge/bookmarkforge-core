#!/usr/bin/env node
/**
 * scripts/drill-backup-restore.mjs — simulacro de restauración de backups.
 *
 * Automatiza el drill mensual documentado en docs/operations.md ejecutando
 * tests/e2e/drill-backup-restore.spec.ts contra el stack de staging local
 * (mismos prereqs que `npm run e2e`). El spec mide cada fase y el tiempo del
 * camino de restauración (RTO de referencia < 120 s); este script orquesta,
 * parsea las métricas [DRILL-BACKUP] y reporta una tabla PASS/FAIL con salida
 * 0/1 para CI.
 *
 * Uso:
 *   node scripts/drill-backup-restore.mjs
 *   node scripts/drill-backup-restore.mjs --json
 *
 * Env (opcionales):
 *   DRILL_BACKUP_SPEC       ruta del spec (default tests/e2e/drill-backup-restore.spec.ts)
 *   DRILL_BACKUP_TIMEOUT_MS timeout total (default 600_000)
 *   E2E_CONFIG              playwright config (default playwright.config.ts)
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const isJson = process.argv.includes("--json");

const SPEC = process.env.DRILL_BACKUP_SPEC?.trim() || "tests/e2e/drill-backup-restore.spec.ts";
const E2E_CONFIG = process.env.E2E_CONFIG?.trim() || "playwright.config.ts";
const DRILL_TIMEOUT_MS = Number(process.env.DRILL_BACKUP_TIMEOUT_MS ?? 600_000);

const phases = [];
function recordPhase(name, ok, detail, ms) {
  phases.push({ name, ok, detail, ms: Math.round(ms) });
  const icon = ok === true ? "PASS" : ok === false ? "FAIL" : "SKIP";
  console.log(`[DRILL-BACKUP] ${name.padEnd(12)} ${icon.padEnd(4)} ${(ms / 1000).toFixed(1)}s — ${detail}`);
}

const GATE_RTO_MS = Number(process.env.DRILL_RTO_MS ?? 120_000);

/** Pure gate: a restore mark is within RTO when present and below the gate. */
export function isRestoreWithinRto(ms, gateMs) {
  return typeof ms === "number" && Number.isFinite(ms) && ms < gateMs;
}

// ── Ejecución ───────────────────────────────────────────────────────
// Solo corre cuando se invoca como CLI; importar el módulo (tests) es
// side-effect free.
const IS_CLI = Boolean(
  process.argv[1] &&
    pathToFileURL(process.argv[1]).href === import.meta.url,
);
if (IS_CLI) {

// Windows expone npx como npx.cmd; spawnSync con shell resuelve .cmd sin
// pasar args separados (evita el warning DEP0190 de concatenación). En
// Windows el path del spec se pasa entre comillas para escaparlo.
const quotedSpec = `"${SPEC}"`;
const cmd =
  process.platform === "win32"
    ? `npx playwright test ${quotedSpec} --config "${E2E_CONFIG}"`
    : `npx playwright test ${SPEC} --config "${E2E_CONFIG}"`;
const out = spawnSync(cmd, {
  cwd: ROOT,
  env: { ...process.env, CI: "1" },
  encoding: "utf8",
  shell: true,
  timeout: DRILL_TIMEOUT_MS,
});

const output = (out.stdout || "") + (out.stderr || "");
const marks = [...output.matchAll(/\[DRILL-BACKUP\] (\w+)=(\d+)ms/g)].map(([, name, ms]) => ({
  name,
  ms: Number(ms),
}));

const marksByName = new Map(marks.map((m) => [m.name, m]));
const restoreBmf = marksByName.get("restore_bmf");
const restorePlain = marksByName.get("restore_plaintext");
const rtoOk =
  (restoreBmf ? isRestoreWithinRto(restoreBmf.ms, GATE_RTO_MS) : true) &&
  (restorePlain ? isRestoreWithinRto(restorePlain.ms, GATE_RTO_MS) : true);

for (const m of marks) {
  const isRestore = m.name.startsWith("restore_");
  recordPhase(
    m.name,
    !isRestore || isRestoreWithinRto(m.ms, GATE_RTO_MS),
    isRestore ? `${m.ms}ms (gate RTO < ${GATE_RTO_MS}ms)` : `${m.ms}ms`,
    m.ms,
  );
}

const failedMatch = output.match(/(\d+) failed/);
const failedCount = failedMatch ? Number(failedMatch[1]) : (out.status === 0 ? 0 : 1);
const passedMatch = output.match(/(\d+) passed/);
const passedCount = passedMatch ? Number(passedMatch[1]) : (out.status === 0 ? 2 : 0);
const playWrightOk = out.status === 0 && failedCount === 0;
const ok = playWrightOk && rtoOk;

recordPhase(
  "playwright",
  playWrightOk,
  `exit=${out.status} passed=${passedCount} failed=${failedCount}`,
  0,
);
recordPhase(
  "rto_gate",
  rtoOk,
  `restore_bmf=${restoreBmf ? restoreBmf.ms + "ms" : "n/a"} restore_plaintext=${restorePlain ? restorePlain.ms + "ms" : "n/a"} (gate < ${GATE_RTO_MS}ms)`,
  0,
);

if (!ok) {
  if (out.error) {
    console.error(`[DRILL-BACKUP] spawn error: ${String(out.error)}`);
  }
  console.error(output.slice(-4_000));
  if (isJson) {
    console.log(JSON.stringify({ ok: false, phases }));
  }
  process.exit(1);
}

if (isJson) {
  console.log(JSON.stringify({ ok: true, phases }));
}
}