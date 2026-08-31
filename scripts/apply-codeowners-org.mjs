#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateCodeownersContent } from "./validate-codeowners.mjs";

const PLACEHOLDER = "YOUR_GITHUB_ORG";
const PLACEHOLDER_PATTERN =
  /(YOUR_GITHUB_ORG|your[-_ ]github[-_ ]org|TODO|REPLACE_ME|example\.com|@your[-_])/i;
const ORG_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Replaces the @YOUR_GITHUB_ORG placeholder in a CODEOWNERS document with the
 * real organization and validates the result against the configured org.
 *
 * @param {string} content - Current CODEOWNERS content.
 * @param {string} org - Real GitHub organization (a leading "@" is stripped).
 * @returns {{ content: string, replacedCount: number, errors: string[] }}
 */
export function applyCodeownersOrg(content, org) {
  const errors = [];
  const normalized = (org ?? "").trim().replace(/^@/, "");
  if (!normalized) {
    errors.push("organization name is required (--org ORG or CODEOWNERS_ORG)");
    return { content, replacedCount: 0, errors };
  }
  if (PLACEHOLDER_PATTERN.test(normalized) || normalized.includes(PLACEHOLDER)) {
    errors.push(
      `'${normalized}' looks like a placeholder; refusing to write it as an owner`,
    );
    return { content, replacedCount: 0, errors };
  }
  if (!ORG_PATTERN.test(normalized)) {
    errors.push(
      `invalid organization name '${normalized}' (allowed: letters, numbers, '.', '_', '-')`,
    );
    return { content, replacedCount: 0, errors };
  }
  const replacedCount = content.split(PLACEHOLDER).length - 1;
  const next = content.split(PLACEHOLDER).join(normalized);
  errors.push(...validateCodeownersContent(next, normalized).errors);
  return { content: next, replacedCount, errors };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const orgFlagIndex = args.indexOf("--org");
  const orgFromFlag = orgFlagIndex >= 0 ? (args[orgFlagIndex + 1] ?? "") : "";
  const org = (process.env.CODEOWNERS_ORG ?? "").trim() || orgFromFlag.trim();
  const dryRun = args.includes("--dry-run");
  const file = join(process.cwd(), ".github", "CODEOWNERS");
  if (!existsSync(file)) {
    console.error("[apply-codeowners-org] FAIL: .github/CODEOWNERS not found");
    process.exit(1);
  }
  const original = readFileSync(file, "utf8");
  const { content: next, replacedCount, errors } = applyCodeownersOrg(original, org);
  if (errors.length) {
    console.error("[apply-codeowners-org] FAIL");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  if (replacedCount === 0) {
    console.log("[apply-codeowners-org] no placeholders found; nothing to do");
    process.exit(0);
  }
  if (dryRun) {
    const originalLines = original.split("\n");
    const nextLines = next.split("\n");
    console.log("[apply-codeowners-org] dry run — lines that would change:");
    const width = String(nextLines.length).length;
    nextLines.forEach((line, index) => {
      if (line !== originalLines[index]) {
        console.log(
          `  ${String(index + 1).padStart(width)}: ${originalLines[index]}  ->  ${line}`,
        );
      }
    });
    console.log(
      `[apply-codeowners-org] dry run: ${replacedCount} placeholder(s) would be replaced with '@${org}'`,
    );
    process.exit(0);
  }
  writeFileSync(file, next);
  console.log(
    `[apply-codeowners-org] replaced ${replacedCount} placeholder(s) with '@${org}' in .github/CODEOWNERS`,
  );
  console.log("Next steps:");
  console.log(
    "- Create the referenced teams in GitHub (org Settings -> Member privileges -> Teams).",
  );
  console.log(
    `- Set the repository variable CODEOWNERS_ORG=${org} so CI validates owner consistency.`,
  );
  console.log("- Run: npm run check:codeowners");
}
