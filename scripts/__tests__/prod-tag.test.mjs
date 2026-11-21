import { describe, expect, it } from "vitest";
import { extractSha, selectAutoTarget } from "../rollback.mjs";
import {
  buildProdTagName,
  localStamp,
  sameBuildTags,
  validateProdTagName,
} from "../prod-tag.mjs";

// Local-time constructor: the stamp is local by design (deploy-prod.mjs), so a
// UTC literal would make these assertions timezone-dependent.
const FIXED_NOW = new Date(2026, 7, 31, 13, 20);

describe("localStamp", () => {
  it("formats local time as YYYYMMDD-HHMM", () => {
    expect(localStamp(FIXED_NOW)).toBe("20260831-1320");
    expect(localStamp(new Date(2026, 0, 5, 4, 7))).toBe("20260105-0407");
  });
});

describe("buildProdTagName", () => {
  it("builds the shape deploy-prod.mjs creates and rollback.mjs parses", () => {
    const name = buildProdTagName({ sha: "ab12cd3", now: FIXED_NOW });
    expect(name).toBe("prod-20260831-1320-ab12cd3");
    expect(validateProdTagName(name)).toEqual({ ok: true, reasons: [], sha: "ab12cd3" });
    expect(extractSha(name)).toBe("ab12cd3");
  });

  it("lowercases the SHA so two spellings cannot create two builds", () => {
    expect(buildProdTagName({ sha: "AB12CD3", now: FIXED_NOW })).toBe("prod-20260831-1320-ab12cd3");
    expect(sameBuildTags(["prod-20260830-0900-ab12cd3"], "AB12CD3")).toEqual([
      "prod-20260830-0900-ab12cd3",
    ]);
  });

  it("accepts a git-extended short SHA up to 12 characters", () => {
    const name = buildProdTagName({ sha: "ab12cd3e4f5", now: FIXED_NOW });
    expect(validateProdTagName(name).ok).toBe(true);
  });

  it("returns an empty name when the SHA cannot identify a build", () => {
    for (const sha of ["", "   ", "abc123", "ab12cd3e4f5a6", "not-a-sha", "ab12cd3dirty"]) {
      expect(buildProdTagName({ sha, now: FIXED_NOW })).toBe("");
    }
  });
});

describe("validateProdTagName", () => {
  it("rejects names without the prod- prefix", () => {
    const result = validateProdTagName("v1-20260831-1320-ab12cd3");
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("must start with `prod-`");
  });

  it("rejects anything after the SHA, which breaks dedup by commit", () => {
    const result = validateProdTagName("prod-20260831-1320-ab12cd3-dirty");
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/must end with the 7-12 character short SHA/);
  });

  it("rejects a full 40-character SHA", () => {
    const result = validateProdTagName(`prod-20260831-1320-${"a".repeat(40)}`);
    expect(result.ok).toBe(false);
  });

  it("rejects calendar fields a hand-typed timestamp gets wrong", () => {
    expect(validateProdTagName("prod-20261331-1320-ab12cd3").reasons).toContain(
      "month 13 is outside 01-12",
    );
    expect(validateProdTagName("prod-20260231-1320-ab12cd3").reasons).toContain(
      "day 31 does not exist in 2026-02",
    );
    expect(validateProdTagName("prod-20260831-2420-ab12cd3").reasons).toContain(
      "hour 24 is outside 00-23",
    );
    expect(validateProdTagName("prod-20260831-1260-ab12cd3").reasons).toContain(
      "minute 60 is outside 00-59",
    );
  });

  it("rejects surrounding whitespace instead of trimming it silently", () => {
    expect(validateProdTagName(" prod-20260831-1320-ab12cd3").ok).toBe(false);
    expect(validateProdTagName(undefined).ok).toBe(false);
  });

  it("produces tags the auto-rollback selector can tell apart by build", () => {
    const older = "prod-20260830-0900-1111111";
    const newer = buildProdTagName({ sha: "ab12cd3", now: FIXED_NOW });
    // Newest first, as `git tag --sort=-creatordate` returns them.
    expect(selectAutoTarget([newer, older])).toBe(older);
    // Same commit twice: no distinct target, which is why the duplicate warning exists.
    expect(selectAutoTarget([newer, "prod-20260831-1200-ab12cd3", older])).toBe(older);
  });
});

describe("sameBuildTags", () => {
  it("finds existing tags over one commit and ignores other builds", () => {
    const tags = [
      "prod-20260831-1320-ab12cd3",
      "prod-20260830-0900-AB12CD3",
      "prod-20260829-0800-deadbee",
      "v1.0.0",
    ];
    expect(sameBuildTags(tags, "ab12cd3")).toEqual([
      "prod-20260831-1320-ab12cd3",
      "prod-20260830-0900-AB12CD3",
    ]);
    expect(sameBuildTags(tags, "")).toEqual([]);
    expect(sameBuildTags(null, "ab12cd3")).toEqual([]);
  });
});
