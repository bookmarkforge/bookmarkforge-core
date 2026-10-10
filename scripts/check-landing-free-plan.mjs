#!/usr/bin/env node
/**
 * scripts/check-landing-free-plan.mjs — Free-plan integrity gate for the 30
 * locale landing pages.
 *
 * Motivation: the Free tier's positioning lives in two facts that regressed
 * once and are cheap to regress again:
 *
 *   1. NO device-count claim. The any-device policy (Free installs anywhere,
 *      each device keeps its own vault) means "1 device"/"1 dispositivo"/
 *      «1台设备»/«١ جهاز» copy is FALSE — a paid-tier number on the Free
 *      plan. The historical regression shipped in ~24 locales at once,
 *      hiding in CJK/RTL word-forms the generic numeric gate cannot see.
 *   2. The smart-search wedge LEADS the Free card. "Smart search — included
 *      free; Raindrop charges yearly for this" is slot 0 on the six primary
 *      locales (en, es, fr, de, pt, it) and slot 1 on the 24 secondary ones
 *      (which put the bookmark cap first). Dropping or demoting it silently
 *      kills the Pocket-migration pitch.
 *
 * Scanned surface (all Free-plan carriers, 30 locales × 3 layers):
 *   - Rendered pages: every public/*.html that contains a Free price-card
 *     (landing + 29 locale landings; pages without a Free card — help,
 *     legal, 404, offline — are out of scope here; the numeric claim-drift
 *     gate covers those for Latin-script numbers).
 *   - Primary source:  scripts/translations/{en,es,fr,de,pt,it}.json —
 *     pricing.plans[0] (the Free plan object).
 *   - Secondary source: scripts/landing-translations.json — priceFreeDesc +
 *     priceFreeItems[] for its 24 locales.
 *
 * Rules:
 *   A. device-count ban — any "number + device-noun" word-form FAILS on the
 *      Free card. Numbers are normalized first (Arabic-Indic digits ٠-٩/۰-۹
 *      → ASCII; per-locale thousand separators collapsed), so the 1,000 cap
 *      can never read as a device count and «١ جهاز» IS caught. Word-forms
 *      are explicit per script — extending a locale means adding its noun
 *      to DEVICE_NOUNS, not weakening the rule.
 *   B. wedge presence — the Free card must contain a line with (i) the
 *      locale's search keyword, (ii) its smart-search qualifier, and (iii)
 *      "Raindrop" (a brand; Latin in all 30 locales — verified against the
 *      live files). The per-locale keywords come from the WEDGE_TABLE below,
 *      built from the actual live wedge lines; adding a locale means adding
 *      its row, never loosening the rule.
 *   C. wedge position — slot 0 on primary-locale cards, slot 1 on
 *      secondary-locale cards.
 *
 * Exit codes: 0 = all Free cards clean, 1 = violations (a Free-card-carrying
 * page whose card cannot be parsed also fails), 2 = usage/IO error.
 *
 * Usage:
 *   node scripts/check-landing-free-plan.mjs           # gate mode
 *   node scripts/check-landing-free-plan.mjs --root <dir>
 *   node scripts/check-landing-free-plan.mjs --json
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import {
  LANDING_CODES,
  PRIMARY_LOCALE_CODES,
} from "./landing-registry.mjs";

const DEFAULT_ROOT = process.cwd();

// ── CLI ──────────────────────────────────────────────────────────────────────
/**
 * Parsed from inside the main-module guard, not at import time: this module is
 * imported by its test file and by scripts/patch-free-plan-copy.mjs, and
 * scanning argv while being imported makes the IMPORTER's own flags fatal
 * ("unknown flag --check" — the migration script died on exactly this).
 */
function parseCliArgs(argv) {
  let root = DEFAULT_ROOT;
  let jsonOutput = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      root = argv[++i];
    } else if (argv[i] === "--json") {
      jsonOutput = true;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        "Usage: node scripts/check-landing-free-plan.mjs [--root <dir>] [--json]",
      );
      process.exit(0);
    } else if (argv[i].startsWith("-")) {
      console.error(`check-landing-free-plan: unknown flag ${argv[i]}`);
      process.exit(2);
    }
  }
  return { root, jsonOutput };
}

const IS_MAIN = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href,
);

// ── Number normalization (rule A helper) ─────────────────────────────────────
const AR_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
const AR_DIGIT_MAP = {
  "\u0660": "0", "\u0661": "1", "\u0662": "2", "\u0663": "3", "\u0664": "4",
  "\u0665": "5", "\u0666": "6", "\u0667": "7", "\u0668": "8", "\u0669": "9",
  "\u06F0": "0", "\u06F1": "1", "\u06F2": "2", "\u06F3": "3", "\u06F4": "4",
  "\u06F5": "5", "\u06F6": "6", "\u06F7": "7", "\u06F8": "8", "\u06F9": "9",
};

/**
 * "1,000" / "1.000" / "1 000" / "١٠٠٠" → "1000"; «١ جهاز» → "1 جهاز".
 * Applied before rule A matches so the bookmark cap never reads as a device
 * count and Arabic-Indic digit claims are still caught.
 */
export function normalizeCapNumbers(s) {
  let out = s.replace(AR_DIGITS, (d) => AR_DIGIT_MAP[d]);
  out = out.replace(/(\d)[.,\u00A0\u066C\u2009](\d{3})(?!\d)/g, "$1$2");
  // Plain-space thousand groups (ru/cs/pl/fi copy) — collapse repeatedly so
  // "1 000 000" ends fully collapsed. Only exactly-3-digit groups bind, so
  // "3 devices" and "v1.5" are untouched.
  let prev;
  do {
    prev = out;
    out = out.replace(/(\d) (\d{3})(?!\d)/g, "$1$2");
  } while (out !== prev);
  out = out.replace(/(\d)[\u00A0\u066C\u2009](\d{3})(?!\d)/g, "$1$2");
  return out;
}

/**
 * Device-count word-forms by script. Latin/Cyrillic forms are
 * suffix-tolerant stems; CJK/Hebrew/Arabic/Devanagari/Thai forms are full
 * words (no Latin-style inflection to absorb). Historical regression hid
 * here — extend per locale, never weaken.
 */
const DEVICE_NOUNS = [
  // Germanic / Romance / Slavic stems
  "devices?", "ger[aä]t(?:e|en|s)?", "dispositiv[\\p{L}\\p{M}]*", "dispositivos?",
  "dispositius?", "appareils?", "zař[íi]zen[íi]?[\\p{L}\\p{M}]*", "eszköz[\\p{L}\\p{M}]*", "urządzen[\\p{L}\\p{M}]*",
  "пристр[іо]й?[\\p{L}\\p{M}]*", "устройств[\\p{L}\\p{M}]*", "уред[\\p{L}\\p{M}]*", "uređaj[\\p{L}\\p{M}]*",
  // Greek / Nordic / Baltic-ish
  "συσκευ[ήη][\\p{L}\\p{M}]*", "enhet(?:er|ene)?", "laite[\\p{L}\\p{M}]*",
  // Southeast Asian
  "thiết bị", "perangkat", "อุปกรณ์", "cihaz[\\p{L}\\p{M}]*",
  // Hebrew: מכשיר / מכשירים
  "\u05DE\u05DB\u05E9\u05D9\u05E8(?:\u05D9\u05DD)?",
  // Arabic: جهاز / أجهزة / الأجهزة (+ prefixes/suffixes)
  "(?:\u0627\u0644)?(?:\u062C\u0647\u0627\u0632|\u0623\u062C\u0647\u0632)[\\p{L}\\p{M}]*",
  // Devanagari
  "डिवाइस", "उपकरण",
  // CJK — full nouns, no inflection
  "设备", "裝置", "装置", "デバイス", "機器", "기기", "디바이스",
];

const WORD_ONE =
  "one|uno|una|une|un\b|ein[ea]m?|um|uma|jeden|jedno|jedna|egy|"
  + "один|одна|одне|одно|ένα|μία|μια|"
  + "\u0648\u0627\u062D\u062F(?:\u0629)?|"            // واحد / واحدة
  + "\u05D0\u05D7\u05D3|\u05D0\u05D7\u05EA|"        // אחד / אחת
  + "\u090F\u0915|"                                  // एक
  + "\u0E2B\u0E19\u0E36\u0E48\u0E07|"              // หนึ่ง
  + "mot|bir|satu|só";

/** CJK classifiers that may sit between a numeral and the device noun. */
const CJK_CLASSIFIER = "[\u53F0\u500B\u4E2A\u96BB]|\u3064\u306E|\uAC1C(?:\uC758)?|\uB300";

const NOUN_ALT = DEVICE_NOUNS.join("|");

const DEVICE_CLAIM_PATTERNS = [
  // P1 — number BEFORE the noun (SVO locales), optional CJK classifier
  // between: "1 device", "1台设备", "1つのデバイス", "1 기기".
  String.raw`(\d+(?:[.,]\d+)*)[\s\u00A0]*(?:${CJK_CLASSIFIER})?[\s\u00A0]*(?:${NOUN_ALT})`,
  // P2 — number or word-one AFTER the noun (RTL/Hebrew order): «مكشير 1»,
  // "מכשיר אחד", «جهاز واحد».
  String.raw`(?:${NOUN_ALT})[\s\u00A0]*(\d+(?:[.,]\d+)*|${WORD_ONE})`,
  // P3 — spelled word-one BEFORE the noun: "one device", "un dispositivo",
  // "一台设备" (CJK word-one + classifier).
  String.raw`(?:${WORD_ONE})[\s\u00A0]*(?:${CJK_CLASSIFIER})?[\s\u00A0]*(?:${NOUN_ALT})`,
];

const DEVICE_CLAIM_RES = DEVICE_CLAIM_PATTERNS.map(
  (p) => new RegExp(p, "iu"),
);

/**
 * Rule A on a line: return the offending device-claim phrase, or null.
 * Runs all three numeral orders (number→noun, noun→number, word-one→noun)
 * so RTL and CJK shapes are caught. The 1,000 bookmark cap never trips
 * this: its number binds to a bookmark noun, not a device noun.
 */
export function findDeviceCountClaim(s) {
  const line = normalizeCapNumbers(s);
  for (const re of DEVICE_CLAIM_RES) {
    const m = line.match(re);
    if (m) return m[0];
  }
  return null;
}

// ── Wedge table (rule B) ─────────────────────────────────────────────────────
/**
 * Per-locale wedge keywords, extracted from the live wedge lines (all 30
 * verified against the rendered pages and both translation sources). A line
 * is the wedge iff it contains the locale's search keyword AND smart
 * qualifier AND "Raindrop" (brand, Latin everywhere). Locale key = rendered
 * file stem = translation-source key.
 */
export const WEDGE_TABLE = {
  en: { search: "search", smart: "smart" },
  es: { search: "b\u00FAsqueda", smart: "inteligente" },
  fr: { search: "recherche", smart: "intelligente" },
  de: { search: "suche", smart: "intelligente" },
  pt: { search: "pesquisa", smart: "inteligente" },
  it: { search: "ricerca", smart: "intelligente" },
  ar: { search: "\u0628\u062D\u062B", smart: "\u0630\u0643\u064A" },
  bg: { search: "\u0442\u044A\u0440\u0441\u0435\u043D\u0435", smart: "\u0438\u043D\u0442\u0435\u043B\u0438\u0433\u0435\u043D\u0442\u043D" },
  cs: { search: "vyhled\u00E1v\u00E1n\u00ED", smart: "chytr\u00E9" },
  da: { search: "s\u00F8gning", smart: "smart" },
  el: { search: "\u03B1\u03BD\u03B1\u03B6\u03AE\u03C4\u03B7\u03C3\u03B7", smart: "\u03AD\u03BE\u03C5\u03C0\u03BD\u03B7" },
  fi: { search: "haku", smart: "älykäs" },
  he: { search: "\u05D7\u05D9\u05E4\u05D5\u05E9", smart: "\u05D7\u05DB\u05DD" },
  hi: { search: "\u0916\u094B\u091C", smart: "\u0938\u094D\u092E\u093E\u0930\u094D\u091F" },
  hr: { search: "pretra\u017Eivanje", smart: "pametno" },
  hu: { search: "keres\u00E9s", smart: "okos" },
  id: { search: "pencarian", smart: "pintar" },
  ja: { search: "\u691C\u7D22", smart: "\u30B9\u30DE\u30FC\u30C8" },
  ko: { search: "\uAC80\uC0C9", smart: "\uC2A4\uB9C8\uD2B8" },
  nl: { search: "zoeken", smart: "slim" },
  no: { search: "s\u00F8k", smart: "smart" },
  pl: { search: "wyszukiwanie", smart: "inteligentne" },
  ro: { search: "c\u0103utare", smart: "inteligent\u0103" },
  ru: { search: "\u043F\u043E\u0438\u0441\u043A", smart: "\u0423\u043C\u043D\u044B\u0439" },
  sv: { search: "s\u00F6kning", smart: "smart" },
  th: { search: "\u0E04\u0E49\u0E19\u0E2B\u0E32", smart: "\u0E2D\u0E31\u0E08\u0E09\u0E23\u0E34\u0E22\u0E30" },
  tr: { search: "arama", smart: "ak\u0131ll\u0131" },
  uk: { search: "\u043F\u043E\u0448\u0443\u043A", smart: "\u0420\u043E\u0437\u0443\u043C\u043D\u0438\u0439" },
  vi: { search: "t\u00ECm ki\u1EBFm", smart: "th\u00F4ng minh" },
  zh: { search: "\u641C\u7D22", smart: "\u667A\u80FD" },
};

export function isWedgeLine(s, lang) {
  const w = WEDGE_TABLE[lang] ?? WEDGE_TABLE.en;
  const l = s.toLowerCase();
  return (
    l.includes(w.search.toLowerCase()) &&
    l.includes(w.smart.toLowerCase()) &&
    l.includes("raindrop")
  );
}

// ── Free-card extraction ─────────────────────────────────────────────────────
/**
 * The Free card is the FIRST `class="price-card "` block (generator emits
 * Free → Pro → Founder). Locale pages localize the section id (id="preise",
 * id="precios", …), so extraction keys on the card, not the section.
 * Returns null when the page carries no Free card.
 */
export function extractFreeCard(html) {
  const cardStart = html.indexOf('<div class="price-card ');
  if (cardStart < 0) return null;
  const nextCard = html.indexOf('<div class="price-card ', cardStart + 10);
  const end = nextCard > 0 ? nextCard : cardStart + 8000;
  return html.slice(cardStart, end);
}

/** Strip ✅/❌ markers and HTML from a feature line. */
function stripMarkers(s) {
  return s
    .replace(/<span[^>]*>[^<]*<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[✅❌]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** All <li> texts of a card, in order. */
export function cardFeatureLines(card) {
  const out = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(card)) !== null) {
    out.push(stripMarkers(m[1]));
  }
  return out;
}

/** The card's description paragraph. */
export function cardDescription(card) {
  const m = card.match(/<p>([\s\S]*?)<\/p>/);
  return m ? stripMarkers(m[1]) : "";
}

// ── Checks ───────────────────────────────────────────────────────────────────
/**
 * Shared Free-card verdict. `features`/`description` are plain-text lines.
 * Returns an array of { where, rule, detail } (empty = clean).
 */
export function checkFreeCardContent({ description, features }, lang, expectedWedgeSlot) {
  const problems = [];
  const where0 = "description";
  for (const [i, text] of [description, ...features].entries()) {
    const claim = findDeviceCountClaim(text);
    if (claim) {
      problems.push({
        where: i === 0 ? where0 : `feature#${i - 1}`,
        rule: "device-count",
        detail: `"${claim}" — Free plan must not claim a device count (any-device policy)`,
      });
    }
  }
  const wedgeIdx = features.findIndex((f) => isWedgeLine(f, lang));
  if (wedgeIdx < 0) {
    problems.push({
      where: "features",
      rule: "wedge-missing",
      detail: `no smart-search line mentioning Raindrop found (looked for ${lang}: search="${WEDGE_TABLE[lang]?.search ?? "?"}", smart="${WEDGE_TABLE[lang]?.smart ?? "?"}")`,
    });
  } else if (wedgeIdx !== expectedWedgeSlot) {
    problems.push({
      where: "features",
      rule: "wedge-position",
      detail: `wedge at slot ${wedgeIdx}, expected ${expectedWedgeSlot}`,
    });
  }
  return problems;
}

export function checkPrimarySource(lang, t) {
  const plan = t?.pricing?.plans?.[0];
  if (!plan) {
    return [{ where: "pricing.plans[0]", rule: "source-missing", detail: "no Free plan object" }];
  }
  return checkFreeCardContent(
    {
      description: String(plan.description ?? ""),
      features: (plan.features ?? []).map((f) => String(f?.text ?? "")),
    },
    lang,
    0,
  );
}

export function checkSecondarySource(lang, t) {
  const items = Array.isArray(t?.priceFreeItems) ? t.priceFreeItems.map(String) : [];
  if (!items.length) {
    return [{ where: lang, rule: "source-missing", detail: "priceFreeItems missing or empty" }];
  }
  return checkFreeCardContent(
    { description: String(t?.priceFreeDesc ?? ""), features: items },
    lang,
    1,
  );
}

export function checkLandingHtml(html, lang, expectedWedgeSlot) {
  const card = extractFreeCard(html);
  if (!card) {
    return [{ where: "pricing", rule: "pricing-missing", detail: "no Free price-card found" }];
  }
  return checkFreeCardContent(
    { description: cardDescription(card), features: cardFeatureLines(card) },
    lang,
    expectedWedgeSlot,
  );
}

// ── Gate mode ────────────────────────────────────────────────────────────────
/**
 * The six launch locales — owned by scripts/landing-registry.mjs, never a
 * second copy here. They decide the Free-card wedge slot (primary → slot 0)
 * and which locales are validated from their full translation sources.
 */
const PRIMARY_LANGS = PRIMARY_LOCALE_CODES;

/**
 * The primary/secondary split has to stay honest against its OWN artifacts:
 * the primaries are read from scripts/translations/<code>.json, and every
 * other landing locale must carry an entry in scripts/landing-translations
 * .json. Without this pin, adding a locale to the registry would silently drop
 * it from this gate (no violation either way) instead of failing it.
 *
 * @returns violations in the gate's shape ({ file, where, rule, detail }).
 */
export function validateSecondaryCoverage({
  landingTranslations,
  langs = LANDING_CODES,
  primaryLangs = PRIMARY_LANGS,
}) {
  const violations = [];
  const present = new Set(Object.keys(landingTranslations ?? {}));
  const expected = new Set(langs.filter((lang) => !primaryLangs.includes(lang)));
  const file = "scripts/landing-translations.json";

  for (const lang of expected) {
    if (!present.has(lang)) {
      violations.push({
        file,
        where: `locale ${lang}`,
        rule: "secondary-coverage",
        detail:
          `no translation entry for "${lang}" — every landing locale outside ` +
          `the ${primaryLangs.length} primaries (${primaryLangs.join(", ")}) ` +
          "needs one, or this gate never reads its copy",
      });
    }
  }
  for (const lang of present) {
    if (!expected.has(lang)) {
      violations.push({
        file,
        where: `locale ${lang}`,
        rule: "secondary-coverage",
        detail: primaryLangs.includes(lang)
          ? `"${lang}" is a primary locale — it is validated from ` +
            `scripts/translations/${lang}.json, not from this file`
          : `"${lang}" is not a landing locale (registry has ` +
            `${langs.length})`,
      });
    }
  }
  return violations;
}
/** File stem → locale for the rendered pages (landing.html is en). */
function localeOfFileStem(stem) {
  return stem === "landing" ? "en" : stem;
}

if (IS_MAIN) {
  const { root: ROOT, jsonOutput: JSON_OUTPUT } = parseCliArgs(process.argv);
  const violations = [];

  // 1. Rendered pages.
  const publicDir = join(ROOT, "public");
  let htmlFiles = [];
  try {
    htmlFiles = readdirSync(publicDir).filter((f) => f.endsWith(".html"));
  } catch (e) {
    console.error(`check-landing-free-plan: ${e.message}`);
    process.exit(2);
  }
  for (const f of htmlFiles) {
    const lang = localeOfFileStem(f.replace(".html", ""));
    let html;
    try {
      html = readFileSync(join(publicDir, f), "utf8");
    } catch (e) {
      violations.push({ file: f, ...{ where: "file", rule: "io", detail: e.message } });
      continue;
    }
    // Pages without a Free card (help, legal, 404, offline) are not landing
    // surfaces — skip rather than fail; claim-drift covers them numerically.
    if (!html.includes('<div class="price-card ')) continue;
    const expectedSlot = PRIMARY_LANGS.includes(lang) ? 0 : 1;
    for (const p of checkLandingHtml(html, lang, expectedSlot)) {
      violations.push({ file: `public/${f}`, ...p });
    }
  }

  // 2. Primary sources.
  for (const lang of PRIMARY_LANGS) {
    try {
      const t = JSON.parse(readFileSync(join(ROOT, "scripts", "translations", `${lang}.json`), "utf8"));
      for (const p of checkPrimarySource(lang, t)) {
        violations.push({ file: `scripts/translations/${lang}.json`, ...p });
      }
    } catch (e) {
      violations.push({ file: `scripts/translations/${lang}.json`, where: "file", rule: "io", detail: e.message });
    }
  }

  // 3. Secondary sources.
  try {
    const T = JSON.parse(readFileSync(join(ROOT, "scripts", "landing-translations.json"), "utf8"));
    for (const [lang, t] of Object.entries(T)) {
      for (const p of checkSecondarySource(lang, t)) {
        violations.push({ file: "scripts/landing-translations.json", ...p });
      }
    }
    // The split itself: the 24 secondary locales are the registry minus the
    // six primaries — a new locale cannot slip past this gate unnoticed.
    violations.push(...validateSecondaryCoverage({ landingTranslations: T }));
  } catch (e) {
    violations.push({ file: "scripts/landing-translations.json", where: "file", rule: "io", detail: e.message });
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ total: violations.length, violations }, null, 2));
    process.exit(violations.length ? 1 : 0);
  }

  if (violations.length === 0) {
    console.log(
      "check-landing-free-plan: OK — Free cards clean across the rendered landings " +
        "+ 6 primary + 24 secondary sources (no device-count claims, wedge leads)",
    );
    process.exit(0);
  }

  console.error(`check-landing-free-plan: ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.file} — ${v.where}`);
    console.error(`    ${v.detail}`);
  }
  console.error(
    "\nFix the COPY (preferred). Device counts are banned on the Free plan " +
      "(any-device policy); the smart-search/Raindrop wedge must lead the Free card " +
      "(slot 0 primary locales, slot 1 secondary).",
  );
  process.exit(1);
}
