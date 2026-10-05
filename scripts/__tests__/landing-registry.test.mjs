// @vitest-environment node
/**
 * scripts/__tests__/landing-registry.test.mjs
 *
 * Contract test for scripts/landing-registry.mjs — the single source of truth
 * for the landing locale set, and now also for the two CONTENT distinctions
 * that used to be hand-copied per consumer:
 *
 *   - the six launch locales ("primary": the Free-card wedge slot in
 *     check-landing-free-plan and the reviewed legal set), and
 *   - the legal world, whose generated pages are the 24 non-primary locales.
 *
 * Why this test exists at all: a registry only stays a single source of truth
 * if its shape is pinned. Every invariant below is one a consumer silently
 * depends on — an EN that stops being first would reorder every hreflang set
 * and the sitemap; a primary that is not a landing locale would make the
 * legal cluster reference a page that does not exist; a language with no
 * preference href would drop out of the dropdown's links.
 *
 * The cross-artifact pins (landing-translations.json covering the secondaries,
 * privacy-translations.json covering the generated legal pages) live with the
 * gates that own those artifacts: check-landing-free-plan and check-seo.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LANDING_CODES,
  LANDING_LANGS,
  LANDING_LOCALES,
  LANDING_PAGES,
  LANG_LINK_HREFS,
  LEGAL_LOCALE_CODES,
  LOCALIZED_LANDING_CODES,
  PREF_LANGS,
  PRIMARY_LOCALE_CODES,
  SITE_URL,
} from "../landing-registry.mjs";

describe("landing locale set", () => {
  it("carries the 30 locales, EN first and the rest alphabetical", () => {
    expect(LANDING_CODES).toHaveLength(30);
    expect(LANDING_CODES[0]).toBe("en");
    expect(LANDING_CODES.slice(1)).toEqual([...LANDING_CODES.slice(1)].sort());
    expect(new Set(LANDING_CODES).size).toBe(30);
  });

  it("derives the localized set (29, EN excluded) and the preference set (all 30)", () => {
    expect(LOCALIZED_LANDING_CODES).toHaveLength(29);
    expect(LOCALIZED_LANDING_CODES).not.toContain("en");
    expect(LOCALIZED_LANDING_CODES).toEqual(
      LANDING_CODES.filter((code) => code !== "en"),
    );
    // One list for both axes by design: a language choosable from the dropdown
    // but unnegotiable at the edge is the 6-vs-30 bug this module closes.
    expect(PREF_LANGS).toEqual(LANDING_CODES);
  });

  it("gives EN the root href and every other locale its own path", () => {
    expect(LANDING_LANGS[0]).toEqual({ hreflang: "en", href: `${SITE_URL}/` });
    for (const { hreflang, href } of LANDING_LANGS) {
      expect(href).toBe(
        hreflang === "en" ? `${SITE_URL}/` : `${SITE_URL}/${hreflang}/`,
      );
    }
  });
});

describe("primary set (the six launch locales)", () => {
  it("is exactly the six documented codes, in launch order", () => {
    // Pinned literally on purpose: this is the one place the historical
    // decision is written down, so a reordering (or a seventh primary) has to
    // be an explicit, reviewed edit — it changes the wedge slots in
    // check-landing-free-plan and the legal cluster.
    expect(PRIMARY_LOCALE_CODES).toEqual(["en", "es", "fr", "de", "pt", "it"]);
    expect(PRIMARY_LOCALE_CODES.length).toBeLessThan(LANDING_CODES.length);
  });

  it("is a subset of the landing locales, EN included", () => {
    for (const code of PRIMARY_LOCALE_CODES) {
      expect(LANDING_CODES).toContain(code);
    }
    expect(PRIMARY_LOCALE_CODES).toContain("en");
  });
});

describe("legal set", () => {
  it("is the reviewed primaries — the same six, no second list", () => {
    expect(LEGAL_LOCALE_CODES).toEqual(PRIMARY_LOCALE_CODES);
  });

  it("has a SHIPPED legal page for every legal language", () => {
    // A legal locale with no page would make the hreflang cluster and the
    // LEGAL_PAGES head contract point at a 404 — the registry must not be able
    // to name a legal language the site does not serve.
    const root = join(import.meta.dirname, "..", "..");
    for (const code of LEGAL_LOCALE_CODES) {
      const rel =
        code === "en"
          ? "public/privacy-and-terms.html"
          : `public/${code}/privacy-and-terms.html`;
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }
  });
});

describe("derived page identity", () => {
  it("maps every locale to its file, path and OG locales", () => {
    const en = LANDING_LOCALES.find((l) => l.lang === "en");
    expect(en).toMatchObject({
      file: "public/landing.html",
      path: "/",
      locale: "en_US",
      alternateLocale: "es_ES",
    });
    const ja = LANDING_LOCALES.find((l) => l.lang === "ja");
    expect(ja).toMatchObject({
      file: "public/ja.html",
      path: "/ja/",
      locale: "ja_JP",
      alternateLocale: "en_US",
    });
    expect(LANDING_LOCALES).toHaveLength(30);
  });

  it("gives every locale a region (no xx_XX), distinct per language", () => {
    for (const { lang, locale } of LANDING_LOCALES) {
      expect(locale).not.toContain("XX");
      expect(locale.split("_")[0]).toBe(lang);
    }
  });

  it("builds each page's alternate set from all 30 landings plus x-default", () => {
    for (const page of LANDING_PAGES) {
      expect(page.alternates).toHaveLength(31);
      expect(page.alternates.at(-1)).toEqual({
        hreflang: "x-default",
        href: `${SITE_URL}/`,
      });
      // The canonical is the page's own path: root for EN, /<code>/ elsewhere.
      expect(page.canonical).toBe(
        page.lang === "en" ? `${SITE_URL}/` : `${SITE_URL}/${page.lang}/`,
      );
    }
  });

  it("gives every locale a ?lang= preference href", () => {
    expect(Object.keys(LANG_LINK_HREFS)).toHaveLength(30);
    expect(LANG_LINK_HREFS.en).toBe("/?lang=en");
    expect(LANG_LINK_HREFS.ja).toBe("/ja/?lang=ja");
  });
});
