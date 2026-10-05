import { describe, expect, it } from "vitest";
import {
  replaceSitemapLocs,
  rewriteHeadersCspValues,
} from "../nginx-render.mjs";
import { CSP_MODERATE } from "../csp-config.js";

// ── Fixtures ─────────────────────────────────────────────────────────────
// Mirrors the real public/_headers structure: prose comments, per-path
// blocks that repeat the security headers (Cloudflare Pages applies only
// the most-specific rule), noindex rules, CRLF line endings.
const HEADERS_LINES = [
  "# P49: Cache-Control strategy for static assets.",
  "#",
  "# IMPORTANT: Cloudflare Pages applies the MOST SPECIFIC rule's headers only.",
  "",
  "/assets/*",
  "  Cache-Control: public, max-age=31536000, immutable",
  "  Content-Security-Policy: <CSP>",
  "",
  "/*.html",
  "  Cache-Control: no-cache, must-revalidate",
  "  Reporting-Endpoints: <REPORTING>",
  "  Report-To: <REPORTTO>",
  "  Content-Security-Policy: <CSP>",
  "",
  "/*",
  "  X-Frame-Options: DENY",
  "  Report-To: <REPORTTO>",
  "  Content-Security-Policy: <CSP>",
  "",
  "/app/*",
  "  X-Robots-Tag: noindex",
  "",
];
const REPORTING_VALUE =
  'csp-endpoint="/csp-report"';
const REPORTTO_VALUE =
  '{"group":"csp-endpoint","max_age":86400,"endpoints":[{"url":"https://bookmarkforgeapp.com/csp-report"}]}';

function headersFixture({ domain = "bookmarkforgeapp.com", eol = "\r\n" } = {}) {
  const csp = CSP_MODERATE.replaceAll("bookmarkforgeapp.com", domain);
  return HEADERS_LINES.map((l) =>
    l
      .replace("<CSP>", csp)
      // Reporting-Endpoints is origin-relative ("/csp-report") in the real
      // file: canonical and domain-INDEPENDENT, unlike Report-To/CSP.
      .replace("<REPORTING>", REPORTING_VALUE)
      .replace("<REPORTTO>", REPORTTO_VALUE.replace("bookmarkforgeapp.com", domain)),
  ).join(eol);
}

// Mirrors the real public/sitemap.xml structure: urlset with xhtml
// namespace, hreflang clusters via xhtml:link, W3C namespace URIs that
// must never be localised.
const SITEMAP_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://DOMAIN/</loc>
    <lastmod>2026-09-09</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="en" href="https://DOMAIN/" />
    <xhtml:link rel="alternate" hreflang="es" href="https://DOMAIN/es/" />
    <xhtml:link rel="alternate" hreflang="x-default" href="https://DOMAIN/" />
  </url>
  <url>
    <loc>https://DOMAIN/ar/privacy-and-terms.html</loc>
    <lastmod>2026-09-09</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
    <xhtml:link rel="alternate" hreflang="ar" href="https://DOMAIN/ar/privacy-and-terms.html" />
  </url>
</urlset>
`.replaceAll("DOMAIN", "bookmarkforgeapp.com");

// ── rewriteHeadersCspValues ──────────────────────────────────────────────

describe("rewriteHeadersCspValues", () => {
  it("is the identity on canonical content (byte-for-byte, CRLF included)", () => {
    const canonical = headersFixture();
    expect(rewriteHeadersCspValues(canonical)).toBe(canonical);
  });

  it("is the identity on canonical content with LF endings and trailing spaces", () => {
    const canonical = headersFixture({ eol: "\n" }).replaceAll(
      "must-revalidate",
      "must-revalidate  ", // trailing whitespace tail must survive
    );
    expect(rewriteHeadersCspValues(canonical)).toBe(canonical);
  });

  it("rewrites every stale CSP-derived value across all path blocks", () => {
    const stale = headersFixture({ domain: "stale.example" });
    const out = rewriteHeadersCspValues(stale);
    expect(out).not.toContain("stale.example");
    expect(out).toContain("wss://signal.bookmarkforgeapp.com");
    // All three keys, in every block they occur, were rewritten.
    expect(out.match(/^ {2}Content-Security-Policy: /gm)?.length).toBe(3);
    expect(out.match(/^ {2}Report-To: /gm)?.length).toBe(2);
    expect(out.match(/^ {2}Reporting-Endpoints: /gm)?.length).toBe(1);
  });

  it("touches ONLY the CSP-derived lines: prose, Cache-Control and noindex survive", () => {
    const stale = headersFixture({ domain: "stale.example" });
    const out = rewriteHeadersCspValues(stale);
    // Non-CSP lines keep their (stale) bytes — the renderer is not the owner.
    expect(out).toContain("  Cache-Control: public, max-age=31536000, immutable");
    expect(out).toContain("  X-Robots-Tag: noindex");
    expect(out).toContain("  X-Frame-Options: DENY");
    expect(out).toContain("# IMPORTANT: Cloudflare Pages applies the MOST SPECIFIC");
    // And the structure (line count) is unchanged.
    expect(out.split("\n").length).toBe(stale.split("\n").length);
  });

  it("preserves CRLF and trailing whitespace tails when repairing", () => {
    const stale = headersFixture({ domain: "stale.example" });
    const out = rewriteHeadersCspValues(stale);
    expect(out).toContain("must-revalidate\r\n");
    expect(out.split("\r\n").length).toBe(stale.split("\r\n").length);
  });

  it("refuses to rewrite when a CSP-derived key is missing, naming ALL missing keys", () => {
    const damaged = headersFixture()
      .split("\r\n")
      .filter((l) => !/^ {2}(Report-To|Reporting-Endpoints):/.test(l))
      .join("\r\n");
    expect(() => rewriteHeadersCspValues(damaged)).toThrowError(
      /no "Reporting-Endpoints:", "Report-To:" header line\(s\) found/,
    );
  });

  it("refuses to rewrite a file that has no headers at all", () => {
    expect(() => rewriteHeadersCspValues("<html>not headers</html>")).toThrowError(
      /refusing to rewrite/,
    );
  });

  it("honours an explicit csp override (BOOKMARKFORGE_DOMAIN round-trip)", () => {
    const canonical = headersFixture();
    const out = rewriteHeadersCspValues(
      canonical,
      CSP_MODERATE.replaceAll("bookmarkforgeapp.com", "custom.example"),
    );
    expect(out).toContain("wss://signal.custom.example");
    expect(out).toContain("https://custom.example/csp-report");
    expect(out).not.toMatch(/^ {2}Content-Security-Policy: .*bookmarkforgeapp.com/m);
  });

  it("is idempotent: applying it twice equals applying it once", () => {
    const stale = headersFixture({ domain: "stale.example" });
    const once = rewriteHeadersCspValues(stale);
    expect(rewriteHeadersCspValues(once)).toBe(once);
  });
});

// ── replaceSitemapLocs ───────────────────────────────────────────────────

describe("replaceSitemapLocs", () => {
  it("is the identity on canonical content", () => {
    expect(replaceSitemapLocs(SITEMAP_FIXTURE)).toBe(SITEMAP_FIXTURE);
  });

  it("rewrites stale hosts in <loc> AND xhtml:link href, preserving paths", () => {
    const stale = SITEMAP_FIXTURE.replaceAll("bookmarkforgeapp.com", "stale.example");
    const out = replaceSitemapLocs(stale);
    expect(out).not.toContain("stale.example");
    expect(out).toContain("<loc>https://bookmarkforgeapp.com/ar/privacy-and-terms.html</loc>");
    expect(out).toContain('hreflang="es" href="https://bookmarkforgeapp.com/es/"');
    // Paths, lastmod, changefreq, priority survive.
    expect(out).toContain("<lastmod>2026-09-09</lastmod>");
    expect(out).toContain("<priority>1.0</priority>");
  });

  it("never localises W3C/sitemaps.org namespace URIs", () => {
    const stale = SITEMAP_FIXTURE.replaceAll("bookmarkforgeapp.com", "stale.example");
    const out = replaceSitemapLocs(stale);
    expect(out).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(out).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });

  it("is byte-identical apart from the host: line count and attribute order unchanged", () => {
    const stale = SITEMAP_FIXTURE.replaceAll("bookmarkforgeapp.com", "stale.example");
    const out = replaceSitemapLocs(stale);
    expect(out.split("\n").length).toBe(stale.split("\n").length);
    expect(out.match(/<xhtml:link /g)?.length).toBe(
      stale.match(/<xhtml:link /g)?.length,
    );
  });

  it("refuses to rewrite a file without <urlset>", () => {
    expect(() => replaceSitemapLocs("<broken/>")).toThrowError(/no <urlset> element/);
  });

  it("refuses to rewrite a urlset without any loc/xhtml:link URLs", () => {
    expect(() =>
      replaceSitemapLocs('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>'),
    ).toThrowError(/no <loc> or xhtml:link URLs found/);
  });

  it("honours an explicit domain override", () => {
    const out = replaceSitemapLocs(SITEMAP_FIXTURE, "custom.example");
    expect(out).toContain("https://custom.example/");
    expect(out).not.toContain("bookmarkforgeapp.com");
  });

  it("is idempotent", () => {
    const stale = SITEMAP_FIXTURE.replaceAll("bookmarkforgeapp.com", "stale.example");
    const once = replaceSitemapLocs(stale);
    expect(replaceSitemapLocs(once)).toBe(once);
  });
});
