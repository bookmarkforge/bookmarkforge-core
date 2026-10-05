// @vitest-environment node
/**
 * scripts/__tests__/plan-manual-figures-update.test.mjs
 *
 * Adversarial suite for the change planner. The mechanism is differential:
 * re-run the shared evaluator with a sentinel truth and report the lines
 * that newly fail. Tests pin:
 *
 *   - spec validation (unknown key, non-numeric value, no-op → typed errors);
 *   - fail-closed baseline (red tree → "baseline" error, no plan);
 *   - exact-line planning across the manual corpus (freeMaxBookmarks and
 *     refundDays drills), including NEGATIVE planning (unrelated manuals);
 *   --pages planning over the generated surfaces (privacy-and-terms);
 *   - the stale-value warning (retired value still canonical elsewhere);
 *   - JSON output shape consumed by tooling.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPlan, failuresByLabel, PROBES } from "../plan-manual-figures-update.mjs";
import { MANUAL_LANGS } from "../check-manual-figures.mjs";

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

function makeRoot(files = {}) {
  tmpRoot = mkdtempSync(join(tmpdir(), "plan-figures-"));
  const base = {
    "src/constants/pricing.ts": PRICING_TS,
    "src/constants/license.ts": LICENSE_TS,
    "src/services/RecoveryService.ts": RECOVERY_TS,
    "src/constants/config.ts": CONFIG_TS,
  };
  for (const [rel, content] of Object.entries({ ...base, ...files })) {
    const p = join(tmpRoot, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  // All 30 manuals must exist and be figure-free so the baseline is green.
  for (const lang of MANUAL_LANGS) {
    const p = join(tmpRoot, "docs", `manual-usuario${lang}.md`);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, "nada\n");
  }
  return tmpRoot;
}

function writeManual(root, lang, body) {
  writeFileSync(join(root, "docs", `manual-usuario${lang}.md`), body);
}

describe("plan-manual-figures: spec validation", () => {
  it("rejects unknown keys with a typed usage error", () => {
    const root = makeRoot();
    expect(() => buildPlan(root, ["maxBookmarks=2000"])).toThrow(
      /unknown constant "maxBookmarks"/,
    );
  });

  it("rejects non-numeric values", () => {
    const root = makeRoot();
    expect(() => buildPlan(root, ["refundDays=abc"])).toThrow(/finite number/);
  });

  it("rejects a no-op change", () => {
    const root = makeRoot();
    expect(() => buildPlan(root, ["refundDays=30"])).toThrow(/nothing to do/);
  });

  it("exposes the planable key set for the CLI usage line", () => {
    expect(Object.keys(PROBES)).toContain("freeMaxBookmarks");
    expect(Object.keys(PROBES)).toContain("proRegularPrice");
  });
});

describe("plan-manual-figures: baseline and differential mechanism", () => {
  it("fails closed on a red baseline instead of misattributing lines", () => {
    const root = makeRoot();
    writeManual(root, "", "Pro is $49 lifetime.\n");
    expect(() => buildPlan(root, ["refundDays=45"])).toThrow(
      expect.objectContaining({ code: "baseline" }),
    );
  });

  it("plans exact manual lines for a freeMaxBookmarks change", () => {
    const root = makeRoot({
      // Wait: makeRoot already wrote manuals; pass nothing and edit below.
    });
    writeManual(root, "-en", "Store up to 1,000 bookmarks.\n");
    writeManual(root, "-de", "Speichere bis zu 1.000 Lesezeichen.\n");
    const plan = buildPlan(root, ["freeMaxBookmarks=2000"]);
    expect(plan.changes).toEqual([{ key: "freeMaxBookmarks", from: 1000, to: 2000 }]);
    expect(plan.actionable).toHaveLength(2);
    expect(plan.actionable[0]).toMatch(/^manual-usuario-de\.md:1: bookmark cap 1000 /);
    expect(plan.actionable[1]).toMatch(/^manual-usuario-en\.md:1: bookmark cap 1000 /);
    expect(plan.affectedFiles).toBe(2);
  });

  it("plans exact manual lines for a refundDays change", () => {
    const root = makeRoot();
    writeManual(root, "", "Reembolso: 30 días vía Whop.\n");
    const plan = buildPlan(root, ["refundDays=45"]);
    expect(plan.actionable).toEqual(["manual-usuario.md:1: refund window claims 30 days; pricing.ts says 45"]);
  });

  it("does not flag manuals whose lines are unaffected", () => {
    const root = makeRoot();
    writeManual(root, "-ja", "Pro is $79 lifetime; upgrade from v2 is $89.\n");
    const plan = buildPlan(root, ["refundDays=90"]);
    expect(plan.actionable).toEqual([]);
  });

  it("supports several --set specs in one plan", () => {
    const root = makeRoot();
    writeManual(root, "", "Reembolso: 30 días vía Whop.\n");
    const plan = buildPlan(root, ["refundDays=45", "revalidationHours=96"]);
    expect(plan.changes).toHaveLength(2);
    expect(plan.actionable).toEqual(["manual-usuario.md:1: refund window claims 30 days; pricing.ts says 45"]);
  });
});

describe("plan-manual-figures: pages and warnings", () => {
  it("plans affected page lines with --pages", () => {
    const root = makeRoot();
    const p = join(root, "public");
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, "privacy-and-terms.html"), "<p>we show a 24-word recovery phrase once.</p>\n");
    const plan = buildPlan(root, ["recoveryWords=30"], { pages: true });
    expect(plan.actionable).toContainEqual(
      "public/privacy-and-terms.html:1: recovery phrase claims 24 words; RecoveryService enforces 30",
    );
  });

  it("without --pages it ignores page drift", () => {
    const root = makeRoot();
    const p = join(root, "public");
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, "privacy-and-terms.html"), "<p>we show a 24-word recovery phrase once.</p>\n");
    const plan = buildPlan(root, ["recoveryWords=30"], { pages: false });
    expect(plan.actionable).toEqual([]);
  });

  it("warns when the retired value remains canonical elsewhere", () => {
    const root = makeRoot();
    // proPrice 79→70 leaves 79 canonical via proRegularPrice: the pricing
    // table keeps quoting 79 and the gate cannot flag it.
    const plan = buildPlan(root, ["proPrice=70"]);
    expect(plan.stale).toEqual([{ key: "proPrice", from: 79, to: 70 }]);
    expect(plan.actionable).toEqual([]);
  });

  it("does not warn when the retired value leaves the canonical sets", () => {
    const root = makeRoot();
    const plan = buildPlan(root, ["refundDays=45"]);
    expect(plan.stale).toEqual([]);
  });

  it("emits machine-readable JSON for tooling", () => {
    const root = makeRoot();
    writeManual(root, "-en", "Store up to 1,000 bookmarks.\n");
    const plan = buildPlan(root, ["freeMaxBookmarks=444"]);
    expect(plan.actionable).toHaveLength(1);
    expect(plan.affectedFiles).toBe(1);
    const grouped = failuresByLabel(plan.actionable);
    expect(grouped.get("manual-usuario-en.md")).toHaveLength(1);
  });
});
