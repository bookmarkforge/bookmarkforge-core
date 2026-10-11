// @vitest-environment node
/**
 * scripts/__tests__/early-bird-status.test.mjs
 *
 * The Early Bird phase signal and the landing switch that consumes it.
 *
 * Regression being pinned: public/landing.js probed `/api/early-bird-status`,
 * which had no producer at all (a static Vite build behind a catch-all
 * rewrite answered the request with index.html, `response.json()` threw, and
 * the `catch {}` swallowed it) — so the sell-out switch could never fire. On
 * top of that, the two Whop plan ids the switch selected on
 * (plan_9oP0DrBuqFEb7 / plan_FTmrDjPDKqQVC) appear in no landing page, so the
 * card lookup returned null and the probe never even ran.
 *
 * Pinned here:
 *   - the phase → `available` mapping (early ⇒ true; regular/full/disabled ⇒
 *     false) and the price/label it carries;
 *   - fail-closed parsing: an unparseable or contradictory pricing.ts throws
 *     instead of guessing `available: true`;
 *   - the committed public/api/early-bird-status.json equals what the
 *     generator derives today;
 *   - the artifact the landing fetches is the artifact the generator writes,
 *     and every checkout plan id landing.js selects on exists in a landing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  PHASES,
  PRICING_SOURCE,
  ROOT,
  STATUS_RELPATH,
  STATUS_URL,
  deriveStatus,
  deriveStatusJson,
  readPricingTruth,
} from "../generate-early-bird-status.mjs";
import { checkEarlyBirdStatus } from "../check-landings-fresh.mjs";

const PRICING_SRC = readFileSync(PRICING_SOURCE, "utf8");
const PUBLIC_DIR = join(ROOT, "public");
const STATUS_FILE = join(PUBLIC_DIR, STATUS_RELPATH);
const LANDING_JS = readFileSync(join(PUBLIC_DIR, "landing.js"), "utf8");

/** Minimal pricing.ts shaped like the real one, for adversarial cases. */
function pricingSrc({
  phase = "early",
  enabled = true,
  cap = 200,
  pro = 59,
  earlyBirdPrice = 59,
} = {}) {
  return `
export const PRICING_CONFIG = {
  tiers: [
    { id: "free", limitations: { maxBookmarks: 2500 } },
    {
      id: "pro",
      earlyBirdPrice: ${earlyBirdPrice},
      regularPrice: 79,
      fullPrice: 99,
      currency: "USD",
      limitations: { maxBookmarks: Infinity },
    },
  ],
  earlyBird: {
    enabled: ${enabled},
    phase: "${phase}" as "early" | "regular" | "full",
    caps: { early: ${cap} },
    phases: {
      early: { label: "Early Bird", tagline: "Launch price", validUntilWeeks: 2, pro: ${pro} },
      regular: { label: "Regular v1", tagline: "Lifetime of v1", validUntilWeeks: 26, pro: 79 },
      full: { label: "Full Price", tagline: "After traction", pro: 99 },
    },
  },
};
`;
}

let tmpRoot;

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  }
});

describe("deriveStatus — phase → availability", () => {
  it("reports the Early Bird as available while the phase is `early`", () => {
    const status = deriveStatus(PRICING_SRC);
    expect(status).toEqual({
      available: true,
      phase: "early",
      label: "Early Bird",
      price: 59,
      regularPrice: 79,
      cap: 200,
      currency: "USD",
    });
  });

  it("stops offering it once the phase moves on, carrying the next price", () => {
    const regular = deriveStatus(pricingSrc({ phase: "regular" }));
    expect(regular.available).toBe(false);
    expect(regular.price).toBe(79);
    expect(regular.label).toBe("Regular v1");

    const full = deriveStatus(pricingSrc({ phase: "full" }));
    expect(full.available).toBe(false);
    expect(full.price).toBe(99);
    expect(full.label).toBe("Full Price");
  });

  it("treats a disabled Early Bird as unavailable in every phase", () => {
    expect(deriveStatus(pricingSrc({ enabled: false })).available).toBe(false);
    expect(deriveStatus(pricingSrc({ enabled: false, phase: "regular" })).available).toBe(false);
  });

  it("reads the license cap, never a hardcoded 200", () => {
    expect(deriveStatus(pricingSrc({ cap: 137 })).cap).toBe(137);
  });
});

describe("readPricingTruth — fail closed on anything unreadable", () => {
  it("throws on an unknown phase rather than guessing", () => {
    expect(() => deriveStatus(pricingSrc({ phase: "promo" }))).toThrow(/unknown earlyBird\.phase/);
  });

  it("throws when the earlyBird block is gone (refactor)", () => {
    expect(() => readPricingTruth("export const PRICING_CONFIG = { tiers: [] };")).toThrow(
      /no `earlyBird` block/,
    );
  });

  it("throws when the Pro tier price contradicts the phase table", () => {
    expect(() => deriveStatus(pricingSrc({ earlyBirdPrice: 49 }))).toThrow(/price drift/);
  });

  it("throws when the Early Bird price does not undercut the regular one", () => {
    expect(() => deriveStatus(pricingSrc({ pro: 99, earlyBirdPrice: 99 }))).toThrow(
      /must undercut the regular price/,
    );
  });

  it("throws when the license cap is not positive", () => {
    expect(() => deriveStatus(pricingSrc({ cap: 0 }))).toThrow(/positive license count/);
  });

  it("declares exactly the phases the ladder is parsed from", () => {
    expect(PHASES).toEqual(["early", "regular", "full"]);
  });
});

describe("the committed artifact", () => {
  it("public/api/early-bird-status.json is what pricing.ts derives today", () => {
    const committed = readFileSync(STATUS_FILE, "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(deriveStatusJson());
  });

  it("is valid JSON describing the active phase", () => {
    const parsed = JSON.parse(readFileSync(STATUS_FILE, "utf8"));
    expect(typeof parsed.available).toBe("boolean");
    expect(parsed.phase).toBe(readPricingTruth(PRICING_SRC).phase);
    expect(parsed.price).toBeGreaterThan(0);
  });
});

describe("check-landings-fresh covers the artifact", () => {
  it("fails when it is missing", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "early-bird-status-"));
    const result = checkEarlyBirdStatus({ publicDir: tmpRoot });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toMatch(/missing/);
  });

  it("fails when it drifted from pricing.ts", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "early-bird-status-"));
    mkdirSync(join(tmpRoot, "api"), { recursive: true });
    writeFileSync(join(tmpRoot, STATUS_RELPATH), '{\n  "available": true\n}\n', "utf8");
    const result = checkEarlyBirdStatus({ publicDir: tmpRoot });
    expect(result.failures[0].reason).toMatch(/stale/);
  });

  it("passes on a fresh copy (CRLF checkout included)", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "early-bird-status-"));
    mkdirSync(join(tmpRoot, "api"), { recursive: true });
    writeFileSync(join(tmpRoot, STATUS_RELPATH), deriveStatusJson().replace(/\n/g, "\r\n"), "utf8");
    expect(checkEarlyBirdStatus({ publicDir: tmpRoot }).failures).toEqual([]);
  });
});

describe("landing.js wiring — the switch can actually reach the artifact", () => {
  it("fetches the artifact path the generator writes", () => {
    expect(LANDING_JS).toContain(`EARLY_BIRD_STATUS_URL = '${STATUS_URL}'`);
    expect(STATUS_URL).toBe(`/${STATUS_RELPATH}`);
  });

  it("selects on checkout plan ids that exist in a landing page", () => {
    const urls = (text) =>
      new Set(text.match(/https:\/\/whop\.com\/checkout\/plan_[A-Za-z0-9]+/g) ?? []);
    const rendered = new Set(
      readdirSync(PUBLIC_DIR)
        .filter((f) => f.endsWith(".html"))
        .flatMap((f) => [...urls(readFileSync(join(PUBLIC_DIR, f), "utf8"))]),
    );
    const referenced = [...urls(LANDING_JS)];
    expect(referenced.length).toBeGreaterThan(0);
    for (const url of referenced) {
      expect(
        rendered.has(url),
        `${url} is referenced by landing.js but no landing page links it — the pricing-card switch would silently no-op`,
      ).toBe(true);
    }
  });
});

describe("generator CLI surface", () => {
  it("keeps the artifact where the deploy serves it", () => {
    expect(STATUS_RELPATH).toBe("api/early-bird-status.json");
    expect(dirname(join(PUBLIC_DIR, STATUS_RELPATH))).toBe(join(PUBLIC_DIR, "api"));
  });
});
