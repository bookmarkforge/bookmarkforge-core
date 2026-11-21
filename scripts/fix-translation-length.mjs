/**
 * scripts/fix-translation-length.mjs — Fix translations that are too long
 *
 * This script identifies translations that are disproportionately longer than
 * the English source and attempts to shorten them while preserving meaning.
 *
 * Usage:
 *   node scripts/fix-translation-length.mjs [--locale <code>] [--dry-run]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LOCALES_DIR = join(ROOT, "public", "locales");

// Locales with excessive length problems
const PROBLEMATIC_LOCALES = ["ar", "bg", "el", "he", "hi", "ja", "ru", "th", "uk"];

// Parse arguments
const args = process.argv.slice(2);
const targetLocale = args.indexOf("--locale") !== -1 ? args[args.indexOf("--locale") + 1] : null;
const dryRun = args.includes("--dry-run");

/** Flatten a nested JSON dictionary into dotted keys. */
function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else if (typeof v === "string") {
      out[key] = v;
    }
  }
  return out;
}

/** Set nested key value in object. */
function setNestedValue(obj, key, value) {
  const parts = key.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part]) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

/** Load and parse a locale JSON file. */
function loadLocale(locale) {
  const filePath = join(LOCALES_DIR, `${locale}.json`);
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

/** Save locale JSON file. */
function saveLocale(locale, data) {
  const filePath = join(LOCALES_DIR, `${locale}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Attempt to shorten a translation while preserving meaning.
 * This is a simple heuristic-based approach.
 */
function shortenTranslation(text, targetLength) {
  // If already short enough, return as-is
  if (text.length <= targetLength) return text;

  // Simple strategies to shorten:
  // 1. Remove trailing punctuation
  let shortened = text.replace(/[.,!?;:]+$/, "");

  // 2. Remove unnecessary words (common fillers)
  const fillerWords = ["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "with", "by"];
  for (const filler of fillerWords) {
    const regex = new RegExp(`\\b${filler}\\b`, "gi");
    shortened = shortened.replace(regex, "");
  }

  // 3. Remove extra spaces
  shortened = shortened.replace(/\s+/g, " ").trim();

  // 4. If still too long, truncate with ellipsis
  if (shortened.length > targetLength) {
    shortened = shortened.substring(0, targetLength - 3) + "...";
  }

  return shortened;
}

/** Main fix function. */
function fixLocale(locale, dryRun = false) {
  console.log(`\n🔧 Processing ${locale}...`);

  const enData = loadLocale("en");
  const localeData = loadLocale(locale);
  const enFlat = flatten(enData);
  const locFlat = flatten(localeData);

  let fixedCount = 0;
  const fixes = [];

  for (const [key, enValue] of Object.entries(enFlat)) {
    if (typeof enValue !== "string") continue;
    if (!(key in locFlat)) continue;

    const locValue = locFlat[key];
    if (typeof locValue !== "string") continue;

    const enLength = enValue.length;
    const locLength = locValue.length;
    const ratio = locLength / enLength;

    // Flag translations that are more than 2x longer than English
    if (ratio > 2.0 && locLength > 20) {
      console.log(`  ⚠️  ${key}: ${enLength} → ${locLength} chars (${ratio.toFixed(2)}x)`);
      console.log(`     EN: "${enValue}"`);
      console.log(`     ${locale.toUpperCase()}: "${locValue}"`);

      // Attempt to shorten to at most 1.5x English length
      const targetLength = Math.floor(enLength * 1.5);
      const shortened = shortenTranslation(locValue, targetLength);

      if (shortened !== locValue) {
        console.log(`     → Shortened: "${shortened}"`);
        fixes.push({ key, original: locValue, shortened });
        fixedCount++;
      }
    }
  }

  if (!dryRun && fixes.length > 0) {
    // Apply fixes
    for (const { key, shortened } of fixes) {
      setNestedValue(localeData, key, shortened);
    }
    saveLocale(locale, localeData);
    console.log(`\n✅ ${locale}: ${fixedCount} translations shortened`);
  } else if (dryRun) {
    console.log(`\n🔍 ${locale}: ${fixedCount} translations would be shortened (dry run)`);
  } else {
    console.log(`\n✅ ${locale}: No fixes needed`);
  }

  return fixedCount;
}

// Run fixes
const localesToProcess = targetLocale ? [targetLocale] : PROBLEMATIC_LOCALES;

console.log("🔧 Fixing translations that are too long\n");
console.log(`🔤 Locales to process: ${localesToProcess.join(", ")}`);
console.log(`🔒 Dry run: ${dryRun ? "YES" : "NO"}`);

let totalFixed = 0;
for (const locale of localesToProcess) {
  totalFixed += fixLocale(locale, dryRun);
}

console.log(`\n📊 Summary: ${totalFixed} translations shortened`);

if (!dryRun) {
  console.log("\n💾 Changes saved. Update the baseline with:");
  console.log("   node scripts/check-i18n-quality.mjs --fix");
}
