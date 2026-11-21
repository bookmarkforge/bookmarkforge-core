/**
 * scripts/i18n-translate-llm.mjs — Translation generator using LLM
 *
 * This script uses an LLM (OpenAI GPT-4 by default) to generate translations
 * for missing keys in each locale, using en.json as the reference.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-xxx node scripts/i18n-translate-llm.mjs [locale] [--dry-run]
 *
 * Environment variables:
 *   OPENAI_API_KEY - Required: OpenAI API key
 *   LLM_MODEL - Optional: Model to use (default: gpt-4)
 *   LLM_PROVIDER - Optional: Provider (default: openai)
 *
 * Arguments:
 *   [locale] - Optional: Process only specific locale (e.g., es, de, fr)
 *   --dry-run - Optional: Show what would be translated without writing
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LOCALES_DIR = join(ROOT, "scripts", "translations");
// const BASELINE_PATH = join(ROOT, "scripts", "i18n-backlog-baseline.json");

// Configuration
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4";
// const LLM_PROVIDER = process.env.LLM_PROVIDER || "openai";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error("❌ Error: OPENAI_API_KEY environment variable is required");
  console.log("   Usage: OPENAI_API_KEY=sk-xxx node scripts/i18n-translate-llm.mjs [locale] [--dry-run]");
  process.exit(1);
}

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

/** Unflatten dotted keys back to nested structure. */
function unflatten(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const parts = key.split(".");
    let current = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }
    current[parts[parts.length - 1]] = value;
  }
  return out;
}

/** Get locale metadata (lang name, direction, etc.) */
function getLocaleMetadata(locale) {
  const metadata = {
    ar: { langName: "Arabic", dir: "rtl" },
    bg: { langName: "Bulgarian", dir: "ltr" },
    cs: { langName: "Czech", dir: "ltr" },
    da: { langName: "Danish", dir: "ltr" },
    de: { langName: "German", dir: "ltr" },
    el: { langName: "Greek", dir: "ltr" },
    es: { langName: "Spanish", dir: "ltr" },
    fi: { langName: "Finnish", dir: "ltr" },
    fr: { langName: "French", dir: "ltr" },
    he: { langName: "Hebrew", dir: "rtl" },
    hi: { langName: "Hindi", dir: "ltr" },
    hr: { langName: "Croatian", dir: "ltr" },
    hu: { langName: "Hungarian", dir: "ltr" },
    id: { langName: "Indonesian", dir: "ltr" },
    it: { langName: "Italian", dir: "ltr" },
    ja: { langName: "Japanese", dir: "ltr" },
    ko: { langName: "Korean", dir: "ltr" },
    nl: { langName: "Dutch", dir: "ltr" },
    no: { langName: "Norwegian", dir: "ltr" },
    pl: { langName: "Polish", dir: "ltr" },
    pt: { langName: "Portuguese", dir: "ltr" },
    ro: { langName: "Romanian", dir: "ltr" },
    ru: { langName: "Russian", dir: "ltr" },
    sv: { langName: "Swedish", dir: "ltr" },
    th: { langName: "Thai", dir: "ltr" },
    tr: { langName: "Turkish", dir: "ltr" },
    uk: { langName: "Ukrainian", dir: "ltr" },
    vi: { langName: "Vietnamese", dir: "ltr" },
    zh: { langName: "Chinese", dir: "ltr" },
  };
  return metadata[locale] || { langName: locale.toUpperCase(), dir: "ltr" };
}

/** Call OpenAI API to translate text */
async function translateWithOpenAI(text, targetLocale, sourceText, context) {
  const prompt = `You are a professional translator. Translate the following text from English to ${targetLocale.toUpperCase()}.

Source text: ${sourceText}
Context: ${context}

IMPORTANT GUIDELINES:
- Maintain the same meaning and tone as the original
- Keep placeholders like {{variable}} unchanged
- Keep HTML tags unchanged
- For UI text, be concise and natural
- For marketing text, be persuasive but not misleading
- Do not translate proper nouns (BookmarkForge, Raindrop, Pocket, etc.)
- For technical terms, use common translations or keep in English if no standard exists

Translate the following:
${text}

Output ONLY the translated text, no explanations or notes.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a professional translator. You translate text accurately while maintaining context, tone, and formatting. Keep placeholders, HTML tags, and proper nouns unchanged.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error(`❌ Error calling OpenAI API: ${error.message}`);
    throw error;
  }
}

/** Main translation function */
async function translateLocale(locale, dryRun = false) {
  console.log(`\n🌍 Processing locale: ${locale}`);

  // Load source (en.json)
  const enFile = join(LOCALES_DIR, "en.json");
  const enData = JSON.parse(readFileSync(enFile, "utf8"));
  const enFlat = flatten(enData);
  const enKeys = Object.keys(enFlat);

  // Load target locale
  const targetFile = join(LOCALES_DIR, `${locale}.json`);
  const targetData = JSON.parse(readFileSync(targetFile, "utf8"));
  const targetFlat = flatten(targetData);

  // Find missing keys
  const missingKeys = enKeys.filter((k) => targetFlat[k] === undefined);

  console.log(`📊 Found ${missingKeys.length} missing keys out of ${enKeys.length} total`);

  if (missingKeys.length === 0) {
    console.log(`✅ All keys are already translated`);
    return;
  }

  console.log(`\n🔄 Translating ${missingKeys.length} keys...`);

  let translatedCount = 0;
  const translations = {};

  for (const key of missingKeys) {
    const sourceText = enFlat[key];
    const context = key.split(".").join(" → ");

    try {
      console.log(`  [${translatedCount + 1}/${missingKeys.length}] Translating: ${key}`);
      const translated = await translateWithOpenAI(sourceText, locale, sourceText, context);
      translations[key] = translated;
      translatedCount++;

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`  ❌ Failed to translate: ${key} - ${error.message}`);
      translations[key] = sourceText; // Fallback to source
    }
  }

  console.log(`\n✅ Translated ${translatedCount}/${missingLength} keys`);

  if (!dryRun) {
    // Merge translations with existing data
    const mergedFlat = { ...targetFlat, ...translations };
    const mergedData = unflatten(mergedFlat);

    // Write back to file
    writeFileSync(targetFile, JSON.stringify(mergedData, null, 2), "utf8");
    console.log(`💾 Saved translations to ${targetFile}`);
  } else {
    console.log(`🔍 Dry run: ${translatedCount} keys would be translated`);
  }
}

// Parse arguments
const args = process.argv.slice(2);
const targetLocale = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");

// Get list of locales to process
const metadata = getLocaleMetadata(targetLocale);
const localesToProcess = targetLocale ? [targetLocale] : Object.keys(metadata);

console.log(`📋 Locales to process: ${localesToProcess.join(", ")}`);
console.log(`🤖 LLM Model: ${LLLM_MODEL}`);
console.log(`🔒 Dry run: ${dryRun ? "YES" : "NO"}`);

// Process each locale
for (const locale of localesToProcess) {
  if (locale === "en") {
    console.log(`⏭️  Skipping en.json (source locale)`);
    continue;
  }

  await translateLocale(locale, dryRun);
}

console.log("\n✨ Translation complete!");
