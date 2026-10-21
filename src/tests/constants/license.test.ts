import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadLicenseConstants() {
  vi.resetModules();
  return import("../../constants/license");
}

describe("constants/license", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("exports the expected Pro and free-tier configuration", async () => {
    const { LICENSE_CONFIG, FREE_LIMITS } = await loadLicenseConstants();

    expect(LICENSE_CONFIG.planName).toBe("BookmarkForge Pro");
    // Offline-first: a validated license stays trusted for 48 h.
    expect(LICENSE_CONFIG.cacheTtlMs).toBe(48 * 60 * 60 * 1000);
    expect(LICENSE_CONFIG.storageKeys.licenseKey).toBe("bf_license_key");
    expect(FREE_LIMITS).toEqual({ maxBookmarks: 2500, maxDevices: 0 });
  });

  it.each([
    ["missing URL", undefined, false],
    ["empty URL", "", false],
    ["valid HTTPS URL", "https://checkout.example.com/pro", true],
    ["HTTP URL", "http://checkout.example.com/pro", false],
    ["URL with username", "https://user@checkout.example.com/pro", false],
    ["URL with password", "https://user:secret@checkout.example.com/pro", false],
    ["malformed URL", "not a URL", false],
  ])("validates %s", async (_label, value, expected) => {
    // Stub both per-plan URLs (LICENSE_CONFIG no longer reads the legacy
    // single-URL alias) and always override the checkout pair: a local
    // `.env.local` that configures a real checkout would otherwise make the
    // "missing URL" row read a value and fail.
    vi.stubEnv("VITE_WHOP_CHECKOUT_URL_EARLY", value ?? "");
    vi.stubEnv("VITE_WHOP_CHECKOUT_URL_REGULAR", value ?? "");
    const { isCheckoutConfigured } = await loadLicenseConstants();
    expect(isCheckoutConfigured()).toBe(expected);
  });
});
