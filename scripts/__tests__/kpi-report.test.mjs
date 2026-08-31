/**
 * scripts/__tests__/kpi-report.test.mjs
 *
 * Unit tests for the business KPI gate (scripts/kpi-report.mjs): threshold
 * parsing, DAU/WAU/MAU + retention evaluation, latest-cohort selection and
 * the alert payload. The CLI guard keeps importing the module side-effect
 * free.
 */
import { describe, expect, it } from "vitest";
import {
  buildAlertPayload,
  buildSlackPayload,
  evaluateKpis,
  isoToEpochDay,
  isSlackWebhook,
  latestCohortRetention,
  parseNonNegativeInt,
  parsePct,
  parseThresholds,
} from "../kpi-report.mjs";

const TODAY_ISO = "2026-08-31T12:00:00.000Z";
const TODAY_DAY = isoToEpochDay(TODAY_ISO);

const baseKpis = {
  generatedAt: TODAY_ISO,
  activeInstalls: 100,
  dau: 50,
  wau: 200,
  mau: 400,
  cohorts: {
    [String(TODAY_DAY - 30)]: { cohortSize: 100, d1: 60, d7: 40, d30: 15 },
    [String(TODAY_DAY - 7)]: { cohortSize: 80, d1: 55, d7: 30, d30: 0 },
    [String(TODAY_DAY - 2)]: { cohortSize: 50, d1: 40, d7: 0, d30: 0 },
  },
  funnel: { vault_created: 100, first_capture: 40 },
  counters: { accepted: 10, rejected: 0, rateLimited: 0, installsTracked: 100, persisted: true },
  serverInstanceId: "test",
};

describe("parseThresholds", () => {
  it("treats unset and empty values as disabled", () => {
    expect(parseThresholds({})).toEqual({
      minDau: undefined,
      minWau: undefined,
      minMau: undefined,
      minD7Pct: undefined,
      minD30Pct: undefined,
    });
    expect(parseThresholds({ KPI_MIN_DAU: "", KPI_MIN_D7_PCT: "" })).toEqual({
      minDau: undefined,
      minWau: undefined,
      minMau: undefined,
      minD7Pct: undefined,
      minD30Pct: undefined,
    });
  });

  it("parses valid integers and percentages", () => {
    const thresholds = parseThresholds({
      KPI_MIN_DAU: "10",
      KPI_MIN_WAU: "40",
      KPI_MIN_MAU: "100",
      KPI_MIN_D7_PCT: "0.15",
      KPI_MIN_D30_PCT: "0.05",
    });
    expect(thresholds).toEqual({ minDau: 10, minWau: 40, minMau: 100, minD7Pct: 0.15, minD30Pct: 0.05 });
  });

  it("rejects malformed values (negative, NaN, out-of-range pct)", () => {
    expect(parseNonNegativeInt("-1")).toBeUndefined();
    expect(parseNonNegativeInt("1.5")).toBeUndefined();
    expect(parseNonNegativeInt("abc")).toBeUndefined();
    expect(parsePct("1.5")).toBeUndefined();
    expect(parsePct("-0.1")).toBeUndefined();
    expect(parsePct("nan")).toBeUndefined();
  });
});

describe("evaluateKpis", () => {
  it("passes when no thresholds are configured", () => {
    const result = evaluateKpis(baseKpis, parseThresholds({}));
    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(0);
    expect(result.violations).toHaveLength(0);
  });

  it("flags DAU/WAU/MAU below their thresholds", () => {
    const result = evaluateKpis(baseKpis, {
      minDau: 60, // dau=50 → FAIL
      minWau: 500, // wau=200 → FAIL
      minMau: 10, // mau=400 → OK
      minD7Pct: undefined,
      minD30Pct: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.startsWith("DAU=50"))).toBe(true);
    expect(result.violations.some((v) => v.startsWith("WAU=200"))).toBe(true);
    expect(result.violations.some((v) => v.startsWith("MAU"))).toBe(false);
  });

  it("evaluates retention on the LATEST cohort old enough (not the youngest)", () => {
    // Cohort day-7 has d7/cohortSize = 30/80 = 0.375 → passes 0.2.
    const ok = evaluateKpis(baseKpis, { minD7Pct: 0.2, minD30Pct: undefined });
    expect(ok.ok).toBe(true);
    // Raise the bar above 0.375 → FAIL on the day-7 cohort.
    const fail = evaluateKpis(baseKpis, { minD7Pct: 0.4, minD30Pct: undefined });
    expect(fail.ok).toBe(false);
    expect(fail.violations.some((v) => v.includes("retD7"))).toBe(true);
  });

  it("ignores cohorts younger than the retention window", () => {
    // Only the day-2 cohort has d7 > 0, but it is too young → no cohort found.
    const kpis = {
      ...baseKpis,
      cohorts: { [String(TODAY_DAY - 2)]: { cohortSize: 50, d1: 40, d7: 10, d30: 0 } },
    };
    const result = evaluateKpis(kpis, { minD7Pct: 0.05, minD30Pct: undefined });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("retD7"))).toBe(true);
  });

  it("evaluates D30 retention against a cohort at least 30 days old", () => {
    const result = evaluateKpis(baseKpis, { minD30Pct: 0.2, minD7Pct: undefined });
    // day-30 cohort: d30/cohortSize = 15/100 = 0.15 → FAIL.
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("retD30"))).toBe(true);
  });
});

describe("latestCohortRetention", () => {
  it("returns the latest cohort at or below the cutoff with the right metric", () => {
    const picked = latestCohortRetention(baseKpis.cohorts, TODAY_DAY, 7);
    expect(picked.day).toBe(TODAY_DAY - 7);
    expect(picked.rate).toBeCloseTo(30 / 80, 5);
  });

  it("returns null when no cohort is old enough", () => {
    const picked = latestCohortRetention({ [String(TODAY_DAY - 1)]: { cohortSize: 5, d1: 5, d7: 5, d30: 5 } }, TODAY_DAY, 7);
    expect(picked).toBeNull();
  });
});

describe("buildAlertPayload", () => {
  it("exposes the violations and current KPIs without PII", () => {
    const payload = buildAlertPayload(baseKpis, ["DAU=50 por debajo del umbral 60"]);
    expect(payload.event).toBe("analytics_kpi_below_threshold");
    expect(payload.dau).toBe(50);
    expect(payload.violations).toEqual(["DAU=50 por debajo del umbral 60"]);
    expect(JSON.stringify(payload)).not.toContain("iid");
    expect(JSON.stringify(payload)).not.toContain("counts");
  });
});

describe("isSlackWebhook", () => {
  it("detects real Slack Incoming Webhook URLs (hooks.slack.com)", () => {
    expect(isSlackWebhook("https://hooks.slack.com/services/T000/B000/xxxx")).toBe(true);
    expect(isSlackWebhook(" https://hooks.slack.com/services/T000/B000/xxxx ")).toBe(true);
  });
  it("accepts Slack api endpoints and rejects http / generic https", () => {
    expect(isSlackWebhook("https://api.slack.com/apps")).toBe(true);
    expect(isSlackWebhook("http://hooks.slack.com/services/T000/B000/xxxx")).toBe(false);
    expect(isSlackWebhook("https://example.com/hook")).toBe(false);
    expect(isSlackWebhook("")).toBe(false);
  });
});

describe("buildSlackPayload", () => {
  const payload = buildSlackPayload(baseKpis, ["DAU=50 por debajo del umbral 60"]);
  it("is a Slack-native { text, blocks } payload", () => {
    expect(payload.text).toContain("BookmarkForge");
    expect(payload.blocks).toHaveLength(2);
    expect(payload.blocks[0].type).toBe("section");
    expect(payload.blocks[0].text.type).toBe("mrkdwn");
  });
  it("embeds the violation as mrkdwn and no PII", () => {
    const body = JSON.stringify(payload);
    expect(body).toContain("DAU=50 por debajo del umbral 60");
    expect(body).toContain("DAU/WAU/MAU");
    expect(body).not.toContain("iid");
    expect(body).not.toContain("counts");
    expect(body).not.toContain("serverInstanceId");
  });
});

describe("isoToEpochDay", () => {
  it("matches the server's floor(ts / DAY_MS) math", () => {
    expect(isoToEpochDay("1970-01-01T00:00:00.000Z")).toBe(0);
    expect(isoToEpochDay("1970-01-02T00:00:00.000Z")).toBe(1);
    expect(isoToEpochDay("garbage")).toBeUndefined();
  });
});

describe("parse helpers", () => {
  it("treats zero as a valid threshold", () => {
    expect(parseNonNegativeInt("0")).toBe(0);
    expect(parsePct("0")).toBe(0);
  });
});
