// src/tests/utils/bundleIntegrity.test.ts
//
// Tests for bundle integrity validator.
// Simplified tests focused on core functionality without complex DOM mocking.

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  verifyBuildIdentity,
  getBuildHash,
  clearManifestCache,
  setForceIntegrityCheck,
} from "../../utils/bundleIntegrity";

describe("bundleIntegrity", () => {
  beforeEach(() => {
    // Clear manifest cache before each test
    clearManifestCache();
    setForceIntegrityCheck(false);
  });

  afterEach(() => {
    delete window.__BMF_BUILD_HASH__;
  });

  describe("getBuildHash", () => {
    test("returns window property when set", () => {
      window.__BMF_BUILD_HASH__ = "test-hash-123";

      const hash = getBuildHash();
      expect(hash).toBe("test-hash-123");
    });

    test("returns empty string when no hash available", () => {
      const hash = getBuildHash();
      expect(hash).toBe("");
    });
  });

  describe("clearManifestCache", () => {
    test("clears cache when called", () => {
      window.__BMF_BUILD_HASH__ = "abc123";

      const firstHash = getBuildHash();
      expect(firstHash).toBe("abc123");

      clearManifestCache();

      // Should still read from window (cache only affects manifest element)
      const secondHash = getBuildHash();
      expect(secondHash).toBe("abc123");
    });
  });

  describe("verifyBuildIdentity", () => {
    test("returns true when no hashes available", () => {
      const result = verifyBuildIdentity();
      expect(result).toBe(true);
    });

    test("returns true when only window hash set", () => {
      window.__BMF_BUILD_HASH__ = "manifest-hash";

      const result = verifyBuildIdentity();
      expect(result).toBe(true);
    });

    test("returns true when no window hash", () => {
      import.meta.env.VITE_BUILD_HASH = "env-hash";

      const result = verifyBuildIdentity();
      expect(result).toBe(true);

      delete import.meta.env.VITE_BUILD_HASH;
    });

    test("returns true when no env hash", () => {
      window.__BMF_BUILD_HASH__ = "manifest-hash";

      const result = verifyBuildIdentity();
      expect(result).toBe(true);
    });
  });

  describe("setForceIntegrityCheck", () => {
    test("can be toggled on and off", () => {
      setForceIntegrityCheck(true);
      expect(() => setForceIntegrityCheck(false)).not.toThrow();
    });
  });

  describe("security invariants", () => {
    test("handles missing build hash gracefully", () => {
      const hash = getBuildHash();
      expect(hash).toBe("");
      expect(() => verifyBuildIdentity()).not.toThrow();
    });

    test("handles empty build hash", () => {
      window.__BMF_BUILD_HASH__ = "";

      const hash = getBuildHash();
      expect(hash).toBe("");

      delete window.__BMF_BUILD_HASH__;
    });
  });
});
