#!/usr/bin/env node
/**
 * scripts/nightly-consistency.mjs
 *
 * Cross-checks the trend summary's degradedWoW column (per suite+week) against
 * the alert log written by scripts/nightly-alert.mjs whenever an alert fires,
 * and emits an alert-vs-trend consistency report.
 *
 * Inputs (same Actions cache directory as the trends report):
 *   <historyDir>/                    per-suite JSONL histories (via collectEntries
 *                                    from nightly-trends.mjs — the summary rows
 *                                    are recomputed with the SAME summarizeEntries
 *                                    that builds nightly-trends-summary.csv, so
 *                                    the degradedWoW values are byte-identical)
 *   <historyDir>/alerts/*.jsonl      alert log entries, one JSON per line:
 *                                    {event, suite, shard, week, year, status,
 *                                     minutes, degraded, deltaPct, deltaPctWoW,
 *                                     delivered, recordedAt}
 *
 * Outputs (advisory EXCEPT for one fail-loud gate):
 *   CONSISTENCY_CSV (default "nightly-consistency.csv")
 *     suite,week,year,summaryDegraded,alertsTotal,woWAlerts,undeliveredAlerts,
 *     kind,detail,csvDeltaPctWoW,deltaMatch
 *     One row per suite+week present in EITHER input (union). kind:
 *       consistent    — summary and alert log agree (both degraded, or neither)
 *       missed-alert  — summary row is DEGRADED but NO shard WoW alert was
 *                       logged that week (may be a median-aggregation artifact:
 *                       the suite median degrades while no single shard crosses
 *                       the 1.25x threshold, or a genuinely missed alert)
 *       phantom-alert — shard WoW alerts logged for a suite+week whose summary
 *                       row is NOT degraded (alert without trend corroboration)
 *     severity, weighted by the suite's degraded streak (from summarizeEntries):
 *       high   — missed-alert on streak >= 2 (consecutive degraded weeks with
 *                NO alert corroboration — the gravest case)
 *       medium — missed-alert on streak 1, or any phantom-alert
 *       low    — consistent rows
 *     The findings table (CSV + job summary) sorts high-severity first, and
 *     the JSON reports highSeverity as its own counter.
 *     deltaMatch (per suite+week with alert-log deltas):
 *       match        — every alert deltaPctWoW equals the CSV row's delta
 *       granularity  — deltas differ but the suite has >1 shard that week: the
 *                      CSV row is the suite MEDIAN, alerts are per-shard, so
 *                      differing values are expected aggregation, not drift
 *       mismatch     — deltas differ while the suite has a single shard: the
 *                      alert payload and the CSV row disagree (real signal)
 *     undeliveredAlerts — count of alerts for that suite+week whose webhook
 *                      delivery failed (delivered=false — webhook down). After
 *                      the suite+week table, the CSV carries a SECOND block of
 *                      rows, one per undelivered alert
 *                      (suite,week,year,shard,status,minutes,deltaPctWoW,
 *                      recordedAt) so a delivery outage is visible apart from
 *                      the trend reconciliation.
 *   CONSISTENCY_JSON (default "nightly-consistency.json")
 *     {event, consistent, missedAlert, phantomAlert, deltaMismatch,
 *      undeliveredAlerts, details: [...], undeliveredDetails: [...],
 *      deltaDetails: [...]}
 *   CONSISTENCY_SUMMARY_MD (default: GITHUB_STEP_SUMMARY)
 *     Markdown for the GitHub job summary: a table of missed/phantom alerts,
 *     a deltaPctWoW reconciliation table and a delivery-failures table,
 *     visible without downloading artifacts.
 *   CONSISTENCY_SVG
 *     Self-contained bar chart (one bar per suite+week colored by kind:
 *     consistent / missed-alert / phantom-alert, height = alert count),
 *     uploaded alongside the CSV/JSON.
 *   CONSISTENCY_SVG_PUBLIC_URL
 *     Optional https URL where the SVG is hosted; embeds it in the job
 *     summary as a markdown image (GitHub strips inline data URIs, so the
 *     embed is opt-in — nothing leaves the repo by default).
 *   CONSISTENCY_DEFER_SUMMARY
 *     1 = skip the job summary write (phase 1 of the two-phase presigned-URL
 *     flow, mirroring nightly-trends: the SVG must be uploaded and presigned
 *     before the summary can embed it). The gate still runs in this pass.
 *   CONSISTENCY_SUMMARY_ONLY
 *     1 = rewrite ONLY the job summary with the current
 *     CONSISTENCY_SVG_PUBLIC_URL (phase 2). Recomputes the report from
 *     history, never touches the CSV/JSON/SVG, never re-runs the gate,
 *     always exits 0.
 *
 * Environment:
 *   CONSISTENCY_HISTORY_DIR  directory with histories + alerts/ subdir
 *                            (default ".nightly-history")
 *   CONSISTENCY_CSV          report CSV path (default "nightly-consistency.csv")
 *   CONSISTENCY_JSON         report JSON path (default "nightly-consistency.json")
 *   CONSISTENCY_SVG          SVG bar chart path (default "nightly-consistency.svg")
 *   CONSISTENCY_SUMMARY_MD   optional Markdown path for the GitHub job summary
 *                            (falls back to GITHUB_STEP_SUMMARY, set
 *                            automatically by Actions)
 *   CONSISTENCY_MIN_CONSECUTIVE_PHANTOM
 *                            consecutive phantom-alert weeks in the same suite
 *                            that fail the run (default 2; 0 disables) —
 *                            repeated phantoms hint at a bug in the
 *                            degradation criterion, so the report goes red.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyConsistency, collectAlertEntries, collectEntries, csvEscape, isAdjacentWeek, parseAlertLog, parseMinConsecutive, summarizeEntries, xmlEscape } from "./nightly-trends.mjs";

// Re-exported for API stability: parseAlertLog / collectAlertEntries now live
// in nightly-trends.mjs (the trends job reads the same alert log for the
// sustained-degradation payload), so both reports share ONE parsing path.
export { classifyConsistency, collectAlertEntries, parseAlertLog };

// Scans the report rows (sorted by suite/year/week) for runs of >= minConsecutive
// CONSECUTIVE calendar weeks in which the suite got a phantom-alert (WoW alert
// without suite-level DEGRADED corroboration). A non-phantom week or a gap in
// the history breaks the run; the ISO year rollover continues it. Repeated
// phantoms in the same suite hint at a bug in the degradation criterion, so
// these runs turn the report red. Returns { suite, weeks, count } per run.
export function findSustainedPhantom(rows, minConsecutive) {
  if (!Number.isInteger(minConsecutive) || minConsecutive <= 0) return [];
  const runs = [];
  let suite = null;
  let streak = 0;
  let weeks = [];
  const flush = () => {
    if (streak >= minConsecutive) runs.push({ suite, weeks, count: streak });
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const prev = i > 0 && rows[i - 1].suite === row.suite ? rows[i - 1] : null;
    const contiguous = Boolean(prev && isAdjacentWeek(prev, row));
    const phantom = row.kind === "phantom-alert";
    if (phantom && contiguous) {
      streak += 1;
      weeks.push({ week: row.week, year: row.year });
    } else {
      flush();
      streak = phantom ? 1 : 0;
      weeks = phantom ? [{ week: row.week, year: row.year }] : [];
      suite = row.suite;
    }
  }
  flush();
  return runs;
}

// Reconciles the deltaPctWoW carried by the alert payloads (per shard) with
// the summary CSV row (per suite) for the same suite+week. The suite row is
// the median across shards, so exact equality is only expected for single-
// shard suites; multi-shard differences are aggregation granularity, not
// drift. Returns one result per suite+week that has alert-log deltas.
export function reconcileDeltas(summaryRows, alertEntries, historyEntries) {
  const summaryByKey = new Map();
  for (const r of summaryRows) summaryByKey.set(`${r.suite}|${r.week}`, r);
  const shardsByKey = new Map();
  for (const h of historyEntries ?? []) {
    const key = `${h.suite}|${h.week}`;
    if (!shardsByKey.has(key)) shardsByKey.set(key, new Set());
    shardsByKey.get(key).add(String(h.shard));
  }
  const byKey = new Map();
  for (const a of alertEntries ?? []) {
    if (!Number.isFinite(a.deltaPctWoW)) continue; // no prev-week baseline to compare
    const key = `${a.suite}|${a.week}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(a);
  }
  const results = [];
  for (const [key, alerts] of byKey) {
    const [suite, weekStr] = key.split("|");
    const week = Number(weekStr);
    const row = summaryByKey.get(key);
    const csvDelta = row && row.deltaPctWoW !== "" ? Number(row.deltaPctWoW) : null;
    const shardCount = shardsByKey.get(key)?.size ?? 0;
    const alertDeltas = alerts.map((a) => a.deltaPctWoW);
    const allEqual = csvDelta !== null && alertDeltas.every((d) => d === csvDelta);
    let status = "match";
    if (!allEqual) status = shardCount > 1 ? "granularity" : "mismatch";
    results.push({
      suite,
      week,
      year: row?.year ?? alerts[0]?.year ?? null,
      csvDeltaPctWoW: csvDelta,
      alertDeltas,
      shards: alerts.map((a) => a.shard),
      status,
    });
  }
  return results.sort((a, b) => a.suite.localeCompare(b.suite) || (a.year ?? 0) - (b.year ?? 0) || a.week - b.week);
}

// One row per suite+week present in either input, classified by how the
// summary's degradedWoW and the logged WoW alerts agree, plus the deltaPctWoW
// reconciliation (csvDeltaPctWoW / deltaMatch). Returns { csv, summary } —
// the CSV is the human artifact, summary the machine one.
export function buildConsistencyReport(summaryRows, alertEntries, historyEntries = []) {
  const summaryByKey = new Map();
  for (const r of summaryRows) summaryByKey.set(`${r.suite}|${r.week}`, r);
  const alertsByKey = new Map();
  for (const a of alertEntries) {
    const key = `${a.suite}|${a.week}`;
    if (!alertsByKey.has(key)) alertsByKey.set(key, []);
    alertsByKey.get(key).push(a);
  }
  const keys = new Set([...summaryByKey.keys(), ...alertsByKey.keys()]);
  const deltaByKey = new Map(reconcileDeltas(summaryRows, alertEntries, historyEntries).map((d) => [`${d.suite}|${d.week}`, d]));

  const rows = [...keys].map((key) => {
    const [suite, weekStr] = key.split("|");
    const week = Number(weekStr);
    const summary = summaryByKey.get(key);
    const alerts = alertsByKey.get(key) ?? [];
    const woWAlerts = alerts.filter((a) => a.degraded);
    const undeliveredAlerts = alerts.filter((a) => a.delivered === false);
    const delta = deltaByKey.get(key);
    const year = summary?.year ?? alerts[0]?.year ?? null;
    const summaryDegraded = summary ? (summary.degradedWoW ? "DEGRADED" : "") : "NO-ROW";

    const kind = classifyConsistency(summary, alerts);
    // Severity, weighted by the suite's degraded streak (from summarizeEntries):
    // a missed-alert on streak >= 2 means the suite has been DEGRADED for
    // consecutive weeks with NO alert corroboration — much graver than a
    // streak-1 miss. Phantom-alerts are medium (a single week of unconfirmed
    // noise); consistent rows are low.
    const streak = summary?.streak ?? (summary?.degradedWoW ? 1 : 0);
    const severity =
      kind === "missed-alert" ? (streak >= 2 ? "high" : "medium") : kind === "phantom-alert" ? "medium" : "low";
    let detail = "";
    if (kind === "missed-alert") {
      detail = `suite median DEGRADED but no shard WoW alert logged (${alerts.length} non-WoW alert${alerts.length === 1 ? "" : "s"}${streak >= 2 ? `, streak ${streak}` : ""})`;
    } else if (kind === "phantom-alert") {
      detail = `shard WoW alert${woWAlerts.length === 1 ? "" : "s"} without suite-level DEGRADED: ${woWAlerts.map((a) => a.shard || "?").join(",")}`;
    } else if (summary?.degradedWoW) {
      detail = `corroborated by ${woWAlerts.length} shard WoW alert${woWAlerts.length === 1 ? "" : "s"}`;
    } else {
      detail = "no degradation on either side";
    }
    return {
      suite,
      week,
      year,
      summaryDegraded,
      medianMinutes: summary?.medianMinutes ?? "",
      deltaPctWoW: summary?.deltaPctWoW ?? "",
      streak: summary?.streak ?? 0,
      alertsTotal: alerts.length,
      woWAlerts: woWAlerts.length,
      undeliveredAlerts: undeliveredAlerts.length,
      kind,
      severity,
      detail,
      csvDeltaPctWoW: delta?.csvDeltaPctWoW ?? "",
      deltaMatch: delta?.status ?? "",
    };
  }).sort((a, b) => {
    const bySuite = a.suite.localeCompare(b.suite);
    if (bySuite) return bySuite;
    if ((a.year ?? 0) !== (b.year ?? 0)) return (a.year ?? 0) - (b.year ?? 0);
    return a.week - b.week;
  });

  const header = "suite,week,year,summaryDegraded,alertsTotal,woWAlerts,undeliveredAlerts,kind,severity,detail,csvDeltaPctWoW,deltaMatch";
  const csvLines = rows.map((r) =>
    [
      r.suite,
      r.week,
      r.year ?? "",
      r.summaryDegraded,
      r.alertsTotal,
      r.woWAlerts,
      r.undeliveredAlerts,
      r.kind,
      r.severity,
      r.detail,
      r.csvDeltaPctWoW,
      r.deltaMatch,
    ]
      .map(csvEscape)
      .join(","),
  );

  // Separate CSV block for alerts that fired but failed to reach the webhook
  // (delivered=false — webhook down or a rejected URL). One row per alert,
  // marked apart from the suite+week table so a delivery outage is visible
  // without digging into the JSON.
  const undelivered = alertEntries
    .filter((a) => a.delivered === false)
    .sort((a, b) => a.suite.localeCompare(b.suite) || (a.year ?? 0) - (b.year ?? 0) || a.week - b.week || String(a.shard).localeCompare(String(b.shard)))
    .map((a) =>
      [
        a.suite,
        a.week,
        a.year ?? "",
        a.shard,
        a.status,
        a.minutes ?? "",
        a.deltaPctWoW ?? "",
        a.recordedAt,
      ]
        .map(csvEscape)
        .join(","),
    );
  const undeliveredHeader = "suite,week,year,shard,status,minutes,deltaPctWoW,recordedAt";
  const csvBlocks = [header, ...csvLines];
  if (undelivered.length > 0) {
    csvBlocks.push("", `# undelivered alerts (delivered=false — webhook down)`, undeliveredHeader, ...undelivered);
  }

  const counts = {
    consistent: rows.filter((r) => r.kind === "consistent").length,
    missedAlert: rows.filter((r) => r.kind === "missed-alert").length,
    phantomAlert: rows.filter((r) => r.kind === "phantom-alert").length,
    highSeverity: rows.filter((r) => r.severity === "high").length,
    deltaMismatch: rows.filter((r) => r.deltaMatch === "mismatch").length,
    undeliveredAlerts: undelivered.length,
  };
  const deltaDetails = rows
    .filter((r) => r.deltaMatch === "mismatch")
    .map((r) => `${r.suite} ${r.year ?? ""}-W${r.week}: alert payload deltaPctWoW differs from CSV row (csv ${r.csvDeltaPctWoW})`);
  return {
    csv: csvBlocks.join("\n") + "\n",
    summary: {
      event: "nightly_consistency_report",
      ...counts,
      details: rows
        .filter((r) => r.kind !== "consistent")
        .map((r) => `${r.suite} ${r.year ?? ""}-W${r.week}: [${r.severity}] ${r.kind} — ${r.detail}`),
      undeliveredDetails: undelivered.map((u) => {
        const [suite, week, year, shard, status, minutes, deltaPctWoW, recordedAt] = u.split(",");
        return `${suite} ${year}-W${week} shard ${shard} (${status}, ${minutes} min, deltaPctWoW ${deltaPctWoW}) at ${recordedAt}`;
      }),
      deltaDetails,
    },
    rows,
  };
}

export function mdCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

// Markdown for the GitHub job summary — the findings (missed/phantom alerts)
// and the deltaPctWoW reconciliation at a glance, no artifact download.
// Written even when everything is consistent (so the summary always says
// something), mirroring the nightly-trends job summary pattern.
// GitHub job summaries sanitize inline images (data URIs) and <img> tags —
// an embedded SVG only renders when svgUrl points at an external https URL.
// The embed is therefore opt-in: without svgUrl the summary keeps the
// findings/reconciliation/delivery tables and nothing leaves the repo.
export function buildMarkdownSummary(rows, undelivered = [], svgUrl = "") {
  // High-severity findings (missed-alert on streak >= 2) first — the weighted
  // view: a suite degraded for consecutive weeks with NO alert corroboration
  // is the thing to look at first.
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const findings = rows
    .filter((r) => r.kind !== "consistent")
    .sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2));
  const mismatches = rows.filter((r) => r.deltaMatch === "mismatch");
  const lines = ["## Nightly alert-vs-trend consistency", ""];
  lines.push("### Alert-vs-trend findings", "");
  if (!findings.length) {
    lines.push("_No missed-alert or phantom-alert findings — summary and alert log agree._", "");
  } else {
    lines.push("| suite | week | year | kind | severity | detail |", "|---|---|---|---|---|---|");
    for (const r of findings) {
      lines.push(`| ${mdCell(r.suite)} | ${r.week} | ${r.year ?? ""} | ${r.kind} | ${r.severity} | ${mdCell(r.detail)} |`);
    }
    lines.push("");
  }
  lines.push("### deltaPctWoW reconciliation", "");
  if (!mismatches.length) {
    lines.push("_No delta mismatches — alert payload deltas agree with the summary CSV._", "");
  } else {
    lines.push("| suite | week | year | csvDeltaPctWoW | deltaMatch |", "|---|---|---|---|---|");
    for (const r of mismatches) {
      lines.push(`| ${mdCell(r.suite)} | ${r.week} | ${r.year ?? ""} | ${r.csvDeltaPctWoW} | ${r.deltaMatch} |`);
    }
    lines.push("");
  }
  lines.push("### Delivery failures (webhook down)", "");
  if (!undelivered.length) {
    lines.push("_No alerts failed to reach the webhook._", "");
  } else {
    lines.push("| suite | week | year | shard | status | minutes | deltaPctWoW |", "|---|---|---|---|---|---|---|");
    for (const a of undelivered) {
      lines.push(`| ${mdCell(a.suite)} | ${a.week} | ${a.year ?? ""} | ${mdCell(a.shard)} | ${mdCell(a.status)} | ${a.minutes ?? ""} | ${a.deltaPctWoW ?? ""} |`);
    }
    lines.push("");
  }
  if (svgUrl) {
    lines.push("### Consistency chart", "");
    // markdown image with an external https URL renders in the job summary
    // (sanitized summaries strip inline data URIs)
    lines.push(`![Nightly alert-vs-trend consistency chart](${svgUrl})`, "");
  }
  return lines.join("\n");
}

// Bars are colored by SEVERITY (not by kind): high (missed-alert on streak
// >= 2 — the gravest finding) is dark red, medium (streak-1 miss or any
// phantom-alert) is amber, low (consistent) is green. NO-ROW stays gray.
const SEVERITY_COLORS = {
  high: "#b91c1c",
  medium: "#f59e0b",
  low: "#10b981",
};

// Self-contained SVG bar chart of the alert-vs-trend consistency per
// suite+week — no external dependencies, no JS, no remote fonts. One bar per
// suite+week row, colored by its SEVERITY (dark red = high, amber = medium,
// green = low), height proportional to the week's alert count; a thin neutral
// stub marks weeks with zero alerts so the full history is visible. Bars for a
// missing suite-week are gray NO-ROW stubs, so the gravest findings (high =
// missed-alert on streak >= 2) stand out at a glance next to the low green
// majority.
export function buildConsistencySvg(rows) {
  const W = 860;
  const H = 480; // 440 + 40: the marker legend row below the x-axis labels
  const mL = 64;
  const mR = 24;
  const mT = 68; // title + two legend rows above the plot
  const mB = 84; // x labels + marker legend row below the plot
  const plotW = W - mL - mR;
  const plotH = H - mT - mB;

  const xKeys = [];
  const seen = new Set();
  for (const r of rows) {
    const key = `${r.suite}|${r.year}|${r.week}`;
    if (!seen.has(key)) {
      seen.add(key);
      xKeys.push({ suite: r.suite, year: r.year, week: r.week });
    }
  }
  xKeys.sort((a, b) => a.suite.localeCompare(b.suite) || (a.year ?? 0) - (b.year ?? 0) || a.week - b.week);
  const xOf = new Map(xKeys.map((k, i) => [`${k.suite}|${k.year}|${k.week}`, i]));
  const yMax = Math.max(3, Math.max(1, ...rows.map((r) => r.alertsTotal ?? 0)));
  const x = (i) => (xKeys.length === 1 ? mL + plotW / 2 : mL + (plotW * i) / (xKeys.length - 1));
  const y = (v) => mT + plotH - (plotH * v) / yMax;
  const slot = xKeys.length > 1 ? plotW / (xKeys.length - 1) : plotW;
  const barW = Math.min(48, slot * 0.6);

  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, sans-serif">`];
  const title = xKeys.length
    ? `Alert-vs-trend consistency per suite+week — ${xKeys[0].year}-W${xKeys[0].week} to ${xKeys[xKeys.length - 1].year}-W${xKeys[xKeys.length - 1].week}`
    : "Alert-vs-trend consistency per suite+week";
  parts.push(`<text x="${mL}" y="20" font-size="14" font-weight="600" fill="#111827">${xmlEscape(title)}</text>`);

  if (!rows.length) {
    parts.push(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#6b7280">No consistency data yet</text>`);
    parts.push("</svg>");
    return parts.join("\n");
  }

  // gridlines + y labels
  const yTicks = 4;
  for (let t = 1; t <= yTicks; t++) {
    const val = Math.round((yMax * t) / yTicks);
    if (val <= 0) continue;
    const yy = y(val);
    parts.push(`<line x1="${mL}" y1="${yy}" x2="${W - mR}" y2="${yy}" stroke="#e5e7eb" stroke-width="1"/>`);
    parts.push(`<text x="${mL - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#6b7280">${val}</text>`);
  }

  // x labels (at most ~12 ticks; year suffix when the data spans years). The
  // suite name rides along since each slot is a suite+week pair.
  const multiYear = new Set(xKeys.map((k) => k.year)).size > 1;
  const tickStep = Math.max(1, Math.ceil(xKeys.length / 12));
  for (let i = 0; i < xKeys.length; i++) {
    if (i % tickStep !== 0 && i !== xKeys.length - 1) continue;
    const suiteLabel = String(xKeys[i].suite).length > 12 ? `${String(xKeys[i].suite).slice(0, 11)}…` : String(xKeys[i].suite);
    const weekLabel = multiYear ? `W${xKeys[i].week}'${String(xKeys[i].year).slice(2)}` : `W${xKeys[i].week}`;
    parts.push(`<text x="${x(i)}" y="${H - mB + 12}" text-anchor="middle" font-size="10" fill="#6b7280">${xmlEscape(suiteLabel)}</text>`);
    parts.push(`<text x="${x(i)}" y="${H - mB + 26}" text-anchor="middle" font-size="10" fill="#6b7280">${weekLabel}</text>`);
  }

  // axes
  parts.push(`<line x1="${mL}" y1="${mT + plotH}" x2="${W - mR}" y2="${mT + plotH}" stroke="#9ca3af" stroke-width="1"/>`);
  parts.push(`<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${mT + plotH}" stroke="#9ca3af" stroke-width="1"/>`);

  // hatch pattern for the undelivered (webhook down) segment — self-contained,
  // no external deps, visually distinct from the flat kind colors.
  parts.push(
    "<defs>",
    "<pattern id=\"undelivered-hatch\" width=\"6\" height=\"6\" patternUnits=\"userSpaceOnUse\" patternTransform=\"rotate(45)\">",
    "<rect width=\"6\" height=\"6\" fill=\"#7f1d1d\"/>",
    "<line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"6\" stroke=\"#fecaca\" stroke-width=\"2\"/>",
    "</pattern>",
    "</defs>",
  );

  // bars
  const baseline = mT + plotH;
  for (const r of rows) {
    const i = xOf.get(`${r.suite}|${r.year}|${r.week}`);
    if (i === undefined) continue;
    const cx = x(i);
    const total = Math.max(r.alertsTotal ?? 0, 0);
    const undelivered = Math.min(Math.max(r.undeliveredAlerts ?? 0, 0), total);
    const delivered = total - undelivered;
    const color = r.summaryDegraded === "NO-ROW" ? "#d1d5db" : (SEVERITY_COLORS[r.severity] ?? "#10b981");
    // Accessible <title> on every bar: screen readers and static SVG
    // inspection (hover tooltip in browsers, tree in viewers) show suite /
    // week / median / deltaPctWoW / streak / kind / severity / alerts
    // without needing the CSV.
    const medianLabel = r.medianMinutes === undefined || r.medianMinutes === null || r.medianMinutes === "" ? "n/a" : `${r.medianMinutes} min`;
    const deltaLabel =
      r.deltaPctWoW === undefined || r.deltaPctWoW === null || r.deltaPctWoW === ""
        ? "no adjacent baseline"
        : `${r.deltaPctWoW >= 0 ? "+" : ""}${r.deltaPctWoW}% vs prev. week`;
    const alertsLabel = `${total} alert${total === 1 ? "" : "s"}`;
    const undeliveredLabel = undelivered > 0 ? `, ${undelivered} undelivered` : "";
    const titleText = `${r.suite} ${r.year}-W${r.week} — ${r.kind} (severity ${r.severity ?? "low"}, ${alertsLabel}${undeliveredLabel}${medianLabel === "n/a" ? "" : `, median ${medianLabel}`}, ${deltaLabel}, streak ${r.streak ?? 0})`;

    if (total === 0) {
      // zero-alert weeks get a thin stub
      parts.push(`<rect x="${cx - barW / 2}" y="${baseline - 2}" width="${barW}" height="2" fill="${color}" opacity="0.35"><title>${xmlEscape(titleText)}</title></rect>`);
      continue;
    }
    // Delivered segment (bottom) in the kind color.
    const deliveredTop = y(Math.max(delivered, 1));
    parts.push(`<rect x="${cx - barW / 2}" y="${deliveredTop}" width="${barW}" height="${Math.max(2, baseline - deliveredTop)}" fill="${color}" opacity="0.9"><title>${xmlEscape(titleText)}</title></rect>`);
    if (undelivered > 0) {
      // Undelivered (webhook down) segment stacked on top, hatched.
      const undeliveredTop = y(total);
      parts.push(`<rect x="${cx - barW / 2}" y="${undeliveredTop}" width="${barW}" height="${Math.max(2, deliveredTop - undeliveredTop)}" fill="url(#undelivered-hatch)" opacity="0.95"><title>${xmlEscape(titleText)}</title></rect>`);
    }
    parts.push(`<text x="${cx}" y="${y(total) - 6}" text-anchor="middle" font-size="10" fill="#374151">${total}</text>`);
  }

  // legend — two rows (5 entries at ~205px each would overflow the 860px
  // canvas): row 1 = the three severity colors + NO-ROW, row 2 = the
  // undelivered segment. Below the title, above the plot.
  const legendRows = [
    [
      ["#b91c1c", "high severity"],
      ["#f59e0b", "medium severity"],
      ["#10b981", "low severity"],
      ["#d1d5db", "NO-ROW (no suite data)"],
    ],
    [["url(#undelivered-hatch)", "undelivered (webhook down)"]],
  ];
  legendRows.forEach((row, ri) => {
    row.forEach(([fill, label], li) => {
      const lx = mL + li * 205;
      const ly = 26 + ri * 18; // below the title (y=20), above the plot (mT=68)
      parts.push(`<rect x="${lx}" y="${ly}" width="12" height="12" fill="${fill}"/>`);
      parts.push(`<text x="${lx + 18}" y="${ly + 10}" font-size="12" fill="#374151">${xmlEscape(label)}</text>`);
    });
  });

  // marker legend — the four bar styles at a glance, drawn BELOW the x-axis
  // labels (the canvas is 480px tall for this row), matching the exact colors
  // the plot uses so the swatches and the bars can't drift. Same pattern as
  // the trends SVG marker legend.
  const markerY = H - 34;
  const markerX0 = mL + 12;
  const barMarkers = [
    ["#b91c1c", "high (missed-alert, streak ≥ 2)"],
    ["#f59e0b", "medium (streak-1 miss / phantom)"],
    ["#10b981", "low (consistent)"],
    ["#d1d5db", "NO-ROW (no suite data)"],
  ];
  barMarkers.forEach(([fill, label], bi) => {
    const lx = markerX0 + bi * 205;
    parts.push(`<rect x="${lx}" y="${markerY - 14}" width="12" height="16" fill="${fill}" opacity="0.9"/>`);
    parts.push(`<text x="${lx + 16}" y="${markerY + 4}" font-size="11" fill="#374151">${xmlEscape(label)}</text>`);
  });

  parts.push("</svg>");
  return parts.join("\n");
}

export async function main(options = {}) {
  const env = options.env ?? process.env;
  // Two-phase run for the presigned-URL embed (mirrors nightly-trends): the
  // SVG only exists after the first pass, so the summary must wait for the
  // presigned URL. CONSISTENCY_DEFER_SUMMARY=1 (phase 1) skips the summary
  // write; a separate step uploads the SVG to a private bucket and presigns
  // it, then phase 2 (CONSISTENCY_SUMMARY_ONLY=1) rewrites ONLY the summary
  // with the URL. Without the defer flag the single-pass behavior is unchanged.
  const deferSummary = env.CONSISTENCY_DEFER_SUMMARY === "1";
  const summaryOnly = env.CONSISTENCY_SUMMARY_ONLY === "1";
  const historyDir = env.CONSISTENCY_HISTORY_DIR ?? ".nightly-history";
  const csvPath = env.CONSISTENCY_CSV ?? "nightly-consistency.csv";
  const jsonPath = env.CONSISTENCY_JSON ?? "nightly-consistency.json";
  const svgPath = env.CONSISTENCY_SVG ?? "nightly-consistency.svg";

  const entries = await collectEntries(historyDir);
  const summaryRows = summarizeEntries(entries);
  const alertEntries = await collectAlertEntries(join(historyDir, "alerts"));
  const report = buildConsistencyReport(summaryRows, alertEntries, entries);
  const undelivered = alertEntries.filter((a) => a.delivered === false);

  // Phase 1 writes the evidence artifacts; the summary-only pass (phase 2)
  // recomputes the report from the same history and writes only the summary,
  // so the embed carries the presigned URL without touching the CSV/JSON/SVG
  // or re-running the gate (already decided in phase 1).
  if (!summaryOnly) {
    writeFileSync(csvPath, report.csv);
    writeFileSync(jsonPath, `${JSON.stringify(report.summary, null, 2)}\n`);
    writeFileSync(svgPath, buildConsistencySvg(report.rows));
  }

  // Fail-loud sustained-phantom gate: CSVs/JSON are written first so the
  // evidence is on disk even when the run exits 1.
  const minPhantom = parseMinConsecutive(env.CONSISTENCY_MIN_CONSECUTIVE_PHANTOM, 2);
  const phantomRuns = findSustainedPhantom(report.rows, minPhantom);

  // GitHub job summary (best-effort): CONSISTENCY_SUMMARY_MD wins, else the
  // GITHUB_STEP_SUMMARY path Actions provides in every step. Skipped in phase
  // 1 of the two-phase embed flow (the presigned URL is not known yet).
  if (!deferSummary) {
    const summaryMdPath = env.CONSISTENCY_SUMMARY_MD ?? env.GITHUB_STEP_SUMMARY ?? "";
    const svgUrl = env.CONSISTENCY_SVG_PUBLIC_URL ?? "";
    if (summaryMdPath) {
      try {
        appendFileSync(summaryMdPath, buildMarkdownSummary(report.rows, undelivered, svgUrl) + "\n");
      } catch (error) {
        // INTENTIONAL SILENCE: job summary is best-effort display sugar.
        console.error(JSON.stringify({ event: "nightly_consistency_summary_write_failed", reason: String(error) }));
      }
    }
  }
  console.error(JSON.stringify({
    ...report.summary,
    rows: report.csv.trim().split("\n").length - (report.csv.trim() ? 1 : 0),
    minConsecutivePhantom: minPhantom,
    sustainedPhantom: phantomRuns,
    csv: csvPath,
    json: jsonPath,
    svg: svgPath,
  }));
  // Summary-only pass (phase 2 of the presigned-URL embed flow): the gate was
  // already decided in phase 1 — this pass only rewrites the summary with the
  // presigned URL, so it must never change the exit code.
  if (summaryOnly) return 0;
  if (phantomRuns.length > 0) {
    console.error(JSON.stringify({
      event: "nightly_consistency_sustained_phantom",
      detail: phantomRuns.map((r) =>
        `${r.suite}: ${r.count} consecutive phantom-alert weeks (${r.weeks.map((w) => `${w.year}-W${w.week}`).join(", ")}) — possible degradation-criterion bug`,
      ),
    }));
    return 1;
  }
  return 0;
}

const IS_CLI = Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
if (IS_CLI) {
  main().then((code) => {
    process.exitCode = code;
  });
}
