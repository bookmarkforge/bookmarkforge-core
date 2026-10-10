import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STEPS } from "../gate-refresh.mjs";

/**
 * The refresh runner's whole value is ORDER: each step's input is the previous
 * step's output (ADR-052 lesson — a half-updated artifact set is
 * indistinguishable from a real regression). These tests pin the plan without
 * spawning anything: they assert on the exported STEPS structure only.
 */

function stepArgsContain(step, needle) {
  return step.args.some((arg) => arg.includes(needle));
}

function stepScript(step, filename) {
  return step.args.some((arg) => arg.endsWith(filename));
}

describe("gate-refresh plan (contract)", () => {
  it("runs exactly the 6 contractual steps in order", () => {
    expect(STEPS).toHaveLength(6);
    expect(stepScript(STEPS[0], "doctor-docs-index.mjs")).toBe(true);
    expect(stepScript(STEPS[1], "audit-anchors.mjs")).toBe(true);
    expect(stepScript(STEPS[2], "check-docs-markdown.mjs")).toBe(true);
    expect(stepScript(STEPS[3], "build-landings.cjs")).toBe(true);
    expect(stepArgsContain(STEPS[4], "vitest")).toBe(true);
    expect(stepScript(STEPS[5], "check-landings-fresh.mjs")).toBe(true);
  });

  it("regenerates the canonical docs-state index FIRST", () => {
    // The doctor auto-derives ADR rows, so everything downstream must see the
    // index it leaves behind — never the stale one.
    expect(stepScript(STEPS[0], "doctor-docs-index.mjs")).toBe(true);
    expect(STEPS[0].args.at(-1)).toBe("--update");
  });

  it("fixes the anchor catalog + baseline SECOND, with --fix", () => {
    // audit-anchors resolves its globs against the tree as left by step 1 and
    // writes the baseline the contract tests read.
    expect(STEPS[1].args.at(-1)).toBe("--fix");
  });

  it("widens the docs-markdown baseline THIRD, with --update", () => {
    // Must run after the index (step 1) and anchor catalog (step 2) exist in
    // their fresh form; its own baseline covers the ADR corpus.
    expect(STEPS[2].args.at(-1)).toBe("--update");
  });

  it("step 4 regenerates landings mechanically (builder invoked bare)", () => {
    // The exact fix `check:landings-fresh` prescribes; no flags, no side args
    // (args = the script path itself, nothing else).
    expect(stepScript(STEPS[3], "build-landings.cjs")).toBe(true);
    expect(STEPS[3].args).toHaveLength(1);
  });

  it("step 5 verifies exactly the four gates' contract tests", () => {
    const runArgs = STEPS[4].args;
    expect(stepArgsContain(STEPS[4], "vitest.mjs")).toBe(true);
    for (const test of [
      "docs-state-index.test.mjs",
      "audit-anchors.test.mjs",
      "check-docs-markdown.test.mjs",
      "check-landings-fresh.test.mjs",
    ]) {
      expect(runArgs.some((arg) => arg.endsWith(test))).toBe(true);
    }
    // No extra test files slipped in: the refresh verifies the gates it
    // regenerates, nothing else (full-suite is the caller's job).
    const listed = runArgs.filter((arg) => arg.endsWith(".test.mjs"));
    expect(listed).toHaveLength(4);
  });

  it("step 6 re-verifies in gate mode (no --update / --fix flags anywhere)", () => {
    for (const arg of STEPS[5].args) {
      expect(arg).not.toBe("--update");
      expect(arg).not.toBe("--fix");
    }
  });

  it("never touches the i18n baselines (human decisions, not mechanical)", () => {
    // check:i18n:fix records a reviewed rebaseline (backlog level, stale
    // English acknowledgements) — rebaselining is a decision, never a bulk
    // refresh step. Pin the exclusion so it cannot creep back in silently.
    const everything = STEPS.flatMap((s) => [s.cmd, ...s.args]).join(" ");
    expect(everything).not.toContain("i18n-completeness");
    expect(everything).not.toContain("check-i18n-quality");
    expect(everything).not.toContain("i18n-backlog-baseline");
  });

  it("every step spawns node directly with an args array (no npm, no shell)", () => {
    // npm indirection adds env/CWD variance and a shell layer; the runner is
    // meant to be deterministic and portable.
    for (const step of STEPS) {
      expect(step.cmd).toBe(process.execPath);
      expect(Array.isArray(step.args)).toBe(true);
      expect(step.args.length).toBeGreaterThan(0);
    }
  });

  it("every script and test file the plan references exists on disk", () => {
    // Guards against silent renames: a moved test file would make the test
    // step verify nothing without anyone noticing.
    for (const step of STEPS) {
      for (const arg of step.args) {
        if (arg.endsWith(".mjs") || arg.endsWith(".cjs")) {
          expect(existsSync(arg), `missing file referenced by plan: ${arg}`).toBe(true);
        }
      }
    }
  });

  it("importing the module has no side effects (safe for vitest)", () => {
    // If this module ever regresses to running steps at import time, the
    // runner would fire inside every vitest process. The import above already
    // proved it: reaching this test at all means no spawn happened.
    expect(typeof STEPS).toBe("object");
    expect(Array.isArray(STEPS)).toBe(true);
  });
});
