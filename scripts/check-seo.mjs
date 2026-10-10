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
 *   copies at /<lang>/privacy-and-terms.html — the reviewed set is
 *   registry-owned, see LEGAL_LOCALE_CODES; the other 24 locales' legal pages
 *   are generated and their translations pinned below) must carry canonical + the
 *   full 6-language hreflang set + OG/Twitter, like the landings, but are
 *   NOT required to declare the schema.org JSON-LD blocks (no FAQPage,
 *   SoftwareApplication etc. on a legal document).
 *
 *   Language negotiation: the bare root must 302-redirect browsers whose
 *   primary Accept-Language is one of the localized landings (public/
 *   nginx.conf for the Docker path, functions/_middleware.js for Cloudflare
 *   Pages, netlify.toml Language conditions for Netlify). 302, not 301 —
 *   negotiation must stay temporary so the en canonical at / is preserved.
 *   The same 30-language list also backs the MANUAL preference (?lang= +
 *   bf_lang cookie), which is why one list exists and not two: on Netlify
 *   the preference has no mechanism of its own (the platform matches the
 *   nf_lang cookie against those same Language rules), so a locale that is
 *   choosable from the dropdown but absent from a layer is a locale whose
 *   choice gets silently ignored. The gate loops over LANDING_LANG_CODES,
 *   so it fails on the layer that lags.
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
import {
  LANG_LINK_HREFS as REGISTRY_LINK_HREFS,
  LANDING_CODES as REGISTRY_ALL_CODES,
  LEGAL_LOCALE_CODES as REGISTRY_LEGAL_CODES,
  LOCALIZED_LANDING_CODES as REGISTRY_LOCALIZED_CODES,
  LANDING_LANGS as REGISTRY_LANGS,
  LANDING_LOCALES as REGISTRY_LOCALES,
  LANDING_PAGES as REGISTRY_PAGES,
  SITE_URL as REGISTRY_SITE_URL,
} from "./landing-registry.mjs";

// Repo root. Deliberately process.cwd() (not import.meta.url): vitest
// transforms module URLs to a non-file scheme, so fileURLToPath(new
// URL("..", import.meta.url)) throws when the gate is imported by its
// test (scripts/__tests__/check-seo.test.mjs). Both the CLI gate and
// vitest always run from the repo root, so cwd() is equivalent.
const ROOT = process.cwd();
const TAG = "[check-seo]";
const SITE_URL = REGISTRY_SITE_URL;

/**
 * Every landing language and its canonical URL — the 30-locale registry
 * is OWNED by scripts/landing-registry.mjs now; this module re-exports it
 * under the historical names so its importers (tests, the other gates)
 * keep working. A new locale is ONE edit in the registry, never here.
 */
export const LANDING_LANGS = REGISTRY_LANGS;

/**
 * The 29 localized landing codes (registry-derived, EN excluded) — the
 * language contract: the negotiation/preference gate loops over THIS list,
 * so a locale missing from nginx.conf, the Cloudflare middleware or
 * netlify.toml fails the build instead of shipping a half-wired language.
 */
export const LANDING_LANG_CODES = REGISTRY_LOCALIZED_CODES;


/**
 * Per-page identity (file, language, OG locales, canonical path) —
 * registry-derived; re-exported under the historical name.
 */
export const LANDING_LOCALES = REGISTRY_LOCALES;

/** Landing pages and their expected SEO identity (derived from the domain). */
export const LANDING_PAGES = REGISTRY_PAGES;

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

/** Every legal-page language: hreflang token and canonical path. The SET is
 * registry-owned (the six reviewed primaries), so the legal world is one edit
 * in scripts/landing-registry.mjs instead of six (this gate, the hreflang
 * graph, nginx-render's legal targets and the page generator). */
const LEGAL_LANG_PATHS = Object.fromEntries(
  REGISTRY_LEGAL_CODES.map((lang) => [
    lang,
    lang === "en" ? "/privacy-and-terms.html" : `/${lang}/privacy-and-terms.html`,
  ]),
);

/**
 * Legal pages (privacy + terms) in every landing language. Same head
 * contract as the landings minus JSON-LD: canonical, full 6-language
 * hreflang set + x-default, OG and Twitter. Served at real .html paths
 * (no 200 rewrite), so each canonical is its own URL.
 */
export const LEGAL_PAGES = Object.entries(LEGAL_LANG_PATHS).map(
  ([lang, path]) => ({
    file: path === "/privacy-and-terms.html" ? "public/privacy-and-terms.html" : `public${path}`,
    lang,
    // OG locales come from the registry, i.e. the same values the landing for
    // that language carries: a legal page can no longer advertise a region its
    // own landing disagrees with.
    locale: REGISTRY_LOCALES.find((l) => l.lang === lang)?.locale ?? "en_US",
    alternateLocale:
      REGISTRY_LOCALES.find((l) => l.lang === lang)?.alternateLocale ?? "en_US",
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
 * The legal-translation artifact must cover exactly the locales the legal
 * pages are GENERATED for: every landing locale except the five localized
 * primaries (EN is included as the source language). The six reviewed legal
 * pages are hand-written, so an entry for one of them would be a stale
 * machine translation waiting to overwrite reviewed copy, while a missing
 * entry for a new locale means its legal page can never be produced in its own
 * language — the two failure modes this pin exists to catch.
 *
 * All arguments are raw file contents (pure function — testable without
 * touching the repo). Returns an array of failure strings.
 */
export function validateLegalTranslationCoverage({
  translationsJson,
  langs = REGISTRY_ALL_CODES,
  primaryLangs = REGISTRY_LEGAL_CODES,
}) {
  let parsed;
  try {
    parsed = JSON.parse(translationsJson);
  } catch (error) {
    return [
      `scripts/privacy-translations.json: not valid JSON (${error.message})`,
    ];
  }
  const failures = [];
  const present = new Set(Object.keys(parsed));
  // The five localized primaries are reviewed by hand; EN carries the source
  // text the generator adapts from, so it keeps its entry.
  const expected = new Set(
    langs.filter((lang) => !(primaryLangs.includes(lang) && lang !== "en")),
  );
  for (const lang of expected) {
    if (!present.has(lang)) {
      failures.push(
        `scripts/privacy-translations.json: no translation entry for ` +
          `"${lang}" — every generated legal page needs one`,
      );
    }
  }
  for (const lang of present) {
    if (!expected.has(lang)) {
      failures.push(
        `scripts/privacy-translations.json: unexpected entry "${lang}" — the ` +
          `reviewed legal pages are hand-written (${primaryLangs.join(", ")})`,
      );
    }
  }
  return failures;
}

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
 *  the landings): the target landing URL as a clean path (`/es/`, `/` for
 *  en) — the `?lang=` query form was deliberately dropped from visible
 *  links (f83eb3a). Registry-derived; re-exported under the historical
 *  name. */
export const LANG_LINK_HREFS = REGISTRY_LINK_HREFS;

/**
 * Validate the visible language links (nav + footer) of the 30 landings:
 * every one of the languages must be linked, each link must carry BOTH
 * lang and hreflang attributes with the same value, must point at the
 * right landing URL (clean path), and each page
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
 * plus the manual language preference (cookie + ?lang=). Both axes cover
 * every locale in `langs` (default: all 29 localized landings):
 *   - nginx must redirect the bare root to each localized landing (302),
 *     with ?lang= (param wins) and the bf_lang cookie (overrides
 *     Accept-Language) handled before negotiation, which only runs without
 *     a preference cookie (internal /_negotiate); /_lang/<lang> locations
 *     set the bf_lang + nf_lang cookies.
 *   - the Cloudflare Pages middleware must carry the same mapping and
 *     preference logic (pickPreferenceCookie / landingForLang).
 *   - netlify.toml must hold conditional 302 rules (Language conditions)
 *     for the same 29 languages, listed BEFORE the 200 rewrite fallback
 *     (Netlify applies the first matching rule; its native nf_lang cookie
 *     is matched against these same rules, so this list is also what makes
 *     a manual choice stick on that host).
 *   - landing.js must set both preference cookies and handle ?lang=.
 * All arguments are raw file contents (pure function — testable without
 * touching the repo). Returns an array of failure strings.
 */
export function validateLanguageNegotiation({
  nginxConf,
  middleware,
  netlifyToml,
  landingJs,
  langs = LANDING_LANG_CODES,
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

    // Manual preference: cookie rules in nginx (one per localized lang).
    // `en` is intentionally not in `langs`: the bf_lang=en cookie means
    // "stop negotiating, serve the EN landing" and short-circuits below
    // instead of redirecting (its ?lang=en / /_lang/en half still exists).
    if (!nginxConf.includes(`if ($cookie_bf_lang ~* "^${lang}$")`)) {
      failures.push(`public/nginx.conf: missing bf_lang cookie rule for ^${lang}$`);
    }
  }
  // The middleware must DERIVE its map from the registry (a hand-written
  // copy is the 6-vs-30 bug shape that started this).
  // Middleware is optional - if not provided, skip these checks
  if (middleware) {
    if (!middleware.includes('from "../scripts/landing-registry.mjs"')) {
      failures.push(
        "functions/_middleware.js: missing landing registry import (must derive its map from scripts/landing-registry.mjs)",
      );
    }
    if (!middleware.includes("Object.fromEntries")) {
      failures.push(
        "functions/_middleware.js: landing mapping must be derived (Object.fromEntries over LOCALIZED_LANDING_CODES)",
      );
    }

    if (!middleware.includes("export function pickLandingLang")) {
      failures.push("functions/_middleware.js: missing pickLandingLang export");
    }
    if (!middleware.includes("export async function onRequest")) {
      failures.push("functions/_middleware.js: missing onRequest export");
    }
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

  // Middleware is optional - if not provided, skip these checks
  if (middleware) {
    if (!middleware.includes("export function pickPreferenceCookie")) {
      failures.push("functions/_middleware.js: missing pickPreferenceCookie export");
    }
    if (!middleware.includes("export function landingForLang")) {
      failures.push("functions/_middleware.js: missing landingForLang export");
    }
    if (!middleware.includes('"nf_lang"')) {
      failures.push("functions/_middleware.js: missing nf_lang cookie (Netlify override)");
    }
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
    // The dropdown's language SET must equal the registry: a stale literal is
    // the 6-vs-30 drift shape (landing.js was ahead of the edge once; the
    // inverse would strand locales from the dropdown). Set-based, order-free.
    const codesMatch = landingJs.match(/LANG_CODES\s*=\s*\[([^\]]*)\]/);
    if (!codesMatch) {
      failures.push("public/landing.js: LANG_CODES list missing");
    } else {
      const codes = codesMatch[1]
        .split(",")
        .map((c) => c.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
      for (const c of REGISTRY_ALL_CODES) {
        if (!codes.includes(c)) {
          failures.push(
            `public/landing.js: LANG_CODES missing "${c}" (registry has ${REGISTRY_ALL_CODES.length} locales)`,
          );
        }
      }
      for (const c of codes) {
        if (!REGISTRY_ALL_CODES.includes(c)) {
          failures.push(`public/landing.js: LANG_CODES has unknown "${c}"`);
        }
      }
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

function readOrFail(rel, failures, optional = false) {
  const path = join(ROOT, rel);
  try {
    return readFileSync(path, "utf8");
  } catch {
    if (!optional) {
      failures.push(`${rel}: missing`);
    }
    return optional ? undefined : "";
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
  // correct clean-path targets, and each page links its own version.
  const landingLangPages = {};
  for (const cfg of LANDING_PAGES) {
    landingLangPages[cfg.lang] = readOrFail(cfg.file, failures);
  }
  const langLinkFailures = validateLandingLangLinks({ pages: landingLangPages });
  if (langLinkFailures.length > 0) {
    failures.push(...langLinkFailures);
  } else {
    console.log(
      `${TAG} ok  landing language links (lang+hreflang on all 6, clean-path targets, own version linked) in ${Object.keys(landingLangPages).length} languages`,
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
    middleware: readOrFail("functions/_middleware.js", failures, true),
    netlifyToml: readOrFail("netlify.toml", failures),
    landingJs: readOrFail("public/landing.js", failures),
  });
  if (languageFailures.length > 0) {
    failures.push(...languageFailures);
  } else {
    console.log(
      `${TAG} ok  language negotiation + manual preference (nginx.conf + functions/_middleware.js + netlify.toml + landing.js, 302 to all ${LANDING_LANG_CODES.length} localized landings)`,
    );
  }

  const legalTranslationFailures = validateLegalTranslationCoverage({
    translationsJson: readOrFail("scripts/privacy-translations.json", failures),
  });
  if (legalTranslationFailures.length > 0) {
    failures.push(...legalTranslationFailures);
  } else {
    console.log(
      `${TAG} ok  legal translations cover every generated legal page ` +
        `(${REGISTRY_LEGAL_CODES.length} reviewed by hand)`,
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