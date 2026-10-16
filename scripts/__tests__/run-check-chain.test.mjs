import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chainGateTokens } from "../check-inspector-freeze.mjs";
import { npmRunReferences } from "../check-script-reachability.mjs";
import {
  expandGates,
  formatDuration,
  main,
  normalizeStageArgs,
  referencesIn,
  resolveSpawnOutcome,
  runChain,
  signalExitCode,
  validateStages,
} from "../run-check-chain.mjs";

/**
 * The runner and the inspector freeze must agree about what the chain contains:
 * the runner decides what to EXECUTE, the freeze decides what is allowed to
 * exist, and a disagreement is either a hidden gate or a red build. These tests
 * assert the agreement on the real package.json, not on a fixture.
 */
const REAL_PKG = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
const CHAIN_STAGES = [
  "check:security",
  "check:quality",
  "check:content",
  "check:brand",
  "check:build",
];

const FIXTURE_PKG = {
  scripts: {
    check: "npm run check:a && npm run check:b",
    "check:a": "npm run check:a1 && npm run check:a2",
    "check:a1": "node scripts/a1.mjs",
    "check:a2": "node scripts/a2.mjs",
    "check:b": "node scripts/b.mjs",
  },
};

describe("run-check-chain — chain expansion", () => {
  it("reads gate references out of a script body", () => {
    expect(referencesIn("npm run check:env && npm run lint && node scripts/x.mjs")).toEqual([
      "check:env",
      "lint",
    ]);
    // A path that merely contains "lint" is not a token.
    expect(referencesIn("node scripts/tooling/lint-bounded.mjs")).toEqual([]);
  });

  it("expands groups to their gates in declaration order", () => {
    expect(expandGates(FIXTURE_PKG, ["check"])).toEqual(["check:a1", "check:a2", "check:b"]);
  });

  it("runs a gate once even when two stages reference it", () => {
    expect(expandGates(FIXTURE_PKG, ["check:a", "check:a"])).toEqual(["check:a1", "check:a2"]);
  });

  it("keeps `lint` as a schedulable gate", () => {
    const pkg = { scripts: { check: "npm run lint", lint: "node scripts/tooling/lint-bounded.mjs" } };
    expect(expandGates(pkg, ["check"])).toEqual(["lint"]);
  });

  it("resolves the real chain to exactly the gate set the freeze freezes", () => {
    const expanded = expandGates(REAL_PKG, CHAIN_STAGES);
    const frozen = chainGateTokens(REAL_PKG);
    expect(new Set(expanded)).toEqual(new Set(frozen));
    expect(expanded).toHaveLength(frozen.length);
  });

  it("schedules gates, never the group labels", () => {
    const expanded = expandGates(REAL_PKG, CHAIN_STAGES);
    for (const stage of CHAIN_STAGES) {
      expect(expanded).not.toContain(stage);
    }
    // Declaration order, not a set: the first gate of the first stage opens the
    // run and the last gate of the last stage closes it.
    expect(expanded[0]).toBe("check:open-core");
    expect(expanded[expanded.length - 1]).toBe("check:inspector-freeze");
  });

  it("fails closed on an undeclared stage, a dangling reference and a cycle", () => {
    expect(() => expandGates({ scripts: {} }, ["check:nope"])).toThrow(/declares no script/);
    expect(() => expandGates({ scripts: { check: "npm run check:missing" } }, ["check"])).toThrow(
      /declares no script "check:missing"/,
    );
    expect(() =>
      expandGates(
        { scripts: { check: "npm run check:x", "check:x": "npm run check:y", "check:y": "npm run check:x" } },
        ["check"],
      ),
    ).toThrow(/cyclically/);
  });
});

describe("run-check-chain — stage validation", () => {
  it("keeps the `npm run` shape the check script uses, and accepts it", () => {
    const argv = CHAIN_STAGES.flatMap((stage) => ["npm", "run", stage]);
    expect(normalizeStageArgs(argv)).toEqual({ stages: CHAIN_STAGES, invalid: [] });
    expect(validateStages(normalizeStageArgs(argv).stages).ok).toBe(true);

    // A real `check` body must keep the prefix: check-script-reachability only
    // counts `npm run <name>` as an invocation, so bare tokens would leave the
    // five group scripts looking unreachable.
    expect(npmRunReferences(REAL_PKG.scripts.check)).toEqual(CHAIN_STAGES);
    // …and the runner reads the same five stage tokens out of it.
    expect(referencesIn(REAL_PKG.scripts.check)).toEqual(CHAIN_STAGES);
  });

  it("refuses a connector that is not a connector", () => {
    expect(normalizeStageArgs(["npm", "check:security"]).invalid).toEqual(["npm"]);
    expect(normalizeStageArgs(["run", "check:security"]).invalid).toEqual(["run"]);
  });

  it("accepts gate tokens and rejects everything else before running", () => {
    expect(validateStages(CHAIN_STAGES).ok).toBe(true);
    expect(validateStages(["check:security", "lint"]).ok).toBe(true);

    for (const hostile of [
      "check:security; rm -rf /",
      "node scripts/evil.mjs",
      "--version",
      "check:security && whoami",
      "check:SECURITY",
    ]) {
      const result = validateStages([hostile]);
      expect(result.ok).toBe(false);
      expect(result.invalid).toEqual([hostile]);
    }
  });

  it("refuses a repeated stage token", () => {
    const result = validateStages(["check:security", "check:security"]);
    expect(result.ok).toBe(false);
    expect(result.duplicates).toEqual(["check:security"]);
  });

  it("returns a usage error (2) without running anything for an unknown token", () => {
    expect(main(["node", "run-check-chain.mjs", "check:security; rm -rf /"])).toBe(2);
    expect(main(["node", "run-check-chain.mjs"])).toBe(2);
  });
});

describe("run-check-chain — execution and summary", () => {
  it("runs every gate after a failure and reports the red one", () => {
    const calls = [];
    const outcome = runChain(["check:a", "check:b", "check:c"], {
      run: (gate) => {
        calls.push(gate);
        return gate === "check:b" ? { code: 1, signal: null } : { code: 0, signal: null };
      },
    });

    expect(calls).toEqual(["check:a", "check:b", "check:c"]);
    expect(outcome.results.map((result) => result.gate)).toEqual(["check:a", "check:b", "check:c"]);
    expect(outcome.failed.map((result) => result.gate)).toEqual(["check:b"]);
    expect(outcome.exitCode).toBe(1);
  });

  it("is green only when every gate ran green", () => {
    const outcome = runChain(["check:a", "check:b"], { run: () => ({ code: 0, signal: null }) });
    expect(outcome.failed).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });

  it("aborts the remaining gates on a signal and keeps the conventional exit code", () => {
    const calls = [];
    const outcome = runChain(["check:a", "check:b", "check:c"], {
      run: (gate) => {
        calls.push(gate);
        return gate === "check:b" ? { code: null, signal: "SIGINT" } : { code: 0, signal: null };
      },
    });

    expect(calls).toEqual(["check:a", "check:b"]);
    expect(outcome.interrupted?.gate).toBe("check:b");
    expect(outcome.exitCode).toBe(130);
  });

  it("keeps a gate that never started as a red gate, never a silent skip", () => {
    expect(resolveSpawnOutcome({ status: null, signal: null, error: new Error("ENOENT") })).toEqual({
      code: 1,
      signal: null,
    });
    expect(resolveSpawnOutcome({ status: null, signal: "SIGTERM" })).toEqual({
      code: null,
      signal: "SIGTERM",
    });
    expect(resolveSpawnOutcome({ status: 2, signal: null })).toEqual({ code: 2, signal: null });
    expect(signalExitCode("SIGINT")).toBe(130);
    expect(signalExitCode("SIGTERM")).toBe(143);
    expect(signalExitCode("SIGWHATEVER")).toBe(1);
  });

  it("formats durations for both scale", () => {
    expect(formatDuration(840)).toBe("840ms");
    expect(formatDuration(12340)).toBe("12.3s");
  });
});
