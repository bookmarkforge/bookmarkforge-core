#!/usr/bin/env node
/**
 * scripts/check-ci-groups.mjs — runs CI groups defined in ci-groups.json
 *
 * Uso:
 *   node scripts/check-ci-groups.mjs                  # list all available groups
 *   node scripts/check-ci-groups.mjs core-integrity    # run the specific group
 *   node scripts/check-ci-groups.mjs --list            # list without running
 *   node scripts/check-ci-groups.mjs --all             # run all groups in order
 *
 * Each group runs sequentially inside the group, and groups run in parallel
 * when --all is used. Results are summarized at the end with per-group time.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GROUPS_FILE = join(__dirname, "ci-groups.json");

function loadGroups() {
  if (!existsSync(GROUPS_FILE)) {
    console.error(`[check:ci-groups] ci-groups.json not found at ${GROUPS_FILE}`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(GROUPS_FILE, "utf8"));
  return data.groups;
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function runGroup(group) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`📦 Grupo: ${group.label}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`Purpose: ${group.purpose}`);
  console.log(`Estimated time: ${formatMs(group.typical_time_ms)}`);
  console.log("");

  const rows = [];
  let failed = false;
  const t0 = Date.now();

  for (const cmd of group.commands) {
    const cmdT0 = Date.now();
    // Convertir check:nombre a npm run nombre
    // Convertir check:nombre a npm run nombre
    const result = spawnSync("npm", ["run", cmd.replace(/^check:/, "")], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 120000,
    });
    const elapsed = Date.now() - cmdT0;
    const status = result.status === 0 ? "✅ PASS" : `❌ FAIL (${elapsed}ms)`;
    rows.push({ command: cmd, status, elapsed });
    if (result.status !== 0) failed = true;
    console.log(`  ${cmd.padEnd(35)} ${status}`);
    if (result.status !== 0 && result.stderr) {
      const errorLines = result.stderr.split("\n").slice(0, 5).join("\n");
      console.log(`  ${"─".repeat(50)}`);
      console.log(`  ${errorLines}`);
    }
    if (failed) break; // fail-fast per group
  }

  const totalMs = Date.now() - t0;
  const passed = rows.filter(r => r.status.startsWith("✅")).length;
  console.log(`\n  Result: ${passed}/${rows.length} passed in ${formatMs(totalMs)}`);
  console.log(`${"═".repeat(60)}\n`);
  return { name: group.name, failed, totalMs, passed, rows };
}

function listGroups(groups) {
  console.log("\n📋 Available CI groups:\n");
  console.log(`${"Group".padEnd(25)} ${"Est. time".padEnd(15)} ${"Failure frequency".padEnd(20)} ${"Description"}`);
  console.log("-".repeat(95));
  for (const g of groups) {
    const freq = g.fail_frequency === "high" ? "🔴 High" : g.fail_frequency === "medium" ? "🟡 Medium" : "🟢 Low";
    const label = g.label.padEnd(25).slice(0, 25);
    const time = formatMs(g.typical_time_ms).padEnd(15);
    const freqLabel = freq.padEnd(20);
    console.log(`  ${label} ${time} ${freqLabel} ${g.purpose}`);
  }
  console.log("");
  console.log("Usage:");
  console.log("  node scripts/check-ci-groups.mjs <group-name>      # Run a specific group");
  console.log("  node scripts/check-ci-groups.mjs --list            # List only");
  console.log("  node scripts/check-ci-groups.mjs --all             # Run every group");
  console.log("  node scripts/check-ci-groups.mjs --fast            # Critical groups only (core + security)");
  console.log("");
}

function runAll(groups) {
  console.log("🚀 Running all CI groups...\n");
  const t0 = Date.now();
  const results = [];
  let overallFailed = false;

  for (const group of groups) {
    const result = runGroup(group);
    results.push(result);
    if (result.failed) overallFailed = true;
  }

  const totalMs = Date.now() - t0;
  console.log("\n" + "═".repeat(60));
  console.log("📊 GLOBAL SUMMARY");
  console.log("═".repeat(60));
  for (const r of results) {
    const icon = r.failed ? "❌" : "✅";
    console.log(`  ${icon} ${r.name.padEnd(30)} ${r.passed}/${r.rows.length}  ${formatMs(r.totalMs)}`);
  }
  console.log(`\n  Total time: ${formatMs(totalMs)}`);
  console.log(`  Status: ${overallFailed ? "❌ FAILED" : "✅ ALL PASS"}`);
  console.log("═".repeat(60) + "\n");

  process.exit(overallFailed ? 1 : 0);
}

function runFast(groups) {
  // Critical groups only: core-integrity + security-environment
  const critical = groups.filter(g => g.name === "core-integrity" || g.name === "security-environment");
  console.log("⚡ Running fast group (core-integrity + security-environment)...\n");
  const t0 = Date.now();
  let failed = false;
  for (const group of critical) {
    const result = runGroup(group);
    if (result.failed) failed = true;
  }
  console.log(`\n⏱️  Tiempo: ${formatMs(Date.now() - t0)}`);
  process.exit(failed ? 1 : 0);
}

// ── CLI ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const groups = loadGroups();

if (args.includes("--list")) {
  listGroups(groups);
} else if (args.includes("--all")) {
  runAll(groups);
} else if (args.includes("--fast")) {
  runFast(groups);
} else if (args.length > 0 && !args[0].startsWith("--")) {
  const groupName = args[0];
  const group = groups.find(g => g.name === groupName);
  if (!group) {
    console.error(`Grupo '${groupName}' no encontrado.`);
    listGroups(groups);
    process.exit(1);
  }
  const result = runGroup(group);
  process.exit(result.failed ? 1 : 0);
} else {
  listGroups(groups);
}
