/**
 * scripts/auto-translate-missing.mjs — Auto-translate missing keys using MyMemory API
 *
 * This script automatically translates missing keys from .missing-with-values.txt
 * to all 30 locales using the free MyMemory translation API.
 *
 * Usage:
 *   node scripts/auto-translate-missing.mjs [--locale <code>] [--email <email>]
 *
 * Arguments:
 *   --locale <code> - Optional: Process only specific locale (e.g., es, de, fr)
 *   --email <email> - Optional: Your email to increase daily quota to 50,000 chars
 *
 * MyMemory API limits:
 *   - Without email: 5,000 characters/day
 *   - With email: 50,000 characters/day
 *   - Max 500 bytes per request
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LOCALES_DIR = join(ROOT, "public", "locales");
const MISSING_FILE = join(ROOT, "scripts", "locales", ".missing-with-values.txt");

// Parse arguments
const args = process.argv.slice(2);
const targetLocale = args.indexOf("--locale") !== -1 ? args[args.indexOf("--locale") + 1] : null;
const userEmail = args.indexOf("--email") !== -1 ? args[args.indexOf("--email") + 1] : null;

// All 30 locales
const LOCALES = [
  "ar", "bg", "cs", "da", "de", "el", "es", "fi", "fr", "he",
  "hi", "hr", "hu", "id", "it", "ja", "ko", "nl", "no", "pl",
  "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "zh"
];

// Language codes for MyMemory API
const MYMEMORY_LANG_CODES = {
  ar: "ar", bg: "bg", cs: "cs", da: "da", de: "de", el: "el", es: "es",
  fi: "fi", fr: "fr", he: "he", hi: "hi", hr: "hr", hu: "hu", id: "id",
  it: "it", ja: "ja", ko: "ko", nl: "nl", no: "no", pl: "pl", pt: "pt",
  ro: "ro", ru: "ru", sv: "sv", th: "th", tr: "tr", uk: "uk", vi: "vi",
  zh: "zh"
};

/** Parse .missing-with-values.txt file */
function parseMissingFile() {
  const content = readFileSync(MISSING_FILE, "utf-8");
  const lines = content.trim().split("\n");
  const missingKeys = {};

  for (const line of lines) {
    const [key, ...valueParts] = line.split(" = ");
    if (key && valueParts.length > 0) {
      missingKeys[key] = valueParts.join(" = ");
    }
  }

  return missingKeys;
}

/** Translate text using MyMemory API */
async function translateWithMyMemory(text, targetLang) {
  const sourceLang = "en";
  const langPair = `${sourceLang}|${targetLang}`;

  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.append("q", text);
  url.searchParams.append("langpair", langPair);

  if (userEmail) {
    url.searchParams.append("email", userEmail);
  }

  try {
    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.responseStatus === 200) {
      return data.responseData.translatedText;
    } else {
      console.error(`MyMemory API error: ${data.responseDetails}`);
      throw new Error(data.responseDetails);
    }
  } catch (error) {
    console.error(`Translation error: ${error.message}`);
    throw error;
  }
}

/** Load and parse a locale JSON file */
function loadLocale(locale) {
  const filePath = join(LOCALES_DIR, `${locale}.json`);
  if (!existsSync(filePath)) {
    console.error(`Locale file not found: ${filePath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

/** Save locale JSON file */
function saveLocale(locale, data) {
  const filePath = join(LOCALES_DIR, `${locale}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/** Determine if a key is nested (contains dots) */
function isNestedKey(key) {
  return key.includes(".");
}

/** Set nested key value in object */
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

/** Main translation function */
async function translateMissingKeys() {
  console.log("🌍 Auto-translating missing keys using MyMemory API\n");

  // Parse missing keys file
  const missingKeys = parseMissingFile();
  console.log(`📋 Found ${Object.keys(missingKeys).length} missing keys to translate\n`);

  // Determine which locales to process
  const localesToProcess = targetLocale ? [targetLocale] : LOCALES;

  if (targetLocale && !LOCALES.includes(targetLocale)) {
    console.error(`❌ Invalid locale code: ${targetLocale}`);
    console.log(`Valid locales: ${LOCALES.join(", ")}`);
    process.exit(1);
  }

  console.log(`🔤 Locales to process: ${localesToProcess.join(", ")}`);
  console.log(`📧 Email provided: ${userEmail ? "Yes (50,000 chars/day)" : "No (5,000 chars/day)"}`);
  console.log();

  let totalTranslated = 0;
  let totalErrors = 0;

  for (const locale of localesToProcess) {
    console.log(`\n🔄 Processing ${locale}...`);

    const localeData = loadLocale(locale);
    const myMemoryLang = MYMEMORY_LANG_CODES[locale] || locale;

    let localeTranslated = 0;
    let localeErrors = 0;

    for (const [key, englishText] of Object.entries(missingKeys)) {
      // Check if key already exists in locale
      if (isNestedKey(key)) {
        const parts = key.split(".");
        let current = localeData;
        let exists = true;

        for (const part of parts) {
          if (!current[part]) {
            exists = false;
            break;
          }
          current = current[part];
        }

        if (exists) {
          continue; // Skip if already translated
        }
      } else {
        if (localeData[key] !== undefined) {
          continue; // Skip if already translated
        }
      }

      try {
        console.log(`  [${localeTranslated + 1}] Translating: ${key}`);

        // Translate
        const translated = await translateWithMyMemory(englishText, myMemoryLang);

        // Set the translated value
        setNestedValue(localeData, key, translated);

        localeTranslated++;
        totalTranslated++;

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`  ❌ Failed to translate ${key}: ${error.message}`);
        localeErrors++;
        totalErrors++;

        // Use English as fallback
        setNestedValue(localeData, key, englishText);
      }
    }

    // Save the updated locale file
    saveLocale(locale, localeData);

    console.log(`✅ ${locale}: ${localeTranslated} translated, ${localeErrors} errors`);
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Total translated: ${totalTranslated}`);
  console.log(`   Total errors: ${totalErrors}`);
  console.log(`   Keys per locale: ${Object.keys(missingKeys).length}`);
  console.log(`   Total translations: ${totalTranslated} (out of ${Object.keys(missingKeys).length * localesToProcess.length})`);

  if (totalErrors > 0) {
    console.log(`\n⚠️  Some translations failed. Please review the affected keys manually.`);
  }

  console.log(`\n✨ Translation complete! Please review the translations for accuracy.`);
}

// Run the script
translateMissingKeys().catch((error) => {
  console.error(`\n❌ Fatal error: ${error.message}`);
  process.exit(1);
});
