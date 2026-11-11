#!/usr/bin/env node
/**
 * scripts/export-check-summary.mjs — Exports a JSON summary of the LIVE_SURFACE
 * checks with their IDs and observables, for consumption from CI or external scripts.
 *
 * Usage: node scripts/export-check-summary.mjs [--json] [--file <path>]
 *   --json          : output to stdout (default: human-readable)
 *   --file <path>   : write JSON to a file instead of stdout
 *   --markdown     : also generate a markdown table alongside the JSON
 *
 * The script reads docs/audit.md, extracts the live-surface rows and generates:
 * - check.id : stable pair ID (anchored row-identity, not truncated)
 * - check.observable : the verified numeric value or figure
 * - check.command : associated command
 * - check.row : row name
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pairCheckId } from "./check-audit-freshness.mjs";
import { parseLiveSurfaceTable } from "./check-audit-freshness.mjs";

const isMain = 
  process.argv[1] && 
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\\\/g, "/")}`).href;

if (!isMain) {
  console.error("This script must be run directly, not imported.");
  process.exit(1);
}

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const asFile = argv.includes("--file");
const outputFile = argv.find((arg, i) => arg === "--file" && argv[i + 1]) ? argv[argv.indexOf("--file") + 1] : null;
const asMarkdown = argv.includes("--markdown");

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const docPath = join(repoRoot, "docs", "audit.md");

if (!existsSync(docPath)) {
  console.error(`[export-check-summary] FAIL ${docPath} not found`);
  process.exit(1);
}

const docText = readFileSync(docPath, "utf8");
const { rows } = parseLiveSurfaceTable(docText);

const summary = {
  generatedAt: new Date().toISOString(),
  docPath,
  rowCount: rows.length,
  checks: [],
};

// Build a map of row -> verification from the live surface table
for (const row of rows) {
  // Each row has assertion and verification cells
  const assertion = row.assertion || row.verification || "";
  const verification = row.verification || row.assertion || "";
  
  // Generate stable ID anchored to row identity
  const checkId = pairCheckId(assertion, verification, new Set());
  
  summary.checks.push({
    id: checkId,
    row: assertion || verification || "unknown",
    observable: verification || assertion || "",
    command: `${assertion} → ${verification}`.replace(/\s+/g, " ").trim(),
  });
}

const jsonOutput = JSON.stringify(summary, null, 2);

if (asFile && outputFile) {
  const outDir = outputFile.includes("/") ? outputFile.replace(/\/[^\/]+$/, "") : repoRoot;
  // ensure directory exists
  try { mkdirSync(outDir, { recursive: true }); } catch /* INTENTIONAL SILENCE: directory may already exist or race condition */ {}
  writeFileSync(outputFile, jsonOutput);
  console.log(`[export-check-summary] JSON written to ${outputFile}`);
} else if (asJson) {
  console.log(jsonOutput);
} else {
  // Human-readable output
  console.log(`\n=== Live Surface Checks Summary ===`);
  console.log(`Generated: ${new Date().toLocaleString()}`);
  console.log(`Total checks: ${summary.checks.length}\n`);
  
  for (const check of summary.checks) {
    console.log(`ID:    ${check.id}`);
    console.log(`Row:   ${check.row}`);
    console.log(`Obs:   ${check.observable}`);
    console.log(`Cmd:   ${check.command}`);
    console.log("-".repeat(40));
  }
  
  if (asMarkdown) {
    console.log("\n=== Markdown Table ===");
    console.log("| ID | Row | Observable |");
    console.log("|----|-----|------------|");
    for (const check of summary.checks) {
      console.log(`| \`${check.id}\` | ${check.row} | ${check.observable} |`);
    }
  }
}

process.exit(0);