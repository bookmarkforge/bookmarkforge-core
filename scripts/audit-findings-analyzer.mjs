#!/usr/bin/env node
/**
 * scripts/audit-findings-analyzer.mjs — Findings Analyzer Agent
 *
 * Aggregates findings from all check script JSON outputs, deduplicates them,
 * classifies by severity, and generates remediation recommendations.
 *
 * This is the analysis stage of the Software Factory audit pipeline.
 *
 * Usage:
 *   node scripts/audit-findings-analyzer.mjs --input <dir> [--output <file>] [--classify] [--recommend]
 *
 * Example:
 *   node scripts/audit-findings-analyzer.mjs --input findings/ --output findings/aggregated.json --classify --recommend
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load all JSON files from a directory.
 */
function loadFindings(inputDir) {
  if (!existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }

  const files = readdirSync(inputDir).filter(
    (f) => f.endsWith(".json") || f.endsWith(".log"),
  );
  const findings = [];

  for (const file of files) {
    const filePath = join(inputDir, file);
    try {
      if (file.endsWith(".json")) {
        const data = JSON.parse(readFileSync(filePath, "utf8"));
        findings.push({ source: file, data });
      } else {
        findings.push({
          source: file,
          data: { log: readFileSync(filePath, "utf8") },
        });
      }
    } catch (error) {
      console.warn(`[audit-findings-analyzer] Failed to parse ${file}: ${error.message}`);
    }
  }

  return findings;
}

/**
 * Extract findings from a plain-text check log. Gate scripts print
 * `[check-name] FAIL ...` / `error` lines; each becomes a finding so the
 * analyzer works even when a script has no --json mode.
 */
function extractLogFindings(source, log) {
  const findings = [];
  const lines = log.split(/\r?\n/);
  const failRe = /\bFAIL\b|\bfailed\b|\berror\b|✖|ERR!/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!failRe.test(line)) continue;
    // Skip generic noise (npm warnings, stack traces already covered)
    if (/npm warn|deprecated/i.test(line)) continue;
    findings.push({
      source,
      type: "check-error",
      // No preset severity — classifySeverity() assigns medium by default
      // and high only for security-flavoured messages.
      message: line.trim().slice(0, 500),
      file: null,
      line: i + 1,
      raw: { logLine: i + 1 },
    });
  }

  return findings;
}

/**
 * Extract individual findings from a check script output.
 */
function extractFindingsFromOutput(source, data) {
  const findings = [];

  // Handle different output formats from check scripts
  if (data.errors && Array.isArray(data.errors)) {
    // Standard check script format
    for (const error of data.errors) {
      findings.push({
        source,
        type: "check-error",
        severity: error.severity || "medium",
        message: error.message || error.toString(),
        file: error.file,
        line: error.line,
        column: error.column,
        rule: error.rule,
        raw: error,
      });
    }
  }

  if (data.warnings && Array.isArray(data.warnings)) {
    for (const warning of data.warnings) {
      findings.push({
        source,
        type: "check-warning",
        severity: "low",
        message: warning.message || warning.toString(),
        file: warning.file,
        line: warning.line,
        raw: warning,
      });
    }
  }

  // Handle npm audit format
  if (data.vulnerabilities) {
    for (const [pkg, vuln] of Object.entries(data.vulnerabilities)) {
      findings.push({
        source,
        type: "dependency-vulnerability",
        severity: vuln.severity || "medium",
        message: `${pkg}: ${vuln.title || "Vulnerability detected"}`,
        package: pkg,
        cve: vuln.cve,
        cvss: vuln.cvss,
        raw: vuln,
      });
    }
  }

  // Handle TypeScript errors
  if (data.diagnostics && Array.isArray(data.diagnostics)) {
    for (const diag of data.diagnostics) {
      findings.push({
        source,
        type: "type-error",
        severity: "high",
        message: diag.messageText || diag.message || "TypeScript error",
        file: diag.file?.fileName,
        line: diag.start?.line,
        column: diag.start?.character,
        code: diag.code,
        raw: diag,
      });
    }
  }

  // Handle test failures
  if (data.testResults && Array.isArray(data.testResults)) {
    for (const suite of data.testResults) {
      if (suite.status === "failed") {
        findings.push({
          source,
          type: "test-failure",
          severity: "high",
          message: `Test suite failed: ${suite.name}`,
          file: suite.name,
          raw: suite,
        });

        if (suite.assertionResults) {
          for (const assertion of suite.assertionResults) {
            if (assertion.status === "failed") {
              findings.push({
                source,
                type: "test-assertion-failure",
                severity: "high",
                message: assertion.failureMessages?.[0] || "Assertion failed",
                file: assertion.ancestorTitles?.join(" > "),
                raw: assertion,
              });
            }
          }
        }
      }
    }
  }

  // Orchestrator task-results feed: findings/task-results.json records the
  // exit status of every executed task. A failed task is a finding even
  // when its log contains no FAIL lines (silent non-zero exits like knip).
  if (Array.isArray(data.tasks)) {
    for (const task of data.tasks) {
      if (task.status === "failed" || task.status === "error" || (task.exitCode ?? 0) !== 0) {
        findings.push({
          source,
          type: "task-failure",
          message: `Task ${task.taskId} "${task.title}" ${task.status === "error" ? "errored" : `failed with exit code ${task.exitCode}`}`,
          file: null,
          line: null,
          raw: task,
        });
      }
    }
    return findings;
  }

  // Plain-text gate logs (.log files wrapped as { log })
  if (typeof data.log === "string") {
    return extractLogFindings(source, data.log);
  }

  return findings;
}

/**
 * Deduplicate findings based on message, file, and line.
 */
function deduplicateFindings(findings) {
  const seen = new Set();
  const unique = [];

  for (const finding of findings) {
    const key = `${finding.source}:${finding.type}:${finding.message}:${finding.file}:${finding.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(finding);
    }
  }

  return unique;
}

/**
 * Classify finding severity based on heuristics.
 */
function classifySeverity(finding) {
  // If severity is already set and valid, use it
  const validSeverities = ["critical", "high", "medium", "low", "info"];
  if (validSeverities.includes(finding.severity)) {
    return finding.severity;
  }

  // Classify based on finding type
  switch (finding.type) {
    case "dependency-vulnerability":
      // Use CVSS score if available
      if (finding.cvss) {
        if (finding.cvss >= 9.0) return "critical";
        if (finding.cvss >= 7.0) return "high";
        if (finding.cvss >= 4.0) return "medium";
        return "low";
      }
      return "medium";

    case "task-failure":
      return "high";

    case "type-error":
    case "test-failure":
    case "test-assertion-failure":
      return "high";

    case "check-error":
      // Security-related errors are higher severity
      if (finding.message.toLowerCase().includes("security") ||
          finding.message.toLowerCase().includes("vulnerability") ||
          finding.message.toLowerCase().includes("cve")) {
        return "high";
      }
      return "medium";

    case "check-warning":
      return "low";

    default:
      return "medium";
  }
}

/**
 * Assign priority based on severity and type.
 */
function assignPriority(finding) {
  const severityOrder = { critical: 1, high: 2, medium: 3, low: 4, info: 5 };
  const severityPriority = severityOrder[finding.severity] || 3;

  // Adjust priority based on type
  let typeAdjustment = 0;
  if (finding.type === "dependency-vulnerability" && finding.cvss >= 9.0) {
    typeAdjustment = -1; // Critical CVE gets highest priority
  } else if (finding.type === "test-failure") {
    typeAdjustment = -1; // Test failures are high priority
  }

  return Math.max(1, severityPriority + typeAdjustment);
}

/**
 * Generate remediation recommendation.
 */
function generateRecommendation(finding) {
  const recommendations = [];

  switch (finding.type) {
    case "task-failure":
      recommendations.push("Inspect the task output in findings/ and execution-report.json");
      recommendations.push("Fix the underlying gate or document it as a known exception");
      break;

    case "dependency-vulnerability":
      if (finding.package) {
        recommendations.push(`Update ${finding.package} to a patched version`);
        recommendations.push(`Run: npm audit fix or npm update ${finding.package}`);
      }
      recommendations.push("Review the CVE details and assess exploitability");
      recommendations.push("Consider adding to allowlist if false positive");
      break;

    case "type-error":
      recommendations.push("Fix TypeScript type error");
      recommendations.push("Run: npm run typecheck:prod for details");
      recommendations.push("Check for missing type definitions or incorrect types");
      break;

    case "test-failure":
    case "test-assertion-failure":
      recommendations.push("Investigate test failure");
      recommendations.push("Run the specific test locally to reproduce");
      recommendations.push("Check if the test is outdated or if there's a regression");
      break;

    case "check-error":
      if (finding.message.toLowerCase().includes("security")) {
        recommendations.push("Review security implications carefully");
        recommendations.push("Consult docs/security.md for guidance");
        recommendations.push("Consider creating an ADR if this is a design decision");
      } else if (finding.message.toLowerCase().includes("i18n")) {
        recommendations.push("Add missing translation keys to all 30 locales");
        recommendations.push("Run: npm run check:content to verify");
      } else if (finding.message.toLowerCase().includes("boundary")) {
        recommendations.push("Fix layer boundary violation");
        recommendations.push("Move code to correct layer or use type-only imports");
      }
      recommendations.push("Review the check script documentation");
      break;

    case "check-warning":
      recommendations.push("Review warning for potential issues");
      recommendations.push("Consider if this should be elevated to an error");
      break;

    default:
      recommendations.push("Manual review required");
      recommendations.push("Consult project documentation for guidance");
  }

  return recommendations;
}

/**
 * Determine if finding can be auto-fixed.
 */
function canAutoFix(finding) {
  // Auto-fixable cases
  if (finding.type === "check-error" &&
      (finding.message.toLowerCase().includes("baseline") ||
       finding.message.toLowerCase().includes("drift"))) {
    return true; // Baseline updates can be auto-fixed
  }

  if (finding.type === "check-warning") {
    return true; // Warnings can often be auto-fixed
  }

  // Not auto-fixable
  return false;
}

/**
 * Main analysis function.
 */
function analyze(inputDir, outputFile, options = {}) {
  const { classify = false, recommend = false } = options;

  console.log(`[audit-findings-analyzer] Loading findings from: ${inputDir}`);

  const rawFindings = loadFindings(inputDir);
  console.log(`[audit-findings-analyzer] Loaded ${rawFindings.length} source files`);

  // Extract individual findings
  let allFindings = [];
  for (const { source, data } of rawFindings) {
    const findings = extractFindingsFromOutput(source, data);
    allFindings.push(...findings);
  }

  console.log(`[audit-findings-analyzer] Extracted ${allFindings.length} findings`);

  // Deduplicate
  allFindings = deduplicateFindings(allFindings);
  console.log(`[audit-findings-analyzer] After deduplication: ${allFindings.length} findings`);

  // Classify and prioritize
  if (classify || recommend) {
    for (const finding of allFindings) {
      finding.severity = classifySeverity(finding);
      finding.priority = assignPriority(finding);
      finding.autoFixable = canAutoFix(finding);

      if (recommend) {
        finding.recommendations = generateRecommendation(finding);
      }
    }

    // Sort by priority
    allFindings.sort((a, b) => a.priority - b.priority);
  }

  // Generate summary
  const summary = {
    total: allFindings.length,
    bySeverity: {
      critical: allFindings.filter((f) => f.severity === "critical").length,
      high: allFindings.filter((f) => f.severity === "high").length,
      medium: allFindings.filter((f) => f.severity === "medium").length,
      low: allFindings.filter((f) => f.severity === "low").length,
      info: allFindings.filter((f) => f.severity === "info").length,
    },
    byType: {},
    autoFixable: allFindings.filter((f) => f.autoFixable).length,
    manualReview: allFindings.filter((f) => !f.autoFixable).length,
  };

  // Count by type
  for (const finding of allFindings) {
    summary.byType[finding.type] = (summary.byType[finding.type] || 0) + 1;
  }

  // Build aggregated report
  const report = {
    metadata: {
      analyzedAt: new Date().toISOString(),
      analyzerVersion: "1.0.0",
      inputDir,
      options: { classify, recommend },
    },
    summary,
    findings: allFindings,
  };

  // Write output
  const outputPath = outputFile || join(inputDir, "aggregated.json");
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log(`\n[audit-findings-analyzer] Analysis complete`);
  console.log(`[audit-findings-analyzer] Total findings: ${summary.total}`);
  console.log(`[audit-findings-analyzer] Critical: ${summary.bySeverity.critical}`);
  console.log(`[audit-findings-analyzer] High: ${summary.bySeverity.high}`);
  console.log(`[audit-findings-analyzer] Medium: ${summary.bySeverity.medium}`);
  console.log(`[audit-findings-analyzer] Low: ${summary.bySeverity.low}`);
  console.log(`[audit-findings-analyzer] Auto-fixable: ${summary.autoFixable}`);
  console.log(`[audit-findings-analyzer] Manual review: ${summary.manualReview}`);
  console.log(`[audit-findings-analyzer] Report: ${outputPath}`);

  return report;
}

/**
 * Main CLI entry point.
 */
function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf("--input");
  const outputIndex = args.indexOf("--output");
  const classify = args.includes("--classify");
  const recommend = args.includes("--recommend");

  if (inputIndex === -1 || !args[inputIndex + 1]) {
    console.error("Usage: node scripts/audit-findings-analyzer.mjs --input <dir> [--output <file>] [--classify] [--recommend]");
    process.exit(1);
  }

  const inputDir = args[inputIndex + 1];
  const outputFile = outputIndex !== -1 ? args[outputIndex + 1] : null;

  try {
    analyze(inputDir, outputFile, { classify, recommend });
  } catch (error) {
    console.error(`[audit-findings-analyzer] Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

export { analyze, extractFindingsFromOutput, classifySeverity, generateRecommendation };
