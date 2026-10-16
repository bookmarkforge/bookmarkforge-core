import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const SCRIPT_PATH = path.join(
  process.cwd(),
  "scripts",
  "check-e2e-duplicate-helpers.mjs",
);

interface FixtureFiles {
  helpers: string;
  specClean: string;
  specDupe: string;
}

/**
 * Creates temporary fixture files for testing and returns their paths.
 * - helpers file: exports 3 functions (setupVault, shortPause, exportBackupViaPage)
 * - specClean file: imports those functions (no local definitions)
 * - specDupe file: has a local shortPause definition (duplicate)
 */
async function createFixtures(tmpDir: string): Promise<FixtureFiles> {
  const helpers = path.join(tmpDir, "vault-helpers.ts");
  const specClean = path.join(tmpDir, "vault-clean-test.spec.ts");
  const specDupe = path.join(tmpDir, "vault-dupe-test.spec.ts");

  await fs.writeFile(
    helpers,
    [
      'import { expect, type Page } from "@playwright/test";',
      "",
      "export async function setupVault(page: Page, password: string): Promise<void> {",
      "  // no-op",
      "}",
      "",
      "export async function shortPause(page: Page, ms = 1000): Promise<void> {",
      "  await page.waitForTimeout(ms);",
      "}",
      "",
      "export async function exportBackupViaPage(",
      "  page: Page,",
      "  password: string,",
      "): Promise<void> {",
      "  // no-op",
      "}",
      "",
    ].join("\n"),
  );

  await fs.writeFile(
    specClean,
    [
      'import { test, expect } from "@playwright/test";',
      "import { setupVault, shortPause } from './vault-helpers';",
      "",
      'test("clean test", async () => {',
      "  // no local definition of any helper function",
      "  expect(true).toBe(true);",
      "});",
      "",
    ].join("\n"),
  );

  await fs.writeFile(
    specDupe,
    [
      'import { test, expect } from "@playwright/test";',
      "import { setupVault } from './vault-helpers';",
      "",
      "// Local definition that duplicates a helper name:",
      "async function shortPause(page: any, ms = 1000) {",
      "  await page.waitForTimeout(ms);",
      "}",
      "",
      'test("dupe test", async ({ page }) => {',
      "  await shortPause(page, 500);",
      "});",
      "",
    ].join("\n"),
  );

  return { helpers, specClean, specDupe };
}

function runScript(args: string[], helpersPath: string): {
  exitCode: number | null;
  stdout: string;
  stderr: string;
} {
  try {
    const output = execSync(`node "${SCRIPT_PATH}" ${args.map((a) => `"${a}"`).join(" ")}`, {
      cwd: process.cwd(),
      env: { ...process.env, HELPERS_PATH: helpersPath },
      encoding: "utf-8",
    });
    return { exitCode: 0, stdout: output, stderr: "" };
  } catch (e: unknown) {
    const err = e as {
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

describe("check-e2e-duplicate-helpers.mjs", () => {
  let tmpDir: string;
  let fixtures: FixtureFiles;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helpers-test-"));
    fixtures = await createFixtures(tmpDir);
  });

  afterAll(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects a local shortPause definition as duplicate", () => {
    const result = runScript([fixtures.specDupe], fixtures.helpers);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("shortPause");
    expect(result.stderr).toContain("vault-dupe-test.spec.ts");
    expect(result.stderr).toContain("Duplicate helper functions");
  });

  it("passes when spec file imports helpers instead of defining them locally", () => {
    const result = runScript([fixtures.specClean], fixtures.helpers);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No duplicate helper functions found");
  });

  it("detects multiple duplicates in the same file", async () => {
    const tmpMulti = path.join(tmpDir, "vault-multi-dupe.spec.ts");
    await fs.writeFile(
      tmpMulti,
      [
        'import { test, expect } from "@playwright/test";',
        "",
        "async function shortPause(page: any, ms = 1000) {",
        "  await page.waitForTimeout(ms);",
        "}",
        "",
        "const setupVault = async (page: any, pw: string) => {",
        "  // arrow fn duplicate",
        "};",
        "",
        'test("multi dupe", async () => {',
        "  expect(true).toBe(true);",
        "});",
        "",
      ].join("\n"),
    );

    const result = runScript([tmpMulti], fixtures.helpers);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("shortPause");
    expect(result.stderr).toContain("setupVault");
    expect(result.stderr).toContain("vault-multi-dupe.spec.ts");
  });

  it("detects arrow function duplicates (const foo = async ())", async () => {
    const tmpArrow = path.join(tmpDir, "vault-arrow-dupe.spec.ts");
    await fs.writeFile(
      tmpArrow,
      [
        'import { test, expect } from "@playwright/test";',
        "",
        "const shortPause = async (page: any, ms = 1000) => {",
        "  await page.waitForTimeout(ms);",
        "};",
        "",
        'test("arrow dupe", async () => {',
        "  expect(true).toBe(true);",
        "});",
        "",
      ].join("\n"),
    );

    const result = runScript([tmpArrow], fixtures.helpers);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("shortPause");
  });

  it("does not flag function names that are not exported from helpers", async () => {
    const tmpCustom = path.join(tmpDir, "vault-custom-fn.spec.ts");
    await fs.writeFile(
      tmpCustom,
      [
        'import { test, expect } from "@playwright/test";',
        "",
        "async function myCustomHelper(page: any) {",
        "  // this is NOT in vault-helpers.ts, so should not be flagged",
        "};",
        "",
        'test("custom fn", async () => {',
        "  expect(true).toBe(true);",
        "});",
        "",
      ].join("\n"),
    );

    const result = runScript([tmpCustom], fixtures.helpers);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No duplicate helper functions found");
  });
});
