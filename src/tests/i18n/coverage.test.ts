/**
 * Coverage test for i18n — prevents silent fallback to English in non-English locales.
 *
 * Every `t("key", "literal-fallback")` call in production source code must have
 * a matching entry in both en.json and es.json. The third-argument "fallback"
 * string passed to `t()` only fires when the runtime fails to resolve the key,
 * which is exactly the "ghost English in Spanish UI" symptom we want to catch
 * at CI rather than via user reports.
 *
 * Skips (intentionally NOT matched):
 * - `t("key")` with no second argument (no fallback to assert against)
 * - `t(`template_${var}`, ...)` — non-literal key
 * - `t(variable, ...)` — non-literal key
 * - `t("key", fallbackExpr)` — non-literal fallback (would be matched but
 *   resulting key list is still validated against the locale).
 *
 * Scope: walks src/**.ts(x), excluding tests/ and mocks/ to avoid scanning
 * test fixtures and mock i18n stubs that intentionally use sentinel keys.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(CURRENT_DIR, "../../..");
const LOCALES_DIR = path.join(PROJECT_ROOT, "public", "locales");
const SRC_DIR = path.join(PROJECT_ROOT, "src");

// Matches: t("key", "fallback") or t('key', 'fallback').
// Group 1 = key, group 2 = fallback string.
// Stops at the second quoted string, safe with options-object third arg.
const FALLBACK_PATTERN =
  /(?<!\w)t\(\s*["']([A-Za-z][\w._-]*)["']\s*,\s*["']([^"']+)["']/g;

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "tests",
  "__tests__",
  "mocks",
  "dist",
  "coverage",
  ".git",
]);
const SOURCE_EXT = /\.(tsx?|jsx?)$/;
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;

interface KeyEntry {
  key: string;
  fileRel: string;
  line: number;
}

function walkSource(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walkSource(full, acc);
    } else if (SOURCE_EXT.test(entry.name) && !TEST_FILE.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function extractKeys(filePath: string): KeyEntry[] {
  const content = fs.readFileSync(filePath, "utf8");
  const rel = path.relative(PROJECT_ROOT, filePath);
  const results: KeyEntry[] = [];
  FALLBACK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  // Run against the whole file, not per line: the pattern's `\s*` already
  // spans newlines, so a prettier-formatted multi-line `t("key",
  // "fallback")` call was previously invisible to the line-by-line scan.
  while ((match = FALLBACK_PATTERN.exec(content)) !== null) {
    const line = content.slice(0, match.index).split("\n").length;
    // The capture group always matched (the while loop entered), so the
    // index is non-undefined; `!` narrows the index-signature type.
    results.push({ key: match[1]!, fileRel: rel, line });
  }
  return results;
}

const enData = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
);
const esData = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "es.json"), "utf8"),
);

// ─── Empty-value guard for a11y-critical keys ──────────────────────────
//
// Components render visible text (headings, buttons, aria-labels) via the
// JS idiom `t("key") || "literal fallback"`. An empty-string value in
// en.json makes the default English UI fall back to that literal (or, when
// the component has no fallback, render blank). Either way the key should
// carry real text in the source locale, so this class is guarded separately
// from the key-presence checks above.

// Matches: t("key") || "fallback" (JSX-style `||` fallback).
// Group 1 = key. Stops at the first `||` literal. `(?<!\w)` mirrors
// FALLBACK_PATTERN so `foo.t("key") || ...` method calls don't false-match.
const JS_FALLBACK_PATTERN =
  /(?<!\w)t\(\s*["']([A-Za-z][\w._-]*)["']\s*\)\s*\|\|\s*["'][^"']+["']/g;

function extractJsFallbackKeys(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf8");
  const keys = new Set<string>();
  JS_FALLBACK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JS_FALLBACK_PATTERN.exec(content)) !== null) {
    keys.add(match[1]!);
  }
  return [...keys];
}

const JS_FALLBACK_KEYS = walkSource(SRC_DIR).flatMap(extractJsFallbackKeys);

function reportEmpty(locale: string, empty: string[]): string {
  const ctx = empty
    .map((k) => `  ${k}`)
    .join("\n");
  return (
    `Empty a11y-critical values in public/locales/${locale}.json:\n${ctx}\n\n` +
    `These keys are rendered via t('key') || 'fallback' in source; an empty\n` +
    `string makes the default UI render the fallback literal or blank text.`
  );
}

const ALL_ENTRIES: KeyEntry[] = walkSource(SRC_DIR).flatMap(extractKeys);
const UNIQUE_KEYS = [...new Set(ALL_ENTRIES.map((e) => e.key))];

function reportMissing(locale: string, missing: string[]): string {
  const ctx = missing
    .map((k) => {
      const e = ALL_ENTRIES.find((x) => x.key === k)!;
      return `  ${e.fileRel}:${e.line} → ${k}`;
    })
    .join("\n");
  return (
    `Missing ${missing.length} keys in public/locales/${locale}.json:\n${ctx}\n\n` +
    `Add the keys manually to BOTH public/locales/en.json and es.json with\n` +
    `proper translations (English + Spanish).`
  );
}

describe("i18n coverage — every t('key', 'fallback') call must resolve in en.json + es.json", () => {
  it("scans at least 50 unique keys with fallback args (sanity floor for the suite)", () => {
    // Sanity check: the suite must register a meaningful scan surface.
    // If this drops below 50, the scan scope / regex regressed.
    expect(UNIQUE_KEYS.length).toBeGreaterThanOrEqual(50);
  });

  it("en.json contains every discovered key (no fallback in English UI)", () => {
    const missing = UNIQUE_KEYS.filter((k) => enData[k] === undefined);
    expect(missing, reportMissing("en", missing)).toEqual([]);
  });

  it("es.json contains every discovered key (no fallback-to-English in Spanish UI)", () => {
    const missing = UNIQUE_KEYS.filter((k) => esData[k] === undefined);
    expect(missing, reportMissing("es", missing)).toEqual([]);
  });
});

describe("i18n empty-value guard — no blank English/Spanish UI for a11y-critical keys", () => {
  it("scans a meaningful set of JS `|| \"fallback\"` keys (sanity floor)", () => {
    expect(JS_FALLBACK_KEYS.length).toBeGreaterThanOrEqual(10);
  });

  it("en.json has non-empty values for every JS-fallback key", () => {
    const empty = JS_FALLBACK_KEYS.filter((k) => {
      const v = enData[k];
      return typeof v !== "string" || v.trim() === "";
    });
    expect(empty, reportEmpty("en", empty)).toEqual([]);
  });

  it("es.json has non-empty values for every JS-fallback key present there", () => {
    // Only flag keys that EXIST in es.json with an empty value. A missing
    // key is a legitimate fallback-to-English (the key-presence checks in
    // the suite above cover the t('key', 'fallback') class), so it must
    // not fail here.
    const empty = JS_FALLBACK_KEYS.filter((k) => {
      const v = esData[k];
      return typeof v === "string" && v.trim() === "";
    });
    expect(empty, reportEmpty("es", empty)).toEqual([]);
  });
});
