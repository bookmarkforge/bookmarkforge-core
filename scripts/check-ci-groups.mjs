#!/usr/bin/env node
/**
 * scripts/check-ci-groups.mjs — run the CI groups defined in ci-groups.json.
 *
 * Usage:
 *   node scripts/check-ci-groups.mjs                  # list the groups
 *   node scripts/check-ci-groups.mjs <group-name>     # run one group
 *   node scripts/check-ci-groups.mjs --list           # list without running
 *   node scripts/check-ci-groups.mjs --all            # every group, sequentially
 *   node scripts/check-ci-groups.mjs --fast           # core-integrity + security-environment
 *
 * Each command in ci-groups.json is an npm alias and runs verbatim as
 * `npm run <alias>`; it is never rewritten (the old runner stripped the
 * `check:` prefix and invoked the bare alias name, so every group failed on
 * its first step).
 * Aliases are validated against package.json before anything runs, so a
 * renamed gate fails here with the offending name instead of mid-group.
 *
 * A failing command does not skip the rest of its group: the summary reports
 * every member and the process exits non-zero if any of them failed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const GROUPS_FILE = join(__dirname, "ci-groups.json");
const PACKAGE_FILE = join(ROOT, "package.json");

/** Per-command fallback when a group does not declare timeout_ms. */
const DEFAULT_TIMEOUT_MS = 600000;

/** npm on Windows is a .cmd shim, so every spawn goes through the shell. */
const USE_SHELL = process.platform === "win32";

function fail(message) {
  console.error(`[check:ci-groups] ${message}`);
  process.exit(1);
}

function loadGroups() {
  if (!existsSync(GROUPS_FILE)) {
    fail(`ci-groups.json not found at ${GROUPS_FILE}`);
  }
  if (!existsSync(PACKAGE_FILE)) {
    fail(`package.json not found at ${PACKAGE_FILE}`);
  }
  const data = JSON.parse(readFileSync(GROUPS_FILE, "utf8"));
  const scripts = JSON.parse(readFileSync(PACKAGE_FILE, "utf8")).scripts ?? {};

  if (!Array.isArray(data.groups) || data.groups.length === 0) {
    fail("ci-groups.json declares no groups");
  }

  const seen = new Set();
  for (const group of data.groups) {
    if (!group.name || seen.has(group.name)) {
      fail(`group names must be unique and non-empty (got "${group.name}")`);
    }
    seen.add(group.name);
    if (!Array.isArray(group.commands) || group.commands.length === 0) {
      fail(`group "${group.name}" declares no commands`);
    }
    const unknown = group.commands.filter((cmd) => !Object.hasOwn(scripts, cmd));
    if (unknown.length > 0) {
      fail(
        `group "${group.name}" references aliases missing from package.json: ${unknown.join(", ")} — fix ci-groups.json (an alias is run as npm run <alias>)`,
      );
    }
    if (group.timeout_ms !== undefined && !(Number.isFinite(group.timeout_ms) && group.timeout_ms > 0)) {
      fail(`group "${group.name}" has an invalid timeout_ms`);
    }
  }
  return data.groups;
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/** Run one alias exactly as declared; npm resolves the script body. */
function runAlias(alias, timeoutMs) {
  const t0 = Date.now();
  const result = spawnSync("npm", ["run", alias], {
    cwd: ROOT,
    shell: USE_SHELL,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  const elapsed = Date.now() - t0;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const timedOut = result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM";
  return { alias, elapsed, status: result.status, timedOut, output, error: result.error };
}

function runGroup(group) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`📦 Group: ${group.label} (${group.name})`);
  console.log("═".repeat(60));
  console.log(`Purpose: ${group.purpose}`);
  console.log(`Estimated time: ${formatMs(group.typical_time_ms)}`);
  console.log("");

  const timeoutMs = group.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const rows = [];
  const t0 = Date.now();

  for (const alias of group.commands) {
    const run = runAlias(alias, timeoutMs);
    const ok = run.status === 0;
    const status = ok ? "✅ PASS" : run.timedOut ? `⏱️ TIMEOUT (${formatMs(timeoutMs)})` : `❌ FAIL (exit ${run.status ?? "?"})`;
    rows.push({ alias, ok, elapsed: run.elapsed, status });
    console.log(`  ${alias.padEnd(32)} ${status}  ${formatMs(run.elapsed)}`);
    if (!ok) {
      const tail = run.output.trimEnd().split("\n").slice(-15).join("\n");
      if (tail) {
        console.log(`  ${"─".repeat(55)}`);
        console.log(tail.split("\n").map((line) => `  ${line}`).join("\n"));
      }
      if (run.error) console.log(`  ${run.error.message}`);
    }
  }

  const totalMs = Date.now() - t0;
  const passed = rows.filter((row) => row.ok).length;
  const failed = rows.length - passed;
  console.log(`\n  Result: ${passed}/${rows.length} passed in ${formatMs(totalMs)}`);
  console.log(`${"═".repeat(60)}\n`);
  return { name: group.name, failed: failed > 0, totalMs, passed, rows };
}

function listGroups(groups) {
  console.log("\n📋 Available CI groups:\n");
  console.log(`${"Group".padEnd(22)} ${"Name".padEnd(24)} ${"Est. time".padEnd(12)} ${"Failure".padEnd(10)} Description`);
  console.log("-".repeat(110));
  for (const g of groups) {
    const freq = g.fail_frequency === "high" ? "🔴 High" : g.fail_frequency === "medium" ? "🟡 Medium" : "🟢 Low";
    const label = String(g.label).padEnd(22).slice(0, 22);
    const name = g.name.padEnd(24);
    const time = formatMs(g.typical_time_ms).padEnd(12);
    console.log(`  ${label} ${name} ${time} ${freq.padEnd(10)} ${g.purpose}`);
  }
  console.log("");
  console.log("Usage:");
  console.log("  node scripts/check-ci-groups.mjs <group-name>      # run one group");
  console.log("  node scripts/check-ci-groups.mjs --list            # list only");
  console.log("  node scripts/check-ci-groups.mjs --all             # every group, sequentially");
  console.log("  node scripts/check-ci-groups.mjs --fast            # core-integrity + security-environment");
  console.log("");
}

function runAll(groups) {
  console.log("🚀 Running all CI groups sequentially...\n");
  const t0 = Date.now();
  const results = groups.map((group) => runGroup(group));
  const overallFailed = results.some((result) => result.failed);

  console.log(`\n${"═".repeat(60)}`);
  console.log("📊 GLOBAL SUMMARY");
  console.log("═".repeat(60));
  for (const r of results) {
    const icon = r.failed ? "❌" : "✅";
    console.log(`  ${icon} ${r.name.padEnd(28)} ${r.passed}/${r.rows.length}  ${formatMs(r.totalMs)}`);
  }
  console.log(`\n  Total time: ${formatMs(Date.now() - t0)}`);
  console.log(`  Status: ${overallFailed ? "❌ FAILED" : "✅ ALL PASS"}`);
  console.log("═".repeat(60) + "\n");

  process.exit(overallFailed ? 1 : 0);
}

function runFast(groups) {
  const wanted = ["core-integrity", "security-environment"];
  const critical = groups.filter((group) => wanted.includes(group.name));
  if (critical.length !== wanted.length) {
    fail(`--fast needs the groups ${wanted.join(" + ")} in ci-groups.json`);
  }
  console.log("⚡ Running the fast groups (core-integrity + security-environment)...\n");
  const t0 = Date.now();
  let failed = false;
  for (const group of critical) {
    const result = runGroup(group);
    if (result.failed) failed = true;
  }
  console.log(`\n⏱️  Time: ${formatMs(Date.now() - t0)}`);
  process.exit(failed ? 1 : 0);
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const groups = loadGroups();

if (args.includes("--list")) {
  listGroups(groups);
} else if (args.includes("--all")) {
  runAll(groups);
} else if (args.includes("--fast")) {
  runFast(groups);
} else if (args.length > 0 && !args[0].startsWith("--")) {
  const group = groups.find((candidate) => candidate.name === args[0]);
  if (!group) {
    console.error(`Group '${args[0]}' not found.`);
    listGroups(groups);
    process.exit(1);
  }
  const result = runGroup(group);
  process.exit(result.failed ? 1 : 0);
} else {
  listGroups(groups);
}
