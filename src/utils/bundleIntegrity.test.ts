import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  verifyBuildIdentity,
  clearManifestCache,
  checkBundleIntegrity,
} from "./bundleIntegrity";
import { getWindowBuildHash } from "./browser-types";

// Mock logger
vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("bundleIntegrity", () => {
  beforeEach(() => {
    clearManifestCache();
    // Reset the __BMF_BUILD_HASH__ window property
    delete getWindowBuildHash().__BMF_BUILD_HASH__;
    // Remove any injected manifest element
    const existing = document.getElementById("__BMF_INTEGRITY_MANIFEST__");
    if (existing) existing.remove();
  });

  describe("verifyBuildIdentity", () => {
    it("returns true when no manifest is available", () => {
      expect(verifyBuildIdentity()).toBe(true);
    });

    it("returns true when manifest has no buildHash", () => {
      const el = document.createElement("script");
      el.id = "__BMF_INTEGRITY_MANIFEST__";
      el.type = "application/json"; // prevent jsdom from executing as JS
      el.textContent = JSON.stringify({
        version: "1.0.0",
        buildHash: "",
        buildTime: "",
        files: {},
      });
      document.body.appendChild(el);

      expect(verifyBuildIdentity()).toBe(true);
      el.remove();
    });

    it("returns true when buildHash matches env hash", () => {
      getWindowBuildHash().__BMF_BUILD_HASH__ =
        "abc123";
      const el = document.createElement("script");
      el.id = "__BMF_INTEGRITY_MANIFEST__";
      el.type = "application/json";
      el.textContent = JSON.stringify({
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "",
        files: {},
      });
      document.body.appendChild(el);

      expect(verifyBuildIdentity()).toBe(true);
      el.remove();
    });

    it("returns false when buildHash does not match env hash", () => {
      getWindowBuildHash().__BMF_BUILD_HASH__ =
        "different-hash";
      const el = document.createElement("script");
      el.id = "__BMF_INTEGRITY_MANIFEST__";
      el.type = "application/json";
      el.textContent = JSON.stringify({
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "",
        files: {},
      });
      document.body.appendChild(el);

      expect(verifyBuildIdentity()).toBe(false);
      el.remove();
    });
  });

  describe("clearManifestCache", () => {
    it("does not throw when called", () => {
      expect(() => clearManifestCache()).not.toThrow();
    });
  });

  describe("checkBundleIntegrity", () => {
    it("returns a valid result structure", async () => {
      const result = await checkBundleIntegrity();
      expect(result).toHaveProperty("passed");
      expect(result).toHaveProperty("totalFiles");
      expect(result).toHaveProperty("matchedFiles");
      expect(result).toHaveProperty("mismatchedFiles");
      expect(result).toHaveProperty("missingFiles");
      expect(result).toHaveProperty("extraFiles");
      expect(result).toHaveProperty("checkedAt");
      expect(typeof result.checkedAt).toBe("string");
    });

    it("passes when no manifest files are defined", async () => {
      const result = await checkBundleIntegrity();
      expect(result.passed).toBe(true);
    });

    it("skips per-file check when manifest has no files", async () => {
      const el = document.createElement("script");
      el.id = "__BMF_INTEGRITY_MANIFEST__";
      el.type = "application/json";
      el.textContent = JSON.stringify({
        version: "1.0.0",
        buildHash: "abc",
        buildTime: "",
        files: {},
      });
      document.body.appendChild(el);

      const result = await checkBundleIntegrity();
      expect(result.passed).toBe(true);
      el.remove();
    });
  });
});
