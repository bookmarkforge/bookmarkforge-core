// Single owner for "which test files does a test profile schedule".
//
// Extracted from scripts/test-bounded.mjs: the bounded runner, its curated
// wrapper (scripts/test-fast.mjs) and the audit-freshness gate
// (scripts/check-audit-freshness.mjs) must agree on the file count of the fast
// profile. The gate publishes that number for `npm run test:fast` in
// docs/audit.md and re-derives it from here, so a collector change that the
// document did not follow is exactly the drift the ledger promises not to
// have. Two implementations of the same walk would make that a coincidence
// instead of a contract.
//
// The walk matches the runner's historical behavior byte for byte: only
// *.test.(ts|tsx|mjs), never node_modules/ or dist/, paths relative to the
// root and posix-normalized, and selectors filtered by the same
// `isProjectPathArg` shape the runner accepts.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { FAST_SELECTORS, VITEST_EXCLUDED_FILES } from "./test-profiles.mjs";

export const TEST_FILE_PATTERN = /\.test\.(?:ts|tsx|mjs)$/;

/** Recursively collect test files under `directory`, relative to `root`. */
export function collectTestFiles(directory, root = process.cwd()) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") {
        files.push(...collectTestFiles(path, root));
      }
      continue;
    }
    if (TEST_FILE_PATTERN.test(entry.name)) {
      files.push(relative(root, path));
    }
  }
  return files;
}

/** Every test file the runner can see, sorted. */
export function allTestFiles(root = process.cwd()) {
  return [
    ...collectTestFiles(join(root, "src"), root),
    ...collectTestFiles(join(root, "eslint-rules"), root),
    // Quality-gate script tests live under scripts/__tests__/ (vitest include
    // glob in vitest.config.ts matches them); collect them here so the bounded
    // suite — not just ad-hoc `npx vitest run scripts/__tests__` — runs them.
    ...collectTestFiles(join(root, "scripts", "__tests__"), root),
  ].sort();
}

export function normalizeProjectPath(arg) {
  return arg.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isProjectPathArg(arg) {
  const normalized = normalizeProjectPath(arg);
  return (
    normalized.startsWith("src/") ||
    normalized.startsWith("eslint-rules/") ||
    // Quality-gate script tests (scripts/__tests__/check-*.test.mjs) are
    // first-class unit tests: selectable like any other project path. Accept
    // both the bare dir and a nested path (the src/ prefixes above share the
    // same shape: `src` alone is not a selector).
    normalized === "scripts/__tests__" ||
    normalized.startsWith("scripts/__tests__/")
  );
}

/** Expand command-line selectors (existing project paths) into test files. */
export function collectRequestedTestFiles(args, root = process.cwd()) {
  const requested = [];
  for (const arg of args) {
    // Only treat existing project paths as selectors. This avoids mistaking a
    // value belonging to an option such as `--reporter dot` for a file.
    if (!isProjectPathArg(arg)) {
      continue;
    }
    const normalized = normalizeProjectPath(arg);
    const absolute = resolve(root, normalized);
    if (!existsSync(absolute)) {
      continue;
    }
    if (statSync(absolute).isDirectory()) {
      requested.push(...collectTestFiles(absolute, root));
    } else if (TEST_FILE_PATTERN.test(absolute)) {
      requested.push(relative(root, absolute));
    }
  }
  return [...new Set(requested)].sort();
}

const toPosixPath = (file) => file.replaceAll("\\", "/");

/**
 * The files the fast profile actually runs: FAST_SELECTORS expanded to files,
 * minus the files vitest deliberately excludes (a scheduled-but-excluded file
 * is counted as passed without ever running).
 */
export function fastProfileFiles(root = process.cwd()) {
  return collectRequestedTestFiles(FAST_SELECTORS, root)
    .map(toPosixPath)
    .filter((file) => !VITEST_EXCLUDED_FILES.has(file));
}

/** The slow surface: every collected file outside the fast profile and exclusions. */
export function slowSurfaceFiles(root = process.cwd()) {
  const fast = new Set(fastProfileFiles(root));
  return allTestFiles(root).filter(
    (file) =>
      !fast.has(toPosixPath(file)) && !VITEST_EXCLUDED_FILES.has(toPosixPath(file)),
  );
}
