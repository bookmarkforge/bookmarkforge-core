import { describe, expect, it } from "vitest";
import { evaluateCoverageGates } from "../check-coverage-by-area.mjs";

const metrics = (covered, total = 10) => ({
  statements: { total, covered },
  branches: { total, covered },
  functions: { total, covered },
  lines: { total, covered },
});

const budgets = {
  global: { statements: 80, branches: 80, functions: 80, lines: 80 },
  areas: {
    "src/memory": { statements: 90, branches: 90, functions: 90, lines: 90 },
  },
};

describe("coverage gate parity", () => {
  it("passes aggregate and per-area checks from the shared budget shape", () => {
    const result = evaluateCoverageGates(
      { "/repo/src/memory/MemoryEngine.ts": metrics(10) },
      budgets,
    );

    expect(result.global.ok).toBe(true);
    expect(result.areas.ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails the unified result when only the global threshold is below floor", () => {
    const result = evaluateCoverageGates(
      {
        "/repo/src/memory/MemoryEngine.ts": metrics(7),
        "/repo/src/other.ts": metrics(7),
      },
      budgets,
    );

    expect(result.global.ok).toBe(false);
    expect(result.areas.ok).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.startsWith("global: "))).toBe(true);
  });

  it("does not let an area failure hide behind a passing global aggregate", () => {
    const result = evaluateCoverageGates(
      {
        "/repo/src/memory/MemoryEngine.ts": metrics(7),
        "/repo/src/other.ts": metrics(10, 10),
      },
      budgets,
    );

    expect(result.global.ok).toBe(true);
    expect(result.areas.ok).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.includes("src/memory"))).toBe(true);
  });
});
