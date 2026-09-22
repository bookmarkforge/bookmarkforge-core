#!/usr/bin/env node
/**
 * Verify that public/sitemap.xml advertises only pages that the repository
 * actually ships and routes.
 *
 * This is intentionally a repository-level gate, not a live HTTP probe:
 * production deployment can point at an older artifact (as documented in
 * docs/audit.md), while CI must still prove that the current checkout is
 * internally coherent before deployment.
 *
 * Contracts checked:
 *   - every landing <loc> maps to public/landing.html or public/<lang>.html;
 *   - every localized landing has both clean _redirects entries and a
 *     self-hosted nginx exact location/rewrite;
 *   - every legal <loc> maps to public/<lang>/privacy-and-terms.html;
 *   - pocket-alternative maps to its static HTML;
 *   - no duplicate <loc> values exist;
 *   - every landing HTML has the expected `lang`, canonical URL, and complete
 *     30-language hreflang graph plus `x-default`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LANDING_CODES as REGISTRY_ALL_CODES, SITE_URL as REGISTRY_SITE_URL } from "./landing-registry.mjs";

const ROOT = process.cwd();
const TAG = "[check-sitemap-coverage]";
const SITE_URL = REGISTRY_SITE_URL;

// The 30 landing languages (EN included, root "/") — registry-derived;
// this module re-exports the historical name for its own loops and tests.
export const LANDING_LANGS = REGISTRY_ALL_CODES;

function read(root, rel) {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch {
    return null;
  }
}

export function sitemapLocs(sitemap) {
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

export function checkSitemapCoverage({
  sitemap,
  redirects,
  nginx,
  publicFiles,
  publicPages = new Map(),
  siteUrl = SITE_URL,
}) {
  const failures = [];
  if (sitemap === null) return ["public/sitemap.xml: missing"];
  if (redirects === null) return ["public/_redirects: missing"];
  if (nginx === null) return ["public/nginx.conf: missing"];

  const locs = sitemapLocs(sitemap);
  const duplicates = locs.filter((loc, i) => locs.indexOf(loc) !== i);
  for (const loc of [...new Set(duplicates)]) {
    failures.push(`public/sitemap.xml: duplicate <loc> ${loc}`);
  }

  const expected = new Set();
  for (const lang of LANDING_LANGS) {
    const path = lang === "en" ? "/" : `/${lang}/`;
    expected.add(`${siteUrl}${path}`);
  }
  expected.add(`${siteUrl}/pocket-alternative`);
  for (const lang of LANDING_LANGS) {
    const path = lang === "en" ? "/privacy-and-terms.html" : `/${lang}/privacy-and-terms.html`;
    expected.add(`${siteUrl}${path}`);
  }

  for (const loc of locs) {
    if (!loc.startsWith(`${siteUrl}/`) && loc !== `${siteUrl}/`) {
      failures.push(`public/sitemap.xml: unexpected site origin in ${loc}`);
    }
  }
  for (const loc of expected) {
    if (!locs.includes(loc)) {
      failures.push(`public/sitemap.xml: missing expected ${loc}`);
    }
  }

  const hasRedirect = (path, target) =>
    new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+200\\s*$`, "m").test(redirects);
  const hasNginx = (lang) =>
    nginx.includes(`location = /${lang}/ {`) &&
    nginx.includes(`rewrite ^ /${lang}.html last;`);

  for (const lang of LANDING_LANGS) {
    const clean = lang === "en" ? "/" : `/${lang}/`;
    const html = lang === "en" ? "landing.html" : `${lang}.html`;
    if (!publicFiles.has(html)) {
      failures.push(`sitemap landing ${clean}: missing public/${html}`);
    } else {
      const page = publicPages.get(html);
      if (typeof page !== "string") {
        failures.push(`sitemap landing ${clean}: HTML content unavailable for SEO validation`);
      } else {
        const langMatch = page.match(/<html\b[^>]*\blang="([^"]+)"/i);
        if (!langMatch || langMatch[1] !== lang) {
          failures.push(`sitemap landing ${clean}: expected <html lang="${lang}">`);
        }
        const canonical = page.match(/<link\b[^>]*\brel="canonical"[^>]*\bhref="([^"]+)"/i)?.[1];
        const expectedCanonical = `${siteUrl}${clean}`;
        if (canonical !== expectedCanonical) {
          failures.push(`sitemap landing ${clean}: canonical must be ${expectedCanonical}`);
        }
        const alternates = new Map();
        for (const match of page.matchAll(/<link\b[^>]*\brel="alternate"[^>]*>/gi)) {
          const hreflang = match[0].match(/\bhreflang="([^"]+)"/i)?.[1];
          const href = match[0].match(/\bhref="([^"]+)"/i)?.[1];
          if (hreflang && href) alternates.set(hreflang, href);
        }
        for (const alternateLang of LANDING_LANGS) {
          const path = alternateLang === "en" ? "/" : `/${alternateLang}/`;
          const expected = `${siteUrl}${path}`;
          if (alternates.get(alternateLang) !== expected) {
            failures.push(`sitemap landing ${clean}: hreflang ${alternateLang} must target ${expected}`);
          }
        }
        if (alternates.get("x-default") !== `${siteUrl}/`) {
          failures.push(`sitemap landing ${clean}: hreflang x-default must target ${siteUrl}/`);
        }
        if (alternates.size !== LANDING_LANGS.length + 1) {
          failures.push(`sitemap landing ${clean}: expected exactly ${LANDING_LANGS.length + 1} hreflang links`);
        }
      }
    }
    if (lang !== "en") {
      if (!hasRedirect(`/${lang}`, `/${html}`) || !hasRedirect(`/${lang}/`, `/${html}`)) {
        failures.push(`sitemap landing ${clean}: missing public/_redirects route to /${html}`);
      }
      if (!hasNginx(lang)) {
        failures.push(`sitemap landing ${clean}: missing nginx exact location/rewrite to /${html}`);
      }
    } else if (!redirects.includes("/       /landing.html  200") || !nginx.includes("rewrite ^ /landing.html last;")) {
      failures.push("sitemap landing /: missing root landing route");
    }
  }

  for (const lang of LANDING_LANGS) {
    const rel = lang === "en" ? "privacy-and-terms.html" : `${lang}/privacy-and-terms.html`;
    if (!publicFiles.has(rel)) {
      failures.push(`sitemap legal ${lang}: missing public/${rel}`);
    }
  }
  if (!publicFiles.has("pocket-alternative.html")) {
    failures.push("sitemap pocket-alternative: missing public/pocket-alternative.html");
  }

  return failures;
}

export function runCheck(root = ROOT) {
  const files = new Set();
  const publicDir = join(root, "public");
  for (const lang of LANDING_LANGS) {
    files.add(lang === "en" ? "landing.html" : `${lang}.html`);
    files.add(lang === "en" ? "privacy-and-terms.html" : `${lang}/privacy-and-terms.html`);
  }
  files.add("pocket-alternative.html");
  const publicFiles = new Set([...files].filter((rel) => existsSync(join(publicDir, rel))));
  const publicPages = new Map(
    [...files]
      .filter((rel) => rel.endsWith(".html"))
      .map((rel) => [rel, read(root, `public/${rel}`)]),
  );
  return checkSitemapCoverage({
    sitemap: read(root, "public/sitemap.xml"),
    redirects: read(root, "public/_redirects"),
    nginx: read(root, "public/nginx.conf"),
    publicFiles,
    publicPages,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = runCheck();
  if (failures.length > 0) {
    for (const failure of failures) console.error(`${TAG} FAIL: ${failure}`);
    console.error(`${TAG} FAIL: ${failures.length} sitemap coverage violation(s)`);
    process.exit(1);
  }
  console.log(`${TAG} ok: ${LANDING_LANGS.length} landing locales + legal pages + pocket route are shipped and routed`);
}
