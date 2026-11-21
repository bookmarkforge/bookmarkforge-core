import { describe, it, expect } from "vitest";
import { constantTimeCompare } from "../../../services/security-vault/compare";

/**
 * Direct unit tests for the constant-time comparison primitive
 * (src/services/security-vault/compare.ts). The timing-safety property is
 * additionally pinned by p3-constant-time-hmac.regression.test.ts; these
 * tests lock the correctness contract (equal bytes ⇔ true).
 */
describe("constantTimeCompare", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeCompare("password", "password")).toBe(true);
  });

  it("returns true for empty strings", () => {
    expect(constantTimeCompare("", "")).toBe(true);
  });

  it("returns false when lengths differ", () => {
    expect(constantTimeCompare("a", "aa")).toBe(false);
    expect(constantTimeCompare("aaaa", "a")).toBe(false);
  });

  it("returns false for same-length strings with different content", () => {
    expect(constantTimeCompare("password", "passwore")).toBe(false);
    expect(constantTimeCompare("abc", "abd")).toBe(false);
  });

  it("is case sensitive", () => {
    expect(constantTimeCompare("Secret", "secret")).toBe(false);
  });

  it("handles Unicode input by UTF-8 bytes", () => {
    expect(constantTimeCompare("ñandú", "ñandú")).toBe(true);
    // Different byte lengths under UTF-8 must never compare equal.
    expect(constantTimeCompare("café", "cafe")).toBe(false);
    expect(constantTimeCompare("😀", "😀")).toBe(true);
  });

  it("compares long strings correctly", () => {
    const a = "x".repeat(4096);
    const b = "x".repeat(4096);
    expect(constantTimeCompare(a, b)).toBe(true);
    expect(constantTimeCompare(a, `${a.slice(0, -1)}y`)).toBe(false);
  });

  it("matches plain equality for a sweep of inputs", () => {
    for (let length = 1; length <= 24; length += 1) {
      const value = "k".repeat(length);
      expect(constantTimeCompare(value, value)).toBe(true);
      expect(constantTimeCompare(value, `${value}z`)).toBe(false);
      const mutated = `j${value.slice(1)}`;
      expect(constantTimeCompare(mutated, value)).toBe(false);
    }
  });

  it("never treats different content as equal regardless of prefix", () => {
    const sharedPrefix = "shared-prefix-";
    expect(
      constantTimeCompare(`${sharedPrefix}alpha`, `${sharedPrefix}beta`),
    ).toBe(false);
  });
});
