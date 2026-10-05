// @vitest-environment node
/**
 * scripts/__tests__/check-page-figures.test.mjs
 *
 * Adversarial suite for the page-figures gate: the generated public pages
 * (30 localized privacy-and-terms.html + 30 landings + pocket-alternative)
 * must agree with the code truth, reusing check-manual-figures' evaluator.
 * Tests pin:
 *
 *   - the 61-surface contract (missing page → reported, not skipped),
 *     including a NEW-locale landing so the 24 expansion pages can never
 *     silently fall out of coverage again;
 *   - HTML tag stripping with 1:1 line attribution (file:line of the RAW file);
 *   - JSON-LD compaction ("100% Local-First" marketing + offer prices on one
 *     synthetic line must not fabricate failures — the probe's original FP);
 *   - competitor spoken-price neutralization ("28 dollars" near a competitor);
 *   - real claim policing on pages (recovery phrase, refund window, prices);
 *   - a fire drill: stale page vs. changed pricing.ts constant.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanPages } from "../check-page-figures.mjs";

let tmpRoot;

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  }
});

const PRICING_TS = `
export const PRICING_CONFIG = {
  lifetimeVersioned: { upgradeDiscountPct: 60, refundDays: 30 },
  tiers: [
    { id: "free", price: 0,
      limitations: { maxBookmarks: 1000, maxDevices: 0 } },
    { id: "pro", price: 79, originalPrice: 79, earlyBirdPrice: 59,
      regularPrice: 79, fullPrice: 99, upgradePriceNew: 89,
      upgradePriceOwner: 35,
      limitations: { maxBookmarks: Infinity, maxDevices: 3 } },
  ],
  earlyBird: { caps: { early: 200 } },
};
`;
const LICENSE_TS = `cacheTtlMs: 48 * 60 * 60 * 1000,`;
const RECOVERY_TS = `if (wordCount !== 24) throw`;
const CONFIG_TS = `MIN_PASSWORD_LENGTH: 12,`;

const LOCALES = [
  "ar", "bg", "cs", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi",
  "hr", "hu", "id", "it", "ja", "ko", "nl", "no", "pl", "pt", "ro", "ru",
  "sv", "th", "tr", "uk", "vi", "zh",
];
// Landing surfaces for the SAME locale set as the privacy pages (EN is the
// root landing.html): mirrors check-page-figures.mjs's own derivation.
const LANDING_FILES = LOCALES.map((l) => (l === "en" ? "landing.html" : `${l}.html`));

/** Build a root whose 61 page surfaces all exist. Per-locale bodies default
 * to a figure-free page; `pages` maps "es/privacy-and-terms.html" → body. */
function makePageRoot(pages = {}) {
  tmpRoot = mkdtempSync(join(tmpdir(), "page-figures-gate-"));
  const base = {
    "src/constants/pricing.ts": PRICING_TS,
    "src/constants/license.ts": LICENSE_TS,
    "src/services/RecoveryService.ts": RECOVERY_TS,
    "src/constants/config.ts": CONFIG_TS,
  };
  for (const [rel, content] of Object.entries(base)) {
    const p = join(tmpRoot, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  for (const l of LOCALES) {
    const rel = l === "en" ? "privacy-and-terms.html" : `${l}/privacy-and-terms.html`;
    writePage(rel, pages[rel] ?? "<p>ok</p>\n");
  }
  for (const f of LANDING_FILES) writePage(f, pages[f] ?? "<p>ok</p>\n");
  writePage("pocket-alternative.html", pages["pocket-alternative.html"] ?? "<p>ok</p>\n");
  return tmpRoot;
}

function writePage(rel, body) {
  const p = join(tmpRoot, "public", rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body);
}

describe("check-page-figures: surface contract", () => {
  it("scans all 61 surfaces on a green synthetic tree", () => {
    const root = makePageRoot();
    const r = scanPages(root);
    expect(r.scanned).toBe(61);
    expect(r.missing).toEqual([]);
    expect(r.failures).toEqual([]);
  });

  it("reports a missing localized page instead of skipping it", () => {
    const root = makePageRoot();
    rmSync(join(root, "public", "ja", "privacy-and-terms.html"));
    const r = scanPages(root);
    expect(r.missing).toContain("ja/privacy-and-terms.html");
  });

  it("requires the pocket landing surface too", () => {
    const root = makePageRoot();
    rmSync(join(root, "public", "pocket-alternative.html"));
    expect(scanPages(root).missing).toContain("public/pocket-alternative.html");
  });

  it("requires a NEW-locale landing, not just the original six", () => {
    // The regression this pins: LANDING_FILES was a hand-written list of the
    // six original landings, so ja.html and the other 23 expansion pages
    // shipped priced copy no figures gate ever read. A locale that exists on
    // the privacy side must exist on the landing side too.
    const root = makePageRoot();
    rmSync(join(root, "public", "ja.html"));
    const r = scanPages(root);
    expect(r.missing).toContain("public/ja.html");
    expect(r.scanned).toBe(60);
  });
});

describe("check-page-figures: surface adaptation", () => {
  it("strips tags but keeps RAW line numbers in failures", () => {
    const root = makePageRoot({
      // lines 1..4 padding; the claim sits on raw line 5
      "es/privacy-and-terms.html":
        "<html>\n<body>\n<p>intro</p>\n<p>other</p>\n<p>When you create a vault we show a 12-word recovery phrase once.</p>\n</body>\n</html>\n",
    });
    const r = scanPages(root);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toBe(
      "public/es/privacy-and-terms.html:5: recovery phrase claims 12 words; RecoveryService enforces 24",
    );
  });

  it("does not let JSON-LD '100% Local-First' marketing fabricate discount failures", () => {
    const root = makePageRoot({
      "landing.html": [
        "<script type=\"application/ld+json\">",
        "{",
        '  "description": "Your private vault. 100% Local-First.",',
        '  "offers": { "lowPrice": "$59", "highPrice": "$99" }',
        "}",
        "</script>",
        "",
      ].join("\n"),
    });
    expect(scanPages(root).failures).toEqual([]);
  });

  it("does not fabricate discount claims across unrelated JSON-LD values", () => {
    // The 30-locale reality: the compacted JSON-LD line carries the meta
    // description's completeness marketing ("100% lokalt" — localized, so the
    // old 6-locale strip vocabulary does not know it) AND the offer copy's
    // real discount phrase ("v2 со скидкой 60%") in DIFFERENT values. The
    // discount scan is per value: a keyword in one value must not turn the
    // other value's 100% into a tier claim (and vice versa).
    const root = makePageRoot({
      "landing.html": [
        "<script type=\"application/ld+json\">",
        "{",
        '  "description": "Din gemte viden bliver p\\u00e5 din computer. 100% lokalt.",',
        '  "offers": { "description": "Lifetime of v1. v2 со скидкой 60%" }',
        "}",
        "</script>",
        "",
      ].join("\n"),
    });
    expect(scanPages(root).failures).toEqual([]);
  });

  it("recognizes non-English bookmark nouns so Early Bird + free cap is not a supply claim", () => {
    // The real public/tr.html JSON-LD shape: the free tier's "yer imi" cap and
    // the Pro period's "Early Bird" live in the same compacted line. With the
    // locale's noun absent from BOOKMARK_RE, the free cap policed itself as
    // an early-bird SUPPLY count ("offer supply cap 2500") on 15 locales.
    const root = makePageRoot({
      "tr.html": [
        "<script type=\"application/ld+json\">",
        "{",
        '  "description": "Ücretsiz plan: 1.000 yer imi. Pro tek seferlik satın alma $59 Early Bird (sonra $79)",',
        "}",
        "</script>",
        "",
      ].join("\n"),
    });
    expect(scanPages(root).failures).toEqual([]);
  });

  it("does not pair an offer keyword with counts from other JSON-LD values", () => {
    const root = makePageRoot({
      "landing.html": [
        "<script type=\"application/ld+json\">",
        "{",
        '  "supplyNote": "Only 500 founding members were ever sold",',
        '  "period": "Early Bird (then $79)"',
        "}",
        "</script>",
        "",
      ].join("\n"),
    });
    expect(scanPages(root).failures).toEqual([]);
  });

  it("still polices a wrong discount claim inside one JSON-LD value", () => {
    const root = makePageRoot({
      "landing.html": [
        "<script type=\"application/ld+json\">",
        "{",
        '  "offers": { "description": "Lifetime of v1. v2 со скидкой 80%" }',
        "}",
        "</script>",
        "",
      ].join("\n"),
    });
    const r = scanPages(root);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain("discount claims 80%");
  });

  it("still polices a real discount claim on a visible line", () => {
    const root = makePageRoot({
      "landing.html": "<p>Launch week: 50% off Pro.</p>\n",
    });
    const r = scanPages(root);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain("discount claims 50%");
  });

  it("neutralizes spoken competitor prices without $ on the line", () => {
    const root = makePageRoot({
      "landing.html": "<p>Raindrop charges 28 dollars every year. Switch to BookmarkForge.</p>\n",
    });
    expect(scanPages(root).failures).toEqual([]);
  });

  it("keeps policing $-tagged prices even on competitor-named lines", () => {
    const root = makePageRoot({
      "landing.html": "<p>Raindrop costs $28 forever.</p>\n",
    });
    const r = scanPages(root);
    expect(r.failures.some((f) => f.includes("price 28"))).toBe(true);
  });

  it("polices drift on a NEW-locale landing the old six-file list never read", () => {
    // Presence is not coverage: the expansion landings were scanned by no
    // figures gate at all, so a drifted price there was invisible. One claim
    // on ja.html must now fail with file+line attribution.
    const root = makePageRoot({
      "ja.html": "<p>Pro is $28 forever.</p>\n",
    });
    const r = scanPages(root);
    expect(r.failures.some((f) => f.includes("public/ja.html:1") && f.includes("price 28"))).toBe(true);
  });

  it("extracts semantic meta content so JSON-borne claims are policed", () => {
    const root = makePageRoot({
      "landing.html":
        '<meta name="description" content="Raindrop charges yearly. BookmarkForge Free: 2,000 bookmarks forever.">\n',
    });
    const r = scanPages(root);
    expect(r.failures).toEqual([
      "public/landing.html:1: bookmark cap 2000 is not canonical",
    ]);
  });

  it("masks the competitor's recurring spoken price inside meta copy", () => {
    const root = makePageRoot({
      "landing.html":
        '<meta name="description" content="Raindrop: 99 dollars every year. Switch to local-first.">\n',
    });
    expect(scanPages(root).failures).toEqual([]);
  });

  it("validates our own spoken one-time price in meta copy (EN and ES)", () => {
    const root = makePageRoot({
      "landing.html":
        '<meta name="description" content="Raindrop costs less — BookmarkForge: 61 dollars once.">\n',
      "es.html":
        '<meta name="description" content="Raindrop cobra cada año — BookmarkForge: 61 dólares una vez.">\n',
    });
    const r = scanPages(root);
    expect(r.failures).toHaveLength(2);
    for (const f of r.failures) {
      expect(f).toContain("spoken one-time price 61 is not in the canonical ladder");
    }
  });

  it("lets the canonical spoken one-time price pass", () => {
    const root = makePageRoot({
      "landing.html":
        '<meta name="description" content="Raindrop costs more. BookmarkForge: 59 dollars once. Free: 1,000 bookmarks.">\n',
    });
    expect(scanPages(root).failures).toEqual([]);
  });
});

describe("check-page-figures: claim policing and fire drill", () => {
  it("validates canonical figures on pages (recovery, refund, prices)", () => {
    const root = makePageRoot({
      "privacy-and-terms.html": [
        "<p>we show a 24-word recovery phrase once.</p>",
        "<p>30-day refund via Whop.</p>",
        "<p>Pro is $79 lifetime; upgrade from v2 for $89.</p>",
        "",
      ].join("\n"),
    });
    expect(scanPages(root).failures).toEqual([]);
  });

  it("flags a stale refund window on a localized legal page", () => {
    const root = makePageRoot({
      "fr/privacy-and-terms.html": "<p>Remboursement sous 30 jours via Whop.</p>\n",
    });
    // With canonical truth the page is green…
    expect(scanPages(root).failures).toEqual([]);
    // …and fails closed once the constant moves (fire drill).
    writeFileSync(
      join(root, "src", "constants", "pricing.ts"),
      PRICING_TS.replace("refundDays: 30", "refundDays: 45"),
    );
    const r = scanPages(root);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toBe(
      "public/fr/privacy-and-terms.html:1: refund window claims 30 days; pricing.ts says 45",
    );
  });

  it("fails closed when truth cannot be parsed", () => {
    const root = makePageRoot();
    writeFileSync(join(root, "src", "constants", "pricing.ts"), "export const broken = {;");
    expect(() => scanPages(root)).toThrow();
  });
});
