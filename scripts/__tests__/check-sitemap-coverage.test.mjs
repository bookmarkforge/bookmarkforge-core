import { describe, expect, it } from "vitest";
import {
  LANDING_LANGS,
  checkSitemapCoverage,
  sitemapLocs,
} from "../check-sitemap-coverage.mjs";

function fixture({ missingRedirectLang = null, missingNginxLang = null, missingFile = null } = {}) {
  const locs = [];
  const files = new Set(["landing.html", "privacy-and-terms.html", "pocket-alternative.html"]);
  const redirects = ["/       /landing.html  200"];
  const nginx = ["rewrite ^ /landing.html last;"];
  for (const lang of LANDING_LANGS) {
    if (lang === "en") continue;
    locs.push(`https://bookmarkforgeapp.com/${lang}/`);
    locs.push(`https://bookmarkforgeapp.com/${lang}/privacy-and-terms.html`);
    files.add(`${lang}.html`);
    files.add(`${lang}/privacy-and-terms.html`);
    if (lang !== missingRedirectLang) {
      redirects.push(`/${lang} /${lang}.html 200`);
      redirects.push(`/${lang}/ /${lang}.html 200`);
    }
    if (lang !== missingNginxLang) {
      nginx.push(`location = /${lang}/ {`, `rewrite ^ /${lang}.html last;`);
    }
  }
  locs.unshift("https://bookmarkforgeapp.com/", "https://bookmarkforgeapp.com/pocket-alternative");
  locs.splice(31, 0, "https://bookmarkforgeapp.com/privacy-and-terms.html");
  if (missingFile) files.delete(missingFile);
  const alternateLinks = LANDING_LANGS.map((alternateLang) => {
    const path = alternateLang === "en" ? "/" : `/${alternateLang}/`;
    return `<link rel="alternate" hreflang="${alternateLang}" href="https://bookmarkforgeapp.com${path}">`;
  }).join("") + `<link rel="alternate" hreflang="x-default" href="https://bookmarkforgeapp.com/">`;
  const publicPages = new Map();
  for (const lang of LANDING_LANGS) {
    const path = lang === "en" ? "/" : `/${lang}/`;
    const file = lang === "en" ? "landing.html" : `${lang}.html`;
    publicPages.set(file, `<html lang="${lang}"><head><link rel="canonical" href="https://bookmarkforgeapp.com${path}">${alternateLinks}</head></html>`);
  }
  const sitemap = `<urlset>${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join("")}</urlset>`;
  return { sitemap, redirects: redirects.join("\n"), nginx: nginx.join("\n"), publicFiles: files, publicPages };
}

describe("check-sitemap-coverage", () => {
  it("parses all sitemap locations", () => {
    expect(sitemapLocs("<url><loc>https://bookmarkforgeapp.com/ar/</loc></url>")).toEqual([
      "https://bookmarkforgeapp.com/ar/",
    ]);
  });

  it("accepts the complete 30-locale artifact and routing fixture", () => {
    expect(checkSitemapCoverage(fixture())).toEqual([]);
  });

  it("catches a missing localized HTML artifact", () => {
    const failures = checkSitemapCoverage(fixture({ missingFile: "ar.html" }));
    expect(failures).toContain("sitemap landing /ar/: missing public/ar.html");
  });

  it("catches incomplete landing SEO metadata", () => {
    const f = fixture();
    f.publicPages.set("ar.html", `<html lang="ar"><head><link rel="canonical" href="https://bookmarkforgeapp.com/ar/"></head></html>`);
    const failures = checkSitemapCoverage(f);
    expect(failures).toContain("sitemap landing /ar/: hreflang bg must target https://bookmarkforgeapp.com/bg/");
    expect(failures).toContain("sitemap landing /ar/: expected exactly 31 hreflang links");
  });

  it("catches a missing hosting redirect and nginx route", () => {
    const failures = checkSitemapCoverage(
      fixture({ missingRedirectLang: "bg", missingNginxLang: "cs" }),
    );
    expect(failures).toContain(
      "sitemap landing /bg/: missing public/_redirects route to /bg.html",
    );
    expect(failures).toContain(
      "sitemap landing /cs/: missing nginx exact location/rewrite to /cs.html",
    );
  });

  it("catches duplicate and missing sitemap locations", () => {
    const f = fixture();
    f.sitemap = f.sitemap.replace(
      "https://bookmarkforgeapp.com/ar/",
      "https://bookmarkforgeapp.com/es/",
    );
    const failures = checkSitemapCoverage(f);
    expect(failures.some((failure) => failure.includes("duplicate <loc>"))).toBe(true);
    expect(failures).toContain("public/sitemap.xml: missing expected https://bookmarkforgeapp.com/ar/");
  });
});
