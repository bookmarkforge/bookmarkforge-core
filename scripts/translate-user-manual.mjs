/**
 * scripts/translate-user-manual.mjs — Translate user manual to missing languages
 *
 * This script translates the user manual from English to the 16 missing languages
 * using the MyMemory API.
 *
 * Usage:
 *   node scripts/translate-user-manual.mjs [--locale <code>] [--email <email>]
 *
 * Arguments:
 *   --locale <code> - Optional: Process only specific locale (e.g., de, fr, it)
 *   --email <email> - Optional: Your email to increase daily quota to 50,000 chars
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DOCS_DIR = join(ROOT, "docs");
const SOURCE_FILE = join(DOCS_DIR, "user-manual-en.md");

// User-manual locales still missing
const MISSING_LOCALES = [
  "cs", "da", "de", "fi", "fr", "hr", "hu", "id", "it", "nl", "no", "pl", "sv", "tr", "vi"
];

// Language codes for MyMemory
const MYMEMORY_LANG_CODES = {
  cs: "cs", da: "da", de: "de", fi: "fi", fr: "fr", hr: "hr", hu: "hu",
  id: "id", it: "it", nl: "nl", no: "no", pl: "pl", sv: "sv", tr: "tr", vi: "vi"
};

// Parse arguments
const args = process.argv.slice(2);
const targetLocale = args.indexOf("--locale") !== -1 ? args[args.indexOf("--locale") + 1] : null;
const userEmail = args.indexOf("--email") !== -1 ? args[args.indexOf("--email") + 1] : null;
const dryRun = args.includes("--dry-run");

/** Split text into segments (by paragraphs and code lines) */
function splitIntoSegments(text) {
  const segments = [];
  const lines = text.split("\n");
  let currentSegment = "";

  for (const line of lines) {
    // A code line (starts with ```) starts a new segment
    if (line.startsWith("```")) {
      if (currentSegment) {
        segments.push(currentSegment);
        currentSegment = "";
      }
      segments.push(line);
      continue;
    }

    // Inside a code block, keep lines together
    if (segments.length > 0 && segments[segments.length - 1].startsWith("```")) {
      segments[segments.length - 1] += "\n" + line;
      if (line.startsWith("```")) {
        // End of the code block
        currentSegment = "";
      }
      continue;
    }

    // A heading or an empty line starts a new segment
    if (line.startsWith("#") || line.trim() === "") {
      if (currentSegment) {
        segments.push(currentSegment);
        currentSegment = "";
      }
      segments.push(line);
      continue;
    }

    // A list stays in the same segment
    if (line.startsWith("- ") || line.startsWith("* ") || /^\d+\./.test(line)) {
      currentSegment += (currentSegment ? "\n" : "") + line;
      continue;
    }

    // Normal paragraph - if it already has content, append the line
    if (currentSegment) {
      currentSegment += "\n" + line;
    } else {
      currentSegment = line;
    }

    // If the segment grows long (>400 chars), split it
    if (currentSegment.length > 400) {
      segments.push(currentSegment);
      currentSegment = "";
    }
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  return segments;
}

/** Traducir texto usando MyMemory API */
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

/** Traducir un manual completo */
async function translateManual(locale, dryRun = false) {
  console.log(`\n🔄 Translating manual to ${locale.toUpperCase()}...`);

  const sourceText = readFileSync(SOURCE_FILE, "utf-8");
  const segments = splitIntoSegments(sourceText);

  console.log(`📊 Split into ${segments.length} segments`);

  let translatedSegments = [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    console.log(`  [${i + 1}/${segments.length}] Translating segment (${segment.length} chars)...`);

    try {
      // Do not translate code lines or code headings
      if (segment.startsWith("```")) {
        translatedSegments.push(segment);
        successCount++;
        continue;
      }

      // No traducir encabezados markdown (mantener #, ##, etc.)
      if (segment.startsWith("#")) {
        const translated = await translateWithMyMemory(segment, MYMEMORY_LANG_CODES[locale]);
        translatedSegments.push(translated);
        successCount++;
      } else {
        const translated = await translateWithMyMemory(segment, MYMEMORY_LANG_CODES[locale]);
        translatedSegments.push(translated);
        successCount++;
      }

      // Short pause to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (error) {
      console.error(`  ❌ Failed to translate segment ${i + 1}: ${error.message}`);
      translatedSegments.push(segment); // Usar original como fallback
      errorCount++;
    }
  }

  const translatedText = translatedSegments.join("\n\n");

  if (!dryRun) {
    const outputFile = join(DOCS_DIR, `user-manual-${locale}.md`);
    writeFileSync(outputFile, translatedText, "utf-8");
    console.log(`✅ Saved to ${outputFile}`);
  } else {
    console.log(`🔍 Dry run: ${successCount} segments translated, ${errorCount} errors`);
  }

  return { successCount, errorCount };
}

// Main
const localesToProcess = targetLocale ? [targetLocale] : MISSING_LOCALES;

console.log("🌍 Translating User Manual to Missing Languages");
console.log(`🔤 Locales to process: ${localesToProcess.join(", ")}`);
console.log(`📧 Email provided: ${userEmail ? "Yes (50,000 chars/day)" : "No (5,000 chars/day)"}`);
console.log(`🔒 Dry run: ${dryRun ? "YES" : "NO"}`);

let totalSuccess = 0;
let totalErrors = 0;

for (const locale of localesToProcess) {
  if (!MISSING_LOCALES.includes(locale)) {
    console.log(`⏭️  Skipping ${locale} (not in missing list)`);
    continue;
  }

  const { successCount, errorCount } = await translateManual(locale, false);
  totalSuccess += successCount;
  totalErrors += errorCount;
}

console.log(`\n📊 Summary:`);
console.log(`   Total segments translated: ${totalSuccess}`);
console.log(`   Total errors: ${totalErrors}`);
console.log(`\n✨ Translation complete!`);
