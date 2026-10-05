/**
 * scripts/generate-complete-translations.mjs — build the 24 secondary
 * locale files (scripts/translations/<lang>.json) that build-landings.cjs
 * renders from.
 *
 * The 24 landings used to ship with English body copy under localized URLs
 * (a support-ticket / refund magnet): the localized marketing copy EXISTS —
 * 86 fields per locale in scripts/landing-translations.json — but an earlier
 * generator mapped only a handful of keys and left everything else on the
 * English template. This generator applies the FULL mapping:
 *
 *   en.json (schema + fallback)           scripts/landing-translations.json
 *        │                                        │ localized core copy
 *        ├──────────────┬─────────────────────────┤
 *        │              ▼                         │
 *        │        merge + derive                  │
 *        │              │                         │
 *        │              ├─ secondary-supplement.json (authored strings:
 *        │              │    nav labels, feature/privacy descriptions,
 *        │              │    AI providers, JSON-LD list, and fixes for the
 *        │              │    English strays the core copy never translated)
 *        │              │
 *        │              ▼
 *        │      scripts/translations/<lang>.json  → build-landings.cjs
 *        ▼
 *   demo / raindropCompare are null on secondaries: the template
 *   (landing.njk) hides those sections rather than rendering English inside
 *   a localized page. They roll out per locale as they get translated.
 *
 * Locale identity (canonical, og:locale, homeHref) comes from the single
 * registry (scripts/landing-registry.mjs) — never a second copy here. The
 * generator FAILS LOUDLY on any locale missing its source data instead of
 * silently shipping an English page.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const landingTranslations = JSON.parse(
  fs.readFileSync(path.join(__dirname, "landing-translations.json"), "utf-8"),
);
const supplement = JSON.parse(
  fs.readFileSync(path.join(__dirname, "translations", "secondary-supplement.json"), "utf-8"),
);
const enTemplate = JSON.parse(
  fs.readFileSync(path.join(__dirname, "translations", "en.json"), "utf-8"),
);

// Locale identity (canonical / og:locale / path) — registry-owned.
const { LANDING_LOCALES, LANDING_PAGES, PRIMARY_LOCALE_CODES } = await import(
  "./landing-registry.mjs",
);

/** Language names in the language itself (switcher labels; endonyms). */
const LANG_NAMES = {
  ar: "العربية", bg: "Български", cs: "Čeština", da: "Dansk", el: "Ελληνικά",
  fi: "Suomi", he: "עברית", hi: "हिन्दी", hr: "Hrvatski", hu: "Magyar",
  id: "Bahasa Indonesia", ja: "日本語", ko: "한국어", nl: "Nederlands",
  no: "Norsk", pl: "Polski", ro: "Română", ru: "Русский", sv: "Svenska",
  th: "ไทย", tr: "Türkçe", uk: "Українська", vi: "Tiếng Việt", zh: "中文",
};

// The 24 SECONDARY locales only. The six primaries (en, es, fr, de, pt, it)
// are full hand-written translations of the current copy in their own files
// — this generator must never overwrite them.
const SECONDARY_LOCALES = LANDING_PAGES.filter(
  (p) => !PRIMARY_LOCALE_CODES.includes(p.lang),
).map((p) => p.lang);

/** "<strong>X</strong> — Y" pillar strings → { strong, text }. */
function parsePillar(raw) {
  const m = String(raw).match(/<strong>(.*?)<\/strong>\s*[—–-]\s*(.*)/s);
  if (m) return { strong: m[1], text: m[2] };
  const strongOnly = String(raw).match(/<strong>(.*?)<\/strong>\s*(.*)/s);
  if (strongOnly) return { strong: strongOnly[1], text: strongOnly[2] };
  return { strong: "", text: String(raw).replace(/<[^>]*>/g, "") };
}

function fail(lang, message) {
  throw new Error(`generate-complete-translations [${lang}]: ${message}`);
}

function buildLocale(lang) {
  const page = LANDING_PAGES.find((p) => p.lang === lang);
  const pageLocale = LANDING_LOCALES.find((l) => l.lang === lang);
  const landing = landingTranslations[lang];
  const supp = supplement[lang];
  if (!landing) fail(lang, "no entry in scripts/landing-translations.json");
  if (!supp) fail(lang, "no entry in scripts/translations/secondary-supplement.json");

  // Core localized copy. supplement wins on the same landing key names — it
  // is the reviewed fix for the fields the core copy left in English. A
  // supplement key of the form "field__N" overrides a single array element
  // (e.g. priceFreeItems__5) without re-authoring the whole array.
  const t = { ...landing, ...supp };
  for (const key of Object.keys(supp)) {
    const m = key.match(/^(.+)__(\d+)$/);
    if (!m) continue;
    const arr = t[m[1]];
    if (!Array.isArray(arr)) fail(lang, `${key}: ${m[1]} is not an array in the core copy`);
    t[m[1]] = [...arr];
    t[m[1]][Number(m[2])] = supp[key];
    delete t[key];
  }

  const out = structuredClone(enTemplate);
  const need = (value, label) => {
    if (value === undefined || value === null || value === "") fail(lang, `missing ${label}`);
    return value;
  };

  // ── identity (registry-derived) ──────────────────────────────────────────
  out.lang = lang;
  out.langName = LANG_NAMES[lang] ?? fail(lang, "no LANG_NAMES endonym");
  out.dir = t.dir === "rtl" ? "rtl" : "ltr";
  out.canonical = page.canonical;
  out.ogLocale = page.locale;
  out.ogLocaleAlternate = page.alternateLocale;
  out.homeHref = pageLocale.path;
  out.langLink = { href: "/?lang=en", hreflang: "en", lang: "en", text: "English" };

  // ── meta / OG / Twitter (derived from the localized title+description) ───
  out.title = need(t.title, "title");
  out.description = need(t.metaDesc, "metaDesc");
  out.ogTitle = out.title;
  out.ogDescription = out.description;
  out.twitterTitle = out.title;
  out.twitterDescription = out.description;

  // ── chrome ───────────────────────────────────────────────────────────────
  out.skipLink = need(t.skipLink, "skipLink");
  out.navBrandAria = need(t.navBrandAria, "navBrandAria");
  out.navAriaLabel = need(t.navAriaLabel, "navAriaLabel");
  out.navCta = need(t.navCta, "navCta");
  out.themeToggleAria = need(t.themeToggleAria, "themeToggleAria");
  out.navLinks = { ...out.navLinks, ...t.navLinks };

  // ── hero ─────────────────────────────────────────────────────────────────
  out.hero = {
    ...out.hero,
    badge: need(t.heroBadge, "heroBadge"),
    title: need(t.heroTitle, "heroTitle"),
    subtitle: need(t.heroSub, "heroSub"),
    ctaPrimary: need(t.heroCtaPrimary, "heroCtaPrimary"),
    ctaSecondary: need(t.heroCtaSecondary, "heroCtaSecondary"),
    pillars: (need(t.heroPillars, "heroPillars") || []).map(parsePillar),
  };

  // ── pocket alternative ───────────────────────────────────────────────────
  out.pocketAlternative = {
    ...out.pocketAlternative,
    tag: need(t.pocketTag, "pocketTag"),
    title: need(t.pocketTitle, "pocketTitle"),
    subtitle: need(t.pocketDesc, "pocketDesc"),
    features: [0, 1, 2].map((i) => ({
      title: need(t[`pocketFeat${i + 1}Title`], `pocketFeat${i + 1}Title`),
      text: need(t[`pocketFeat${i + 1}Desc`], `pocketFeat${i + 1}Desc`),
    })),
    ctaPrimary: need(t.pocketCta, "pocketCta"),
    ctaSecondary: need(t.pocketLink, "pocketLink"),
  };

  // ── features (titles from core copy, descriptions from supplement) ──────
  out.features = {
    ...out.features,
    tag: need(t.featTag, "featTag"),
    title: need(t.featTitle, "featTitle"),
    items: need(t.featItems, "featItems").map((title, i) => ({
      title,
      text: need(t.featTexts?.[i], `featTexts[${i}]`),
    })),
  };

  // ── ai ───────────────────────────────────────────────────────────────────
  out.ai = {
    ...out.ai,
    tag: need(t.aiTag, "aiTag"),
    title: need(t.aiTitle, "aiTitle"),
    subtitle: need(t.aiSub, "aiSub"),
    providers: {
      title: need(t.aiProvidersTitle, "aiProvidersTitle"),
      list: out.ai.providers.list.map((p, i) => ({
        ...p,
        name: need(t.aiProviders?.[i], `aiProviders[${i}]`),
      })),
    },
    modes: {
      title: need(t.aiModesTitle, "aiModesTitle"),
      items: [0, 1, 2].map((i) => ({
        title: need(t[`aiMode${i + 1}Title`], `aiMode${i + 1}Title`),
        text: need(t[`aiMode${i + 1}Desc`], `aiMode${i + 1}Desc`),
      })),
    },
  };

  // ── privacy (titles from core copy, descriptions from supplement) ───────
  out.privacy = {
    ...out.privacy,
    title: need(t.privTitle, "privTitle"),
    subtitle: need(t.privSub, "privSub"),
    items: need(t.privItems, "privItems").map((title, i) => ({
      title,
      text: need(t.privTexts?.[i], `privTexts[${i}]`),
    })),
  };

  // ── pricing (both cards + legal line — the refund promise) ──────────────
  out.pricing = {
    ...out.pricing,
    title: need(t.priceTitle, "priceTitle"),
    subtitle: need(t.priceSub, "priceSub"),
    plans: [
      {
        ...out.pricing.plans[0],
        name: need(t.priceFreeName, "priceFreeName"),
        price: need(t.priceFreePrice, "priceFreePrice"),
        period: need(t.priceFreeInterval, "priceFreeInterval"),
        description: need(t.priceFreeDesc, "priceFreeDesc"),
        features: need(t.priceFreeItems, "priceFreeItems").map((text) => ({ included: true, text })),
        cta: need(t.priceFreeCta, "priceFreeCta"),
      },
      {
        ...out.pricing.plans[1],
        name: need(t.priceProName, "priceProName"),
        badge: need(t.priceProBadge, "priceProBadge"),
        price: need(t.priceProPrice, "priceProPrice"),
        period: need(t.priceProInterval, "priceProInterval"),
        description: need(t.priceProDesc, "priceProDesc"),
        features: need(t.priceProItems, "priceProItems").map((text) => ({ included: true, text })),
        cta: need(t.priceProCta, "priceProCta"),
        // Pro-card helper lines (under the price / under the CTA): the EN
        // schema's "then $79 regular" and "Support: Email 48h (Mon–Fri)"
        // spread through unmapped and shipped English on all 24 pages.
        priceSub: need(t.priceProSub, "priceProSub"),
        sla: need(t.priceProSla, "priceProSla"),
      },
    ],
    legal: need(t.priceLegal, "priceLegal"),
  };

  // ── faq (core copy's 1–3; supplement's support/password replace the
  //    English strays faq5*/faq6*; five items, matching the EN schema) ─────
  out.faq = {
    title: need(t.faqTitle, "faqTitle"),
    items: [
      { question: need(t.faq1Q, "faq1Q"), answer: need(t.faq1A, "faq1A") },
      { question: need(t.faq2Q, "faq2Q"), answer: need(t.faq2A, "faq2A") },
      { question: need(t.faq3Q, "faq3Q"), answer: need(t.faq3A, "faq3A") },
      { question: need(t.faqSupportQ, "faqSupportQ"), answer: need(t.faqSupportA, "faqSupportA") },
      { question: need(t.faqPasswordQ, "faqPasswordQ"), answer: need(t.faqPasswordA, "faqPasswordA") },
    ],
  };

  // ── cta + footer ─────────────────────────────────────────────────────────
  out.cta = {
    ...out.cta,
    title: need(t.ctaTitle, "ctaTitle"),
    text: need(t.ctaDesc, "ctaDesc"),
    ctaPrimary: need(t.ctaPrimary, "ctaPrimary"),
    ctaSecondary: need(t.ctaSecondary, "ctaSecondary"),
    note: need(t.ctaNote, "ctaNote"),
  };
  out.footer = {
    ...out.footer,
    brand: need(t.footerTagline, "footerTagline"),
    product: {
      title: need(t.footerProduct, "footerProduct"),
      links: need(t.footerProductItems, "footerProductItems"),
    },
    resources: {
      title: need(t.footerResources, "footerResources"),
      links: need(t.footerResourcesItems, "footerResourcesItems"),
    },
    languages: {
      ...out.footer.languages,
      title: need(t.footerLangs, "footerLangs"),
    },
    support: {
      title: need(t.footerSupport, "footerSupport"),
      links: need(t.footerSupportItems, "footerSupportItems"),
      helpCenter: need(t.footerSupportHelp, "footerSupportHelp"),
      errorCodes: need(t.footerErrorCodes, "footerErrorCodes"),
    },
    copyright: need(t.footerCopyright, "footerCopyright"),
    legal: [
      need(t.footerPrivacy, "footerPrivacy"),
      need(t.footerTerms, "footerTerms"),
      out.footer.legal[2],
    ],
  };

  // ── the two newest sections stay hidden until translated ────────────────
  out.demo = null;
  out.raindropCompare = null;

  // ── JSON-LD (feeds Google rich results — derive from translated copy) ───
  out.structuredData = {
    ...out.structuredData,
    websiteDescription: out.description,
    offers: [
      {
        name: out.pricing.plans[0].name,
        price: "0",
        currency: "USD",
        description: out.pricing.plans[0].description,
      },
      {
        name: out.pricing.plans[1].name,
        price: "59",
        currency: "USD",
        description: out.pricing.plans[1].description,
      },
    ],
    featureList: need(t.featureList, "featureList"),
    faq: out.faq.items.map((qa) => ({ question: qa.question, answer: qa.answer })),
  };

  return out;
}

for (const lang of SECONDARY_LOCALES) {
  const translation = buildLocale(lang);
  const outputPath = path.join(__dirname, "translations", `${lang}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(translation, null, 2), "utf-8");
  console.log(`✓ Generated ${lang}.json`);
}

console.log(`\nAll ${SECONDARY_LOCALES.length} secondary locale translation files generated.`);
console.log("Sources: landing-translations.json (core copy) + secondary-supplement.json (authored strings).");
console.log("demo/raindropCompare stay hidden on secondaries until translated (landing.njk guards).");
