/**
 * Render webrtc-recovery-history.json as a self-contained HTML trend page.
 *
 * The page embeds the history as inline JSON and draws SVG line charts with
 * plain JavaScript — no CDN scripts, React, Recharts, or build step, so it
 * renders offline in any browser. Open the output file directly.
 *
 * Usage:
 *   node scripts/render-webrtc-recovery-charts.mjs
 *   node scripts/render-webrtc-recovery-charts.mjs --history webrtc-recovery-history.json --output webrtc-recovery-charts.html
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const DEFAULT_HISTORY_FILE = resolve(ROOT, "webrtc-recovery-history.json");
const DEFAULT_OUTPUT_FILE = resolve(ROOT, "webrtc-recovery-charts.html");

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

/** Build the chart-ready datasets from the history document. */
export function buildChartData(history) {
  const runs = (history?.runs ?? []).map((run) => ({
    timestamp: run.timestamp,
    status: run.status,
    recoveryMs: run.summary?.averageRecoveryMs ?? null,
    maxRecoveryMs: run.summary?.maxRecoveryMs ?? null,
    interruptionAvg: run.summary?.phaseLatency?.average?.interruptionObservedMs ?? null,
    persistenceAvg: run.summary?.phaseLatency?.average?.persistenceFinishedMs ?? null,
    retryAvg: run.summary?.phaseLatency?.average?.retryStartedMs ?? null,
    completionAvg: run.summary?.phaseLatency?.average?.completedMs ?? null,
    convergedCases: run.summary?.convergedCases ?? null,
  }));

  const caseNames = [
    ...new Set(
      (history?.runs ?? []).flatMap((run) =>
        (run.cases ?? []).map((c) => c.caseId),
      ),
    ),
  ];
  const byCase = caseNames.map((caseId) => ({
    caseId,
    points: (history?.runs ?? [])
      .flatMap((run) =>
        (run.cases ?? [])
          .filter((c) => c.caseId === caseId)
          .map((c) => ({
            timestamp: run.timestamp,
            recoveryMs: c.recoveryMs,
            converged: c.converged,
          })),
      )
      .filter((point) => point.recoveryMs !== null),
  }));

  return { runs, byCase };
}

const EMBEDDED_SCRIPT = `const runs = __RUNS_JSON__;
const byCase = __BY_CASE_JSON__;

const fmtMs = (v) => (v === null || v === undefined ? "—" : Math.round(v) + " ms");
const dateLabel = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

function svgChart(series) {
  // series: [{ name, color, values: (number|null)[] }] aligned to runs[]
  if (runs.length === 0) return "";
  const W = 900, H = 220, PAD = { top: 12, right: 64, bottom: 30, left: 56 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const all = series.flatMap((s) => s.values).filter((v) => v !== null && Number.isFinite(v));
  if (all.length === 0) return "<p>No numeric data recorded yet.</p>";
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 50; max += 50; }
  const pad = (max - min) * 0.1;
  min = Math.max(0, min - pad);
  max = max + pad;
  const x = (i) => PAD.left + (runs.length === 1 ? iw / 2 : (i / (runs.length - 1)) * iw);
  const y = (v) => PAD.top + ih - ((v - min) / (max - min)) * ih;
  let out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="recovery trend" style="max-width:100%;height:auto">';
  for (let step = 0; step <= 5; step += 1) {
    const value = min + ((max - min) * step) / 5;
    const yy = y(value);
    out += '<line x1="' + PAD.left + '" y1="' + yy + '" x2="' + (W - PAD.right) + '" y2="' + yy + '" stroke="#eaeef2" stroke-width="1"/>';
    out += '<text x="' + (PAD.left - 6) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="10" fill="#57606a">' + Math.round(value) + '</text>';
  }
  for (let i = 0; i < runs.length; i += 1) {
    if (runs.length > 1 && i % Math.ceil(runs.length / 6) !== 0 && i !== runs.length - 1) continue;
    out += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="9" fill="#57606a">' + dateLabel(runs[i].timestamp) + '</text>';
  }
  for (const s of series) {
    const pts = [];
    for (let i = 0; i < runs.length; i += 1) {
      const v = s.values[i];
      if (v === null || !Number.isFinite(v)) continue;
      pts.push(x(i).toFixed(1) + ',' + y(v).toFixed(1));
    }
    if (pts.length > 0) {
      out += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    }
  }
  out += '</svg>';
  out += '<div class="legend">' + series.map((s) => '<span><span class="swatch" style="background:' + s.color + '"></span>' + s.name + '</span>').join('') + '</div>';
  return out;
}

function summaryText() {
  if (runs.length === 0) return "No runs recorded yet. Run the nightly WebRTC suite, the summary step, and scripts/webrtc-recovery-history.mjs first.";
  const latest = runs[runs.length - 1];
  return "Runs recorded: " + runs.length +
    " · latest " + dateLabel(latest.timestamp) +
    " (" + latest.status + ") · avg recovery " + fmtMs(latest.recoveryMs) +
    " · max " + fmtMs(latest.maxRecoveryMs) +
    " · converged " + latest.convergedCases + " case(s)";
}

document.getElementById("summary").textContent = summaryText();

document.getElementById("phase-chart").innerHTML = svgChart([
  { name: "avg recovery", color: "#1a7f37", values: runs.map((r) => r.recoveryMs) },
  { name: "max recovery", color: "#cf222e", values: runs.map((r) => r.maxRecoveryMs) },
  { name: "avg interruption", color: "#9a6700", values: runs.map((r) => r.interruptionAvg) },
  { name: "avg retry start", color: "#8250df", values: runs.map((r) => r.retryAvg) },
  { name: "avg completion", color: "#0969da", values: runs.map((r) => r.completionAvg) },
]);

const caseCharts = document.getElementById("case-charts");
for (const item of byCase) {
  if (item.points.length === 0) continue;
  const box = document.createElement("div");
  box.className = "card";
  const title = document.createElement("h2");
  title.textContent = "Recovery per case: " + item.caseId;
  box.appendChild(title);
  const chart = document.createElement("div");
  const aligned = runs.map((run) => {
    const point = item.points.find((p) => p.timestamp === run.timestamp);
    return point ? point.recoveryMs : null;
  });
  chart.innerHTML = svgChart([
    { name: "recovery", color: "#1a7f37", values: aligned },
  ]);
  box.appendChild(chart);
  caseCharts.appendChild(box);
}

const table = document.getElementById("runs-table");
const head = document.createElement("thead");
head.innerHTML = "<tr><th>Run</th><th>Status</th><th>Avg recovery</th><th>Max recovery</th><th>Avg interruption</th><th>Avg retry</th><th>Avg completion</th><th>Converged cases</th></tr>";
table.appendChild(head);
const body = document.createElement("tbody");
for (const run of runs) {
  const row = document.createElement("tr");
  row.innerHTML =
    "<td>" + dateLabel(run.timestamp) + "</td>" +
    "<td>" + run.status + "</td>" +
    "<td>" + fmtMs(run.recoveryMs) + "</td>" +
    "<td>" + fmtMs(run.maxRecoveryMs) + "</td>" +
    "<td>" + fmtMs(run.interruptionAvg) + "</td>" +
    "<td>" + fmtMs(run.retryAvg) + "</td>" +
    "<td>" + fmtMs(run.completionAvg) + "</td>" +
    "<td>" + (run.convergedCases ?? "—") + "</td>";
  body.appendChild(row);
}
table.appendChild(body);
`;

function buildHtml(data) {
  const { runs, byCase } = data;
  const runsJson = JSON.stringify(runs);
  const byCaseJson = JSON.stringify(byCase);
  const scriptBody = EMBEDDED_SCRIPT
    .replaceAll("__RUNS_JSON__", runsJson)
    .replaceAll("__BY_CASE_JSON__", byCaseJson);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>WebRTC recovery trend</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; color: #1f2328; background: #fff; }
  h1 { font-size: 20px; }
  h2 { font-size: 15px; margin-top: 24px; }
  .card { border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; margin: 12px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 12px; }
  th, td { border: 1px solid #d0d7de; padding: 4px 8px; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  .legend { font-size: 12px; color: #57606a; margin-top: 6px; }
  .legend span { display: inline-block; margin-right: 14px; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }
</style>
</head>
<body>
<h1>WebRTC recovery trend (nightly)</h1>
<div class="card" id="summary"></div>
<div class="card" id="phase-chart"></div>
<div id="case-charts"></div>
<table id="runs-table"></table>
<script>
${scriptBody}
</script>
</body>
</html>
`;
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const historyFile = resolve(ROOT, optionValue("--history", DEFAULT_HISTORY_FILE));
  const outputFile = resolve(ROOT, optionValue("--output", DEFAULT_OUTPUT_FILE));
  if (!existsSync(historyFile)) {
    console.error(
      `[render-webrtc-recovery-charts] ${historyFile} missing — run scripts/webrtc-recovery-history.mjs first`,
    );
    process.exit(1);
  }
  const history = JSON.parse(readFileSync(historyFile, "utf8"));
  const data = buildChartData(history);
  writeFileSync(outputFile, buildHtml(data), "utf8");
  console.log(
    `[render-webrtc-recovery-charts] wrote ${outputFile} (${data.runs.length} run(s), ${data.byCase.length} case series)`,
  );
}
