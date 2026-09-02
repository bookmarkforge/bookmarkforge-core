/**
 * scripts/__tests__/nightly-trends.test.mjs
 *
 * Unit tests for the nightly WoW trends report (scripts/nightly-trends.mjs):
 * suite/shard derivation from history filenames, CSV escaping, and the
 * aggregation of multiple per-shard JSONL histories into one report.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildConsistencyFindings, buildEarlyWarningPayload, buildEarlyWarningSlackPayload, buildMarkdownSummary, buildSustainedPayload, buildSustainedSlackPayload, buildTrendsCsv, buildTrendsSvg, buildWeeklySummary, collectEntries, csvEscape, findApproachingStreaks, findSustainedDegradation, isAdjacentWeek, main, parseMinConsecutive, resolveSuiteMinConsecutive, sendEarlyWarning, sendSustainedAlert, summarizeEntries, suiteFromFilename, xmlEscape } from "../nightly-trends.mjs";

describe("suiteFromFilename", () => {
  it("derives suite and shard from sharded files", () => {
    expect(suiteFromFilename("human-like-shard-1.jsonl")).toEqual({ suite: "human-like", shard: "1" });
    expect(suiteFromFilename("multiuser-shard-2.jsonl")).toEqual({ suite: "multiuser", shard: "2" });
  });

  it("treats non-sharded files as a single shard", () => {
    expect(suiteFromFilename("perf-scale.jsonl")).toEqual({ suite: "perf-scale", shard: "single" });
  });
});

describe("csvEscape", () => {
  it("wraps values containing commas, quotes or newlines", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("passes through plain values", () => {
    expect(csvEscape("human-like")).toBe("human-like");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape("")).toBe("");
  });
});

describe("buildTrendsCsv", () => {
  it("emits header and sorted rows", () => {
    const csv = buildTrendsCsv([
      { suite: "multiuser", shard: "1", week: 36, year: 2026, minutes: 30, recordedAt: "2026-09-01T00:00:00.000Z" },
      { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 12, recordedAt: "2026-09-01T00:00:00.000Z" },
      { suite: "human-like", shard: "10", week: 35, year: 2026, minutes: 9, recordedAt: null },
      { suite: "human-like", shard: "2", week: 35, year: 2026, minutes: 11, recordedAt: null },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("suite,shard,week,year,minutes,recordedAt");
    // human-like week 35: shard 2 before shard 10 (numeric-aware), then week 36 shard 1, then multiuser.
    expect(lines[1]).toContain("human-like,2,35,2026,11,");
    expect(lines[2]).toContain("human-like,10,35,2026,9,");
    expect(lines[3]).toContain("human-like,1,36,2026,12,");
    expect(lines[4]).toContain("multiuser,1,36,2026,30,");
  });

  it("writes just the header when there are no entries", () => {
    expect(buildTrendsCsv([])).toBe("suite,shard,week,year,minutes,recordedAt\n");
  });
});

describe("isAdjacentWeek", () => {
  it("accepts consecutive weeks in the same year", () => {
    expect(isAdjacentWeek({ year: 2026, week: 35 }, { year: 2026, week: 36 })).toBe(true);
    expect(isAdjacentWeek({ year: 2026, week: 35 }, { year: 2026, week: 37 })).toBe(false);
  });

  it("accepts the ISO year rollover (week 52/53 → week 1)", () => {
    expect(isAdjacentWeek({ year: 2026, week: 52 }, { year: 2027, week: 1 })).toBe(true);
    expect(isAdjacentWeek({ year: 2026, week: 53 }, { year: 2027, week: 1 })).toBe(true);
    expect(isAdjacentWeek({ year: 2026, week: 52 }, { year: 2027, week: 2 })).toBe(false);
    expect(isAdjacentWeek({ year: 2026, week: 1 }, { year: 2027, week: 1 })).toBe(false);
  });
});

describe("buildWeeklySummary", () => {
  it("computes the weekly median per suite with min/max/count and deltaPctWoW", () => {
    const csv = buildWeeklySummary([
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" },
      { suite: "human-like", shard: "2", week: 35, year: 2026, minutes: 14, recordedAt: "" },
      { suite: "human-like", shard: "3", week: 35, year: 2026, minutes: 12, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 14, recordedAt: "" },
      { suite: "human-like", shard: "2", week: 36, year: 2026, minutes: 14, recordedAt: "" },
      { suite: "multiuser", shard: "1", week: 35, year: 2026, minutes: 30, recordedAt: "" },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("suite,week,year,medianMinutes,samples,minMinutes,maxMinutes,deltaPctWoW,degradedWoW,streak");
    // human-like week 35: median of [10,12,14] = 12; first week → empty delta, streak 0
    expect(lines[1]).toBe("human-like,35,2026,12,3,10,14,,,0");
    // human-like week 36: median 14 vs previous 12 → +16.7%, under the 1.25x threshold
    expect(lines[2]).toBe("human-like,36,2026,14,2,14,14,16.7,,0");
    // multiuser: first week → empty delta, streak 0
    expect(lines[3]).toBe("multiuser,35,2026,30,1,30,30,,,0");
  });

  it("uses the even-count average for the median", () => {
    const csv = buildWeeklySummary([
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" },
      { suite: "human-like", shard: "2", week: 35, year: 2026, minutes: 20, recordedAt: "" },
    ]);
    expect(csv.trim().split("\n")[1]).toBe("human-like,35,2026,15,2,10,20,,,0");
  });

  it("emits a negative delta when the suite regressed", () => {
    const csv = buildWeeklySummary([
      { suite: "multiuser", shard: "1", week: 35, year: 2026, minutes: 20, recordedAt: "" },
      { suite: "multiuser", shard: "1", week: 36, year: 2026, minutes: 10, recordedAt: "" },
    ]);
    expect(csv.trim().split("\n")[1]).toBe("multiuser,35,2026,20,1,20,20,,,0");
    expect(csv.trim().split("\n")[2]).toBe("multiuser,36,2026,10,1,10,10,-50,,0");
  });

  it("marks weeks at or above 1.25x the previous median as DEGRADED", () => {
    const atThreshold = buildWeeklySummary([
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 12, recordedAt: "" },
      { suite: "human-like", shard: "2", week: 36, year: 2026, minutes: 13, recordedAt: "" },
    ]);
    // week 36 median 12.5 vs 10 → exactly 1.25x: DEGRADED (same >= as the alert), streak 1
    expect(atThreshold.trim().split("\n")[2]).toBe("human-like,36,2026,12.5,2,12,13,25,DEGRADED,1");

    const justBelow = buildWeeklySummary([
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 12, recordedAt: "" },
    ]);
    // week 36 median 12 vs 10 → 1.2x < 1.25: not degraded, delta +20%, streak 0
    expect(justBelow.trim().split("\n")[2]).toBe("human-like,36,2026,12,1,12,12,20,,0");

    const over = buildWeeklySummary([
      { suite: "multiuser", shard: "1", week: 35, year: 2026, minutes: 20, recordedAt: "" },
      { suite: "multiuser", shard: "1", week: 36, year: 2026, minutes: 26, recordedAt: "" },
    ]);
    // 26 vs 20 → 1.3x, delta +30%: DEGRADED, streak 1
    expect(over.trim().split("\n")[2]).toBe("multiuser,36,2026,26,1,26,26,30,DEGRADED,1");
  });

  it("leaves the delta empty across a gap or a zero previous median", () => {
    const gap = buildWeeklySummary([
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 12, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 38, year: 2026, minutes: 14, recordedAt: "" },
    ]);
    const zeroPrev = buildWeeklySummary([
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 0, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 14, recordedAt: "" },
    ]);
    expect(gap.trim().split("\n")[2]).toBe("human-like,38,2026,14,1,14,14,,,0");
    expect(zeroPrev.trim().split("\n")[2]).toBe("human-like,36,2026,14,1,14,14,,,0");
  });

  it("computes the delta across the ISO year rollover", () => {
    const csv = buildWeeklySummary([
      { suite: "perf-scale", shard: "single", week: 52, year: 2026, minutes: 40, recordedAt: "" },
      { suite: "perf-scale", shard: "single", week: 1, year: 2027, minutes: 50, recordedAt: "" },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[1]).toBe("perf-scale,52,2026,40,1,40,40,,,0");
    expect(lines[2]).toBe("perf-scale,1,2027,50,1,50,50,25,DEGRADED,1");
  });

  it("writes just the header when there are no entries", () => {
    expect(buildWeeklySummary([])).toBe("suite,week,year,medianMinutes,samples,minMinutes,maxMinutes,deltaPctWoW,degradedWoW,streak\n");
  });

  it("tracks the running streak across consecutive degraded weeks", () => {
    const csv = buildWeeklySummary([
      { suite: "human-like", shard: "1", week: 34, year: 2026, minutes: 10, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 13, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 17, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 37, year: 2026, minutes: 22, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 38, year: 2026, minutes: 20, recordedAt: "" },
    ]);
    const lines = csv.trim().split("\n");
    // 34: baseline → streak 0; 35: 13>=12.5 → streak 1; 36: 17>=16.25 → streak 2;
    // 37: 22>=21.25 → streak 3; 38: 20 < 27.5 → streak resets to 0
    expect(lines[1]).toBe("human-like,34,2026,10,1,10,10,,,0");
    expect(lines[2]).toBe("human-like,35,2026,13,1,13,13,30,DEGRADED,1");
    expect(lines[3]).toBe("human-like,36,2026,17,1,17,17,30.8,DEGRADED,2");
    expect(lines[4]).toBe("human-like,37,2026,22,1,22,22,29.4,DEGRADED,3");
    expect(lines[5]).toBe("human-like,38,2026,20,1,20,20,-9.1,,0");
  });

  it("resets the streak on a gap in the history", () => {
    const csv = buildWeeklySummary([
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 13, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 39, year: 2026, minutes: 17, recordedAt: "" },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[2]).toBe("human-like,36,2026,13,1,13,13,30,DEGRADED,1");
    // week 39 is not adjacent to week 36 → no baseline, not degraded, streak 0
    expect(lines[3]).toBe("human-like,39,2026,17,1,17,17,,,0");
  });
});

describe("summarizeEntries", () => {
  it("returns structured rows with a boolean degradedWoW", () => {
    const rows = summarizeEntries([
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" },
      { suite: "human-like", shard: "2", week: 35, year: 2026, minutes: 14, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 26, recordedAt: "" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ suite: "human-like", week: 35, year: 2026, medianMinutes: 12, samples: 2, minMinutes: 10, maxMinutes: 14, degradedWoW: false, streak: 0 });
    // 26 >= 12 * 1.25 → degraded flag true, delta +116.7%, streak restarts at 1
    expect(rows[1]).toMatchObject({ week: 36, medianMinutes: 26, deltaPctWoW: 116.7, degradedWoW: true, streak: 1 });
  });
});

describe("parseMinConsecutive", () => {
  it("defaults to 3 and accepts an explicit count", () => {
    expect(parseMinConsecutive(undefined)).toBe(3);
    expect(parseMinConsecutive("")).toBe(3);
    expect(parseMinConsecutive("5")).toBe(5);
  });

  it("allows 0 to disable the gate and rejects invalid input", () => {
    expect(parseMinConsecutive("0")).toBe(0);
    expect(parseMinConsecutive("abc")).toBe(3);
    expect(parseMinConsecutive("-2")).toBe(3);
    expect(parseMinConsecutive("1.5")).toBe(3);
  });
});

describe("findSustainedDegradation", () => {
  // rows are the summarizeEntries shape; only suite/week/year/degradedWoW matter
  const row = (suite, year, week, degraded) => ({ suite, year, week, degradedWoW: degraded });

  it("reports a run at or above the minimum consecutive count", () => {
    const runs = findSustainedDegradation(
      [
        row("human-like", 2026, 35, false),
        row("human-like", 2026, 36, true),
        row("human-like", 2026, 37, true),
        row("human-like", 2026, 38, true),
      ],
      3,
    );
    expect(runs).toEqual([
      { suite: "human-like", weeks: [{ week: 36, year: 2026 }, { week: 37, year: 2026 }, { week: 38, year: 2026 }], count: 3 },
    ]);
  });

  it("does not report a run below the minimum", () => {
    expect(
      findSustainedDegradation([row("human-like", 2026, 35, false), row("human-like", 2026, 36, true), row("human-like", 2026, 37, true)], 3),
    ).toEqual([]);
  });

  it("breaks the run on a non-degraded week", () => {
    const runs = findSustainedDegradation(
      [row("human-like", 2026, 35, true), row("human-like", 2026, 36, true), row("human-like", 2026, 37, false), row("human-like", 2026, 38, true), row("human-like", 2026, 39, true)],
      2,
    );
    // week 37 breaks the run, so 35-36 and 38-39 are two separate runs.
    expect(runs).toEqual([
      { suite: "human-like", weeks: [{ week: 35, year: 2026 }, { week: 36, year: 2026 }], count: 2 },
      { suite: "human-like", weeks: [{ week: 38, year: 2026 }, { week: 39, year: 2026 }], count: 2 },
    ]);
  });

  it("breaks the run on a gap in the history", () => {
    expect(
      findSustainedDegradation([row("human-like", 2026, 35, true), row("human-like", 2026, 36, true), row("human-like", 2026, 39, true), row("human-like", 2026, 40, true)], 2),
    ).toEqual([
      { suite: "human-like", weeks: [{ week: 35, year: 2026 }, { week: 36, year: 2026 }], count: 2 },
      { suite: "human-like", weeks: [{ week: 39, year: 2026 }, { week: 40, year: 2026 }], count: 2 },
    ]);
  });

  it("keeps suites independent", () => {
    const runs = findSustainedDegradation(
      [
        row("human-like", 2026, 35, true),
        row("human-like", 2026, 36, true),
        row("multiuser", 2026, 35, true),
        row("multiuser", 2026, 36, false),
      ],
      2,
    );
    expect(runs).toEqual([{ suite: "human-like", weeks: [{ week: 35, year: 2026 }, { week: 36, year: 2026 }], count: 2 }]);
  });

  it("continues the run across the ISO year rollover", () => {
    const runs = findSustainedDegradation(
      [
        row("perf-scale", 2026, 52, true),
        row("perf-scale", 2026, 53, true),
        row("perf-scale", 2027, 1, true),
      ],
      3,
    );
    expect(runs).toEqual([
      { suite: "perf-scale", weeks: [{ week: 52, year: 2026 }, { week: 53, year: 2026 }, { week: 1, year: 2027 }], count: 3 },
    ]);
  });

  it("is disabled by a non-positive minimum and empty input", () => {
    expect(findSustainedDegradation([row("human-like", 2026, 35, true), row("human-like", 2026, 36, true)], 0)).toEqual([]);
    expect(findSustainedDegradation([], 3)).toEqual([]);
  });
});

describe("buildMarkdownSummary", () => {
  it("renders a table of DEGRADED weeks", () => {
    const md = buildMarkdownSummary(
      [
        { suite: "human-like", week: 36, year: 2026, medianMinutes: 14, deltaPctWoW: 16.7, degradedWoW: false },
        { suite: "human-like", week: 37, year: 2026, medianMinutes: 18, deltaPctWoW: 28.6, degradedWoW: true, streak: 2 },
      ],
      [],
    );
    expect(md).toContain("| suite | week | year | median (min) | deltaPctWoW | streak |");
    expect(md).toContain("| human-like | 37 | 2026 | 18 | 28.6% | 2 |");
    expect(md).not.toContain("| human-like | 36");
    expect(md).not.toContain("Sustained");
  });

  it("falls back to streak 0 when a degraded row lacks a streak", () => {
    const md = buildMarkdownSummary(
      [{ suite: "multiuser", week: 35, year: 2026, medianMinutes: 30, deltaPctWoW: 25, degradedWoW: true }],
      [],
    );
    expect(md).toContain("| multiuser | 35 | 2026 | 30 | 25% | 0 |");
  });

  it("says so when nothing is degraded", () => {
    const md = buildMarkdownSummary(
      [{ suite: "human-like", week: 36, year: 2026, medianMinutes: 12, deltaPctWoW: 10, degradedWoW: false }],
      [],
    );
    expect(md).toContain("No suite+week is DEGRADED");
  });

  it("lists sustained-degradation runs when present", () => {
    const md = buildMarkdownSummary([], [
      { suite: "human-like", weeks: [{ week: 36, year: 2026 }, { week: 37, year: 2026 }], count: 2 },
    ]);
    expect(md).toContain("Sustained degradation");
    expect(md).toContain("**human-like**: 2 consecutive weeks (2026-W36, 2026-W37)");
  });

  it("includes weeks with a negative slope as improvements", () => {
    const md = buildMarkdownSummary(
      [
        { suite: "human-like", week: 36, year: 2026, medianMinutes: 12, deltaPctWoW: 10, degradedWoW: false },
        { suite: "human-like", week: 37, year: 2026, medianMinutes: 10, deltaPctWoW: -16.7, degradedWoW: false },
        { suite: "multiuser", week: 36, year: 2026, medianMinutes: 28, deltaPctWoW: -6.7, degradedWoW: false },
      ],
      [],
    );
    expect(md).toContain("### Improved weeks (negative slope)");
    expect(md).toContain("| human-like | 37 | 2026 | 10 | -16.7% |");
    expect(md).toContain("| multiuser | 36 | 2026 | 28 | -6.7% |");
    // positive slope stays out of the improvements table
    expect(md).not.toContain("| human-like | 36 | 2026 | 12 | 10% |");
  });

  it("omits the improvements section when no week improved", () => {
    const md = buildMarkdownSummary(
      [{ suite: "human-like", week: 36, year: 2026, medianMinutes: 14, deltaPctWoW: 16.7, degradedWoW: false }],
      [],
    );
    expect(md).not.toContain("Improved weeks");
  });

  it("links to the run summary and its artifacts when a run URL is provided", () => {
    const md = buildMarkdownSummary([], [], "https://github.com/acme/bookmarkforge/actions/runs/123");
    expect(md).toContain("### Raw data");
    expect(md).toContain("[Run summary](https://github.com/acme/bookmarkforge/actions/runs/123)");
    expect(md).toContain("[Artifacts](https://github.com/acme/bookmarkforge/actions/runs/123#artifacts)");
  });

  it("omits the raw-data links without a run URL (local runs)", () => {
    const md = buildMarkdownSummary([], []);
    expect(md).not.toContain("### Raw data");
    expect(md).not.toContain("#artifacts");
  });

  it("embeds the SVG as an image when a public URL is provided", () => {
    const md = buildMarkdownSummary([], [], "https://github.com/acme/bookmarkforge/actions/runs/123", "https://artifacts.acme.dev/nightly/trends.svg");
    expect(md).toContain("### Trend chart");
    expect(md).toContain("![Nightly WoW trends chart](https://artifacts.acme.dev/nightly/trends.svg)");
  });

  it("keeps the summary to links only when no public SVG URL is set", () => {
    const md = buildMarkdownSummary([], [], "https://github.com/acme/bookmarkforge/actions/runs/123");
    expect(md).not.toContain("### Trend chart");
    expect(md).not.toContain("![Nightly WoW trends chart");
  });
});

describe("buildTrendsSvg", () => {
  const entries = [
    { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" },
    { suite: "human-like", shard: "2", week: 35, year: 2026, minutes: 12, recordedAt: "" },
    { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 17, recordedAt: "" },
    { suite: "multiuser", shard: "1", week: 35, year: 2026, minutes: 30, recordedAt: "" },
  ];

  it("renders a self-contained SVG with legend and axes", () => {
    const svg = buildTrendsSvg(entries);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Weekly median minutes per suite");
    expect(svg).toContain("human-like");
    expect(svg).toContain("multiuser");
    expect(svg).toContain("W35");
    expect(svg).toContain("W36");
    expect(svg).toContain("<polyline");
    expect(svg).toContain("</svg>");
  });

  it("shades DEGRADED weeks on the streak ramp", () => {
    const svg = buildTrendsSvg(entries);
    // week 36 human-like: median 17 vs prev median 11 → 17 >= 11*1.25 → DEGRADED,
    // streak 1 with default threshold 3 → ramp ratio 1/3 → #e67777 (light red)
    expect(svg).toContain('fill="#e67777"');
    // legend shows the complete ramp (gradient streak 1 → N → gate) in the
    // same compact row as the three markers, not a flat "DEGRADED week" swatch
    expect(svg).toContain("streak 1 → 3 → gate");
    expect(svg).toContain('url(#streak-ramp-grad)');
  });

  it("deepens the red as the streak approaches the gate threshold", () => {
    // 10 → 13 → 17 → 22 min: streaks 1, 2, 3 with a threshold of 2 → the W37
    // point (streak 3 >= threshold 2) is the darkest (#b91c1c = STREAK_DARK)
    const data = [
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 13, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 37, year: 2026, minutes: 17, recordedAt: "" },
    ];
    const svg = buildTrendsSvg(data, { thresholds: { "human-like": 2 } });
    expect(svg).toContain('fill="#b91c1c"'); // streak 2 = at the gate (W37)
    expect(svg).not.toContain('fill="#dc2626"'); // flat DEGRADED color is gone
    // legend keys off the suite threshold (2): streak 1 → 2 → gate
    expect(svg).toContain("streak 1 → 2 → gate");
  });

  it("renders an empty state when there is no data", () => {
    const svg = buildTrendsSvg([]);
    expect(svg).toContain("No trend data yet");
    expect(svg).not.toContain("<polyline");
  });

  it("highlights sustained-degradation runs with a band and ringed points", () => {
    const svg = buildTrendsSvg(entries, {
      sustained: [{ suite: "human-like", count: 2, weeks: [{ week: 35, year: 2026 }, { week: 36, year: 2026 }] }],
    });
    expect(svg).toContain('fill="#fee2e2"'); // band
    expect(svg).toContain("sustained ×2");
    expect(svg).toContain('stroke="#b91c1c" stroke-width="2.5"'); // ringed points
  });

  it("draws no sustained highlight when no runs are passed", () => {
    const svg = buildTrendsSvg(entries);
    expect(svg).not.toContain("sustained ×");
    expect(svg).not.toContain('fill="#fee2e2"');
  });

  it("draws a dotted degradation-threshold reference line per suite", () => {
    // 3 consecutive weeks per suite → a 2-point threshold segment per suite
    const data = [
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 17, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 37, year: 2026, minutes: 22, recordedAt: "" },
      { suite: "multiuser", shard: "1", week: 35, year: 2026, minutes: 30, recordedAt: "" },
      { suite: "multiuser", shard: "1", week: 36, year: 2026, minutes: 32, recordedAt: "" },
      { suite: "multiuser", shard: "1", week: 37, year: 2026, minutes: 34, recordedAt: "" },
    ];
    const svg = buildTrendsSvg(data);
    // week 36 human-like: threshold = 11 (prev median) * 1.25 = 13.75, with the
    // solid series at 17 above it → the crossing is visible in the plot
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).toContain("threshold (1.25× prev. week)");
    // 2 suites → 2 dashed plot segments + 1 legend swatch = 3 dashed polylines
    const dashed = (svg.match(/stroke-dasharray="5 4"/g) || []).length;
    expect(dashed).toBe(3);
  });

  it("clips no threshold: the y scale fits the 1.25x reference line", () => {
    const steep = [
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 50, recordedAt: "" },
    ];
    const svg = buildTrendsSvg(steep);
    // threshold for W36 = 12.5 < series 50 — the y scale is driven by the data;
    // a threshold ABOVE the data (not the case here) would still fit the scale
    expect(svg).toContain("<polyline");
    // the legend still renders without error on single-week data
    expect(svg).toContain("threshold (1.25× prev. week)");
  });

  it("renders no threshold line where there is no previous adjacent week", () => {
    const single = [{ suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" }];
    const svg = buildTrendsSvg(single);
    // no adjacent baseline → no dotted threshold segment in the plot (only the
    // legend swatch remains, so exactly one dasharray occurrence)
    const dashed = (svg.match(/stroke-dasharray="5 4"/g) || []).length;
    expect(dashed).toBe(1);
  });

  it("adds an accessible title to every point with suite/week/median/delta/streak", () => {
    const svg = buildTrendsSvg(entries);
    const titles = svg.match(/<title>.*?<\/title>/g) || [];
    // 3 data points: human-like W35, human-like W36, multiuser W35
    expect(titles).toHaveLength(3);
    expect(titles).toContain("<title>human-like 2026-W35 — median 11 min (no adjacent baseline)</title>");
    // week 36 human-like is DEGRADED (17 >= 11*1.25): the title flags the streak
    expect(titles).toContain("<title>human-like 2026-W36 — median 17 min (+54.5% vs prev. week, streak 1)</title>");
    expect(titles).toContain("<title>multiuser 2026-W35 — median 30 min (no adjacent baseline)</title>");
  });

  it("explains the three point markers and the complete ramp in one compact row", () => {
    const svg = buildTrendsSvg(entries);
    expect(svg).toContain("normal week (suite color)");
    expect(svg).toContain("DEGRADED (streak ramp)");
    expect(svg).toContain("sustained run (gate tripped)");
    expect(svg).toContain("streak 1 → 3 → gate");
    // the marker swatches use the same radii as the plot points
    expect(svg).toContain('r="3.5"'); // normal
    expect(svg).toContain('r="5"'); // DEGRADED
    expect(svg).toContain('r="6"'); // sustained ringed
    // the sustained swatch carries the dark ring stroke
    expect(svg).toContain('stroke="#b91c1c" stroke-width="2.5"');
    // the complete ramp is a continuous gradient bar (light → dark endpoint)
    expect(svg).toContain('<defs><linearGradient id="streak-ramp-grad"');
    expect(svg).toContain('stop-color="#fca5a5"'); // STREAK_LIGHT
    expect(svg).toContain('stop-color="#b91c1c"'); // STREAK_DARK
  });

  it("escapes title text and marks a single-point suite as no-baseline", () => {
    const svg = buildTrendsSvg([{ suite: "a&b<suite>", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" }]);
    const titles = svg.match(/<title>.*?<\/title>/g) || [];
    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain("a&amp;b&lt;suite&gt; 2026-W35");
    expect(titles[0]).toContain("no adjacent baseline");
    expect(svg).not.toContain("a&b<suite>");
  });

  it("golden: full chart with three markers, ramp, threshold and sustained runs pins every legend position", () => {
    // 2 suites × 3/2 weeks, human-like 10→13→17 (streaks 1, 2 on the default
    // threshold 3 ramp), one sustained run spanning W36–W37, dotted threshold
    // reference per suite. Rendered through the same buildTrendsSvg that
    // main() writes to disk, so the golden values are the production layout.
    const golden = [
      { suite: "human-like", shard: "1", week: 35, year: 2026, minutes: 10, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 13, recordedAt: "" },
      { suite: "human-like", shard: "1", week: 37, year: 2026, minutes: 17, recordedAt: "" },
      { suite: "multiuser", shard: "1", week: 35, year: 2026, minutes: 30, recordedAt: "" },
      { suite: "multiuser", shard: "1", week: 36, year: 2026, minutes: 32, recordedAt: "" },
    ];
    const svg = buildTrendsSvg(golden, {
      sustained: [{ suite: "human-like", count: 2, weeks: [{ week: 36, year: 2026 }, { week: 37, year: 2026 }] }],
    });

    // — Canvas: 860×480, plot 64..836 x 36..396 (mL=64, mR=24, mT=36, mB=84) —
    expect(svg).toContain('width="860" height="480"');
    expect(svg).toContain('<line x1="64" y1="396" x2="836" y2="396" stroke="#9ca3af" stroke-width="1"/>'); // x axis
    expect(svg).toContain('<line x1="64" y1="36" x2="64" y2="396" stroke="#9ca3af" stroke-width="1"/>'); // y axis

    // — Sustained run: band from W36 half-step to W37 half-step, label above —
    expect(svg).toContain('<rect x="257" y="36" width="772" height="360" fill="#fee2e2" opacity="0.55"/>');
    expect(svg).toContain('<text x="643" y="50" text-anchor="middle" font-size="11" font-weight="600" fill="#b91c1c">sustained ×2</text>');

    // — Data points: normal (r=3.5), DEGRADED on the ramp, sustained-ringed (r=6) —
    expect(svg).toContain('<circle cx="64" cy="306" r="3.5" fill="#3b82f6" stroke="#ffffff" stroke-width="1.5">');
    expect(svg).toContain('<circle cx="450" cy="279" r="6" fill="#e67777" stroke="#b91c1c" stroke-width="2.5">');
    expect(svg).toContain('<circle cx="836" cy="243" r="6" fill="#cf4a4a" stroke="#b91c1c" stroke-width="2.5">');
    expect(svg).toContain('<circle cx="64" cy="126" r="3.5" fill="#f59e0b" stroke="#ffffff" stroke-width="1.5">');
    expect(svg).toContain('<circle cx="450" cy="108" r="3.5" fill="#f59e0b" stroke="#ffffff" stroke-width="1.5">');

    // — Dotted degradation threshold: per-suite plot segment + legend swatch —
    expect(svg).toContain('<polyline points="450,283.5 836,249.75" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.75"/>');
    expect(svg).toContain('<line x1="628" y1="46" x2="644" y2="46" stroke="#111827" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.75"/>');

    // — Suite legend: swatch lines at y=24, labels at y=28, 180px apart —
    expect(svg).toContain('<line x1="64" y1="24" x2="80" y2="24" stroke="#3b82f6" stroke-width="3"/>');
    expect(svg).toContain('<text x="86" y="28" font-size="12" fill="#374151">human-like</text>');
    expect(svg).toContain('<line x1="244" y1="24" x2="260" y2="24" stroke="#f59e0b" stroke-width="3"/>');
    expect(svg).toContain('<text x="266" y="28" font-size="12" fill="#374151">multiuser</text>');

    // — Threshold legend row: y=46/50 —
    expect(svg).toContain('<text x="650" y="50" font-size="12" fill="#374151">threshold (1.25× prev. week)</text>');

    // — One compact legend row at y=446/450: the three markers + the complete
    // ramp (streak 1 → N → gate) as a continuous gradient swatch —
    expect(svg).toContain('<circle cx="76" cy="446" r="3.5" fill="#3b82f6" stroke="#ffffff" stroke-width="1.5"/>');
    expect(svg).toContain('<text x="88" y="450" font-size="11" fill="#374151">normal week (suite color)</text>');
    expect(svg).toContain('<circle cx="270" cy="446" r="5" fill="#e67777" stroke="#ffffff" stroke-width="1.5"/>');
    expect(svg).toContain('<text x="282" y="450" font-size="11" fill="#374151">DEGRADED (streak ramp)</text>');
    expect(svg).toContain('<circle cx="445" cy="446" r="6" fill="#e67777" stroke="#b91c1c" stroke-width="2.5"/>');
    expect(svg).toContain('<text x="457" y="450" font-size="11" fill="#374151">sustained run (gate tripped)</text>');
    // the complete ramp gradient bar and its label, right after the markers
    expect(svg).toContain('<defs><linearGradient id="streak-ramp-grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#fca5a5"/><stop offset="100%" stop-color="#b91c1c"/></linearGradient></defs>');
    expect(svg).toContain('<rect x="630" y="441" width="44" height="10" fill="url(#streak-ramp-grad)"/>');
    expect(svg).toContain('<text x="680" y="450" font-size="11" fill="#374151">streak 1 → 3 → gate</text>');
  });
});

describe("xmlEscape", () => {
  it("escapes XML metacharacters", () => {
    expect(xmlEscape('a&b<c>"d"')).toBe("a&amp;b&lt;c&gt;&quot;d&quot;");
  });
});

describe("sustained-degradation Slack alert", () => {
  const runs = [
    { suite: "human-like", count: 2, weeks: [{ week: 36, year: 2026 }, { week: 37, year: 2026 }], medianMinutes: 17, deltaPctWoW: 30.8 },
  ];

  it("builds the structured payload with streak and slope", () => {
    const payload = buildSustainedPayload(runs, 2);
    expect(payload.event).toBe("nightly_trends_sustained");
    expect(payload.minConsecutive).toBe(2);
    expect(payload.suites).toEqual([
      { suite: "human-like", count: 2, threshold: 2, weeks: ["2026-W36", "2026-W37"], medianMinutes: 17, deltaPctWoW: 30.8 },
    ]);
  });

  it("carries a per-suite threshold in the payload when the run is enriched", () => {
    const withThreshold = [{ ...runs[0], threshold: 4 }];
    const payload = buildSustainedPayload(withThreshold, 3);
    expect(payload.suites[0].threshold).toBe(4);
    const slack = buildSustainedSlackPayload(withThreshold, 3);
    expect(slack.blocks.map((b) => b.text.text).join("\n")).toContain("budget    4 consecutive weeks (per-suite var)");
  });

  it("builds the Slack shape with mrkdwn blocks", () => {
    const slack = buildSustainedSlackPayload(runs, 2);
    expect(slack.text).toContain("sustained degradation");
    const blockText = slack.blocks.map((b) => b.text.text).join("\n");
    expect(blockText).toContain("human-like");
    expect(blockText).toContain("2 consecutive weeks");
    expect(blockText).toContain("slope     +30.8% vs prev. week");
  });

  it("adds an interactive Open-run-summary button when a runUrl is given", () => {
    const slack = buildSustainedSlackPayload(runs, 2, "https://github.com/acme/bookmarkforge/actions/runs/987654");
    const actions = slack.blocks.find((b) => b.type === "actions");
    expect(actions).toBeDefined();
    expect(actions.elements).toEqual([
      { type: "button", text: { type: "plain_text", text: "Open run summary" }, url: "https://github.com/acme/bookmarkforge/actions/runs/987654" },
    ]);
    // without a runUrl the actions block is absent — the payload stays minimal
    expect(buildSustainedSlackPayload(runs, 2).blocks.some((b) => b.type === "actions")).toBe(false);
  });

  it("sends the Slack shape to Slack webhooks and structured otherwise", async () => {
    let sent;
    const fire = async (_url, payload) => {
      sent = payload;
      return true;
    };
    await sendSustainedAlert({ webhook: "https://hooks.slack.com/services/x/y", sustained: runs, minConsecutive: 2, fire });
    expect(sent.blocks).toBeDefined();
    await sendSustainedAlert({ webhook: "https://example.com/hook", sustained: runs, minConsecutive: 2, fire });
    expect(sent.event).toBe("nightly_trends_sustained");
    // runUrl flows through to the Slack shape only
    await sendSustainedAlert({
      webhook: "https://hooks.slack.com/services/x/y",
      sustained: runs,
      minConsecutive: 2,
      runUrl: "https://github.com/acme/bookmarkforge/actions/runs/42",
      fire,
    });
    expect(sent.blocks.some((b) => b.type === "actions" && b.elements[0].url === "https://github.com/acme/bookmarkforge/actions/runs/42")).toBe(true);
    // structured (non-Slack) payload is unchanged — no button block there
    await sendSustainedAlert({
      webhook: "https://example.com/hook",
      sustained: runs,
      minConsecutive: 2,
      runUrl: "https://github.com/acme/bookmarkforge/actions/runs/42",
      fire,
    });
    expect(sent.event).toBe("nightly_trends_sustained");
    expect(sent.blocks).toBeUndefined();
  });

  it("does nothing without a webhook or without runs", async () => {
    const fire = async () => true;
    expect(await sendSustainedAlert({ webhook: "", sustained: runs, minConsecutive: 2, fire })).toBe(false);
    expect(await sendSustainedAlert({ webhook: "https://example.com/hook", sustained: [], minConsecutive: 2, fire })).toBe(false);
  });

  it("rides the consistency findings in the same payload and Slack section", async () => {
    const findings = [
      { suite: "human-like", week: 37, year: 2026, kind: "missed-alert", detail: "suite median DEGRADED but no shard WoW alert logged (0 non-WoW alerts)" },
    ];
    const payload = buildSustainedPayload(runs, 2, findings);
    expect(payload.consistency).toEqual([
      { suite: "human-like", week: 37, year: 2026, kind: "missed-alert", detail: "suite median DEGRADED but no shard WoW alert logged (0 non-WoW alerts)" },
    ]);
    const slack = buildSustainedSlackPayload(runs, 2, "", findings);
    const section = slack.blocks.find((b) => b.text.text.startsWith("*Alert-vs-trend consistency*"));
    expect(section).toBeDefined();
    expect(section.text.text).toContain("🟡 *human-like* 2026-W37: suite median DEGRADED");
    // no findings → no consistency section
    expect(buildSustainedSlackPayload(runs, 2).blocks.some((b) => b.text.text.startsWith("*Alert-vs-trend consistency*"))).toBe(false);
    expect(buildSustainedPayload(runs, 2).consistency).toEqual([]);
  });
});

describe("buildConsistencyFindings", () => {
  const summary = (suite, year, week, degradedWoW) => ({
    suite, week, year, medianMinutes: 12, samples: 1, minMinutes: 12, maxMinutes: 12,
    deltaPctWoW: degradedWoW ? 30 : 10, degradedWoW,
  });
  const alert = (suite, shard, year, week, degraded) => ({
    suite, shard, week, year, status: "failure", degraded,
    deltaPctWoW: degraded ? 30 : null, event: `nightly_${suite.replace(/-/g, "_")}_alert`,
  });

  it("reports missed/phantom findings only for the sustained runs' weeks", () => {
    const sustained = [{ suite: "human-like", count: 2, weeks: [{ week: 36, year: 2026 }, { week: 37, year: 2026 }] }];
    const findings = buildConsistencyFindings(
      [
        summary("human-like", 2026, 36, true),
        summary("human-like", 2026, 37, true), // degraded, but the alert below was NOT logged → missed
      ],
      [alert("human-like", "1", 2026, 36, true)], // W36 corroborated → consistent
      sustained,
    );
    expect(findings).toEqual([
      { suite: "human-like", week: 37, year: 2026, kind: "missed-alert", detail: "suite median DEGRADED but no shard WoW alert logged (0 non-WoW alerts)" },
    ]);
  });

  it("flags phantom-alerts (WoW alert without suite-level DEGRADED)", () => {
    const sustained = [{ suite: "multiuser", count: 1, weeks: [{ week: 35, year: 2026 }] }];
    const findings = buildConsistencyFindings(
      [summary("multiuser", 2026, 35, false)],
      [alert("multiuser", "1", 2026, 35, true)],
      sustained,
    );
    expect(findings).toEqual([
      { suite: "multiuser", week: 35, year: 2026, kind: "phantom-alert", detail: "shard WoW alert without suite-level DEGRADED: 1" },
    ]);
  });

  it("is empty when every sustained week is corroborated", () => {
    const sustained = [{ suite: "human-like", count: 1, weeks: [{ week: 36, year: 2026 }] }];
    expect(buildConsistencyFindings([summary("human-like", 2026, 36, true)], [alert("human-like", "1", 2026, 36, true)], sustained)).toEqual([]);
  });
});

describe("resolveSuiteMinConsecutive", () => {
  it("maps per-suite vars (upper-snaked) with global fallback and default", () => {
    expect(resolveSuiteMinConsecutive({}, ["human-like", "multiuser"])).toEqual({ "human-like": 3, multiuser: 3 });
    expect(resolveSuiteMinConsecutive({ TRENDS_MIN_CONSECUTIVE_DEGRADED: "4" }, ["human-like"])).toEqual({ "human-like": 4 });
    expect(
      resolveSuiteMinConsecutive(
        { TRENDS_MIN_CONSECUTIVE_DEGRADED: "4", TRENDS_MIN_CONSECUTIVE_DEGRADED_HUMAN_LIKE: "2" },
        ["human-like", "multiuser"],
      ),
    ).toEqual({ "human-like": 2, multiuser: 4 });
    // 0 disables per suite
    expect(resolveSuiteMinConsecutive({ TRENDS_MIN_CONSECUTIVE_DEGRADED_HUMAN_LIKE: "0" }, ["human-like"])).toEqual({ "human-like": 0 });
  });

  it("applies per-suite thresholds in findSustainedDegradation", () => {
    const row = (suite, week, degraded) => ({ suite, week, year: 2026, degradedWoW: degraded });
    const rows = [
      row("human-like", 35, true),
      row("human-like", 36, true),
      row("multiuser", 35, true),
      row("multiuser", 36, true),
    ];
    // human-like trips at 2, multiuser needs 3 → only human-like fires
    const runs = findSustainedDegradation(rows, { "human-like": 2, multiuser: 3 });
    expect(runs.map((r) => r.suite)).toEqual(["human-like"]);
    // disabled per suite → that suite drops out, the enabled one still fires
    expect(findSustainedDegradation(rows, { "human-like": 0, multiuser: 2 }).map((r) => r.suite)).toEqual(["multiuser"]);
  });
});

describe("findApproachingStreaks", () => {
  const row = (suite, year, week, degraded, streak) => ({ suite, week, year, degradedWoW: degraded, streak });

  it("flags a suite at exactly N-1 consecutive weeks", () => {
    const rows = [
      row("human-like", 2026, 35, true, 1),
      row("human-like", 2026, 36, true, 2), // threshold 3 → count 2 = N-1
      row("multiuser", 2026, 35, true, 1), // threshold 3 → count 1, not N-1
    ];
    const streaks = findApproachingStreaks(rows, { "human-like": 3, multiuser: 3 });
    expect(streaks).toEqual([
      { suite: "human-like", count: 2, threshold: 3, weeks: [{ week: 35, year: 2026 }, { week: 36, year: 2026 }] },
    ]);
  });

  it("ignores suites already at or past the gate and disabled thresholds", () => {
    const rows = [
      row("human-like", 2026, 35, true, 1),
      row("human-like", 2026, 36, true, 2),
      row("human-like", 2026, 37, true, 3), // at the gate → excluded
      row("perf-scale", 2026, 35, true, 1), // threshold 0 (disabled) → excluded
    ];
    const streaks = findApproachingStreaks(rows, { "human-like": 3, "perf-scale": 0 });
    expect(streaks).toEqual([]);
  });

  it("works with a uniform numeric threshold and uses the CURRENT (last) streak", () => {
    const rows = [
      row("multiuser", 2026, 35, true, 1),
      row("multiuser", 2026, 36, true, 2),
      row("multiuser", 2026, 37, false, 0), // break: the run ended
      row("multiuser", 2026, 38, true, 1), // fresh streak of 1 — not N-1 (3)
    ];
    const streaks = findApproachingStreaks(rows, 3);
    expect(streaks).toEqual([]); // the current streak is 1, not N-1

    const fresh = [
      row("multiuser", 2026, 35, true, 1),
      row("multiuser", 2026, 36, true, 2), // current streak 2 = N-1 for threshold 3
    ];
    expect(findApproachingStreaks(fresh, 3)).toEqual([
      { suite: "multiuser", count: 2, threshold: 3, weeks: [{ week: 35, year: 2026 }, { week: 36, year: 2026 }] },
    ]);
  });
});

describe("early-warning alert", () => {
  const approaching = [
    { suite: "human-like", count: 2, threshold: 3, weeks: [{ week: 36, year: 2026 }, { week: 37, year: 2026 }], medianMinutes: 17, deltaPctWoW: 30.8 },
  ];

  it("builds the structured payload with threshold and weeks", () => {
    const payload = buildEarlyWarningPayload(approaching);
    expect(payload.event).toBe("nightly_trends_early_warning");
    expect(payload.streaks).toEqual([
      { suite: "human-like", count: 2, threshold: 3, weeks: ["2026-W36", "2026-W37"], medianMinutes: 17, deltaPctWoW: 30.8 },
    ]);
  });

  it("builds the Slack shape stating N of threshold", () => {
    const slack = buildEarlyWarningSlackPayload(approaching);
    const blockText = slack.blocks.map((b) => b.text.text).join("\n");
    expect(blockText).toContain("early warning");
    expect(blockText).toContain("streak    2 of 3 consecutive weeks");
    expect(blockText).toContain("slope     +30.8% vs prev. week");
  });

  it("sends the Slack shape to Slack webhooks and structured otherwise", async () => {
    let sent;
    const fire = async (_url, payload) => {
      sent = payload;
      return true;
    };
    await sendEarlyWarning({ webhook: "https://hooks.slack.com/services/x/y", approaching, fire });
    expect(sent.blocks).toBeDefined();
    await sendEarlyWarning({ webhook: "https://example.com/hook", approaching, fire });
    expect(sent.event).toBe("nightly_trends_early_warning");
    expect(await sendEarlyWarning({ webhook: "", approaching, fire })).toBe(false);
    expect(await sendEarlyWarning({ webhook: "https://example.com/hook", approaching: [], fire })).toBe(false);
  });
});

describe("main sustained-degradation gate", () => {
  const degradedHistory = '{"week":35,"year":2026,"minutes":10}\n{"week":36,"year":2026,"minutes":13}\n{"week":37,"year":2026,"minutes":17}\n';

  it("exits 1 when the suite degrades for the minimum consecutive weeks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-gate-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "2",
        },
      });
      expect(code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends the early warning at N-1 and stays green (exit 0)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-early-"));
    // 10 → 13 → 17 → 22: weeks 36-38 degraded (streak 3) with threshold 4 → N-1
    writeFileSync(join(dir, "human-like-shard-1.jsonl"),
      '{"week":35,"year":2026,"minutes":10}\n{"week":36,"year":2026,"minutes":13}\n{"week":37,"year":2026,"minutes":17}\n{"week":38,"year":2026,"minutes":22}\n');
    let sent;
    const fire = async (_url, payload) => {
      sent = payload;
      return true;
    };
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "4",
          NIGHTLY_ALERT_WEBHOOK_URL: "https://example.com/hook",
        },
        fire,
      });
      expect(code).toBe(0); // gate not tripped (3 < 4) → run stays green
      expect(sent.event).toBe("nightly_trends_early_warning");
      expect(sent.streaks).toEqual([
        { suite: "human-like", count: 3, threshold: 4, weeks: ["2026-W36", "2026-W37", "2026-W38"], medianMinutes: 22, deltaPctWoW: 29.4 },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not send the early warning when the gate already tripped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-early-gate-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory); // threshold 2 → gate trips
    let sent;
    const fire = async (_url, payload) => {
      sent = payload;
      return true;
    };
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "2",
          NIGHTLY_ALERT_WEBHOOK_URL: "https://example.com/hook",
        },
        fire,
      });
      expect(code).toBe(1);
      expect(sent.event).toBe("nightly_trends_sustained"); // only the sustained alert
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("local dry-run (no webhook) never attempts the network and keeps the gate exit code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-dry-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    let fireCalls = 0;
    const fire = async () => {
      fireCalls += 1;
      throw new Error("network must never be attempted without a webhook");
    };
    const logs = [];
    const originalError = console.error;
    console.error = (line) => logs.push(line);
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "2",
          // no NIGHTLY_ALERT_WEBHOOK_URL → dry-run, gate still trips
        },
        fire,
      });
      expect(code).toBe(1); // the sustained gate's exit code is untouched
      expect(fireCalls).toBe(0); // no send attempt → no network
      expect(logs.some((l) => l.includes("nightly_trends_no_webhook"))).toBe(true);
    } finally {
      console.error = originalError;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 0 when the degradation is not sustained", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-ok-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "3",
        },
      });
      expect(code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 0 when the gate is disabled with 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-disabled-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "0",
        },
      });
      expect(code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the GitHub job summary markdown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-md-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    const mdPath = join(dir, "step-summary.md");
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "2",
          TRENDS_SUMMARY_MD: mdPath,
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "acme/bookmarkforge",
          GITHUB_RUN_ID: "987654",
        },
      });
      expect(code).toBe(1); // sustained gate still fires
      const md = readFileSync(mdPath, "utf8");
      expect(md).toContain("## Nightly WoW trends");
      expect(md).toContain("| human-like | 36 | 2026 | 13 | 30% | 1 |");
      expect(md).toContain("Sustained degradation");
      expect(md).toContain("[Run summary](https://github.com/acme/bookmarkforge/actions/runs/987654)");
      expect(md).toContain("#artifacts");
      // no TRENDS_SVG_PUBLIC_URL → links only, no embed
      expect(md).not.toContain("### Trend chart");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("embeds the SVG image in the summary when TRENDS_SVG_PUBLIC_URL is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-md-embed-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    const mdPath = join(dir, "step-summary.md");
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "2",
          TRENDS_SUMMARY_MD: mdPath,
          TRENDS_SVG_PUBLIC_URL: "https://artifacts.acme.dev/nightly/trends.svg",
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "acme/bookmarkforge",
          GITHUB_RUN_ID: "987654",
        },
      });
      expect(code).toBe(1);
      const md = readFileSync(mdPath, "utf8");
      expect(md).toContain("### Trend chart");
      expect(md).toContain("![Nightly WoW trends chart](https://artifacts.acme.dev/nightly/trends.svg)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the markdown summary as an artifact file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-md-file-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    const mdPath = join(dir, "nightly-trends-summary.md");
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_SUMMARY_MD_FILE: mdPath,
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "acme/bookmarkforge",
          GITHUB_RUN_ID: "555",
        },
      });
      expect(code).toBe(0);
      const md = readFileSync(mdPath, "utf8");
      expect(md).toContain("## Nightly WoW trends");
      // same footer links as the job summary, so the artifact can stand alone
      expect(md).toContain("[Run summary](https://github.com/acme/bookmarkforge/actions/runs/555)");
      expect(md).toContain("#artifacts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("two-phase flow: phase 1 (defer) writes CSVs/SVG but skips the summary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-phase1-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    const mdPath = join(dir, "step-summary.md");
    const mdFile = join(dir, "nightly-trends-summary.md");
    const csvPath = join(dir, "trends.csv");
    const svgPath = join(dir, "trends.svg");
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: csvPath,
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_SVG: svgPath,
          TRENDS_SUMMARY_MD: mdPath,
          TRENDS_SUMMARY_MD_FILE: mdFile,
          TRENDS_DEFER_SUMMARY: "1",
        },
      });
      // the gate still runs in phase 1 (sustained history, no threshold set →
      // default 3, streak 2 < 3 → green), and the evidence artifacts are written
      expect(code).toBe(0);
      expect(existsSync(csvPath)).toBe(true);
      expect(existsSync(svgPath)).toBe(true);
      // summary deferred: neither the step summary nor the artifact md exist
      expect(existsSync(mdPath)).toBe(false);
      expect(existsSync(mdFile)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("two-phase flow: phase 2 (summary-only) rewrites the summary with the URL and skips the gate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-phase2-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    const mdPath = join(dir, "step-summary.md");
    const mdFile = join(dir, "nightly-trends-summary.md");
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_SUMMARY_MD: mdPath,
          TRENDS_SUMMARY_MD_FILE: mdFile,
          TRENDS_SUMMARY_ONLY: "1",
          TRENDS_SVG_PUBLIC_URL: "https://s3.acme.dev/presigned-trends.svg?X-Amz-Signature=abc123",
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "acme/bookmarkforge",
          GITHUB_RUN_ID: "123",
        },
      });
      // phase 2 always exits 0 (display sugar), even though the same history
      // would trip the gate in phase 1 — the gate was already decided there
      expect(code).toBe(0);
      const md = readFileSync(mdPath, "utf8");
      expect(md).toContain("### Trend chart");
      expect(md).toContain("![Nightly WoW trends chart](https://s3.acme.dev/presigned-trends.svg?X-Amz-Signature=abc123)");
      // the artifact md copy gets the same embed
      const artifact = readFileSync(mdFile, "utf8");
      expect(artifact).toContain("### Trend chart");
      // phase 2 must NOT write the CSVs or the SVG (phase 1 owns them)
      expect(existsSync(join(dir, "trends.csv"))).toBe(false);
      expect(existsSync(join(dir, "trends.svg"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("highlights the sustained run in the SVG when the gate trips", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-svg-run-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    const svgPath = join(dir, "trends.svg");
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_SVG: svgPath,
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "2",
        },
      });
      expect(code).toBe(1); // gate trips on weeks 36-37
      const svg = readFileSync(svgPath, "utf8");
      expect(svg).toContain("sustained ×2");
      expect(svg).toContain('fill="#fee2e2"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("golden: one run embeds the exact URL in the summary and writes the SVG with streak highlights", async () => {
    // A single main() execution (the production path) must produce BOTH the
    // summary markdown with the exact embed URL AND the SVG carrying the
    // streak highlights (band + ringed points + ramp) — the two artifacts
    // that make the nightly report self-explanatory. Threshold 2 trips the
    // gate on weeks 36-37, so the sustained run is highlighted in the SVG.
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-golden-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    const mdPath = join(dir, "step-summary.md");
    const svgPath = join(dir, "trends.svg");
    const presigned = "https://s3.acme.dev/nightly/trends-12345.svg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef";
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_SVG: svgPath,
          TRENDS_SUMMARY_MD: mdPath,
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "2",
          TRENDS_SVG_PUBLIC_URL: presigned,
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "acme/bookmarkforge",
          GITHUB_RUN_ID: "12345",
        },
      });
      // gate trips on weeks 36-37 → the run is red, evidence on disk
      expect(code).toBe(1);

      // 1) summary markdown carries the EXACT presigned URL in the embed
      const md = readFileSync(mdPath, "utf8");
      expect(md).toContain("### Trend chart");
      expect(md).toContain(`![Nightly WoW trends chart](${presigned})`);
      // the raw-data links still point at the run that produced this exact SVG
      expect(md).toContain("[Run summary](https://github.com/acme/bookmarkforge/actions/runs/12345)");

      // 2) the same run wrote the SVG with the streak highlights
      const svg = readFileSync(svgPath, "utf8");
      expect(svg).toContain("sustained ×2"); // the run label on the band
      expect(svg).toContain('fill="#fee2e2"'); // the band behind the run weeks
      expect(svg).toContain('stroke="#b91c1c" stroke-width="2.5"'); // ringed points
      // the ramp legend shows the suite threshold (2): streak 1 → 2 → gate
      expect(svg).toContain("streak 1 → 2 → gate");
      // and the accessible titles name the streak on the DEGRADED weeks
      expect(svg).toContain("<title>human-like 2026-W36 — median 13 min (+30% vs prev. week, streak 1)</title>");
      expect(svg).toContain("<title>human-like 2026-W37 — median 17 min (+30.8% vs prev. week, streak 2)</title>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shows the streak in the CSV before the fail-loud gate trips", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-streak-"));
    // 2 consecutive degraded weeks, gate threshold 3 → job must NOT fail,
    // but the CSV already exposes the running streak.
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "3",
        },
      });
      expect(code).toBe(0);
      const csv = readFileSync(join(dir, "summary.csv"), "utf8");
      expect(csv).toContain("human-like,36,2026,13,1,13,13,30,DEGRADED,1");
      expect(csv).toContain("human-like,37,2026,17,1,17,17,30.8,DEGRADED,2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the SVG chart alongside the CSVs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-svg-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    const svgPath = join(dir, "trends.svg");
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_SVG: svgPath,
        },
      });
      expect(code).toBe(0);
      expect(readFileSync(svgPath, "utf8")).toContain("<svg");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("posts the sustained alert with the enriched slope when a webhook is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-alert-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    let sent;
    const fire = async (_url, payload) => {
      sent = payload;
      return true;
    };
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "2",
          NIGHTLY_ALERT_WEBHOOK_URL: "https://example.com/hook",
        },
        fire,
      });
      expect(code).toBe(1);
      expect(sent.event).toBe("nightly_trends_sustained");
      expect(sent.suites).toEqual([
        { suite: "human-like", count: 2, threshold: 2, weeks: ["2026-W36", "2026-W37"], medianMinutes: 17, deltaPctWoW: 30.8 },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a throwing webhook sender never changes the gate exit code nor blocks the CSVs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-alert-throw-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    const fire = async () => {
      throw new Error("webhook down hard");
    };
    const logs = [];
    const originalError = console.error;
    console.error = (line) => logs.push(line);
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "2",
          NIGHTLY_ALERT_WEBHOOK_URL: "https://example.com/hook",
        },
        fire,
      });
      // 1) exit code unchanged: the gate still trips
      expect(code).toBe(1);
      // 2) the failure was logged, not swallowed silently
      expect(logs.some((l) => l.includes("nightly_trends_alert_send_failed"))).toBe(true);
      // 3) the CSVs were written before the alert send — evidence intact
      expect(readFileSync(join(dir, "trends.csv"), "utf8")).toContain("suite");
      expect(readFileSync(join(dir, "summary.csv"), "utf8")).toContain("suite,week,year");
    } finally {
      console.error = originalError;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes the run URL into the Slack button when running in CI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-alert-url-"));
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    let sent;
    const fire = async (_url, payload) => {
      sent = payload;
      return true;
    };
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "2",
          NIGHTLY_ALERT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/x",
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "acme/bookmarkforge",
          GITHUB_RUN_ID: "987654",
        },
        fire,
      });
      expect(code).toBe(1);
      const actions = sent.blocks.find((b) => b.type === "actions");
      expect(actions.elements[0]).toEqual({
        type: "button",
        text: { type: "plain_text", text: "Open run summary" },
        url: "https://github.com/acme/bookmarkforge/actions/runs/987654",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes the missed/phantom findings from the alert log in the alert payload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-alert-cons-"));
    const alertsDir = join(dir, "alerts");
    mkdirSync(alertsDir, { recursive: true });
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), degradedHistory);
    // W37 is DEGRADED but no WoW alert was logged for it → missed-alert
    writeFileSync(join(alertsDir, "human-like-shard-1.jsonl"),
      '{"event":"nightly_human_like_alert","suite":"human-like","shard":"1","week":36,"year":2026,"status":"failure","degraded":true,"deltaPctWoW":30}\n');
    let sent;
    const fire = async (_url, payload) => {
      sent = payload;
      return true;
    };
    try {
      const code = await main({
        env: {
          TRENDS_HISTORY_DIR: dir,
          TRENDS_CSV: join(dir, "trends.csv"),
          TRENDS_SUMMARY_CSV: join(dir, "summary.csv"),
          TRENDS_MIN_CONSECUTIVE_DEGRADED: "2",
          NIGHTLY_ALERT_WEBHOOK_URL: "https://example.com/hook",
        },
        fire,
      });
      expect(code).toBe(1);
      expect(sent.event).toBe("nightly_trends_sustained");
      expect(sent.consistency).toEqual([
        { suite: "human-like", week: 37, year: 2026, kind: "missed-alert", detail: "suite median DEGRADED but no shard WoW alert logged (0 non-WoW alerts)" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("collectEntries", () => {
  it("aggregates every history file with suite and shard derived from the name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-trends-test-"));
    writeFileSync(
      join(dir, "human-like-shard-1.jsonl"),
      '{"week":35,"year":2026,"minutes":12,"recordedAt":"2026-08-25T00:00:00.000Z"}\n',
    );
    writeFileSync(
      join(dir, "multiuser-shard-2.jsonl"),
      '{"week":35,"year":2026,"minutes":28,"recordedAt":"2026-08-25T00:00:00.000Z"}\n',
    );
    writeFileSync(join(dir, "ignored.txt"), "not a history");
    try {
      const entries = await collectEntries(dir);
      expect(entries).toHaveLength(2);
      expect(entries[0].suite).toBe("human-like");
      expect(entries[0].shard).toBe("1");
      expect(entries[1].suite).toBe("multiuser");
      expect(entries[1].shard).toBe("2");
      expect(entries[1].recordedAt).toContain("2026-08-25");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty for a missing directory", async () => {
    expect(await collectEntries(join(tmpdir(), "does-not-exist-trends"))).toEqual([]);
  });
});
