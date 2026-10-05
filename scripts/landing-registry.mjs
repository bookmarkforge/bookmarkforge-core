/**
 * scripts/landing-registry.mjs — single source of truth for the localized
 * landing locale set (30: EN at the root + 29 translated landings).
 *
 * Everything that names the landing languages derives from this module: the
 * SEO registry (check-seo.mjs), the nginx config (nginx-render.mjs), the
 * sitemap-coverage and page-figures gates, the brand-logo gate, the Cloudflare
 * middleware (functions/_middleware.js) and the browser preference logic
 * (public/landing.js, via the generated artifact below). Until this module
 * existed each consumer kept its own hand-written list, and the 6→30
 * expansion left five of them behind at 6 — the dropdown offered languages
 * whose cookie the middleware dropped, whose nginx rewrite did not exist and
 * whose Netlify Language rule was missing. A new locale now means ONE edit
 * here (plus its page, translations and share card); every layer above
 * follows, and the gates fail if a layer's checked-in output lags.
 *
 * Node-core only (no deps, no filesystem reads): every consumer above runs in
 * a different runtime (gate scripts, the edge, the browser) and all of them
 * can import this. pure data, deterministic order.
 */

/** The canonical site origin (mirrors check-seo.mjs, derived the same way). */
import { APP_DOMAIN } from "./csp-config.js";

export const SITE_URL = `https://${APP_DOMAIN}`;

/**
 * Every landing language, EN included, in the canonical (alphabetical)
 * order the hreflang sets, the sitemap and the visible language links share.
 * EN's href is the root: it is a landing, not a redirect target.
 *
 * ADR-043: `x-default` is an hreflang ANNOTATION pointing at the root, not a
 * 31st landing language — it has no page, no preference code and no
 * negotiation entry. It lives only in the `alternates` sets below
 * (LANDING_PAGES), appended after this list; adding it here turns it into a
 * pseudo-locale that every consumer must then fabricate a route for.
 */
export const LANDING_LANGS = [
  { hreflang: "en", href: `${SITE_URL}/` },
  { hreflang: "ar", href: `${SITE_URL}/ar/` },
  { hreflang: "bg", href: `${SITE_URL}/bg/` },
  { hreflang: "cs", href: `${SITE_URL}/cs/` },
  { hreflang: "da", href: `${SITE_URL}/da/` },
  { hreflang: "de", href: `${SITE_URL}/de/` },
  { hreflang: "el", href: `${SITE_URL}/el/` },
  { hreflang: "es", href: `${SITE_URL}/es/` },
  { hreflang: "fi", href: `${SITE_URL}/fi/` },
  { hreflang: "fr", href: `${SITE_URL}/fr/` },
  { hreflang: "he", href: `${SITE_URL}/he/` },
  { hreflang: "hi", href: `${SITE_URL}/hi/` },
  { hreflang: "hr", href: `${SITE_URL}/hr/` },
  { hreflang: "hu", href: `${SITE_URL}/hu/` },
  { hreflang: "id", href: `${SITE_URL}/id/` },
  { hreflang: "it", href: `${SITE_URL}/it/` },
  { hreflang: "ja", href: `${SITE_URL}/ja/` },
  { hreflang: "ko", href: `${SITE_URL}/ko/` },
  { hreflang: "nl", href: `${SITE_URL}/nl/` },
  { hreflang: "no", href: `${SITE_URL}/no/` },
  { hreflang: "pl", href: `${SITE_URL}/pl/` },
  { hreflang: "pt", href: `${SITE_URL}/pt/` },
  { hreflang: "ro", href: `${SITE_URL}/ro/` },
  { hreflang: "ru", href: `${SITE_URL}/ru/` },
  { hreflang: "sv", href: `${SITE_URL}/sv/` },
  { hreflang: "th", href: `${SITE_URL}/th/` },
  { hreflang: "tr", href: `${SITE_URL}/tr/` },
  { hreflang: "uk", href: `${SITE_URL}/uk/` },
  { hreflang: "vi", href: `${SITE_URL}/vi/` },
  { hreflang: "zh", href: `${SITE_URL}/zh/` },
];

/** All 30 codes, EN included ("en" = the root landing itself). */
export const LANDING_CODES = LANDING_LANGS.map((l) => l.hreflang);

/** The 29 codes with a localized landing route (EN excluded) — the set the
 * edge can redirect TO and the set of public/<code>.html files. */
export const LOCALIZED_LANDING_CODES = LANDING_CODES.filter((c) => c !== "en");

/** Preference languages: everything the dropdown can choose, EN included
 * ("en" means "stop negotiating, serve the EN landing"). One list for BOTH
 * axes by design — see the middleware's header comment for why the
 * preference set and the negotiation set must never diverge. */
export const PREF_LANGS = LANDING_CODES;

/**
 * The six locales the product launched with — the "primary" set, in launch
 * order (EN first). This is a CONTENT distinction, not a stale copy of the
 * 30, and two things key off it:
 *
 *   - the landing wedge: check-landing-free-plan expects the Free card in
 *     slot 0 on primaries and slot 1 everywhere else, and validates the
 *     primaries from their full translation sources (scripts/translations/
 *     <code>.json) while the other 24 come from scripts/landing-translations
 *     .json — that gate also pins the split against that artifact;
 *   - the legal world (see LEGAL_LOCALE_CODES below).
 *
 * Everything in LANDING_CODES that is not listed here is a translation of this
 * set: 24 newer landings and 24 newer legal pages.
 */
export const PRIMARY_LOCALE_CODES = ["en", "es", "fr", "de", "pt", "it"];

/**
 * The legal world's reviewed languages — the same six primaries. The legal
 * PAGES exist for every landing locale (public/<code>/privacy-and-terms.html,
 * pinned by check-sitemap-coverage), but only these six are reviewed by hand:
 * they are the legal hreflang cluster (check-hreflang-graph) and the set whose
 * head contract check-seo validates. The other 24 are generated from
 * scripts/privacy-translations.json — one entry per locale outside the five
 * localized primaries, coverage check-seo pins — so a locale added without a
 * translation entry fails the build instead of shipping English inside a
 * translated page.
 */
export const LEGAL_LOCALE_CODES = PRIMARY_LOCALE_CODES;

/** og:url-canonical region per language (the values the live pages carry;
 * verified on every gate run). Only EN differs from its own code. */
const LOCALE_REGION = {
  en: "US", es: "ES", pt: "PT", ja: "JP", ko: "KR", el: "GR",
  he: "IL", hi: "IN", hu: "HU", id: "ID", da: "DK", no: "NO", uk: "UA",
  vi: "VN", zh: "CN", ar: "AR", bg: "BG", cs: "CZ", de: "DE", fi: "FI",
  fr: "FR", hr: "HR", it: "IT", nl: "NL", pl: "PL", ro: "RO", ru: "RU",
  sv: "SE", th: "TH", tr: "TR",
};

/**
 * Per-page identity: file, OG locales, canonical and the full hreflang
 * alternate set. EN is public/landing.html at "/"; every other locale is
 * public/<code>.html at "/<code>/". One row per locale, same order.
 */
export const LANDING_LOCALES = LANDING_CODES.map((lang) => ({
  file: lang === "en" ? "public/landing.html" : `public/${lang}.html`,
  lang,
  locale: `${lang}_${LOCALE_REGION[lang]}`,
  alternateLocale: lang === "en" ? "es_ES" : "en_US",
  path: lang === "en" ? "/" : `/${lang}/`,
}));

/** Derived page configs (the shape check-seo.mjs's LANDING_PAGES always had). */
export const LANDING_PAGES = LANDING_LOCALES.map((l) => ({
  file: l.file,
  lang: l.lang,
  locale: l.locale,
  alternateLocale: l.alternateLocale,
  canonical: `${SITE_URL}${l.path}`,
  // The hreflang cluster is the 30 landings PLUS the x-default annotation
  // (exactly once — it must never be part of LANDING_LANGS itself).
  alternates: [...LANDING_LANGS, { hreflang: "x-default", href: `${SITE_URL}/` }],
}));

/**
 * The visible language-link href per language (nav/footer of the landings):
 * the target landing URL carrying the ?lang= preference parameter.
 */
export const LANG_LINK_HREFS = Object.fromEntries(
  LANDING_CODES.map((lang) => [
    lang,
    lang === "en" ? "/?lang=en" : `/${lang}/?lang=${lang}`,
  ]),
);
