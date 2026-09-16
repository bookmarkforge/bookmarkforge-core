// @vitest-environment node
/**
 * Tests for the fast/slow profile definitions: every fast selector must
 * resolve to existing test files (a stale selector silently shrinks the
 * profile — ADR-038), the two surfaces must be disjoint and together cover
 * the runnable tree, and the vitest-excluded files must never be scheduled.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isProSubjectGlob } from "../pro-boundary.mjs";
import {
  FAST_SELECTORS,
  FAST_THRESHOLD_MS,
  PROFILE_DEFAULTS,
  SLOW_THRESHOLD_MS,
  VITEST_EXCLUDED_FILES,
} from "../test-profiles.mjs";

const ROOT = process.cwd();
const TEST_FILE_PATTERN = /\.test\.(?:ts|tsx|mjs)$/;
const toPosix = (file) => file.replaceAll("\\", "/");

function collectTests(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") {
        files.push(...collectTests(path));
      }
    } else if (TEST_FILE_PATTERN.test(entry.name)) {
      files.push(toPosix(relative(ROOT, path)));
    }
  }
  return files;
}

const allTestFiles = [
  ...collectTests(join(ROOT, "src")),
  ...collectTests(join(ROOT, "eslint-rules")),
  ...collectTests(join(ROOT, "scripts", "__tests__")),
];

/** Expand a selector exactly like the runner's collectRequestedTests. */
function expandSelectors(selectors) {
  const files = [];
  for (const selector of selectors) {
    const absolute = resolve(ROOT, selector);
    if (!existsSync(absolute)) continue;
    if (statSync(absolute).isDirectory()) {
      files.push(...collectTests(absolute));
    } else {
      files.push(toPosix(relative(ROOT, absolute)));
    }
  }
  return [...new Set(files)];
}

describe("FAST_SELECTORS", () => {
  it("every selector resolves to at least one existing test file", () => {
    // An Open Core export tree (manifest.json with model "open-core" exists
    // only there) deliberately omits proprietary Pro tests; the private repo's
    // fast profile still names them so nothing silently shrinks HERE. In the
    // export those selectors are expected absences, not staleness — but any
    // other missing selector is stale in either tree.
    const isExportTree = (() => {
      try {
        return JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")).model === "open-core";
      } catch {
        return false;
      }
    })();
    const proMissing = isExportTree
      ? new Set(
          FAST_SELECTORS.filter((selector) => isProSubjectGlob(selector.replace(/^src\/tests\//, "src/tests/"))),
        )
      : new Set();
    const stale = FAST_SELECTORS.filter((selector) => {
      const absolute = resolve(ROOT, selector);
      if (!existsSync(absolute)) return !proMissing.has(selector);
      return statSync(absolute).isDirectory()
        ? expandSelectors([selector]).length === 0
        : !TEST_FILE_PATTERN.test(absolute);
    });
    // A stale selector silently shrinks the fast profile (ADR-038 found the
    // MutationGuard .tsx spelling drift had dropped its tests for months).
    expect(stale).toEqual([]);
  });

  it("fast and slow thresholds are ordered as intended", () => {
    expect(FAST_THRESHOLD_MS).toBeLessThan(SLOW_THRESHOLD_MS);
    expect(PROFILE_DEFAULTS.fast.thresholdMs).toBe(FAST_THRESHOLD_MS);
    expect(PROFILE_DEFAULTS.slow.thresholdMs).toBe(SLOW_THRESHOLD_MS);
  });
});

describe("profile surface math", () => {
  const fastFiles = expandSelectors(FAST_SELECTORS).filter(
    (file) => !VITEST_EXCLUDED_FILES.has(file),
  );
  const slowFiles = allTestFiles.filter(
    (file) => !fastFiles.includes(file) && !VITEST_EXCLUDED_FILES.has(file),
  );

  it("fast and slow surfaces are disjoint", () => {
    const overlap = fastFiles.filter((file) => slowFiles.includes(file));
    expect(overlap).toEqual([]);
  });

  it("the two surfaces cover the runnable tree", () => {
    const scheduled = [...new Set([...fastFiles, ...slowFiles])].sort();
    const runnable = allTestFiles
      .filter((file) => !VITEST_EXCLUDED_FILES.has(file))
      .sort();
    expect(scheduled).toEqual(runnable);
  });

  it("vitest-excluded files are collected but never scheduled", () => {
    for (const file of VITEST_EXCLUDED_FILES) {
      // Present on disk and matched by the collector glob (else the entry is
      // dead and the vitest.config.ts sync comment is stale).
      expect(allTestFiles).toContain(file);
      expect(fastFiles).not.toContain(file);
      expect(slowFiles).not.toContain(file);
    }
  });
});