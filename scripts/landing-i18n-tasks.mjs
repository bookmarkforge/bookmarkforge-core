#!/usr/bin/env node
/**
 * scripts/landing-i18n-tasks.mjs — maintenance helper for the landing
 * translation work.
 *
 * Two jobs, both derived from the same analysis the gate uses:
 *
 *   --baseline <file>   Write scripts/landing-i18n-baseline.json with the
 *                       CURRENT untranslated-leaf count of every locale
 *                       (the ratchet budget). Re-pinning is a deliberate act.
 *
 *   --tasks <dir>       Write one translation task per locale into <dir>:
 *                       the exact leaf paths that still carry English prose
 *                       plus the English source string of each. A translator
 *                       (human or agent) fills the same paths with the
 *                       translated string; scripts/apply-landing-i18n-patch.mjs
 *                       merges and validates the result.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDING_CODES } from "./landing-registry.mjs";
import { analyzeLocale, flattenLeaves } from "./check-landing-i18n.mjs";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(THIS_DIR, "..");
const TRANSLATIONS_DIR = join(ROOT, "scripts", "translations");

/** Locale names, used only to label the task files for the translator. */
const LOCALE_NAMES = {
  ar: "Arabic", bg: "Bulgarian", cs: "Czech", da: "Danish", de: "German",
  el: "Greek", en: "English", es: "Spanish", fi: "Finnish", fr: "French",
  he: "Hebrew", hi: "Hindi", hr: "Croatian", hu: "Hungarian",
  id: "Indonesian", it: "Italian", ja: "Japanese", ko: "Korean",
  nl: "Dutch", no: "Norwegian", pl: "Polish", pt: "Portuguese",
  ro: "Romanian", ru: "Russian", sv: "Swedish", th: "Thai",
  tr: "Turkish", uk: "Ukrainian", vi: "Vietnamese", zh: "Chinese",
};

function readLocale(code) {
  return JSON.parse(readFileSync(join(TRANSLATIONS_DIR, `${code}.json`), "utf8"));
}

function writeBaseline(file) {
  const english = readLocale("en");
  const enLeaves = flattenLeaves(english);
  const locales = {};
  for (const code of LANDING_CODES) {
    const result = analyzeLocale(english, readLocale(code), {
      sourceLocale: code === "en",
    });
    locales[code] = result.untranslated.length;
  }
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    note:
      "Per-locale budget of leaves still byte-identical to the English source. " +
      "Translating a locale lowers its number; re-pinning it upwards is a " +
      "deliberate act (ADR-069). The 'en' entry is the source itself (0).",
    locales,
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`wrote ${file}`);
  for (const [code, count] of Object.entries(locales)) {
    console.log(`  ${code.padEnd(3)} ${count}`);
  }
  // Sanity: the English source itself must be clean.
  if (Object.keys(enLeaves).length === 0) {
    throw new Error("en.json is empty");
  }
}

function writeTasks(dir) {
  mkdirSync(dir, { recursive: true });
  const english = readLocale("en");
  const enLeaves = flattenLeaves(english);
  for (const code of LANDING_CODES) {
    if (code === "en") continue;
    const result = analyzeLocale(english, readLocale(code), {
      sourceLocale: code === "en",
    });
    const strings = {};
    for (const path of result.untranslated) {
      strings[path] = enLeaves[path];
    }
    const payload = {
      locale: code,
      language: LOCALE_NAMES[code] ?? code,
      note:
        "Translate every path listed in `strings` into " +
        (LOCALE_NAMES[code] ?? code) +
        ". Keep the path keys EXACTLY as they are. Keep every HTML tag, " +
        "{{placeholder}}, URL, e-mail address, number and product name " +
        "unchanged. Return the same object with only the values translated.",
      strings,
    };
    const file = join(dir, `${code}.json`);
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(
      `${code.padEnd(3)} ${String(result.untranslated.length).padStart(4)} untranslated leaf/leaves -> ${file}`,
    );
  }
}

const args = process.argv.slice(2);
if (args[0] === "--baseline") {
  writeBaseline(args[1] ?? join(ROOT, "scripts", "landing-i18n-baseline.json"));
} else if (args[0] === "--tasks") {
  writeTasks(args[1] ?? join(ROOT, ".i18n-tasks"));
} else {
  console.error("usage: node scripts/landing-i18n-tasks.mjs --baseline <file> | --tasks <dir>");
  process.exit(2);
}
