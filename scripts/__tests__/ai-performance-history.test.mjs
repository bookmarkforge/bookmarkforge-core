import { describe, expect, it } from "vitest";
import {
  HISTORY_SCHEMA,
  appendHistoryFile,
  createEntry,
  evaluateMetrics,
  numericMetrics,
  parseHistory,
} from "../ai-performance-history.mjs";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempHistory = () => join(mkdtempSync(join(tmpdir(), "bmf-ai-history-")), "ai.jsonl");

describe("ai-performance-history", () => {
  it("normalizes only supported numeric metrics from nightly output", () => {
    expect(numericMetrics({
      pass1: { coldInitMs: 1200, warmFirstMs: 80, heapDeltaMb: 4 },
      pass2: { warmCacheReinitMs: 900 },
      firstSummaryLatencyMs: 1500,
      device: { userAgent: "must not persist" },
    })).toEqual({
      firstSummaryLatencyMs: 1500,
      coldInitMs: 1200,
      warmFirstMs: 80,
      warmCacheReinitMs: 900,
      heapDeltaMb: 4,
    });
  });

  it("fails hard-budget violations and historical regressions", () => {
    const result = evaluateMetrics(
      { firstSummaryLatencyMs: 30_001, warmFirstMs: 250 },
      [
        createEntry({ firstSummaryLatencyMs: 1_000, warmFirstMs: 100 }),
        createEntry({ firstSummaryLatencyMs: 1_100, warmFirstMs: 110 }),
      ],
      { ratio: 1.25 },
    );
    expect(result.ok).toBe(false);
    expect(result.checks.firstSummaryLatencyMs.overBudget).toBe(true);
    expect(result.checks.warmFirstMs.regressed).toBe(true);
  });

  it("normalizes the calibration sidecar aggregate", () => {
    expect(numericMetrics({ aggregate: { maxMs: 2_400 } })).toEqual({
      firstSummaryLatencyMs: 2_400,
    });
  });

  it("does not apply a regression baseline until two samples exist", () => {
    const result = evaluateMetrics(
      { firstSummaryLatencyMs: 2_000 },
      [createEntry({ firstSummaryLatencyMs: 500 })],
    );
    expect(result.ok).toBe(true);
    expect(result.checks.firstSummaryLatencyMs.baseline).toBeNull();
  });

  it("parses only the versioned history schema and ignores damaged lines", () => {
    const history = parseHistory([
      JSON.stringify(createEntry({ warmFirstMs: 12 })),
      "not-json",
      JSON.stringify({ schema: "old", metrics: { warmFirstMs: 1 } }),
    ].join("\n"));
    expect(history).toHaveLength(1);
    expect(history[0].schema).toBe(HISTORY_SCHEMA);
  });

  it("appends a sanitized entry and returns its gate result", () => {
    const historyFile = tempHistory();
    const result = appendHistoryFile({
      historyFile,
      metrics: { firstSummaryLatencyMs: 900, prompt: "secret prompt" },
      source: "test",
      commit: "abc123",
      measuredAt: "2026-09-21T00:00:00.000Z",
    });
    const line = JSON.parse(readFileSync(historyFile, "utf8"));
    expect(result.evaluation.ok).toBe(true);
    expect(line.metrics).toEqual({ firstSummaryLatencyMs: 900 });
    expect(line.source).toBe("test");
    expect(line.commit).toBe("abc123");
    expect(line.prompt).toBeUndefined();
  });
});
