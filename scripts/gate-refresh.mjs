#!/usr/bin/env node
/**
 * scripts/gate-refresh.mjs — one ordered regeneration pass for the drift
 * gates whose artifacts must move TOGETHER (ADR-052 lesson: a half-updated
 * set — script edited, baseline pending, files not yet on disk — is
 * indistinguishable from a real regression, and it broke the suite once).
 *
 * Order is contractual (each step's input is the previous step's output):
 *
 *   1. doctor-docs-index --update   canonical docs/docs-state-index.md
 *      (auto-derives ADR rows, so it must run before anything that reads or
 *      validates the index)
 *   2. audit-anchors --fix          anchor catalog + baseline, resolved
 *      against the tree state that step 1 just left behind
 *   3. check-docs-markdown --update docs-markdown baseline (ADR corpus
 *      included), widened to whatever docs/ now contains
 *   4. build-landings               regenerate public/ landing pages from
 *      their translation JSONs (the mechanical fix `check:landings-fresh`
 *      itself prescribes). Independent of steps 1-3 but placed before the
 *      tests so step 5 verifies the post-refresh tree in full.
 *   5. the contract tests of the four gates, green right after refresh —
 *      if these fail, the regeneration produced drift of its own and the
 *      output must be reviewed before committing anything
 *
 * Verification (not regeneration) is step 6: the gates re-run in gate mode.
 * A refresh that immediately fails its own gate is a bug, not a state.
 *
 * Deliberately NOT here: the i18n baselines (`scripts/i18n-backlog-baseline.json`,
 * the quality-gate baseline). Their `--fix` records a HUMAN decision — the
 * untranslated-backlog level a reviewer accepts and the stale-English issues
 * acknowledged — not a mechanical derivation from the tree. Rebaselining is
 * `npm run check:i18n:fix` plus a reviewed commit, never a bulk refresh.
 *
 * This is a maintainer convenience tool, not a CI gate: it WRITES
 * baselines. Never wire it into `npm run check`; regenerating baselines is
 * a deliberate, reviewed act (AGENTS.md §6). `BMF_GATE_REFRESH_DRY=1`
 * prints the plan without executing.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The refresh WRITES the paired artifacts, so the preflight (also imported by
// test-bounded/test-fast) would warn about itself while running. Disable it
// for the spawned steps by exposing the same contract its hook honors.
process.env.BMF_DRIFT_PREFLIGHT = process.env.BMF_DRIFT_PREFLIGHT ?? "off";

const ROOT = process.cwd();
const TAG = "[gate:refresh]";
const DRY = process.env.BMF_GATE_REFRESH_DRY === "1";

/**
 * The plan, exported for the contract test (gate-refresh.test.mjs): the
 * ORDER of these steps is the whole point of the tool, so the test pins it.
 */
export const STEPS = [
  {
    name: "1. doctor-docs-index --update (canonical docs-state-index)",
    cmd: process.execPath,
    args: [join(ROOT, "scripts", "doctor-docs-index.mjs"), "--update"],
  },
  {
    name: "2. audit-anchors --fix (anchor catalog + baseline)",
    cmd: process.execPath,
    args: [join(ROOT, "scripts", "audit-anchors.mjs"), "--fix"],
  },
  {
    name: "3. check-docs-markdown --update (docs-markdown baseline)",
    cmd: process.execPath,
    args: [join(ROOT, "scripts", "check-docs-markdown.mjs"), "--update"],
  },
  {
    name: "4. build-landings (regenerate public/ landing pages)",
    cmd: process.execPath,
    args: [join(ROOT, "scripts", "build-landings.cjs")],
  },
  {
    name: "5. contract tests of the four gates",
    cmd: process.execPath,
    args: [
      join(ROOT, "node_modules", "vitest", "vitest.mjs"),
      "run",
      join(ROOT, "scripts", "__tests__", "docs-state-index.test.mjs"),
      join(ROOT, "scripts", "__tests__", "audit-anchors.test.mjs"),
      join(ROOT, "scripts", "__tests__", "check-docs-markdown.test.mjs"),
      join(ROOT, "scripts", "__tests__", "check-landings-fresh.test.mjs"),
    ],
  },
  {
    name: "6. gate-mode re-verification (must pass immediately after refresh)",
    cmd: process.execPath,
    args: [
      join(ROOT, "scripts", "check-docs-markdown.mjs"),
      join(ROOT, "scripts", "check-landings-fresh.mjs"),
    ],
  },
];

// Run only when invoked directly (`npm run gate:refresh`); importing the
// module (tests) must not spawn anything or exit the host process.
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
if (DRY) {
  console.log(`${TAG} DRY RUN — plan only:`);
  for (const step of STEPS) {
    console.log(`${TAG}   ${step.name}`);
    console.log(`${TAG}     ${[step.cmd, ...step.args].join(" ")}`);
  }
  process.exit(0);
}

const failures = [];
for (const step of STEPS) {
  console.log(`${TAG} ▶ ${step.name}`);
  const result = spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd();
  if (out) console.log(out.split("\n").map((l) => `  │ ${l}`).join("\n"));
  if (result.status !== 0) {
    failures.push(step.name);
    console.error(`${TAG} ✗ step failed (exit ${result.status}) — remaining steps cancelled`);
    break;
  }
  console.log(`${TAG} ✓ step ok`);
}

if (failures.length > 0) {
  console.error(
    `${TAG} FAIL — refresh incomplete: ${failures.join(" | ")}. ` +
      "Review the failing step's output before committing any regenerated baseline.",
  );
  process.exit(1);
}
console.log(
  `${TAG} OK — 6/6 steps green. Regenerated artifacts are uncommitted: ` +
    "review the diff (git diff scripts/ docs/) before staging.",
);
process.exit(0);
}
