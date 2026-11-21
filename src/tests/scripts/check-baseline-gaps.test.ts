import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "check-baseline-gaps.mjs");
const GIT = "git";

/** The gate only matches NAMES — fixture PNGs never need real pixels. */
const FAKE_PNG = Buffer.from("not-a-real-png-but-the-gate-never-decodes-it");

const LOCALES_TS = [
  "export interface SupportedLanguage { code: string; name: string; }",
  "export const SUPPORTED_LANGUAGES = [",
  '  { code: "de", name: "Deutsch" },',
  '  { code: "en", name: "English" },',
  '  { code: "fi", name: "Suomi" },',
  '  { code: "fr", name: "Français" },',
  "] as const satisfies ReadonlyArray<SupportedLanguage>;",
  "export type LocaleCode = (typeof SUPPORTED_LANGUAGES)[number][\"code\"];",
  "export const SUPPORTED_LOCALE_CODES: ReadonlyArray<LocaleCode> = SUPPORTED_LANGUAGES.map((l): LocaleCode => l.code);",
  "export const CRITICAL_LOCALE_CODES: ReadonlyArray<LocaleCode> = [",
  '  "en",',
  '  "de",',
  "];",
  "export const SMALL_FALLBACK_LOCALES: ReadonlyArray<LocaleCode> = [",
  '  "en",',
  '  "de",',
  "];",
].join("\n");

/** A spec with five plain-literal toHaveScreenshot names (visual-testing shape). */
const LITERAL_SPEC = [
  'import { test, expect } from "@playwright/test";',
  "",
  'test("vault lock screen", async ({ page }) => {',
  '  await expect(page).toHaveScreenshot("vault-lock-screen.png", { maxDiffPixelRatio: 0.05 });',
  "});",
  "",
  'test("main app layout", async ({ page }) => {',
  '  await expect(page).toHaveScreenshot("main-app-layout.png", { maxDiffPixelRatio: 0.05 });',
  "});",
  "",
  'test("settings panel", async ({ page }) => {',
  '  await expect(page).toHaveScreenshot("settings-panel.png", { maxDiffPixelRatio: 0.05 });',
  "});",
  "",
  'test("bookmark list empty", async ({ page }) => {',
  '  await expect(page).toHaveScreenshot("bookmark-list-empty.png", { maxDiffPixelRatio: 0.05 });',
  "});",
  "",
  'test("search interface", async ({ page }) => {',
  '  await expect(page).toHaveScreenshot("search-interface.png", { maxDiffPixelRatio: 0.05 });',
  "});",
  "",
].join("\n");

/**
 * Nightly-style spec: toHaveScreenshot lives in a helper whose locale domain
 * comes from a `loadLocaleCodes("nightly")` loop and is constant-folded by a
 * `VISUAL_BACKSTOP_LOCALES.has(locale)` guard. Mirrors
 * tests/e2e/text-fit.nightly.spec.ts.
 */
function backstopSpec(backstopSet: string[]): string {
  return [
    'import { test, expect } from "@playwright/test";',
    "",
    `const VISUAL_BACKSTOP_LOCALES: ReadonlySet<string> = new Set(${JSON.stringify(backstopSet)});`,
    "const MAX_DIFF = 0.05;",
    "",
    "async function capture(page: never, locale: string, view: string, nameSuffix = \"\"): Promise<void> {",
    "  if (VISUAL_BACKSTOP_LOCALES.has(locale)) {",
    "    await expect(page).toHaveScreenshot(",
    "      `text-fit-${view}-${locale}${nameSuffix}.png`,",
    "      { maxDiffPixelRatio: MAX_DIFF },",
    "    );",
    "  }",
    "}",
    "",
    'test("locales", async ({ page }) => {',
    '  for (const locale of loadLocaleCodes("nightly")) {',
    '    await capture(page, locale, "lock-screen");',
    '    await capture(page, locale, "dashboard");',
    '    await capture(page, locale, "bookmark-list");',
    '    await capture(page, locale, "lock-screen", "-narrow");',
    '    await capture(page, locale, "dashboard", "-narrow");',
    "  }",
    "});",
    "",
  ].join("\n");
}

/** A spec whose screenshot name CANNOT be statically resolved. */
const UNRESOLVABLE_SPEC = [
  'import { test, expect } from "@playwright/test";',
  "",
  "function dynamicSuffix(): string {",
  "  return Math.random() > 0.5 ? \"a\" : \"b\";",
  "}",
  "",
  'test("dynamic name", async ({ page }) => {',
  '  const suffix = dynamicSuffix();',
  '  await expect(page).toHaveScreenshot(`text-fit-${view}-${suffix}.png`);',
  "});",
  "",
].join("\n");

function git(tmp: string, ...args: string[]): void {
  execSync(`${GIT} -C "${tmp}" ${args.map((a) => `"${a}"`).join(" ")}`, {
    stdio: "pipe",
  });
}

function runScript(repoRoot: string): {
  exitCode: number | null;
  stdout: string;
  stderr: string;
} {
  try {
    const output = execSync(`node "${SCRIPT_PATH}" --root "${repoRoot}"`, {
      cwd: process.cwd(),
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

describe("check-baseline-gaps.mjs", () => {
  let baseDir: string;

  beforeAll(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "baseline-gaps-"));
  });

  afterAll(async () => {
    if (baseDir) {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  /**
   * Build one throwaway git repo with a locales.ts, the given spec(s), and
   * the given tracked snapshot files (specBase -> canonical name list).
   */
  async function freshRepo(opts: {
    specs: Array<{ specBase: string; content: string }>;
    tracked: Array<{ specBase: string; names: string[] }>;
  }): Promise<string> {
    const repo = path.join(
      baseDir,
      `repo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(path.join(repo, "src", "constants"), { recursive: true });
    await fs.writeFile(path.join(repo, "src", "constants", "locales.ts"), LOCALES_TS);
    await fs.mkdir(path.join(repo, "tests", "e2e"), { recursive: true });
    for (const spec of opts.specs) {
      await fs.writeFile(
        path.join(repo, "tests", "e2e", `${spec.specBase}.spec.ts`),
        spec.content,
      );
    }
    for (const t of opts.tracked) {
      const dir = path.join(repo, "tests", "e2e", `${t.specBase}.spec.ts-snapshots`);
      await fs.mkdir(dir, { recursive: true });
      for (const name of t.names) {
        await fs.writeFile(path.join(dir, name), FAKE_PNG);
      }
    }
    git(repo, "init", "-b", "main");
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "fixtures");
    return repo;
  }

  it("passes when every toHaveScreenshot reference is tracked (literal names, platform suffixes normalized)", async () => {
    const repo = await freshRepo({
      specs: [{ specBase: "visual", content: LITERAL_SPEC }],
      tracked: [
        {
          specBase: "visual",
          names: [
            "vault-lock-screen-chromium-win32.png",
            "main-app-layout-chromium-win32.png",
            "settings-panel-chromium-win32.png",
            "bookmark-list-empty-chromium-linux.png",
            "search-interface-chromium-linux.png",
          ],
        },
      ],
    });
    const result = runScript(repo);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("5 references");
    expect(result.stdout).toContain("visual.spec.ts");
  });

  it("fails when a literal-arg baseline is missing from git", async () => {
    const repo = await freshRepo({
      specs: [{ specBase: "visual", content: LITERAL_SPEC }],
      tracked: [
        {
          specBase: "visual",
          names: [
            "vault-lock-screen-chromium-win32.png",
            "main-app-layout-chromium-win32.png",
            "settings-panel-chromium-win32.png",
            "bookmark-list-empty-chromium-win32.png",
            // search-interface intentionally missing
          ],
        },
      ],
    });
    const result = runScript(repo);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("search-interface.png");
    expect(result.stderr).toContain("visual.spec.ts");
    expect(result.stderr).toContain("NOT tracked in git");
  });

  it("passes with a template + backstop guard: only the backstop locale's baselines are required", async () => {
    // NIGHTLY = SUPPORTED {de,en,fi,fr} − CRITICAL {en,de} = {fi,fr}; the
    // guard folds the domain to {fi}. `fr` baselines are intentionally NOT
    // required, and an extra tracked `fr` file must not fail the gate.
    const repo = await freshRepo({
      specs: [{ specBase: "nightly", content: backstopSpec(["fi"]) }],
      tracked: [
        {
          specBase: "nightly",
          names: [
            "text-fit-lock-screen-fi-chromium-win32.png",
            "text-fit-dashboard-fi-chromium-win32.png",
            "text-fit-bookmark-list-fi-chromium-win32.png",
            "text-fit-lock-screen-fi-narrow-chromium-win32.png",
            "text-fit-dashboard-fi-narrow-chromium-win32.png",
            "text-fit-lock-screen-fr-chromium-win32.png", // extra tracked is fine
          ],
        },
      ],
    });
    const result = runScript(repo);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("5 references");
    expect(result.stdout).toContain("text-fit-dashboard-fi-narrow.png");
  });

  it("fails when a template reference is missing (new view not committed)", async () => {
    const repo = await freshRepo({
      specs: [{ specBase: "nightly", content: backstopSpec(["fi"]) }],
      tracked: [
        {
          specBase: "nightly",
          names: [
            "text-fit-lock-screen-fi-chromium-win32.png",
            // text-fit-dashboard-fi deliberately missing
            "text-fit-bookmark-list-fi-chromium-win32.png",
            "text-fit-lock-screen-fi-narrow-chromium-win32.png",
            "text-fit-dashboard-fi-narrow-chromium-win32.png",
          ],
        },
      ],
    });
    const result = runScript(repo);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("text-fit-dashboard-fi.png");
    expect(result.stderr).toContain("nightly.spec.ts");
  });

  it("rejects an unresolvable template hole with exit 2 (never passes vacuously)", async () => {
    const repo = await freshRepo({
      specs: [{ specBase: "dyn", content: UNRESOLVABLE_SPEC }],
      tracked: [],
    });
    const result = runScript(repo);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unresolvable template hole");
  });

  it("accepts a guard that legitimately empties the locale domain (screenshot never runs)", async () => {
    // Backstop {zz} ∩ {fi,fr} = ∅ → the toHaveScreenshot is unreachable for
    // every locale; deriving zero names is correct, not an analyzer failure.
    const repo = await freshRepo({
      specs: [{ specBase: "nightly", content: backstopSpec(["zz"]) }],
      tracked: [],
    });
    const result = runScript(repo);
    expect(result.exitCode).toBe(0);
  });
});