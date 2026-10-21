#!/usr/bin/env node
/**
 * scripts/check-landing-i18n.mjs — the LANGUAGE truthfulness gate for the
 * landing and help translations.
 *
 * Why this gate exists
 * --------------------
 * The freshness gate (check:landings-fresh) proves a committed page is
 * byte-identical to a fresh render of its JSON source. It says nothing about
 * the LANGUAGE of that source. scripts/generate-missing-translations.mjs
 * seeded 23 locale files as copies of the English file — it even said so in
 * its own comment ("The content remains in English and should be
 * professionally translated later") — and from that day every gate stayed
 * green while /cs/ served `<html lang="cs">` with an English body.
 *
 * A gate that cannot see the difference between "translated" and "copied" is
 * a gate that cannot protect the promise the page makes to its visitor (and
 * to the search engine that indexes the hreflang cluster).
 *
 * What it checks
 * --------------
 *   1. STRUCTURE — every leaf path of scripts/translations/en.json exists in
 *      the locale file with the same type. A dropped key is a hole in the
 *      rendered page, not a translation detail.
 *   2. PLACEHOLDERS — the {{...}} placeholders of the English source survive
 *      verbatim in the translation.
 *   3. LANGUAGE — a leaf that is still byte-identical to the English source
 *      must be EXEMPT: brand names, protocol names, technical identifiers,
 *      URLs, e-mail addresses, prices and pure numbers. Anything else is
 *      untranslated prose and counts against the locale's ratchet baseline.
 *
 * The baseline (scripts/landing-i18n-baseline.json) records how many
 * untranslated leaves each locale may still carry. Translating a locale
 * lowers its number; the baseline is only re-pinned deliberately, the same
 * contract the Spanish-line ratchet and the test-timing baseline use. A
 * locale that is missing from the baseline is a failure: adding a language
 * is a reviewable act, not a silent copy of English.
 *
 * Exit 0 when every locale is within its baseline, 1 otherwise.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDING_CODES } from "./landing-registry.mjs";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(THIS_DIR, "..");
const BASELINE_PATH = join(ROOT, "scripts", "landing-i18n-baseline.json");

/**
 * Locale-independent metadata: the value is a code, a path or a locale tag,
 * never prose. Comparing it with the English source would be meaningless.
 */
export const METADATA_PATHS = new Set([
  "lang",
  "dir",
  "langName",
  "canonical",
  "ogLocale",
  "ogLocaleAlternate",
  "ogImage",
  "twitterImage",
  "homeHref",
  "help.ogLocale",
  "langLink.hreflang",
  "langLink.lang",
  "langLink.text",
  "structuredData.organizationName",
  "structuredData.softwareName",
  "structuredData.websiteName",
  "structuredData.organizationUrl",
  "structuredData.softwareUrl",
  "structuredData.websiteUrl",
  "structuredData.organizationEmail",
  "structuredData.softwareCategory",
  "structuredData.applicationCategory",
]);

/**
 * Path shapes whose value is an identifier, a link or an enum member. The
 * landing template uses them as DOM ids, hrefs, CSS classes, JSON-LD types
 * or currency codes: translating them would break the page, not localise it.
 */
export const IDENTIFIER_PATH_PATTERNS = [
  /\.id$/,
  /\.(href|hrefs|url|urls)$/,
  /\.hrefs\.\d+$/,
  /\.links\.\d+$/,
  /\.(ctaHref|ctaPrimaryHref|ctaSecondaryHref)$/,
  /\.cta(Class|Href)$/,
  /\.cta2(Class|Href)$/,
  /\.type$/,
  /\.currency$/,
  /^footer\.languages\.links\./, // the native name of each language
  /\.example$/, // a literal sample (diagnostic output) shown verbatim
];

/**
 * Enum values that read the same in every language. Kept explicit rather
 * than guessed: a wrong guess silently accepts untranslated prose.
 */
export const ENUM_VALUES = new Set([
  "local",
  "cloud",
  "USD",
  "EUR",
  "Web",
  "Windows",
  "macOS",
  "Linux",
  "Android",
  "iOS",
  "AI",
]);

/**
 * Leaf paths whose CANONICAL translation is a genuine loanword — the English
 * word IS the word in the target language, in the register the page uses.
 *
 * These are not "we forgot to translate": Dutch writes "Privacy", "Product",
 * "Contact" and "Code" natively (the words entered Dutch unchanged and never
 * left); Swedish writes "Support"; German writes "Code" for a table column
 * header. Every other locale that reached these paths translated them, and
 * the exemption only fires when a locale left the value byte-identical to
 * English — a locale that translated the leaf is untouched by it.
 *
 * Kept as an explicit allowlist (like ENUM_VALUES) rather than guessed from
 * the string: guessing "any 6-letter word is a loanword" is how a gate starts
 * accepting real prose.
 */
export const LOANWORD_PATHS = new Set([
  "navLinks.privacy",
  "footer.product.title",
  "footer.support.title",
  "help.toc.contact",
  "help.errorCodes.table.code",
  "help.contact.title",
  "help.privacy",
  "help.pricing.table.tier",
  "help.sla.table.tier",
  "help.home",
  "hero.pillars.2.strong",
]);

/** A duration in hours — "48h" reads the same in every language. */
const DURATION_RE = /^\d+\s*h$/i;

/**
 * Tokens that must stay verbatim in every language: the product name, the
 * crypto vocabulary, the provider names and the acronyms. Translating
 * "Argon2id" or "WebLLM" would be worse than leaving it in English.
 */
export const PROTECTED_TOKENS = [
  "BookmarkForge",
  "AES-256-GCM",
  "AES-GCM-256",
  "Argon2id",
  "Whop",
  "WebLLM",
  "Ollama",
  "WebRTC",
  "IndexedDB",
  "Service Worker",
  "ServiceWorker",
  "Google Fonts",
  "Sentry",
  "Gemini",
  "OpenAI",
  "Anthropic",
  "Groq",
  "OpenRouter",
  "Hugging Face",
  "Raindrop",
  "Pocket",
  "Notion",
  "Obsidian",
  "WebDAV",
  "Nextcloud",
  "OneDrive",
  "Dropbox",
  "pCloud",
  "GitHub",
  "Netlify",
  "Cloudflare",
  "Proton",
  "GDPR",
  "RGPD",
  "CCPA",
  "WebP",
  "PWA",
  "P2P",
  "RAG",
  "OCR",
  "JSON",
  "Markdown",
  "HTML",
  "CSV",
  "PDF",
  "URL",
  "API",
  "KDF",
  "HMAC",
  "TLS",
  "CSP",
  "BF-E",
  "Pro",
  "Free",
  "Early Bird",
  "Lifetime",
  "v1",
];

/** Placeholder tokens ({{name}}) that must survive a translation verbatim. */
const PLACEHOLDER_RE = /\{\{[^}]*\}\}/g;

/**
 * Flatten a translation object into leaf paths. Arrays keep their index so
 * "pricing.plans.0.name" is addressable; a leaf is a string, number or
 * boolean.
 */
export function flattenLeaves(value, prefix = "", out = {}) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      flattenLeaves(item, prefix ? `${prefix}.${index}` : String(index), out),
    );
    return out;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenLeaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out[prefix] = value;
  return out;
}

/** The type label used to compare a locale leaf with its English source. */
export function leafType(value) {
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * True when an identical string is legitimately language-independent:
 * after removing the protected tokens, URLs, e-mail addresses, digits and
 * punctuation nothing readable is left ("$59", "100%", "AES-256-GCM").
 */
export function isExemptString(value) {
  if (typeof value !== "string") return true; // numbers and booleans carry no prose
  if (DURATION_RE.test(value.trim())) return true;
  let rest = value;
  for (const token of PROTECTED_TOKENS) {
    rest = rest.split(token).join(" ");
  }
  rest = rest.replace(/https?:\/\/[^\s"'<>]+/g, " ");
  rest = rest.replace(/[\w.+-]+@[\w.-]+\.\w+/g, " ");
  rest = rest.replace(/[0-9\s\p{P}\p{S}]/gu, "");
  return rest.length === 0;
}

/**
 * True when the path itself marks the value as language-independent (a DOM
 * id, a link, an enum member, a currency code, a native language name).
 */
export function isIdentifierPath(path) {
  return IDENTIFIER_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/** The placeholders used by a string, sorted for comparison. */
export function placeholdersOf(value) {
  if (typeof value !== "string") return [];
  return [...value.matchAll(PLACEHOLDER_RE)].map((m) => m[0]).sort();
}

/**
 * Analyse one locale against the English source.
 *
 * @param {object} english   the English source object
 * @param {object} locale    the locale object
 * @param {{ sourceLocale?: boolean }} [options] the source locale is compared
 *        for STRUCTURE only — it is identical to the English by definition.
 * @returns {{ missing: string[], extra: string[], typeMismatch: string[],
 *            placeholderMismatch: string[], untranslated: string[] }}
 */
export function analyzeLocale(english, locale, { sourceLocale = false } = {}) {
  const enLeaves = flattenLeaves(english);
  const locLeaves = flattenLeaves(locale);
  const missing = [];
  const typeMismatch = [];
  const placeholderMismatch = [];
  const untranslated = [];

  for (const [path, enValue] of Object.entries(enLeaves)) {
    if (!(path in locLeaves)) {
      missing.push(path);
      continue;
    }
    const locValue = locLeaves[path];
    if (leafType(locValue) !== leafType(enValue)) {
      typeMismatch.push(path);
      continue;
    }
    const enPlaceholders = placeholdersOf(enValue).join("|");
    const locPlaceholders = placeholdersOf(locValue).join("|");
    if (enPlaceholders !== locPlaceholders) {
      placeholderMismatch.push(path);
    }
    if (
      !sourceLocale &&
      typeof enValue === "string" &&
      locValue === enValue &&
      !METADATA_PATHS.has(path) &&
      !isIdentifierPath(path) &&
      !ENUM_VALUES.has(enValue) &&
      !LOANWORD_PATHS.has(path) &&
      !isExemptString(enValue)
    ) {
      untranslated.push(path);
    }
  }

  const extra = Object.keys(locLeaves).filter(
    (path) => !(path in enLeaves) && !METADATA_PATHS.has(path),
  );

  return { missing, extra, typeMismatch, placeholderMismatch, untranslated };
}

/** Read the ratchet baseline. */
export function loadBaseline(file = BASELINE_PATH) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * The paths of the EMPTY objects/arrays a locale carries.
 *
 * An empty entry is invisible to the leaf comparison: it has no leaves, so it
 * is neither a missing key nor an extra one. The renderer, however, iterates
 * the array and outputs the absent field — the page fails to render with
 * "attempted to output null or undefined value" while every structural
 * check is green. A locale that drops a feature's `text` must drop the
 * whole feature, never leave a husk behind.
 *
 * @param {unknown} value
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function findEmptyEntries(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      item && typeof item === "object" && Object.keys(item).length === 0
        ? [prefix ? `${prefix}.${index}` : String(index)]
        : findEmptyEntries(item, prefix ? `${prefix}.${index}` : String(index)),
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      child && typeof child === "object" && !Array.isArray(child) && Object.keys(child).length === 0
        ? [prefix ? `${prefix}.${key}` : key]
        : findEmptyEntries(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

/**
 * Run every check.
 *
 * @param {{ root?: string, translationsDir?: string, baseline?: object }} options
 * @returns {{ checked: number, failures: { locale: string, kind: string, detail: string }[] }}
 */
export function runLandingI18nChecks({
  root = ROOT,
  translationsDir = join(root, "scripts", "translations"),
  baseline = loadBaseline(),
} = {}) {
  const failures = [];
  const english = JSON.parse(
    readFileSync(join(translationsDir, "en.json"), "utf8"),
  );

  if (!baseline || typeof baseline.locales !== "object") {
    return {
      checked: 0,
      failures: [
        {
          locale: "—",
          kind: "baseline-missing",
          detail:
            "scripts/landing-i18n-baseline.json is missing or malformed — the ratchet needs a per-locale budget of untranslated leaves",
        },
      ],
    };
  }

  let checked = 0;
  for (const code of LANDING_CODES) {
    const file = join(translationsDir, `${code}.json`);
    if (!existsSync(file)) {
      failures.push({
        locale: code,
        kind: "file-missing",
        detail: `scripts/translations/${code}.json does not exist`,
      });
      continue;
    }
    checked += 1;
    let locale;
    try {
      locale = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      failures.push({
        locale: code,
        kind: "invalid-json",
        detail: `scripts/translations/${code}.json is not valid JSON: ${error.message}`,
      });
      continue;
    }

    const result = analyzeLocale(english, locale, { sourceLocale: code === "en" });
    if (result.missing.length) {
      failures.push({
        locale: code,
        kind: "structure-missing",
        detail: `${result.missing.length} key(s) missing from the English source: ${result.missing.slice(0, 5).join(", ")}`,
      });
    }
    if (result.extra.length) {
      failures.push({
        locale: code,
        kind: "structure-extra",
        detail: `${result.extra.length} key(s) not present in the English source: ${result.extra.slice(0, 5).join(", ")}`,
      });
    }
    if (result.typeMismatch.length) {
      failures.push({
        locale: code,
        kind: "type-mismatch",
        detail: `${result.typeMismatch.length} key(s) changed type: ${result.typeMismatch.slice(0, 5).join(", ")}`,
      });
    }
    if (result.placeholderMismatch.length) {
      failures.push({
        locale: code,
        kind: "placeholder-mismatch",
        detail: `${result.placeholderMismatch.length} key(s) lost a {{placeholder}}: ${result.placeholderMismatch.slice(0, 5).join(", ")}`,
      });
    }

    const empty = findEmptyEntries(locale);
    if (empty.length) {
      failures.push({
        locale: code,
        kind: "empty-entry",
        detail: `${empty.length} empty object(s)/array(s) would break the render: ${empty.slice(0, 5).join(", ")}`,
      });
    }

    const budget = baseline.locales[code];
    if (budget === undefined) {
      failures.push({
        locale: code,
        kind: "baseline-absent",
        detail:
          "the locale has no entry in scripts/landing-i18n-baseline.json — adding a language is a reviewable act, not a silent copy of English",
      });
      continue;
    }
    if (result.untranslated.length > budget) {
      failures.push({
        locale: code,
        kind: "untranslated",
        detail: `${result.untranslated.length} untranslated leaf/leaves exceed the baseline of ${budget} (worst: ${result.untranslated.slice(0, 3).join(", ")})`,
      });
    }
  }

  return { checked, failures };
}

function main() {
  let result;
  try {
    result = runLandingI18nChecks();
  } catch (error) {
    console.error(`[check:landing-i18n] FAIL: ${error.message}`);
    process.exit(2);
  }
  if (result.failures.length) {
    console.error(
      `[check:landing-i18n] FAIL: ${result.failures.length} translation violation(s):`,
    );
    for (const failure of result.failures) {
      console.error(`  - [${failure.locale}] ${failure.kind}: ${failure.detail}`);
    }
    process.exit(1);
  }
  console.log(
    `[check:landing-i18n] ok: ${result.checked} landing locale(s) within their untranslated-leaf budget`,
  );
}

const invokedDirectly =
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("check-landing-i18n.mjs");
if (invokedDirectly) {
  main();
}
