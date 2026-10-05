import { describe, expect, it } from "vitest";
import {
  CLUSTERS,
  clusterOfPath,
  langOfPath,
  parseAlternates,
  resolvePath,
} from "../check-hreflang-graph.mjs";

describe("check-hreflang-graph helpers", () => {
  it("maps every cluster path to its language and cluster", () => {
    expect(langOfPath("/")).toBe("en");
    expect(langOfPath("/fr/")).toBe("fr");
    expect(langOfPath("/it/")).toBe("it");
    expect(langOfPath("/privacy-and-terms.html")).toBe("en");
    expect(langOfPath("/es/privacy-and-terms.html")).toBe("es");
    expect(langOfPath("/de/privacy-and-terms.html")).toBe("de");

    for (const path of CLUSTERS.landing.paths) {
      expect(clusterOfPath(path)).toBe("landing");
    }
    for (const path of CLUSTERS.legal.paths) {
      expect(clusterOfPath(path)).toBe("legal");
    }
    expect(clusterOfPath("/pocket-alternative")).toBeNull();
    expect(clusterOfPath("/fr/x")).toBeNull();
  });

  it("resolves clean landing URLs to file paths only in files mode", () => {
    expect(resolvePath("/", true)).toBe("/landing.html");
    expect(resolvePath("/fr/", true)).toBe("/fr.html");
    expect(resolvePath("/fr/privacy-and-terms.html", true)).toBe("/fr/privacy-and-terms.html");
    expect(resolvePath("/", false)).toBe("/");
    expect(resolvePath("/fr/", false)).toBe("/fr/");
  });

  it("parses alternates from HTML <link> and sitemap xhtml:link syntax", () => {
    const html =
      '<link rel="alternate" hreflang="en" href="https://bookmarkforgeapp.com/">' +
      '<link rel="alternate" hreflang="fr" href="https://bookmarkforgeapp.com/fr/">' +
      '<link rel="alternate" hreflang="x-default" href="https://bookmarkforgeapp.com/">';
    expect([...parseAlternates(html).entries()]).toEqual([
      ["en", "/"],
      ["fr", "/fr/"],
      ["x-default", "/"],
    ]);

    const sitemapBlock =
      "<url>\n    <loc>https://bookmarkforgeapp.com/fr/privacy-and-terms.html</loc>\n" +
      '    <xhtml:link rel="alternate" hreflang="en" href="https://bookmarkforgeapp.com/privacy-and-terms.html" />\n' +
      '    <xhtml:link rel="alternate" hreflang="fr" href="https://bookmarkforgeapp.com/fr/privacy-and-terms.html" />\n' +
      "</url>";
    expect([...parseAlternates(sitemapBlock).entries()]).toEqual([
      ["en", "/privacy-and-terms.html"],
      ["fr", "/fr/privacy-and-terms.html"],
    ]);
  });
});