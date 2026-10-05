import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUX_PAGES,
  DEFAULT_OG_IMAGE,
  LANDING_LANG_CODES,
  LANDING_PAGES,
  LANG_LINK_HREFS,
  LEGAL_PAGES,
  OG_IMAGE_POLICY,
  SINGLE_PAGES,
  metaContent,
  ogImageForFile,
  runCheck,
  validateAuxHtml,
  validateLandingHtml,
  validateLandingLangLinks,
  validateLanguageNegotiation,
  validateLegalTranslationCoverage,
  validateLegalTerms,
  validateNoindexContent,
  validateSearchAction,
} from "../check-seo.mjs";
import {
  pickLandingLang,
  pickPreferenceCookie,
  landingForLang,
} from "../../functions/_middleware.js";

/**
 * The landing cluster is 30 locales + x-default, so the fixture derives its
 * alternate set from the gate's own registry instead of hand-listing it: a
 * locale joining LANDING_PAGES must not be able to invalidate every fixture
 * test at once. The literal 30-locale set is pinned once, in "declares the
 * full 30-language hreflang set" below — that is where the contract belongs.
 */
const LANDING_ALTERNATES = LANDING_PAGES[0].alternates;

/**
 * Fixture alternates: the page's own hreflang points at `canonical`, es at
 * `esHref` (the mutation target), and every other locale at its registry href.
 */
function fixtureAlternates(lang, canonical, esHref) {
  return LANDING_ALTERNATES.map((a) => {
    if (a.hreflang === lang) return { ...a, href: canonical };
    if (a.hreflang === "es") return { ...a, href: esHref };
    return a;
  });
}

/**
 * A locale has its own share card only once that card is actually localized:
 * the 30-locale expansion pre-staged public/og-image-<lang>.png for 24 locales
 * as byte-identical copies of the general card, and those pages must keep the
 * general card — a copy under a localized filename would advertise a
 * localization that does not exist. Localizing a card therefore also means
 * adding the locale to OG_IMAGE_POLICY; the loop below enforces the pair.
 */
function hasLocalizedCard(lang) {
  try {
    return !readFileSync(`public/og-image-${lang}.png`).equals(
      readFileSync("public/og-image.png"),
    );
  } catch {
    return false;
  }
}

/**
 * Minimal-but-complete landing page matching the gate's contract, so each
 * test can mutate exactly one piece and assert the gate catches it.
 */
function buildValidPage(overrides = {}) {
  const canonical = overrides.canonical ?? "https://bookmarkforgeapp.com/";
  const lang = overrides.lang ?? "en";
  const locale = overrides.locale ?? "en_US";
  const alternateLocale = overrides.alternateLocale ?? "es_ES";
  const esHref = overrides.esHref ?? "https://bookmarkforgeapp.com/es/";
  const ogImage = overrides.ogImage ?? "https://bookmarkforgeapp.com/og-image.png";
  const alternates = overrides.alternates ?? fixtureAlternates(lang, canonical, esHref);
  const alternateTags = alternates
    .map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}">`)
    .join("\n");    const jsonLd = overrides.jsonLd ?? `
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "url": "${canonical}",
        "potentialAction": {
          "@type": "SearchAction",
          "target": { "@type": "EntryPoint", "urlTemplate": "${canonical}?s={search_term_string}" },
          "query-input": "required name=search_term_string"
        }
      },
      { "@type": "Organization", "url": "${canonical}" },
      { "@type": "SoftwareApplication", "url": "${canonical}" },
      { "@type": "FAQPage", "mainEntity": [
        { "@type": "Question", "name": "Q?", "acceptedAnswer": { "@type": "Answer", "text": "A." } }
      ]}
    ]
  }`;
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="description" content="desc">
  <title>Title</title>
  <link rel="canonical" href="${canonical}">
${alternateTags}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="BookmarkForge">
  <meta property="og:title" content="Title">
  <meta property="og:description" content="desc">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="${locale}">
  <meta property="og:locale:alternate" content="${alternateLocale}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Title">
  <meta name="twitter:description" content="desc">
  <meta name="twitter:image" content="${ogImage}">
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body></body>
</html>`;
}

const CFG = LANDING_PAGES[0];
const SITE_URL = new URL(DEFAULT_OG_IMAGE).origin;

function validLanguageNegotiation(overrides = {}) {
  // Every locale is derived from the gate's own registry instead of a
  // hand-written five: a new locale must never be able to invalidate these
  // drift tests (it did — every one of them went red on the 30-locale
  // expansion), and the fixture can no longer pass while the real nginx /
  // middleware / netlify lists stay behind. The literal, full 30-locale
  // contract is pinned exactly once, by "passes against the real repo".
  const langs = LANDING_LANG_CODES;
  const prefLangs = ["en", ...langs];
  const cookieAttrs = "Path=/; Max-Age=31536000; SameSite=Lax; Secure";
  const langLocation = (lang) =>
    `    location = /_lang/${lang} {\n` +
    `        internal;\n` +
    `        add_header Set-Cookie "bf_lang=${lang}; ${cookieAttrs}" always;\n` +
    `        add_header Set-Cookie "nf_lang=${lang}; ${cookieAttrs}" always;\n` +
    `        return 302 ${lang === "en" ? "/" : `/${lang}/`};\n` +
    `    }`;
  return {
    nginxConf: `
    location = / {
        if ($http_upgrade != "") {
            rewrite ^ /_ws_ last;
        }
${prefLangs.map((lang) => `        if ($arg_lang ~* "^${lang}$") { rewrite ^ /_lang/${lang} last; }`).join("\n")}
${langs.map((lang) => `        if ($cookie_bf_lang ~* "^${lang}$") { rewrite ^ /${lang}/ redirect; }`).join("\n")}
        if ($cookie_bf_lang = "") {
            rewrite ^ /_negotiate last;
        }
        rewrite ^ /landing.html last;
    }

    location = /_negotiate {
        internal;
${langs.map((lang) => `        if ($http_accept_language ~* "^${lang}") { rewrite ^ /${lang}/ redirect; }`).join("\n")}
        rewrite ^ /landing.html last;
    }

${prefLangs.map(langLocation).join("\n\n")}
`,
    middleware: `
import {
  LOCALIZED_LANDING_CODES,
  PREF_LANGS,
} from "../scripts/landing-registry.mjs";
const LANDING_BY_LANG = Object.fromEntries(
  LOCALIZED_LANDING_CODES.map((code) => [code, "/" + code + "/"]),
);
export function pickLandingLang(acceptLanguage) {
  return null;
}
export function pickPreferenceCookie(cookieHeader) {
  return null;
}
export function landingForLang(lang) {
  return null;
}
export async function onRequest(context) {
  const res = Response.redirect("/", 302);
  res.headers.append("Set-Cookie", "bf_lang=en");
  res.headers.append("Set-Cookie", "nf_lang=en");
  return res;
}
`,
    landingJs: `
function setLangPreference(lang) {
  document.cookie = "bf_lang=" + lang;
  document.cookie = "nf_lang=" + lang;
}
const params = new URLSearchParams(window.location.search);
`,
    netlifyToml: `
${langs.map((lang) => `[[redirects]]\n  from = "/"\n  to = "/${lang}/"\n  status = 302\n  conditions = { Language = ["${lang}"] }`).join("\n\n")}

[[redirects]]
  from = "/"
  to = "/landing.html"
  status = 200
`,
    ...overrides,
  };
}

/**
 * Minimal auxiliary page (SPA shell / 404) matching the gate's contract,
 * so each test can mutate exactly one piece and assert the gate catches it.
 */
function buildValidAuxPage(overrides = {}) {
  const canonical = overrides.canonical ?? "https://bookmarkforgeapp.com/404.html";
  const siteName = overrides.siteName ?? "BookmarkForge";
  const ogImage = overrides.ogImage ?? "https://bookmarkforgeapp.com/og-image.png";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="description" content="desc">
  <title>Aux</title>
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${siteName}">
  <meta property="og:title" content="Aux">
  <meta property="og:description" content="desc">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="en_US">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Aux">
  <meta name="twitter:description" content="desc">
  <meta name="twitter:image" content="${ogImage}">
</head>
<body></body>
</html>`;
}

const AUX_CFG = {
  file: "public/404.html",
  canonical: "https://bookmarkforgeapp.com/404.html",
  siteName: "BookmarkForge",
  ogImage: "https://bookmarkforgeapp.com/og-image.png",
};

/** Sitemap matching the gate's contract: all 6 landing locales with the
 *  full xhtml:link hreflang set (6 languages + x-default), plus the
 *  single-language pages. */
function buildValidSitemap() {
  const landingPaths = ["/", "/es/", "/fr/", "/de/", "/pt/", "/it/"];
  const linkLangs = [
    ["en", "https://bookmarkforgeapp.com/"],
    ["es", "https://bookmarkforgeapp.com/es/"],
    ["fr", "https://bookmarkforgeapp.com/fr/"],
    ["de", "https://bookmarkforgeapp.com/de/"],
    ["pt", "https://bookmarkforgeapp.com/pt/"],
    ["it", "https://bookmarkforgeapp.com/it/"],
    ["x-default", "https://bookmarkforgeapp.com/"],
  ];
  const landingUrlXml = (path) =>
    `<url>\n    <loc>https://bookmarkforgeapp.com${path}</loc>\n${linkLangs
      .map(([h, href]) => `    <xhtml:link rel="alternate" hreflang="${h}" href="${href}" />`)
      .join("\n")}\n  </url>`;
  // The legal pages form their own 6-language cluster: every legal <url>
  // carries the same annotation set (x-default → the EN legal page).
  const legalPaths = [
    "/privacy-and-terms.html",
    "/es/privacy-and-terms.html",
    "/fr/privacy-and-terms.html",
    "/de/privacy-and-terms.html",
    "/pt/privacy-and-terms.html",
    "/it/privacy-and-terms.html",
  ];
  const legalLinkLangs = legalPaths.map((p) => [
    p === "/privacy-and-terms.html" ? "en" : p.split("/")[1],
    `https://bookmarkforgeapp.com${p}`,
  ]);
  legalLinkLangs.push(["x-default", "https://bookmarkforgeapp.com/privacy-and-terms.html"]);
  const legalUrlXml = (path) =>
    `<url>\n    <loc>https://bookmarkforgeapp.com${path}</loc>\n${legalLinkLangs
      .map(([h, href]) => `    <xhtml:link rel="alternate" hreflang="${h}" href="${href}" />`)
      .join("\n")}\n  </url>`;
  return [
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...landingPaths.map(landingUrlXml),
    "<url><loc>https://bookmarkforgeapp.com/pocket-alternative</loc></url>",
    ...legalPaths.map(legalUrlXml),
    "</urlset>",
  ].join("\n");
}

function validNoindexContent(overrides = {}) {
  return {
    headers: [
      "/app\n  X-Robots-Tag: noindex",
      "/app/*\n  X-Robots-Tag: noindex",
      "/capture\n  X-Robots-Tag: noindex",
      "/capture/*\n  X-Robots-Tag: noindex",
      "/offline*\n  X-Robots-Tag: noindex",
    ].join("\n"),
    toml: [
      '[[headers]]\n  for = "/app"\n  [headers.values]\n    X-Robots-Tag = "noindex"',
      '[[headers]]\n  for = "/app/*"\n  [headers.values]\n    X-Robots-Tag = "noindex"',
      '[[headers]]\n  for = "/capture"\n  [headers.values]\n    X-Robots-Tag = "noindex"',
      '[[headers]]\n  for = "/capture/*"\n  [headers.values]\n    X-Robots-Tag = "noindex"',
      '[[headers]]\n  for = "/offline*"\n  [headers.values]\n    X-Robots-Tag = "noindex"',
    ].join("\n"),
    robots: [
      "User-agent: *",
      "Allow: /",
      "Disallow: /app",
      "Disallow: /capture",
      "Disallow: /offline",
      "Disallow: /api",
    ].join("\n"),
    offlineHtml: '<meta name="robots" content="noindex, follow">',
    sitemapXml: buildValidSitemap(),
    ...overrides,
  };
}

describe("check-seo gate", () => {
  it("passes against the real repo", () => {
    expect(runCheck()).toEqual([]);
  });

  it("pickLandingLang maps the browser's primary language to the landing", () => {
    expect(pickLandingLang("fr")).toBe("/fr/");
    expect(pickLandingLang("fr-FR,fr;q=0.9,en;q=0.8")).toBe("/fr/");
    expect(pickLandingLang("DE-de,en;q=0.9")).toBe("/de/");
    expect(pickLandingLang("ES")).toBe("/es/");
    expect(pickLandingLang("pt-PT")).toBe("/pt/");
    expect(pickLandingLang("it-IT,it;q=0.9")).toBe("/it/");
    expect(pickLandingLang("ja;q=0.9")).toBe("/ja/");
    // English and unknown languages stay on the EN landing at /.
    expect(pickLandingLang("en-US,en;q=0.9,fr;q=0.8")).toBeNull();
    expect(pickLandingLang("xx;q=0.9")).toBeNull();
    expect(pickLandingLang(null)).toBeNull();
    expect(pickLandingLang("")).toBeNull();
    // q-value sorting: the FIRST listed language is the primary one.
    expect(pickLandingLang("fr;q=0.5,es;q=0.9")).toBe("/fr/");
  });

  it("pickPreferenceCookie reads the bf_lang cookie", () => {
    expect(pickPreferenceCookie("bf_lang=fr")).toBe("fr");
    expect(pickPreferenceCookie("theme=dark; bf_lang=en")).toBe("en");
    expect(pickPreferenceCookie("bf_lang=FR; theme=dark")).toBe("fr");
    expect(pickPreferenceCookie("bf_lang = de ")).toBe("de");
    expect(pickPreferenceCookie("bf_lang=ja")).toBe("ja");
    expect(pickPreferenceCookie("bf_lang=ZH")).toBe("zh");
    expect(pickPreferenceCookie("bf_lang=xx")).toBeNull();
    expect(pickPreferenceCookie("theme=dark")).toBeNull();
    expect(pickPreferenceCookie("")).toBeNull();
    expect(pickPreferenceCookie(null)).toBeNull();
  });

  it("landingForLang maps every preference language to its URL", () => {
    expect(landingForLang("en")).toBe("/");
    expect(landingForLang("fr")).toBe("/fr/");
    expect(landingForLang("es")).toBe("/es/");
    expect(landingForLang("de")).toBe("/de/");
    expect(landingForLang("pt")).toBe("/pt/");
    expect(landingForLang("it")).toBe("/it/");
    expect(landingForLang("ja")).toBe("/ja/");
    expect(landingForLang("xx")).toBeNull();
  });

  it("honours the preference and the negotiation for every shipped locale", () => {
    // The whole bug class in one assertion. The 30-language dropdown wrote a
    // bf_lang cookie that the middleware only knew for 6 locales, so picking
    // 日本語 or 中文 worked until the next visit to "/", where the choice was
    // silently dropped. Every locale the site ships must round-trip through
    // all three helpers — no subset, no "choosable but unnegotiable".
    for (const lang of LANDING_LANG_CODES) {
      expect(pickLandingLang(`${lang}-XX,${lang};q=0.9`)).toBe(`/${lang}/`);
      expect(landingForLang(lang)).toBe(`/${lang}/`);
      expect(pickPreferenceCookie(`theme=dark; bf_lang=${lang}`)).toBe(lang);
    }
    // EN is the root landing, not a redirect target: it never negotiates,
    // but a preference for it is valid and means "stop negotiating".
    expect(pickLandingLang("en-US,en;q=0.9")).toBeNull();
    expect(landingForLang("en")).toBe("/");
    expect(pickPreferenceCookie("bf_lang=en")).toBe("en");
    // The registry the helpers are written against: 29 localized landings,
    // 30 with EN — a locale added to one side only turns this red.
    expect(LANDING_LANG_CODES.length + 1).toBe(LANDING_PAGES.length);
  });

  it("accepts a fully-compliant synthetic landing page", () => {
    expect(validateLandingHtml(buildValidPage(), CFG)).toEqual([]);
  });

  it("flags a missing canonical and a wrong hreflang=es target", () => {
    const html = buildValidPage({
      esHref: "https://bookmarkforgeapp.com/fr/",
    }).replace(/<link rel="canonical"[^>]*>\n/, "");
    const fails = validateLandingHtml(html, CFG);
    expect(fails.some((f) => f.includes("canonical"))).toBe(true);
    expect(fails.some((f) => f.includes('hreflang="es"'))).toBe(true);
  });

  it("flags missing og:image and a broken og:image asset", () => {
    const noImage = buildValidPage().replace(
      /<meta property="og:image" content="[^"]*">\n/m,
      "",
    );
    const fails = validateLandingHtml(noImage, CFG);
    expect(fails.some((f) => f.includes("og:image missing"))).toBe(true);

    const broken = buildValidPage({ ogImage: "https://bookmarkforgeapp.com/gone.png" });
    const failsBroken = validateLandingHtml(broken, {
      ...CFG,
      assetExists: (rel) => rel !== "gone.png",
    });
    expect(failsBroken.some((f) => f.includes("asset missing"))).toBe(true);
  });

  it("rejects invalid JSON-LD and missing schema types", () => {
    const bad = buildValidPage({ jsonLd: "{ not json" });
    const fails = validateLandingHtml(bad, CFG);
    expect(fails.some((f) => f.includes("invalid JSON-LD"))).toBe(true);

    const noTypes = buildValidPage({
      jsonLd: '{ "@context": "https://schema.org", "@graph": [] }',
    });
    const failsTypes = validateLandingHtml(noTypes, CFG);
    for (const type of ["WebSite", "Organization", "SoftwareApplication", "FAQPage"]) {
      expect(failsTypes.some((f) => f.includes(`missing @type "${type}"`))).toBe(true);
    }
  });

  it("flags an FAQPage without real questions", () => {
    const html = buildValidPage({
      jsonLd: '{ "@context": "https://schema.org", "@graph": [ { "@type": "FAQPage", "mainEntity": [] } ] }',
    });
    const fails = validateLandingHtml(html, CFG);
    expect(fails.some((f) => f.includes("FAQPage must list Question"))).toBe(true);
  });

  it("flags a WebSite node missing SearchAction", () => {
    const noSearchAction = buildValidPage({
      jsonLd: `
  {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "url": "https://bookmarkforgeapp.com/" },
      { "@type": "Organization", "url": "https://bookmarkforgeapp.com/" },
      { "@type": "SoftwareApplication", "url": "https://bookmarkforgeapp.com/" },
      { "@type": "FAQPage", "mainEntity": [
        { "@type": "Question", "name": "Q?", "acceptedAnswer": { "@type": "Answer", "text": "A." } }
      ]}
    ]
  }`,
    });
    const fails = validateLandingHtml(noSearchAction, CFG);
    expect(fails.some((f) => f.includes("SearchAction")));
  });

  it("accepts a WebSite node with a valid SearchAction", () => {
    const goodSearchAction = buildValidPage({
      jsonLd: `
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "url": "https://bookmarkforgeapp.com/",
        "potentialAction": {
          "@type": "SearchAction",
          "target": { "@type": "EntryPoint", "urlTemplate": "https://bookmarkforgeapp.com/?s={search_term_string}" },
          "query-input": "required name=search_term_string"
        }
      },
      { "@type": "Organization", "url": "https://bookmarkforgeapp.com/" },
      { "@type": "SoftwareApplication", "url": "https://bookmarkforgeapp.com/" },
      { "@type": "FAQPage", "mainEntity": [
        { "@type": "Question", "name": "Q?", "acceptedAnswer": { "@type": "Answer", "text": "A." } }
      ]}
    ]
  }`,
    });
    expect(validateLandingHtml(goodSearchAction, CFG)).toEqual([]);
  });

  it("validates SearchAction via the exported helper", () => {
    // No WebSite node: no failure (delegated to other JSON-LD checks).
    expect(validateSearchAction([{ "@type": "Organization" }])).toEqual([]);

    // WebSite present, no potentialAction.
    const noPa = [
      { "@type": "WebSite", "url": "https://bookmarkforgeapp.com/" },
      { "@type": "Organization", "url": "https://bookmarkforgeapp.com/" },
    ];
    expect(validateSearchAction(noPa).some((f) => f.includes("SearchAction"))).toBe(true);

    // potentialAction present but wrong type.
    const wrongType = [
      { "@type": "WebSite", "url": "https://bookmarkforgeapp.com/", "potentialAction": { "@type": "SomethingElse" } },
    ];
    expect(validateSearchAction(wrongType).some((f) => f.includes('"SomethingElse"'))).toBe(true);

    // SearchAction present but missing urlTemplate.
    const noUrl = [
      { "@type": "WebSite", "url": "https://bookmarkforgeapp.com/", "potentialAction": { "@type": "SearchAction" } },
    ];
    expect(validateSearchAction(noUrl).some((f) => f.includes("urlTemplate"))).toBe(true);

    // SearchAction present but missing query-input.
    const noQuery = [
      { "@type": "WebSite", "url": "https://bookmarkforgeapp.com/", "potentialAction": { "@type": "SearchAction", "target": { "@type": "EntryPoint", "urlTemplate": "https://bookmarkforgeapp.com/?s=q" } } },
    ];
    expect(validateSearchAction(noQuery).some((f) => f.includes("query-input"))).toBe(true);

    // Fully valid SearchAction.
    const valid = [
      { "@type": "WebSite", "url": "https://bookmarkforgeapp.com/", "potentialAction": {
        "@type": "SearchAction",
        "target": { "@type": "EntryPoint", "urlTemplate": "https://bookmarkforgeapp.com/?s={search_term_string}" },
        "query-input": "required name=search_term_string"
      }},
    ];
    expect(validateSearchAction(valid)).toEqual([]);
  });

  it("flags a twitter card that is not summary_large_image", () => {
    const html = buildValidPage().replace(
      'content="summary_large_image"',
      'content="summary"',
    );
    const fails = validateLandingHtml(html, CFG);
    expect(fails.some((f) => f.includes("twitter:card"))).toBe(true);
  });

  it("declares the full 30-language hreflang set on every landing page", () => {
    // Kept literal on purpose (not derived from LANDING_PAGES): this is the
    // one place the cluster's membership is pinned, so a locale joining or
    // leaving it has to be acknowledged here.
    const expected = new Set([
      "en", "ar", "bg", "cs", "da", "de", "el", "es", "fi", "fr",
      "he", "hi", "hr", "hu", "id", "it", "ja", "ko", "nl", "no",
      "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "zh",
      "x-default",
    ]);
    for (const cfg of LANDING_PAGES) {
      const langs = new Set(cfg.alternates.map((a) => a.hreflang));
      expect(langs, cfg.file).toEqual(expected);
      for (const alt of cfg.alternates) {
        expect(alt.href, `${cfg.file} ${alt.hreflang}`).toMatch(/^https:\/\/bookmarkforgeapp.com\//);
      }
    }
  });

  it("accepts fully-compliant auxiliary pages (SPA shell and 404)", () => {
    expect(validateAuxHtml(buildValidAuxPage(), AUX_CFG)).toEqual([]);
    const shellCfg = { ...AUX_CFG, file: "index.html", canonical: "https://bookmarkforgeapp.com/" };
    expect(
      validateAuxHtml(
        buildValidAuxPage({ canonical: "https://bookmarkforgeapp.com/" }),
        shellCfg,
      ),
    ).toEqual([]);
  });

  it("flags auxiliary pages missing canonical or with mismatched og:url", () => {
    const noCanonical = buildValidAuxPage().replace(/<link rel="canonical"[^>]*>\n/, "");
    expect(
      validateAuxHtml(noCanonical, AUX_CFG).some((f) => f.includes("canonical")),
    ).toBe(true);

    const noOgUrl = buildValidAuxPage().replace(/<meta property="og:url"[^>]*>\n/, "");
    expect(
      validateAuxHtml(noOgUrl, AUX_CFG).some((f) => f.includes("og:url must match")),
    ).toBe(true);

    const wrongUrl = buildValidAuxPage().replace(
      'og:url" content="https://bookmarkforgeapp.com/404.html"',
      'og:url" content="https://bookmarkforgeapp.com/other"',
    );
    expect(
      validateAuxHtml(wrongUrl, AUX_CFG).some((f) => f.includes("og:url must match")),
    ).toBe(true);
  });

  it("flags auxiliary pages whose brand identity drifts from the landing", () => {
    const wrongImage = buildValidAuxPage({ ogImage: "https://bookmarkforgeapp.com/other.png" });
    const imageFails = validateAuxHtml(wrongImage, AUX_CFG);
    expect(imageFails.some((f) => f.includes("og:image must match the landing"))).toBe(true);

    const wrongSite = buildValidAuxPage({ siteName: "OtherBrand" });
    expect(
      validateAuxHtml(wrongSite, AUX_CFG).some((f) => f.includes("og:site_name must match")),
    ).toBe(true);
  });

  it("flags auxiliary pages with no OG or Twitter meta at all", () => {
    const noOg = buildValidAuxPage().replace(/<meta property="og:[^>]*>\n/g, "");
    const fails = validateAuxHtml(noOg, AUX_CFG);
    expect(fails.some((f) => f.includes("og:type missing"))).toBe(true);
    expect(fails.some((f) => f.includes("og:image missing"))).toBe(true);

    const noTwitter = buildValidAuxPage().replace(/<meta name="twitter:[^>]*>\n/g, "");
    expect(
      validateAuxHtml(noTwitter, AUX_CFG).some((f) => f.includes("twitter:card")),
    ).toBe(true);
  });

  it("validates the 6-language legal pages without requiring JSON-LD", () => {
    const legalCfg = LEGAL_PAGES[0];
    const noJsonLd = buildValidPage({
      canonical: legalCfg.canonical,
      alternates: legalCfg.alternates,
      jsonLd: `
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "url": "${legalCfg.canonical}",
        "potentialAction": {
          "@type": "SearchAction",
          "target": { "@type": "EntryPoint", "urlTemplate": "${legalCfg.canonical}?s={search_term_string}" },
          "query-input": "required name=search_term_string"
        }
      },
      { "@type": "Organization", "url": "${legalCfg.canonical}" },
      { "@type": "SoftwareApplication", "url": "${legalCfg.canonical}" },
      { "@type": "FAQPage", "mainEntity": [
        { "@type": "Question", "name": "Q?", "acceptedAnswer": { "@type": "Answer", "text": "A." } }
      ]}
    ]
  }`,
    }).replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\n/, "");
    expect(validateLandingHtml(noJsonLd, legalCfg, { requireJsonLd: false })).toEqual([]);

    // Under the landing profile (default) the missing JSON-LD is caught.
    expect(
      validateLandingHtml(noJsonLd, legalCfg).some((f) =>
        f.includes("no application/ld+json block"),
      ),
    ).toBe(true);

    // Legal pages must still carry the full hreflang set.
    const missingHreflang = noJsonLd.replace(
      /<link rel="alternate" hreflang="es"[^>]*>\n/,
      "",
    );
    expect(
      validateLandingHtml(missingHreflang, legalCfg, { requireJsonLd: false }).some((f) =>
        f.includes('hreflang="es"'),
      ),
    ).toBe(true);
  });

  it("declares all six legal pages with the full hreflang set", () => {
    expect(LEGAL_PAGES).toHaveLength(6);
    for (const cfg of LEGAL_PAGES) {
      expect(cfg.alternates.map((a) => a.hreflang).sort()).toEqual([
        "de",
        "en",
        "es",
        "fr",
        "it",
        "pt",
        "x-default",
      ]);
      expect(cfg.canonical).toMatch(/^https:\/\/bookmarkforgeapp.com\/([a-z]{2}\/)?privacy-and-terms\.html$/);
    }
  });

  it("requires every legal page URL in the sitemap", () => {
    const base = validNoindexContent().sitemapXml;
    const noLegal = validNoindexContent({
      sitemapXml: base.replace(
        /<url>\n    <loc>https:\/\/bookmarkforgeapp.com\/es\/privacy-and-terms\.html<\/loc>[\s\S]*?<\/url>\n/,
        "",
      ),
    });
    expect(
      validateNoindexContent(noLegal).some((f) =>
        f.includes("missing legal /es/privacy-and-terms.html"),
      ),
    ).toBe(true);
  });

  it("declares the two auxiliary pages with their canonical targets", () => {
    expect(AUX_PAGES.map((p) => p.file).sort()).toEqual([
      "index.html",
      "public/404.html",
    ]);
    expect(AUX_PAGES.find((p) => p.file === "index.html").canonical).toBe(
      "https://bookmarkforgeapp.com/",
    );
    expect(AUX_PAGES.find((p) => p.file === "public/404.html").canonical).toBe(
      "https://bookmarkforgeapp.com/404.html",
    );
  });

  it("validates the single-language comparison page", () => {
    const cfg = SINGLE_PAGES[0];
    const html = buildValidPage({
      canonical: cfg.canonical,
      alternates: [],
      ogImage: ogImageForFile(cfg.file),
    });
    expect(validateLandingHtml(html, cfg)).toEqual([]);

    const noCanonical = html.replace(/<link rel="canonical"[^>]*>\n/, "");
    expect(validateLandingHtml(noCanonical, cfg).length).toBeGreaterThan(0);
  });

  it("flags the ES page locale contract", () => {
    // Found by lang, not by index: the registry is alphabetical now, so
    // LANDING_PAGES[1] is ar, not es.
    const esCfg = LANDING_PAGES.find((p) => p.lang === "es");
    const es = buildValidPage({
      lang: "es",
      locale: "es_ES",
      alternateLocale: "en_US",
      canonical: "https://bookmarkforgeapp.com/es/",
      ogImage: ogImageForFile("public/es.html"),
    });
    expect(validateLandingHtml(es, esCfg)).toEqual([]);
    expect(validateLandingHtml(es, CFG).length).toBeGreaterThan(0);
  });

  it("flags every language-negotiation drift source", () => {
    const base = validLanguageNegotiation();

    // nginx: one language match removed and one redirect downgraded to 301
    // (both the cookie and the negotiate copies).
    const nginxDrift = validLanguageNegotiation({
      nginxConf: base.nginxConf
        .replace('if ($http_accept_language ~* "^fr") { rewrite ^ /fr/ redirect; }', "")
        .replace(/rewrite \^ \/es\/ redirect;/g, "rewrite ^ /es/ permanent;"),
    });
    const nginxFails = validateLanguageNegotiation(nginxDrift);
    expect(nginxFails.some((f) => f.includes("^fr"))).toBe(true);
    expect(nginxFails.some((f) => f.includes("302 redirect to /es/"))).toBe(true);

    // nginx preference drift: cookie rule, ?lang= rule and /_lang location
    // removed, and the empty-cookie guard dropped.
    const prefDrift = validLanguageNegotiation({
      nginxConf: base.nginxConf
        .replace('if ($cookie_bf_lang ~* "^fr$") { rewrite ^ /fr/ redirect; }', "")
        .replace('if ($arg_lang ~* "^en$") { rewrite ^ /_lang/en last; }', "")
        .replace(
          '    location = /_lang/fr {\n        internal;\n        add_header Set-Cookie "bf_lang=fr; Path=/; Max-Age=31536000; SameSite=Lax; Secure" always;\n        add_header Set-Cookie "nf_lang=fr; Path=/; Max-Age=31536000; SameSite=Lax; Secure" always;\n        return 302 /fr/;\n    }\n\n',
          "",
        )
        .replace('if ($cookie_bf_lang = "") {', 'if ($cookie_bf_lang = "xx") {'),
    });
    const prefFails = validateLanguageNegotiation(prefDrift);
    expect(prefFails.some((f) => f.includes("bf_lang cookie rule for ^fr$"))).toBe(true);
    expect(prefFails.some((f) => f.includes("?lang= rule for ^en$"))).toBe(true);
    expect(prefFails.some((f) => f.includes("location /_lang/fr"))).toBe(true);
    expect(prefFails.some((f) => f.includes("empty-cookie guard"))).toBe(true);

    // middleware: mapping removed, onRequest dropped, preference helpers
    // and the Netlify override cookie removed.
    const middlewareDrift = validLanguageNegotiation({
      middleware: base.middleware
        .replace('} from "../scripts/landing-registry.mjs";', '} from "../scripts/nowhere.mjs";')
        .replace("Object.fromEntries", "Object_fromEntries")
        .replace("export async function onRequest", "async function onRequest")
        .replace("export function pickPreferenceCookie", "function pickPreferenceCookie")
        .replace("export function landingForLang", "function landingForLang")
        .replace('res.headers.append("Set-Cookie", "nf_lang=en");', ""),
    });
    const middlewareFails = validateLanguageNegotiation(middlewareDrift);
    expect(middlewareFails.some((f) => f.includes("landing registry import"))).toBe(true);
    expect(middlewareFails.some((f) => f.includes("must be derived"))).toBe(true);
    expect(middlewareFails.some((f) => f.includes("onRequest export"))).toBe(true);
    expect(middlewareFails.some((f) => f.includes("pickPreferenceCookie export"))).toBe(true);
    expect(middlewareFails.some((f) => f.includes("landingForLang export"))).toBe(true);
    expect(middlewareFails.some((f) => f.includes("missing nf_lang cookie"))).toBe(true);

    // landing.js: preference helper and Netlify cookie removed.
    const jsDrift = validLanguageNegotiation({
      landingJs: base.landingJs.replace("document.cookie = \"nf_lang=\" + lang;", ""),
    });
    const jsFails = validateLanguageNegotiation(jsDrift);
    expect(jsFails.some((f) => f.includes("landing.js"))).toBe(true);
    expect(jsFails.some((f) => f.includes("nf_lang cookie (Netlify override)"))).toBe(true);

    // netlify.toml: one rule dropped, one downgraded to 301, and one moved
    // after the 200 fallback (order matters — first matching rule wins).
    const tomlNoDe = base.netlifyToml.replace(
      '  to = "/de/"\n  status = 302\n  conditions = { Language = ["de"] }',
      "",
    );
    const tomlFails = validateLanguageNegotiation({
      nginxConf: base.nginxConf,
      middleware: base.middleware,
      netlifyToml: tomlNoDe,
    });
    expect(tomlFails.some((f) => f.includes("to /de/"))).toBe(true);

    const toml301 = base.netlifyToml.replace(
      '  to = "/it/"\n  status = 302',
      '  to = "/it/"\n  status = 301',
    );
    const toml301Fails = validateLanguageNegotiation({
      nginxConf: base.nginxConf,
      middleware: base.middleware,
      netlifyToml: toml301,
    });
    expect(toml301Fails.some((f) => f.includes("to /it/"))).toBe(true);

    const tomlMoved = base.netlifyToml
      .replace('  to = "/pt/"\n  status = 302\n  conditions = { Language = ["pt"] }\n\n', "")
      .replace(
        '  to = "/landing.html"\n  status = 200',
        '  to = "/landing.html"\n  status = 200\n\n[[redirects]]\n  from = "/"\n  to = "/pt/"\n  status = 302\n  conditions = { Language = ["pt"] }',
      );
    const tomlOrderFails = validateLanguageNegotiation({
      nginxConf: base.nginxConf,
      middleware: base.middleware,
      netlifyToml: tomlMoved,
    });
    expect(tomlOrderFails.some((f) => f.includes("must precede"))).toBe(true);
  });

  it("validates the key legal terminology per language", () => {
    const pages = {
      en: "GDPR ROPA opt-in Entitlement state",
      es: "RGPD ROPA opt-in responsable del tratamiento derecho de uso",
      fr: "RGPD ROPA opt-in responsable du traitement droit d'utilisation",
      de: "DSGVO ROPA Opt-in Verantwortlicher Berechtigungsstatus",
      pt: "RGPD ROPA opt-in responsável pelo tratamento direito de utilização",
      it: "GDPR ROPA opt-in titolare del trattamento diritto di utilizzo",
    };
    expect(validateLegalTerms({ pages })).toEqual([]);

    // Drift: jurisdiction acronym, controller term and the entitlement
    // phrase (the one that regressed into "rule of law") are all pinned.
    const wrongAcronym = { ...pages, de: pages.de.replace("DSGVO", "GDPR") };
    expect(validateLegalTerms({ pages: wrongAcronym }).some((f) => f.includes('"DSGVO"'))).toBe(true);

    const ruleOfLaw = { ...pages, es: pages.es.replace("derecho de uso", "Estado de derecho") };
    expect(
      validateLegalTerms({ pages: ruleOfLaw }).some((f) => f.includes('"derecho de uso"')),
    ).toBe(true);

    const missingController = { ...pages, it: pages.it.replace("titolare del trattamento", "responsabile") };
    expect(
      validateLegalTerms({ pages: missingController }).some((f) =>
        f.includes('"titolare del trattamento"'),
      ),
    ).toBe(true);

    // Missing language content is flagged too.
    const noFr = { ...pages };
    delete noFr.fr;
    expect(validateLegalTerms({ pages: noFr }).some((f) => f.includes("missing content for fr"))).toBe(true);
  });

  it("validates the landing language links (lang + hreflang + ?lang=)", () => {
    const buildPage = (lang) => {
      // The visible nav/footer links mirror LANG_LINK_HREFS for all 30
      // locales, so the fixture is built from that registry.
      const all = Object.entries(LANG_LINK_HREFS);
      const links = all
        .map(
          ([l, href]) =>
            `<a href="${href}" hreflang="${l}" lang="${l}">${l}</a>`,
        )
        .join("\n");
      return `<html lang="${lang}"><body><nav>${links}</nav><footer>${links}</footer></body></html>`;
    };
    const pages = {
      en: buildPage("en"),
      es: buildPage("es"),
      fr: buildPage("fr"),
      de: buildPage("de"),
    };
    expect(validateLandingLangLinks({ pages })).toEqual([]);

    // One link missing its lang attribute.
    const noLangAttr = { ...pages, fr: pages.fr.replace('hreflang="de" lang="de"', 'hreflang="de"') };
    expect(
      validateLandingLangLinks({ pages: noLangAttr }).some((f) =>
        f.includes('hreflang="de" link must carry lang="de"'),
      ),
    ).toBe(true);

    // One link without the ?lang= preference parameter.
    const noPref = { ...pages, es: pages.es.replace('href="/it/?lang=it"', 'href="/it/"') };
    expect(
      validateLandingLangLinks({ pages: noPref }).some((f) =>
        f.includes('hreflang="it" link must point to /it/?lang=it'),
      ),
    ).toBe(true);

    // One language missing from the visible links entirely (both nav and
    // footer copies must go).
    const noLang = {
      ...pages,
      en: pages.en.replace(/<a href="\/pt\/\?lang=pt" hreflang="pt" lang="pt">pt<\/a>\n?/g, ""),
    };
    expect(
      validateLandingLangLinks({ pages: noLang }).some((f) =>
        f.includes("missing visible language link for pt"),
      ),
    ).toBe(true);

    // A page not linking its own version (nav AND footer must both lose it).
    const noSelf = {
      ...pages,
      de: pages.de.replace(/href="\/de\/\?lang=de"/g, 'href="/de/"'),
    };
    expect(
      validateLandingLangLinks({ pages: noSelf }).some((f) =>
        f.includes("must link its own version at /de/?lang=de"),
      ),
    ).toBe(true);
  });

  it("flags every noindex drift source", () => {
    const appMissing = validNoindexContent({
      headers: validNoindexContent().headers.replace("/app\n  X-Robots-Tag: noindex", ""),
    });
    expect(
      validateNoindexContent(appMissing).some((f) => f.includes("noindex missing for /app")),
    ).toBe(true);

    const tomlMissing = validNoindexContent({
      toml: validNoindexContent().toml.replace('for = "/offline*"', 'for = "/gone*"'),
    });
    expect(
      validateNoindexContent(tomlMissing).some((f) => f.includes("netlify.toml")),
    ).toBe(true);

    const robotsMissing = validNoindexContent({
      robots: "User-agent: *\nAllow: /\n",
    });
    const robotsFails = validateNoindexContent(robotsMissing);
    for (const d of ["/app", "/capture", "/offline", "/api"]) {
      expect(robotsFails.some((f) => f.includes(`Disallow ${d}`))).toBe(true);
    }

    const offlineIndexable = validNoindexContent({ offlineHtml: "<title>hi</title>" });
    expect(
      validateNoindexContent(offlineIndexable).some((f) => f.includes("offline.html")),
    ).toBe(true);

    const sitemapLeaksApp = validNoindexContent({
      sitemapXml:
        "<urlset><url><loc>https://bookmarkforgeapp.com/app</loc></url></urlset>",
    });
    expect(
      validateNoindexContent(sitemapLeaksApp).some((f) => f.includes("must not be listed")),
    ).toBe(true);

    const sitemapMissingLanding = validNoindexContent({
      sitemapXml:
        "<urlset><url><loc>https://bookmarkforgeapp.com/privacy-and-terms.html</loc></url></urlset>",
    });
    const missingFails = validateNoindexContent(sitemapMissingLanding);
    expect(missingFails.some((f) => f.includes("missing /"))).toBe(true);
    expect(missingFails.some((f) => f.includes("missing /es/"))).toBe(true);
    expect(missingFails.some((f) => f.includes("missing /it/"))).toBe(true);
    expect(
      missingFails.some((f) => f.includes("missing /pocket-alternative")),
    ).toBe(true);
  });

  it("flags sitemap xhtml:link hreflang annotations that drift", () => {
    const base = validNoindexContent().sitemapXml;

    // A landing URL missing one alternate (fr) from its annotation set.
    const missingFr = validNoindexContent({
      sitemapXml: base.replace(
        /    <xhtml:link rel="alternate" hreflang="fr" href="https:\/\/bookmarkforgeapp.com\/fr\/" \/>\n/g,
        "",
      ),
    });
    expect(
      validateNoindexContent(missingFr).some((f) => f.includes('hreflang="fr"')),
    ).toBe(true);

    // An alternate pointing at the wrong locale URL.
    const wrongHref = validNoindexContent({
      sitemapXml: base.replace(
        'hreflang="es" href="https://bookmarkforgeapp.com/es/"',
        'hreflang="es" href="https://bookmarkforgeapp.com/fr/"',
      ),
    });
    expect(
      validateNoindexContent(wrongHref).some((f) => f.includes('hreflang="es"')),
    ).toBe(true);

    // The xhtml namespace must be declared on <urlset>.
    const noXhtmlNs = validNoindexContent({
      sitemapXml: base.replace(' xmlns:xhtml="http://www.w3.org/1999/xhtml"', ""),
    });
    expect(
      validateNoindexContent(noXhtmlNs).some((f) => f.includes("xmlns:xhtml")),
    ).toBe(true);

    // The sitemap must list every landing locale, not only / and /es/.
    const noIt = validNoindexContent({
      sitemapXml: base.replace(/<url>\n    <loc>https:\/\/bookmarkforgeapp.com\/it\/<\/loc>[\s\S]*?<\/url>\n/, ""),
    });
    expect(
      validateNoindexContent(noIt).some((f) => f.includes("missing /it/")),
    ).toBe(true);

    // Legal pages are a 6-language cluster too: a legal <url> missing one
    // alternate (fr) or pointing its x-default at the landing is drift.
    const legalNoFr = validNoindexContent({
      sitemapXml: base.replace(
        /    <xhtml:link rel="alternate" hreflang="fr" href="https:\/\/bookmarkforgeapp.com\/fr\/privacy-and-terms\.html" \/>\n/g,
        "",
      ),
    });
    const legalNoFrFails = validateNoindexContent(legalNoFr);
    expect(
      legalNoFrFails.some((f) =>
        f.includes("/privacy-and-terms.html xhtml:link hreflang=\"fr\""),
      ),
    ).toBe(true);

    const legalWrongDefault = validNoindexContent({
      sitemapXml: base.replace(
        'hreflang="x-default" href="https://bookmarkforgeapp.com/privacy-and-terms.html"',
        'hreflang="x-default" href="https://bookmarkforgeapp.com/"',
      ),
    });
    expect(
      validateNoindexContent(legalWrongDefault).some((f) =>
        f.includes("xhtml:link hreflang=\"x-default\""),
      ),
    ).toBe(true);
  });
});

describe("og:image policy (card → page mapping)", () => {
  it("assigns the pricing card to the pricing-adjacent page and the general card everywhere else", () => {
    // Every policy entry must name a real indexed page.
    const all = [...LANDING_PAGES, ...SINGLE_PAGES, ...LEGAL_PAGES];
    for (const entry of OG_IMAGE_POLICY) {
      expect(all.some((p) => p.file === entry.file)).toBe(true);
    }
    // /pocket-alternative pitches the free tier and the one-time $79 Pro,
    // so its share card is the pricing card.
    expect(ogImageForFile("public/pocket-alternative.html")).toContain(
      "og-image-pricing.png",
    );
    // Legal pages carry the general product card; each localized landing
    // carries the card assigned to its language in OG_IMAGE_POLICY.
    for (const page of LEGAL_PAGES) {
      expect(ogImageForFile(page.file)).toBe(DEFAULT_OG_IMAGE);
    }
    for (const page of LANDING_PAGES) {
      expect(ogImageForFile(page.file)).toBe(
        hasLocalizedCard(page.lang)
          ? `${SITE_URL}/og-image-${page.lang}.png`
          : DEFAULT_OG_IMAGE,
      );
    }
    for (const entry of OG_IMAGE_POLICY) {
      if (entry.file.endsWith(".html") && entry.file !== "public/pocket-alternative.html") {
        const landing = LANDING_PAGES.find((l) => l.file === entry.file);
        expect(landing).toBeDefined();
        expect(entry.ogImage).toBe(`${SITE_URL}/og-image-${landing.lang}.png`);
      }
    }
  });

  it("flags a page carrying the wrong card and accepts the policy card", () => {
    const policyCard = ogImageForFile("public/pocket-alternative.html");
    const good = buildValidPage({ ogImage: policyCard });
    expect(validateLandingHtml(good, { ...CFG, ogImage: policyCard })).toEqual([]);

    const wrong = buildValidPage({ ogImage: DEFAULT_OG_IMAGE });
    const fails = validateLandingHtml(wrong, { ...CFG, ogImage: policyCard });
    expect(fails.some((f) => f.includes("OG_IMAGE_POLICY"))).toBe(true);
  });

  it("keeps the real repo pages aligned with the card policy", () => {
    for (const page of [...LANDING_PAGES, ...SINGLE_PAGES, ...LEGAL_PAGES]) {
      const html = readFileSync(page.file, "utf8");
      expect(metaContent(html, "og:image")).toBe(ogImageForFile(page.file));
    }
  });
});

// ── The legal world's translation artifact ──────────────────────────────────
describe("validateLegalTranslationCoverage", () => {
  /** Every locale the legal pages are GENERATED for: the registry minus the
   *  five localized reviewed primaries (EN keeps its entry, as the source). */
  const generatedLocales = () => [
    "en",
    ...LANDING_LANG_CODES.filter(
      (lang) => !["es", "fr", "de", "pt", "it"].includes(lang),
    ),
  ];

  it("reports invalid JSON instead of throwing", () => {
    expect(validateLegalTranslationCoverage({ translationsJson: "not json" })).toEqual([
      expect.stringContaining("not valid JSON"),
    ]);
  });

  it("names a missing locale and rejects a reviewed one", () => {
    const complete = Object.fromEntries(
      generatedLocales().map((lang) => [lang, {}]),
    );
    expect(
      validateLegalTranslationCoverage({
        translationsJson: JSON.stringify(complete),
      }),
    ).toEqual([]);

    const missing = { ...complete };
    delete missing.ja;
    expect(
      validateLegalTranslationCoverage({ translationsJson: JSON.stringify(missing) }),
    ).toEqual([expect.stringContaining('"ja"')]);

    expect(
      validateLegalTranslationCoverage({
        translationsJson: JSON.stringify({ ...complete, es: {} }),
      }),
    ).toEqual([expect.stringContaining("hand-written")]);
  });

  it("the real artifact covers the 25 generated locales", () => {
    const json = readFileSync("scripts/privacy-translations.json", "utf8");
    expect(generatedLocales()).toContain("en");
    expect(Object.keys(JSON.parse(json))).toHaveLength(generatedLocales().length);
    expect(validateLegalTranslationCoverage({ translationsJson: json })).toEqual([]);
  });
});