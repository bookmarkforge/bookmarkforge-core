#!/usr/bin/env node
/**
 * scripts/check-direct-cve.mjs — vulnerability vigilance for the DECLARED
 * dependency tree, with a report that says whose problem each advisory is.
 *
 * `npm audit` answers "is anything vulnerable?" but not "is it mine to fix?".
 * That question is what decides whether a PR can move on, and today it is
 * answered by hand-reading the tree. `check-override-cve.mjs` covers the
 * versions we hand-picked (`overrides`); this gate covers everything else:
 *
 *   own        the vulnerable package is one package.json declares — our
 *              manifest line, so a bump is one edit we own outright.
 *   inherited  it only arrives through something we declare. The report names
 *              the direct dependenc(ies) it comes through, so the lever is
 *              visible instead of buried under "transitive".
 *
 * Each advisory also gets the smallest action that clears it: refresh the
 * lockfile when a parent's declared range already admits the fix, else bump the
 * parent, else bump our own declaration, else an `overrides` pin (which
 * check-override-cve then audits). "Minimal" means the lowest published version
 * outside the advisory range, not the latest.
 *
 * Modes:
 *   node scripts/check-direct-cve.mjs                       # gate (own + inherited)
 *   node scripts/check-direct-cve.mjs --include-dev         # gate, dev advisories too
 *   node scripts/check-direct-cve.mjs --report [path.md]    # write the report (no gate)
 *   node scripts/check-direct-cve.mjs --report --step-summary # …and append it to $GITHUB_STEP_SUMMARY
 *   node scripts/check-direct-cve.mjs --update-baseline     # prune stale acceptances
 *   node scripts/check-direct-cve.mjs --accept GHSA-… --reason "why"   # accept one
 *
 * Options: --audit-level <info|low|moderate|high|critical> (default: high),
 *          --audit-json <path> (offline; reuse a saved `npm audit --json`),
 *          --offline (no registry metadata; levers degrade honestly),
 *          --step-summary (append the rendered report to $GITHUB_STEP_SUMMARY),
 *          --json (machine-readable), --baseline <path>.
 *
 * The gate is silent when the tree is clean (one ok line), which is exactly
 * when the own/inherited classification is most worth reading. `--step-summary`
 * is how the weekly nightly publishes it: the report lands in the run summary
 * and as a durable artifact, whether or not the gate had anything to say.
 *
 * FAIL CLOSED: if `npm audit` cannot run, if its payload has no
 * `vulnerabilities` map, or if the lockfile/package.json is unreadable, the gate
 * exits 2. "Audit unavailable" is not evidence that the tree is clean. The
 * summary write is the one deliberate exception: it is display sugar over an
 * artifact that is already on disk, so a summary failure is logged, not fatal.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getAuditPayload } from "./npm-audit-payload.mjs";

// Shared single-acquisition audit (see npm-audit-payload.mjs). The alias
// keeps the historical export name for tests and consumers.
export { getAuditPayload as runNpmAudit };
import {
  SEVERITIES,
  buildReport,
  classifyAdvisories,
  describeLever,
  evaluateDirectCve,
  fetchRegistryMetadata,
  meetsLevel,
  proposeBump,
  renderMarkdown,
} from "./dependency-cve-core.mjs";

const ROOT = process.cwd();
const TAG = "[check-direct-cve]";
const BASELINE_PATH = join(ROOT, "scripts", "direct-cve-baseline.json");
const DEFAULT_REPORT_PATH = join(ROOT, "dependency-cve-report.md");



function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found at ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) return { updatedAt: null, profile: null, accepted: [] };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    updatedAt: parsed?.updatedAt ?? null,
    profile: parsed?.profile ?? null,
    accepted: Array.isArray(parsed?.accepted) ? parsed.accepted : [],
  };
}

function saveBaseline(baseline, path = BASELINE_PATH) {
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
}

/**
 * Classify the audit payload with the proposals attached. Registry metadata is
 * fetched only when `withRegistry` is true (the report), never by the gate.
 */
export async function classifyWithProposals({
  audit,
  pkg,
  lock,
  withRegistry = false,
  offline = false,
  logger = console.warn,
} = {}) {
  const records = classifyAdvisories({ audit, pkg, lock });
  let registry = null;
  if (withRegistry && !offline && records.length > 0) {
    const names = new Set();
    for (const record of records) {
      names.add(record.package);
      for (const parent of record.parents ?? []) if (parent.name) names.add(parent.name);
      for (const owner of record.owners ?? []) names.add(owner);
    }
    registry = await fetchRegistryMetadata({ packageNames: [...names], logger });
  }
  for (const record of records) {
    record.fix = proposeBump(record, registry);
  }
  return records;
}

function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : (argv[index + 1] ?? null);
  };
  const reportIndex = argv.indexOf("--report");
  const level = value("--audit-level") ?? "high";
  return {
    includeDev: argv.includes("--include-dev"),
    offline: argv.includes("--offline"),
    json: argv.includes("--json"),
    stepSummary: argv.includes("--step-summary"),
    updateBaseline: argv.includes("--update-baseline"),
    accept: value("--accept"),
    reason: value("--reason"),
    auditJsonPath: value("--audit-json"),
    baselinePath: value("--baseline") ?? BASELINE_PATH,
    reportPath:
      reportIndex === -1
        ? null
        : reportIndex + 1 < argv.length && !argv[reportIndex + 1].startsWith("--")
          ? argv[reportIndex + 1]
          : DEFAULT_REPORT_PATH,
    auditLevel: SEVERITIES.includes(level) ? level : "high",
  };
}

/**
 * Append the rendered report to the run's job summary.
 *
 * Called only in report mode with `--step-summary`. The heading carries the
 * audit profile because the nightly publishes two reports (prod and dev) into
 * the same summary — without it the second table would read as a duplicate of
 * the first. Returns false when there is nowhere to write or the write fails:
 * the report file is the durable output, so a missing summary must not turn a
 * successful report into a failed job.
 */
export function writeStepSummary(report, markdown, { summaryPath = process.env.GITHUB_STEP_SUMMARY, logger = console.warn } = {}) {
  if (!summaryPath) {
    logger(`${TAG} note: --step-summary was requested but GITHUB_STEP_SUMMARY is not set — summary skipped`);
    return false;
  }
  try {
    appendFileSync(summaryPath, `## Dependency CVE report — ${report.profile}\n\n${markdown}\n`);
    return true;
  } catch (error) {
    logger(
      `${TAG} note: job summary could not be written (${error instanceof Error ? error.message : String(error)}) — ` +
        "the report file is the durable output",
    );
    return false;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);
  const profile = options.includeDev ? "dev (npm audit)" : "prod (npm audit --omit=dev)";

  const pkg = readJson(join(ROOT, "package.json"), "package.json");
  const lockPath = join(ROOT, "package-lock.json");
  if (!existsSync(lockPath)) {
    console.error(`${TAG} FAIL (fail-closed): package-lock.json is missing — ownership cannot be resolved`);
    process.exit(2);
  }
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));

  let audit;
  if (options.auditJsonPath) {
    if (!existsSync(options.auditJsonPath)) {
      console.error(`${TAG} FAIL (fail-closed): --audit-json ${options.auditJsonPath} not found`);
      process.exit(2);
    }
    audit = JSON.parse(readFileSync(options.auditJsonPath, "utf8"));
  } else {
    audit = getAuditPayload({ includeDev: options.includeDev });
  }
  if (!audit || typeof audit.vulnerabilities !== "object" || audit.vulnerabilities === null) {
    console.error(
      `${TAG} FAIL (fail-closed): the audit payload has no "vulnerabilities" map — cannot certify anything`,
    );
    process.exit(2);
  }

  const baseline = loadBaseline(options.baselinePath);

  // `--accept`: the only way an advisory enters the baseline, and it cannot
  // enter without a reason.
  if (options.accept) {
    if (!options.reason || options.reason.trim().length === 0) {
      console.error(`${TAG} FAIL: --accept requires --reason "<why this risk is accepted>"`);
      process.exit(2);
    }
    const records = classifyAdvisories({ audit, pkg, lock });
    const record = records.find((entry) => entry.key === options.accept);
    if (!record) {
      console.error(
        `${TAG} FAIL: ${options.accept} is not reported in the current profile — nothing to accept`,
      );
      process.exit(2);
    }
    if (record.origin === "own") {
      console.error(
        `${TAG} FAIL: ${options.accept} affects the DIRECT dependency "${record.package}" — ` +
          `direct dependencies cannot be baselined: ${describeLever(proposeBump(record, null))}`,
      );
      process.exit(1);
    }
    const accepted = baseline.accepted.filter((entry) => entry?.key !== record.key);
    accepted.push({
      key: record.key,
      package: record.package,
      severity: record.severity,
      origin: record.origin,
      owners: record.owners,
      reason: options.reason.trim(),
      acceptedAt: new Date().toISOString(),
    });
    saveBaseline(
      { updatedAt: new Date().toISOString(), profile, accepted },
      options.baselinePath,
    );
    console.log(`${TAG} ok  accepted ${record.key} (${record.package}) — reason recorded`);
    process.exit(0);
  }

  if (options.updateBaseline) {
    const records = classifyAdvisories({ audit, pkg, lock });
    const reported = new Map(records.map((record) => [record.key, record]));
    const kept = [];
    const removed = [];
    for (const entry of baseline.accepted) {
      const record = reported.get(entry?.key);
      if (!record) {
        removed.push(entry?.key ?? "(no key)");
        continue;
      }
      kept.push({ ...entry, severity: record.severity, package: record.package });
    }
    saveBaseline({ updatedAt: new Date().toISOString(), profile, accepted: kept }, options.baselinePath);
    for (const key of removed) console.log(`${TAG} ok  pruned stale acceptance ${key}`);
    const missing = records.filter(
      (record) =>
        meetsLevel(record.severity, options.auditLevel) &&
        record.origin === "inherited" &&
        !kept.some((entry) => entry.key === record.key),
    );
    if (missing.length > 0) {
      console.log(`${TAG} note: ${missing.length} advisory(ies) are not accepted and need a decision:`);
      for (const record of missing) {
        console.log(
          `${TAG} note:   node scripts/check-direct-cve.mjs --accept ${record.key} ` +
            `--reason "<why>"   # ${record.package} ${record.severity} via ${record.chain.join(" → ")}`,
        );
      }
    }
    console.log(`${TAG} ok  baseline updated (${kept.length} accepted, ${removed.length} pruned)`);
    process.exit(0);
  }

  const records = await classifyWithProposals({
    audit,
    pkg,
    lock,
    withRegistry: options.reportPath !== null,
    offline: options.offline,
    logger: (message) => console.warn(message),
  });
  const report = buildReport({ records, baseline, profile, auditLevel: options.auditLevel });

  if (options.reportPath) {
    const markdown = renderMarkdown(report);
    writeFileSync(options.reportPath, `${markdown}\n`);
    const jsonPath = options.reportPath.replace(/\.md$/, ".json");
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    const summarized = options.stepSummary ? writeStepSummary(report, markdown) : false;
    if (options.json) console.log(JSON.stringify(report, null, 2));
    console.log(
      `${TAG} ok  report → ${options.reportPath} (+ ${jsonPath})` +
        `${summarized ? " (+ job summary)" : ""} — ` +
        `${report.summary.total} advisory(ies): ${report.summary.own} own, ${report.summary.inherited} inherited, ` +
        `${report.summary.accepted} accepted`,
    );
    for (const record of report.advisories) {
      console.log(
        `${TAG}     ${record.severity.toUpperCase().padEnd(8)} ${record.origin.padEnd(9)} ` +
          `${record.package} ${record.installed.join(",")} — ${describeLever(record.fix)}`,
      );
    }
    process.exit(0);
  }

  if (options.json) {
    console.log(JSON.stringify({ summary: report.summary, advisories: report.advisories }, null, 2));
  }

  const failures = evaluateDirectCve({
    records: report.advisories,
    baseline,
    auditLevel: options.auditLevel,
  });
  if (failures.length > 0) {
    for (const failure of failures) console.error(`${TAG} FAIL: ${failure}`);
    console.error(
      `${TAG} FAIL: ${failures.length} dependency-vulnerability violation(s) ` +
        `(profile ${profile}, threshold ${options.auditLevel})`,
    );
    process.exit(1);
  }
  console.log(
    `${TAG} ok  ${profile}, threshold ${options.auditLevel}: ${report.summary.total} advisory(ies) — ` +
      `${report.summary.own} own (direct dependencies are never baselined), ` +
      `${report.summary.inherited} inherited, ${report.summary.accepted} accepted with a reason`,
  );
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`${TAG} FAIL (fail-closed): ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  });
}
