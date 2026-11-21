import { describe, it, expect, vi, beforeEach } from "vitest";
import { licenseService, LicenseError, isFreeLimitError } from "../../services/LicenseService";
import { LICENSE_CONFIG } from "../../constants/license";
import * as licenseSigning from "../../services/licenseSigning";

vi.mock("../../utils/networkFirewall", () => ({
  firewalledFetch: vi.fn(),
  setFirewallDisabled: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../services/AuditLogService", () => ({
  auditLog: {
    record: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    setSecret: vi.fn().mockResolvedValue(undefined),
    getSecret: vi.fn().mockResolvedValue(null),
    deleteSecret: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../store/safeStorage", () => ({
  safeGet: vi.fn(),
  safeSet: vi.fn(),
  safeRemove: vi.fn(),
}));

vi.mock("../../services/ai/utils", () => ({
  readBoundedResponseJson: vi.fn(),
}));

const { firewalledFetch } = await import("../../utils/networkFirewall");
const { safeGet, safeSet, safeRemove } = await import("../../store/safeStorage");
const { readBoundedResponseJson } = await import("../../services/ai/utils");

describe("LicenseService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (safeGet as any).mockReturnValue(null);
    licenseService["clearState"]();
  });

  it("generates a device ID", () => {
    const id = licenseService.getDeviceId();
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
  });

  it("returns false when no license is activated", () => {
    expect(licenseService.hasLicense()).toBe(false);
  });

  it("returns free plan when no license", () => {
    const entitlements = licenseService.getEntitlements();
    expect(entitlements.plan).toBe("free");
    expect(entitlements.source).toBe("none");
  });

  it("returns false for free plan", () => {
    expect(licenseService.hasProAccess()).toBe(false);
  });

  it("throws LicenseError for empty key", async () => {
    await expect(licenseService.activate("")).rejects.toThrow(LicenseError);
  });

  it("throws LicenseError NETWORK when the license service is unreachable", async () => {
    (firewalledFetch as any).mockRejectedValue(new Error("offline"));
    await expect(licenseService.activate("test-key")).rejects.toMatchObject({
      name: "LicenseError",
      code: "NETWORK",
    });
  });

  it("isFreeLimitError returns true for FREE_LIMIT_REACHED error", () => {
    const error = new LicenseError("Test", "FREE_LIMIT_REACHED");
    expect(isFreeLimitError(error)).toBe(true);
  });

  it("isFreeLimitError returns false for other errors", () => {
    const error = new LicenseError("Test", "INVALID_KEY");
    expect(isFreeLimitError(error)).toBe(false);
    expect(isFreeLimitError(new Error("Test"))).toBe(false);
  });

  it("clears license state on deactivate", async () => {
    await licenseService.deactivate();
    expect(safeRemove).toHaveBeenCalled();
  });

  it("canAddBookmarks returns true for pro users", async () => {
    const result = await licenseService.canAddBookmarks(299);
    expect(result).toBe(true);
  });

  it("canAddBookmarks returns false when over free limit", async () => {
    const result = await licenseService.canAddBookmarks(1000);
    expect(result).toBe(false);
  });

  describe("signed license pipeline (A6)", () => {
    let deviceId: string;
    let mockPayload: licenseSigning.LicensePayload;
    let mockSignature: string;
    let verifySpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // The mocked safeGet never persists, so getDeviceId() would mint a
      // fresh UUID per call and every payload would fail the device binding.
      // Pin the device id for the whole describe block.
      (safeGet as any).mockImplementation((key: string) =>
        key === LICENSE_CONFIG.storageKeys.deviceId ? "test-device-id" : null,
      );
      deviceId = licenseService.getDeviceId();
      mockPayload = {
        v: 1,
        deviceId,
        validatedAt: Date.now(),
        expiresAt: undefined,
        activationsLeft: 1,
      };
      mockSignature = "test-signature";
      verifySpy = vi.spyOn(licenseSigning, "verifyLicensePayload").mockResolvedValue(true);
    });

    afterEach(() => {
      verifySpy.mockRestore();
    });

    it("activates a license by calling the license service and verifying the signature", async () => {
      const mockResponse = {
        payload: mockPayload,
        signature: mockSignature,
        seatToken: "seat-abc",
      };
      vi.mocked(readBoundedResponseJson).mockResolvedValue(mockResponse);
      vi.mocked(firewalledFetch).mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const entitlements = await licenseService.activate("BF-TEST-KEY");

      expect(entitlements.plan).toBe("pro");
      expect(entitlements.source).toBe("license");
      expect(firewalledFetch).toHaveBeenCalledWith(
        "/api/license/activate",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("BF-TEST-KEY"),
        }),
        "LicenseService",
      );
      expect(verifySpy).toHaveBeenCalledWith(mockPayload, mockSignature);
    });

    it("rejects activation when the signature fails verification", async () => {
      verifySpy.mockResolvedValue(false);
      const mockResponse = {
        payload: mockPayload,
        signature: mockSignature,
      };
      vi.mocked(readBoundedResponseJson).mockResolvedValue(mockResponse);
      vi.mocked(firewalledFetch).mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      await expect(licenseService.activate("BF-TEST-KEY")).rejects.toMatchObject({
        name: "LicenseError",
        code: "SERVER",
      });
    });

    it("validates in the background and keeps cached state on network failure", async () => {
      // Pre-populate a cached license with a stale timestamp to force background validation.
      const stalePayload = { ...mockPayload, validatedAt: Date.now() - (LICENSE_CONFIG.cacheTtlMs + 1000) };
      const cachedRecord = JSON.stringify({
        v: 1,
        payload: stalePayload,
        signature: mockSignature,
      });
      (safeGet as any).mockImplementation((key: string) =>
        key === LICENSE_CONFIG.storageKeys.licenseState ? cachedRecord :
        key === LICENSE_CONFIG.storageKeys.deviceId ? "test-device-id" : null,
      );
      // Reset stateLoaded so loadState() reads from storage again.
      licenseService["stateLoaded"] = false;
      licenseService["state"] = null;
      licenseService["signatureCheck"] = null;
      licenseService["signatureVerified"] = false;
      const verified = await licenseService.verifyCachedState();
      expect(verified).toBe(true);
      expect(licenseService.hasProAccess()).toBe(true);

      // Background validation hits network error.
      vi.mocked(firewalledFetch).mockRejectedValue(new Error("offline"));

      const stillValid = await licenseService.validateInBackground();
      expect(stillValid).toBe(true); // offline grace
      expect(licenseService.hasProAccess()).toBe(true);
    });

    it("downgrades to Free on explicit invalid response", async () => {
      const stalePayload = { ...mockPayload, validatedAt: Date.now() - (LICENSE_CONFIG.cacheTtlMs + 1000) };
      const cachedRecord = JSON.stringify({
        v: 1,
        payload: stalePayload,
        signature: mockSignature,
      });
      (safeGet as any).mockImplementation((key: string) =>
        key === LICENSE_CONFIG.storageKeys.licenseState ? cachedRecord :
        key === LICENSE_CONFIG.storageKeys.deviceId ? "test-device-id" : null,
      );
      licenseService["stateLoaded"] = false;
      licenseService["state"] = null;
      licenseService["signatureCheck"] = null;
      licenseService["signatureVerified"] = false;
      await licenseService.verifyCachedState();

      // Mock secure storage to return the license key.
      const { secureStorage } = await import("../../services/SecureStorage");
      vi.mocked(secureStorage.getSecret).mockImplementation(async (key: string) => {
        if (key === "bf_license_key_secure") {return "BF-TEST-KEY";}
        return null;
      });

      vi.mocked(readBoundedResponseJson).mockResolvedValue({
        error: { code: "INVALID_KEY", message: "License revoked" },
      });
      vi.mocked(firewalledFetch).mockResolvedValue({
        ok: false,
        status: 400,
      } as Response);

      const stillValid = await licenseService.validateInBackground();
      expect(stillValid).toBe(false);
      expect(licenseService.hasProAccess()).toBe(false);
    });

    it("deactivates by calling the license service and clearing local state", async () => {
      const stalePayload = { ...mockPayload, validatedAt: Date.now() - (LICENSE_CONFIG.cacheTtlMs + 1000) };
      const cachedRecord = JSON.stringify({
        v: 1,
        payload: stalePayload,
        signature: mockSignature,
      });
      (safeGet as any).mockImplementation((key: string) =>
        key === LICENSE_CONFIG.storageKeys.licenseState ? cachedRecord :
        key === LICENSE_CONFIG.storageKeys.deviceId ? "test-device-id" : null,
      );
      licenseService["stateLoaded"] = false;
      licenseService["state"] = null;
      licenseService["signatureCheck"] = null;
      licenseService["signatureVerified"] = false;
      await licenseService.verifyCachedState();

      // Mock secure storage to return the license key.
      const { secureStorage } = await import("../../services/SecureStorage");
      vi.mocked(secureStorage.getSecret).mockImplementation(async (key: string) => {
        if (key === "bf_license_key_secure") {return "BF-TEST-KEY";}
        if (key === "bf_license_seat_token_secure") {return "seat-abc";}
        return null;
      });

      vi.mocked(firewalledFetch).mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);
      vi.mocked(readBoundedResponseJson).mockResolvedValue({});

      await licenseService.deactivate();

      expect(firewalledFetch).toHaveBeenCalledWith(
        "/api/license/deactivate",
        expect.objectContaining({
          method: "POST",
        }),
        "LicenseService",
      );
      expect(safeRemove).toHaveBeenCalled();
      expect(licenseService.hasProAccess()).toBe(false);
    });

    it("downgrades to Free when the cached signature is invalid on load", async () => {
      const cachedRecord = JSON.stringify({
        v: 1,
        payload: mockPayload,
        signature: "bad-signature",
      });
      (safeGet as any).mockReturnValue(cachedRecord);
      verifySpy.mockResolvedValue(false);

      const verified = await licenseService.verifyCachedState();
      expect(verified).toBe(false);
      expect(licenseService.hasProAccess()).toBe(false);
    });

    it("rejects a cached record bound to a different device", async () => {
      const otherDeviceRecord = JSON.stringify({
        v: 1,
        payload: { ...mockPayload, deviceId: "other-device-id" },
        signature: mockSignature,
      });
      (safeGet as any).mockReturnValue(otherDeviceRecord);

      const verified = await licenseService.verifyCachedState();
      expect(verified).toBe(false);
      expect(licenseService.hasProAccess()).toBe(false);
    });

    function seedCachedRecord(record: Record<string, unknown>): void {
      const cachedRecord = JSON.stringify(record);
      (safeGet as any).mockImplementation((key: string) =>
        key === LICENSE_CONFIG.storageKeys.licenseState ? cachedRecord :
        key === LICENSE_CONFIG.storageKeys.deviceId ? "test-device-id" : null,
      );
      licenseService["stateLoaded"] = false;
      licenseService["state"] = null;
      licenseService["signatureCheck"] = null;
      licenseService["signatureVerified"] = false;
    }

    it("denies Pro in the FRESH branch when expiresAt already passed (N10)", async () => {
      seedCachedRecord({
        v: 1,
        payload: {
          ...mockPayload,
          validatedAt: Date.now(),
          expiresAt: Date.now() - 1000,
        },
        signature: mockSignature,
      });
      await licenseService.verifyCachedState();
      const entitlements = licenseService.getEntitlements();
      expect(entitlements.plan).toBe("free");
      expect(licenseService.hasProAccess()).toBe(false);
    });

    it("denies Pro beyond the hard offline grace ceiling even for lifetime licenses (N4)", async () => {
      const staleValidatedAt = Date.now() - (31 * 24 * 60 * 60 * 1000);
      seedCachedRecord({
        v: 1,
        payload: { ...mockPayload, validatedAt: staleValidatedAt, expiresAt: undefined },
        signature: mockSignature,
      });
      await licenseService.verifyCachedState();
      // Past the 30-day revalidation bound: no Pro, but the state is kept so
      // a successful background re-validation can recover it.
      expect(licenseService.getEntitlements().plan).toBe("free");
      expect(licenseService.hasLicense()).toBe(true);
    });

    it("honors the monotonic lastSeenAt floor against clock rollback (N4)", async () => {
      // Simulates a record last seen "in the future" relative to a rolled-back
      // clock: effectiveNow = lastSeenAt must still trip expiresAt.
      const future = Date.now() + 60 * 60 * 1000;
      seedCachedRecord({
        v: 1,
        payload: {
          ...mockPayload,
          validatedAt: Date.now() - 1000,
          expiresAt: future - 30 * 60 * 1000,
        },
        signature: mockSignature,
        lastSeenAt: future,
      });
      await licenseService.verifyCachedState();
      expect(licenseService.getEntitlements().plan).toBe("free");
    });

    it("initializes lastSeenAt from validatedAt for legacy records", async () => {
      const validatedAt = Date.now() - 1000;
      seedCachedRecord({
        v: 1,
        payload: { ...mockPayload, validatedAt, expiresAt: undefined },
        signature: mockSignature,
      });
      await licenseService.verifyCachedState();
      expect(licenseService.getEntitlements().plan).toBe("pro");
      // Legacy record (no lastSeenAt): the floor initializes from
      // validatedAt/now and lives in memory until the next adopt persists it.
      expect(licenseService["state"]?.lastSeenAt).toBeGreaterThanOrEqual(validatedAt);
    });

    it("persists lastSeenAt when adopting a fresh signed response", async () => {
      vi.mocked(readBoundedResponseJson).mockResolvedValue({
        payload: mockPayload,
        signature: mockSignature,
      });
      vi.mocked(firewalledFetch).mockResolvedValue({ ok: true, status: 200 } as Response);

      await licenseService.activate("BF-TEST-KEY");

      const written = ((safeSet as any).mock.calls as unknown[][])
        .map((call) => call[1])
        .filter((v): v is string => typeof v === "string")
        .map((v) => {
          try {
            return JSON.parse(v) as Record<string, unknown> | null;
          } catch {
            return null;
          }
        })
        .find((v) => v !== null && typeof v === "object" && "payload" in v);
      expect(written?.lastSeenAt).toBeTypeOf("number");
      expect(written?.lastSeenAt).toBeGreaterThanOrEqual(mockPayload.validatedAt);
    });

    it("restricts VITE_LICENSE_SIGNING_URL to https or loopback http (N15)", async () => {
      vi.mocked(readBoundedResponseJson).mockResolvedValue({
        payload: mockPayload,
        signature: mockSignature,
      });
      vi.mocked(firewalledFetch).mockResolvedValue({ ok: true, status: 200 } as Response);

      vi.stubEnv("VITE_LICENSE_SIGNING_URL", "http://evil.example.com");
      try {
        await licenseService.activate("BF-TEST-KEY");
        expect(firewalledFetch).toHaveBeenLastCalledWith(
          "/api/license/activate",
          expect.anything(),
          "LicenseService",
        );
      } finally {
        vi.unstubAllEnvs();
      }

      vi.stubEnv("VITE_LICENSE_SIGNING_URL", "http://localhost:8787");
      try {
        await licenseService.activate("BF-TEST-KEY");
        expect(firewalledFetch).toHaveBeenLastCalledWith(
          "http://localhost:8787/api/license/activate",
          expect.anything(),
          "LicenseService",
        );
      } finally {
        vi.unstubAllEnvs();
      }

      vi.stubEnv("VITE_LICENSE_SIGNING_URL", "https://license.example.com");
      try {
        await licenseService.activate("BF-TEST-KEY");
        expect(firewalledFetch).toHaveBeenLastCalledWith(
          "https://license.example.com/api/license/activate",
          expect.anything(),
          "LicenseService",
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
