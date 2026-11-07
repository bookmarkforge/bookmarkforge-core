#!/usr/bin/env node
/**
 * scripts/ci-local-parallel.mjs — a dependency-aware scheduler for the
 * `ci:local` phases.
 *
 * `npm run ci:local` is a strict `&&` chain, so every phase waits for the
 * previous one even when the two share nothing. This runner keeps the exact
 * same phase set and the exact same pass/fail contract, but replaces the chain
 * with a declared graph of **ordering** (`deps`) and **mutual exclusion**
 * (`resources`) constraints, so independent phases overlap while the phases
 * that genuinely share filesystem state stay serialized.
 *
 * The constraints are not stylistic. Each one is a real hazard in this repo:
 *
 *   1. `check` depends on `build:ci` (ordering). `check:chunks` reads
 *      `dist/assets`, and the gate now fails closed on a missing `dist/`; the
 *      `check:chunks` script opts out BY NAME with `--allow-missing-dist`
 *      because `npm run check` must stay runnable on a build-less checkout.
 *      That opt-out is reported as a skip ("SKIP: dist/assets not found"), so
 *      ordering is what keeps `check` a real verification of the fresh bundle
 *      rather than a loud no-op — a correctness requirement, not an
 *      optimization. This runner additionally fails closed if it ever sees
 *      that skip line, where the plain chain would have reported success.
 *
 *   2. `eslint-cache` (exclusion). `lint` and `check` both run
 *      `scripts/tooling/lint-bounded.mjs`, which runs eslint with `--cache`
 *      into `node_modules/.cache/bookmarkforge-eslint`. Two concurrent eslint
 *      runs share that directory.
 *
 *   3. `public-artifacts` (exclusion). `test:fast` includes
 *      `scripts/__tests__/rollback.test.mjs`, which invokes `nginx-render
 *      --write` and rewrites `public/_headers`, `public/nginx.conf` and
 *      `public/sitemap.xml`. `check` validates exactly those files
 *      (`check:nginx-render`, `check:csp`, `check:sitemap-coverage`,
 *      `check:seo`), so the two must not overlap even though neither depends
 *      on the other.
 *
 *   4. `dist` (exclusion). `build:ci` writes `dist/`; `check` reads it.
 *
 * Usage:
 *   node scripts/ci-local-parallel.mjs                  # parallel (default)
 *   node scripts/ci-local-parallel.mjs --serial         # same phases, no overlap
 *   node scripts/ci-local-parallel.mjs --concurrency=3  # bound contention
 *   node scripts/ci-local-parallel.mjs --plan           # print the schedule only
 *   node scripts/ci-local-parallel.mjs --json           # machine-readable summary
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The phases of `ci:local`, in the order the serial chain runs them. `deps`
 * and `resources` are what make the parallel schedule safe; see the header.
 */
export const PHASES = [
  {
    name: "typecheck:prod",
    command: ["npm", "run", "typecheck:prod"],
    deps: [],
    resources: [],
  },
  {
    name: "lint",
    command: ["npm", "run", "lint"],
    deps: [],
    resources: ["eslint-cache"],
  },
  {
    name: "test:fast",
    command: ["npm", "run", "test:fast"],
    deps: [],
    resources: ["public-artifacts"],
  },
  {
    name: "build:ci",
    command: ["npm", "run", "build:ci"],
    deps: [],
    resources: ["dist"],
  },
  {
    name: "check",
    command: ["npm", "run", "check"],
    deps: ["build:ci"],
    resources: ["dist", "eslint-cache", "public-artifacts"],
  },
];

/** Substrings that mean a gate validated nothing and must not pass silently. */
const SILENT_SKIP_MARKERS = [
  "SKIP: dist/assets not found",
  "dist/assets not found — nothing to analyze",
];

/** Static graph problems: unknown deps, cycles, duplicate names. */
export function validateGraph(phases = PHASES) {
  const problems = [];
  const names = new Set();
  for (const phase of phases) {
    if (names.has(phase.name)) problems.push(`duplicate phase name: ${phase.name}`);
    names.add(phase.name);
  }
  for (const phase of phases) {
    for (const dep of phase.deps) {
      if (!names.has(dep)) problems.push(`${phase.name}: unknown dep "${dep}"`);
    }
    if (phase.deps.includes(phase.name)) problems.push(`${phase.name}: depends on itself`);
    for (const resource of phase.resources) {
      if (typeof resource !== "string" || resource.length === 0) {
        problems.push(`${phase.name}: empty resource name`);
      }
    }
  }
  // Cycle detection over the dep graph.
  const state = new Map(); // name -> "visiting" | "done"
  const visit = (name, trail) => {
    if (state.get(name) === "done") return;
    if (state.get(name) === "visiting") {
      problems.push(`dependency cycle: ${[...trail, name].join(" -> ")}`);
      return;
    }
    state.set(name, "visiting");
    const phase = phases.find((p) => p.name === name);
    for (const dep of phase?.deps ?? []) visit(dep, [...trail, name]);
    state.set(name, "done");
  };
  for (const phase of phases) visit(phase.name, []);
  return problems;
}

/**
 * Pure planner: the waves the runner would execute for a given concurrency,
 * respecting deps, resources and the cap. Deterministic, so the tests can pin
 * the intended overlap and a regression in the graph is visible.
 */
export function scheduleWaves(phases = PHASES, concurrency = Infinity) {
  const waves = [];
  const scheduled = new Set();
  const remaining = [...phases];

  while (scheduled.size < phases.length) {
    const wave = [];
    const usedResources = new Set();
    for (const phase of remaining) {
      if (scheduled.has(phase.name)) continue;
      if (wave.length >= concurrency) break;
      if (!phase.deps.every((dep) => scheduled.has(dep))) continue;
      if (phase.resources.some((resource) => usedResources.has(resource))) continue;
      wave.push(phase.name);
      for (const resource of phase.resources) usedResources.add(resource);
    }
    if (wave.length === 0) {
      // Unsatisfiable (a cycle would land here) — surface it rather than hang.
      return { waves, unsatisfied: remaining.filter((p) => !scheduled.has(p.name)).map((p) => p.name) };
    }
    for (const name of wave) scheduled.add(name);
    waves.push(wave);
  }
  return { waves, unsatisfied: [] };
}

/** Serial order: the declared order, verified to respect every dep. */
export function serialOrder(phases = PHASES) {
  const order = [];
  const done = new Set();
  const remaining = [...phases];
  while (remaining.length > 0) {
    const index = remaining.findIndex((phase) => phase.deps.every((dep) => done.has(dep)));
    if (index === -1) return { order, unsatisfied: remaining.map((p) => p.name) };
    const [phase] = remaining.splice(index, 1);
    order.push(phase.name);
    done.add(phase.name);
  }
  return { order, unsatisfied: [] };
}

/** The scheduled phase may not have validated anything — fail closed. */
export function detectSilentSkip(logText) {
  return SILENT_SKIP_MARKERS.filter((marker) => logText.includes(marker));
}

// Windows resolves `npm` as `npm.cmd`, which Node only executes through a
// shell; the phase commands are static literals, so there is no injection
// surface. POSIX keeps shell:false so signals and exit codes stay direct.
const USE_SHELL = process.platform === "win32";

function runPhase(phase, logPath) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const stdout = [];
    const child = spawn(phase.command[0], phase.command.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      shell: USE_SHELL,
    });
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stdout.push(chunk));
    child.on("error", (error) => {
      writeFileSync(logPath, `${stdout.join("")}\nspawn error: ${error.message}\n`, "utf8");
      resolve({ name: phase.name, ok: false, ms: Date.now() - startedAt, logPath, reason: `spawn error: ${error.message}` });
    });
    child.on("close", (code) => {
      const text = stdout.join("");
      writeFileSync(logPath, text, "utf8");
      const skipped = detectSilentSkip(text);
      const ok = code === 0 && skipped.length === 0;
      resolve({
        name: phase.name,
        ok,
        code,
        ms: Date.now() - startedAt,
        logPath,
        reason: code !== 0 ? `exit ${code}` : skipped.length > 0 ? `silent skip: ${skipped[0]}` : null,
      });
    });
  });
}

/**
 * Run the phases. `spawnImpl` is injectable so the contract tests can drive the
 * scheduler without launching real builds (same pattern as check-quick.mjs).
 */
export async function runSchedule({
  phases = PHASES,
  concurrency = 4,
  serial = false,
  logDir,
  now = Date.now,
  onEvent = () => {},
  runner = runPhase,
} = {}) {
  const problems = validateGraph(phases);
  if (problems.length > 0) {
    return { ok: false, problems, results: [], wallMs: 0, schedule: [] };
  }

  const wavePlan = serial
    ? serialOrder(phases).order.map((name) => [name])
    : scheduleWaves(phases, concurrency).waves;
  const schedule = wavePlan.map((wave, index) => ({ wave: index + 1, phases: wave }));

  const startAll = now();
  const results = [];
  let failure = null;

  for (const wave of wavePlan) {
    if (failure) break;
    onEvent({ type: "wave-start", wave, at: now() - startAll });
    const settled = await Promise.all(
      wave.map(async (name) => {
        const phase = phases.find((p) => p.name === name);
        onEvent({ type: "phase-start", name, at: now() - startAll });
        const result = await runner(phase, join(logDir, `${name.replace(/[:/]/g, "_")}.log`));
        onEvent({ type: "phase-end", name, at: now() - startAll, ok: result.ok, ms: result.ms });
        return result;
      }),
    );
    for (const result of settled) results.push(result);
    const failed = settled.find((result) => !result.ok);
    if (failed) failure = failed;
  }

  const wallMs = now() - startAll;
  return { ok: failure === null, problems: [], results, failure, wallMs, schedule };
}

function main() {
  const args = process.argv.slice(2);
  const serial = args.includes("--serial");
  const json = args.includes("--json");
  const planOnly = args.includes("--plan");
  const concurrencyArg = args.find((arg) => arg.startsWith("--concurrency="));
  const concurrency = concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 4;

  const problems = validateGraph();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[ci-local:parallel] FAIL graph: ${problem}`);
    process.exit(1);
  }

  if (planOnly) {
    console.log(JSON.stringify(scheduleWaves(PHASES, concurrency), null, 2));
    return;
  }

  const logDir = mkdtempSync(join(tmpdir(), "ci-local-parallel-"));
  const onEvent = (event) => {
    if (event.type === "phase-start") console.log(`[ci-local:parallel] +${event.at}ms start  ${event.name}`);
    if (event.type === "phase-end") {
      console.log(`[ci-local:parallel] +${event.at}ms ${event.ok ? "PASS " : "FAIL "}  ${event.name} (${event.ms}ms)`);
    }
  };

  runSchedule({ concurrency, serial, logDir, onEvent })
    .then((summary) => {
      if (!summary.ok) {
        console.error(summary.problems.length > 0
          ? `[ci-local:parallel] graph problems: ${summary.problems.join("; ")}`
          : `[ci-local:parallel] FAIL ${summary.failure?.name}: ${summary.failure?.reason}`);
        if (summary.failure) {
          const log = readFileSync(summary.failure.logPath, "utf8");
          console.error(log.split("\n").slice(-60).map((line) => `  | ${line}`).join("\n"));
        }
        process.exit(1);
      }
      const mode = serial ? "serial" : `parallel (concurrency ${concurrency})`;
      console.log(`[ci-local:parallel] all ${summary.results.length} phases passed — ${mode}, ${summary.wallMs} ms`);
      for (const result of summary.results) {
        console.log(`[ci-local:parallel]   ${String(result.ms).padStart(7)} ms  ${result.name}`);
      }
      if (json) console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(`[ci-local:parallel] unexpected failure: ${error?.stack ?? error}`);
      process.exit(1);
    });
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href;

if (isMain) main();
