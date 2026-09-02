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
 * Nightly alert gate for sharded E2E suites (human-like, multiuser, ...).
 * Called from .github/workflows/nightly.yml after a shard matrix job finishes;
 * it decides whether an alert must fire and delivers it to an optional HTTPS
 * webhook (Slack Incoming Webhook shape supported, same policy as
 * scripts/kpi-report.mjs and scripts/drill-backup-restore.mjs).
 *
 * The gate is parametrized by NIGHTLY_ALERT_JOB_LABEL (default "human-like"):
 * every NIGHTLY_HUMAN_LIKE_* variable below becomes NIGHTLY_<LABEL>_* for the
 * target suite (e.g. label "multiuser" → NIGHTLY_MULTIUSER_*), so one script
 * serves all sharded suites with per-suite budgets, history and alerts.
 *
 * Three alert triggers:
 *   1. job failure    — the shard finished with a non-zero result
 *   2. slow run       — the shard exceeded NIGHTLY_<LABEL>_MAX_MINUTES
 *   3. WoW regression — the shard took >= DEGRADE_RATIO x the median of
 *      previous weeks' samples (from NIGHTLY_<LABEL>_HISTORY_FILE, a
 *      JSONL log persisted across runs via the Actions cache). Degradation
 *      alerts NEVER fail the job — they are informational only.
 *
 * Payload enrichment: every alert carries deltaPctWoW — this run vs the
 * median of the previous ADJACENT week (same 1-decimal statistic as the
 * trends summary's deltaPctWoW column) — so Slack shows the suite's weekly
 * slope even when the multi-week baseline looks flat.
 *
 * Environment:
 *   NIGHTLY_ALERT_JOB_LABEL       job label (default "human-like"); selects
 *                                 the NIGHTLY_<LABEL>_* variable family
 *   NIGHTLY_<LABEL>_STATUS        "success" | "failure" (from ${{ job.status }})
 *   NIGHTLY_<LABEL>_MINUTES       wall-clock minutes the job took (numeric)
 *   NIGHTLY_<LABEL>_SHARD         shard label for the message ("1" / "2")
 *   NIGHTLY_<LABEL>_MAX_MINUTES   optional duration budget in minutes;
 *                                 unset or 0 disables the slow-run alert
 *   NIGHTLY_<LABEL>_HISTORY_FILE  optional JSONL path with prior samples
 *                                 ({"week":..,"minutes":..} per line);
 *                                 unset disables the WoW regression check.
 *                                 The current sample is appended on every
 *                                 run (file is created if missing).
 *   NIGHTLY_<LABEL>_DEGRADE_RATIO optional multiplier vs median baseline
 *                                 (default 1.25 = +25% week over week)
 *   NIGHTLY_ALERT_WEBHOOK_URL     optional HTTPS webhook (http:// is
 *                                 rejected fail-closed, same policy as
 *                                 DRILL_ALERT_WEBHOOK_URL)
 *
 * Exit codes:
 *   0  no alert needed, or alert delivered/attempted (webhook problems are
 *      logged, never fatal — a dead webhook must not fail the nightly run)
 *   1  malformed gate inputs (bad status or non-numeric minutes)
 *
 * CLI flags:
 *   --dry-run   evaluate and print the decision without posting anything
 *   --test      send a synthetic test alert to NIGHTLY_ALERT_WEBHOOK_URL
 *               (used by the webhook-smoke job on workflow_dispatch);
 *               exit 0 = delivered, 1 = failed/unconfigured
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const USER_AGENT = "bookmarkforge-nightly-alert";
const WEBHOOK_TIMEOUT_MS = 5_000;
const DEFAULT_DEGRADE_RATIO = 1.25;
const MIN_BASELINE_SAMPLES = 2; // need >=2 prior samples for a stable median

export const DURATION_BUDGET_MS = 60 * 60 * 1000; // 60 minutes per shard job

// ISO-8601 week number (1-53), matching the %G-%V convention.
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7),
  };
}

export function parseHistory(raw) {
  if (!raw || typeof raw !== "string") return [];
  const samples = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (Number.isFinite(entry?.minutes) && entry.minutes >= 0 && Number.isFinite(entry?.week)) {
        samples.push({
          week: entry.week,
          year: entry.year ?? null,
          minutes: entry.minutes,
          // recordedAt is optional (kept for the trends CSV; older lines may
          // lack it). Consumers that only need week/minutes ignore it.
          recordedAt: entry.recordedAt ?? null,
        });
      }
    } catch {
      // INTENTIONAL SILENCE: history is advisory telemetry; a corrupted line
      // must not fail the nightly alert gate.
    }
  }
  return samples;
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Baseline = median of samples from weeks BEFORE the current one, so the
// run never compares against itself.
export function baselineMinutes(samples, currentWeek) {
  const prior = samples.filter((s) => s.week !== currentWeek).map((s) => s.minutes);
  if (prior.length < MIN_BASELINE_SAMPLES) return undefined;
  return median(prior);
}

// Median of the samples from the week immediately BEFORE (currentWeek,
// currentYear) — adjacent ISO weeks, including the year rollover (week 52/53
// of year N-1 → week 1 of year N). This is the same statistic the trends
// summary's deltaPctWoW column compares against, so the alert payload can
// carry the suite's weekly slope computed from the same history file. Returns
// undefined when no adjacent previous week has samples.
export function prevWeekMedian(samples, currentWeek, currentYear) {
  const prior = (samples ?? []).filter((s) => {
    const sy = s.year ?? currentYear;
    if (currentWeek === 1) return sy === currentYear - 1 && s.week >= 52;
    return sy === currentYear && s.week === currentWeek - 1;
  });
  const minutes = prior.map((s) => s.minutes).filter((m) => Number.isFinite(m));
  return minutes.length ? median(minutes) : undefined;
}

export function parseRatio(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return DEFAULT_DEGRADE_RATIO;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DEGRADE_RATIO;
  return value;
}

// Informational only: never contributes to the job exit code.
export function evaluateDegradation({ minutes, baseline, ratio }) {
  if (baseline === undefined || baseline <= 0 || minutes === undefined || minutes <= 0) {
    return { degraded: false, baseline, ratio, deltaPct: null };
  }
  const degraded = minutes >= baseline * ratio;
  return { degraded, baseline, ratio, deltaPct: Math.round(((minutes - baseline) / baseline) * 100) };
}

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

// Job label → env prefix: "human-like" → "NIGHTLY_HUMAN_LIKE", "multiuser" →
// "NIGHTLY_MULTIUSER". Falls back to the default when unset/invalid.
export function envPrefixFor(label) {
  const normalized = String(label ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return normalized ? `NIGHTLY_${normalized}` : "NIGHTLY_HUMAN_LIKE";
}

export function buildAlertPayload({ shard, status, minutes, maxMinutes, baseline, degraded, deltaPct, deltaPctWoW, jobLabel = "human-like" }) {
  return {
    event: `nightly_${jobLabel.replace(/-/g, "_")}_alert`,
    workflow: "nightly",
    job: `${jobLabel}-${shard ?? "unknown"}`,
    status,
    minutes: minutes ?? null,
    maxMinutes: maxMinutes ?? null,
    baselineMinutes: baseline ?? null,
    degraded: degraded ?? false,
    deltaPct: deltaPct ?? null,
    // Weekly slope: this run vs the median of the previous (adjacent) week,
    // same 1-decimal statistic as the trends summary's deltaPctWoW column.
    deltaPctWoW: deltaPctWoW ?? null,
  };
}

// Slack Incoming Webhooks only accept the `{ text, blocks }` shape; any other
// HTTPS webhook receives the structured payload instead (same policy as
// scripts/kpi-report.mjs).
export function buildSlackPayload(info) {
  const { shard, status, minutes, maxMinutes, baseline, degraded, deltaPct, deltaPctWoW, jobLabel = "human-like" } = info;
  const lines = [
    `job       ${jobLabel}-${shard ?? "unknown"}`,
    `status    ${status ?? "unknown"}`,
    minutes !== undefined ? `duration  ${minutes} min` : null,
    maxMinutes ? `budget    ${maxMinutes} min` : null,
    baseline !== undefined && baseline !== null ? `baseline  ${baseline} min (median prev. weeks)` : null,
    deltaPctWoW !== undefined && deltaPctWoW !== null ? `slope     ${deltaPctWoW >= 0 ? "+" : ""}${deltaPctWoW}% vs prev. week` : null,
    degraded ? `trend     DEGRADED +${deltaPct}% week-over-week` : null,
  ].filter(Boolean).join("\n");

  return {
    text: `⚠️ BookmarkForge nightly — ${jobLabel} suite alert`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `⚠️ *BookmarkForge nightly — ${jobLabel} suite alert*` } },
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
  const jobLabel = env.NIGHTLY_ALERT_JOB_LABEL?.trim() || "human-like";
  const P = envPrefixFor(jobLabel);

  const status = env[`${P}_STATUS`]?.trim();
  const shard = env[`${P}_SHARD`]?.trim() || "unknown";
  const minutes = parseMinutes(env[`${P}_MINUTES`]);
  const maxMinutes = env[`${P}_MAX_MINUTES`]?.trim() || "";

  if (status !== "success" && status !== "failure" && status !== "cancelled") {
    console.error(JSON.stringify({ event: "nightly_alert_invalid_input", reason: `bad status: ${status}` }));
    return { code: 1, reason: "bad-status" };
  }
  if (minutes === undefined && (env[`${P}_MINUTES`] ?? "").trim() !== "") {
    console.error(JSON.stringify({ event: "nightly_alert_invalid_input", reason: "minutes is not a number" }));
    return { code: 1, reason: "bad-minutes" };
  }

  // Week-over-week duration baseline (advisory): load prior samples from the
  // JSONL history file, compute the median of PREVIOUS weeks, and compare.
  const historyFile = env[`${P}_HISTORY_FILE`]?.trim() || "";
  let samples = [];
  if (historyFile && existsSync(historyFile)) {
    try {
      samples = parseHistory(readFileSync(historyFile, "utf8"));
    } catch (error) {
      // INTENTIONAL SILENCE: unreadable history must not fail the gate; the
      // WoW check degrades to "no baseline" for this run.
      console.error(JSON.stringify({ event: "nightly_history_read_failed", reason: String(error) }));
    }
  }
  const { week: currentWeek, year } = isoWeek();
  const baseline = baselineMinutes(samples, currentWeek);
  const ratio = parseRatio(env[`${P}_DEGRADE_RATIO`]);
  const degradation = evaluateDegradation({ minutes, baseline, ratio });

  // Weekly slope (deltaPctWoW): this run vs the median of the previous
  // adjacent week, with the same 1-decimal formula the trends summary's
  // deltaPctWoW column uses — the Slack alert carries the suite's weekly
  // pendulum even when the multi-week baseline is flat.
  const prevMedian = prevWeekMedian(samples, currentWeek, year);
  let deltaPctWoW;
  if (minutes !== undefined && prevMedian !== undefined && prevMedian > 0) {
    deltaPctWoW = Math.round(((minutes - prevMedian) / prevMedian) * 1000) / 10;
  }

  // Record the current sample for future runs — always, success or failure,
  // so the baseline reflects reality even through red weeks.
  if (historyFile && minutes !== undefined) {
    try {
      mkdirSync(dirname(historyFile), { recursive: true });
      appendFileSync(historyFile, `${JSON.stringify({ week: currentWeek, year, minutes, recordedAt: new Date().toISOString() })}\n`);
    } catch (error) {
      // INTENTIONAL SILENCE: failing to persist the sample only weakens the
      // future baseline; it must never fail the nightly run itself.
      console.error(JSON.stringify({ event: "nightly_history_write_failed", reason: String(error) }));
    }
  }

  const evaluation = evaluateAlert({ status, minutes, maxMinutes });
  const decision = {
    code: 0,
    alert: evaluation.alert,
    failed: evaluation.failed,
    overBudget: evaluation.overBudget,
    degraded: degradation.degraded,
    baselineMinutes: degradation.baseline ?? null,
    deltaPct: degradation.deltaPct,
    deltaPctWoW: deltaPctWoW ?? null,
  };

  if (!evaluation.alert) {
    console.error(JSON.stringify({ event: "nightly_alert_skipped", shard, status, minutes: minutes ?? null, baseline: baseline ?? null, degraded: degradation.degraded }));
    return decision;
  }

  const info = {
    shard,
    status,
    minutes,
    maxMinutes: maxMinutes ? Number(maxMinutes) : undefined,
    baseline: degradation.baseline,
    degraded: degradation.degraded,
    deltaPct: degradation.deltaPct,
    deltaPctWoW,
    jobLabel,
  };
  const payload = buildAlertPayload(info);
  console.error(JSON.stringify(payload));

  const logEntry = {
    event: payload.event,
    suite: jobLabel,
    shard,
    week: currentWeek,
    year,
    status,
    minutes: minutes ?? null,
    degraded: degradation.degraded,
    deltaPct: degradation.deltaPct ?? null,
    deltaPctWoW: deltaPctWoW ?? null,
    recordedAt: new Date().toISOString(),
  };

  if (dryRun) {
    // Dry runs log too (delivered: null) — same policy as the history write.
    appendAlertLog(env[`${P}_ALERT_LOG_FILE`], { ...logEntry, delivered: null });
    // Manual --dry-run verification shows the weekly slope alongside the
    // decision, mirroring what the webhook payload would carry.
    console.error(JSON.stringify({
      event: "nightly_alert_dry_run",
      shard,
      status,
      minutes: minutes ?? null,
      degraded: degradation.degraded,
      deltaPctWoW: deltaPctWoW ?? null,
    }));
    return decision;
  }

  const webhook = resolveWebhook(env.NIGHTLY_ALERT_WEBHOOK_URL ?? "");
  let delivered = null;
  if (webhook) {
    const slack = isSlackWebhook(webhook) ? buildSlackPayload(info) : undefined;
    delivered = await fireAlertWebhook(webhook, slack ?? payload);
  } else {
    console.error(JSON.stringify({ event: "nightly_alert_no_webhook", shard }));
  }
  appendAlertLog(env[`${P}_ALERT_LOG_FILE`], { ...logEntry, delivered });
  return decision;
}

// Best-effort JSONL record of every alert decision, consumed by the nightly
// consistency job (scripts/nightly-consistency.mjs) to cross-check the trend
// CSV's degradedWoW against what was actually sent. Writing the log must
// never fail the nightly run.
export function appendAlertLog(logFile, entry) {
  if (!logFile) return;
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    // INTENTIONAL SILENCE: alert logging is advisory evidence; a failure only
    // weakens the consistency report, it must not fail the nightly run.
    console.error(JSON.stringify({ event: "nightly_alert_log_write_failed", reason: String(error) }));
  }
}

// `--test` sends a synthetic alert to the configured webhook (no evaluation,
// no history writes) so the wiring can be validated without waiting for a
// nightly run. The payload carries synthetic slope markers (degraded, deltaPctWoW
// and the Slack `slope` line) so the smoke exercises the same schema the real
// alerts use. Exit code mirrors webhook delivery: 0 delivered, 1 failed.
// The suite under test comes from NIGHTLY_ALERT_JOB_LABEL (default
// "human-like"), matching the per-suite env family of runNightlyAlert.
export async function testWebhook(options = {}) {
  const env = options.env ?? process.env;
  const webhook = resolveWebhook(env.NIGHTLY_ALERT_WEBHOOK_URL ?? "");
  if (!webhook) {
    console.error(JSON.stringify({ event: "nightly_webhook_test", ok: false, reason: "no webhook configured" }));
    return { code: 1 };
  }
  const jobLabel = env.NIGHTLY_ALERT_JOB_LABEL?.trim() || "human-like";
  const jobName = `${jobLabel}-smoke`;
  const payload = {
    event: "nightly_webhook_test",
    workflow: "nightly",
    job: jobName,
    status: "success",
    minutes: null,
    // Synthetic slope markers so the smoke validates the same schema the real
    // alerts carry (deltaPctWoW + the Slack slope line).
    degraded: true,
    deltaPctWoW: 30,
    text: `🧪 BookmarkForge nightly — ${jobLabel} webhook test`,
  };
  const slack = isSlackWebhook(webhook) ? {
    text: `🧪 BookmarkForge nightly — ${jobLabel} webhook test`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `🧪 *BookmarkForge nightly — ${jobLabel} webhook test*` } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `\`\`\`\njob       ${jobName}\nstatus    success (synthetic)\nslope     +30% vs prev. week (synthetic)\n\`\`\``,
        },
      },
    ],
  } : undefined;
  const ok = await fireAlertWebhook(webhook, slack ?? payload);
  console.error(JSON.stringify({ event: "nightly_webhook_test", ok, job: jobName }));
  return { code: ok ? 0 : 1 };
}

const IS_CLI = Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
if (IS_CLI) {
  const dryRun = process.argv.includes("--dry-run");
  if (process.argv.includes("--test")) {
    testWebhook().then((result) => {
      process.exitCode = result.code;
    });
  } else {
    runNightlyAlert({ dryRun }).then((result) => {
      process.exitCode = result.code;
    });
  }
}
