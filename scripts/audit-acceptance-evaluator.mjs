#!/usr/bin/env node
/**
 * scripts/audit-acceptance-evaluator.mjs — Acceptance Evaluator Agent
 *
 * Verifies that all acceptance criteria from the PRD are satisfied after
 * the audit execution and fix application.
 *
 * This is the acceptance stage of the Software Factory audit pipeline.
 *
 * Usage:
 *   node scripts/audit-acceptance-evaluator.mjs --prd <path> --input <verification.md>
 *
 * Example:
 *   node scripts/audit-acceptance-evaluator.mjs --prd docs/audits/AUDIT-001-security.md --input reports/verification.md
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parse PRD and extract acceptance criteria.
 */
function parsePRD(prdPath) {
  if (!existsSync(prdPath)) {
    throw new Error(`PRD not found: ${prdPath}`);
  }

  const content = readFileSync(prdPath, "utf8");
  const criteria = [];

  // Extract acceptance criteria section
  const accSectionMatch = content.match(/##\s+Acceptance Criteria([\s\S]*?)(?=##|$)/);
  if (!accSectionMatch) {
    return { criteria: [], metadata: {} };
  }

  const accSection = accSectionMatch[1];
  const checklistRegex = /^-\s*\[\s*\]\s*(.+)$/gm;
  let match;

  while ((match = checklistRegex.exec(accSection)) !== null) {
    criteria.push({
      text: match[1].trim(),
      satisfied: false,
      evidence: null,
    });
  }

  // Extract metadata
  const idMatch = content.match(/^\*\*ID:\*\*\s*(.+)$/m);
  const metadata = {
    id: idMatch ? idMatch[1].trim() : "UNKNOWN",
  };

  return { criteria, metadata };
}

/**
 * Parse verification report.
 */
function parseVerificationReport(reportPath) {
  if (!existsSync(reportPath)) {
    throw new Error(`Verification report not found: ${reportPath}`);
  }

  const content = readFileSync(reportPath, "utf8");

  // Machine-readable input: findings/aggregated.json produced by
  // audit-findings-analyzer. A clean audit (zero findings) counts as success.
  try {
    const parsed = JSON.parse(content);
    if (parsed && parsed.summary && typeof parsed.summary.total === "number") {
      const total = parsed.summary.total;
      const criticalHigh =
        (parsed.summary.bySeverity?.critical ?? 0) +
        (parsed.summary.bySeverity?.high ?? 0);
      return {
        content,
        successScore: total === 0 ? 1 : 0,
        failureScore: total === 0 ? 0 : Math.max(1, criticalHigh),
        overallStatus: total === 0 ? "success" : "failure",
        findingsTotal: total,
      };
    }
  } catch {
    // INTENTIONAL SILENCE: not JSON — fall through to text heuristics.
  }

  // Simple heuristic: look for keywords indicating success
  const successIndicators = [
    "all checks passed",
    "all gates green",
    "verification successful",
    "no failures",
    "exit code 0",
    "passed",
  ];

  const failureIndicators = [
    "failed",
    "error",
    "critical",
    "high severity",
    "regression",
  ];

  let successScore = 0;
  let failureScore = 0;

  for (const indicator of successIndicators) {
    if (content.toLowerCase().includes(indicator)) {
      successScore++;
    }
  }

  for (const indicator of failureIndicators) {
    if (content.toLowerCase().includes(indicator)) {
      failureScore++;
    }
  }

  return {
    content,
    successScore,
    failureScore,
    overallStatus: successScore > failureScore ? "success" : "failure",
  };
}

/**
 * Evaluate acceptance criteria against verification report.
 */
function evaluateCriteria(criteria, verificationReport) {
  const results = [];

  for (const criterion of criteria) {
    // Heuristic matching: check if criterion text appears in verification report
    const criterionLower = criterion.text.toLowerCase();
    const reportLower = verificationReport.content.toLowerCase();

    // Check for explicit satisfaction indicators
    const satisfied =
      reportLower.includes(criterionLower) ||
      (verificationReport.overallStatus === "success" &&
       !reportLower.includes("failed") &&
       !reportLower.includes("error"));

    results.push({
      ...criterion,
      satisfied,
      evidence: satisfied ? "Found in verification report" : "Not found in verification report",
    });
  }

  return results;
}

/**
 * Generate acceptance evaluation report.
 */
function evaluate(prdPath, verificationPath, outputPath) {
  console.log(`[audit-acceptance-evaluator] Evaluating acceptance criteria`);
  console.log(`[audit-acceptance-evaluator] PRD: ${prdPath}`);
  console.log(`[audit-acceptance-evaluator] Verification: ${verificationPath}`);

  const prd = parsePRD(prdPath);
  const verification = parseVerificationReport(verificationPath);

  console.log(`[audit-acceptance-evaluator] PRD ID: ${prd.metadata.id}`);
  console.log(`[audit-acceptance-evaluator] Acceptance criteria: ${prd.criteria.length}`);
  console.log(`[audit-acceptance-evaluator] Verification status: ${verification.overallStatus}`);

  const results = evaluateCriteria(prd.criteria, verification);

  const satisfiedCount = results.filter((r) => r.satisfied).length;
  const totalCount = results.length;
  const satisfactionRate = totalCount > 0 ? (satisfiedCount / totalCount) * 100 : 0;

  let verdict;
  if (satisfactionRate === 100) {
    verdict = "PASS";
  } else if (satisfactionRate >= 80) {
    verdict = "ACCEPTABLE";
  } else if (satisfactionRate >= 50) {
    verdict = "NEEDS_WORK";
  } else {
    verdict = "FAIL";
  }

  const report = {
    metadata: {
      evaluatedAt: new Date().toISOString(),
      evaluatorVersion: "1.0.0",
      prdId: prd.metadata.id,
      prdPath,
      verificationPath,
    },
    verdict,
    satisfactionRate: Math.round(satisfactionRate * 100) / 100,
    summary: {
      total: totalCount,
      satisfied: satisfiedCount,
      unsatisfied: totalCount - satisfiedCount,
    },
    criteria: results,
    verificationStatus: verification.overallStatus,
  };

  // Write output
  const outputFile = outputPath || join(dirname(prdPath), "acceptance-evaluation.json");
  writeFileSync(outputFile, JSON.stringify(report, null, 2));

  console.log(`\n[audit-acceptance-evaluator] Evaluation complete`);
  console.log(`[audit-acceptance-evaluator] Verdict: ${verdict}`);
  console.log(`[audit-acceptance-evaluator] Satisfaction rate: ${satisfactionRate.toFixed(1)}%`);
  console.log(`[audit-acceptance-evaluator] Satisfied: ${satisfiedCount}/${totalCount}`);
  console.log(`[audit-acceptance-evaluator] Report: ${outputFile}`);

  return report;
}

/**
 * Main CLI entry point.
 */
function main() {
  const args = process.argv.slice(2);
  const prdIndex = args.indexOf("--prd");
  const inputIndex = args.indexOf("--input");
  const outputIndex = args.indexOf("--output");

  if (prdIndex === -1 || !args[prdIndex + 1] ||
      inputIndex === -1 || !args[inputIndex + 1]) {
    console.error("Usage: node scripts/audit-acceptance-evaluator.mjs --prd <path> --input <verification.md> [--output <file>]");
    process.exit(1);
  }

  const prdPath = args[prdIndex + 1];
  const verificationPath = args[inputIndex + 1];
  const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : null;

  try {
    const report = evaluate(prdPath, verificationPath, outputPath);

    // Exit with non-zero if verdict is FAIL
    if (report.verdict === "FAIL") {
      process.exit(1);
    }
  } catch (error) {
    console.error(`[audit-acceptance-evaluator] Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

export { evaluate, parsePRD, parseVerificationReport };
