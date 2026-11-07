#!/usr/bin/env node
/**
 * scripts/audit-orchestrator.mjs — Audit Orchestrator
 *
 * Executes the audit spec tasks in order, managing dependencies, timeouts,
 * and error handling. Creates an isolated git worktree for safe execution.
 *
 * This is the execution stage of the Software Factory audit pipeline.
 *
 * Usage:
 *   node scripts/audit-orchestrator.mjs --spec <path> [--mode sequential|parallel] [--dry-run]
 *
 * Example:
 *   node scripts/audit-orchestrator.mjs --spec docs/audits/AUDIT-001-security/spec.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

/**
 * Load and validate spec.
 */
function loadSpec(specPath) {
  if (!existsSync(specPath)) {
    throw new Error(`Spec not found: ${specPath}`);
  }

  const spec = JSON.parse(readFileSync(specPath, "utf8"));

  // Validate required fields
  const requiredFields = ["metadata", "scripts", "tasks", "phases"];
  for (const field of requiredFields) {
    if (!spec[field]) {
      throw new Error(`Spec missing required field: ${field}`);
    }
  }

  return spec;
}

/**
 * Create git worktree for isolated execution.
 */
function createWorktree(spec) {
  const auditId = spec.metadata.id;
  const worktreePath = join(ROOT, "..", `audit-${auditId}`);
  const branchName = `audit/${auditId}`;

  console.log(`[audit-orchestrator] Creating worktree: ${worktreePath}`);

  try {
    // Check if worktree already exists
    if (existsSync(worktreePath)) {
      console.log(`[audit-orchestrator] Worktree already exists, removing...`);
      try {
        execSync(`git worktree remove --force "${worktreePath}"`, { cwd: ROOT });
      } catch {
        // Not a registered worktree — remove the leftover directory manually
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    // Delete the branch if it already exists from a previous run
    try {
      execSync(`git branch -D "${branchName}"`, { cwd: ROOT });
    } catch {
      // Branch doesn't exist — fine
    }

    // Create new worktree
    execSync(
      `git worktree add -b "${branchName}" "${worktreePath}" HEAD`,
      { cwd: ROOT, stdio: "inherit" }
    );

    console.log(`[audit-orchestrator] Worktree created at: ${worktreePath}`);

    // Ensure dependencies are installed in the worktree
    const worktreeNodeModules = join(worktreePath, "node_modules");
    if (!existsSync(worktreeNodeModules)) {
      console.log(`[audit-orchestrator] Installing dependencies in worktree...`);
      execSync("npm install", { cwd: worktreePath, stdio: "inherit" });
    }

    // Output dirs the spec commands redirect into
    mkdirSync(join(worktreePath, "findings"), { recursive: true });
    mkdirSync(join(worktreePath, "patches"), { recursive: true });
    mkdirSync(join(worktreePath, "reports"), { recursive: true });

    return { path: worktreePath, branch: branchName };
  } catch (error) {
    console.error(`[audit-orchestrator] Failed to create worktree: ${error.message}`);
    throw error;
  }
}

/**
 * Copy factory-internal assets into the worktree so spec tasks that invoke
 * `scripts/audit-*.mjs` or reference the spec/PRD by relative path resolve
 * correctly inside the isolated checkout. The worktree is built from HEAD,
 * so uncommitted factory scripts would otherwise be missing.
 */
function syncFactoryAssets(worktreePath, spec, specPath) {
  const srcScripts = join(ROOT, "scripts");
  const dstScripts = join(worktreePath, "scripts");
  mkdirSync(dstScripts, { recursive: true });

  for (const file of readdirSync(srcScripts)) {
    if (/^audit-.*\.mjs$/.test(file)) {
      cpSync(join(srcScripts, file), join(dstScripts, file));
    }
  }

  // Copy the spec and PRD preserving their repo-relative paths.
  const repoRelative = (p) => relative(ROOT, resolve(p)).split(sep).join("/");
  for (const p of [specPath, spec.prd?.path]) {
    if (!p) continue;
    const abs = resolve(ROOT, p);
    if (!existsSync(abs)) continue;
    const rel = repoRelative(abs);
    const dst = join(worktreePath, rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(abs, dst);
  }

  // Gitignored-but-required inputs: `legal/` is deliberately untracked
  // (private material) yet check:legal-consolidation fails closed without
  // it. The worktree is a HEAD checkout, so sync it explicitly.
  const legalSrc = join(ROOT, "legal");
  if (existsSync(legalSrc)) {
    cpSync(legalSrc, join(worktreePath, "legal"), { recursive: true });
    console.log(`[audit-orchestrator] Synced gitignored legal/ into worktree`);
  }

  console.log(`[audit-orchestrator] Synced factory scripts, spec and PRD into worktree`);
}

/**
 * Copy audit artifacts produced inside the worktree back into the main
 * checkout so reports survive worktree cleanup.
 */
function copyAuditArtifactsBack(worktreePath, auditId) {
  const copied = [];
  const auditDirName = join("docs", "audits", auditId);

  for (const dir of ["findings", "patches", "reports"]) {
    const src = join(worktreePath, dir);
    if (!existsSync(src)) continue;
    const dst = join(ROOT, dir);
    mkdirSync(dst, { recursive: true });
    cpSync(src, dst, { recursive: true });
    copied.push(dir);
  }

  // JSON reports written under docs/audits/<ID>/ inside the worktree.
  const srcAudit = join(worktreePath, auditDirName);
  if (existsSync(srcAudit)) {
    const dstAudit = join(ROOT, auditDirName);
    mkdirSync(dstAudit, { recursive: true });
    for (const file of readdirSync(srcAudit)) {
      if (file.endsWith(".json")) {
        cpSync(join(srcAudit, file), join(dstAudit, file));
        copied.push(`${auditDirName}/${file}`);
      }
    }
  }

  if (copied.length > 0) {
    console.log(`[audit-orchestrator] Copied artifacts back to main checkout: ${copied.join(", ")}`);
  }
}

/**
 * Execute a single command with timeout.
 */
function executeCommand(command, cwd, timeout = 300000) {
  return new Promise((resolve, reject) => {
    console.log(`[audit-orchestrator] Executing: ${command}`);
    console.log(`[audit-orchestrator] Working directory: ${cwd}`);
    console.log(`[audit-orchestrator] Timeout: ${timeout}ms`);

    const startTime = Date.now();
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    const timeoutId = setTimeout(() => {
      console.error(`[audit-orchestrator] Command timed out after ${timeout}ms`);
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      console.log(`[audit-orchestrator] Command completed in ${duration}ms with exit code ${code}`);

      resolve({
        exitCode: code,
        stdout,
        stderr,
        duration,
      });
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

/**
 * Check if a task is manual (requires human intervention).
 */
function isManualTask(task) {
  // Placeholders the orchestrator substitutes at runtime are not manual —
  // strip them before looking for unresolved "[...]" markers.
  const command = task.command
    .replace(/\[PRD_PATH\]/g, "")
    .replace(/\[ID\]/g, "")
    .replace(/\[slug\]/g, "");
  return command.toLowerCase().includes("manual") ||
         command.includes("[") || // Contains unresolved placeholders
         task.estimatedDuration.includes("Variable");
}

/**
 * Execute a single task.
 */
async function executeTask(task, worktreePath, spec) {
  console.log(`\n[audit-orchestrator] === Task ${task.id}: ${task.title} ===`);
  console.log(`[audit-orchestrator] Phase: ${task.phase}`);
  console.log(`[audit-orchestrator] Description: ${task.description}`);

  // Check if manual task
  if (isManualTask(task)) {
    console.log(`[audit-orchestrator] MANUAL TASK - Skipping automatic execution`);
    console.log(`[audit-orchestrator] Command: ${task.command}`);
    console.log(`[audit-orchestrator] Validation: ${task.validation}`);
    return {
      taskId: task.id,
      status: "manual-required",
      duration: 0,
      error: null,
    };
  }

  // Replace placeholders in command
  let command = task.command;
  command = command.replace(/\[PRD_PATH\]/g, spec.prd.path);
  command = command.replace(/\[ID\]/g, spec.metadata.id);
  command = command.replace(/\[slug\]/g, spec.metadata.id.toLowerCase().replace(/[^a-z0-9]/g, "-"));

  // Determine timeout
  const timeout = task.timeout || 300000; // Default 5 minutes

  try {
    const result = await executeCommand(command, worktreePath, timeout);

    const taskResult = {
      taskId: task.id,
      title: task.title,
      phase: task.phase,
      status: result.exitCode === 0 ? "success" : "failed",
      exitCode: result.exitCode,
      duration: result.duration,
      error: result.exitCode !== 0 ? `Exit code ${result.exitCode}` : null,
    };
    recordTaskResult(worktreePath, taskResult);

    return {
      ...taskResult,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const taskResult = {
      taskId: task.id,
      title: task.title,
      phase: task.phase,
      status: "error",
      duration: 0,
      error: error.message,
    };
    recordTaskResult(worktreePath, taskResult);
    return taskResult;
  }
}

/**
 * Persist per-task exit status into findings/task-results.json inside the
 * worktree so the findings analyzer sees gate failures even when a check
 * script prints no FAIL lines (e.g. knip exits 1 silently).
 */
function recordTaskResult(worktreePath, taskResult) {
  try {
    const resultsPath = join(worktreePath, "findings", "task-results.json");
    let tasks = [];
    if (existsSync(resultsPath)) {
      tasks = JSON.parse(readFileSync(resultsPath, "utf8")).tasks || [];
    }
    tasks = tasks.filter((t) => t.taskId !== taskResult.taskId);
    tasks.push(taskResult);
    mkdirSync(dirname(resultsPath), { recursive: true });
    writeFileSync(resultsPath, JSON.stringify({ tasks }, null, 2));
  } catch {
    // INTENTIONAL SILENCE: telemetry for the analyzer must never break execution.
  }
}

/**
 * Topologically sort tasks based on dependencies.
 */
function topologicalSort(tasks) {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set();
  const tempVisited = new Set();
  const result = [];

  function visit(taskId) {
    if (tempVisited.has(taskId)) {
      throw new Error(`Circular dependency detected involving task ${taskId}`);
    }
    if (visited.has(taskId)) return;

    tempVisited.add(taskId);

    const task = taskMap.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    for (const depId of task.dependencies || []) {
      visit(depId);
    }

    tempVisited.delete(taskId);
    visited.add(taskId);
    result.push(task);
  }

  for (const task of tasks) {
    visit(task.id);
  }

  return result;
}

/**
 * Group tasks by phase for parallel execution.
 */
function groupTasksByPhase(tasks) {
  const phases = {};
  for (const task of tasks) {
    if (!phases[task.phase]) {
      phases[task.phase] = [];
    }
    phases[task.phase].push(task);
  }
  return phases;
}

/**
 * Execute tasks sequentially.
 */
async function executeSequentially(sortedTasks, worktreePath, spec) {
  const results = [];
  let failed = false;

  for (const task of sortedTasks) {
    if (failed) {
      console.log(`[audit-orchestrator] Skipping task ${task.id} due to previous failure`);
      results.push({
        taskId: task.id,
        status: "skipped",
        duration: 0,
        error: "Previous task failed",
      });
      continue;
    }

    const result = await executeTask(task, worktreePath, spec);
    results.push(result);

    const taskFailed = result.status === "failed" || result.status === "error";
    if (taskFailed && task.continueOnFailure) {
      console.log(`[audit-orchestrator] Task ${task.id} failed but continueOnFailure is set — recording as finding and continuing`);
      continue;
    }
    if (taskFailed) {
      failed = true;
      console.error(`[audit-orchestrator] Task ${task.id} failed, stopping execution`);
    }
  }

  return results;
}

/**
 * Execute tasks in parallel within each phase.
 */
async function executeParallelByPhase(sortedTasks, worktreePath, spec) {
  const phases = groupTasksByPhase(sortedTasks);
  const results = [];
  let failed = false;

  // Define phase execution order
  const phaseOrder = ["setup", "execution", "analysis", "fixes", "verification", "acceptance", "ship"];

  for (const phaseName of phaseOrder) {
    if (failed) break;

    const phaseTasks = phases[phaseName] || [];
    if (phaseTasks.length === 0) continue;

    console.log(`\n[audit-orchestrator] === Phase: ${phaseName} ===`);
    console.log(`[audit-orchestrator] Tasks: ${phaseTasks.length}`);

    // Execute tasks in this phase in parallel
    const phaseResults = await Promise.all(
      phaseTasks.map((task) => executeTask(task, worktreePath, spec))
    );

    results.push(...phaseResults);

    // Check if any task in this phase failed (continueOnFailure tasks
    // record findings instead of stopping the pipeline)
    const phaseFailed = phaseResults.some((r, i) => {
      const taskFailed = r.status === "failed" || r.status === "error";
      return taskFailed && !phaseTasks[i]?.continueOnFailure;
    });
    if (phaseFailed) {
      failed = true;
      console.error(`[audit-orchestrator] Phase ${phaseName} had failures, stopping execution`);
    }
  }

  return results;
}

/**
 * Generate execution report.
 */
function generateExecutionReport(spec, results, worktreePath, mode) {
  const report = {
    metadata: {
      specId: spec.metadata.id,
      executedAt: new Date().toISOString(),
      orchestratorVersion: "1.0.0",
      executionMode: mode,
      worktreePath,
    },
    summary: {
      totalTasks: results.length,
      successful: results.filter((r) => r.status === "success").length,
      failed: results.filter((r) => r.status === "failed").length,
      errors: results.filter((r) => r.status === "error").length,
      manualRequired: results.filter((r) => r.status === "manual-required").length,
      skipped: results.filter((r) => r.status === "skipped").length,
    },
    results: results.map((r) => ({
      taskId: r.taskId,
      status: r.status,
      duration: r.duration,
      exitCode: r.exitCode,
      error: r.error,
    })),
    phases: {},
  };

  // Group results by phase
  const taskMap = new Map(spec.tasks.map((t) => [t.id, t]));
  for (const result of results) {
    const task = taskMap.get(result.taskId);
    if (task) {
      if (!report.phases[task.phase]) {
        report.phases[task.phase] = {
          total: 0,
          successful: 0,
          failed: 0,
          manual: 0,
        };
      }
      report.phases[task.phase].total++;
      if (result.status === "success") report.phases[task.phase].successful++;
      if (result.status === "failed" || result.status === "error") report.phases[task.phase].failed++;
      if (result.status === "manual-required") report.phases[task.phase].manual++;
    }
  }

  return report;
}

/**
 * Main orchestration function.
 */
async function orchestrate(specPath, options = {}) {
  const { mode = "sequential", dryRun = false } = options;

  console.log(`[audit-orchestrator] Loading spec: ${specPath}`);
  const spec = loadSpec(specPath);
  console.log(`[audit-orchestrator] Spec ID: ${spec.metadata.id}`);
  console.log(`[audit-orchestrator] Tasks: ${spec.tasks.length}`);
  console.log(`[audit-orchestrator] Scripts: ${spec.scripts.length}`);
  console.log(`[audit-orchestrator] Execution mode: ${mode}`);
  console.log(`[audit-orchestrator] Dry run: ${dryRun}`);

  // Create worktree
  const worktree = createWorktree(spec);
  console.log(`[audit-orchestrator] Worktree: ${worktree.path}`);
  console.log(`[audit-orchestrator] Branch: ${worktree.branch}`);
  syncFactoryAssets(worktree.path, spec, specPath);

  if (dryRun) {
    console.log("[audit-orchestrator] DRY RUN - Would execute the following tasks:");
    for (const task of spec.tasks) {
      console.log(`  - ${task.id}: ${task.title} (${task.phase})`);
    }
    return { dryRun: true, worktree };
  }

  // Sort tasks by dependencies
  console.log("[audit-orchestrator] Sorting tasks by dependencies...");
  const sortedTasks = topologicalSort(spec.tasks);
  console.log(`[audit-orchestrator] Sorted ${sortedTasks.length} tasks`);

  // Execute tasks
  let results;
  if (mode === "parallel") {
    console.log("[audit-orchestrator] Executing tasks in parallel by phase...");
    results = await executeParallelByPhase(sortedTasks, worktree.path, spec);
  } else {
    console.log("[audit-orchestrator] Executing tasks sequentially...");
    results = await executeSequentially(sortedTasks, worktree.path, spec);
  }

  // Generate report
  const report = generateExecutionReport(spec, results, worktree.path, mode);

  // Write report
  const reportPath = join(worktree.path, "docs", "audits", spec.metadata.id, "execution-report.json");
  const reportDir = dirname(reportPath);
  if (!existsSync(reportDir)) {
    mkdirSync(reportDir, { recursive: true });
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Persist artifacts into the main checkout before any worktree cleanup.
  copyAuditArtifactsBack(worktree.path, spec.metadata.id);

  console.log(`\n[audit-orchestrator] Execution complete`);
  console.log(`[audit-orchestrator] Successful: ${report.summary.successful}`);
  console.log(`[audit-orchestrator] Failed: ${report.summary.failed}`);
  console.log(`[audit-orchestrator] Errors: ${report.summary.errors}`);
  console.log(`[audit-orchestrator] Manual required: ${report.summary.manualRequired}`);
  console.log(`[audit-orchestrator] Report: ${reportPath}`);

  return { report, worktree, results };
}

/**
 * Main CLI entry point.
 */
async function main() {
  const args = process.argv.slice(2);
  const specIndex = args.indexOf("--spec");
  const modeIndex = args.indexOf("--mode");
  const dryRun = args.includes("--dry-run");

  if (specIndex === -1 || !args[specIndex + 1]) {
    console.error("Usage: node scripts/audit-orchestrator.mjs --spec <path> [--mode sequential|parallel] [--dry-run]");
    process.exit(1);
  }

  const specPath = args[specIndex + 1];
  const mode = modeIndex !== -1 ? args[modeIndex + 1] : "sequential";

  try {
    const result = await orchestrate(specPath, { mode, dryRun });

    // Exit with non-zero if any task failed
    if (!dryRun && result.report.summary.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`[audit-orchestrator] Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

export { orchestrate, createWorktree, executeCommand, topologicalSort };
