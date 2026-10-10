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

    expect(LICENSE_CONFIG.signingServiceBaseUrl).toBe("/api/license");
    expect(LICENSE_CONFIG.planName).toBe("BookmarkForge Pro");
    expect(LICENSE_CONFIG.maxActivationsPerLicense).toBe(5);
    expect(LICENSE_CONFIG.trialDays).toBe(7);
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
    if (value !== undefined) vi.stubEnv("VITE_WHOP_CHECKOUT_URL", value);
    const { isCheckoutConfigured } = await loadLicenseConstants();
    expect(isCheckoutConfigured()).toBe(expected);
  });
});
