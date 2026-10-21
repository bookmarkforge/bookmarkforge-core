import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendCoverageHistory,
  appendCoverageHistoryFile,
  calculateAreaLineCoverage,
  createOrValidateHistory,
} from "../test-coverage-history.mjs";

const lineEntry = (covered, total = 10) => ({
  statements: { total, covered },
  branches: { total, covered },
  functions: { total, covered },
  lines: { total, covered },
});

const budgets = {
  areas: {
    "src/memory": { lines: 80 },
    "src/telemetry": { lines: 80 },
  },
};

describe("test-coverage-history", () => {
  it("calculates one line-coverage number per configured area", () => {
    expect(
      calculateAreaLineCoverage(
        {
          "/repo/src/memory/MemoryEngine.ts": lineEntry(9),
          "/repo/src/telemetry/errorReporter.ts": lineEntry(8),
        },
        budgets,
      ),
    ).toEqual({ "src/memory": 90, "src/telemetry": 80 });
  });

  it("appends timestamped values without using JSONL", () => {
    const history = createOrValidateHistory(undefined, Object.keys(budgets.areas));
    const next = appendCoverageHistory(
      history,
      { "src/memory": 90, "src/telemetry": 80 },
      "2026-08-15T12:00:00.000Z",
    );

    expect(next.runs).toEqual([
      {
        timestamp: "2026-08-15T12:00:00.000Z",
        values: { "src/memory": 90, "src/telemetry": 80 },
      },
    ]);
    expect(next.runs[0].values).not.toHaveProperty("lines");
  });

  it("requires the production catalog to contain exactly 15 areas", () => {
    const dir = mkdtempSync(join(tmpdir(), "bmf-coverage-history-"));
    const coverageFile = join(dir, "coverage-final.json");
    const budgetsFile = join(dir, "budgets.json");
    const historyFile = join(dir, "coverage-history.json");
    writeFileSync(coverageFile, JSON.stringify({}), "utf8");
    writeFileSync(budgetsFile, JSON.stringify({ areas: { "src/memory": {} } }), "utf8");

    expect(() => appendCoverageHistoryFile({ coverageFile, budgetsFile, historyFile })).toThrow(
      "expected 15 configured areas",
    );
    expect(() => readFileSync(historyFile, "utf8")).toThrow();
  });
});
