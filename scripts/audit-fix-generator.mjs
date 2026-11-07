#!/usr/bin/env node
/**
 * scripts/audit-fix-generator.mjs — Fix Generator Agent
 *
 * Generates automated patches for findings that allow it (baseline updates,
 * config file changes, documentation updates). Creates a patches directory
 * with proposed changes for human review.
 *
 * This is the fix generation stage of the Software Factory audit pipeline.
 *
 * Usage:
 *   node scripts/audit-fix-generator.mjs --input <findings.json> --output <patches-dir> [--apply]
 *
 * Example:
 *   node scripts/audit-fix-generator.mjs --input findings/aggregated.json --output patches/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

/**
 * Load aggregated findings.
 */
function loadFindings(findingsPath) {
  if (!existsSync(findingsPath)) {
    throw new Error(`Findings file not found: ${findingsPath}`);
  }

  const data = JSON.parse(readFileSync(findingsPath, "utf8"));
  return data.findings || [];
}

/**
 * Generate patch for baseline drift finding.
 */
function generateBaselinePatch(finding) {
  const patches = [];

  if (finding.message.toLowerCase().includes("audit-drift")) {
    patches.push({
      type: "command",
      description: "Update audit drift baseline",
      command: "node scripts/check-audit-drift.mjs --fix",
      file: "scripts/audit-drift-baseline.json",
    });
  }

  if (finding.message.toLowerCase().includes("i18n-quality")) {
    patches.push({
      type: "command",
      description: "Update i18n quality baseline",
      command: "node scripts/check-i18n-quality.mjs --fix",
      file: "scripts/i18n-quality-baseline.json",
    });
  }

  if (finding.message.toLowerCase().includes("baseline-drift")) {
    patches.push({
      type: "command",
      description: "Update baseline drift",
      command: "node scripts/check-baseline-drift.mjs --update-snapshots",
      file: "scripts/baseline-drift.json",
    });
  }

  return patches;
}

/**
 * Generate patch for dependency vulnerability.
 */
function generateDependencyPatch(finding) {
  const patches = [];

  if (finding.package) {
    patches.push({
      type: "command",
      description: `Update ${finding.package} to patched version`,
      command: `npm update ${finding.package}`,
      file: "package.json",
      note: "Review changelog before applying",
    });
  }

  patches.push({
    type: "command",
    description: "Run npm audit fix for automatic fixes",
    command: "npm audit fix",
    file: "package-lock.json",
    note: "May update multiple packages, review carefully",
  });

  return patches;
}

/**
 * Generate patch for i18n issues.
 */
function generateI18nPatch(finding) {
  const patches = [];

  if (finding.message.toLowerCase().includes("missing key")) {
    patches.push({
      type: "manual",
      description: "Add missing i18n keys to all 30 locales",
      file: "public/locales/*.json",
      note: "Use npm run check:content to identify missing keys, add translations manually or use auto-translate script",
    });
  }

  return patches;
}

/**
 * Generate patch for documentation issues.
 */
function generateDocumentationPatch(finding) {
  const patches = [];

  if (finding.message.toLowerCase().includes("docs") ||
      finding.message.toLowerCase().includes("documentation")) {
    patches.push({
      type: "manual",
      description: "Update documentation to reflect current state",
      file: "docs/*.md",
      note: "Review docs/audit.md and update Verified status table if needed",
    });
  }

  return patches;
}

/**
 * Generate patches for all auto-fixable findings.
 */
function generatePatches(findings) {
  const patches = [];
  const autoFixable = findings.filter((f) => f.autoFixable);

  console.log(`[audit-fix-generator] Processing ${autoFixable.length} auto-fixable findings`);

  for (const finding of autoFixable) {
    let findingPatches = [];

    // Determine patch type based on finding
    if (finding.type === "check-error" &&
        (finding.message.toLowerCase().includes("baseline") ||
         finding.message.toLowerCase().includes("drift"))) {
      findingPatches = generateBaselinePatch(finding);
    } else if (finding.type === "dependency-vulnerability") {
      findingPatches = generateDependencyPatch(finding);
    } else if (finding.type === "check-error" &&
               finding.message.toLowerCase().includes("i18n")) {
      findingPatches = generateI18nPatch(finding);
    } else if (finding.type === "check-error" &&
               (finding.message.toLowerCase().includes("docs") ||
                finding.message.toLowerCase().includes("documentation"))) {
      findingPatches = generateDocumentationPatch(finding);
    }

    if (findingPatches.length > 0) {
      patches.push({
        findingId: finding.id || `${finding.type}-${findings.indexOf(finding)}`,
        findingType: finding.type,
        findingMessage: finding.message,
        severity: finding.severity,
        patches: findingPatches,
      });
    }
  }

  return patches;
}

/**
 * Write patches to directory.
 */
function writePatches(patches, outputDir) {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Write individual patch files
  for (const patchGroup of patches) {
    const patchFile = join(outputDir, `${patchGroup.findingId}.json`);
    writeFileSync(patchFile, JSON.stringify(patchGroup, null, 2));
  }

  // Write summary
  const summary = {
    metadata: {
      generatedAt: new Date().toISOString(),
      generatorVersion: "1.0.0",
      totalPatchGroups: patches.length,
    },
    patches: patches.map((p) => ({
      findingId: p.findingId,
      findingType: p.findingType,
      severity: p.severity,
      patchCount: p.patches.length,
    })),
  };

  writeFileSync(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));

  return summary;
}

/**
 * Apply patches (execute commands).
 */
function applyPatches(patchesDir) {
  const summaryPath = join(patchesDir, "summary.json");
  if (!existsSync(summaryPath)) {
    throw new Error(`Patch summary not found: ${summaryPath}`);
  }

  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  console.log(`[audit-fix-generator] Applying ${summary.totalPatchGroups} patch groups`);

  const results = [];

  for (const patchInfo of summary.patches) {
    const patchFile = join(patchesDir, `${patchInfo.findingId}.json`);
    const patchGroup = JSON.parse(readFileSync(patchFile, "utf8"));

    for (const patch of patchGroup.patches) {
      if (patch.type === "command") {
        console.log(`[audit-fix-generator] Executing: ${patch.command}`);
        console.log(`[audit-fix-generator] Description: ${patch.description}`);

        try {
          execSync(patch.command, { cwd: ROOT, stdio: "inherit" });
          results.push({
            findingId: patchGroup.findingId,
            command: patch.command,
            status: "success",
          });
        } catch (error) {
          console.error(`[audit-fix-generator] Failed: ${patch.command}`);
          results.push({
            findingId: patchGroup.findingId,
            command: patch.command,
            status: "failed",
            error: error.message,
          });
        }
      } else if (patch.type === "manual") {
        console.log(`[audit-fix-generator] MANUAL PATCH REQUIRED: ${patch.description}`);
        console.log(`[audit-fix-generator] File: ${patch.file}`);
        console.log(`[audit-fix-generator] Note: ${patch.note}`);
        results.push({
          findingId: patchGroup.findingId,
          type: "manual",
          description: patch.description,
          status: "manual-required",
        });
      }
    }
  }

  return results;
}

/**
 * Main function.
 */
function generate(inputPath, outputDir, options = {}) {
  const { apply = false } = options;

  console.log(`[audit-fix-generator] Loading findings: ${inputPath}`);
  const findings = loadFindings(inputPath);
  console.log(`[audit-fix-generator] Loaded ${findings.length} findings`);

  if (apply) {
    console.log(`[audit-fix-generator] Applying patches from: ${outputDir}`);
    const results = applyPatches(outputDir);
    console.log(`[audit-fix-generator] Applied ${results.filter((r) => r.status === "success").length} patches`);
    console.log(`[audit-fix-generator] Manual patches required: ${results.filter((r) => r.status === "manual-required").length}`);
    return results;
  } else {
    console.log(`[audit-fix-generator] Generating patches to: ${outputDir}`);
    const patches = generatePatches(findings);
    const summary = writePatches(patches, outputDir);

    console.log(`\n[audit-fix-generator] Patch generation complete`);
    console.log(`[audit-fix-generator] Total patch groups: ${summary.totalPatchGroups}`);
    console.log(`[audit-fix-generator] Patches directory: ${outputDir}`);

    return summary;
  }
}

/**
 * Main CLI entry point.
 */
function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf("--input");
  const outputIndex = args.indexOf("--output");
  const apply = args.includes("--apply");

  if (inputIndex === -1 || !args[inputIndex + 1]) {
    console.error("Usage: node scripts/audit-fix-generator.mjs --input <findings.json> --output <patches-dir> [--apply]");
    process.exit(1);
  }

  const inputPath = args[inputIndex + 1];
  const outputDir = outputIndex !== -1 ? args[outputIndex + 1] : join(ROOT, "patches");

  try {
    generate(inputPath, outputDir, { apply });
  } catch (error) {
    console.error(`[audit-fix-generator] Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

export { generate, generatePatches, applyPatches };
