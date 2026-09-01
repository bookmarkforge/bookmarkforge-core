#!/usr/bin/env node
/**
 * scripts/nightly-alert.mjs
 *
 * Nightly human-like alert gate. Called from .github/workflows/nightly.yml
 * after the human-like shard jobs finish; it decides whether an alert must
 * fire and delivers it to an optional HTTPS webhook (Slack Incoming Webhook
 * shape supported, same policy as scripts/kpi-report.mjs and
 * scripts/drill-backup-restore.mjs).
 *
 * Two alert triggers:
 *   1. job failure    — the shard finished with a non-zero result
 *   2. slow run       — the shard exceeded NIGHTLY_HUMAN_LIKE_MAX_MINUTES
 *
 * Environment:
 *   NIGHTLY_HUMAN_LIKE_STATUS        "success" | "failure" (from ${{ job.status }})
 *   NIGHTLY_HUMAN_LIKE_MINUTES       wall-clock minutes the job took (numeric)
 *   NIGHTLY_HUMAN_LIKE_SHARD         shard label for the message ("core" / "depth")
 *   NIGHTLY_HUMAN_LIKE_MAX_MINUTES   optional duration budget in minutes;
 *                                    unset or 0 disables the slow-run alert
 *   NIGHTLY_ALERT_WEBHOOK_URL        optional HTTPS webhook (http:// is
 *                                    rejected fail-closed, same policy as
 *                                    DRILL_ALERT_WEBHOOK_URL)
 *
 * Exit codes:
 *   0  no alert needed, or alert delivered/attempted (webhook problems are
 *      logged, never fatal — a dead webhook must not fail the nightly run)
 *   1  malformed gate inputs (bad status or non-numeric minutes)
 *
 * CLI flags:
 *   --dry-run   evaluate and print the decision without posting anything
 */
import { pathToFileURL } from "node:url";

const USER_AGENT = "bookmarkforge-nightly-alert";
const WEBHOOK_TIMEOUT_MS = 5_000;

export const DURATION_BUDGET_MS = 60 * 60 * 1000; // 60 minutes per shard job

export function parseMinutes(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

export function resolveWebhook(raw) {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  if (/^https:\/\//i.test(value)) return value;
  console.error(JSON.stringify({
    event: "nightly_webhook_url_rejected",
    reason: "only https is accepted",
  }));
  return "";
}

export function isSlackWebhook(raw) {
  return /^https:\/\/(hooks\.slack\.com\/services|api\.slack\.com)/i.test(raw?.trim() ?? "");
}

export function evaluateAlert({ status, minutes, maxMinutes }) {
  const failed = status === "failure" || status === "cancelled";
  const budget = parseMinutes(maxMinutes);
  const took = parseMinutes(minutes);
  const overBudget = budget !== undefined && budget > 0 && took !== undefined && took > budget;
  return { alert: failed || overBudget, failed, overBudget, budget, took };
}

export function buildAlertPayload({ shard, status, minutes, maxMinutes }) {
  return {
    event: "nightly_human_like_alert",
    workflow: "nightly",
    job: `human-like-${shard ?? "unknown"}`,
    status,
    minutes: minutes ?? null,
    maxMinutes: maxMinutes ?? null,
  };
}

// Slack Incoming Webhooks only accept the `{ text, blocks }` shape; any other
// HTTPS webhook receives the structured payload instead (same policy as
// scripts/kpi-report.mjs).
export function buildSlackPayload(info) {
  const { shard, status, minutes, maxMinutes } = info;
  const lines = [
    `job       human-like-${shard ?? "unknown"}`,
    `status    ${status ?? "unknown"}`,
    minutes !== undefined ? `duration  ${minutes} min` : null,
    maxMinutes ? `budget    ${maxMinutes} min` : null,
  ].filter(Boolean).join("\n");

  return {
    text: "⚠️ BookmarkForge nightly — human-like suite alert",
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: "⚠️ *BookmarkForge nightly — human-like suite alert*" } },
      { type: "section", text: { type: "mrkdwn", text: ["```", lines, "```"].join("\n") } },
    ],
  };
}

export async function fireAlertWebhook(url, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`webhook responded ${response.status}`);
    console.error(JSON.stringify({ event: "nightly_webhook_delivered" }));
    return true;
  } catch (error) {
    // INTENTIONAL SILENCE: alert delivery is best-effort; a dead webhook must
    // never fail the nightly run (same policy as monitoring-alerts.mjs).
    console.error(JSON.stringify({
      event: "nightly_webhook_failed",
      reason: String(error),
    }));
    return false;
  }
}

export async function runNightlyAlert(options = {}) {
  const env = options.env ?? process.env;
  const dryRun = options.dryRun ?? false;

  const status = env.NIGHTLY_HUMAN_LIKE_STATUS?.trim();
  const shard = env.NIGHTLY_HUMAN_LIKE_SHARD?.trim() || "unknown";
  const minutes = parseMinutes(env.NIGHTLY_HUMAN_LIKE_MINUTES);
  const maxMinutes = env.NIGHTLY_HUMAN_LIKE_MAX_MINUTES?.trim() || "";

  if (status !== "success" && status !== "failure" && status !== "cancelled") {
    console.error(JSON.stringify({ event: "nightly_alert_invalid_input", reason: `bad status: ${status}` }));
    return { code: 1, reason: "bad-status" };
  }
  if (minutes === undefined && (env.NIGHTLY_HUMAN_LIKE_MINUTES ?? "").trim() !== "") {
    console.error(JSON.stringify({ event: "nightly_alert_invalid_input", reason: "minutes is not a number" }));
    return { code: 1, reason: "bad-minutes" };
  }

  const evaluation = evaluateAlert({ status, minutes, maxMinutes });
  const decision = {
    code: 0,
    alert: evaluation.alert,
    failed: evaluation.failed,
    overBudget: evaluation.overBudget,
  };

  if (!evaluation.alert) {
    console.error(JSON.stringify({ event: "nightly_alert_skipped", shard, status, minutes: minutes ?? null }));
    return decision;
  }

  const info = { shard, status, minutes, maxMinutes: maxMinutes ? Number(maxMinutes) : undefined };
  const payload = buildAlertPayload(info);
  console.error(JSON.stringify(payload));

  if (dryRun) {
    console.error(JSON.stringify({ event: "nightly_alert_dry_run", shard }));
    return decision;
  }

  const webhook = resolveWebhook(env.NIGHTLY_ALERT_WEBHOOK_URL ?? "");
  if (!webhook) {
    console.error(JSON.stringify({ event: "nightly_alert_no_webhook", shard }));
    return decision;
  }

  const slack = isSlackWebhook(webhook) ? buildSlackPayload(info) : undefined;
  await fireAlertWebhook(webhook, slack ?? payload);
  return decision;
}

const IS_CLI = Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
if (IS_CLI) {
  const dryRun = process.argv.includes("--dry-run");
  runNightlyAlert({ dryRun }).then((result) => {
    process.exitCode = result.code;
  });
}
