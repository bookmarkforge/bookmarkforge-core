/**
 * scripts/check-i18n-quality.mjs — translation quality gate.
 *
 * Verifies translation quality vs the English source for keys that DO
 * exist in a locale:
 *   - empty string values (translation exists but is blank),
 *   - placeholder set mismatch: `{{var}}` placeholders in the translation
 *     must match en's exactly (a missing/renamed placeholder breaks the UI),
 *   - common UI action labels (Save, Cancel, Delete, …) whose value is
 *     byte-identical to the English source — a sign the key was added to
 *     en.json after the locale was translated and never localized,
 *   - untranslated multi-word values byte-identical to the CURRENT English
 *     reference (same failure mode as the action labels, but for any
 *     phrase — the class the 2026-08 audit found in bg/el/th/hi/ar),
 *   - cross-script contamination: a value mixing ≥2 distinct non-Latin
 *     writing systems (Cyrillic inside Hebrew, Chinese inside Korean, …) —
 *     the signature of an MT pipeline gluing the wrong source fragment
 *     into an otherwise-correct translation (fixed across 17 locales for
 *     the 2026-08 audit),
 *   - embedded-Latin contamination: ASCII letters inside an otherwise
 *     non-Latin word ("Πlease", "תAGים", "บุ๊คมาrk") — the same MT
 *     accident class where ASCII is NOT neutral, because Latin fragments
 *     glued into Cyrillic/Greek/Hebrew/Thai words are the signal (fixed
 *     across 16 locales in the 2026-08 follow-up; brand/tech tokens like
 *     "WebLLM" or "AI" legitimately appear inside Japanese/Korean/Chinese
 *     text and are allowlisted).
 *
 * Known, intentional issues are recorded in
 * scripts/i18n-quality-baseline.json; the gate fails only on NEW issues
 * beyond that baseline.
 *
 * Usage:
 *   node scripts/check-i18n-quality.mjs            # gate
 *   node scripts/check-i18n-quality.mjs --fix      # rebaseline
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LENGTH_RATIO_CAP, lengthStats } from "./audit-core.mjs";

const ROOT = process.cwd();
const LOCALES_DIR = join(ROOT, "public", "locales");
const BASELINE_PATH = join(ROOT, "scripts", "i18n-quality-baseline.json");

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

function placeholders(value) {
  const out = new Set();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m;
  while ((m = re.exec(value)) !== null) out.add(m[1].trim());
  return out;
}

/**
 * Single-brace placeholder detector (batch-27).
 *
 * i18next's default interpolation prefix is `{{` — a value that contains a
 * SINGLE-brace placeholder (`{count}`, `{percent}`, `{column}`) is NOT
 * interpolated and renders LITERALLY on screen. batch-27 migrated every
 * occurrence to `{{...}}` (e.g. app_tokensCount, app_percentUsed, add_card);
 * this gate keeps them out: it strips every `{{...}}` pair, then flags any
 * remaining `{word}`. The regex mirrors src/tests/i18n-runtime.test.ts so
 * the file-level gate and the runtime suite agree on the invariant.
 */
const SINGLE_BRACE_RE = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;

/** Returns the offending `{word}` fragment, or null when the value is clean. */
function findSingleBrace(value) {
  const withoutDouble = value.replace(/\{\{[^}]*\}\}/g, "");
  const m = withoutDouble.match(SINGLE_BRACE_RE);
  return m ? m[0] : null;
}

/**
 * Common UI action labels. A locale value that is byte-identical to the
 * English source for one of these is almost certainly an untranslated key
 * (a translator rarely leaves "Save"/"Cancel" as-is). Proper nouns and
 * technical terms (WebLLM, Ollama, Gemini, AI Search…) are deliberately NOT
 * in this list, so they never false-positive.
 */
/**
 * Cross-script contamination detector (2026-08 audit fix).
 *
 * A value whose non-ASCII characters belong to ≥2 DISTINCT writing systems
 * is almost always a machine-translation pipeline accident: a fragment of
 * the wrong source language (Cyrillic inside Hebrew, simplified Chinese
 * inside Korean/Bulgarian/Ukrainian, Korean inside Japanese, …) was glued
 * into an otherwise-correct translation. The 2026-08 audit found ~52 such
 * values across 17 locales and fixed them all; this gate keeps the class
 * out. ASCII is deliberately neutral — brand names ("AI", "PDF", "WebLLM")
 * and punctuation legitimately appear inside any locale. Kana + Kanji are
 * treated as ONE script (the Japanese writing system) so ordinary Japanese
 * text never flags; Han characters inside Hangul/Devanagari/Cyrillic text
 * are a real contamination signal, not a false positive.
 */
const SCRIPT_BLOCKS = [
  [0x0590, 0x05ff, "Hebrew"],
  [0x0600, 0x06ff, "Arabic"],
  [0x0900, 0x097f, "Devanagari"],
  [0x0e00, 0x0e7f, "Thai"],
  [0x0400, 0x04ff, "Cyrillic"],
  [0x0370, 0x03ff, "Greek"],
  [0x3040, 0x30ff, "Japanese"], // hiragana + katakana
  [0x3400, 0x9fff, "Japanese"], // kanji (CJK ideographs) — same writing system
  [0xac00, 0xd7af, "Korean"],
];

/** Distinct non-Latin scripts present in a value (ASCII is neutral). */
function nonLatinScripts(value) {
  const scripts = new Set();
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) continue;
    for (const [lo, hi, name] of SCRIPT_BLOCKS) {
      if (cp >= lo && cp <= hi) {
        scripts.add(name);
        break;
      }
    }
  }
  return scripts;
}

/** Keys allowed to mix scripts — only for genuinely bilingual UI text. */
const CROSS_SCRIPT_KEY_EXCEPTIONS = new Set([]);

/**
 * Embedded-Latin contamination detector (2026-08 audit follow-up).
 *
 * A WORD (letter run) that mixes ASCII Latin with a genuinely non-Latin
 * script is almost always an MT accident: the pipeline glued a wrong-script
 * fragment into an otherwise-correct translation. The audit found ~60
 * values across 16 locales — "Πlease" (el), "תAGים" (he), "บุ๊คมาrk" (th),
 * "flashкарток" (uk), "ОлламаUrlПример" (ru), "CsvСводка" (ru/bg/th/ko),
 * "Gesundheits评分" (de), "ne莫能生成内容" (hr), … — and this gate keeps the
 * class out. Unlike the cross-script scan above, ASCII is NOT neutral here:
 * Latin letters inside a non-Latin word ARE the signal.
 *
 * Legitimate exceptions are allowlisted with the exact casing they appear
 * in ("WebLLM" yes, "Csv" no): product/tech brand tokens and shortcut
 * keys legitimately appear inside Japanese/Korean/Chinese text (loanword
 * compounds like "AIを起動中", "BookmarkForge는") and as file-extension
 * tokens in dev-facing strings ("license.ts", ".bmf"). Runs are matched
 * against two tiers: EMBEDDED_LATIN_SAFE_EXACT (case-sensitive mixed-case
 * brands) and EMBEDDED_LATIN_SAFE_UPPER (all-uppercase tokens, which must
 * be ALL-CAPS to pass — so the MT glue "Csv"/"Url" casing never slips
 * through). Digits are part of a run ("P2P", "F5", "Argon2id"), so
 * "P2Pコラボレーション" never false-positives.
 */
const EMBEDDED_LATIN_SAFE_EXACT = new Set([
  "Agency", "Agents", "Android", "Anthropic", "Argon2id", "BookmarkForge",
  "Chrome", "Claude", "Clipper", "CodeQL", "Copilot", "Ctrl", "DevOps",
  "Dexie", "Edge", "Enter", "Esc", "F5", "Firefox", "Forge", "GitHub",
  "Gemini", "Groq",  "IndexedDB", "iOS", "KeePass", "Linux", "Mac", "Markdown",
  "Nextcloud", "Notion", "Obsidian", "Ollama", "OpenAI", "Pro", "PWA",
  "RxDB", "Safari", "Shift", "SQLite", "ToDo", "TurboQuant", "Web",
  "WebDAV", "WebGPU", "WebLLM", "WebRTC", "Windows", "bmf", "js",
  "json", "md", "mjs", "ts", "tsx", "yaml", "yml",
]);
const EMBEDDED_LATIN_SAFE_UPPER = new Set([
  "AES", "AI", "API", "B", "CSV", "CPU", "F5", "GB", "GCM", "GPL",
  "GPU", "HTML", "HTTP", "HTTPS", "ID", "JSON", "JSONL", "K", "KDF",
  "LLM", "MB", "MD", "MIT", "P2P", "PDF", "PRO", "QA", "QR", "RAG",
  "RAM", "RXDB", "SEO", "SPA", "SQLITE", "SSL", "SSH", "SW", "TLS",
  "TTS", "TURBOQUANT", "URL", "UX", "WEB", "WEBDAV", "WEBGPU", "WEBLLM",
  "WEBRTC", "WSS",
]);

/** Non-Latin scripts (excludes Latin-1/Latin-Extended diacritics). */
const EMBEDDED_LATIN_NONLATIN_RE =
  /[\u0370-\u03FF\u0400-\u052F\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u0900-\u097F\u0980-\u09FF\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0DFF\u0E00-\u0E7F\u0E80-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u10A0-\u10FF\u1100-\u11FF\u1780-\u17FF\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA48F\uA4D0-\uA4FF\uAC00-\uD7AF\uF900-\uFAFF]/;
const EMBEDDED_LATIN_LETTER_RE = /[A-Za-z]/;
const EMBEDDED_LATIN_RUN_RE = /[A-Za-z][A-Za-z0-9]*/g;

/**
 * Returns the first offending ASCII run (or null) for a value whose word
 * mixes Latin letters with a non-Latin script. A run passes when it exactly
 * matches a mixed-case brand or is an ALL-CAPS token from the upper tier.
 */
function findEmbeddedLatinRun(value) {
  const words = value.split(
    new RegExp(`[^A-Za-z0-9${EMBEDDED_LATIN_NONLATIN_RE.source.slice(1, -1)}]+`),
  );
  for (const w of words) {
    if (!EMBEDDED_LATIN_LETTER_RE.test(w) || !EMBEDDED_LATIN_NONLATIN_RE.test(w)) continue;
    EMBEDDED_LATIN_RUN_RE.lastIndex = 0;
    let m;
    while ((m = EMBEDDED_LATIN_RUN_RE.exec(w)) !== null) {
      const run = m[0];
      const safe =
        EMBEDDED_LATIN_SAFE_EXACT.has(run) ||
        (EMBEDDED_LATIN_SAFE_UPPER.has(run) && run === run.toUpperCase());
      if (!safe) return run;
    }
  }
  return null;
}

const UI_ACTION_VALUES = new Set([
  "Add", "Apply", "Back", "Back to App", "Cancel", "Clear", "Close",
  "Confirm", "Continue", "Copy", "Create", "Delete", "Disable",
  "Dismiss", "Done", "Download", "Edit", "Enable", "Export", "Go Back",
  "Hide", "Import", "Lock", "Next", "Open", "Refresh", "Remove",
  "Rename", "Reset", "Restore", "Retry", "Save", "Search", "Settings",
  "Share", "Show", "Skip", "Skip to content", "Submit", "Unlock",
  "Update", "Upload", "Backup", "Upgrade", "Sign in", "Sign out",
]);

/**
 * Per-locale keys that deliberately keep the English value: the loanword is
 * the standard UI term in that language (e.g. Indonesian UIs commonly use
 * "Edit" rather than "Mengedit"). The rule below skips these.
 */
const UI_ACTION_EXCEPTIONS = {
  id: new Set(["app_edit"]),
};

/**
 * Global key exceptions — these keys are allowed to have English values
 * in ALL locales. Used for support chat quick-action chips that are
 * intentionally kept short and English-consistent until proper
 * localization of the entire support module.
 */
const UI_ACTION_KEY_EXCEPTIONS = new Set([
  "app_supportActionSync",
  "app_supportActionShortcuts",
  "app_supportActionImport",
  "app_supportActionMobile",
]);

/**
 * Untranslated-value detector (2026-08 audit fix).
 *
 * A locale value byte-identical to the CURRENT English reference and
 * containing whitespace is the classic "key added to en.json, locale never
 * localized" pattern — distinct from the UI-action scan above (which only
 * knows a curated list of short labels) and from the stale-English scan
 * (which only catches OLD English). The 2026-08 audit found this class in
 * bg/el/th/hi/ar (app_publicDoc, app_clearFilters, app_apiKeyError, …).
 *
 * Exceptions: provider/product brand labels whose English form is the UI
 * term everywhere, the BMF Concierge support chat (app_supportChat*) which
 * is intentionally English until the support module is fully localized,
 * and a few short UI phrases that were left English in ALL 30 locales
 * before this gate existed. The latter are allowlisted ONLY to keep the
 * gate green on the pre-existing backlog — any NEW key left English in a
 * locale fails CI until it is translated or explicitly listed here.
 */
/**
 * Per-locale keys that deliberately keep a value identical to English: the
 * loanword is the standard term in that language, matching the locale's own
 * vocabulary elsewhere (e.g. cs uses "QA Tester" — identical to its own
 * app_qaTesterDesc "Popis pro QA Tester"). Same pattern as
 * UI_ACTION_EXCEPTIONS; keyed by locale so one locale's loanword never
 * masks another locale's real untranslated regression.
 */
const UNTRANSLATED_LOCALE_EXCEPTIONS = {
  cs: new Set(["app_qaTester"]),
};

const UNTRANSLATED_KEY_PREFIX_EXCEPTIONS = ["app_supportChat"];
const UNTRANSLATED_KEY_EXCEPTIONS = new Set([
  // Provider/product brand labels — the English form IS the UI term.
  "app_anthropic", // "Anthropic Claude"
  "app_apiKeyAllProviders", // "sk-..., AIza..., gsk_..." API-key example
  "app_groq", // "Groq (Llama/Mixtral)"
  "app_modelGemma2b", // "Gemma-2B-IT (Google, ~2GB)"
  "app_openai", // "OpenAI / OpenRouter"
  "googleDriveOption", // "Google Drive"
  "onedriveOption", // "Microsoft OneDrive"
  "syst_gbRam", // "GB RAM"
  "bookmarkForgeWebClipper", // "BookmarkForge {{webClipper}}"
  "onboarding_providerClaude", // "Anthropic Claude"
  "onboarding_providerGemini", // "Google Gemini"
  "onboarding_providerWebLLM", // "WebLLM (Local)"
  // Short UI phrases left English in ALL 30 locales before this gate
  // existed (pre-existing backlog — allowlisted so the gate starts green).
  "app_switchTabs", // "Switch views (1-6)"
  "app_noFlashcardsYet", // "No flashcards yet"
  "app_noFlashcardsHint",
  "app_goToEditor", // "Open Editor"
  "app_graphEmptyTitle", // "Your knowledge graph is empty"
  "app_graphEmptyDesc",
]);

const files = readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

const en = flatten(JSON.parse(readFileSync(join(LOCALES_DIR, "en.json"), "utf8")));

let baseline = { locales: {}, updatedAt: null };
if (existsSync(BASELINE_PATH)) {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

const results = {};
let failures = 0;

/**
 * Cross-locale stale-English detector (batch-35).
 *
 * en.json is the reference; when its wording changes (e.g. "Simulates
 * concurrent operations blocking the DB" from "...locking the DB"), locales
 * translated against the OLD wording keep the OLD ENGLISH VALUE byte-
 * identical across languages. That value is invisible to the audit's type B
 * (which only catches values equal to the CURRENT en reference) and to every
 * per-locale gate (completeness / length / placeholders all pass — it is
 * just the wrong, older English).
 *
 * Signal: an English-looking value byte-identical in >= STALE_MIN_SHARE
 * locales that DIFFERS from the current en reference. Two exclusions keep
 * it false-positive-free on legitimate shared values:
 *   - values equal to current en are the audit's type-B class, not stale;
 *   - STALE_SKIP_VALUES covers deliberate loanword/technical labels whose
 *     locale form intentionally keeps English word order ("URL WebDAV" is
 *     the native Romance/loanword order; "AI sommelier" is a loanword
 *     title whose only drift vs en is capitalization).
 *
 * Like every other issue type here it is baseline-able via the per-locale
 * counts: each affected locale gets a `stale English` issue, --fix records
 * the counts, and the gate fails only on NEW stale drift beyond baseline.
 */
const STALE_MIN_SHARE = 8;
const STALE_SKIP_VALUES = new Set(["URL WebDAV", "AI sommelier"]);

/** English-looking: ASCII words (>=2), no placeholders, no non-Latin script. */
function looksLikeStaleEnglish(value) {
  if (!/^[A-Za-z]/.test(value)) return false;
  if (/\{\{/.test(value)) return false;
  const words = value.split(/\s+/);
  if (words.length < 2) return false;
  return words.every((w) => /^[A-Za-z0-9'’\-.,:;()\/&%€@#+=*!?]+$/.test(w));
}

// Pre-pass: attribute stale-English issues per locale BEFORE the per-locale
// loop so they land in the same `issues` array + baseline mechanism.
const staleByLocale = {};
{
  const dicts = files
    .filter((f) => f !== "en.json")
    .map((f) => ({
      locale: f.replace(/\.json$/, ""),
      dict: flatten(JSON.parse(readFileSync(join(LOCALES_DIR, f), "utf8"))),
    }));
  for (const [key, enValue] of Object.entries(en)) {
    if (typeof enValue !== "string" || !enValue.trim()) continue;
    const groups = new Map();
    for (const { locale, dict } of dicts) {
      const v = dict[key];
      if (typeof v !== "string" || !v.trim()) continue;
      const arr = groups.get(v);
      if (arr) arr.push(locale);
      else groups.set(v, [locale]);
    }
    for (const [v, locales] of groups) {
      if (locales.length < STALE_MIN_SHARE) continue;
      if (v === enValue) continue; // type B (audit) territory, not stale
      if (STALE_SKIP_VALUES.has(v)) continue;
      if (!looksLikeStaleEnglish(v)) continue;
      for (const locale of locales) {
        (staleByLocale[locale] ??= []).push(
          `stale English (shared by ${locales.length} locales): ${key}`,
        );
      }
    }
  }
}

for (const file of files) {
  if (file === "en.json") continue;
  const locale = file.replace(/\.json$/, "");
  const dict = flatten(JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8")));
  const issues = [];

  for (const [key, enValue] of Object.entries(en)) {
    const value = dict[key];
    if (value === undefined) continue; // completeness handles missing keys
    // Empty source → nothing to verify: an empty translation of an empty
    // en value is faithful, not a defect (e.g. keys en.json deliberately
    // leaves blank). Only non-empty sources can regress in quality.
    if (enValue.trim() === "") continue;
    if (value.trim() === "") {
      issues.push(`empty value: ${key}`);
      continue;
    }
    const a = placeholders(enValue);
    const b = placeholders(value);
    const missing = [...a].filter((p) => !b.has(p));
    const extra = [...b].filter((p) => !a.has(p));
    if (missing.length > 0) issues.push(`missing placeholders [${missing.join(", ")}]: ${key}`);
    if (extra.length > 0) issues.push(`extra placeholders [${extra.join(", ")}]: ${key}`);

    // Untranslated UI action: value identical to the English source.
    // Both sides are trimmed so stray whitespace does not create a false
    // positive. Extend UI_ACTION_EXCEPTIONS when a locale legitimately keeps
    // a loanword identical to English (e.g. Indonesian UI "Edit").
    if (
      UI_ACTION_VALUES.has(enValue.trim()) &&
      value.trim() === enValue.trim() &&
      !(UI_ACTION_EXCEPTIONS[locale]?.has(key)) &&
      !UI_ACTION_KEY_EXCEPTIONS.has(key)
    ) {
      issues.push(`untranslated UI action: ${key}`);
    }

    // Untranslated value: any multi-word phrase byte-identical to the
    // current English reference (see UNTRANSLATED_KEY_EXCEPTIONS for the
    // deliberate-English allowlist). Single-token values are auto-safe —
    // brand/model names ("WebLLM", "Ollama") are legitimately identical.
    if (
      value.trim() === enValue.trim() &&
      /\s/.test(value.trim()) &&
      !UI_ACTION_VALUES.has(enValue.trim()) &&
      !UNTRANSLATED_KEY_EXCEPTIONS.has(key) &&
      !UNTRANSLATED_LOCALE_EXCEPTIONS[locale]?.has(key) &&
      !UNTRANSLATED_KEY_PREFIX_EXCEPTIONS.some((p) => key.startsWith(p))
    ) {
      issues.push(`untranslated value (identical to en): ${key}`);
    }

    // Disproportionate length (batch-30/31): the static signature of a UI
    // overflow. A short label ("Sync Error", "Backup now") that becomes a
    // 2.5×+ compound in German/Finnish/Hungarian blows past fixed-width
    // buttons and table cells; the runtime guard is the text-fit e2e spec,
    // this catches the pattern at file level before any render. The
    // threshold + strip-placeholders logic lives in audit-core.mjs
    // (lengthStats), shared with gen-length-report.mjs so gate and report
    // can't drift. Note: on first application --fix writes the baseline but
    // still exits 1 (failures computed against the pre-change baseline) —
    // expected; re-run the gate after rebaselining to confirm green.
    const len = lengthStats(enValue, value);
    if (len !== null && len.ratio > LENGTH_RATIO_CAP) {
      issues.push(
        `disproportionate length (${len.ratio.toFixed(2)}x): ${key} (en ${len.enLen} → ${len.locLen} chars)`,
      );
    }
  }

  // Single-brace placeholders render literally (i18next default prefix is
  // `{{`). batch-27 migrated {count}/{percent}/{column} to double-braces;
  // this scans EVERY value in the locale — including plural suffix keys
  // like app_tokensCount_one that don't exist in en and are therefore
  // invisible to the en-key loop above — so a reintroduced single brace
  // dies in CI without needing the runtime suite.
  for (const [key, value] of Object.entries(dict)) {
    const hit = findSingleBrace(value);
    if (hit) {
      issues.push(`single-brace placeholder ${hit} renders literally: ${key}`);
    }

    // Cross-script contamination: two+ non-Latin writing systems in one
    // value is an MT-pipeline accident (Cyrillic in Hebrew, Chinese in
    // Korean, …). Kana+Kanji count as one script, so Japanese never flags.
    const scripts = nonLatinScripts(value);
    if (scripts.size > 1 && !CROSS_SCRIPT_KEY_EXCEPTIONS.has(key)) {
      issues.push(`cross-script mix [${[...scripts].join("+")}]: ${key}`);
    }

    // Embedded-Latin contamination: ASCII letters inside an otherwise
    // non-Latin word ("Πlease", "תAGים", "บุ๊คมาrk") — the MT-glue class
    // where ASCII is NOT neutral. Brand/tech tokens (WebLLM, AI, …) inside
    // CJK text are legitimate and allowlisted; everything else flags.
    const badRun = findEmbeddedLatinRun(value);
    if (badRun !== null) {
      issues.push(`embedded Latin "${badRun}" in non-Latin word: ${key}`);
    }
  }

  if (staleByLocale[locale]) {
    issues.push(...staleByLocale[locale]);
  }

  const prev = baseline.locales?.[locale]?.issues ?? issues.length;
  const delta = issues.length - prev;
  results[locale] = issues;

  if (issues.length > prev) {
    console.error(
      `[check-i18n-quality] FAIL ${locale}: ${issues.length} issues (baseline ${prev}) — ` +
        issues.slice(0, 3).join("; ") + (issues.length > 3 ? "; …" : ""),
    );
    failures += 1;
  } else {
    console.log(
      `[check-i18n-quality] ok ${locale}: ${issues.length} issues (baseline ${prev}, delta ${delta})`,
    );
  }
}

// en.json is the reference and the main loop skips it, but a single-brace
// in the principal language is still a literal-render bug (batch-27 found
// `paid_featureLocked` in Spanish AND `{count}`/`{percent}`/`{column}`
// single-braces in the reference file itself). Scan it unconditionally —
// unlike per-locale counts this is not baseline-able: any single-brace in
// en.json is always a defect.
{
  const enDict = flatten(
    JSON.parse(readFileSync(join(LOCALES_DIR, "en.json"), "utf8")),
  );
  const enIssues = [];
  for (const [key, value] of Object.entries(enDict)) {
    const hit = findSingleBrace(value);
    if (hit) {
      enIssues.push(`single-brace placeholder ${hit} renders literally: ${key}`);
    }
  }
  if (enIssues.length > 0) {
    console.error(
      `[check-i18n-quality] FAIL en: ${enIssues.length} single-brace issue(s) — ` +
        enIssues.slice(0, 3).join("; ") +
        (enIssues.length > 3 ? "; …" : ""),
    );
    failures += 1;
  } else {
    console.log("[check-i18n-quality] ok en: single-brace scan clean");
  }
}

// en.json truncation detector (batch-34). An English reference cut
// mid-sentence ("If you don" — the real bug batch-32 fixed) is invisible to
// the per-locale length gate: the translations are COMPLETE sentences, so the
// locale side looks "verbose" rather than broken. Signal: short en value
// (10–40 chars), starts uppercase, no terminal punctuation, no label
// signature ("+"/digits — "Free + Paid Sync", "Ctrl+Shift+P"), whose
// translations average > TRUNCATION_RATIO_CAP × its length across ≥ 10
// locales. A genuine terse label ("Sync Error" → avg ~1.9×) stays under the
// ratio; a truncated sentence ("If you don" → avg ~7×) blows past it. Like
// the en single-brace scan this is NOT baseline-able — a truncated reference
// is always a defect. Semantically distinct from LENGTH_RATIO_CAP
// (per-locale, in audit-core.mjs): this one compares the AVG translation
// length to the en reference, so it gets its own constant.
const TRUNCATION_RATIO_CAP = 2.5;
{
  const enDict = flatten(
    JSON.parse(readFileSync(join(LOCALES_DIR, "en.json"), "utf8")),
  );
  const truncIssues = [];
  const dicts = files
    .filter((f) => f !== "en.json")
    .map((f) => flatten(JSON.parse(readFileSync(join(LOCALES_DIR, f), "utf8"))));

  for (const [key, value] of Object.entries(enDict)) {
    const t = value.trim();
    if (t.length < 10 || t.length > 40) continue;
    if (!/^[A-Z]/.test(t)) continue;
    if (/[.!?:…]$/.test(t)) continue;
    if (/[+/0-9]/.test(t)) continue;
    let tot = 0;
    let n = 0;
    for (const dict of dicts) {
      const lv = dict[key];
      if (typeof lv === "string" && lv.trim()) {
        tot += lv.replace(/\{\{[^}]*\}\}/g, "").trim().length;
        n += 1;
      }
    }
    if (n >= 10 && tot / n > TRUNCATION_RATIO_CAP * t.length) {
      truncIssues.push(
        `truncated en reference (avg ${(tot / n / t.length).toFixed(1)}x): ${key} ("${t}" — translations are full sentences)`,
      );
    }
  }

  if (truncIssues.length > 0) {
    console.error(
      `[check-i18n-quality] FAIL en: ${truncIssues.length} truncation(s) — ` +
        truncIssues.slice(0, 3).join("; ") +
        (truncIssues.length > 3 ? "; …" : ""),
    );
    failures += 1;
  } else {
    console.log("[check-i18n-quality] ok en: truncation scan clean");
  }
}

// en.json brand-casing detector (batch-37). The reference file's OWN casing
// was never validated: three audit rounds each found the same class —
// "Codeql Specialist"/"Qa Tester"/"Ux Designer" (agents), then the "Csv*"
// glue family, then "Api Designer"/"Devops Engineer"/"Seo Specialist" —
// because every other gate compares locales AGAINST en and en's own defects
// are invisible. Rule: a word-boundary token that starts uppercase and
// matches a known brand/acronym case-insensitively but differs from its
// canonical form ("Api" vs "API", "Codeql" vs "CodeQL"). Pure-lowercase
// tokens are exempt on purpose — "api" inside a real URL
// (http://localhost:11434/api/generate), "url" in {{url}} placeholders and
// ".json" file extensions are legitimate prose. Like the single-brace and
// truncation scans this is NOT baseline-able: a wrong-cased brand in the
// reference is always a defect.
const EN_BRAND_CANONICAL = new Set([
  "AES", "API", "CSV", "CodeQL", "Copilot", "DevOps", "GitHub", "GitLab",
  "HTML", "JSON", "JSONL", "JWT", "Markdown", "MFA", "Notion", "Obsidian",
  "OpenAI", "OTP", "P2P", "PDF", "PWA", "QA", "RAG", "SEO", "SHA",
  "SQL", "SQLite", "TTS", "UI", "URL", "UX", "WebDAV", "WebGPU",
  "WebLLM", "WebRTC", "XSS", "iOS", "iPad", "iPhone", "macOS",
  "Anthropic", "Claude", "Gemini", "Groq", "WebLLM",
]);
{
  const enDict = flatten(
    JSON.parse(readFileSync(join(LOCALES_DIR, "en.json"), "utf8")),
  );
  const brandIssues = [];
  for (const [key, value] of Object.entries(enDict)) {
    if (typeof value !== "string" || !value.trim()) continue;
    for (const canon of EN_BRAND_CANONICAL) {
      // Starts-uppercase word-boundary token ("Api"), NOT the canonical
      // form, matching the brand case-insensitively.
      const re = new RegExp("(^|[^A-Za-z0-9])([A-Z][A-Za-z]*)($|[^A-Za-z0-9])", "g");
      let m;
      while ((m = re.exec(value))) {
        const tok = m[2];
        if (tok !== canon && tok.toLowerCase() === canon.toLowerCase()) {
          brandIssues.push(
            `brand casing "${tok}" → "${canon}": ${key} ("${value}")`,
          );
          break;
        }
      }
    }
  }
  if (brandIssues.length > 0) {
    console.error(
      `[check-i18n-quality] FAIL en: ${brandIssues.length} brand-casing issue(s) — ` +
        brandIssues.slice(0, 3).join("; ") +
        (brandIssues.length > 3 ? "; …" : ""),
    );
    failures += 1;
  } else {
    console.log("[check-i18n-quality] ok en: brand-casing scan clean");
  }
}

// Dot-key parity detector: keys in en.json that use the dot-separated
// convention (e.g. "app.invalidPassword") were added as a newer i18n key
// format alongside the legacy underscore convention. If a dot-key exists in
// en.json but is absent from a locale, the UI renders the raw key string or
// English fallback — often on security-critical or onboarding screens.
// This is NOT baseline-able: a missing dot-key is always a defect.
{
  const enDict = flatten(
    JSON.parse(readFileSync(join(LOCALES_DIR, "en.json"), "utf8")),
  );
  const dotKeys = Object.keys(enDict).filter((k) => k.includes("."));
  
  if (dotKeys.length > 0) {
    let dotFailures = 0;
    for (const file of files) {
      if (file === "en.json") continue;
      const locale = file.replace(/\.json$/, "");
      const locDict = flatten(JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8")));
      const missing = dotKeys.filter((k) => locDict[k] === undefined);
      if (missing.length > 0) {
        console.error(
          `[check-i18n-quality] FAIL ${locale}: ${missing.length} missing dot-key(s) — ` +
            missing.slice(0, 4).join(", ") +
            (missing.length > 4 ? "; …" : ""),
        );
        failures += 1;
        dotFailures += 1;
      }
    }
    if (dotFailures === 0) {
      console.log(
        `[check-i18n-quality] ok all ${files.length - 1} locales: ${dotKeys.length} dot-keys present`,
      );
    }
  }
}

if (process.argv.includes("--fix")) {
  const next = {
    locales: Object.fromEntries(
      Object.entries(results).map(([locale, issues]) => [locale, { issues: issues.length }]),
    ),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
  console.log(`[check-i18n-quality] baseline updated: ${Object.keys(results).length} locales`);
}

if (failures > 0) {
  console.error(`[check-i18n-quality] ${failures} failure(s)`);
  process.exit(1);
}
