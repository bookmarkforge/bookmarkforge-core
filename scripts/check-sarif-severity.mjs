#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Severity gate for the independent SAST layer (CodeQL + Semgrep).
//
// Reads SARIF 2.1.0 output (a file or a directory of files) and exits 1 when
// any finding is at or above its threshold. Thresholds can be global
// (--min-severity) or per tool (--min-severity-for <tool>=<severity>).
// Severity is taken from `properties["security-severity"]` (CodeQL) or
// mapped from `level` (error -> high, warning -> medium, note -> low).
// A result that carries no severity information is treated as BLOCKING:
// a scanner that cannot classify a finding must not be able to silently
// pass (fail-closed, same policy as the ZAP threshold in dast-nightly.yml).
//
// --baseline <file> loads a JSON list of approved findings that are ignored.
// Entries match by tool/ruleId/file (and optionally line); every entry must
// be explicitly approved (`approved: true`) with a non-empty justification.
// Stale entries (no matching finding) are reported so the baseline can be
// pruned when a finding is fixed.

export const SEVERITY_RANK = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export function classifySeverity(result) {
  const property = result?.properties?.["security-severity"];
  if (typeof property === "string") {
    const severity = property.toLowerCase();
    if (severity in SEVERITY_RANK) return severity;
  }
  switch (result?.level) {
    case "error":
      return "high";
    case "warning":
      return "medium";
    case "note":
      return "low";
    default:
      return "unknown";
  }
}

export function isBlocking(severity, minSeverity) {
  if (severity === "unknown") return true; // fail-closed
  if (!(severity in SEVERITY_RANK) || !(minSeverity in SEVERITY_RANK)) return true;
  return SEVERITY_RANK[severity] <= SEVERITY_RANK[minSeverity];
}

export function collectFindings(sarif) {
  const findings = [];
  for (const run of sarif?.runs ?? []) {
    const toolName = run?.tool?.driver?.name ?? "unknown tool";
    for (const result of run?.results ?? []) {
      const location = result?.locations?.[0]?.physicalLocation ?? {};
      findings.push({
        severity: classifySeverity(result),
        ruleId: result?.ruleId ?? "(unknown rule)",
        file: location?.artifactLocation?.uri ?? "(unknown file)",
        line: location?.region?.startLine ?? null,
        message: result?.message?.text ?? "",
        toolName,
      });
    }
  }
  return findings;
}

export function normalizePath(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

export function resolveThreshold(thresholds, toolName) {
  const perTool = thresholds?.byTool?.[String(toolName ?? "").toLowerCase()];
  return perTool ?? thresholds?.global ?? "high";
}

export function isBlockingFor(finding, thresholds) {
  return isBlocking(finding.severity, resolveThreshold(thresholds, finding.toolName));
}

export function analyzeSarifWithPolicy(sarif, thresholds) {
  const findings = collectFindings(sarif);
  const blocking = findings.filter((finding) => isBlockingFor(finding, thresholds));
  return { findings, blocking };
}

export function analyzeSarif(sarif, minSeverity) {
  return analyzeSarifWithPolicy(sarif, { global: minSeverity });
}

export function loadSarifFiles(target) {
  if (!existsSync(target)) {
    throw new Error(`SARIF path does not exist: ${target}`);
  }
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target)
    .filter((name) => name.toLowerCase().endsWith(".sarif"))
    .map((name) => join(target, name))
    .sort();
}

export function parseBaseline(text) {
  let entries;
  try {
    entries = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid baseline JSON: ${error.message}`);
  }
  if (!Array.isArray(entries)) throw new Error("baseline must be an array of entries");
  for (const entry of entries) {
    if (typeof entry?.ruleId !== "string" || !entry.ruleId) {
      throw new Error("baseline: every entry requires ruleId (string)");
    }
    if (typeof entry?.file !== "string" || !entry.file) {
      throw new Error(`baseline: entry '${entry?.ruleId ?? "?"}' requires file (string)`);
    }
    if (entry.approved !== true) {
      throw new Error(`baseline: entry '${entry.ruleId}' must have approved: true to take effect`);
    }
    if (typeof entry?.justification !== "string" || !entry.justification.trim()) {
      throw new Error(`baseline: entry '${entry.ruleId}' requires a non-empty justification`);
    }
  }
  return entries;
}

export function matchesBaselineEntry(finding, entry) {
  if (entry.tool && String(entry.tool).toLowerCase() !== String(finding.toolName).toLowerCase()) return false;
  if (entry.ruleId !== finding.ruleId) return false;
  if (normalizePath(entry.file) !== normalizePath(finding.file)) return false;
  if (entry.line != null && entry.line !== finding.line) return false;
  return true;
}

export function applyBaseline(findings, entries) {
  const remaining = [];
  const ignored = [];
  for (const finding of findings) {
    const match = entries.find((entry) => matchesBaselineEntry(finding, entry));
    if (match) ignored.push(finding);
    else remaining.push(finding);
  }
  const stale = entries.filter((entry) => !findings.some((finding) => matchesBaselineEntry(finding, entry)));
  return { remaining, ignored, stale };
}

function renderRows(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, col) => Math.max(...all.map((row) => String(row[col] ?? "").length)));
  return all.map((row) => row.map((cell, col) => String(cell ?? "").padEnd(widths[col])).join("  ").trimEnd());
}

export function buildSummaryTable(stats) {
  const rows = stats.map(({ tool, threshold, total, blocking }) => [
    tool,
    threshold,
    String(total),
    String(blocking),
    blocking > 0 ? "FAIL" : "PASS",
  ]);
  return renderRows(["Tool", "Threshold", "Findings", "Blocking", "Status"], rows);
}

export function buildFindingsTable(findings) {
  const rows = findings.map((finding) => [
    finding.severity,
    `${finding.ruleId} (${finding.toolName})`,
    finding.line != null ? `${finding.file}:${finding.line}` : finding.file,
  ]);
  return renderRows(["Severity", "Rule (tool)", "Location"], rows);
}

function formatFinding(finding) {
  const at = finding.line != null ? `${finding.file}:${finding.line}` : finding.file;
  const message = finding.message ? ` — ${finding.message}` : "";
  return `- [${finding.severity}] ${finding.ruleId} (${finding.toolName}) ${at}${message}`;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const fail = (message) => {
    console.error(`[check-sarif-severity] FAIL: ${message}`);
    process.exit(1);
  };

  const args = process.argv.slice(2);
  let globalSeverity = "high";
  const byTool = {};
  let format = "text";
  let baselinePath = null;
  const paths = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--min-severity") {
      globalSeverity = ((args[i + 1] ?? "").toLowerCase() || "high");
      i += 1;
    } else if (arg === "--min-severity-for") {
      const spec = args[i + 1] ?? "";
      const eq = spec.indexOf("=");
      if (eq === -1) fail(`--min-severity-for espera <tool>=<severity>, recibido: '${spec}'`);
      const tool = spec.slice(0, eq).trim().toLowerCase();
      const severity = spec.slice(eq + 1).trim().toLowerCase();
      if (!tool || !(severity in SEVERITY_RANK)) {
        fail(`invalid --min-severity-for: '${spec}' (severity: critical|high|medium|low)`);
      }
      byTool[tool] = severity;
      i += 1;
    } else if (arg === "--format") {
      format = (args[i + 1] ?? "text").toLowerCase();
      if (!["text", "table"].includes(format)) fail(`invalid --format: '${format}' (text|table)`);
      i += 1;
    } else if (arg === "--baseline") {
      baselinePath = args[i + 1];
      if (!baselinePath) fail("--baseline requires a path");
      i += 1;
    } else if (!arg.startsWith("--")) {
      paths.push(arg);
    }
  }
  if (paths.length !== 1) fail("expected exactly one SARIF file or directory");
  if (!(globalSeverity in SEVERITY_RANK)) {
    fail(`invalid --min-severity '${globalSeverity}' (critical|high|medium|low)`);
  }

  let baselineEntries = null;
  if (baselinePath) {
    if (!existsSync(baselinePath)) fail(`baseline no existe: ${baselinePath}`);
    let text;
    try {
      text = readFileSync(baselinePath, "utf8");
    } catch (error) {
      fail(`could not read the baseline: ${error.message}`);
    }
    try {
      baselineEntries = parseBaseline(text);
    } catch (error) {
      fail(error.message);
    }
  }

  let files;
  try {
    files = loadSarifFiles(paths[0]);
  } catch (error) {
    fail(error.message);
  }
  if (files.length === 0) fail(`no .sarif files found in ${paths[0]}`);

  const allFindings = [];
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      fail(`invalid SARIF JSON in ${file}: ${error.message}`);
    }
    allFindings.push(...collectFindings(parsed));
  }

  let findings = allFindings;
  let ignored = [];
  let stale = [];
  if (baselineEntries) {
    const result = applyBaseline(findings, baselineEntries);
    findings = result.remaining;
    ignored = result.ignored;
    stale = result.stale;
  }

  const thresholds = { global: globalSeverity, byTool };
  const blocking = findings.filter((finding) => isBlockingFor(finding, thresholds));

  if (format === "table") {
    console.log("[check-sarif-severity] Findings (after baseline):");
    if (findings.length) console.log(buildFindingsTable(findings).join("\n"));
    else console.log("  (ninguno)");
    const tools = [...new Set(allFindings.map((finding) => finding.toolName))].sort();
    const stats = tools.map((tool) => ({
      tool,
      threshold: resolveThreshold(thresholds, tool),
      total: allFindings.filter((finding) => finding.toolName === tool).length,
      blocking: blocking.filter((finding) => finding.toolName === tool).length,
    }));
    console.log("\n[check-sarif-severity] Summary per tool:");
    if (stats.length) console.log(buildSummaryTable(stats).join("\n"));
    else console.log("  (sin hallazgos)");
  } else if (findings.length) {
    console.log(`[check-sarif-severity] ${findings.length} finding(s) across ${files.length} SARIF file(s):`);
    for (const finding of findings) {
      console.log(`  ${formatFinding(finding)}`);
    }
  } else if (allFindings.length) {
    console.log(`[check-sarif-severity] ${allFindings.length} finding(s), all ignored by baseline`);
  } else {
    console.log(`[check-sarif-severity] no findings across ${files.length} SARIF file(s)`);
  }

  if (ignored.length) {
    console.log(`[check-sarif-severity] ${ignored.length} finding(s) ignored by baseline (approved)`);
  }
  if (stale.length) {
    console.warn(
      `[check-sarif-severity] aviso: ${stale.length} entrada(s) de baseline sin hallazgo coincidente (revisar/limpiar):`,
    );
    for (const entry of stale) {
      console.warn(`  - ${entry.ruleId} @ ${entry.file}${entry.line != null ? `:${entry.line}` : ""}`);
    }
  }

  if (blocking.length) {
    console.error(
      `[check-sarif-severity] FAIL: ${blocking.length} blocking finding(s) (${findings.length} after baseline, global threshold '${globalSeverity}')`,
    );
    process.exit(1);
  }
  console.log(
    `[check-sarif-severity] passed — 0 blocking findings (${findings.length} after baseline, global threshold '${globalSeverity}')`,
  );
}
