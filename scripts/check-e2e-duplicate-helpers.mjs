#!/usr/bin/env node
/**
 * scripts/check-e2e-duplicate-helpers.mjs — e2e quality gate.
 *
 * Scans Playwright spec files for LOCAL re-definitions of functions that
 * are already exported by the shared e2e helpers module, so helpers stay
 * in one place (see tests/e2e/vault-helpers.ts).
 *
 * Usage:
 *   HELPERS_PATH=tests/e2e/vault-helpers.ts \
 *     node scripts/check-e2e-duplicate-helpers.mjs tests/e2e/*.spec.ts
 *
 * Exit codes:
 *   0 — no duplicates ("No duplicate helper functions found" on stdout)
 *   1 — duplicates found (details on stderr)
 *   2 — usage / IO error
 */
import { readFileSync, readdirSync } from "node:fs";
import process from "node:process";

// Sensible defaults so the script works as an npm script / CI gate
// without cross-platform env-var syntax (POSIX `VAR=x cmd` breaks under
// cmd.exe on Windows). Tests may override both via HELPERS_PATH and args.
const HELPERS_PATH =
  process.env.HELPERS_PATH || "tests/e2e/vault-helpers.ts";
if (!process.env.HELPERS_PATH) {
  console.log(`[check-e2e-duplicate-helpers] HELPERS_PATH unset, using default ${HELPERS_PATH}`);
}

// ── Collect exported helper names ───────────────────────────────────
const helpersSource = readFileSync(HELPERS_PATH, "utf8");
const helperNames = new Set();
const exportRe =
  /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|export\s+const\s+([A-Za-z_$][\w$]*)/g;
let m;
while ((m = exportRe.exec(helpersSource)) !== null) {
  if (m[1]) {
    helperNames.add(m[1]);
  }
  if (m[2]) {
    helperNames.add(m[2]);
  }
}

if (helperNames.size === 0) {
  console.log("No duplicate helper functions found");
  process.exit(0);
}

/**
 * Local (non-imported) function/const definitions in a spec file.
 * Import statements are stripped first so `import { setupVault } from
 * './vault-helpers'` is not mistaken for a local definition.
 */
function localDefinitions(source) {
  // Strip import statements (single-line AND multi-line) so imported
  // helper names are not mistaken for local definitions.
  const withoutImports = source
    .replace(
      /import\s+(?:type\s+)?[\s\S]*?from\s+['"][^'"]+['"]\s*;?/g,
      "",
    )
    .replace(/^\s*import\s*\([^)]*\);?\s*$/gm, "");
  const names = new Set();
  const fnRe = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const constRe =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function\b)/g;
  let f;
  while ((f = fnRe.exec(withoutImports)) !== null) {
    names.add(f[1]);
  }
  while ((f = constRe.exec(withoutImports)) !== null) {
    names.add(f[1]);
  }
  return names;
}

// ── Per-spec scan ────────────────────────────────────────────────────
const duplicates = new Map(); // filename -> Set<helperName>

/** Expand a `dir/*.spec.ts`-style pattern (cmd.exe does not glob). */
function expandGlob(pattern) {
  if (!pattern.includes("*")) return [pattern];
  const slash = pattern.lastIndexOf("/");
  const dir = pattern.slice(0, slash);
  const rest = pattern.slice(slash + 1);
  const star = rest.indexOf("*");
  const prefix = rest.slice(0, star);
  const suffix = rest.slice(star + 1);
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [pattern];
  }
  return entries
    .filter((e) => e.startsWith(prefix) && e.endsWith(suffix))
    .map((e) => `${dir}/${e}`);
}

const files = process.argv.slice(2).flatMap(expandGlob);
if (files.length === 0) files.push(...expandGlob("tests/e2e/*.spec.ts"));

for (const file of files) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    console.error(`Cannot read ${file}`);
    process.exit(2);
  }
  for (const name of localDefinitions(source)) {
    if (helperNames.has(name)) {
      if (!duplicates.has(file)) {
        duplicates.set(file, new Set());
      }
      duplicates.get(file).add(name);
    }
  }
}

if (duplicates.size > 0) {
  const lines = [];
  for (const [file, names] of duplicates) {
    lines.push(
      `Duplicate helper functions in ${file}: ${[...names].join(", ")}`,
    );
  }
  console.error("Duplicate helper functions found:");
  console.error(lines.join("\n"));
  process.exit(1);
}

console.log("No duplicate helper functions found");
process.exit(0);
