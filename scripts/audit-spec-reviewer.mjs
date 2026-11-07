#!/usr/bin/env node
/**
 * scripts/audit-spec-reviewer.mjs — Spec Reviewer Agent
 *
 * Reviews a generated spec for completeness, correctness, and executability.
 * Scores the spec on multiple dimensions and provides actionable feedback.
 *
 * This is the second stage of the Software Factory audit pipeline.
 *
 * Usage:
 *   node scripts/audit-spec-reviewer.mjs --spec <path> [--output <path>]
 *
 * Example:
 *   node scripts/audit-spec-reviewer.mjs --spec docs/audits/AUDIT-001-security/spec.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load and validate spec JSON.
 */
function loadSpec(specPath) {
  if (!existsSync(specPath)) {
    throw new Error(`Spec not found: ${specPath}`);
  }

  const spec = JSON.parse(readFileSync(specPath, "utf8"));

  // Validate required fields
  const requiredFields = ["metadata", "prd", "scripts", "tasks", "phases"];
  for (const field of requiredFields) {
    if (!spec[field]) {
      throw new Error(`Spec missing required field: ${field}`);
    }
  }

  return spec;
}

/**
 * Check requirement coverage.
 */
function checkRequirementCoverage(spec) {
  const issues = [];
  const scores = {
    requirementsCovered: 0,
    requirementsTotal: 0,
    acceptanceCriteriaCovered: 0,
    acceptanceCriteriaTotal: spec.prd.acceptanceCriteria.length,
  };

  // Check that all requirements have corresponding scripts or tasks
  const requirementIds = Object.keys(spec.prd.requirements);
  scores.requirementsTotal = requirementIds.length;

  // Execution tasks are any task outside the meta phases — script phases
  // are dynamic (typecheck, brand, build, ...) and cannot be enumerated.
  const META_PHASES = new Set(["setup", "analysis", "fixes", "verification", "acceptance", "ship"]);
  const hasExecutionTasks = spec.tasks.some((t) => !META_PHASES.has(t.phase));

  for (const reqId of requirementIds) {
    const req = spec.prd.requirements[reqId];
    // Simplified check: if we have execution tasks, assume requirements are covered
    if (hasExecutionTasks) {
      scores.requirementsCovered++;
    } else {
      issues.push({
        type: "requirement-not-covered",
        severity: "high",
        requirement: reqId,
        title: req.title,
        message: `Requirement ${reqId}: ${req.title} has no corresponding execution task`,
      });
    }
  }

  // Check acceptance criteria
  for (const criterion of spec.prd.acceptanceCriteria) {
    // Simplified check: if we have acceptance phase tasks, assume criteria are covered
    const hasAcceptanceTasks = spec.tasks.some((t) => t.phase === "acceptance");
    
    if (hasAcceptanceTasks) {
      scores.acceptanceCriteriaCovered++;
    } else {
      issues.push({
        type: "acceptance-criterion-not-covered",
        severity: "medium",
        criterion: criterion.text,
        message: `Acceptance criterion has no verification task: ${criterion.text}`,
      });
    }
  }

  return { scores, issues };
}

/**
 * Check task dependency graph for cycles and missing dependencies.
 */
function checkTaskDependencies(spec) {
  const issues = [];
  const taskIds = new Set(spec.tasks.map((t) => t.id));

  // Build dependency graph
  const graph = new Map();
  for (const task of spec.tasks) {
    graph.set(task.id, task.dependencies || []);
  }

  // Check for missing dependencies
  for (const task of spec.tasks) {
    for (const dep of task.dependencies || []) {
      if (!taskIds.has(dep)) {
        issues.push({
          type: "missing-dependency",
          severity: "high",
          task: task.id,
          dependency: dep,
          message: `Task ${task.id} depends on non-existent task ${dep}`,
        });
      }
    }
  }

  // Check for cycles using DFS
  const visited = new Set();
  const recursionStack = new Set();

  function hasCycle(taskId) {
    if (recursionStack.has(taskId)) return true;
    if (visited.has(taskId)) return false;

    visited.add(taskId);
    recursionStack.add(taskId);

    const deps = graph.get(taskId) || [];
    for (const dep of deps) {
      if (hasCycle(dep)) return true;
    }

    recursionStack.delete(taskId);
    return false;
  }

  for (const taskId of taskIds) {
    if (hasCycle(taskId)) {
      issues.push({
        type: "dependency-cycle",
        severity: "critical",
        task: taskId,
        message: `Task ${taskId} is part of a dependency cycle`,
      });
    }
  }

  return { issues };
}

/**
 * Check script validity (commands exist, are executable).
 */
function checkScriptValidity(spec) {
  const issues = [];

  for (const script of spec.scripts) {
    // Check that script has required fields
    if (!script.name || !script.command || !script.outputFile) {
      issues.push({
        type: "incomplete-script",
        severity: "high",
        script: script.name,
        message: `Script ${script.name} is missing required fields`,
      });
      continue;
    }

    // Check that command looks valid
    if (!script.command.startsWith("npm run") && !script.command.startsWith("node ")) {
      issues.push({
        type: "invalid-command",
        severity: "medium",
        script: script.name,
        command: script.command,
        message: `Script ${script.name} has unusual command format: ${script.command}`,
      });
    }

    // Check timeout is reasonable
    if (script.timeout && script.timeout > 1800000) { // 30 minutes
      issues.push({
        type: "excessive-timeout",
        severity: "low",
        script: script.name,
        timeout: script.timeout,
        message: `Script ${script.name} has very long timeout: ${script.timeout}ms`,
      });
    }
  }

  return { issues };
}

/**
 * Check task command validity.
 */
function checkTaskCommands(spec) {
  const issues = [];

  for (const task of spec.tasks) {
    // Skip manual tasks
    if (task.command.toLowerCase().includes("manual")) continue;

    // Check command format
    const validCommands = ["npm run", "node ", "git ", "cd ", "mkdir "];
    const hasValidPrefix = validCommands.some((prefix) => task.command.startsWith(prefix));

    if (!hasValidPrefix && !task.command.includes("[")) { // Allow placeholders
      issues.push({
        type: "invalid-task-command",
        severity: "medium",
        task: task.id,
        command: task.command,
        message: `Task ${task.id} has unusual command format: ${task.command}`,
      });
    }
  }

  return { issues };
}

/**
 * Check phase coverage.
 */
function checkPhaseCoverage(spec) {
  const issues = [];
  // Meta phases are fixed; execution phases are dynamic (one per selected
  // check script), so "execution coverage" means at least one task exists
  // outside the meta phases whenever the spec selected scripts.
  const requiredPhases = ["setup", "analysis", "fixes", "verification", "acceptance", "ship"];
  const META_PHASES = new Set(requiredPhases);

  for (const phase of requiredPhases) {
    const phaseTasks = spec.tasks.filter((t) => t.phase === phase);
    if (phaseTasks.length === 0) {
      issues.push({
        type: "missing-phase",
        severity: "high",
        phase,
        message: `Phase ${phase} has no tasks`,
      });
    }
  }

  const hasExecutionTasks = spec.tasks.some((t) => !META_PHASES.has(t.phase));
  if ((spec.scripts?.length ?? 0) > 0 && !hasExecutionTasks) {
    issues.push({
      type: "missing-phase",
      severity: "high",
      phase: "execution",
      message: "Spec selects check scripts but has no execution tasks",
    });
  }

  return { issues };
}

/**
 * Check network requirements are documented.
 */
function checkNetworkRequirements(spec) {
  const issues = [];

  const networkScripts = spec.scripts.filter((s) => s.networkRequired);
  if (networkScripts.length > 0 && !spec.constraints?.resources?.some((r) =>
    r.toLowerCase().includes("network")
  )) {
    issues.push({
      type: "undocumented-network-requirement",
      severity: "medium",
      message: `Spec has ${networkScripts.length} network-required scripts but PRD doesn't document network constraint`,
    });
  }

  return { issues };
}

/**
 * Calculate overall spec score.
 */
function calculateScore(checks) {
  let totalScore = 0;
  let maxScore = 0;

  // Requirement coverage (30%)
  const reqCoverage = checks.requirementCoverage.scores.requirementsCovered / checks.requirementCoverage.scores.requirementsTotal;
  totalScore += reqCoverage * 30;
  maxScore += 30;

  // Acceptance criteria coverage (20%)
  const accCoverage = checks.requirementCoverage.scores.acceptanceCriteriaCovered / checks.requirementCoverage.scores.acceptanceCriteriaTotal;
  totalScore += accCoverage * 20;
  maxScore += 20;

  // Dependency graph validity (20%)
  const depIssues = checks.taskDependencies.issues.filter((i) => i.severity === "critical" || i.severity === "high").length;
  const depScore = Math.max(0, 20 - depIssues * 5);
  totalScore += depScore;
  maxScore += 20;

  // Script validity (15%)
  const scriptIssues = checks.scriptValidity.issues.filter((i) => i.severity === "high" || i.severity === "critical").length;
  const scriptScore = Math.max(0, 15 - scriptIssues * 5);
  totalScore += scriptScore;
  maxScore += 15;

  // Phase coverage (15%)
  const phaseIssues = checks.phaseCoverage.issues.length;
  const phaseScore = Math.max(0, 15 - phaseIssues * 5);
  totalScore += phaseScore;
  maxScore += 15;

  return {
    score: Math.round((totalScore / maxScore) * 100),
    maxScore,
    breakdown: {
      requirementCoverage: Math.round(reqCoverage * 100),
      acceptanceCriteriaCoverage: Math.round(accCoverage * 100),
      dependencyGraph: depScore,
      scriptValidity: scriptScore,
      phaseCoverage: phaseScore,
    },
  };
}

/**
 * Generate review report.
 */
function generateReview(specPath, outputPath) {
  console.log(`[audit-spec-reviewer] Reviewing spec: ${specPath}`);

  const spec = loadSpec(specPath);
  console.log(`[audit-spec-reviewer] Spec ID: ${spec.metadata.id}`);
  console.log(`[audit-spec-reviewer] Tasks: ${spec.tasks.length}`);
  console.log(`[audit-spec-reviewer] Scripts: ${spec.scripts.length}`);

  // Run all checks
  console.log("[audit-spec-reviewer] Running checks...");

  const requirementCoverage = checkRequirementCoverage(spec);
  const taskDependencies = checkTaskDependencies(spec);
  const scriptValidity = checkScriptValidity(spec);
  const taskCommands = checkTaskCommands(spec);
  const phaseCoverage = checkPhaseCoverage(spec);
  const networkRequirements = checkNetworkRequirements(spec);

  // Aggregate all issues
  const allIssues = [
    ...requirementCoverage.issues,
    ...taskDependencies.issues,
    ...scriptValidity.issues,
    ...taskCommands.issues,
    ...phaseCoverage.issues,
    ...networkRequirements.issues,
  ];

  // Count issues by severity
  const severityCounts = {
    critical: allIssues.filter((i) => i.severity === "critical").length,
    high: allIssues.filter((i) => i.severity === "high").length,
    medium: allIssues.filter((i) => i.severity === "medium").length,
    low: allIssues.filter((i) => i.severity === "low").length,
  };

  // Calculate score
  const score = calculateScore({
    requirementCoverage,
    taskDependencies,
    scriptValidity,
    phaseCoverage,
  });

  // Determine verdict
  let verdict;
  if (severityCounts.critical > 0 || score.score < 50) {
    verdict = "FAIL";
  } else if (severityCounts.high > 0 || score.score < 70) {
    verdict = "NEEDS_REVISION";
  } else if (severityCounts.medium > 0 || score.score < 85) {
    verdict = "ACCEPTABLE";
  } else {
    verdict = "PASS";
  }

  // Build review report
  const review = {
    metadata: {
      specPath,
      specId: spec.metadata.id,
      reviewedAt: new Date().toISOString(),
      reviewerVersion: "1.0.0",
    },
    verdict,
    score: score.score,
    scoreBreakdown: score.breakdown,
    severityCounts,
    totalIssues: allIssues.length,
    requirementCoverage: requirementCoverage.scores,
    issues: allIssues,
    recommendations: generateRecommendations(allIssues, verdict),
  };

  // Write output
  const outputFile = outputPath || join(dirname(specPath), "spec-review.json");
  writeFileSync(outputFile, JSON.stringify(review, null, 2));

  console.log(`[audit-spec-reviewer] Verdict: ${verdict}`);
  console.log(`[audit-spec-reviewer] Score: ${score.score}/100`);
  console.log(`[audit-spec-reviewer] Issues: ${allIssues.length} (critical: ${severityCounts.critical}, high: ${severityCounts.high}, medium: ${severityCounts.medium}, low: ${severityCounts.low})`);
  console.log(`[audit-spec-reviewer] Review written to: ${outputFile}`);

  return review;
}

/**
 * Generate recommendations based on issues.
 */
function generateRecommendations(issues, verdict) {
  const recommendations = [];

  if (verdict === "FAIL") {
    recommendations.push("Spec has critical issues that must be fixed before execution");
    recommendations.push("Review dependency cycles and missing requirements coverage");
  }

  if (verdict === "NEEDS_REVISION") {
    recommendations.push("Spec needs revision to improve coverage and correctness");
    recommendations.push("Address high-severity issues before proceeding");
  }

  if (verdict === "ACCEPTABLE") {
    recommendations.push("Spec is acceptable but has minor issues to consider");
    recommendations.push("Review medium-severity issues for potential improvements");
  }

  if (verdict === "PASS") {
    recommendations.push("Spec is well-formed and ready for execution");
    recommendations.push("Proceed to audit-orchestrator");
  }

  // Add specific recommendations based on issue types
  const issueTypes = new Set(issues.map((i) => i.type));

  if (issueTypes.has("requirement-not-covered")) {
    recommendations.push("Add tasks to cover all PRD requirements");
  }

  if (issueTypes.has("dependency-cycle")) {
    recommendations.push("Break dependency cycles by reordering or parallelizing tasks");
  }

  if (issueTypes.has("missing-phase")) {
    recommendations.push("Add tasks for missing phases to ensure complete coverage");
  }

  if (issueTypes.has("undocumented-network-requirement")) {
    recommendations.push("Document network requirements in PRD constraints");
  }

  return recommendations;
}

/**
 * Main CLI entry point.
 */
function main() {
  const args = process.argv.slice(2);
  const specIndex = args.indexOf("--spec");
  const outputIndex = args.indexOf("--output");

  if (specIndex === -1 || !args[specIndex + 1]) {
    console.error("Usage: node scripts/audit-spec-reviewer.mjs --spec <path> [--output <path>]");
    process.exit(1);
  }

  const specPath = args[specIndex + 1];
  const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : null;

  try {
    const review = generateReview(specPath, outputPath);

    // Exit with non-zero if verdict is FAIL
    if (review.verdict === "FAIL") {
      process.exit(1);
    }
  } catch (error) {
    console.error(`[audit-spec-reviewer] Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

export { loadSpec, generateReview, calculateScore };
