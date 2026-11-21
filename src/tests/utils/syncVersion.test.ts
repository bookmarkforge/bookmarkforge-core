import { describe, expect, it } from "vitest";
import { compareRxRevision } from "../../utils/syncVersion";

describe("compareRxRevision", () => {
  it("compares revision heights numerically", () => {
    expect(compareRxRevision("9-peer-a", "10-peer-b")).toBeLessThan(0);
    expect(compareRxRevision("10-peer-b", "9-peer-a")).toBeGreaterThan(0);
  });

  it("does not lose precision on very large revision heights", () => {
    expect(
      compareRxRevision(
        "900719925474099300000-peer-a",
        "900719925474099400000-peer-b",
      ),
    ).toBeLessThan(0);
  });

  it("uses the revision hash as the deterministic same-height tie-break", () => {
    expect(compareRxRevision("12-aaa", "12-bbb")).toBeLessThan(0);
    expect(compareRxRevision("12-bbb", "12-aaa")).toBeGreaterThan(0);
  });

  it("falls back deterministically for malformed revisions", () => {
    expect(compareRxRevision("malformed-a", "malformed-b")).toBeLessThan(0);
    expect(compareRxRevision("malformed-b", "malformed-a")).toBeGreaterThan(0);
  });
});
