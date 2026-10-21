#!/usr/bin/env node
/**
 * scripts/run-check-chain.mjs — run EVERY gate of the `npm run check` chain and
 * report all of them, instead of stopping at the first red one.
 *
 * WHY THIS EXISTS
 *
 * `check` used to be `npm run check:security && npm run check:quality && …`.
 * On 2026-10-16 that chain exited 1 inside `check:content`, at `check:i18n`
 * (`check-i18n-quality`: two locale baseline overflows). Every gate declared
 * after it never ran — the rest of the content group plus the whole brand and
 * build groups, 26 gates. The operator saw ONE failure and learned nothing
 * about the other 25; worse, a green gate and a skipped gate were
 * indistinguishable in the output. The same abort happened one level down,
 * because each group is an `&&` chain too.
 *
 * WHAT IT DOES
 *
 *   - The CLI takes the chain's stage tokens (`check:security check:quality
 *     check:content check:brand check:build`) — the literal tokens stay in the
 *     `check` script because `scripts/check-inspector-freeze.mjs` walks that
 *     script transitively and freezes the gate set it resolves to.
 *   - They are written there as `npm run check:security npm run check:quality
 *     …`, not bare, because `scripts/check-script-reachability.mjs` only counts
 *     an invocation when it reads `npm run <name>` (`npmRunReferences`):
 *     dropping the prefix would leave the five group scripts looking
 *     unreachable. `normalizeStageArgs` accepts both shapes — a lone `npm run`
 *     connector is shape, not a stage, so it is consumed before validation and a
 *     stray `npm`/`run` is still refused.
 *   - Each stage token is EXPANDED to the individual gates it runs, in
 *     declaration order, using the same reference rule as the freeze (see
 *     `REFERENCE_RE`). The unit of continuation is the gate, so one red
 *     `check:i18n` can no longer hide `check:docs-markdown`, `check:seo` or
 *     `check:nginx-render`.
 *   - Every gate runs even after a failure, streaming its output straight
 *     through, and the run ends with one summary: each gate with its status
 *     and duration, the total, and the explicit list of red gates.
 *
 * LIMITS, STATED PLAINLY (a gate that is "green" here is green only if it ran):
 *
 *   - One gate that runs several sub-scripts internally (`check:i18n` runs the
 *     completeness scanner, the quality scanner and the code scanner as one
 *     `node … && node … && node …` body) still stops at its own first failing
 *     sub-script: those are not separate `check:*` tokens, so they cannot be
 *     scheduled independently. The summary names the gate that went red, and
 *     running that gate alone prints its own reason.
 *   - No per-gate timeout. The chain is offline and its slowest gates (the i18n
 *     scans, the docs corpus walks) are measurements, not hangs: a timeout
 *     would convert a slow-but-correct gate into a red one and hide the real
 *     state, which is the failure this runner exists to remove. Job-level
 *     limits belong to CI, which already has them.
 *   - An interrupted gate (SIGINT/SIGTERM) ABORTS the remaining gates — the
 *     operator asked to stop — and the process exits with the conventional
 *     128+signal code instead of pretending the run completed.
 *   - Exit codes: 0 all gates green; 1 at least one red gate; 2 a usage error
 *     (unknown token, no token, a stage that resolves to no gate, or a chain
 *     that references an undeclared script — never a silent green).
 *
 * The logic is exported so `scripts/__tests__/run-check-chain.test.mjs` can
 * exercise the expansion, the aggregation and the exit codes without spawning
 * npm.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCommandLine } from "./command-runner.mjs";

const ROOT = process.cwd();
const TAG = "[check-chain]";

/** The token shape the chain is measured in: `check:*` scripts plus `lint`. */
export const GATE_TOKEN_RE = /^(?:check:[a-z0-9:-]+|lint)$/;

/**
 * Every `check:*`/`lint` token a script body invokes, with or without the
 * `npm run` prefix. Deliberately identical to the rule in
 * `check-inspector-freeze.mjs` (the trailing lookahead keeps `lint` from
 * matching inside a path like `scripts/tooling/lint-bounded.mjs`), so the
 * runner and the freeze can never disagree about what the chain contains.
 */
export const REFERENCE_RE = /(?:npm run )?(check:[a-z0-9:-]+|lint)(?![a-z0-9:_-])/g;

/** Gate tokens referenced by one script body, in declaration order. */
export function referencesIn(command) {
  return [...String(command ?? "").matchAll(REFERENCE_RE)].map((match) => match[1]);
}

/**
 * Split the CLI's argv into stage tokens, consuming the `npm run` connectors
 * the `check` script writes (see the header). Returns the stage tokens plus any
 * token that is neither a connector nor a gate token, so a typo or an injected
 * argument can never be silently dropped.
 */
export function normalizeStageArgs(argv) {
  const stages = [];
  const invalid = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "npm") {
      if (argv[index + 1] !== "run") {
        invalid.push(token);
        continue;
      }
      index += 1;
      continue;
    }
    if (token === "run" && argv[index - 1] !== "npm") {
      invalid.push(token);
      continue;
    }
    stages.push(token);
  }
  return { stages, invalid };
}

/**
 * Validate the CLI's stage tokens. Unknown tokens are refused before anything
 * runs: a typo must not turn into "ran nothing, exited 0".
 */
export function validateStages(stages) {
  const invalid = stages.filter((stage) => !GATE_TOKEN_RE.test(stage));
  const duplicates = stages.filter(
    (stage, index) => GATE_TOKEN_RE.test(stage) && stages.indexOf(stage) !== index,
  );
  return { ok: invalid.length === 0 && duplicates.length === 0, invalid, duplicates };
}

/**
 * Expand stage tokens to the individual gates they run, in declaration order.
 *
 * A script whose body references another gate is a GROUP (a label); a script
 * that runs its own commands is a GATE and is the thing we schedule. Throws on
 * a stage that declares no script, on a reference to an undeclared script and
 * on a cycle: each of those would otherwise shrink the run silently, and a
 * chain that reports green while running less than it claims is worse than a
 * red build.
 */
export function expandGates(pkg, stages) {
  const scripts = pkg?.scripts ?? {};
  const ordered = [];
  const handled = new Set();
  const expanding = new Set();

  const visit = (name) => {
    if (handled.has(name)) return;
    if (expanding.has(name)) {
      throw new Error(`${TAG} the chain references "${name}" cyclically`);
    }
    const command = scripts[name];
    if (typeof command !== "string") {
      throw new Error(`${TAG} package.json declares no script "${name}"`);
    }
    const refs = referencesIn(command).filter((ref) => GATE_TOKEN_RE.test(ref));
    if (refs.length === 0) {
      handled.add(name);
      ordered.push(name);
      return;
    }
    expanding.add(name);
    for (const ref of refs) visit(ref);
    expanding.delete(name);
    handled.add(name);
  };

  for (const stage of stages) visit(stage);
  return ordered;
}

/** `1234` → `1.2s`, `840` → `840ms`. */
export function formatDuration(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Conventional shell exit code for a signal-terminated child. */
export function signalExitCode(signal) {
  const table = { SIGHUP: 129, SIGINT: 130, SIGQUIT: 131, SIGKILL: 137, SIGTERM: 143 };
  return table[signal] ?? 1;
}

/**
 * Map a raw `spawnSync` result onto `{ code, signal }`. A child that never
 * started (missing npm, unusable shim) is a RED gate, never a silent skip.
 */
export function resolveSpawnOutcome(result) {
  const signal = result?.signal ?? null;
  if (signal) return { code: null, signal };
  return { code: typeof result?.status === "number" ? result.status : 1, signal: null };
}

/** Aggregate finished results into the failed list and the process exit code. */
export function summarizeResults(results) {
  const failed = results.filter((result) => result.code !== 0);
  const interrupted = results.find((result) => result.signal !== null);
  const exitCode = interrupted
    ? signalExitCode(interrupted.signal)
    : failed.length > 0
      ? 1
      : 0;
  return { failed, interrupted: interrupted ?? null, exitCode };
}

function defaultRun(gate) {
  const result = runCommandLine(`npm run ${gate}`, { stdio: "inherit" });
  if (result?.error && result.status === null && !result.signal) {
    console.error(`${TAG} could not run ${gate}: ${result.error.message}`);
  }
  return resolveSpawnOutcome(result);
}

/**
 * Run the gates sequentially, streaming output, and keep going after a red one.
 * Sequential on purpose: these gates are CPU/disk heavy and parallel execution
 * would make the individual durations — and the timing-sensitive gates —
 * meaningless.
 */
export function runChain(gates, options = {}) {
  const run = options.run ?? defaultRun;
  const results = [];
  for (const gate of gates) {
    const startedAt = Date.now();
    const outcome = run(gate);
    const result = { gate, code: outcome.code, signal: outcome.signal ?? null, ms: Date.now() - startedAt };
    results.push(result);
    if (result.signal) {
      // The operator interrupted the run: stop scheduling, keep what we have.
      return { results, ...summarizeResults(results) };
    }
    if (result.code !== 0) {
      console.error(
        `${TAG} FAIL ${gate} (exit ${result.code}) — continuing with the remaining gate(s)`,
      );
    }
  }
  return { results, ...summarizeResults(results) };
}

function printSummary(results, failed) {
  const totalMs = results.reduce((sum, result) => sum + result.ms, 0);
  console.log(`${TAG} ── summary ──`);
  for (const result of results) {
    const status = result.signal
      ? `signal ${result.signal}`
      : result.code === 0
        ? "ok"
        : `FAIL exit ${result.code}`;
    console.log(`${TAG} ${status.padEnd(14)} ${result.gate.padEnd(32)} ${formatDuration(result.ms)}`);
  }
  console.log(
    `${TAG} ${results.length - failed.length}/${results.length} gate(s) green in ${formatDuration(totalMs)}`,
  );
  if (failed.length === 0) {
    console.log(`${TAG} all gates passed`);
    return;
  }
  console.log(`${TAG} ${failed.length} gate(s) failed:`);
  for (const result of failed) {
    const why = result.signal ? `signal ${result.signal}` : `exit ${result.code}`;
    console.log(`${TAG}   - ${result.gate} (${why})`);
  }
}

/** CLI entry point. Returns the process exit code (2 = usage error). */
export function main(argv) {
  const raw = argv.slice(2);
  if (raw.length === 0) {
    console.error(`${TAG} no stage given: pass the chain tokens (npm run check:security npm run check:quality npm run check:content npm run check:brand npm run check:build)`);
    return 2;
  }
  const connectorCheck = normalizeStageArgs(raw);
  if (connectorCheck.invalid.length > 0) {
    console.error(`${TAG} refusing malformed argument(s): ${connectorCheck.invalid.join(", ")}`);
    return 2;
  }
  const stages = connectorCheck.stages;
  const { ok, invalid, duplicates } = validateStages(stages);
  if (!ok) {
    if (invalid.length > 0) {
      console.error(`${TAG} refusing unknown stage token(s): ${invalid.join(", ")}`);
    }
    if (duplicates.length > 0) {
      console.error(`${TAG} refusing repeated stage token(s): ${duplicates.join(", ")}`);
    }
    return 2;
  }

  let gates;
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    gates = expandGates(pkg, stages);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (gates.length === 0) {
    console.error(`${TAG} the chain resolved to zero gates — refusing to report success`);
    return 2;
  }

  console.log(`${TAG} running ${gates.length} gate(s): ${gates.join(", ")}`);
  const { results, failed, exitCode } = runChain(gates);
  printSummary(results, failed);
  return exitCode;
}

if (process.argv[1]?.endsWith("run-check-chain.mjs")) {
  process.exit(main(process.argv));
}
