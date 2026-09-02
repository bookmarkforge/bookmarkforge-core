/**
 * scripts/__tests__/nightly-alert.test.mjs
 *
 * Unit tests for the nightly human-like alert gate (scripts/nightly-alert.mjs):
 * duration parsing, alert evaluation, HTTPS-only webhook resolution, Slack
 * payload shaping and the payload builder. The CLI guard keeps importing the
 * module side-effect free.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  baselineMinutes,
  buildAlertPayload,
  buildSlackPayload,
  envPrefixFor,
  evaluateAlert,
  evaluateDegradation,
  isSlackWebhook,
  isoWeek,
  median,
  parseHistory,
  parseMinutes,
  parseRatio,
  prevWeekMedian,
  resolveWebhook,
  runNightlyAlert,
  testWebhook,
} from "../nightly-alert.mjs";

describe("parseMinutes", () => {
  it("treats unset and empty values as undefined", () => {
    expect(parseMinutes(undefined)).toBeUndefined();
    expect(parseMinutes(null)).toBeUndefined();
    expect(parseMinutes("")).toBeUndefined();
    expect(parseMinutes("   ")).toBeUndefined();
  });

  it("parses valid non-negative numbers", () => {
    expect(parseMinutes("0")).toBe(0);
    expect(parseMinutes("42")).toBe(42);
    expect(parseMinutes(" 7.5 ")).toBe(7.5);
  });

  it("rejects negative and non-numeric values", () => {
    expect(parseMinutes("-1")).toBeUndefined();
    expect(parseMinutes("abc")).toBeUndefined();
    expect(parseMinutes("NaN")).toBeUndefined();
  });
});

describe("envPrefixFor", () => {
  it("derives the NIGHTLY_<LABEL>_ prefix", () => {
    expect(envPrefixFor("human-like")).toBe("NIGHTLY_HUMAN_LIKE");
    expect(envPrefixFor("multiuser")).toBe("NIGHTLY_MULTIUSER");
    expect(envPrefixFor("perf-scale")).toBe("NIGHTLY_PERF_SCALE");
  });

  it("normalizes case and separators", () => {
    expect(envPrefixFor("  Multi-User ")).toBe("NIGHTLY_MULTI_USER");
  });

  it("falls back to the human-like default when unset or empty", () => {
    expect(envPrefixFor(undefined)).toBe("NIGHTLY_HUMAN_LIKE");
    expect(envPrefixFor("")).toBe("NIGHTLY_HUMAN_LIKE");
    expect(envPrefixFor(" ")).toBe("NIGHTLY_HUMAN_LIKE");
  });
});

describe("evaluateAlert", () => {
  it("alerts on failure regardless of duration", () => {
    const result = evaluateAlert({ status: "failure", minutes: 1, maxMinutes: "60" });
    expect(result.alert).toBe(true);
    expect(result.failed).toBe(true);
    expect(result.overBudget).toBe(false);
  });

  it("alerts on cancelled runs", () => {
    expect(evaluateAlert({ status: "cancelled", minutes: 0 }).alert).toBe(true);
  });

  it("does not alert on a successful in-budget run", () => {
    const result = evaluateAlert({ status: "success", minutes: 30, maxMinutes: "60" });
    expect(result.alert).toBe(false);
    expect(result.failed).toBe(false);
    expect(result.overBudget).toBe(false);
  });

  it("alerts when duration exceeds the budget (slow-run signal)", () => {
    const result = evaluateAlert({ status: "success", minutes: 61, maxMinutes: "60" });
    expect(result.alert).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.overBudget).toBe(true);
  });

  it("does not alert when duration equals the budget exactly", () => {
    expect(evaluateAlert({ status: "success", minutes: 60, maxMinutes: "60" }).overBudget).toBe(false);
  });

  it("disables the slow-run check when the budget is unset or 0", () => {
    expect(evaluateAlert({ status: "success", minutes: 999 }).alert).toBe(false);
    expect(evaluateAlert({ status: "success", minutes: 999, maxMinutes: "" }).alert).toBe(false);
    expect(evaluateAlert({ status: "success", minutes: 999, maxMinutes: "0" }).alert).toBe(false);
  });

  it("skips the budget check when minutes are missing", () => {
    expect(evaluateAlert({ status: "success", maxMinutes: "60" }).alert).toBe(false);
  });
});

describe("resolveWebhook", () => {
  it("accepts https URLs and trims whitespace", () => {
    expect(resolveWebhook("https://hooks.slack.com/services/T/B/x")).toBe(
      "https://hooks.slack.com/services/T/B/x",
    );
  });

  it("returns empty for unset values", () => {
    expect(resolveWebhook(undefined)).toBe("");
    expect(resolveWebhook("")).toBe("");
    expect(resolveWebhook("   ")).toBe("");
  });

  it("rejects http fail-closed", () => {
    expect(resolveWebhook("http://hooks.slack.com/services/T/B/x")).toBe("");
    expect(resolveWebhook("http://example.com/alert")).toBe("");
  });
});

describe("isSlackWebhook", () => {
  it("detects real Slack Incoming Webhook URLs", () => {
    expect(isSlackWebhook("https://hooks.slack.com/services/T000/B000/xxxx")).toBe(true);
    expect(isSlackWebhook(" https://hooks.slack.com/services/T000/B000/xxxx ")).toBe(true);
    expect(isSlackWebhook("https://api.slack.com/hook")).toBe(true);
  });

  it("rejects non-Slack and non-https URLs", () => {
    expect(isSlackWebhook("https://example.com/webhook")).toBe(false);
    expect(isSlackWebhook("http://hooks.slack.com/services/T000/B000/xxxx")).toBe(false);
    expect(isSlackWebhook("")).toBe(false);
    expect(isSlackWebhook(undefined)).toBe(false);
  });
});

describe("buildAlertPayload", () => {
  it("produces the structured event payload without PII", () => {
    const payload = buildAlertPayload({ shard: "core", status: "failure", minutes: 12 });
    expect(payload).toEqual({
      event: "nightly_human_like_alert",
      workflow: "nightly",
      job: "human-like-core",
      status: "failure",
      minutes: 12,
      maxMinutes: null,
      baselineMinutes: null,
      degraded: false,
      deltaPct: null,
      deltaPctWoW: null,
    });
  });

  it("includes the weekly slope when provided", () => {
    const payload = buildAlertPayload({ shard: "2", status: "success", minutes: 26, degraded: true, deltaPct: 30, deltaPctWoW: 30 });
    expect(payload.deltaPctWoW).toBe(30);
    expect(payload.degraded).toBe(true);
  });

  it("includes the budget when configured", () => {
    const payload = buildAlertPayload({ shard: "depth", status: "success", minutes: 61, maxMinutes: 60 });
    expect(payload.maxMinutes).toBe(60);
    expect(payload.job).toBe("human-like-depth");
  });

  it("uses the job label in event and job name", () => {
    const payload = buildAlertPayload({ shard: "2", status: "failure", minutes: 12, jobLabel: "multiuser" });
    expect(payload.event).toBe("nightly_multiuser_alert");
    expect(payload.job).toBe("multiuser-2");
  });

  it("defaults the job label to human-like", () => {
    expect(buildAlertPayload({ shard: "1", status: "success" }).event).toBe("nightly_human_like_alert");
    expect(buildAlertPayload({ shard: "1", status: "success" }).job).toBe("human-like-1");
  });
});

describe("buildSlackPayload", () => {
  it("uses the Incoming Webhook shape (text + blocks)", () => {
    const slack = buildSlackPayload({ shard: "core", status: "failure", minutes: 12, maxMinutes: 60 });
    expect(typeof slack.text).toBe("string");
    expect(Array.isArray(slack.blocks)).toBe(true);
    const blockText = slack.blocks.map((b) => b.text.text).join("\n");
    expect(blockText).toContain("human-like-core");
    expect(blockText).toContain("failure");
    expect(blockText).toContain("12 min");
  });

  it("omits duration lines when minutes are unknown", () => {
    const slack = buildSlackPayload({ shard: "depth", status: "cancelled" });
    const blockText = slack.blocks.map((b) => b.text.text).join("\n");
    expect(blockText).toContain("cancelled");
    expect(blockText).not.toContain("min");
  });

  it("includes the degradation trend line when degraded", () => {
    const slack = buildSlackPayload({
      shard: "core",
      status: "success",
      minutes: 50,
      baseline: 40,
      degraded: true,
      deltaPct: 25,
    });
    const blockText = slack.blocks.map((b) => b.text.text).join("\n");
    expect(blockText).toContain("DEGRADED +25%");
    expect(blockText).toContain("baseline  40 min");
  });

  it("includes the weekly slope line with sign", () => {
    const up = buildSlackPayload({ shard: "core", status: "failure", minutes: 26, deltaPctWoW: 30 });
    expect(up.blocks.map((b) => b.text.text).join("\n")).toContain("slope     +30% vs prev. week");
    const down = buildSlackPayload({ shard: "core", status: "failure", minutes: 10, deltaPctWoW: -50 });
    expect(down.blocks.map((b) => b.text.text).join("\n")).toContain("slope     -50% vs prev. week");
  });

  it("omits the slope line when no previous week exists", () => {
    const slack = buildSlackPayload({ shard: "core", status: "failure", minutes: 12, deltaPctWoW: null });
    const blockText = slack.blocks.map((b) => b.text.text).join("\n");
    expect(blockText).not.toContain("slope");
  });

  it("labels the message with the multiuser suite", () => {
    const slack = buildSlackPayload({ shard: "1", status: "failure", minutes: 12, jobLabel: "multiuser" });
    expect(slack.text).toContain("multiuser");
    const blockText = slack.blocks.map((b) => b.text.text).join("\n");
    expect(blockText).toContain("multiuser-1");
    expect(blockText).toContain("failure");
  });

  it("regression: renders the complete payload with slope and fixed-width mrkdwn", () => {
    const slack = buildSlackPayload({
      shard: "depth",
      status: "success",
      minutes: 50,
      maxMinutes: 60,
      baseline: 40,
      degraded: true,
      deltaPct: 25,
      deltaPctWoW: 30,
      jobLabel: "human-like",
    });
    // Golden: the full payload object, every field populated. Changing any
    // line here is a deliberate product change to the Slack message.
    expect(slack).toEqual({
      text: "⚠️ BookmarkForge nightly — human-like suite alert",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "⚠️ *BookmarkForge nightly — human-like suite alert*" } },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: [
              "```",
              "job       human-like-depth",
              "status    success",
              "duration  50 min",
              "budget    60 min",
              "baseline  40 min (median prev. weeks)",
              "slope     +30% vs prev. week",
              "trend     DEGRADED +25% week-over-week",
              "```",
            ].join("\n"),
          },
        },
      ],
    });
    // Fixed-width label column: every line's label segment is padded to 10
    // characters, so the values align in monospace regardless of label length.
    const codeLines = slack.blocks[1].text.text.replace(/^```\n|\n```$/g, "").split("\n");
    for (const line of codeLines) {
      const match = line.match(/^(\S+\s+)(\S)/);
      expect(match).not.toBeNull();
      expect(match[1].length).toBe(10);
    }
  });

  it("regression: keeps the fixed width for long labels and a negative slope", () => {
    const slack = buildSlackPayload({
      shard: "1",
      status: "cancelled",
      minutes: 10,
      baseline: 20,
      degraded: false,
      deltaPctWoW: -50,
      jobLabel: "multiuser",
    });
    const codeLines = slack.blocks[1].text.text.replace(/^```\n|\n```$/g, "").split("\n");
    expect(codeLines).toEqual([
      "job       multiuser-1",
      "status    cancelled",
      "duration  10 min",
      "baseline  20 min (median prev. weeks)",
      "slope     -50% vs prev. week",
    ]);
    for (const line of codeLines) {
      const match = line.match(/^(\S+\s+)(\S)/);
      expect(match[1].length).toBe(10);
    }
  });
});

describe("isoWeek", () => {
  it("computes ISO week numbers", () => {
    // 2026-01-01 is a Thursday, so it belongs to ISO week 1 of 2026.
    expect(isoWeek(new Date("2026-01-01T12:00:00Z"))).toEqual({ year: 2026, week: 1 });
    // 2025-12-29 is a Monday, the start of ISO week 1 of 2026.
    expect(isoWeek(new Date("2025-12-29T12:00:00Z"))).toEqual({ year: 2026, week: 1 });
    // 2026-09-01 falls in ISO week 36.
    expect(isoWeek(new Date("2026-09-01T12:00:00Z"))).toEqual({ year: 2026, week: 36 });
  });
});

describe("parseHistory", () => {
  it("parses valid JSONL samples and skips bad lines", () => {
    const raw = [
      JSON.stringify({ week: 34, year: 2026, minutes: 40 }),
      "not json",
      JSON.stringify({ week: 35, year: 2026, minutes: 42 }),
      JSON.stringify({ minutes: 99 }), // missing week -> ignored
      JSON.stringify({ week: 36, minutes: -5 }), // negative -> ignored
      "",
    ].join("\n");
    expect(parseHistory(raw)).toEqual([
      { week: 34, year: 2026, minutes: 40, recordedAt: null },
      { week: 35, year: 2026, minutes: 42, recordedAt: null },
    ]);
  });

  it("returns empty for empty input", () => {
    expect(parseHistory("")).toEqual([]);
    expect(parseHistory(undefined)).toEqual([]);
    expect(parseHistory(null)).toEqual([]);
  });
});

describe("median", () => {
  it("returns the middle value for odd counts", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("returns the average of the middle values for even counts", () => {
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("returns undefined for empty input", () => {
    expect(median([])).toBeUndefined();
  });
});

describe("prevWeekMedian", () => {
  it("returns the median of the adjacent previous week's samples", () => {
    const samples = [
      { week: 34, year: 2026, minutes: 10 },
      { week: 35, year: 2026, minutes: 12 },
      { week: 35, year: 2026, minutes: 16 },
      { week: 36, year: 2026, minutes: 99 }, // current week: excluded
    ];
    expect(prevWeekMedian(samples, 36, 2026)).toBe(14); // median of [12, 16]
  });

  it("crosses the ISO year rollover (week 52/53 → week 1)", () => {
    const samples = [
      { week: 52, year: 2026, minutes: 20 },
      { week: 53, year: 2026, minutes: 40 },
    ];
    expect(prevWeekMedian(samples, 1, 2027)).toBe(30);
  });

  it("returns undefined when there is no adjacent previous week", () => {
    expect(prevWeekMedian([{ week: 34, year: 2026, minutes: 10 }], 36, 2026)).toBeUndefined();
    expect(prevWeekMedian([], 36, 2026)).toBeUndefined();
    expect(prevWeekMedian(undefined, 36, 2026)).toBeUndefined();
  });
});

describe("baselineMinutes", () => {
  it("excludes current-week samples from the baseline", () => {
    const samples = [
      { week: 35, year: 2026, minutes: 40 },
      { week: 35, year: 2026, minutes: 44 },
      { week: 36, year: 2026, minutes: 100 },
    ];
    expect(baselineMinutes(samples, 36)).toBe(42);
  });

  it("needs at least two prior samples", () => {
    expect(baselineMinutes([{ week: 35, year: 2026, minutes: 40 }], 36)).toBeUndefined();
    expect(baselineMinutes([], 36)).toBeUndefined();
  });
});

describe("parseRatio", () => {
  it("defaults to 1.25 when unset", () => {
    expect(parseRatio(undefined)).toBe(1.25);
    expect(parseRatio("")).toBe(1.25);
  });

  it("parses valid positive ratios", () => {
    expect(parseRatio("1.5")).toBe(1.5);
  });

  it("falls back to the default for invalid ratios", () => {
    expect(parseRatio("0")).toBe(1.25);
    expect(parseRatio("-2")).toBe(1.25);
    expect(parseRatio("abc")).toBe(1.25);
  });
});

describe("runNightlyAlert with job label", () => {
  it("reads the NIGHTLY_MULTIUSER_* family for the multiuser label", async () => {
    const result = await runNightlyAlert({
      dryRun: true,
      env: {
        NIGHTLY_ALERT_JOB_LABEL: "multiuser",
        NIGHTLY_MULTIUSER_STATUS: "failure",
        NIGHTLY_MULTIUSER_SHARD: "2",
        NIGHTLY_MULTIUSER_MINUTES: "25",
        NIGHTLY_MULTIUSER_MAX_MINUTES: "30",
      },
    });
    expect(result.code).toBe(0);
    expect(result.alert).toBe(true);
    expect(result.failed).toBe(true);
  });

  it("keeps reading the NIGHTLY_HUMAN_LIKE_* family by default", async () => {
    const result = await runNightlyAlert({
      dryRun: true,
      env: {
        NIGHTLY_HUMAN_LIKE_STATUS: "failure",
        NIGHTLY_HUMAN_LIKE_SHARD: "1",
        NIGHTLY_HUMAN_LIKE_MINUTES: "12",
      },
    });
    expect(result.code).toBe(0);
    expect(result.alert).toBe(true);
  });

  it("computes deltaPctWoW from the previous week's median", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-alert-slope-"));
    const historyFile = join(dir, "human-like-shard-1.jsonl");
    // Week-agnostic: derive the adjacent previous week from the real clock so
    // the test passes in any calendar week (incl. the ISO year rollover).
    const { week: currentWeek, year } = isoWeek();
    const prevWeek = currentWeek === 1 ? 52 : currentWeek - 1;
    const prevYear = currentWeek === 1 ? year - 1 : year;
    writeFileSync(
      historyFile,
      `{"week":${prevWeek},"year":${prevYear},"minutes":20}\n{"week":${prevWeek},"year":${prevYear},"minutes":24}\n`,
    );
    try {
      const result = await runNightlyAlert({
        dryRun: true,
        env: {
          NIGHTLY_HUMAN_LIKE_STATUS: "failure",
          NIGHTLY_HUMAN_LIKE_SHARD: "1",
          NIGHTLY_HUMAN_LIKE_MINUTES: "33",
          NIGHTLY_HUMAN_LIKE_HISTORY_FILE: historyFile,
        },
      });
      // previous week median = 22 → slope (33-22)/22 = +50%
      expect(result.deltaPctWoW).toBe(50);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves deltaPctWoW null when there is no previous week", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-alert-no-slope-"));
    const historyFile = join(dir, "human-like-shard-1.jsonl");
    // A week far in the past is never adjacent to the current week.
    writeFileSync(historyFile, '{"week":3,"year":2020,"minutes":20}\n');
    try {
      const result = await runNightlyAlert({
        dryRun: true,
        env: {
          NIGHTLY_HUMAN_LIKE_STATUS: "failure",
          NIGHTLY_HUMAN_LIKE_SHARD: "1",
          NIGHTLY_HUMAN_LIKE_MINUTES: "33",
          NIGHTLY_HUMAN_LIKE_HISTORY_FILE: historyFile,
        },
      });
      expect(result.deltaPctWoW).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends the fired alert to the alert log for the consistency report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-alert-log-"));
    const logFile = join(dir, "alerts", "human-like-shard-1.jsonl");
    try {
      const result = await runNightlyAlert({
        dryRun: false,
        env: {
          NIGHTLY_HUMAN_LIKE_STATUS: "failure",
          NIGHTLY_HUMAN_LIKE_SHARD: "1",
          NIGHTLY_HUMAN_LIKE_MINUTES: "33",
          NIGHTLY_HUMAN_LIKE_ALERT_LOG_FILE: logFile,
        },
      });
      expect(result.alert).toBe(true);
      const line = readFileSync(logFile, "utf8").trim().split("\n");
      expect(line).toHaveLength(1);
      const entry = JSON.parse(line[0]);
      expect(entry.event).toBe("nightly_human_like_alert");
      expect(entry.suite).toBe("human-like");
      expect(entry.shard).toBe("1");
      expect(entry.degraded).toBe(false);
      expect(entry.status).toBe("failure");
      expect(entry.delivered).toBeNull(); // no webhook configured
      expect(Number.isFinite(entry.week)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not write an alert log without ALERT_LOG_FILE", async () => {
    const result = await runNightlyAlert({
      dryRun: false,
      env: {
        NIGHTLY_HUMAN_LIKE_STATUS: "failure",
        NIGHTLY_HUMAN_LIKE_SHARD: "1",
        NIGHTLY_HUMAN_LIKE_MINUTES: "33",
      },
    });
    expect(result.alert).toBe(true);
    expect(result.code).toBe(0);
  });
});

describe("testWebhook", () => {
  it("fails fast when no webhook is configured", async () => {
    const result = await testWebhook({ env: {} });
    expect(result.code).toBe(1);
  });

  it("rejects non-https webhooks fail-closed", async () => {
    const result = await testWebhook({ env: { NIGHTLY_ALERT_WEBHOOK_URL: "http://example.com/hook" } });
    expect(result.code).toBe(1);
  });

  it("posts a synthetic payload and reports delivery", async () => {
    let posted = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      posted = { url, body: JSON.parse(init.body) };
      return { ok: true };
    };
    try {
      const result = await testWebhook({ env: { NIGHTLY_ALERT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/x" } });
      expect(result.code).toBe(0);
      // Slack Incoming Webhooks get the {text, blocks} shape — no event field.
      expect(posted.body.text).toContain("webhook test");
      expect(Array.isArray(posted.body.blocks)).toBe(true);
      const blockText = posted.body.blocks.map((b) => b.text.text).join("\n");
      expect(blockText).toContain("human-like-smoke");
      // the smoke alert includes the synthetic slope line
      expect(blockText).toContain("slope     +30% vs prev. week (synthetic)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("posts the structured payload for non-Slack https webhooks", async () => {
    let posted = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      posted = { url, body: JSON.parse(init.body) };
      return { ok: true };
    };
    try {
      const result = await testWebhook({ env: { NIGHTLY_ALERT_WEBHOOK_URL: "https://example.com/hook" } });
      expect(result.code).toBe(0);
      expect(posted.body.event).toBe("nightly_webhook_test");
      expect(posted.body.job).toBe("human-like-smoke");
      // the structured smoke payload carries the synthetic slope markers
      expect(posted.body.degraded).toBe(true);
      expect(posted.body.deltaPctWoW).toBe(30);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("labels the synthetic alert with the chosen suite", async () => {
    let posted = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      posted = { url, body: JSON.parse(init.body) };
      return { ok: true };
    };
    try {
      const result = await testWebhook({
        env: {
          NIGHTLY_ALERT_WEBHOOK_URL: "https://example.com/hook",
          NIGHTLY_ALERT_JOB_LABEL: "multiuser",
        },
      });
      expect(result.code).toBe(0);
      expect(posted.body.job).toBe("multiuser-smoke");
      expect(posted.body.text).toContain("multiuser");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses multiuser in the Slack shape when selected", async () => {
    let posted = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      posted = { url, body: JSON.parse(init.body) };
      return { ok: true };
    };
    try {
      const result = await testWebhook({
        env: {
          NIGHTLY_ALERT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/x",
          NIGHTLY_ALERT_JOB_LABEL: "multiuser",
        },
      });
      expect(result.code).toBe(0);
      const blockText = posted.body.blocks.map((b) => b.text.text).join("\n");
      expect(blockText).toContain("multiuser-smoke");
      expect(blockText).toContain("slope     +30% vs prev. week (synthetic)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("shows the slope in the dry-run log line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightly-alert-dryrun-slope-"));
    const historyFile = join(dir, "human-like-shard-1.jsonl");
    const { week: currentWeek, year } = isoWeek();
    const prevWeek = currentWeek === 1 ? 52 : currentWeek - 1;
    const prevYear = currentWeek === 1 ? year - 1 : year;
    writeFileSync(historyFile, `{"week":${prevWeek},"year":${prevYear},"minutes":20}\n{"week":${prevWeek},"year":${prevYear},"minutes":24}\n`);
    const logs = [];
    const originalError = console.error;
    console.error = (m) => logs.push(m);
    try {
      await runNightlyAlert({
        dryRun: true,
        env: {
          NIGHTLY_HUMAN_LIKE_STATUS: "failure",
          NIGHTLY_HUMAN_LIKE_SHARD: "1",
          NIGHTLY_HUMAN_LIKE_MINUTES: "33",
          NIGHTLY_HUMAN_LIKE_HISTORY_FILE: historyFile,
        },
      });
    } finally {
      console.error = originalError;
    }
    const dryRunLine = logs.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).find((l) => l.includes("nightly_alert_dry_run"));
    expect(dryRunLine).toBeDefined();
    const parsed = JSON.parse(dryRunLine);
    expect(parsed.deltaPctWoW).toBe(50); // (33-22)/22 → +50%
    expect(parsed.degraded).toBe(true);
  });

  it("reports a failed delivery as code 1", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    try {
      const result = await testWebhook({ env: { NIGHTLY_ALERT_WEBHOOK_URL: "https://example.com/hook" } });
      expect(result.code).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("evaluateDegradation", () => {
  it("flags degradation when minutes reach the ratio times the baseline", () => {
    const result = evaluateDegradation({ minutes: 50, baseline: 40, ratio: 1.25 });
    expect(result.degraded).toBe(true);
    expect(result.deltaPct).toBe(25);
  });

  it("does not flag degradation within the ratio", () => {
    expect(evaluateDegradation({ minutes: 49, baseline: 40, ratio: 1.25 }).degraded).toBe(false);
  });

  it("does not flag when there is no usable baseline", () => {
    expect(evaluateDegradation({ minutes: 50, baseline: undefined, ratio: 1.25 }).degraded).toBe(false);
    expect(evaluateDegradation({ minutes: 50, baseline: 0, ratio: 1.25 }).degraded).toBe(false);
    expect(evaluateDegradation({ minutes: undefined, baseline: 40, ratio: 1.25 }).degraded).toBe(false);
  });
});
