/**
 * scripts/__tests__/nightly-alert.test.mjs
 *
 * Unit tests for the nightly human-like alert gate (scripts/nightly-alert.mjs):
 * duration parsing, alert evaluation, HTTPS-only webhook resolution, Slack
 * payload shaping and the payload builder. The CLI guard keeps importing the
 * module side-effect free.
 */
import { describe, expect, it } from "vitest";
import {
  buildAlertPayload,
  buildSlackPayload,
  evaluateAlert,
  isSlackWebhook,
  parseMinutes,
  resolveWebhook,
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
    });
  });

  it("includes the budget when configured", () => {
    const payload = buildAlertPayload({ shard: "depth", status: "success", minutes: 61, maxMinutes: 60 });
    expect(payload.maxMinutes).toBe(60);
    expect(payload.job).toBe("human-like-depth");
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
});
