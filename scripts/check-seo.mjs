/**
 * scripts/check-seo.mjs — search-engine visibility gate for the static pages.
 *
 * Guards the only indexable surface of the site and the noindex contract
 * that keeps the private app out of the index:
 *
 *   Landing pages (public/landing.html EN + public/<lang>.html for the other
 *   29 locales — the registry is LANDING_LOCALES below) and the
 *   single-language comparison page (public/pocket-alternative.html) must
 *   carry:
 *     - <html lang>, <title> and meta description
 *     - canonical + hreflang alternates (self, other language, x-default)
 *     - Open Graph meta (og:url must match canonical; og:image must point
 *       at the card OG_IMAGE_POLICY assigns and at an existing asset in
 *       public/ — social sharing otherwise degrades to a bare link card)
 *     - Twitter Card meta (summary_large_image; twitter:image == og:image)
 *     - at least one parseable application/ld+json block declaring the four
 *       schema.org types the pages use: WebSite, Organization,
 *       SoftwareApplication and FAQPage (with real Question entries)
 * *   The auxiliary pages (the SPA shell index.html and public/404.html) are
 *   not indexed, but social crawlers still read their head when the URL is
 *   shared, so they must carry the canonical + full OG/Twitter set and stay
 *   coherent with the EN landing's brand identity (og:site_name, og:image).
 *
 *   The legal pages (public/privacy-and-terms.html + the five localized
 *   copies at /<lang>/privacy-and-terms.html) must carry canonical + the
 *   full 6-language hreflang set + OG/Twitter, like the landings, but are
 *   NOT required to declare the schema.org JSON-LD blocks (no FAQPage,
 *   SoftwareApplication etc. on a legal document).
 *
 *   Language negotiation: the bare root must 302-redirect browsers whose
 *   primary Accept-Language is one of the localized landings (public/
 *   nginx.conf for the Docker path, functions/_middleware.js for Cloudflare
 *   Pages). 302, not 301 — negotiation must stay temporary so the en
 *   canonical at / is preserved.
 *
 *   The private app must never be indexed:
 *     - X-Robots-Tag: noindex for /app, /app/*, /capture, /capture/* and
 *       /offline* in public/_headers (Cloudflare Pages) and netlify.toml
 *     - robots.txt Disallow for /app, /capture, /offline and /api
 *     - <meta name="robots" content="noindex"> in public/offline.html
 *     - public/sitemap.xml must not list /app and must list every landing
 *       locale (/ through /zh/) plus /pocket-alternative, and each landing
 *       <url> block must carry the full xhtml:link hreflang annotation set
 *       (30 languages + x-default) so the alternates survive at sitemap
 *       level even when a crawler skips the HTML <head>
 *
 * The landing identity (canonical, hreflang pairs, locales) is declared in
 * LANDING_PAGES below, derived from the deployment domain in csp-config.js
 * so a BOOKMARKFORGE_DOMAIN change cannot silently desync the SEO contract.
 *
 * Pure gate, no --fix. Node core only — runs even in a broken node_modules.
 *
 * Usage:
 *   node scripts/check-seo.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { APP_DOMAIN } from "./csp-config.js";

// Repo root. Deliberately process.cwd() (not import.meta.url): vitest
// transforms module URLs to a non-file scheme, so fileURLToPath(new
// URL("..", import.meta.url)) throws when the gate is imported by its
// test (scripts/__tests__/check-seo.test.mjs). Both the CLI gate and
// vitest always run from the repo root, so cwd() is equivalent.
const ROOT = process.cwd();
const TAG = "[check-seo]";
const SITE_URL = `https://${APP_DOMAIN}`;

/**
 * Every landing language and its canonical URL (all pages link all of them).
 *
 * 30 locales as of 2026-09-22 (the locale expansion landed 24 new pages);
 * the hrefs match the <head> alternates and the sitemap xhtml:link set, and
 * the code list matches check-sitemap-coverage's LANDING_LANGS. Adding a
 * locale means adding its row here, its page identity to LANDING_LOCALES, its
 * visible-link href to LANG_LINK_HREFS and the pages themselves — the gate
 * fails loudly on a page the registry does not know (and on a registry entry
 * the pages do not carry), which is exactly how the 6→30 lag was found.
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

/**
 * Per-page identity: file, language, OG locales and canonical path. Kept in
 * step with LANDING_LANGS (one entry per locale, same set) — the OG locales
 * are the values the live pages carry, verified by the gate on every run.
 */
export const LANDING_LOCALES = [
  { file: "public/landing.html", lang: "en", locale: "en_US", alternateLocale: "es_ES", path: "/" },
  { file: "public/ar.html", lang: "ar", locale: "ar_AR", alternateLocale: "en_US", path: "/ar/" },
  { file: "public/bg.html", lang: "bg", locale: "bg_BG", alternateLocale: "en_US", path: "/bg/" },
  { file: "public/cs.html", lang: "cs", locale: "cs_CZ", alternateLocale: "en_US", path: "/cs/" },
  { file: "public/da.html", lang: "da", locale: "da_DK", alternateLocale: "en_US", path: "/da/" },
  { file: "public/de.html", lang: "de", locale: "de_DE", alternateLocale: "en_US", path: "/de/" },
  { file: "public/el.html", lang: "el", locale: "el_GR", alternateLocale: "en_US", path: "/el/" },
  { file: "public/es.html", lang: "es", locale: "es_ES", alternateLocale: "en_US", path: "/es/" },
  { file: "public/fi.html", lang: "fi", locale: "fi_FI", alternateLocale: "en_US", path: "/fi/" },
  { file: "public/fr.html", lang: "fr", locale: "fr_FR", alternateLocale: "en_US", path: "/fr/" },
  { file: "public/he.html", lang: "he", locale: "he_IL", alternateLocale: "en_US", path: "/he/" },
  { file: "public/hi.html", lang: "hi", locale: "hi_IN", alternateLocale: "en_US", path: "/hi/" },
  { file: "public/hr.html", lang: "hr", locale: "hr_HR", alternateLocale: "en_US", path: "/hr/" },
  { file: "public/hu.html", lang: "hu", locale: "hu_HU", alternateLocale: "en_US", path: "/hu/" },
  { file: "public/id.html", lang: "id", locale: "id_ID", alternateLocale: "en_US", path: "/id/" },
  { file: "public/it.html", lang: "it", locale: "it_IT", alternateLocale: "en_US", path: "/it/" },
  { file: "public/ja.html", lang: "ja", locale: "ja_JP", alternateLocale: "en_US", path: "/ja/" },
  { file: "public/ko.html", lang: "ko", locale: "ko_KR", alternateLocale: "en_US", path: "/ko/" },
  { file: "public/nl.html", lang: "nl", locale: "nl_NL", alternateLocale: "en_US", path: "/nl/" },
  { file: "public/no.html", lang: "no", locale: "no_NO", alternateLocale: "en_US", path: "/no/" },
  { file: "public/pl.html", lang: "pl", locale: "pl_PL", alternateLocale: "en_US", path: "/pl/" },
  { file: "public/pt.html", lang: "pt", locale: "pt_PT", alternateLocale: "en_US", path: "/pt/" },
  { file: "public/ro.html", lang: "ro", locale: "ro_RO", alternateLocale: "en_US", path: "/ro/" },
  { file: "public/ru.html", lang: "ru", locale: "ru_RU", alternateLocale: "en_US", path: "/ru/" },
  { file: "public/sv.html", lang: "sv", locale: "sv_SE", alternateLocale: "en_US", path: "/sv/" },
  { file: "public/th.html", lang: "th", locale: "th_TH", alternateLocale: "en_US", path: "/th/" },
  { file: "public/tr.html", lang: "tr", locale: "tr_TR", alternateLocale: "en_US", path: "/tr/" },
  { file: "public/uk.html", lang: "uk", locale: "uk_UA", alternateLocale: "en_US", path: "/uk/" },
  { file: "public/vi.html", lang: "vi", locale: "vi_VN", alternateLocale: "en_US", path: "/vi/" },
  { file: "public/zh.html", lang: "zh", locale: "zh_CN", alternateLocale: "en_US", path: "/zh/" },
];

/** Landing pages and their expected SEO identity (derived from the domain). */
export const LANDING_PAGES = LANDING_LOCALES.map((l) => ({
  file: l.file,
  lang: l.lang,
  locale: l.locale,
  alternateLocale: l.alternateLocale,
  canonical: `${SITE_URL}${l.path}`,
  alternates: [...LANDING_LANGS, { hreflang: "x-default", href: `${SITE_URL}/` }],
}));

/**
 * Single-language pages (no hreflang alternates yet). Same head contract
 * as the landings minus the multi-language requirements.
 */
export const SINGLE_PAGES = [
  {
    file: "public/pocket-alternative.html",
    lang: "en",
    locale: "en_US",
    alternateLocale: null, // no translations of this page yet
    canonical: `${SITE_URL}/pocket-alternative`,
    alternates: [],
  },
];

/** og:image of the general product card — the default every page carries. */
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

/**
 * Open Graph share-card policy — which card each page must use.
 *
 * `og:image` is per-URL: crawlers ignore `#anchors`, so a page cannot point
 * at a section-specific card. The mapping is therefore decided per page and
 * enforced here, so a card swap can never drift back unnoticed:
 *
 *   - og-image.png         → the general product card (navy background, app
 *     logo, "Your Local-First Digital Brain"). Default for every page.
 *   - og-image-<lang>.png → the localized product card for /<lang>/ (es,
 *     fr, de, pt, it). Same navy/logo style, localized tagline so the
 *     shared URL renders the right language on the social card.
 *   - og-image-pricing.png → the pricing card (same style, "Simple, Fair
 *     Pricing" / "Free forever · Pro $79 one-time — no subscriptions").
 *     Reserved for pricing-adjacent surfaces. Today that is
 *     /pocket-alternative — its whole body pitches the Pocket migration
 *     around the free tier and the one-time $79 Pro upgrade, so its share
 *     card sells the pricing, not the product overview.
 *
 * A page not listed here must use the landing's og:image (the general
 * card). Aux pages (SPA shell, 404) additionally inherit brand coherence
 * with the EN landing, so they always carry the general card.
 */
export const OG_IMAGE_POLICY = [
  {
    file: "public/pocket-alternative.html",
    ogImage: `${SITE_URL}/og-image-pricing.png`,
  },
  { file: "public/es.html", ogImage: `${SITE_URL}/og-image-es.png` },
  { file: "public/fr.html", ogImage: `${SITE_URL}/og-image-fr.png` },
  { file: "public/de.html", ogImage: `${SITE_URL}/og-image-de.png` },
  { file: "public/pt.html", ogImage: `${SITE_URL}/og-image-pt.png` },
  { file: "public/it.html", ogImage: `${SITE_URL}/og-image-it.png` },
];

/** og:image URL a page must use per OG_IMAGE_POLICY (default: the general card). */
export function ogImageForFile(file) {
  const entry = OG_IMAGE_POLICY.find((p) => p.file === file);
  return entry ? entry.ogImage : DEFAULT_OG_IMAGE;
}

/** Every legal-page language: hreflang token and canonical path. */
const LEGAL_LANG_PATHS = {
  en: "/privacy-and-terms.html",
  es: "/es/privacy-and-terms.html",
  fr: "/fr/privacy-and-terms.html",
  de: "/de/privacy-and-terms.html",
  pt: "/pt/privacy-and-terms.html",
  it: "/it/privacy-and-terms.html",
};

/**
 * Legal pages (privacy + terms) in every landing language. Same head
 * contract as the landings minus JSON-LD: canonical, full 6-language
 * hreflang set + x-default, OG and Twitter. Served at real .html paths
 * (no 200 rewrite), so each canonical is its own URL.
 */
export const LEGAL_PAGES = Object.entries(LEGAL_LANG_PATHS).map(
  ([lang, path], i) => ({
    file: path === "/privacy-and-terms.html" ? "public/privacy-and-terms.html" : `public${path}`,
    lang,
    locale:
      { es: "es_ES", fr: "fr_FR", de: "de_DE", pt: "pt_PT", it: "it_IT" }[lang] ?? "en_US",
    alternateLocale: i === 0 ? "es_ES" : "en_US",
    canonical: `${SITE_URL}${path}`,
    path,
    alternates: [
      ...Object.entries(LEGAL_LANG_PATHS).map(([hreflang, p]) => ({
        hreflang,
        href: `${SITE_URL}${p}`,
      })),
      { hreflang: "x-default", href: `${SITE_URL}/privacy-and-terms.html` },
    ],
  }),
);

/**
 * Key legal terminology that MUST stay translated consistently across the
 * six legal documents (privacy + terms): the GDPR acronym per
 * jurisdiction, the data-controller term, opt-in, ROPA, and the license
 * "entitlement state" phrase. The last one regressed once into a literal
 * "rule of law" translation ("Estado de derecho"/"État du droit"/"Estado
 * do direito"/"Stato del diritto"), which is why it is pinned here.
 */
export const LEGAL_TERMS = {
  en: ["GDPR", "ROPA", "opt-in", "Entitlement state"],
  es: ["RGPD", "ROPA", "opt-in", "responsable del tratamiento", "derecho de uso"],
  fr: ["RGPD", "ROPA", "opt-in", "responsable du traitement", "droit d'utilisation"],
  de: ["DSGVO", "ROPA", "Opt-in", "Verantwortlicher", "Berechtigungsstatus"],
  pt: ["RGPD", "ROPA", "opt-in", "responsável pelo tratamento", "direito de utilização"],
  it: ["GDPR", "ROPA", "opt-in", "titolare del trattamento", "diritto di utilizzo"],
};

/**
 * Validate that each legal document carries its language's key legal
 * terms (pure function — testable without touching the repo). `pages`
 * maps a language code to the raw file content. Returns failure strings.
 */
export function validateLegalTerms({ pages }) {
  const failures = [];
  for (const [lang, terms] of Object.entries(LEGAL_TERMS)) {
    const content = pages[lang];
    if (content === undefined) {
      failures.push(`legal pages: missing content for ${lang}`);
      continue;
    }
    for (const term of terms) {
      if (!content.includes(term)) {
        failures.push(
          `legal ${lang}: missing key legal term "${term}"`,
        );
      }
    }
  }
  return failures;
}

/** The expected visible language-link href per language (nav/footer of
 *  the landings): the target landing URL carrying the ?lang= preference
 *  parameter (the manual language choice). */
export const LANG_LINK_HREFS = {
  en: "/?lang=en",
  ar: "/ar/?lang=ar",
  bg: "/bg/?lang=bg",
  cs: "/cs/?lang=cs",
  da: "/da/?lang=da",
  de: "/de/?lang=de",
  el: "/el/?lang=el",
  es: "/es/?lang=es",
  fi: "/fi/?lang=fi",
  fr: "/fr/?lang=fr",
  he: "/he/?lang=he",
  hi: "/hi/?lang=hi",
  hr: "/hr/?lang=hr",
  hu: "/hu/?lang=hu",
  id: "/id/?lang=id",
  it: "/it/?lang=it",
  ja: "/ja/?lang=ja",
  ko: "/ko/?lang=ko",
  nl: "/nl/?lang=nl",
  no: "/no/?lang=no",
  pl: "/pl/?lang=pl",
  pt: "/pt/?lang=pt",
  ro: "/ro/?lang=ro",
  ru: "/ru/?lang=ru",
  sv: "/sv/?lang=sv",
  th: "/th/?lang=th",
  tr: "/tr/?lang=tr",
  uk: "/uk/?lang=uk",
  vi: "/vi/?lang=vi",
  zh: "/zh/?lang=zh",
};

/**
 * Validate the visible language links (nav + footer) of the 30 landings:
 * every one of the languages must be linked, each link must carry BOTH
 * lang and hreflang attributes with the same value, must point at the
 * right landing URL with ?lang= (the preference mechanism), and each page
 * must link its OWN version correctly. `pages` maps a language code to
 * the raw page content. Pure function — returns failure strings.
 */
export function validateLandingLangLinks({ pages }) {
  const failures = [];
  const langs = Object.keys(LANG_LINK_HREFS);
  for (const [lang, html] of Object.entries(pages)) {
    const label = `landing ${lang}`;
    const links = [...html.matchAll(/<a\s[^>]*\bhreflang="([a-z]{2})"[^>]*>/g)].map((m) => m[0]);

    const covered = new Set(
      links.map((l) => l.match(/\bhreflang="([a-z]{2})"/)[1]),
    );
    for (const l of langs) {
      if (!covered.has(l)) {
        failures.push(`${label}: missing visible language link for ${l}`);
      }
    }

    for (const link of links) {
      const hl = link.match(/\bhreflang="([a-z]{2})"/)[1];
      const langAttr = link.match(/\blang="([a-z]{2})"/)?.[1] ?? null;
      const href = link.match(/\bhref="([^"]+)"/)?.[1] ?? null;
      if (langAttr !== hl) {
        failures.push(
          `${label}: hreflang="${hl}" link must carry lang="${hl}" (found ${langAttr ?? "none"})`,
        );
      }
      if (href !== LANG_LINK_HREFS[hl]) {
        failures.push(
          `${label}: hreflang="${hl}" link must point to ${LANG_LINK_HREFS[hl]} (found ${href ?? "none"})`,
        );
      }
    }

    const own = LANG_LINK_HREFS[lang];
    if (!links.some((l) => l.includes(`href="${own}"`))) {
      failures.push(`${label}: must link its own version at ${own}`);
    }
  }
  return failures;
}

/**
 * Auxiliary pages that are never indexed but must still share correctly:
 * the SPA shell (index.html, canonical points at the landing it mirrors)
 * and the custom 404 page (canonical to itself). Their og:site_name and
 * og:image are validated against the EN landing (brand coherence).
 */
export const AUX_PAGES = [
  {
    file: "index.html",
    canonical: `${SITE_URL}/`,
  },
  {
    file: "public/404.html",
    canonical: `${SITE_URL}/404.html`,
  },
];

const REQUIRED_OG = [
  "type",
  "site_name",
  "title",
  "description",
  "url",
  "image",
  "image:width",
  "image:height",
  "locale",
];
const REQUIRED_TWITTER = ["title", "description", "image"];
const SCHEMA_TYPES = ["WebSite", "Organization", "SoftwareApplication", "FAQPage"];
const NOINDEX_PATHS = ["/app", "/app/*", "/capture", "/capture/*", "/offline*"];
const ROBOTS_DISALLOWS = ["/app", "/capture", "/offline", "/api"];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Value of a <meta name|property="key" content="..."> tag, or null. */
export function metaContent(html, key) {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${escapeRe(key)}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

/** href of the <link rel=...> tag (optionally filtered by hreflang), or null. */
export function linkHref(html, rel, hreflang) {
  const tagRe = new RegExp(`<link[^>]*\\brel=["']${escapeRe(rel)}["'][^>]*>`, "gi");
  for (const tag of html.match(tagRe) ?? []) {
    const hl = tag.match(/\bhreflang=["']([^"']+)["']/i);
    if (hreflang && (!hl || hl[1] !== hreflang)) {
      continue;
    }
    const href = tag.match(/\bhref=["']([^"']+)["']/i);
    if (href) {
      return href[1];
    }
  }
  return null;
}

/** Raw text of every application/ld+json block in the page. */
export function extractLdJsonBlocks(html) {
  const blocks = [];
  for (const m of html.matchAll(
    /<script[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    blocks.push(m[1]);
  }
  return blocks;
}

/**
 * Validate that the WebSite JSON-LD node carries a SearchAction
 * (siteless searchbox / sitelinks searchbox for Google).
 * `nodes` = parsed @graph nodes. Returns failure strings.
 */
export function validateSearchAction(nodes) {
  const failures = [];
  const website = nodes.find((n) => n["@type"] === "WebSite");
  if (!website) {
    return failures; // no WebSite — other JSON-LD checks handle that
  }
  const pa = website.potentialAction;
  if (!pa) {
    failures.push('JSON-LD WebSite must declare potentialAction (SearchAction)');
    return failures;
  }
  if (pa["@type"] !== "SearchAction") {
    failures.push(
      `JSON-LD WebSite potentialAction must be "SearchAction" (found "${pa["@type"] ?? "missing"}")`,
    );
    return failures;
  }
  if (!pa.target || !pa.target.urlTemplate) {
    failures.push(
      'JSON-LD WebSite SearchAction must declare target.urlTemplate',
    );
  }
  if (!pa["query-input"]) {
    failures.push(
      'JSON-LD WebSite SearchAction must declare query-input',
    );
  }
  return failures;
}

/**
 * Validate one landing page against its expected SEO identity.
 * `cfg` = { file, lang, locale, alternateLocale, canonical, alternates,
 * assetExists(path) -> boolean }. `opts.requireJsonLd` defaults to true;
 * legal pages pass false (no schema.org blocks on a legal document).
 * Returns an array of failure strings (empty when the page is clean).
 */
export function validateLandingHtml(html, cfg, { requireJsonLd = true } = {}) {
  const failures = [];
  const where = cfg.file;

  const langTag = html.match(/<html[^>]*\blang=["']([^"']+)["']/i);
  if (!langTag || langTag[1] !== cfg.lang) {
    failures.push(`${where}: <html lang> must be "${cfg.lang}"`);
  }

  const title = html.match(/<title>([^<]*)<\/title>/i);
  if (!title || !title[1].trim()) {
    failures.push(`${where}: <title> missing or empty`);
  }
  if (!metaContent(html, "description")) {
    failures.push(`${where}: meta description missing`);
  }

  const canonical = linkHref(html, "canonical");
  if (canonical !== cfg.canonical) {
    failures.push(
      `${where}: canonical must be ${cfg.canonical} (found ${canonical ?? "none"})`,
    );
  }
  for (const { hreflang, href } of cfg.alternates) {
    const actual = linkHref(html, "alternate", hreflang);
    if (actual !== href) {
      failures.push(
        `${where}: hreflang="${hreflang}" must point to ${href} (found ${actual ?? "none"})`,
      );
    }
  }

  if (metaContent(html, "og:url") !== cfg.canonical) {
    failures.push(`${where}: og:url must match canonical ${cfg.canonical}`);
  }
  for (const key of REQUIRED_OG) {
    if (!metaContent(html, `og:${key}`)) {
      failures.push(`${where}: og:${key} missing`);
    }
  }
  if (metaContent(html, "og:locale") !== cfg.locale) {
    failures.push(`${where}: og:locale must be ${cfg.locale}`);
  }
  if (
    cfg.alternateLocale &&
    metaContent(html, "og:locale:alternate") !== cfg.alternateLocale
  ) {
    failures.push(
      `${where}: og:locale:alternate must be ${cfg.alternateLocale}`,
    );
  }
  const ogImage = metaContent(html, "og:image");
  if (!ogImage) {
    failures.push(`${where}: og:image missing (social shares degrade to a bare card)`);
  } else {
    if (cfg.assetExists) {
      const rel = ogImage.replace(SITE_URL, "").replace(/^\/+/, "");
      if (!cfg.assetExists(rel)) {
        failures.push(`${where}: og:image asset missing at public/${rel}`);
      }
    }
    // Card→page policy: og-image-pricing on pricing-adjacent pages, the
    // general product card everywhere else (see OG_IMAGE_POLICY above).
    const expectedImage = cfg.ogImage ?? ogImageForFile(cfg.file);
    if (expectedImage && ogImage !== expectedImage) {
      failures.push(
        `${where}: og:image must be ${expectedImage} per OG_IMAGE_POLICY (found ${ogImage})`,
      );
    }
  }

  if (metaContent(html, "twitter:card") !== "summary_large_image") {
    failures.push(`${where}: twitter:card must be summary_large_image`);
  }
  for (const key of REQUIRED_TWITTER) {
    if (!metaContent(html, `twitter:${key}`)) {
      failures.push(`${where}: twitter:${key} missing`);
    }
  }
  if (ogImage && metaContent(html, "twitter:image") !== ogImage) {
    failures.push(`${where}: twitter:image must match og:image`);
  }

  if (requireJsonLd) {
    const blocks = extractLdJsonBlocks(html);
    if (blocks.length === 0) {
      failures.push(`${where}: no application/ld+json block`);
    }
    const nodes = [];
    for (const raw of blocks) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        failures.push(`${where}: invalid JSON-LD — ${e.message}`);
        continue;
      }
      const graph = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
      nodes.push(...graph.filter((n) => n && typeof n === "object"));
    }
    const graphTypes = nodes.flatMap((n) =>
      Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]],
    );
    for (const type of SCHEMA_TYPES) {
      if (!graphTypes.includes(type)) {
        failures.push(`${where}: JSON-LD missing @type "${type}"`);
      }
    }
    const faq = nodes.find((n) => n["@type"] === "FAQPage");
    if (faq) {
      const questions = Array.isArray(faq.mainEntity) ? faq.mainEntity : [];
      if (
        questions.length === 0 ||
        !questions.some(
          (q) =>
            q["@type"] === "Question" &&
            q.name &&
            q.acceptedAnswer &&
            q.acceptedAnswer.text,
        )
      ) {
        failures.push(
          `${where}: FAQPage must list Question entries with acceptedAnswer text`,
        );
      }
    }
    failures.push(...validateSearchAction(nodes).map((f) => `${where}: ${f}`));
  }

  return failures;
}

/**
 * Validate one auxiliary page (SPA shell / 404) against its expected
 * identity. `cfg` = { file, canonical, siteName?, ogImage?,
 * assetExists?(path) -> boolean }. siteName/ogImage are the EN landing's
 * values (brand coherence). Returns an array of failure strings.
 */
export function validateAuxHtml(html, cfg) {
  const failures = [];
  const where = cfg.file;

  const title = html.match(/<title>([^<]*)<\/title>/i);
  if (!title || !title[1].trim()) {
    failures.push(`${where}: <title> missing or empty`);
  }
  if (!metaContent(html, "description")) {
    failures.push(`${where}: meta description missing`);
  }

  const canonical = linkHref(html, "canonical");
  if (canonical !== cfg.canonical) {
    failures.push(
      `${where}: canonical must be ${cfg.canonical} (found ${canonical ?? "none"})`,
    );
  }
  if (metaContent(html, "og:url") !== cfg.canonical) {
    failures.push(`${where}: og:url must match canonical ${cfg.canonical}`);
  }
  for (const key of REQUIRED_OG) {
    if (!metaContent(html, `og:${key}`)) {
      failures.push(`${where}: og:${key} missing`);
    }
  }
  if (cfg.siteName && metaContent(html, "og:site_name") !== cfg.siteName) {
    failures.push(
      `${where}: og:site_name must match the landing (${cfg.siteName})`,
    );
  }
  const ogImage = metaContent(html, "og:image");
  if (cfg.ogImage && ogImage !== cfg.ogImage) {
    failures.push(`${where}: og:image must match the landing (${cfg.ogImage})`);
  } else if (cfg.assetExists && ogImage) {
    const rel = ogImage.replace(SITE_URL, "").replace(/^\/+/, "");
    if (!cfg.assetExists(rel)) {
      failures.push(`${where}: og:image asset missing at public/${rel}`);
    }
  }

  if (metaContent(html, "twitter:card") !== "summary_large_image") {
    failures.push(`${where}: twitter:card must be summary_large_image`);
  }
  for (const key of REQUIRED_TWITTER) {
    if (!metaContent(html, `twitter:${key}`)) {
      failures.push(`${where}: twitter:${key} missing`);
    }
  }
  if (ogImage && metaContent(html, "twitter:image") !== ogImage) {
    failures.push(`${where}: twitter:image must match og:image`);
  }

  return failures;
}

/**
 * Validate the Accept-Language negotiation contract across the three hosts
 * plus the manual language preference (cookie + ?lang=):
 *   - nginx must redirect the bare root to each localized landing (302),
 *     with ?lang= (param wins) and the bf_lang cookie (overrides
 *     Accept-Language) handled before negotiation, which only runs without
 *     a preference cookie (internal /_negotiate); /_lang/<lang> locations
 *     set the bf_lang + nf_lang cookies.
 *   - the Cloudflare Pages middleware must carry the same mapping and
 *     preference logic (pickPreferenceCookie / landingForLang).
 *   - netlify.toml must hold conditional 302 rules (Language conditions)
 *     for the same five languages, listed BEFORE the 200 rewrite fallback
 *     (Netlify applies the first matching rule; its native nf_lang cookie
 *     overrides the Language conditions).
 *   - landing.js must set both preference cookies and handle ?lang=.
 * All arguments are raw file contents (pure function — testable without
 * touching the repo). Returns an array of failure strings.
 */
export function validateLanguageNegotiation({
  nginxConf,
  middleware,
  netlifyToml,
  landingJs,
  langs = ["es", "fr", "de", "pt", "it"],
}) {
  const failures = [];
  if (!nginxConf.includes("$http_accept_language")) {
    failures.push("public/nginx.conf: Accept-Language negotiation missing in location = /");
  }
  for (const lang of langs) {
    const re = new RegExp(`\\$http_accept_language ~\\* \"\\^${lang}\"`);
    if (!re.test(nginxConf)) {
      failures.push(`public/nginx.conf: missing Accept-Language match for ^${lang}`);
    }
    if (!nginxConf.includes(`rewrite ^ /${lang}/ redirect;`)) {
      failures.push(`public/nginx.conf: missing 302 redirect to /${lang}/`);
    }
    if (!middleware.includes(`${lang}: "/${lang}/"`)) {
      failures.push(`functions/_middleware.js: missing landing mapping for ${lang}`);
    }
    // Manual preference: cookie rules in nginx (one per localized lang).
    if (!nginxConf.includes(`if ($cookie_bf_lang ~* "^${lang}$")`)) {
      failures.push(`public/nginx.conf: missing bf_lang cookie rule for ^${lang}$`);
    }
  }
  if (!middleware.includes("export function pickLandingLang")) {
    failures.push("functions/_middleware.js: missing pickLandingLang export");
  }
  if (!middleware.includes("export async function onRequest")) {
    failures.push("functions/_middleware.js: missing onRequest export");
  }

  // ?lang= param (explicit choice, strongest signal) + cookie-set targets.
  const prefLangs = ["en", ...langs];
  for (const lang of prefLangs) {
    if (!nginxConf.includes(`if ($arg_lang ~* "^${lang}$") { rewrite ^ /_lang/${lang} last; }`)) {
      failures.push(`public/nginx.conf: missing ?lang= rule for ^${lang}$`);
    }
    if (!nginxConf.includes(`location = /_lang/${lang} {`)) {
      failures.push(`public/nginx.conf: missing location /_lang/${lang}`);
    }
    const clean = lang === "en" ? "/" : `/${lang}/`;
    if (!nginxConf.includes(`return 302 ${clean};`)) {
      failures.push(`public/nginx.conf: /_lang/${lang} missing 302 return to ${clean}`);
    }
    if (!nginxConf.includes(`Set-Cookie "bf_lang=${lang};`)) {
      failures.push(`public/nginx.conf: /_lang/${lang} missing bf_lang cookie`);
    }
    if (!nginxConf.includes(`Set-Cookie "nf_lang=${lang};`)) {
      failures.push(`public/nginx.conf: /_lang/${lang} missing nf_lang cookie`);
    }
  }
  if (!nginxConf.includes("if ($cookie_bf_lang = \"\")")) {
    failures.push("public/nginx.conf: missing empty-cookie guard before Accept-Language");
  }
  if (!nginxConf.includes("location = /_negotiate {")) {
    failures.push("public/nginx.conf: missing internal /_negotiate location");
  }

  if (!middleware.includes("export function pickPreferenceCookie")) {
    failures.push("functions/_middleware.js: missing pickPreferenceCookie export");
  }
  if (!middleware.includes("export function landingForLang")) {
    failures.push("functions/_middleware.js: missing landingForLang export");
  }
  if (!middleware.includes('"nf_lang"')) {
    failures.push("functions/_middleware.js: missing nf_lang cookie (Netlify override)");
  }

  if (landingJs !== undefined) {
    if (!landingJs.includes("setLangPreference")) {
      failures.push("public/landing.js: missing setLangPreference helper");
    }
    if (!landingJs.includes("document.cookie")) {
      failures.push("public/landing.js: missing cookie write");
    }
    if (!landingJs.includes("bf_lang")) {
      failures.push("public/landing.js: missing bf_lang cookie");
    }
    if (!landingJs.includes("nf_lang")) {
      failures.push("public/landing.js: missing nf_lang cookie (Netlify override)");
    }
    if (!landingJs.includes("URLSearchParams")) {
      failures.push("public/landing.js: missing ?lang= handling (URLSearchParams)");
    }
  }

  if (netlifyToml !== undefined) {
    // Split on [[redirects]] blocks; the first chunk is the header section.
    const blocks = netlifyToml.split(/\n(?=\[\[redirects\]\])/).slice(1);
    const fallbackIdx = blocks.findIndex(
      (b) =>
        b.includes('from = "/"') &&
        b.includes('to = "/landing.html"') &&
        b.includes("status = 200"),
    );
    if (fallbackIdx === -1) {
      failures.push(
        'netlify.toml: missing status = 200 rewrite fallback for "/" → /landing.html',
      );
    }
    for (const lang of langs) {
      const idx = blocks.findIndex(
        (b) =>
          b.includes('from = "/"') &&
          b.includes(`to = "/${lang}/"`) &&
          b.includes("status = 302") &&
          !b.includes("status = 301") &&
          b.includes(`conditions = { Language = ["${lang}"] }`),
      );
      if (idx === -1) {
        failures.push(
          `netlify.toml: missing conditional 302 redirect to /${lang}/ (Language = ["${lang}"])`,
        );
      } else if (fallbackIdx !== -1 && idx > fallbackIdx) {
        failures.push(
          `netlify.toml: Language redirect to /${lang}/ must precede the 200 fallback for "/"`,
        );
      }
    }
  }
  return failures;
}

/**
 * Validate the noindex contracts for the private app.
 * All arguments are raw file contents (pure function — testable without
 * touching the repo). Returns an array of failure strings.
 */
export function validateNoindexContent({
  headers,
  toml,
  robots,
  offlineHtml,
  sitemapXml,
  siteUrl = SITE_URL,
}) {
  const failures = [];

  for (const p of NOINDEX_PATHS) {
    const re = new RegExp(
      `^${escapeRe(p)}\\s*\\n[ \\t]*X-Robots-Tag:\\s*noindex`,
      "m",
    );
    if (!re.test(headers)) {
      failures.push(`public/_headers: X-Robots-Tag noindex missing for ${p}`);
    }
  }
  for (const p of NOINDEX_PATHS) {
    const re = new RegExp(
      `for = "${escapeRe(p)}"[\\s\\S]*?X-Robots-Tag = "noindex"`,
    );
    if (!re.test(toml)) {
      failures.push(`netlify.toml: X-Robots-Tag noindex missing for ${p}`);
    }
  }
  for (const d of ROBOTS_DISALLOWS) {
    const re = new RegExp(`^Disallow:\\s*${escapeRe(d)}\\s*$`, "m");
    if (!re.test(robots)) {
      failures.push(`public/robots.txt: Disallow ${d} missing`);
    }
  }
  if (!/<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(offlineHtml)) {
    failures.push(
      'public/offline.html: <meta name="robots" content="noindex"> missing',
    );
  }
  const locs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (locs.some((u) => u.startsWith(`${siteUrl}/app`))) {
    failures.push("public/sitemap.xml: /app must not be listed");
  }
  for (const l of LANDING_LOCALES) {
    if (!locs.includes(`${siteUrl}${l.path}`)) {
      failures.push(`public/sitemap.xml: missing ${l.path}`);
    }
  }
  if (!locs.includes(`${siteUrl}/pocket-alternative`)) {
    failures.push("public/sitemap.xml: missing /pocket-alternative");
  }
  for (const p of LEGAL_PAGES) {
    if (!locs.includes(`${siteUrl}${p.path}`)) {
      failures.push(`public/sitemap.xml: missing legal ${p.path}`);
    }
  }
  // Sitemap-level hreflang (xhtml:link): every landing <url> block must
  // annotate the same alternate set as the HTML <head> of its cluster
  // (30 languages + x-default), every legal <url> block its own 6-language
  // set, and the urlset must declare the xhtml namespace.
  if (!/xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/.test(sitemapXml)) {
    failures.push("public/sitemap.xml: xmlns:xhtml missing from <urlset>");
  }
  const urlBlocks = [...sitemapXml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  const expectedLinks = [...LANDING_LANGS, { hreflang: "x-default", href: `${siteUrl}/` }];
  for (const l of LANDING_LOCALES) {
    const loc = `${siteUrl}${l.path}`;
    const block = urlBlocks.find((b) => b.includes(`<loc>${loc}</loc>`));
    if (!block) {
      continue; // missing loc already reported above
    }
    const actual = sitemapAlternateMap(block);
    for (const { hreflang, href } of expectedLinks) {
      if (actual[hreflang] !== href) {
        failures.push(
          `public/sitemap.xml: ${loc} xhtml:link hreflang="${hreflang}" must point to ${href} (found ${actual[hreflang] ?? "none"})`,
        );
      }
    }
  }
  // Legal pages form their own 6-language cluster: every legal <url> must
  // annotate the set from its HTML <head> (6 languages + x-default → the
  // EN legal page), not just the landing URLs.
  for (const p of LEGAL_PAGES) {
    const loc = `${siteUrl}${p.path}`;
    const block = urlBlocks.find((b) => b.includes(`<loc>${loc}</loc>`));
    if (!block) {
      continue; // missing legal loc already reported above
    }
    const actual = sitemapAlternateMap(block);
    for (const { hreflang, href } of p.alternates) {
      if (actual[hreflang] !== href) {
        failures.push(
          `public/sitemap.xml: ${loc} xhtml:link hreflang="${hreflang}" must point to ${href} (found ${actual[hreflang] ?? "none"})`,
        );
      }
    }
  }

  return failures;
}

/** Parse the xhtml:link alternates of one sitemap <url> block into a
 *  hreflang → href map. */
function sitemapAlternateMap(block) {
  const actual = {};
  for (const m of block.matchAll(/<xhtml:link[^>]*>/g)) {
    const hl = m[0].match(/\bhreflang="([^"]+)"/);
    const href = m[0].match(/\bhref="([^"]+)"/);
    if (hl && href) {
      actual[hl[1]] = href[1];
    }
  }
  return actual;
}

function readOrFail(rel, failures) {
  const path = join(ROOT, rel);
  try {
    return readFileSync(path, "utf8");
  } catch {
    failures.push(`${rel}: missing`);
    return "";
  }
}

/** Run the full gate against the repo. Returns the failure list (prints ok lines). */
export function runCheck() {
  const failures = [];

  let pagesOk = 0;
  for (const cfg of [...LANDING_PAGES, ...SINGLE_PAGES, ...LEGAL_PAGES]) {
    const requireJsonLd = !LEGAL_PAGES.includes(cfg);
    const path = join(ROOT, cfg.file);
    let html;
    try {
      html = readFileSync(path, "utf8");
    } catch {
      failures.push(`${cfg.file}: missing`);
      continue;
    }
    const pageFailures = validateLandingHtml(
      html,
      {
        ...cfg,
        assetExists: (rel) => existsSync(join(ROOT, "public", rel)),
      },
      { requireJsonLd },
    );
    if (pageFailures.length > 0) {
      failures.push(...pageFailures);
    } else {
      pagesOk += 1;
      console.log(
        `${TAG} ok  ${cfg.file} (lang=${cfg.lang}, canonical, hreflang x${cfg.alternates.length}, og, twitter${requireJsonLd ? ", json-ld" : ""})`,
      );
    }
  }

  // Landing language links (nav/footer): lang + hreflang attributes,
  // correct ?lang= targets, and each page links its own version.
  const landingLangPages = {};
  for (const cfg of LANDING_PAGES) {
    landingLangPages[cfg.lang] = readOrFail(cfg.file, failures);
  }
  const langLinkFailures = validateLandingLangLinks({ pages: landingLangPages });
  if (langLinkFailures.length > 0) {
    failures.push(...langLinkFailures);
  } else {
    console.log(
      `${TAG} ok  landing language links (lang+hreflang on all 6, ?lang= targets, own version linked) in ${Object.keys(landingLangPages).length} languages`,
    );
  }

  // Legal documents: key terminology must stay translated consistently.
  const legalContents = {};
  for (const cfg of LEGAL_PAGES) {
    legalContents[cfg.lang] = readOrFail(cfg.file, failures);
  }
  const legalTermFailures = validateLegalTerms({ pages: legalContents });
  if (legalTermFailures.length > 0) {
    failures.push(...legalTermFailures);
  } else {
    console.log(
      `${TAG} ok  legal terminology (GDPR/RGPD/DSGVO, ROPA, opt-in, controller, entitlement state) in ${Object.keys(LEGAL_TERMS).length} languages`,
    );
  }

  // Auxiliary pages: brand identity must stay coherent with the EN landing.
  let landingHtml = "";
  try {
    landingHtml = readFileSync(join(ROOT, LANDING_PAGES[0].file), "utf8");
  } catch {
    failures.push(`${LANDING_PAGES[0].file}: missing`);
  }
  const auxBrand = {
    siteName: metaContent(landingHtml, "og:site_name"),
    ogImage: metaContent(landingHtml, "og:image"),
  };
  let auxOk = 0;
  for (const cfg of AUX_PAGES) {
    const path = join(ROOT, cfg.file);
    let html;
    try {
      html = readFileSync(path, "utf8");
    } catch {
      failures.push(`${cfg.file}: missing`);
      continue;
    }
    const pageFailures = validateAuxHtml(html, {
      ...cfg,
      ...auxBrand,
      assetExists: (rel) => existsSync(join(ROOT, "public", rel)),
    });
    if (pageFailures.length > 0) {
      failures.push(...pageFailures);
    } else {
      auxOk += 1;
      console.log(
        `${TAG} ok  ${cfg.file} (canonical, og, twitter, coherent with landing)`,
      );
    }
  }

  const languageFailures = validateLanguageNegotiation({
    nginxConf: readOrFail("public/nginx.conf", failures),
    middleware: readOrFail("functions/_middleware.js", failures),
    netlifyToml: readOrFail("netlify.toml", failures),
    landingJs: readOrFail("public/landing.js", failures),
  });
  if (languageFailures.length > 0) {
    failures.push(...languageFailures);
  } else {
    console.log(
      `${TAG} ok  language negotiation + manual preference (nginx.conf + functions/_middleware.js + netlify.toml + landing.js, 302 to the 5 localized landings)`,
    );
  }

  const noindexFailures = validateNoindexContent({
    headers: readOrFail("public/_headers", failures),
    toml: readOrFail("netlify.toml", failures),
    robots: readOrFail("public/robots.txt", failures),
    offlineHtml: readOrFail("public/offline.html", failures),
    sitemapXml: readOrFail("public/sitemap.xml", failures),
  });
  if (noindexFailures.length > 0) {
    failures.push(...noindexFailures);
  } else {
    console.log(
      `${TAG} ok  noindex contracts (_headers, netlify.toml, robots.txt, offline.html, sitemap.xml)`,
    );
  }

  if (failures.length === 0) {
    console.log(
      `${TAG} ok: ${pagesOk} indexed page(s) + ${auxOk} auxiliary page(s) + noindex contracts verified`,
    );
  }
  return failures;
}

// Run only when executed directly (importable for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = runCheck();
  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`${TAG} FAIL: ${f}`);
    }
    console.error(`${TAG} FAIL: ${failures.length} violation(s) — SEO contract drifted`);
    process.exit(1);
  }
  process.exit(0);
}