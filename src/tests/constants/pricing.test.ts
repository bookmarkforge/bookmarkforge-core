import { describe, it, expect } from "vitest";

/**
 * Out-of-plan promises guard (roadmap non-goals, docs/ROADMAP.md): the
 * tier copy must never promise Notion-style collaboration, an admin panel
 * or user management as "coming soon" — "the private individual is the
 * market". Vault/sharing (a shipped CollaborationService feature) is the
 * honest ceiling; anything beyond it would never ship.
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
  it("should export PRICING_CONFIG with Free/Pro (lifetime versioned)", async () => {
    const { PRICING_CONFIG } = await import("../../constants/pricing");
    expect(PRICING_CONFIG.tiers).toHaveLength(2);
    const ids = PRICING_CONFIG.tiers.map((t) => t.id);
    expect(ids).toEqual(["free", "pro"]);
  });

  it("should have correct pricing for each tier (lifetime versioned)", async () => {
    const { PRICING_CONFIG } = await import("../../constants/pricing");
    const free = PRICING_CONFIG.tiers.find((t) => t.id === "free")!;
    expect(free.price).toBe(0);
    expect(free.limitations.maxBookmarks).toBe(2500);

    const pro = PRICING_CONFIG.tiers.find((t) => t.id === "pro")!;
    // Regular anchor is $79; early bird $59 is in earlyBird.phases.early.pro
    expect(pro.price).toBe(79);
    expect(pro.limitations.maxBookmarks).toBe(Infinity);
    expect(pro.popular).toBe(true);
  });

  it("should keep the trial enabled and preserve lifetime versioned early bird", async () => {
    const { PRICING_CONFIG } = await import("../../constants/pricing");
    expect(PRICING_CONFIG.trial.enabled).toBe(true);
    expect(PRICING_CONFIG.trial.days).toBe(7);
    expect(PRICING_CONFIG.earlyBird.enabled).toBe(true);
    // Early bird $59, regular $79 — the $59 ladder is what creates FOMO
    expect(PRICING_CONFIG.earlyBird.phases.early.pro).toBe(59);
    expect(PRICING_CONFIG.earlyBird.phases.regular.pro).toBe(79);
    expect(PRICING_CONFIG.earlyBird.phases.full.pro).toBe(99);
    // Lifetime versioned contract
    expect(PRICING_CONFIG.lifetimeVersioned.majorVersion).toBe(1);
    expect(PRICING_CONFIG.lifetimeVersioned.upgradeDiscountPct).toBe(60);
    expect(PRICING_CONFIG.upgrade.v2.newCustomerPrice).toBe(89);
    expect(PRICING_CONFIG.upgrade.v2.ownerPrice).toBe(35);
  });

  it("should have competitor analysis (no subscriptions for individuals)", async () => {
    const { PRICING_CONFIG } = await import("../../constants/pricing");
    const competitors = Object.keys(PRICING_CONFIG.competitors);
    expect(competitors).toContain("notion");
    expect(competitors).toContain("obsidian");
    expect(competitors).toContain("raindrop");
  });

  it("should have projections", async () => {
    const { PRICING_CONFIG } = await import("../../constants/pricing");
    expect(PRICING_CONFIG.projections.year1Target).toBe(5000);
    expect(PRICING_CONFIG.projections.earlyBirdTarget).toBe(200);
  });

  it("should export LICENSE_FEATURES for free/pro", async () => {
    const { LICENSE_FEATURES } = await import("../../constants/pricing");
    expect(Object.keys(LICENSE_FEATURES)).toEqual(["free", "pro"]);
    expect(LICENSE_FEATURES.free.bookmarks).toBe("2,500 bookmarks");
    expect(LICENSE_FEATURES.pro.bookmarks).toBe("∞ UNLIMITED");
  });

  it("never promises out-of-plan features in tier copy (roadmap non-goals)", async () => {
    const { PRICING_CONFIG, LICENSE_FEATURES } = await import("../../constants/pricing");
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

  it("pins the support SLA by tier (sustainable at 1-maintainer scale)", async () => {
    const { PRICING_CONFIG } = await import("../../constants/pricing");
    expect(PRICING_CONFIG.support.tiers.free.response).toMatch(/best effort/i);
    expect(PRICING_CONFIG.support.tiers.pro.response).toMatch(/48h/i);
    expect(PRICING_CONFIG.support.note).toMatch(/cannot see your data/i);
  });
});
