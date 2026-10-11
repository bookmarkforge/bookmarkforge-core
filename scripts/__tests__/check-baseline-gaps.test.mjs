// @vitest-environment node
/**
 * scripts/__tests__/check-baseline-gaps.test.mjs
 *
 * Unit tests for the static analyzer behind `check:baseline-gaps`, focused on
 * the guard-folding contract that lets a spec disable its pixel captures:
 *
 *   - an EMPTY allow-list (`new Set<T>([])`) is an explicit "captures
 *     disabled": `SET.has(x)` is false for every value, so the guarded
 *     `toHaveScreenshot` can never run and contributes NO baseline reference
 *     (guard-emptied) — whatever the domain's shape (2-letter locales or
 *     arbitrary slugs);
 *   - a NON-EMPTY allow-list keeps the old, conservative behaviour: it only
 *     folds when both sides look like 2-letter locale codes, and then derives
 *     exactly the intersection (so it must stay tracked);
 *   - an unresolvable template hole still fails loud (no vacuous pass).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeSpec, extractLocaleDomains } from "../check-baseline-gaps.mjs";

const LOCALES_SOURCE = readFileSync(
  fileURLToPath(new URL("../../src/constants/locales.ts", import.meta.url)),
  "utf8",
);
const locales = extractLocaleDomains(LOCALES_SOURCE);

const LOCALE_SPEC = (declaration, scope) =>
  [
    'import { test, expect, type Page } from "@playwright/test";',
    'import { loadLocaleCodes, type LocaleCode, type ViewId } from "./text-fit-helpers";',
    `const SET${declaration};`,
    "async function cap(page: Page, locale: LocaleCode, view: ViewId) {",
    "  if (SET.has(locale)) {",
    "    await expect(page).toHaveScreenshot(`text-fit-${view}-${locale}.png`);",
    "  }",
    "}",
    `for (const locale of loadLocaleCodes("${scope}")) { test(locale, async ({ page }) => { await cap(page, locale, "dashboard"); }); }`,
  ].join("\n");

const SLUG_SPEC = (declaration) =>
  [
    'import { test, expect, type Page } from "@playwright/test";',
    `const NAMES: ReadonlySet<string> = ${declaration};`,
    "async function expectVisualBaseline(page: Page, name: string) {",
    "  if (NAMES.has(name)) {",
    "    await expect(page).toHaveScreenshot(`${name}.png`);",
    "  }",
    "}",
    'test("a", async ({ page }) => { await expectVisualBaseline(page, "vault-lock-screen"); });',
    'test("b", async ({ page }) => { await expectVisualBaseline(page, "main-app-layout"); });',
  ].join("\n");

const analyze = (source) => analyzeSpec(source, "spec", locales);

describe("check-baseline-gaps — guard folding", () => {
  it("treats an empty locale allow-list as captures-disabled (guard-emptied)", () => {
    const result = analyze(LOCALE_SPEC(": ReadonlySet<LocaleCode> = new Set<LocaleCode>([])", "critical"));
    expect(result.callsSeen).toBe(1);
    expect(result.derived.size).toBe(0);
    expect(result.unresolved).toHaveLength(0);
  });

  it("treats an empty SLUG allow-list as captures-disabled too", () => {
    const result = analyze(SLUG_SPEC("new Set<string>([])"));
    expect(result.derived.size).toBe(0);
    expect(result.unresolved).toHaveLength(0);
  });

  it("keeps deriving the intersection of a non-empty locale allow-list", () => {
    const result = analyze(LOCALE_SPEC(': ReadonlySet<LocaleCode> = new Set(["fi"])', "nightly"));
    expect([...result.derived.keys()]).toEqual(["text-fit-dashboard-fi.png"]);
  });

  it("derives nothing for a non-empty allow-list disjoint from the domain", () => {
    // "en" is a critical code, so the nightly domain never intersects it.
    const result = analyze(LOCALE_SPEC(': ReadonlySet<LocaleCode> = new Set(["en"])', "nightly"));
    expect(result.derived.size).toBe(0);
    expect(result.unresolved).toHaveLength(0);
  });

  it("does NOT fold a non-empty allow-list over a non-locale domain", () => {
    // The 2-letter heuristic stays: an arbitrary slug set must not be folded,
    // so both names are still derived and would have to be tracked.
    const result = analyze(SLUG_SPEC('new Set<string>(["vault-lock-screen"])'));
    expect(result.derived.size).toBe(2);
  });

  it("derives a literal-name reference (still enforced)", () => {
    const literal = [
      'import { test, expect } from "@playwright/test";',
      'test("x", async ({ page }) => { await expect(page).toHaveScreenshot("vault-lock-screen.png"); });',
    ].join("\n");
    const result = analyze(literal);
    expect([...result.derived.keys()]).toEqual(["vault-lock-screen.png"]);
  });

  it("fails loud (unresolved) when a template hole cannot be resolved", () => {
    const dynamic = [
      'import { test, expect } from "@playwright/test";',
      'test("x", async ({ page }) => { await expect(page).toHaveScreenshot(`${process.env.X}.png`); });',
    ].join("\n");
    const result = analyze(dynamic);
    expect(result.derived.size).toBe(0);
    expect(result.unresolved.length).toBeGreaterThan(0);
  });
});
