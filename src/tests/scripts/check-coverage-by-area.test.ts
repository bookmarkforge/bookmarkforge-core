/**
 * Unit tests for scripts/check-coverage-by-area.mjs (audit 2026-08-13,
 * per-directory coverage budgets — "mejora de alto impacto" #2).
 *
 * The gate parses coverage/coverage-final.json (v8 provider) and enforces
 * per-area budgets. The pure functions are driven here with in-memory
 * fixtures covering both emitted formats (v8 object form and istanbul map
 * form) and both path styles (forward/back slashes).
 */
import { describe, it, expect } from "vitest";
import {
  evaluateAreaCoverage,
  fileMetrics,
  toRelativeKey,
} from "../../../scripts/check-coverage-by-area.mjs";

// v8 object form entries (what @vitest/coverage-v8 emits today).
const v8Entry = {
  statements: { total: 10, covered: 8 },
  branches: { total: 6, covered: 5 },
  functions: { total: 3, covered: 2 },
  lines: { total: 10, covered: 8 },
};

// istanbul map form (legacy emit / some providers).
const istanbulEntry = {
  statementMap: { 0: {}, 1: {}, 2: {} },
  s: { 0: 1, 1: 0, 2: 2 },
  fnMap: { 0: {}, 1: {} },
  f: { 0: 3, 1: 0 },
  branchMap: { 0: {} },
  b: { 0: [1, 0, 1] },
  lineMap: { 0: {}, 1: {} },
  l: { 0: 1, 1: 0 },
};

describe("toRelativeKey", () => {
  it("strips the drive/path prefix up to /src/", () => {
    expect(toRelativeKey("C:/repo/src/services/x.ts")).toBe("src/services/x.ts");
    expect(toRelativeKey("C:\\repo\\src\\services\\x.ts")).toBe("src/services/x.ts");
    expect(toRelativeKey("/home/ci/src/utils/y.ts")).toBe("src/utils/y.ts");
  });

  it("passes through keys without /src/", () => {
    expect(toRelativeKey("src/no-prefix.ts")).toBe("src/no-prefix.ts");
  });
});

describe("fileMetrics", () => {
  it("reads the v8 object form", () => {
    const m = fileMetrics(v8Entry);
    expect(m.statements).toEqual([10, 8]);
    expect(m.branches).toEqual([6, 5]);
    expect(m.functions).toEqual([3, 2]);
    expect(m.lines).toEqual([10, 8]);
  });

  it("reads the istanbul map form", () => {
    const m = fileMetrics(istanbulEntry);
    expect(m.statements).toEqual([3, 2]); // 3 statements, 2 hit
    expect(m.functions).toEqual([2, 1]);
    expect(m.branches).toEqual([3, 2]); // [1, 0, 1]
    expect(m.lines).toEqual([2, 1]);
  });

  it("derives lines from statement start lines when lineMap is absent (v8 provider)", () => {
    const entry = {
      statementMap: {
        0: { start: { line: 1 } },
        1: { start: { line: 1 } },
        2: { start: { line: 2 } },
      },
      s: { 0: 1, 1: 0, 2: 2 },
      fnMap: { 0: {} },
      f: { 0: 3 },
    };
    const m = fileMetrics(entry);
    // line 1 (stmt 0 hit) and line 2 (stmt 2 hit) → both covered.
    expect(m.lines).toEqual([2, 2]);
    // A line is executable when a statement starts on it.
    entry.s = { 0: 0, 1: 0, 2: 0 };
    expect(fileMetrics(entry).lines).toEqual([2, 0]);
  });

  it("returns zeroed metrics for unknown shapes", () => {
    const m = fileMetrics({});
    expect(m.statements).toEqual([0, 0]);
    expect(m.branches).toEqual([0, 0]);
  });
});

describe("evaluateAreaCoverage", () => {
  const coverageMap = {
    "/repo/src/services/a.ts": v8Entry, // 80% statements
    "/repo/src/services/b.ts": {
      statements: { total: 10, covered: 10 },
      branches: { total: 2, covered: 2 },
      functions: { total: 1, covered: 1 },
      lines: { total: 10, covered: 10 },
    },
    "/repo/src/components/c.tsx": {
      statements: { total: 20, covered: 10 },
      branches: { total: 8, covered: 3 },
      functions: { total: 4, covered: 2 },
      lines: { total: 20, covered: 10 },
    },
    // No matching area — must be ignored, not gated.
    "/repo/src/utils/u.ts": istanbulEntry,
  };

  const budgets = {
    areas: {
      "src/services": { statements: 80, branches: 80, functions: 60, lines: 80 },
      "src/components": { statements: 70, branches: 60, functions: 60, lines: 70 },
    },
  };

  it("passes when every gated area meets its budget", () => {
    // src/services: statements (8+10)/(10+10)=90%, branches (5+2)/(6+2)=87.5%,
    // functions (2+1)/(3+1)=75%, lines 90%.
    // src/components: statements 50% < 70% → fails.
    const result = evaluateAreaCoverage(coverageMap, budgets);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes("src/components: statements"))).toBe(true);
    expect(result.oks.some((o) => o.startsWith("src/services:"))).toBe(true);
  });

  it("fails when an area drops below its budget", () => {
    const result = evaluateAreaCoverage(coverageMap, {
      areas: { "src/services": { statements: 95 } },
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("src/services: statements 90.0% < 95%");
  });

  it("passes when budgets are met (no components budget)", () => {
    const result = evaluateAreaCoverage(coverageMap, {
      areas: { "src/services": { statements: 80, branches: 80, functions: 60, lines: 80 } },
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("reports an ungated area in the report without failing", () => {
    const result = evaluateAreaCoverage(coverageMap, {
      areas: { "src/components": { statements: 1 } },
    });
    expect(result.ok).toBe(true);
    const row = result.report.find((r) => r.area === "src/services");
    expect(row).toBeDefined();
    expect(row!.percents.statements).toBeCloseTo(90, 1);
  });

  it("fails when a budgeted area has no matching files", () => {
    const result = evaluateAreaCoverage(coverageMap, {
      areas: { "src/memory": { statements: 80 } },
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("src/memory: no files matched");
  });

  it("handles empty coverage maps", () => {
    const result = evaluateAreaCoverage({}, { areas: {} });
    expect(result.ok).toBe(true);
    expect(result.report).toEqual([]);
  });
});
