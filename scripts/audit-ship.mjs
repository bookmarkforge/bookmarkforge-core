#!/usr/bin/env node
/**
 * scripts/audit-ship.mjs — Audit Ship Agent
 *
 * Final gate that decides how to integrate audit results:
 * - direct-merge: Fast-forward to main if safe
 * - pr: Create PR with findings and verification report
 * - park: Keep worktree and branch for later review
 *
 * This is the ship stage of the Software Factory audit pipeline.
 *
 * Usage:
 *   node scripts/audit-ship.mjs --mode <direct-merge|pr|park> [--worktree <path>] [--branch <name>]
 *
 * Example:
 *   node scripts/audit-ship.mjs --mode pr --worktree ../audit-AUDIT-001 --branch audit/AUDIT-001
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

/**
 * Check if direct merge is safe.
 */
function canDirectMerge(worktreePath) {
  try {
    // Check if we're on a clean state
    const status = execSync("git status --porcelain", { cwd: worktreePath }).toString();
    if (status.trim()) {
      console.log("[audit-ship] Worktree has uncommitted changes, cannot direct merge");
      return false;
    }

    // Check if main branch is protected (simplified check)
    const branch = execSync("git branch --show-current", { cwd: worktreePath }).toString().trim();
    if (branch === "main" || branch === "master") {
      console.log("[audit-ship] On main branch, direct merge not recommended");
      return false;
    }

    return true;
  } catch (error) {
    console.error(`[audit-ship] Error checking merge safety: ${error.message}`);
    return false;
  }
}

/**
 * Execute direct merge.
 */
function directMerge(worktreePath, branchName) {
  console.log(`[audit-ship] Attempting direct merge of ${branchName} to main`);

  try {
    // Switch to main
    execSync("git checkout main", { cwd: ROOT, stdio: "inherit" });

    // Pull latest
    execSync("git pull origin main", { cwd: ROOT, stdio: "inherit" });

    // Merge the audit branch
    execSync(`git merge ${branchName}`, { cwd: ROOT, stdio: "inherit" });

    // Push
    execSync("git push origin main", { cwd: ROOT, stdio: "inherit" });

    // Clean up worktree
    execSync(`git worktree remove "${worktreePath}"`, { cwd: ROOT, stdio: "inherit" });
    execSync(`git branch -d ${branchName}`, { cwd: ROOT, stdio: "inherit" });

    console.log(`[audit-ship] Direct merge completed successfully`);
    return { success: true, method: "direct-merge" };
  } catch (error) {
    console.error(`[audit-ship] Direct merge failed: ${error.message}`);
    return { success: false, method: "direct-merge", error: error.message };
  }
}

/**
 * Create pull request.
 */
function createPR(worktreePath, branchName, prTitle, prBody) {
  console.log(`[audit-ship] Creating PR for ${branchName}`);

  try {
    // Push branch
    execSync(`git push -u origin ${branchName}`, { cwd: worktreePath, stdio: "inherit" });

    // Create PR using gh CLI if available
    try {
      execSync(
        `gh pr create --title "${prTitle}" --body "${prBody}" --base main`,
        { cwd: worktreePath, stdio: "inherit" }
      );
      console.log(`[audit-ship] PR created successfully`);
      return { success: true, method: "pr" };
    } catch {
      console.warn(`[audit-ship] gh CLI not available or failed, PR not created`);
      console.warn(`[audit-ship] Branch pushed, create PR manually on GitHub`);
      return { success: true, method: "pr-manual", branch: branchName };
    }
  } catch (error) {
    console.error(`[audit-ship] PR creation failed: ${error.message}`);
    return { success: false, method: "pr", error: error.message };
  }
}

/**
 * Park worktree for later.
 */
function parkWorktree(worktreePath, branchName) {
  console.log(`[audit-ship] Parking worktree at ${worktreePath}`);
  console.log(`[audit-ship] Branch: ${branchName}`);
  console.log(`[audit-ship] To resume: cd ${worktreePath} && git checkout ${branchName}`);

  return {
    success: true,
    method: "park",
    worktreePath,
    branch: branchName,
    resumeCommand: `cd ${worktreePath} && git checkout ${branchName}`,
  };
}

/**
 * Main ship function.
 */
function ship(options) {
  const { mode, worktreePath, branchName, prTitle, prBody } = options;

  console.log(`[audit-ship] Ship mode: ${mode}`);
  console.log(`[audit-ship] Worktree: ${worktreePath}`);
  console.log(`[audit-ship] Branch: ${branchName}`);

  // Validate inputs
  if (!worktreePath || !existsSync(worktreePath)) {
    console.error(`[audit-ship] Worktree not found: ${worktreePath}`);
    return { success: false, error: "Worktree not found" };
  }

  if (!branchName) {
    console.error(`[audit-ship] Branch name required`);
    return { success: false, error: "Branch name required" };
  }

  let result;

  switch (mode) {
    case "direct-merge":
      if (!canDirectMerge(worktreePath)) {
        console.log(`[audit-ship] Direct merge not safe, falling back to PR mode`);
        result = createPR(worktreePath, branchName, prTitle || "Audit findings", prBody || "Automated audit results");
      } else {
        result = directMerge(worktreePath, branchName);
      }
      break;

    case "pr":
      result = createPR(worktreePath, branchName, prTitle || "Audit findings", prBody || "Automated audit results");
      break;

    case "park":
      result = parkWorktree(worktreePath, branchName);
      break;

    default:
      console.error(`[audit-ship] Invalid mode: ${mode}`);
      return { success: false, error: `Invalid mode: ${mode}` };
  }

  // Write ship report
  const reportPath = join(worktreePath, "docs", "audits", "ship-report.json");
  const reportDir = dirname(reportPath);
  if (!existsSync(reportDir)) {
    // Create directory if needed
  }

  try {
    const { writeFileSync, mkdirSync } = require("fs");
    if (!existsSync(reportDir)) {
      mkdirSync(reportDir, { recursive: true });
    }
    writeFileSync(reportPath, JSON.stringify({
      metadata: {
        shippedAt: new Date().toISOString(),
        shipVersion: "1.0.0",
      },
      ...result,
    }, null, 2));
  } catch (error) {
    console.warn(`[audit-ship] Could not write ship report: ${error.message}`);
  }

  return result;
}

/**
 * Main CLI entry point.
 */
function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf("--mode");
  const worktreeIndex = args.indexOf("--worktree");
  const branchIndex = args.indexOf("--branch");
  const titleIndex = args.indexOf("--title");
  const bodyIndex = args.indexOf("--body");

  if (modeIndex === -1 || !args[modeIndex + 1]) {
    console.error("Usage: node scripts/audit-ship.mjs --mode <direct-merge|pr|park> [--worktree <path>] [--branch <name>] [--title <title>] [--body <body>]");
    process.exit(1);
  }

  const mode = args[modeIndex + 1];
  const worktreePath = worktreeIndex !== -1 ? args[worktreeIndex + 1] : null;
  const branchName = branchIndex !== -1 ? args[branchIndex + 1] : null;
  const prTitle = titleIndex !== -1 ? args[titleIndex + 1] : null;
  const prBody = bodyIndex !== -1 ? args[bodyIndex + 1] : null;

  try {
    const result = ship({ mode, worktreePath, branchName, prTitle, prBody });

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`[audit-ship] Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

export { ship, canDirectMerge, directMerge, createPR, parkWorktree };
