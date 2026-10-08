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
  alternates: [...LANDING_LANGS, { hreflang: "x-default", href: `${SITE_URL}/` }],
}));

/**
 * The visible language-link href per language (nav/footer of the landings):
 * the target landing URL as a clean path (`/es/`, `/fr/`, `/` for en). The
 * `?lang=` query form was deliberately dropped from visible links (f83eb3a,
 * "clean paths instead of query strings"); it remains a supported direct-URL
 * preference mechanism (middleware, nginx, landing.js), just no longer what
 * the pages link to.
 */
export const LANG_LINK_HREFS = Object.fromEntries(
  LANDING_CODES.map((lang) => [lang, lang === "en" ? "/" : `/${lang}/`]),
);

/**
 * The localized user manual per language, named in its OWN language (the
 * endonym) plus the locale suffix: `docs/manual-de-usuario-es.md`,
 * `docs/benutzerhandbuch-de.md`, `docs/user-manual-ja.md`. One basename per
 * locale, extensionless — the Markdown source, the generated PDF and the
 * styled-HTML twin all derive from it (`manualSourcePath`,
 * `manualPdfPath`, `manualStyledHtmlPath`).
 *
 * Why the endonym rather than a `manual-usuario-<code>` family: the Spanish
 * stem was the only part of the name every reader could not read, in 29 files
 * whose whole purpose is to be readable to someone who does not speak English.
 * The ASCII+locale convention is deliberate: a native-script filename
 * (`ユーザーマニュアル-ja.md`) survives git and CI on Windows but encodes badly
 * in URLs, Content-Disposition headers and the PDF download links, so scripts
 * with no ASCII spelling fall back to `user-manual-<code>`. Every consumer
 * derives from this table — the figures gate, the PDF generator, the exporter,
 * the claim gate and the docs index — so a locale added here without a manual
 * fails those gates instead of being silently skipped.
 */
export const MANUAL_FILES = {
  ar: "user-manual-ar",
  bg: "user-manual-bg",
  cs: "uzivatelska-prirucka-cs",
  da: "brugervejledning-da",
  de: "benutzerhandbuch-de",
  el: "egcheiridio-christi-el",
  en: "user-manual-en",
  es: "manual-de-usuario-es",
  fi: "kayttoopas-fi",
  fr: "manuel-utilisateur-fr",
  he: "user-manual-he",
  hi: "user-manual-hi",
  hr: "korisnicki-prirucnik-hr",
  hu: "felhasznaloi-kezikonyv-hu",
  id: "panduan-pengguna-id",
  it: "manuale-utente-it",
  ja: "user-manual-ja",
  ko: "user-manual-ko",
  nl: "gebruikershandleiding-nl",
  no: "brukerhandbok-no",
  pl: "podrecznik-uzytkownika-pl",
  pt: "manual-do-utilizador-pt",
  ro: "manual-de-utilizare-ro",
  ru: "user-manual-ru",
  sv: "anvandhandbok-sv",
  th: "user-manual-th",
  tr: "kullanici-kilavuzu-tr",
  uk: "user-manual-uk",
  vi: "huong-dan-su-dung-vi",
  zh: "user-manual-zh",
};

/** docs/<basename>.md — the source of truth for the whole manual family. */
export function manualSourcePath(code) {
  const base = MANUAL_FILES[code];
  if (!base) throw new Error(`[landing-registry] no manual file for locale: ${code}`);
  return `docs/${base}.md`;
}

/** docs/<basename>.pdf — generated from the Markdown by docs:pdf:localized. */
export function manualPdfPath(code) {
  return `docs/${MANUAL_FILES[code]}.pdf`;
}

/** docs/<basename>-styled.html — the printable twin the PDF is rendered from. */
export function manualStyledHtmlPath(code) {
  return `docs/${MANUAL_FILES[code]}-styled.html`;
}

/**
 * Every manual file (Markdown + PDF) in LANDING_CODES order, repo-root
 * relative. The exporter ships exactly this set, so the public tree's manual
 * family can never lag the registry.
 */
export const MANUAL_PATHS = LANDING_CODES.flatMap((code) => [
  manualSourcePath(code),
  manualPdfPath(code),
]);
