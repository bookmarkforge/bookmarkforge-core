import { describe, it, expect } from "vitest";

/**
 * Out-of-plan promises guard (roadmap non-goals, docs/ROADMAP.md): the
 * tier copy must never promise Notion-style collaboration, an admin panel
 * or user management as "coming soon" — "the private individual is the
 * market". Vault/sharing (a shipped CollaborationService feature) is the
 * honest ceiling; anything beyond it would never ship.
 *
 * Regression anchor: "Basic collaboration (coming soon)" and "Admin panel
 * (coming soon)" were removed from the Team/Empresa tiers together with
 * the `adminPanel` limitation flag. Do not reintroduce them.
 */
const OUT_OF_PLAN_PATTERNS = ["coming soon", "admin panel", "collaboration"];

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) collectStrings(nested, out);
  }
}

describe("constants/pricing", () => {
  it("should export PRICING_CONFIG with all tiers", async () => {
    const { PRICING_CONFIG } = await import("../../constants/pricing");
    expect(PRICING_CONFIG.tiers).toHaveLength(4);
    const ids = PRICING_CONFIG.tiers.map((t) => t.id);
    expect(ids).toEqual(["free", "pro", "team", "empresa"]);
  });

  it("should have correct pricing for each tier", async () => {
    const { PRICING_CONFIG } = await import("../../constants/pricing");
    const free = PRICING_CONFIG.tiers.find((t) => t.id === "free")!;
    expect(free.price).toBe(0);
    expect(free.limitations.maxBookmarks).toBe(1000);

    const pro = PRICING_CONFIG.tiers.find((t) => t.id === "pro")!;
    expect(pro.price).toBe(79);
    expect(pro.limitations.maxBookmarks).toBe(Infinity);
    expect(pro.popular).toBe(true);
  });

  it("should keep the legacy trial disabled and preserve early bird config", async () => {
    const { PRICING_CONFIG } = await import("../../constants/pricing");
    expect(PRICING_CONFIG.trial.enabled).toBe(false);
    expect(PRICING_CONFIG.trial.days).toBe(7);
    expect(PRICING_CONFIG.earlyBird.enabled).toBe(true);
    expect(PRICING_CONFIG.earlyBird.phases.early.pro).toBe(79);
  });

  it("should have competitor analysis", async () => {
    const { PRICING_CONFIG } = await import("../../constants/pricing");
    const competitors = Object.keys(PRICING_CONFIG.competitors);
    expect(competitors).toContain("notion");
    expect(competitors).toContain("obsidian");
    expect(competitors).toContain("raindrop");
  });

  it("should have projections", async () => {
    const { PRICING_CONFIG } = await import("../../constants/pricing");
    expect(PRICING_CONFIG.projections.year1Target).toBe(5000);
  });

  it("should export LICENSE_FEATURES for all tiers", async () => {
    const { LICENSE_FEATURES } = await import("../../constants/pricing");
    expect(Object.keys(LICENSE_FEATURES)).toEqual([
      "free",
      "pro",
      "team",
      "empresa",
    ]);
    expect(LICENSE_FEATURES.free.bookmarks).toBe("1,000 bookmarks");
    expect(LICENSE_FEATURES.pro.bookmarks).toBe("∞ UNLIMITED");
  });

  it("mirrors the commercial license anchors (D4–D6)", async () => {
    const { PRICING_CONFIG } = await import("../../constants/pricing");
    // Decision register D4: Integration
    // $2,500 / year · D5 Redistribution $7,500 / year · D6 Service/hosting
    // $5,000 / year flat (no revenue share). If the doc or this config
    // changes, the other must change in the SAME review.
    expect(
      PRICING_CONFIG.commercialLicenses.find(
        (l) => l.id === "integration",
      )?.pricePerYear,
    ).toBe(2500);
    expect(
      PRICING_CONFIG.commercialLicenses.find(
        (l) => l.id === "redistribution",
      )?.pricePerYear,
    ).toBe(7500);
    expect(
      PRICING_CONFIG.commercialLicenses.find((l) => l.id === "hosting")
        ?.pricePerYear,
    ).toBe(5000);
    // B2B is annual by design (D7, matches F2-A recurring-revenue goal);
    // individual tiers stay lifetime — keep the two contracts distinct.
    expect(
      PRICING_CONFIG.commercialLicenses.every((l) => l.interval === "year"),
    ).toBe(true);
  });

  it("never promises out-of-plan features in tier copy (roadmap non-goals)", async () => {
    const { PRICING_CONFIG, LICENSE_FEATURES } = await import(
      "../../constants/pricing"
    );
    // Scan only what a user reads as a promise: the tiers (name, description,
    // features, CTA, badge, limitations) and the LICENSE_FEATURES tables.
    // Competitor analysis (`competitors.notion.strengths` mentions
    // "Collaboration" as a *competitor* trait) is intentionally out of scope:
    // it describes the market, not what BookmarkForge promises.
    const strings: string[] = [];
    for (const tier of PRICING_CONFIG.tiers) collectStrings(tier, strings);
    collectStrings(LICENSE_FEATURES, strings);

    const violations = strings.filter((s) =>
      OUT_OF_PLAN_PATTERNS.some((p) => s.toLowerCase().includes(p)),
    );
    expect(
      violations,
      `tier copy must not promise out-of-plan features ` +
        `(${OUT_OF_PLAN_PATTERNS.join(", ")}) — ROADMAP non-goal: ` +
        `"Don't chase Notion-style collaboration; the private individual is ` +
        `the market"`,
    ).toEqual([]);
  });
});
