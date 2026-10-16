import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateSecureToken } from "../../utils/secureRandom";

describe("secureRandom", () => {
  it("generateSecureToken returns hex string of default length 32", () => {
    const token = generateSecureToken();
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
    expect(token.length).toBe(64);
  });

  it("generateSecureToken respects custom length", () => {
    const token = generateSecureToken(16);
    expect(token.length).toBe(32);
  });

  it("generateSecureToken produces hex characters only", () => {
    const token = generateSecureToken(16);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("generateSecureToken returns different values on successive calls", () => {
    const a = generateSecureToken();
    const b = generateSecureToken();
    expect(a).not.toBe(b);
  });

  describe("fallback when crypto is unavailable", () => {
    const originalCrypto = globalThis.crypto;

    beforeEach(() => {
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        writable: true,
        configurable: true,
      });
    });

    it("throws when crypto is not available", () => {
      expect(() => generateSecureToken()).toThrow("CRYPTO_UNAVAILABLE");
    });
  });
});
