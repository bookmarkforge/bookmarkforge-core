/**
 * scripts/__tests__/nightly-consistency.test.mjs
 *
 * Unit tests for the nightly alert-vs-trend consistency report
 * (scripts/nightly-consistency.mjs): alert-log parsing, the classification of
 * each suite+week (consistent / missed-alert / phantom-alert), and the main
 * end-to-end path that writes the CSV + JSON artifacts.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildConsistencyReport, buildConsistencySvg, buildMarkdownSummary, collectAlertEntries, findSustainedPhantom, main, parseAlertLog, reconcileDeltas } from "../nightly-consistency.mjs";

const summaryRow = (suite, year, week, degradedWoW, medianMinutes = 12) => ({
  suite,
  week,
  year,
  medianMinutes,
  samples: 1,
  minMinutes: medianMinutes,
  maxMinutes: medianMinutes,
  deltaPctWoW: degradedWoW ? 30 : 10,
  degradedWoW,
});

const alert = (suite, shard, year, week, degraded, status = "failure", extra = {}) => ({
  suite,
  shard,
  week,
  year,
  status,
  degraded,
  deltaPctWoW: degraded ? 30 : null,
  event: `nightly_${suite.replace(/-/g, "_")}_alert`,
  ...extra,
});

describe("parseAlertLog", () => {
  it("parses structured entries and skips corrupted lines", () => {
    const entries = parseAlertLog(
      '{"event":"nightly_human_like_alert","suite":"human-like","shard":"1","week":36,"year":2026,"status":"failure","degraded":true,"deltaPctWoW":30}\n' +
        "not json\n" +
        '{"event":"nightly_multiuser_alert","suite":"multiuser","shard":"2","week":36,"year":2026,"status":"success","degraded":false}\n',
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ suite: "human-like", shard: "1", week: 36, year: 2026, degraded: true, deltaPctWoW: 30 });
    expect(entries[1]).toMatchObject({ suite: "multiuser", shard: "2", degraded: false, deltaPctWoW: null });
  });

  it("parses the delivery outcome and minutes/recordedAt", () => {
    const entries = parseAlertLog(
      '{"event":"e","suite":"human-like","shard":"1","week":36,"year":2026,"degraded":true,"delivered":false,"minutes":50,"recordedAt":"2026-09-01T02:00:00.000Z"}\n' +
        '{"event":"e","suite":"multiuser","shard":"2","week":36,"year":2026,"degraded":false,"delivered":true}\n' +
        '{"event":"e","suite":"perf-scale","shard":"s","week":36,"year":2026,"degraded":false,"delivered":null}\n',
    );
    expect(entries[0]).toMatchObject({ delivered: false, minutes: 50, recordedAt: "2026-09-01T02:00:00.000Z" });
    expect(entries[1].delivered).toBe(true);
    expect(entries[2].delivered).toBeNull();
  });

  it("returns empty for empty or invalid input", () => {
    expect(parseAlertLog("")).toEqual([]);
    expect(parseAlertLog(undefined)).toEqual([]);
    expect(parseAlertLog("{\"no\":\"week\"}")).toEqual([]);
  });
});

describe("buildConsistencyReport", () => {
  it("marks suite DEGRADED without any shard WoW alert as missed-alert", () => {
    const report = buildConsistencyReport(
      [summaryRow("human-like", 2026, 36, true)],
      [alert("human-like", "1", 2026, 36, false, "failure")], // non-WoW alert only
    );
    expect(report.summary.missedAlert).toBe(1);
    expect(report.summary.consistent).toBe(0);
    const line = report.csv.trim().split("\n")[1];
    expect(line).toContain("human-like,36,2026,DEGRADED,1,0,0,missed-alert,");
  });

  it("marks WoW alerts without suite-level DEGRADED as phantom-alert", () => {
    const report = buildConsistencyReport(
      [summaryRow("multiuser", 2026, 36, false)],
      [alert("multiuser", "1", 2026, 36, true), alert("multiuser", "2", 2026, 36, true)],
      [
        { suite: "multiuser", shard: "1", week: 36, year: 2026, minutes: 30 },
        { suite: "multiuser", shard: "2", week: 36, year: 2026, minutes: 28 },
      ],
    );
    expect(report.summary.phantomAlert).toBe(1);
    const line = report.csv.trim().split("\n")[1];
    expect(line).toContain("multiuser,36,2026,,2,2,0,phantom-alert,");
    expect(line).toContain("shard WoW alerts without suite-level DEGRADED: 1,2");
    // 2 shards + differing deltas → aggregation granularity, not a mismatch
    expect(line).toContain("granularity");
  });

  it("marks corroborated degradation as consistent with a matched delta", () => {
    const report = buildConsistencyReport(
      [summaryRow("human-like", 2026, 36, true)],
      [alert("human-like", "2", 2026, 36, true)],
      [{ suite: "human-like", shard: "2", week: 36, year: 2026, minutes: 26 }],
    );
    expect(report.summary.consistent).toBe(1);
    const line = report.csv.trim().split("\n")[1];
    expect(line).toContain("human-like,36,2026,DEGRADED,1,1,0,consistent,");
    // single shard, alert delta 30 == csv delta 30 → match
    expect(line).toContain("30,match");
  });

  it("marks the quiet case as consistent and unions both inputs", () => {
    const report = buildConsistencyReport(
      [summaryRow("human-like", 2026, 36, false)],
      [alert("multiuser", "1", 2026, 35, false, "success")],
    );
    expect(report.summary.consistent).toBe(2);
    const lines = report.csv.trim().split("\n").slice(1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("human-like,36,2026");
    expect(lines[1]).toContain("multiuser,35,2026");
  });

  it("handles empty inputs with a header-only CSV", () => {
    const report = buildConsistencyReport([], []);
    expect(report.summary.consistent).toBe(0);
    expect(report.summary.missedAlert).toBe(0);
    expect(report.summary.phantomAlert).toBe(0);
    expect(report.summary.deltaMismatch).toBe(0);
    expect(report.summary.undeliveredAlerts).toBe(0);
    expect(report.csv).toBe("suite,week,year,summaryDegraded,alertsTotal,woWAlerts,undeliveredAlerts,kind,severity,detail,csvDeltaPctWoW,deltaMatch\n");
  });

  it("reports a deltaMismatch for a single-shard suite whose alert disagrees with the CSV", () => {
    const report = buildConsistencyReport(
      [summaryRow("perf-scale", 2026, 36, false, 12)], // csv delta 10, not degraded
      [alert("perf-scale", "single", 2026, 36, true)], // alert delta 30
      [{ suite: "perf-scale", shard: "single", week: 36, year: 2026, minutes: 50 }],
    );
    expect(report.summary.deltaMismatch).toBe(1);
    expect(report.summary.deltaDetails[0]).toContain("perf-scale 2026-W36: alert payload deltaPctWoW differs from CSV row");
    expect(report.csv.trim().split("\n")[1]).toContain("10,mismatch");
  });

  it("counts undelivered alerts per row and lists them as a separate CSV block", () => {
    const report = buildConsistencyReport(
      [summaryRow("human-like", 2026, 36, true)],
      [
        alert("human-like", "1", 2026, 36, true, "failure", { delivered: true }),
        alert("human-like", "2", 2026, 36, true, "failure", { delivered: false, minutes: 50, recordedAt: "2026-09-01T02:00:00.000Z" }),
      ],
    );
    expect(report.summary.undeliveredAlerts).toBe(1);
    const line = report.csv.trim().split("\n")[1];
    expect(line).toContain("human-like,36,2026,DEGRADED,2,2,1,"); // undeliveredAlerts=1
    const lines = report.csv.split("\n");
    expect(lines).toContain("# undelivered alerts (delivered=false — webhook down)");
    expect(lines).toContain("suite,week,year,shard,status,minutes,deltaPctWoW,recordedAt");
    expect(lines.some((l) => l.startsWith("human-like,36,2026,2,failure,50,30,2026-09-01T02:00:00.000Z"))).toBe(true);
    expect(report.summary.undeliveredDetails[0]).toContain("human-like 2026-W36 shard 2 (failure, 50 min");
  });

  it("weights severity by streak: missed-alert on streak >= 2 is high", () => {
    const report = buildConsistencyReport(
      [
        { ...summaryRow("human-like", 2026, 36, true), streak: 1 }, // streak 1 → medium
        { ...summaryRow("multiuser", 2026, 37, true), streak: 2 }, // streak 2 → high
      ],
      [],
    );
    const humanLike = report.rows.find((r) => r.suite === "human-like");
    const multiuser = report.rows.find((r) => r.suite === "multiuser");
    expect(humanLike.severity).toBe("medium");
    expect(multiuser.severity).toBe("high");
    expect(humanLike.detail).not.toContain("streak");
    expect(multiuser.detail).toContain("streak 2");
    expect(report.summary.highSeverity).toBe(1);
    expect(report.summary.details.some((d) => d.includes("multiuser 2026-W37: [high]"))).toBe(true);
    expect(report.summary.details.some((d) => d.includes("human-like 2026-W36: [medium]"))).toBe(true);
    const csv = report.csv.trim().split("\n").slice(1);
    expect(csv.some((l) => l.includes("multiuser,37,2026,DEGRADED,0,0,0,missed-alert,high,"))).toBe(true);
  });

  it("phantom-alerts are medium and consistent rows are low", () => {
    const report = buildConsistencyReport(
      [summaryRow("human-like", 2026, 36, false), summaryRow("multiuser", 2026, 36, false)],
      [alert("human-like", "1", 2026, 36, true)],
      [{ suite: "human-like", shard: "1", week: 36, year: 2026, minutes: 30 }],
    );
    // human-like: WoW alert without suite-level DEGRADED → phantom (medium)
    // multiuser: quiet both sides → consistent (low)
    expect(report.rows.find((r) => r.suite === "human-like").severity).toBe("medium");
    expect(report.rows.find((r) => r.suite === "human-like").kind).toBe("phantom-alert");
    expect(report.rows.find((r) => r.suite === "multiuser").severity).toBe("low");
    expect(report.rows.find((r) => r.suite === "multiuser").kind).toBe("consistent");
  });

  it("sorts findings high-severity first in the markdown table", () => {
    const report = buildConsistencyReport(
      [
        { ...summaryRow("human-like", 2026, 36, true), streak: 1 },
        { ...summaryRow("multiuser", 2026, 37, true), streak: 3 },
      ],
      [],
    );
    const md = buildMarkdownSummary(report.rows);
    const table = md.split("### Alert-vs-trend findings")[1].split("###")[0];
    const highIdx = table.indexOf("| multiuser | 37 | 2026 | missed-alert | high |");
    const mediumIdx = table.indexOf("| human-like | 36 | 2026 | missed-alert | medium |");
    expect(highIdx).toBeGreaterThan(-1);
    expect(mediumIdx).toBeGreaterThan(-1);
    expect(highIdx).toBeLessThan(mediumIdx);
  });

  it("treats delivered:null (dry-run) and delivered:true as delivered — no undelivered block", () => {
    const report = buildConsistencyReport(
      [],
      [
        alert("human-like", "1", 2026, 36, true, "failure", { delivered: true }),
        alert("human-like", "2", 2026, 36, true, "failure", { delivered: null }),
      ],
    );
    expect(report.summary.undeliveredAlerts).toBe(0);
    expect(report.csv).not.toContain("undelivered alerts");
  });
});

describe("findSustainedPhantom", () => {
  const row = (suite, year, week, kind) => ({ suite, year, week, kind });

  it("reports a run of consecutive phantom-alert weeks in the same suite", () => {
    const runs = findSustainedPhantom(
      [
        row("multiuser", 2026, 35, "phantom-alert"),
        row("multiuser", 2026, 36, "phantom-alert"),
        row("multiuser", 2026, 37, "phantom-alert"),
      ],
      2,
    );
    expect(runs).toEqual([
      { suite: "multiuser", weeks: [{ week: 35, year: 2026 }, { week: 36, year: 2026 }, { week: 37, year: 2026 }], count: 3 },
    ]);
  });

  it("does not report below the minimum and breaks on a non-phantom week", () => {
    expect(
      findSustainedPhantom([row("multiuser", 2026, 35, "phantom-alert"), row("multiuser", 2026, 36, "phantom-alert")], 3),
    ).toEqual([]);
    const runs = findSustainedPhantom(
      [
        row("multiuser", 2026, 35, "phantom-alert"),
        row("multiuser", 2026, 36, "phantom-alert"),
        row("multiuser", 2026, 37, "consistent"),
        row("multiuser", 2026, 38, "phantom-alert"),
      ],
      2,
    );
    expect(runs).toEqual([{ suite: "multiuser", weeks: [{ week: 35, year: 2026 }, { week: 36, year: 2026 }], count: 2 }]);
  });

  it("keeps suites independent and resets on gaps and is disabled by 0", () => {
    const runs = findSustainedPhantom(
      [
        row("multiuser", 2026, 35, "phantom-alert"),
        row("multiuser", 2026, 36, "phantom-alert"),
        row("human-like", 2026, 35, "phantom-alert"),
        row("human-like", 2026, 36, "phantom-alert"),
        row("human-like", 2026, 39, "phantom-alert"),
      ],
      2,
    );
    expect(runs).toEqual([
      { suite: "multiuser", weeks: [{ week: 35, year: 2026 }, { week: 36, year: 2026 }], count: 2 },
      { suite: "human-like", weeks: [{ week: 35, year: 2026 }, { week: 36, year: 2026 }], count: 2 },
    ]);
    expect(findSustainedPhantom([row("multiuser", 2026, 35, "phantom-alert")], 0)).toEqual([]);
  });
});

describe("reconcileDeltas", () => {
  const summary = (suite, week, delta) => summaryRow(suite, 2026, week, delta >= 25, delta);
  const history = (suite, shard, week, minutes) => ({ suite, shard, week, year: 2026, minutes });

  it("matches when the single-shard alert delta equals the CSV row", () => {
    const results = reconcileDeltas(
      [summary("perf-scale", 36, 30)],
      [alert("perf-scale", "single", 2026, 36, true)],
      [history("perf-scale", "single", 36, 50)],
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ suite: "perf-scale", week: 36, csvDeltaPctWoW: 30, alertDeltas: [30], status: "match" });
  });

  it("flags a mismatch when the single-shard alert delta disagrees with the CSV row", () => {
    const results = reconcileDeltas(
      [summary("perf-scale", 36, 10)], // csv delta 10
      [alert("perf-scale", "single", 2026, 36, true)], // alert delta 30
      [history("perf-scale", "single", 36, 50)],
    );
    expect(results[0].status).toBe("mismatch");
  });

  it("treats differing deltas in a multi-shard suite as granularity, not drift", () => {
    const results = reconcileDeltas(
      [summary("human-like", 36, 10)], // suite median delta 10
      [alert("human-like", "1", 2026, 36, true)], // shard delta 30
      [history("human-like", "1", 36, 30), history("human-like", "2", 36, 12)],
    );
    expect(results[0].status).toBe("granularity");
  });

  it("ignores alert entries without a delta (no previous-week baseline)", () => {
    const results = reconcileDeltas([summary("multiuser", 36, 10)], [alert("multiuser", "1", 2026, 36, false)], []);
    expect(results).toEqual([]);
  });
});

describe("buildMarkdownSummary", () => {
  it("renders the findings table for missed and phantom alerts", () => {
    const report = buildConsistencyReport(
      [summaryRow("human-like", 2026, 36, true), summaryRow("multiuser", 2026, 36, false)],
      [alert("multiuser", "1", 2026, 36, true)],
      [{ suite: "multiuser", shard: "1", week: 36, year: 2026, minutes: 30 }],
    );
    const md = buildMarkdownSummary(report.rows);
    expect(md).toContain("## Nightly alert-vs-trend consistency");
    expect(md).toContain("| suite | week | year | kind | severity | detail |");
    expect(md).toContain("| human-like | 36 | 2026 | missed-alert | medium |");
    expect(md).toContain("| multiuser | 36 | 2026 | phantom-alert | medium |");
  });

  it("says so when everything is consistent and no deltas mismatch", () => {
    const report = buildConsistencyReport([], []);
    const md = buildMarkdownSummary(report.rows);
    expect(md).toContain("_No missed-alert or phantom-alert findings");
    expect(md).toContain("_No delta mismatches");
  });

  it("renders the delta reconciliation table for mismatches", () => {
    const report = buildConsistencyReport(
      [summaryRow("perf-scale", 2026, 36, false, 12)],
      [alert("perf-scale", "single", 2026, 36, true)],
      [{ suite: "perf-scale", shard: "single", week: 36, year: 2026, minutes: 50 }],
    );
    const md = buildMarkdownSummary(report.rows);
    expect(md).toContain("| perf-scale | 36 | 2026 | 10 | mismatch |");
  });

  it("lists undelivered alerts in the delivery-failures section", () => {
    const report = buildConsistencyReport(
      [summaryRow("human-like", 2026, 36, true)],
      [alert("human-like", "1", 2026, 36, true, "failure", { delivered: false, minutes: 50, deltaPctWoW: 30 })],
    );
    // empty fallback — no undelivered passed
    expect(buildMarkdownSummary(report.rows)).toContain("_No alerts failed to reach the webhook._");
    const mdWith = buildMarkdownSummary(report.rows, [
      { suite: "human-like", week: 36, year: 2026, shard: "1", status: "failure", minutes: 50, deltaPctWoW: 30 },
    ]);
    expect(mdWith).toContain("### Delivery failures (webhook down)");
    expect(mdWith).toContain("| human-like | 36 | 2026 | 1 | failure | 50 | 30 |");
  });

  it("embeds the SVG as a markdown image when a public URL is provided (opt-in)", () => {
    const md = buildMarkdownSummary([], [], "https://artifacts.acme.dev/nightly/consistency.svg");
    expect(md).toContain("### Consistency chart");
    expect(md).toContain("![Nightly alert-vs-trend consistency chart](https://artifacts.acme.dev/nightly/consistency.svg)");
  });

  it("keeps the summary private (no chart section) without a public URL", () => {
    const md = buildMarkdownSummary([], []);
    expect(md).not.toContain("### Consistency chart");
    expect(md).not.toContain("![Nightly alert-vs-trend");
  });
});

describe("buildConsistencySvg", () => {
  const row = (suite, week, kind, alertsTotal = 1, degraded = "") => ({
    suite,
    week,
    year: 2026,
    alertsTotal,
    kind,
    summaryDegraded: degraded,
  });

  it("renders one bar per suite+week colored by severity", () => {
    const svg = buildConsistencySvg([
      { ...row("human-like", 35, "consistent"), severity: "low" },
      { ...row("human-like", 36, "missed-alert"), severity: "high" },
      { ...row("multiuser", 35, "phantom-alert"), severity: "medium" },
    ]);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#10b981"'); // low (consistent) bar
    expect(svg).toContain('fill="#b91c1c"'); // high (missed streak >= 2) bar
    expect(svg).toContain('fill="#f59e0b"'); // medium (phantom / streak-1 miss) bar
    // legend labels
    expect(svg).toContain("high severity");
    expect(svg).toContain("medium severity");
    expect(svg).toContain("low severity");
  });

  it("draws a thin stub for zero-alert weeks and NO-ROW bars in gray", () => {
    const svg = buildConsistencySvg([row("human-like", 35, "consistent", 0), row("human-like", 36, "consistent", 1, "NO-ROW")]);
    expect(svg).toContain('opacity="0.35"'); // stub for zero-alert week
    expect(svg).toContain('fill="#d1d5db"'); // gray NO-ROW bar + legend
  });

  it("renders an explicit empty state and escapes suite names", () => {
    expect(buildConsistencySvg([])).toContain("No consistency data yet");
    const svg = buildConsistencySvg([row("a&b<suite>", 35, "phantom-alert")]);
    expect(svg).not.toContain("a&b<suite>");
    expect(svg).toContain("a&amp;b&lt;suite&gt;");
  });

  it("explains the four bar markers in a legend below the x-axis", () => {
    const svg = buildConsistencySvg([{ ...row("human-like", 36, "consistent", 1), severity: "low" }]);
    // the four marker labels
    expect(svg).toContain("high (missed-alert, streak ≥ 2)");
    expect(svg).toContain("medium (streak-1 miss / phantom)");
    expect(svg).toContain("low (consistent)");
    expect(svg).toContain("NO-ROW (no suite data)");
    // four swatch bars with the exact severity colors, 205px apart, below the
    // x-axis labels (y=432..448), matching the plot bar opacity
    const swatches = [...svg.matchAll(/<rect x="([\d.]+)" y="432" width="12" height="16" fill="(#[0-9a-f]+)" opacity="0.9"/g)];
    expect(swatches.map((m) => m[2])).toEqual(["#b91c1c", "#f59e0b", "#10b981", "#d1d5db"]);
    const xs = swatches.map((m) => Number(m[1]));
    expect(xs).toEqual([76, 281, 486, 691]);
    // canvas is 480px tall (was 440) to fit the marker row
    expect(svg).toContain('width="860" height="480"');
  });

  it("splits bars into delivered + undelivered (webhook down) segments", () => {
    const svg = buildConsistencySvg([
      { ...row("human-like", 36, "missed-alert", 3, "DEGRADED"), undeliveredAlerts: 2, severity: "high" },
    ]);
    // delivered segment in the severity color (3 - 2 = 1)
    expect(svg).toContain('fill="#b91c1c"');
    // undelivered segment stacked on top, hatched via the pattern
    expect(svg).toContain('fill="url(#undelivered-hatch)"');
    expect(svg).toContain('<pattern id="undelivered-hatch"');
    // title mentions the undelivered count
    expect(svg).toContain("3 alerts, 2 undelivered");
    // two stacked rects at the same x, different y
    const rectYs = [...svg.matchAll(/<rect x="426" y="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(rectYs.length).toBe(2);
    expect(rectYs[0]).toBeGreaterThan(rectYs[1]); // delivered sits below undelivered
  });

  it("draws a single bar (no hatch) when all alerts were delivered", () => {
    const svg = buildConsistencySvg([{ ...row("multiuser", 35, "consistent", 2) }]);
    // no bar rect (width=48) uses the hatch — the legend swatch always shows it
    const barRects = [...svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="48"/g)];
    expect(barRects.length).toBe(1);
    expect(svg).not.toContain("2 undelivered");
  });

  it("adds accessible <title> with suite/week/kind/severity/alerts/median/delta/streak to every bar", () => {
    const svg = buildConsistencySvg([
      { ...row("human-like", 36, "missed-alert", 0, "DEGRADED"), medianMinutes: 17, deltaPctWoW: 30.8, streak: 2, severity: "high" },
      { ...row("multiuser", 35, "consistent", 3), medianMinutes: 40, deltaPctWoW: "", streak: 0, severity: "low" },
    ]);
    expect(svg).toContain("<title>human-like 2026-W36 — missed-alert (severity high, 0 alerts, median 17 min, +30.8% vs prev. week, streak 2)</title>");
    // no baseline -> explicit label; pluralized alerts
    expect(svg).toContain("<title>multiuser 2026-W35 — consistent (severity low, 3 alerts, median 40 min, no adjacent baseline, streak 0)</title>");
    // no median when n/a; singular alerts label
    const one = buildConsistencySvg([{ ...row("single", 35, "phantom-alert", 1), severity: "medium" }]);
    expect(one).toContain("1 alert");
    expect(one).not.toContain("median");
    // title is inside the rect (accessible tree association), not a sibling
    expect(svg).toMatch(/<rect[^>]*><title>/);
  });
});

describe("collectAlertEntries", () => {
  it("reads every alert log in the alerts dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-consistency-alerts-"));
    writeFileSync(join(dir, "human-like.jsonl"), '{"event":"e","suite":"human-like","shard":"1","week":36,"year":2026,"degraded":true}\n');
    writeFileSync(join(dir, "multiuser.jsonl"), '{"event":"e","suite":"multiuser","shard":"2","week":36,"year":2026,"degraded":false}\n');
    writeFileSync(join(dir, "readme.txt"), "ignore me");
    try {
      const entries = await collectAlertEntries(dir);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.suite).sort()).toEqual(["human-like", "multiuser"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty for a missing alerts dir", async () => {
    expect(await collectAlertEntries(join(tmpdir(), "does-not-exist-alerts"))).toEqual([]);
  });
});

describe("main", () => {
  it("writes the CSV and JSON artifacts and exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-consistency-main-"));
    const alertsDir = join(dir, "alerts");
    mkdirSync(alertsDir, { recursive: true });
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), '{"week":35,"year":2026,"minutes":10}\n{"week":36,"year":2026,"minutes":13}\n');
    writeFileSync(
      join(alertsDir, "human-like-shard-1.jsonl"),
      '{"event":"nightly_human_like_alert","suite":"human-like","shard":"1","week":36,"year":2026,"status":"success","degraded":true,"deltaPctWoW":30}\n',
    );
    try {
      const code = await main({
        env: {
          CONSISTENCY_HISTORY_DIR: dir,
          CONSISTENCY_CSV: join(dir, "report.csv"),
          CONSISTENCY_JSON: join(dir, "report.json"),
          CONSISTENCY_SVG: join(dir, "report.svg"),
        },
      });
      expect(code).toBe(0);
      const csv = readFileSync(join(dir, "report.csv"), "utf8");
      expect(csv).toContain("suite,week,year,summaryDegraded,alertsTotal,woWAlerts,undeliveredAlerts,kind,severity,detail,csvDeltaPctWoW,deltaMatch");
      // week 35: no alerts; week 36: suite DEGRADED (13 >= 10*1.25) + 1 WoW alert → consistent
      expect(csv).toContain("human-like,36,2026,DEGRADED,1,1,0,consistent,");
      // single shard, alert delta 30 == csv delta 30 → match
      expect(csv).toContain("30,match");
      const svg = readFileSync(join(dir, "report.svg"), "utf8");
      expect(svg).toContain("Alert-vs-trend consistency per suite+week");
      expect(svg).toContain("<svg xmlns=\"http://www.w3.org/2000/svg\"");
      const json = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
      expect(json.event).toBe("nightly_consistency_report");
      expect(json.consistent).toBeGreaterThan(0);
      expect(json.deltaMismatch).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 on consecutive phantom-alert weeks in the same suite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-consistency-phantom-"));
    const alertsDir = join(dir, "alerts");
    mkdirSync(alertsDir, { recursive: true });
    // history has NO rows for weeks 35-36 → suite NO-ROW → both alerts are phantom
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), '{"week":30,"year":2026,"minutes":10}\n');
    writeFileSync(
      join(alertsDir, "human-like-shard-1.jsonl"),
      '{"event":"nightly_human_like_alert","suite":"human-like","shard":"1","week":35,"year":2026,"status":"success","degraded":true,"deltaPctWoW":30}\n' +
        '{"event":"nightly_human_like_alert","suite":"human-like","shard":"1","week":36,"year":2026,"status":"success","degraded":true,"deltaPctWoW":30}\n',
    );
    try {
      const code = await main({
        env: {
          CONSISTENCY_HISTORY_DIR: dir,
          CONSISTENCY_CSV: join(dir, "report.csv"),
          CONSISTENCY_JSON: join(dir, "report.json"),
          CONSISTENCY_MIN_CONSECUTIVE_PHANTOM: "2",
        },
      });
      expect(code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 0 when the phantom streak is below the threshold or the gate is disabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-consistency-phantom-ok-"));
    const alertsDir = join(dir, "alerts");
    mkdirSync(alertsDir, { recursive: true });
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), '{"week":30,"year":2026,"minutes":10}\n');
    const log = '{"event":"nightly_human_like_alert","suite":"human-like","shard":"1","week":35,"year":2026,"status":"success","degraded":true,"deltaPctWoW":30}\n';
    writeFileSync(join(alertsDir, "human-like-shard-1.jsonl"), log);
    try {
      const below = await main({
        env: {
          CONSISTENCY_HISTORY_DIR: dir,
          CONSISTENCY_CSV: join(dir, "report.csv"),
          CONSISTENCY_JSON: join(dir, "report.json"),
          CONSISTENCY_MIN_CONSECUTIVE_PHANTOM: "2",
        },
      });
      expect(below).toBe(0); // single phantom week < 2
      const disabled = await main({
        env: {
          CONSISTENCY_HISTORY_DIR: dir,
          CONSISTENCY_CSV: join(dir, "report.csv"),
          CONSISTENCY_JSON: join(dir, "report.json"),
          CONSISTENCY_MIN_CONSECUTIVE_PHANTOM: "0",
        },
      });
      expect(disabled).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the GitHub job summary markdown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-consistency-md-"));
    const alertsDir = join(dir, "alerts");
    mkdirSync(alertsDir, { recursive: true });
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), '{"week":35,"year":2026,"minutes":10}\n');
    writeFileSync(
      join(alertsDir, "human-like-shard-1.jsonl"),
      '{"event":"nightly_human_like_alert","suite":"human-like","shard":"1","week":36,"year":2026,"status":"success","degraded":true,"deltaPctWoW":30}\n',
    );
    const mdPath = join(dir, "step-summary.md");
    try {
      const code = await main({
        env: {
          CONSISTENCY_HISTORY_DIR: dir,
          CONSISTENCY_CSV: join(dir, "report.csv"),
          CONSISTENCY_JSON: join(dir, "report.json"),
          CONSISTENCY_SUMMARY_MD: mdPath,
        },
      });
      expect(code).toBe(0);
      const md = readFileSync(mdPath, "utf8");
      expect(md).toContain("## Nightly alert-vs-trend consistency");
      expect(md).toContain("Alert-vs-trend findings");
      expect(md).toContain("deltaPctWoW reconciliation");
      // no public URL -> no chart section, summary stays private
      expect(md).not.toContain("### Consistency chart");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("embeds the consistency SVG in the summary when CONSISTENCY_SVG_PUBLIC_URL is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-consistency-svgurl-"));
    const alertsDir = join(dir, "alerts");
    mkdirSync(alertsDir, { recursive: true });
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), '{"week":35,"year":2026,"minutes":10}\n');
    const mdPath = join(dir, "step-summary.md");
    try {
      const code = await main({
        env: {
          CONSISTENCY_HISTORY_DIR: dir,
          CONSISTENCY_CSV: join(dir, "report.csv"),
          CONSISTENCY_JSON: join(dir, "report.json"),
          CONSISTENCY_SUMMARY_MD: mdPath,
          CONSISTENCY_SVG_PUBLIC_URL: "https://artifacts.acme.dev/nightly/consistency.svg",
        },
      });
      expect(code).toBe(0);
      const md = readFileSync(mdPath, "utf8");
      expect(md).toContain("### Consistency chart");
      expect(md).toContain("![Nightly alert-vs-trend consistency chart](https://artifacts.acme.dev/nightly/consistency.svg)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("two-phase flow: phase 1 (defer) writes CSV/JSON/SVG but skips the summary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-consistency-phase1-"));
    const alertsDir = join(dir, "alerts");
    mkdirSync(alertsDir, { recursive: true });
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), '{"week":35,"year":2026,"minutes":10}\n');
    const mdPath = join(dir, "step-summary.md");
    const csvPath = join(dir, "report.csv");
    const svgPath = join(dir, "report.svg");
    try {
      const code = await main({
        env: {
          CONSISTENCY_HISTORY_DIR: dir,
          CONSISTENCY_CSV: csvPath,
          CONSISTENCY_JSON: join(dir, "report.json"),
          CONSISTENCY_SVG: svgPath,
          CONSISTENCY_SUMMARY_MD: mdPath,
          CONSISTENCY_DEFER_SUMMARY: "1",
        },
      });
      expect(code).toBe(0);
      expect(existsSync(csvPath)).toBe(true);
      expect(existsSync(svgPath)).toBe(true);
      // summary deferred: the step summary does not exist
      expect(existsSync(mdPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("two-phase flow: phase 2 (summary-only) rewrites the summary with the URL and skips the gate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-consistency-phase2-"));
    const alertsDir = join(dir, "alerts");
    mkdirSync(alertsDir, { recursive: true });
    writeFileSync(join(dir, "human-like-shard-1.jsonl"), '{"week":35,"year":2026,"minutes":10}\n');
    const mdPath = join(dir, "step-summary.md");
    try {
      const code = await main({
        env: {
          CONSISTENCY_HISTORY_DIR: dir,
          CONSISTENCY_CSV: join(dir, "report.csv"),
          CONSISTENCY_JSON: join(dir, "report.json"),
          CONSISTENCY_SUMMARY_MD: mdPath,
          CONSISTENCY_SUMMARY_ONLY: "1",
          CONSISTENCY_SVG_PUBLIC_URL: "https://s3.acme.dev/presigned-consistency.svg?X-Amz-Signature=deadbeef",
        },
      });
      expect(code).toBe(0);
      const md = readFileSync(mdPath, "utf8");
      expect(md).toContain("### Consistency chart");
      expect(md).toContain("![Nightly alert-vs-trend consistency chart](https://s3.acme.dev/presigned-consistency.svg?X-Amz-Signature=deadbeef)");
      // phase 2 must NOT write the CSV or the SVG (phase 1 owns them)
      expect(existsSync(join(dir, "report.csv"))).toBe(false);
      expect(existsSync(join(dir, "report.svg"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
