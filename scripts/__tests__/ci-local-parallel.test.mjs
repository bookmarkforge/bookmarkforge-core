// @vitest-environment node
/**
 * scripts/__tests__/ci-local-parallel.test.mjs
 *
 * Contract tests for the ci:local scheduler. They pin the properties that make
 * the parallel run SAFE rather than merely fast: the ordering dependency that
 * keeps `check:chunks` from silently skipping, the resource exclusions that
 * keep concurrent phases off each other's files, and the fail-closed behaviour.
 */
import { describe, expect, it } from "vitest";
import {
  PHASES,
  detectSilentSkip,
  runSchedule,
  scheduleWaves,
  serialOrder,
  validateGraph,
} from "../ci-local-parallel.mjs";

const phaseByName = (name) => PHASES.find((phase) => phase.name === name);

describe("ci-local-parallel graph", () => {
  it("has no graph problems", () => {
    expect(validateGraph()).toEqual([]);
  });

  it("keeps check ordered after build:ci (dist freshness, not style)", () => {
    expect(phaseByName("check").deps).toContain("build:ci");
  });

  it("excludes check from lint via the shared eslint cache", () => {
    const shared = phaseByName("check").resources.filter((resource) =>
      phaseByName("lint").resources.includes(resource),
    );
    expect(shared).toContain("eslint-cache");
  });

  it("excludes check from test:fast via the shared public/ artifacts", () => {
    const shared = phaseByName("check").resources.filter((resource) =>
      phaseByName("test:fast").resources.includes(resource),
    );
    expect(shared).toContain("public-artifacts");
  });

  it("excludes check from build:ci via dist", () => {
    const shared = phaseByName("check").resources.filter((resource) =>
      phaseByName("build:ci").resources.includes(resource),
    );
    expect(shared).toContain("dist");
  });

  it("runs the four independent phases together and check alone afterwards", () => {
    const { waves, unsatisfied } = scheduleWaves(PHASES, 4);
    expect(unsatisfied).toEqual([]);
    expect(waves).toHaveLength(2);
    expect([...waves[0]].sort()).toEqual(["build:ci", "lint", "test:fast", "typecheck:prod"]);
    expect(waves[1]).toEqual(["check"]);
  });

  it("degrades to one phase per wave at concurrency 1", () => {
    const { waves } = scheduleWaves(PHASES, 1);
    expect(waves.every((wave) => wave.length === 1)).toBe(true);
    expect(waves.flat()).toHaveLength(PHASES.length);
  });

  it("keeps the declared ci:local order for the serial path", () => {
    const { order, unsatisfied } = serialOrder(PHASES);
    expect(unsatisfied).toEqual([]);
    expect(order).toEqual(PHASES.map((phase) => phase.name));
  });

  it("rejects unknown deps and cycles", () => {
    expect(validateGraph([{ name: "a", deps: ["ghost"], resources: [] }]))
      .toContain('a: unknown dep "ghost"');
    expect(validateGraph([
      { name: "a", deps: ["b"], resources: [] },
      { name: "b", deps: ["a"], resources: [] },
    ]).some((problem) => problem.startsWith("dependency cycle"))).toBe(true);
  });
});

describe("ci-local-parallel fail-closed behaviour", () => {
  it("detects the silent chunk-gate skip", () => {
    const skipped = detectSilentSkip(
      "[check-chunk-boundaries] SKIP: dist/assets not found — nothing to analyze.",
    );
    expect(skipped.length).toBeGreaterThan(0);
    expect(detectSilentSkip("all good")).toEqual([]);
  });

  it("stops dependents when a phase fails", async () => {
    const seen = [];
    const summary = await runSchedule({
      concurrency: 4,
      logDir: "/tmp/ci-local-test",
      runner: async (phase) => {
        seen.push(phase.name);
        return { name: phase.name, ok: phase.name !== "build:ci", ms: 1, logPath: "/dev/null", reason: "exit 1" };
      },
    });
    expect(summary.ok).toBe(false);
    expect(summary.failure.name).toBe("build:ci");
    // check depends on build:ci, so it must never have been started.
    expect(seen).not.toContain("check");
  });

  it("overlaps the four independent phases and serializes check", async () => {
    const started = new Set();
    const summary = await runSchedule({
      concurrency: 4,
      logDir: "/tmp/ci-local-test",
      runner: async (phase) => {
        started.add(phase.name);
        return { name: phase.name, ok: true, ms: 1, logPath: "/dev/null" };
      },
    });
    expect(summary.ok).toBe(true);
    expect(started.size).toBe(PHASES.length);
    expect(summary.schedule.map((entry) => entry.phases.length)).toEqual([4, 1]);
  });

  it("runs strictly one phase at a time in serial mode", async () => {
    let running = 0;
    let maxRunning = 0;
    await runSchedule({
      serial: true,
      logDir: "/tmp/ci-local-test",
      runner: async (phase) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
        return { name: phase.name, ok: true, ms: 1, logPath: "/dev/null" };
      },
    });
    expect(maxRunning).toBe(1);
  });
});
