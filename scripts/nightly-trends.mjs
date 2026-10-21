#!/usr/bin/env node
/**
 * scripts/nightly-trends.mjs
 *
 * Aggregates the per-suite WoW duration histories (JSONL files written by
 * scripts/nightly-alert.mjs into the Actions cache) into one CSV report for
 * the nightly trend dashboard.
 *
 * Input layout (TRENDS_HISTORY_DIR, default ".nightly-history"):
 *   human-like-shard-1.jsonl, human-like-shard-2.jsonl, ...   → suite human-like
 *   multiuser-shard-1.jsonl, multiuser-shard-2.jsonl, ...     → suite multiuser
 *   perf-scale.jsonl                                          → suite perf-scale
 *
 * Outputs:
 *   TRENDS_CSV (default "nightly-trends.csv")
 *     suite,shard,week,year,minutes,recordedAt
 *     One row per recorded sample, sorted by suite, week, then shard.
 *   TRENDS_SVG (default "nightly-trends.svg")
 *     Self-contained SVG line chart of the weekly median per suite, with
 *     DEGRADED weeks drawn as red points and sustained-degradation runs
 *     (the ones that trip the fail-loud gate) highlighted with a red band,
 *     ringed points and a "sustained xN" label (no external dependencies).
 *   TRENDS_SUMMARY_CSV (default "nightly-trends-summary.csv")
 *     suite,week,year,medianMinutes,samples,minMinutes,maxMinutes,
 *     deltaPctWoW,degradedWoW,streak
 *     One row per suite+week: median of the shard minutes that week (the
 *     same median the WoW budget compares against) plus min/max, sample
 *     count, deltaPctWoW — the % change vs the previous week's median
 *     (same suite, adjacent weeks only; empty when there is no previous
 *     week or its median is 0) — and degradedWoW: "DEGRADED" when the week
 *     trips the same criterion as the alert (minutes >= 1.25 x previous
 *     week's median, via evaluateDegradation), empty otherwise. streak is
 *     the length of the current consecutive-degraded-weeks run ending at
 *     that week (0 when not degraded; a gap in the history resets it) — the
 *     running trend, visible before the fail-loud gate ever trips.
 * A header-only file is written even when no history exists yet. The report
 * is advisory except for one fail-loud gate: when a suite's median trips the
 * degradation criterion (>= 1.25 x previous week) for TRENDS_MIN_CONSECUTIVE_
 * DEGRADED consecutive weeks (default 3, 0 disables), the script exits 1 so
 * the nightly-trends job goes red — sustained trends are a real signal, not
 * noise — and, when NIGHTLY_ALERT_WEBHOOK_URL is configured, posts a
 * `nightly_trends_sustained` alert (Slack shape for Slack webhooks, the
 * structured payload otherwise; best-effort, never changes the exit code).
 * The alert carries the missed/phantom consistency findings for the
 * affected suite+weeks (same classifyConsistency the nightly-consistency
 * report uses), so the degradation and the alert-vs-trend state ride in
 * one payload. When the gate does NOT trip but a suite's current streak is
 * N-1 (one week short of its threshold), a best-effort early-warning alert
 * (nightly_trends_early_warning) goes out the night before — it never
 * changes the exit code, which stays green. Every other condition still
 * exits 0.
 *
 * Environment:
 *   TRENDS_HISTORY_DIR             directory with *.jsonl histories (default ".nightly-history")
 *   TRENDS_CSV                     samples CSV path (default "nightly-trends.csv")
 *   TRENDS_SUMMARY_CSV             weekly summary CSV path (default "nightly-trends-summary.csv")
 *   TRENDS_MIN_CONSECUTIVE_DEGRADED consecutive degraded weeks that fail the
 *                                   run (default 3; 0 disables the check).
 *                                   Per-suite override via
 *                                   TRENDS_MIN_CONSECUTIVE_DEGRADED_<SUITE>
 *                                   (suite upper-snaked, e.g. HUMAN_LIKE),
 *                                   falling back to this global value
 *   TRENDS_SUMMARY_MD             optional Markdown path for the GitHub job
 *                                 summary (falls back to GITHUB_STEP_SUMMARY,
 *                                 set automatically by Actions)
 *   TRENDS_SUMMARY_MD_FILE        artifact copy of the same markdown
 *                                 (default "nightly-trends-summary.md")
 *   TRENDS_SVG                    SVG chart path (default "nightly-trends.svg")
 *   TRENDS_SVG_PUBLIC_URL         optional https URL where the SVG is
 *                                 reachable; when set, the job summary embeds
 *                                 it as an image (GitHub sanitizes inline
 *                                 data URIs in summaries, so a real URL is
 *                                 required). Unset = links only, nothing
 *                                 leaves the repo.
 *   TRENDS_DEFER_SUMMARY          1 = skip the job summary + md artifact write
 *                                 (phase 1 of the two-phase presigned-URL
 *                                 flow: the SVG must be uploaded and presigned
 *                                 before the summary can embed it). The gate
 *                                 and alerts still run in this pass.
 *   TRENDS_SUMMARY_ONLY           1 = rewrite ONLY the summary + md artifact
 *                                 with the current TRENDS_SVG_PUBLIC_URL
 *                                 (phase 2). Recomputes rows from history,
 *                                 never touches the CSVs/SVG, never re-runs
 *                                 the gate/alerts, always exits 0.
 *   NIGHTLY_ALERT_WEBHOOK_URL      optional HTTPS webhook for the sustained
 *                                 degradation alert (http:// rejected
 *                                 fail-closed, same policy as the shard
 *                                 alerts). For Slack webhooks the payload
 *                                 carries an interactive "Open run summary"
 *                                 button (actions block) linking to the run
 *                                 page built from GITHUB_SERVER_URL /
 *                                 GITHUB_REPOSITORY / GITHUB_RUN_ID — one
 *                                 click from Slack to the job summary and
 *                                 its artifacts.
 *                                 alerts; unset skips the alert)
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateDegradation, fireAlertWebhook, isSlackWebhook, median, parseHistory, resolveWebhook } from "./nightly-alert.mjs";

// Same criterion the WoW alert applies by default (NIGHTLY_<LABEL>_DEGRADE_RATIO
// defaults to 1.25 = +25%): a week is DEGRADED when its median is >= 1.25 x the
// previous week's median. evaluateDegradation is the single source of truth.
const DEGRADE_RATIO = 1.25;

// "human-like-shard-1.jsonl" → { suite: "human-like", shard: "1" }
// "multiuser-shard-2.jsonl"  → { suite: "multiuser", shard: "2" }
// "perf-scale.jsonl"         → { suite: "perf-scale", shard: "single" }
export function suiteFromFilename(name) {
  const base = name.replace(/\.jsonl$/i, "");
  const shardMatch = base.match(/^(.*)-shard-(\d+)$/);
  if (shardMatch) return { suite: shardMatch[1], shard: shardMatch[2] };
  return { suite: base, shard: "single" };
}

export function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

// Returns CSV text with header + one row per sample, sorted by suite, week,
// shard (numeric-aware so "10" sorts after "2").
export function buildTrendsCsv(entries) {
  const sorted = [...entries].sort((a, b) => {
    const bySuite = a.suite.localeCompare(b.suite);
    if (bySuite) return bySuite;
    if (a.week !== b.week) return a.week - b.week;
    return String(a.shard).localeCompare(String(b.shard), undefined, { numeric: true });
  });
  const header = "suite,shard,week,year,minutes,recordedAt";
  const rows = sorted.map((e) =>
    [e.suite, e.shard, e.week, e.year, e.minutes, e.recordedAt].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

// true when b is the week immediately following a, including the ISO year
// rollover (week 52/53 of year N → week 1 of year N+1).
export function isAdjacentWeek(a, b) {
  if (a.year === b.year) return b.week === a.week + 1;
  return b.year === a.year + 1 && b.week === 1 && a.week >= 52;
}

// One structured row per suite+week, sorted by suite/year/week. The median of
// that week's shard minutes is the same statistic the WoW budget compares
// against; deltaPctWoW is the % change vs the previous week's median and
// degradedWoW whether the alert's degradation criterion trips. Both are only
// computed for adjacent weeks (a gap in the history yields an empty delta, not
// a comparison against a stale week), and are empty when there is no previous
// week or its median is 0 (division would be undefined).
export function summarizeEntries(entries) {
  const byKey = new Map();
  for (const e of entries) {
    const key = `${e.suite}|${e.week}`;
    if (!byKey.has(key)) {
      byKey.set(key, { suite: e.suite, week: e.week, year: e.year, minutes: [] });
    }
    byKey.get(key).minutes.push(e.minutes);
  }
  const groups = [...byKey.values()]
    .map((g) => ({ ...g, medianMinutes: median(g.minutes) }))
    .sort((a, b) => {
      const bySuite = a.suite.localeCompare(b.suite);
      if (bySuite) return bySuite;
      if (a.year !== b.year) return a.year - b.year;
      return a.week - b.week;
    });
  const rows = [];
  let prevRow = null;
  let lastSuite = null;
  for (const g of groups) {
    const prev = g.suite === lastSuite ? prevRow : null;
    const mins = g.minutes;
    let delta = "";
    let degraded = false;
    if (prev && isAdjacentWeek(prev, g) && prev.medianMinutes > 0) {
      // 1 decimal, e.g. +16.7 for 14 vs 12, -33.3 for 10 vs 15.
      delta = Math.round(((g.medianMinutes - prev.medianMinutes) / prev.medianMinutes) * 1000) / 10;
      degraded = evaluateDegradation({
        minutes: g.medianMinutes,
        baseline: prev.medianMinutes,
        ratio: DEGRADE_RATIO,
      }).degraded;
    }
    // streak: consecutive degraded weeks ending at this row (a gap or a
    // non-degraded week resets it) — the same run the fail-loud gate counts,
    // visible in the CSV before the gate ever trips.
    const streak = degraded ? (prev?.degradedWoW ? prev.streak + 1 : 1) : 0;
    const row = {
      suite: g.suite,
      week: g.week,
      year: g.year,
      medianMinutes: g.medianMinutes,
      samples: mins.length,
      minMinutes: Math.min(...mins),
      maxMinutes: Math.max(...mins),
      deltaPctWoW: delta,
      degradedWoW: degraded,
      streak,
    };
    rows.push(row);
    prevRow = row;
    lastSuite = g.suite;
  }
  return rows;
}

// CSV rendering of summarizeEntries — the same rows the sustained-degradation
// gate consumes, so the artifact and the check can never disagree.
export function buildWeeklySummary(entries) {
  const rows = summarizeEntries(entries);
  const header = "suite,week,year,medianMinutes,samples,minMinutes,maxMinutes,deltaPctWoW,degradedWoW,streak";
  const csvRows = rows.map((r) =>
    [
      r.suite,
      r.week,
      r.year,
      r.medianMinutes,
      r.samples,
      r.minMinutes,
      r.maxMinutes,
      r.deltaPctWoW,
      r.degradedWoW ? "DEGRADED" : "",
      r.streak,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...csvRows].join("\n") + "\n";
}

const DEFAULT_MIN_CONSECUTIVE_DEGRADED = 3;

// Consecutive weeks required to fail a fail-loud gate. Empty/invalid falls
// back to `fallback` (default 3, the degradation gate's threshold); "0"
// explicitly disables the gate. Shared with the consistency report's
// sustained-phantom gate (which uses its own fallback).
export function parseMinConsecutive(raw, fallback = DEFAULT_MIN_CONSECUTIVE_DEGRADED) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

// Per-suite consecutive-weeks thresholds: env.TRENDS_MIN_CONSECUTIVE_DEGRADED_<SUITE>
// (suite upper-snaked: human-like → HUMAN_LIKE) wins for that suite, falling
// back to the global TRENDS_MIN_CONSECUTIVE_DEGRADED, then to the default.
// Unknown envs → the global value, so a suite without a dedicated var is
// governed by the shared threshold. Returns a { suite → n } map.
export function resolveSuiteMinConsecutive(env = {}, suites) {
  const global = parseMinConsecutive(env.TRENDS_MIN_CONSECUTIVE_DEGRADED);
  const map = {};
  for (const suite of suites) {
    const key = `TRENDS_MIN_CONSECUTIVE_DEGRADED_${suite.replace(/-/g, "_").toUpperCase()}`;
    map[suite] = parseMinConsecutive(env[key], global);
  }
  return map;
}

// Scans the summary rows (sorted by suite/year/week) for runs of >= minConsecutive
// CONSECUTIVE calendar weeks in which the degradation criterion tripped. A
// non-degraded week or a gap in the history (non-adjacent weeks, via
// isAdjacentWeek) breaks the run; ISO year rollover (week 52/53 → week 1)
// continues it. Returns one entry per qualifying run: { suite, weeks, count }.
// minConsecutive may be a single number (uniform threshold) or a { suite → n }
// map from resolveSuiteMinConsecutive for per-suite thresholds; a suite whose
// threshold is 0 (or absent from a map, falling back to 0) has the gate
// disabled.
export function findSustainedDegradation(rows, minConsecutive) {
  const isMap = typeof minConsecutive === "object" && minConsecutive !== null;
  const thresholdFor = (suite) => {
    const value = isMap ? (minConsecutive[suite] ?? 0) : minConsecutive;
    return Number.isInteger(value) && value > 0 ? value : 0;
  };
  const runs = [];
  let suite = null;
  let streak = 0;
  let weeks = [];
  const flush = () => {
    const threshold = thresholdFor(suite);
    // threshold 0 = gate disabled for this suite: never flush a run.
    if (threshold > 0 && streak >= threshold) runs.push({ suite, weeks, count: streak });
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const prev = i > 0 && rows[i - 1].suite === row.suite ? rows[i - 1] : null;
    const contiguous = Boolean(prev && isAdjacentWeek(prev, row));
    if (row.degradedWoW && contiguous) {
      streak += 1;
      weeks.push({ week: row.week, year: row.year });
    } else {
      flush();
      streak = row.degradedWoW ? 1 : 0;
      weeks = row.degradedWoW ? [{ week: row.week, year: row.year }] : [];
      suite = row.suite;
    }
  }
  flush();
  return runs;
}

// Early-warning complement to findSustainedDegradation: suites whose CURRENT
// streak is exactly threshold - 1 consecutive degraded weeks — one more week
// would trip the fail-loud gate, so the nightly alerts a day early
// (best-effort, never changes the exit code). A suite already in a sustained
// run (>= threshold) is excluded — its gate has already fired. Returns
// { suite, count, threshold, weeks } per approaching suite, where count =
// threshold - 1.
export function findApproachingStreaks(rows, minConsecutive) {
  const isMap = typeof minConsecutive === "object" && minConsecutive !== null;
  const thresholdFor = (suite) => {
    const value = isMap ? (minConsecutive[suite] ?? 0) : minConsecutive;
    return Number.isInteger(value) && value > 0 ? value : 0;
  };
  const suites = [...new Set(rows.map((r) => r.suite))];
  const approaching = [];
  for (const suite of suites) {
    const threshold = thresholdFor(suite);
    if (threshold <= 1) continue; // N-1 needs N >= 2 to be meaningful
    const suiteRows = rows.filter((r) => r.suite === suite);
    const last = suiteRows[suiteRows.length - 1];
    if (!last?.degradedWoW) continue;
    const count = last.streak ?? 1;
    if (count !== threshold - 1) continue;
    // collect the weeks of the current run (walk back while contiguous)
    const weeks = [{ week: last.week, year: last.year }];
    for (let i = suiteRows.length - 2; i >= 0; i--) {
      if (suiteRows[i].degradedWoW && isAdjacentWeek(suiteRows[i], suiteRows[i + 1])) {
        weeks.unshift({ week: suiteRows[i].week, year: suiteRows[i].year });
      } else {
        break;
      }
    }
    approaching.push({ suite, count, threshold, weeks });
  }
  return approaching.sort((a, b) => a.suite.localeCompare(b.suite));
}

export async function collectEntries(historyDir) {
  let files;
  try {
    files = await readdir(historyDir);
  } catch {
    // INTENTIONAL SILENCE: no history dir yet — the report degrades to an
    // empty (header-only) CSV; this is advisory evidence, not a gate.
    return [];
  }
  const entries = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const { suite, shard } = suiteFromFilename(file);
    let raw;
    try {
      raw = readFileSync(`${historyDir}/${file}`, "utf8");
    } catch {
      // INTENTIONAL SILENCE: an unreadable history file must not fail the
      // trend report; the suite contributes no rows this run.
      continue;
    }
    for (const sample of parseHistory(raw)) {
      entries.push({
        suite,
        shard,
        week: sample.week,
        year: sample.year ?? "",
        minutes: sample.minutes,
        recordedAt: sample.recordedAt ?? "",
      });
    }
  }
  return entries;
}

// Parses one alert log file into structured entries. Corrupted lines are
// skipped — the log is advisory evidence, never a gate. Shared with the
// nightly-consistency report (re-exported from nightly-consistency.mjs), so
// both reports read the alert log with the exact same shape.
export function parseAlertLog(raw) {
  const entries = [];
  if (!raw || typeof raw !== "string") return entries;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed);
      if (Number.isFinite(e?.week) && typeof e?.suite === "string" && typeof e?.event === "string") {
        entries.push({
          suite: e.suite,
          shard: String(e.shard ?? ""),
          week: e.week,
          year: Number.isFinite(e.year) ? e.year : null,
          status: e.status ?? "",
          minutes: Number.isFinite(e.minutes) ? e.minutes : null,
          degraded: e.degraded === true,
          deltaPctWoW: Number.isFinite(e.deltaPctWoW) ? e.deltaPctWoW : null,
          delivered: e.delivered === true ? true : e.delivered === false ? false : null,
          recordedAt: typeof e.recordedAt === "string" ? e.recordedAt : "",
          event: e.event,
        });
      }
    } catch {
      // INTENTIONAL SILENCE: one corrupted line must not fail the report.
    }
  }
  return entries;
}

// Reads every *.jsonl in the alerts/ subdir (missing dir → empty list).
export async function collectAlertEntries(alertsDir) {
  let files;
  try {
    files = await readdir(alertsDir);
  } catch {
    // INTENTIONAL SILENCE: no alerts logged yet — the report degrades to an
    // empty consistency view; advisory evidence, not a gate.
    return [];
  }
  const entries = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    let raw;
    try {
      raw = readFileSync(join(alertsDir, file), "utf8");
    } catch {
      // INTENTIONAL SILENCE: an unreadable alert log contributes no rows.
      continue;
    }
    entries.push(...parseAlertLog(raw));
  }
  return entries;
}

// Shared alert-vs-trend classification: given the summary row for a
// suite+week (with degradedWoW) and that week's alert-log entries, returns
// "consistent" / "missed-alert" / "phantom-alert" with the SAME criterion
// the nightly-consistency report uses, so the sustained-degradation alert
// and the consistency report can never disagree about what a week was.
export function classifyConsistency(summary, alerts) {
  const woWAlerts = alerts.filter((a) => a.degraded);
  if (summary?.degradedWoW && woWAlerts.length === 0) return "missed-alert";
  if (woWAlerts.length > 0 && !summary?.degradedWoW) return "phantom-alert";
  return "consistent";
}

const SUITE_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#06b6d4"];
const STREAK_LIGHT = [252, 165, 165]; // #fca5a5 — streak 1
const STREAK_DARK = [185, 28, 28]; // #b91c1c — at/over the gate threshold

// Hex color on the red streak ramp: streak 1 → STREAK_LIGHT, streak >= the
// suite's gate threshold → STREAK_DARK, linear in between. Suites without a
// configured threshold fall back to the global default (3), matching the
// gate's own fallback so the ramp and the fail-loud criterion agree.
function streakColor(streak, suite, thresholds) {
  const threshold = Math.max(1, thresholds[suite] ?? DEFAULT_MIN_CONSECUTIVE_DEGRADED);
  const ratio = Math.min(1, Math.max(0, streak) / threshold);
  const rgb = STREAK_LIGHT.map((light, i) => Math.round(light + (STREAK_DARK[i] - light) * ratio));
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Self-contained SVG line chart of the weekly median minutes per suite — no
// external dependencies, no JS, no remote fonts. One polyline per suite; a
// DEGRADED week (>= 1.25x the previous week's median, same criterion as the
// CSV's degradedWoW column) is drawn as a red point on a streak ramp, so the
// slope and the threshold violations are visible at a glance. Sustained-
// degradation runs (from findSustainedDegradation, passed via options.sustained)
// get a light red band across their week range with the points ringed and a
// "sustained xN" label. The streak ramp (options.thresholds, the per-suite
// consecutive-week map from resolveSuiteMinConsecutive) shades each DEGRADED
// point from light red at streak 1 toward deep red as it approaches the
// suite's gate threshold — the streaks closest to tripping the fail-loud gate
// are the darkest.
export function buildTrendsSvg(entries, options = {}) {
  const sustained = options.sustained ?? [];
  const suiteThresholds = options.thresholds ?? {};
  const rows = summarizeEntries(entries);
  const W = 860;
  const H = 480;
  const mL = 64;
  const mR = 24;
  const mT = 36;
  const mB = 84;
  const plotW = W - mL - mR;
  const plotH = H - mT - mB;

  const xKeys = [];
  const seen = new Set();
  for (const r of rows) {
    const key = `${r.year}|${r.week}`;
    if (!seen.has(key)) {
      seen.add(key);
      xKeys.push({ year: r.year, week: r.week });
    }
  }
  xKeys.sort((a, b) => a.year - b.year || a.week - b.week);
  const xOf = new Map(xKeys.map((k, i) => [`${k.year}|${k.week}`, i]));
  const suites = [...new Set(rows.map((r) => r.suite))];
  // The y scale must also fit each suite's degradation threshold (1.25x the
  // previous adjacent week's median), or a threshold line above the data
  // would be clipped off the plot.
  const thresholds = rows
    .map((r, i) => {
      const prev = i > 0 && rows[i - 1].suite === r.suite && isAdjacentWeek(rows[i - 1], r) ? rows[i - 1] : null;
      return prev && prev.medianMinutes > 0 ? prev.medianMinutes * DEGRADE_RATIO : null;
    })
    .filter((v) => v !== null);
  const yMax = Math.max(10, Math.ceil(Math.max(1, ...rows.map((r) => r.medianMinutes), ...thresholds) / 10) * 10);
  const x = (i) => (xKeys.length === 1 ? mL + plotW / 2 : mL + (plotW * i) / (xKeys.length - 1));
  const y = (v) => mT + plotH - (plotH * v) / yMax;

  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, sans-serif">`];
  const title = xKeys.length
    ? `Weekly median minutes per suite — ${xKeys[0].year}-W${xKeys[0].week} to ${xKeys[xKeys.length - 1].year}-W${xKeys[xKeys.length - 1].week}`
    : "Weekly median minutes per suite";
  parts.push(`<text x="${mL}" y="20" font-size="14" font-weight="600" fill="#111827">${xmlEscape(title)}</text>`);

  if (!rows.length) {
    parts.push(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#6b7280">No trend data yet</text>`);
    parts.push("</svg>");
    return parts.join("\n");
  }

  // gridlines + y labels
  const yTicks = 4;
  for (let t = 1; t <= yTicks; t++) {
    const val = (yMax * t) / yTicks;
    const yy = y(val);
    parts.push(`<line x1="${mL}" y1="${yy}" x2="${W - mR}" y2="${yy}" stroke="#e5e7eb" stroke-width="1"/>`);
    parts.push(`<text x="${mL - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#6b7280">${Math.round(val)}</text>`);
  }

  // x labels (at most ~12 ticks; year suffix when the data spans years)
  const multiYear = new Set(xKeys.map((k) => k.year)).size > 1;
  const tickStep = Math.max(1, Math.ceil(xKeys.length / 12));
  for (let i = 0; i < xKeys.length; i++) {
    if (i % tickStep !== 0 && i !== xKeys.length - 1) continue;
    const label = multiYear ? `W${xKeys[i].week}'${String(xKeys[i].year).slice(2)}` : `W${xKeys[i].week}`;
    parts.push(`<text x="${x(i)}" y="${H - mB + 18}" text-anchor="middle" font-size="11" fill="#6b7280">${label}</text>`);
  }

  // axes
  parts.push(`<line x1="${mL}" y1="${mT + plotH}" x2="${W - mR}" y2="${mT + plotH}" stroke="#9ca3af" stroke-width="1"/>`);
  parts.push(`<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT + plotH}" stroke="#9ca3af" stroke-width="1"/>`);

  // sustained-degradation bands (behind the series): one light red rect per
  // run spanning its weeks, with a label above
  const halfStep = xKeys.length > 1 ? plotW / (xKeys.length - 1) / 2 : plotW / 2;
  const sustainedKeys = new Set();
  for (const run of sustained) {
    const first = run.weeks[0];
    const last = run.weeks[run.weeks.length - 1];
    const x0 = x(xOf.get(`${first.year}|${first.week}`)) - halfStep;
    const x1 = x(xOf.get(`${last.year}|${last.week}`)) + halfStep;
    parts.push(`<rect x="${x0}" y="${mT}" width="${Math.max(0, x1 - x0)}" height="${plotH}" fill="#fee2e2" opacity="0.55"/>`);
    parts.push(`<text x="${(x0 + x1) / 2}" y="${mT + 14}" text-anchor="middle" font-size="11" font-weight="600" fill="#b91c1c">sustained ×${run.count}</text>`);
    for (const w of run.weeks) sustainedKeys.add(`${run.suite}|${w.year}|${w.week}`);
  }

  // one polyline per suite, split across history gaps
  suites.forEach((suite, si) => {
    const color = SUITE_COLORS[si % SUITE_COLORS.length];
    const suiteRows = rows.filter((r) => r.suite === suite);
    let segment = [];
    const flush = () => {
      if (segment.length > 1) {
        const points = segment.map((r) => `${x(xOf.get(`${r.year}|${r.week}`))},${y(r.medianMinutes)}`).join(" ");
        parts.push(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`);
      }
      segment = [];
    };
    for (let i = 0; i < suiteRows.length; i++) {
      const r = suiteRows[i];
      if (segment.length && !isAdjacentWeek(suiteRows[i - 1], r)) flush();
      segment.push(r);
    }
    flush();
    for (const r of suiteRows) {
      const cx = x(xOf.get(`${r.year}|${r.week}`));
      const cy = y(r.medianMinutes);
      const degraded = r.degradedWoW;
      const inRun = sustainedKeys.has(`${suite}|${r.year}|${r.week}`);
      const radius = degraded ? (inRun ? 6 : 5) : 3.5;
      // sustained-run points get a dark ring around the DEGRADED fill
      const ring = inRun ? ` stroke="#b91c1c" stroke-width="2.5"` : ` stroke="#ffffff" stroke-width="1.5"`;
      // DEGRADED points are shaded on the streak ramp: streak 1 is light red,
      // and the tone deepens as the streak approaches the suite's gate
      // threshold — the darkest points are the ones closest to tripping it.
      const fill = degraded ? streakColor(r.streak ?? 0, suite, suiteThresholds) : color;
      // Accessible <title> on every point: screen readers and static SVG
      // inspection (hover tooltip in browsers, tree in viewers) show the exact
      // suite/week/median/delta/streak without needing the CSV.
      const deltaLabel =
        r.deltaPctWoW === undefined || r.deltaPctWoW === null || r.deltaPctWoW === ""
          ? "no adjacent baseline"
          : `${r.deltaPctWoW >= 0 ? "+" : ""}${r.deltaPctWoW}% vs prev. week`;
      const titleText = `${suite} ${r.year}-W${r.week} — median ${r.medianMinutes} min (${deltaLabel}${degraded ? `, streak ${r.streak ?? 0}` : ""})`;
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fill}"${ring}><title>${xmlEscape(titleText)}</title></circle>`);
    }
    // Dotted reference line of the degradation threshold (1.25x the previous
    // adjacent week's median, same DEGRADE_RATIO as the DEGRADED criterion),
    // split across gaps like the series. Where the solid line crosses above
    // its own dotted threshold, that week is DEGRADED — visible at a glance.
    let tSegment = [];
    const flushThreshold = () => {
      if (tSegment.length > 1) {
        const points = tSegment
          .map((p) => `${x(xOf.get(`${p.year}|${p.week}`))},${y(p.threshold)}`)
          .join(" ");
        parts.push(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.75"/>`);
      }
      tSegment = [];
    };
    let prevRow = null;
    for (const r of suiteRows) {
      const threshold =
        prevRow && isAdjacentWeek(prevRow, r) && prevRow.medianMinutes > 0 ? prevRow.medianMinutes * DEGRADE_RATIO : null;
      if (threshold === null) {
        flushThreshold();
      } else {
        if (tSegment.length && !isAdjacentWeek(tSegment[tSegment.length - 1], { week: r.week, year: r.year })) flushThreshold();
        tSegment.push({ week: r.week, year: r.year, threshold });
      }
      prevRow = r;
    }
    flushThreshold();
  });

  // legend — top row: the per-suite colors. The streak ramp and the three
  // point markers share ONE compact row below the x-axis labels (see below).
  suites.forEach((suite, si) => {
    const lx = mL + si * 180;
    const color = SUITE_COLORS[si % SUITE_COLORS.length];
    parts.push(`<line x1="${lx}" y1="${mT - 12}" x2="${lx + 16}" y2="${mT - 12}" stroke="${color}" stroke-width="3"/>`);
    parts.push(`<text x="${lx + 22}" y="${mT - 8}" font-size="12" fill="#374151">${xmlEscape(suite)}</text>`);
  });
  // dotted threshold legend swatch (drawn in a neutral dark color so the
  // per-suite dashed lines in the plot stay readable)
  parts.push(`<line x1="${W - 232}" y1="${mT + 10}" x2="${W - 216}" y2="${mT + 10}" stroke="#111827" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.75"/>`);
  parts.push(`<text x="${W - 210}" y="${mT + 14}" font-size="12" fill="#374151">threshold (1.25× prev. week)</text>`);

  // legend row BELOW the x-axis labels (the canvas is 480px tall for it): the
  // three point markers AND the complete streak ramp (streak 1 → N → gate) as
  // a single continuous gradient swatch — one compact row. Every swatch uses
  // the exact radius/stroke/color the plot uses, so they can't drift.
  const markerY = H - 34;
  const markerX0 = mL + 12;
  const normalColor = SUITE_COLORS[0];
  parts.push(`<circle cx="${markerX0}" cy="${markerY}" r="3.5" fill="${normalColor}" stroke="#ffffff" stroke-width="1.5"/>`);
  parts.push(`<text x="${markerX0 + 12}" y="${markerY + 4}" font-size="11" fill="#374151">normal week (suite color)</text>`);
  const degradedX = markerX0 + 194;
  parts.push(`<circle cx="${degradedX}" cy="${markerY}" r="5" fill="${streakColor(1, suites[0] ?? "", suiteThresholds)}" stroke="#ffffff" stroke-width="1.5"/>`);
  parts.push(`<text x="${degradedX + 12}" y="${markerY + 4}" font-size="11" fill="#374151">DEGRADED (streak ramp)</text>`);
  const ringedX = degradedX + 175;
  parts.push(`<circle cx="${ringedX}" cy="${markerY}" r="6" fill="${streakColor(1, suites[0] ?? "", suiteThresholds)}" stroke="#b91c1c" stroke-width="2.5"/>`);
  parts.push(`<text x="${ringedX + 12}" y="${markerY + 4}" font-size="11" fill="#374151">sustained run (gate tripped)</text>`);
  // complete ramp: continuous light→deep red gradient (STREAK_LIGHT to
  // STREAK_DARK — the exact endpoints of the ramp), labeled with the suite
  // gate threshold N.
  const rampN = Math.max(1, suiteThresholds[suites[0] ?? ""] ?? DEFAULT_MIN_CONSECUTIVE_DEGRADED);
  const rampX = ringedX + 185;
  parts.push(`<defs><linearGradient id="streak-ramp-grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#${STREAK_LIGHT.map((v) => v.toString(16).padStart(2, "0")).join("")}"/><stop offset="100%" stop-color="#${STREAK_DARK.map((v) => v.toString(16).padStart(2, "0")).join("")}"/></linearGradient></defs>`);
  parts.push(`<rect x="${rampX}" y="${markerY - 5}" width="44" height="10" fill="url(#streak-ramp-grad)"/>`);
  parts.push(`<text x="${rampX + 50}" y="${markerY + 4}" font-size="11" fill="#374151">streak 1 → ${rampN} → gate</text>`);

  parts.push("</svg>");
  return parts.join("\n");
}

// Structured payload for the sustained-degradation Slack alert. Each run is
// enriched with the median/deltaPctWoW of its last week before being passed
// here, so the alert shows the suite's current slope, not just the streak.
export function buildSustainedPayload(sustained, minConsecutive, consistencyFindings = []) {
  return {
    event: "nightly_trends_sustained",
    workflow: "nightly",
    minConsecutive,
    suites: sustained.map((r) => ({
      suite: r.suite,
      count: r.count,
      threshold: r.threshold ?? minConsecutive, // per-suite repo var when set
      weeks: r.weeks.map((w) => `${w.year}-W${w.week}`),
      medianMinutes: r.medianMinutes ?? null,
      deltaPctWoW: r.deltaPctWoW ?? null,
    })),
    consistency: consistencyFindings.map((f) => ({
      suite: f.suite,
      week: f.week,
      year: f.year ?? null,
      kind: f.kind,
      detail: f.detail ?? "",
    })),
  };
}

// Slack Incoming Webhooks only accept the { text, blocks } shape; the
// structured payload above goes to any other HTTPS webhook. When runUrl is
// provided, an actions block with a button opens the run's job summary page
// (with its artifacts) straight from Slack. consistencyFindings (missed /
// phantom alerts for the affected suite+weeks, same classification the
// nightly-consistency report uses) ride along as their own section.
export function buildSustainedSlackPayload(sustained, minConsecutive, runUrl = "", consistencyFindings = []) {
  const suiteBlocks = sustained.map((r) => {
    const lines = [
      `suite     ${r.suite}`,
      `streak    ${r.count} consecutive week${r.count === 1 ? "" : "s"}`,
      `budget    ${r.threshold ?? minConsecutive} consecutive weeks (per-suite var)`,
      `weeks     ${r.weeks.map((w) => `${w.year}-W${w.week}`).join(", ")}`,
      r.deltaPctWoW !== undefined && r.deltaPctWoW !== null
        ? `slope     ${r.deltaPctWoW >= 0 ? "+" : ""}${r.deltaPctWoW}% vs prev. week`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
    return { type: "section", text: { type: "mrkdwn", text: `*${r.suite}*\n\`\`\`\n${lines}\n\`\`\`` } };
  });
  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: "📈 *BookmarkForge nightly — sustained degradation* (consecutive-week gate tripped)" } },
    ...suiteBlocks,
  ];
  if (consistencyFindings.length > 0) {
    const findingsText = consistencyFindings
      .map((f) => `${f.kind === "missed-alert" ? "🟡" : "🔴"} *${f.suite}* ${f.year ?? ""}-W${f.week}: ${f.detail}`)
      .join("\n");
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Alert-vs-trend consistency*\n${findingsText}` } });
  }
  if (runUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open run summary" },
          url: runUrl,
        },
      ],
    });
  }
  return {
    text: `📈 BookmarkForge nightly — sustained degradation (${sustained.length} suite${sustained.length === 1 ? "" : "s"}, consecutive-week gate tripped)`,
    blocks,
  };
}

// Missed/phantom findings for the weeks covered by the sustained runs — the
// same classification the nightly-consistency report applies (via
// classifyConsistency), so the Slack alert and the consistency CSV can never
// disagree. Returns { suite, week, year, kind, detail } per non-consistent
// suite+week inside a sustained run.
export function buildConsistencyFindings(rows, alertEntries, sustained) {
  const alertsByKey = new Map();
  for (const a of alertEntries) {
    const key = `${a.suite}|${a.week}`;
    if (!alertsByKey.has(key)) alertsByKey.set(key, []);
    alertsByKey.get(key).push(a);
  }
  const findings = [];
  for (const run of sustained) {
    for (const w of run.weeks) {
      const key = `${run.suite}|${w.week}`;
      const summary = rows.find((r) => r.suite === run.suite && r.year === w.year && r.week === w.week);
      const alerts = alertsByKey.get(key) ?? [];
      const kind = classifyConsistency(summary, alerts);
      if (kind === "consistent") continue;
      const woWAlerts = alerts.filter((a) => a.degraded);
      const detail =
        kind === "missed-alert"
          ? `suite median DEGRADED but no shard WoW alert logged (${alerts.length} non-WoW alert${alerts.length === 1 ? "" : "s"})`
          : `shard WoW alert${woWAlerts.length === 1 ? "" : "s"} without suite-level DEGRADED: ${woWAlerts.map((a) => a.shard || "?").join(",")}`;
      findings.push({ suite: run.suite, week: w.week, year: w.year, kind, detail });
    }
  }
  return findings.sort(
    (a, b) => a.suite.localeCompare(b.suite) || (a.year ?? 0) - (b.year ?? 0) || a.week - b.week,
  );
}

// Best-effort delivery of the sustained-degradation alert. Returns whether a
// webhook was configured and the send was attempted; failures are logged by
// fireAlertWebhook and never change the run's exit code.
export async function sendSustainedAlert({ webhook, sustained, minConsecutive, runUrl = "", consistencyFindings = [], fire = fireAlertWebhook }) {
  if (!webhook || !sustained.length) return false;
  const slack = isSlackWebhook(webhook) ? buildSustainedSlackPayload(sustained, minConsecutive, runUrl, consistencyFindings) : undefined;
  return fire(webhook, slack ?? buildSustainedPayload(sustained, minConsecutive, consistencyFindings));
}

// Structured payload for the early-warning alert (a suite at streak N-1, one
// week before the gate would trip). Sent best-effort the night BEFORE the
// sustained gate fires, so operators get a day of lead time.
export function buildEarlyWarningPayload(approaching) {
  return {
    event: "nightly_trends_early_warning",
    workflow: "nightly",
    streaks: approaching.map((s) => ({
      suite: s.suite,
      count: s.count,
      threshold: s.threshold,
      weeks: s.weeks.map((w) => `${w.year}-W${w.week}`),
      medianMinutes: s.medianMinutes ?? null,
      deltaPctWoW: s.deltaPctWoW ?? null,
    })),
  };
}

// Slack shape for the early-warning alert: one mrkdwn block per approaching
// suite, stating the streak and that one more week trips the gate.
export function buildEarlyWarningSlackPayload(approaching) {
  const suiteBlocks = approaching.map((s) => {
    const lines = [
      `suite     ${s.suite}`,
      `streak    ${s.count} of ${s.threshold} consecutive weeks`, // one short of the gate
      `weeks     ${s.weeks.map((w) => `${w.year}-W${w.week}`).join(", ")}`,
      s.deltaPctWoW !== undefined && s.deltaPctWoW !== null
        ? `slope     ${s.deltaPctWoW >= 0 ? "+" : ""}${s.deltaPctWoW}% vs prev. week`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
    return { type: "section", text: { type: "mrkdwn", text: `*${s.suite}*\n\`\`\`\n${lines}\n\`\`\`` } };
  });
  return {
    text: `⚠️ BookmarkForge nightly — streak ${approaching.length === 1 ? "1 suite is" : `${approaching.length} suites are`} one week from the gate`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: "⚠️ *BookmarkForge nightly — early warning*: streak at N−1, the gate trips with one more degraded week" } },
      ...suiteBlocks,
    ],
  };
}

// Best-effort delivery of the early-warning alert. Returns whether a webhook
// was configured and the send was attempted; failures are logged by
// fireAlertWebhook and never change the run's exit code.
export async function sendEarlyWarning({ webhook, approaching, fire = fireAlertWebhook }) {
  if (!webhook || !approaching.length) return false;
  const slack = isSlackWebhook(webhook) ? buildEarlyWarningSlackPayload(approaching) : undefined;
  return fire(webhook, slack ?? buildEarlyWarningPayload(approaching));
}

// Markdown for the GitHub job summary — the DEGRADED suites at a glance, no
// artifact download needed. Written even when nothing is degraded (so the
// summary always says something) and before the sustained-degradation exit,
// so a red run still shows the evidence. When a runUrl is provided (built in
// main from the GITHUB_* env), a footer links to the run summary and its
// artifacts, so the CSV/SVG are one click away.
// GitHub job summaries sanitize the rendered HTML: <img> tags and data-URI
// images are stripped, so an embedded SVG only renders when svgUrl points at
// a reachable https URL (e.g. a signed artifact URL or a private host). The
// embed is therefore opt-in: without svgUrl the summary keeps the raw-data
// links, and nothing leaves the repository by default.
export function buildMarkdownSummary(rows, sustained, runUrl = "", svgUrl = "") {
  const degraded = rows.filter((r) => r.degradedWoW);
  // Weeks whose median improved vs the previous week (negative slope) — the
  // full picture of the trend, not just the degradations.
  const improved = rows.filter((r) => typeof r.deltaPctWoW === "number" && r.deltaPctWoW < 0);
  const lines = ["## Nightly WoW trends", ""];
  if (!degraded.length) {
    lines.push("_No suite+week is DEGRADED in the restored history (≥ 1.25× previous week median)._", "");
  } else {
    lines.push("### DEGRADED weeks", "");
    lines.push("| suite | week | year | median (min) | deltaPctWoW | streak |", "|---|---|---|---|---|---|");
    for (const r of degraded) {
      lines.push(`| ${r.suite} | ${r.week} | ${r.year} | ${r.medianMinutes} | ${r.deltaPctWoW}% | ${r.streak ?? 0} |`);
    }
    lines.push("");
  }
  if (improved.length > 0) {
    lines.push("### Improved weeks (negative slope)", "");
    lines.push("| suite | week | year | median (min) | deltaPctWoW |", "|---|---|---|---|---|");
    for (const r of improved) {
      lines.push(`| ${r.suite} | ${r.week} | ${r.year} | ${r.medianMinutes} | ${r.deltaPctWoW}% |`);
    }
    lines.push("");
  }
  if (sustained.length > 0) {
    lines.push("### Sustained degradation (fail-loud gate)", "");
    for (const run of sustained) {
      lines.push(`- **${run.suite}**: ${run.count} consecutive weeks (${run.weeks.map((w) => `${w.year}-W${w.week}`).join(", ")})`);
    }
    lines.push("");
  }
  if (runUrl) {
    lines.push("### Raw data", "");
    lines.push(`- [Run summary](${runUrl}) — the nightly-trends artifacts (CSV, weekly summary, SVG) live on this page`, "");
    lines.push(`- [Artifacts](${runUrl}#artifacts) — direct jump to the uploaded artifacts`, "");
  }
  if (svgUrl) {
    lines.push("### Trend chart", "");
    // markdown image with a width hint renders in the job summary (external
    // https URL only — sanitized summaries strip inline data URIs)
    lines.push(`![Nightly WoW trends chart](${svgUrl})`, "");
  }
  return lines.join("\n");
}

export async function main(options = {}) {
  const env = options.env ?? process.env;
  // Two-phase run for the presigned-URL embed: the SVG only exists after the
  // first pass, so the summary (which embeds it) must wait for the presigned
  // URL. TRENDS_DEFER_SUMMARY=1 (phase 1) skips the summary write; a separate
  // step uploads the SVG to a private bucket and presigns it, then phase 2
  // (TRENDS_SUMMARY_ONLY=1) rewrites ONLY the summary with the URL. Without
  // the defer flag the single-pass behavior is unchanged.
  const deferSummary = env.TRENDS_DEFER_SUMMARY === "1";
  const summaryOnly = env.TRENDS_SUMMARY_ONLY === "1";
  const historyDir = env.TRENDS_HISTORY_DIR ?? ".nightly-history";
  const csvPath = env.TRENDS_CSV ?? "nightly-trends.csv";
  const summaryPath = env.TRENDS_SUMMARY_CSV ?? "nightly-trends-summary.csv";
  const svgPath = env.TRENDS_SVG ?? "nightly-trends.svg";
  const mdFilePath = env.TRENDS_SUMMARY_MD_FILE ?? "nightly-trends-summary.md";
  // One-click path from the table to the raw data: the run summary page
  // (with its artifacts) — built from the GITHUB_* env Actions provides.
  const runUrl =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : "";

  const entries = await collectEntries(historyDir);
  const rows = summarizeEntries(entries);
  const minConsecutive = resolveSuiteMinConsecutive(env, [...new Set(rows.map((r) => r.suite))]);
  const sustained = findSustainedDegradation(rows, minConsecutive);

  // Phase 1 writes the evidence artifacts; the summary-only pass (phase 2)
  // recomputes rows from the same history and writes only the summary, so the
  // embed carries the presigned URL without touching the CSVs/SVG or re-running
  // the gate/alerts (already decided in phase 1).
  if (!summaryOnly) {
    const csv = buildTrendsCsv(entries);
    writeFileSync(csvPath, csv);
    const summary = buildWeeklySummary(entries);
    writeFileSync(summaryPath, summary);
    // Fail-loud sustained-degradation gate: CSVs are written first so the
    // evidence is on disk even when the run exits 1.
    writeFileSync(svgPath, buildTrendsSvg(entries, { sustained, thresholds: minConsecutive }));
  }

  // GitHub job summary (best-effort): TRENDS_SUMMARY_MD wins, else the
  // GITHUB_STEP_SUMMARY path Actions provides in every step. A failure to
  // write is only display sugar lost — never a run failure. Skipped in phase
  // 1 of the two-phase embed flow (the presigned URL is not known yet).
  if (!deferSummary) {
    // Optional embed: a signed/public URL for the SVG (repo var or presigned
    // URL injected by the two-phase flow). Without it the summary keeps the
    // raw-data links only — nothing leaves the repo.
    const svgUrl = env.TRENDS_SVG_PUBLIC_URL ?? "";
    const md = buildMarkdownSummary(rows, sustained, runUrl, svgUrl);

    const summaryMdPath = env.TRENDS_SUMMARY_MD ?? env.GITHUB_STEP_SUMMARY ?? "";
    if (summaryMdPath) {
      try {
        appendFileSync(summaryMdPath, md + "\n");
      } catch (error) {
        // INTENTIONAL SILENCE: job summary is best-effort display sugar.
        console.error(JSON.stringify({ event: "nightly_trends_summary_write_failed", reason: String(error) }));
      }
    }
    // Artifact copy of the same markdown, so it can be attached to an issue or
    // kept outside Actions. A failure here must not fail the run either.
    try {
      writeFileSync(mdFilePath, md + "\n");
    } catch (error) {
      // INTENTIONAL SILENCE: the artifact copy is convenience, not evidence.
      console.error(JSON.stringify({ event: "nightly_trends_md_file_write_failed", reason: String(error) }));
    }
  }

  console.error(JSON.stringify({
    event: summaryOnly ? "nightly_trends_summary_rewrite" : "nightly_trends_report",
    rows: entries.length,
    summaryRows: rows.length,
    minConsecutiveDegraded: minConsecutive,
    sustainedDegradation: sustained,
    csv: csvPath,
    summaryCsv: summaryPath,
    summaryMd: mdFilePath,
    svg: svgPath,
  }));
  // Summary-only pass (phase 2 of the presigned-URL embed flow): the gate,
  // alerts and early warnings were already decided in phase 1 — this pass only
  // rewrites the summary with the presigned URL, so it must never change the
  // exit code or re-fire anything.
  if (summaryOnly) return 0;
  if (sustained.length > 0) {
    // Enrich each run with the median/deltaPctWoW of its last week so the
    // alert shows the suite's current slope alongside the streak.
    const enriched = sustained.map((run) => {
      const last = run.weeks[run.weeks.length - 1];
      const row = rows.find((r) => r.suite === run.suite && r.year === last.year && r.week === last.week);
      return { ...run, threshold: minConsecutive[run.suite] ?? null, medianMinutes: row?.medianMinutes ?? null, deltaPctWoW: row?.deltaPctWoW ?? null };
    });
    // Missed/phantom findings for the affected weeks ride along in the same
    // payload (same classification the consistency report applies).
    const alertEntries = await collectAlertEntries(join(historyDir, "alerts"));
    const consistencyFindings = buildConsistencyFindings(rows, alertEntries, sustained);
    const webhook = resolveWebhook(env.NIGHTLY_ALERT_WEBHOOK_URL ?? "");
    if (webhook) {
      // Best-effort: even a throwing webhook sender must never change the
      // gate's exit code, so the send is isolated in its own try/catch.
      try {
        await sendSustainedAlert({ webhook, sustained: enriched, minConsecutive, runUrl, consistencyFindings, fire: options.fire });
      } catch (error) {
        // INTENTIONAL SILENCE: alert delivery is advisory — log and continue
        // to the gate decision.
        console.error(JSON.stringify({ event: "nightly_trends_alert_send_failed", reason: String(error) }));
      }
    } else {
      console.error(JSON.stringify({ event: "nightly_trends_no_webhook", thresholds: minConsecutive }));
    }
    console.error(JSON.stringify({
      event: "nightly_trends_sustained_degradation",
      detail: enriched.map((r) =>
        `${r.suite}: ${r.count} consecutive weeks (${r.weeks.map((w) => `${w.year}-W${w.week}`).join(", ")})`,
      ),
    }));
    return 1;
  }
  // Early warning (best-effort): suites whose current streak is N-1, one week
  // before the gate would trip. Fires only when the gate itself did NOT trip
  // (a suite already in a sustained run has no lead time left). Never changes
  // the exit code — the run stays green.
  const approaching = findApproachingStreaks(rows, minConsecutive);
  if (approaching.length > 0) {
    const enriched = approaching.map((run) => {
      const last = run.weeks[run.weeks.length - 1];
      const row = rows.find((r) => r.suite === run.suite && r.year === last.year && r.week === last.week);
      return { ...run, medianMinutes: row?.medianMinutes ?? null, deltaPctWoW: row?.deltaPctWoW ?? null };
    });
    const webhook = resolveWebhook(env.NIGHTLY_ALERT_WEBHOOK_URL ?? "");
    if (webhook) {
      // Best-effort: a throwing webhook sender must never fail the run.
      try {
        await sendEarlyWarning({ webhook, approaching: enriched, fire: options.fire });
      } catch (error) {
        // INTENTIONAL SILENCE: alert delivery is advisory — log and continue.
        console.error(JSON.stringify({ event: "nightly_trends_early_send_failed", reason: String(error) }));
      }
    } else {
      console.error(JSON.stringify({ event: "nightly_trends_early_no_webhook", streaks: enriched.map((s) => `${s.suite}: ${s.count}/${s.threshold}`) }));
    }
    console.error(JSON.stringify({
      event: "nightly_trends_early_warning",
      detail: enriched.map((r) => `${r.suite}: ${r.count}/${r.threshold} consecutive weeks (${r.weeks.map((w) => `${w.year}-W${w.week}`).join(", ")})`),
    }));
  }
  return 0;
}

const IS_CLI = Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
if (IS_CLI) {
  main().then((code) => {
    process.exitCode = code;
  });
}
