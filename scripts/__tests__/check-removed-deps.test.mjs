// @vitest-environment node
/**
 * Tests for the pruned-dependency gate (scripts/check-removed-deps.mjs).
 *
 * Each case materializes a synthetic tree on disk and asserts what the gate
 * does and — just as important — what it must NOT do. The interesting half is
 * the false-positive side: a gate that fails on `userAgent.includes("puppeteer")`
 * (the real case in src/utils/environmentDetection.ts) is a gate someone turns
 * off, so the string usages are pinned here as hard as the module references.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkRemovedDeps,
  isModuleLoaderCall,
  prunedPackageIn,
  REMOVED_PACKAGES,
  DEFAULT_SCOPES,
} from "../check-removed-deps.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts", "check-removed-deps.mjs");

/** Build a synthetic repo; `files` maps repo-relative paths to content. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "removed-deps-"));
  for (const [rel, content] of Object.entries(files)) {
    const parts = rel.split("/");
    const dir = parts.slice(0, -1).join("/");
    if (dir) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, parts.join("/")), content);
  }
  return root;
}

const findingText = (root, scopes) =>
  checkRemovedDeps(root, scopes).references.map(
    (ref) => `${ref.file}:${ref.line} "${ref.specifier}" (${ref.kind})`,
  );

describe("check-removed-deps reference forms", () => {
  it("flags every form that actually loads a module, with file, line and callee", () => {
    const root = fixture({
      "src/features/render.ts": [
        'import markdownit from "markdown-it";', // 1
        'import type { Options } from "md-to-pdf";', // 2
        'import "puppeteer";', // 3
        'export { render } from "markdown-it/lib/render";', // 4
        'const pdf = await import("md-to-pdf/dist/cli");', // 5
        'const browser = require("puppeteer/lib/cjs/puppeteer");', // 6
        'const entry = require.resolve("markdown-it");', // 7
        'vi.mock("puppeteer");', // 8
        'jest.requireActual("markdown-it");', // 9
        "",
      ].join("\n"),
    });

    expect(findingText(root)).toEqual([
      'src/features/render.ts:1 "markdown-it" (import)',
      'src/features/render.ts:2 "md-to-pdf" (import)',
      'src/features/render.ts:3 "puppeteer" (import)',
      'src/features/render.ts:4 "markdown-it/lib/render" (export-from)',
      'src/features/render.ts:5 "md-to-pdf/dist/cli" (import)',
      'src/features/render.ts:6 "puppeteer/lib/cjs/puppeteer" (require)',
      'src/features/render.ts:7 "markdown-it" (require.resolve)',
      'src/features/render.ts:8 "puppeteer" (vi.mock)',
      'src/features/render.ts:9 "markdown-it" (jest.requireActual)',
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags a TypeScript import-equals require", () => {
    const root = fixture({
      "src/infra/pdf.ts": 'import puppeteer = require("puppeteer");\n',
    });

    expect(findingText(root)).toEqual([
      'src/infra/pdf.ts:1 "puppeteer" (import-require)',
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not flag strings that merely name the package", () => {
    const root = fixture({
      "src/utils/environmentDetection.ts": [
        "// Phantom, Selenium, Puppeteer — never present in a real browser", // 1
        "const userAgent = navigator.userAgent.toLowerCase();", // 2
        'const isAutomationToolUA = userAgent.includes("puppeteer");', // 3
        'const blocked = ["markdown-it", "md-to-pdf"];', // 4
        'const note = "markdown-it is no longer a dependency";', // 5
        'const code = "a.md-to-pdf.ts";', // 6
        "",
      ].join("\n"),
    });

    expect(checkRemovedDeps(root).references).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not flag a different package that shares the prefix", () => {
    const root = fixture({
      "src/features/plugins.ts": [
        'import emoji from "markdown-it-emoji";',
        'import core from "puppeteer-core";',
        'import types from "@types/markdown-it";',
        'import other from "md-to-pdf-utils";',
        "",
      ].join("\n"),
    });

    expect(checkRemovedDeps(root).references).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("check-removed-deps scopes", () => {
  it("scans only the declared scopes", () => {
    const root = fixture({
      "server/pdf/render.ts": 'import puppeteer from "puppeteer";\n',
    });

    expect(checkRemovedDeps(root, DEFAULT_SCOPES).references).toEqual([]);
    expect(findingText(root, ["server"])).toEqual([
      'server/pdf/render.ts:1 "puppeteer" (import)',
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("skips dependencies and built output inside the scope", () => {
    const root = fixture({
      "src/node_modules/hosted/index.js": 'require("puppeteer");\n',
      "src/dist/bundle.js": 'require("markdown-it");\n',
      "src/features/clean.ts": "export const ok = true;\n",
    });

    const result = checkRemovedDeps(root);
    expect(result.references).toEqual([]);
    expect(result.scanned).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("check-removed-deps helpers", () => {
  it("resolves the pruned package for exact paths and subpaths only", () => {
    expect(prunedPackageIn("puppeteer")).toBe("puppeteer");
    expect(prunedPackageIn("puppeteer/lib/x")).toBe("puppeteer");
    expect(prunedPackageIn("puppeteer-core")).toBeNull();
    expect(prunedPackageIn("markdown-it-emoji")).toBeNull();
    expect(prunedPackageIn("@types/markdown-it")).toBeNull();
    expect(prunedPackageIn("react")).toBeNull();
  });

  it("recognizes module loaders and rejects string-consuming APIs", () => {
    for (const callee of [
      "require",
      "import",
      "require.resolve",
      "import.meta.resolve",
      "vi.mock",
      "vi.doMock",
      "vi.unmock",
      "vi.importActual",
      "vi.importMock",
      "jest.requireActual",
      "jest.requireMock",
    ]) {
      expect(isModuleLoaderCall(callee), callee).toBe(true);
    }
    for (const callee of [
      "userAgent.includes",
      "Array.prototype.includes",
      "JSON.parse",
      "loadModule",
      "document.createElement",
    ]) {
      expect(isModuleLoaderCall(callee), callee).toBe(false);
    }
  });
});

describe("check-removed-deps CLI", () => {
  it("fails with the finding and the remedy, and passes on a clean tree", () => {
    const dirty = fixture({
      "src/features/render.ts": 'import markdownit from "markdown-it";\n',
    });
    const clean = fixture({ "src/features/render.ts": "export const ok = true;\n" });
    const env = (root) => ({ ...process.env, BMF_REMOVED_DEPS_ROOT: root });

    const failing = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: env(dirty),
    });
    const passing = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: env(clean),
    });

    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain("FAIL");
    expect(failing.stderr).toContain('src/features/render.ts:1 — "markdown-it" (import)');
    expect(failing.stderr).toContain("remedy:");
    expect(passing.status).toBe(0);
    expect(passing.stdout).toContain("ok: no src file references the pruned packages");

    rmSync(dirty, { recursive: true, force: true });
    rmSync(clean, { recursive: true, force: true });
  });
});

describe("check-removed-deps on the real tree", () => {
  it("keeps this checkout free of the pruned packages", () => {
    const { references, scanned } = checkRemovedDeps(REPO_ROOT);

    expect(references).toEqual([]);
    // A guard against a silently empty scan (wrong root, wrong scope).
    expect(scanned).toBeGreaterThan(500);
    expect(REMOVED_PACKAGES.length).toBe(3);
  });
});
