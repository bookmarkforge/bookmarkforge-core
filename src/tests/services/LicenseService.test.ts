// src/tests/services/LicenseService.test.ts
//
// LicenseService — client of the license SIGNING SERVICE. Covers: device id,
// entitlements (license/trial/free), activate (success and error mapping),
// validateInBackground (fresh/stale/offline-grace/downgrade), deactivate
// (best-effort) and canAddBookmarks free-tier cap.
//
// The crypto boundary (`verifyLicensePayload`) is mocked here; the real
// WebCrypto↔Node interop is covered by licenseSigning.test.ts (the former
// server contract test was removed with the Lemon Squeezy proxy).

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { LICENSE_CONFIG, FREE_LIMITS } from "../../constants/license";
import { LicenseError, licenseService } from "../../services/LicenseService";
import type { LicensePayload } from "../../services/licenseSigning";

const { firewalledFetchMock, verifyLicensePayloadMock } = vi.hoisted(() => ({
  firewalledFetchMock: vi.fn(),
  verifyLicensePayloadMock: vi.fn(),
}));

vi.mock("../../utils/networkFirewall", () => ({
  firewalledFetch: firewalledFetchMock,
  setFirewallDisabled: vi.fn(),
}));

vi.mock("../../services/licenseSigning", () => ({
  verifyLicensePayload: verifyLicensePayloadMock,
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../services/AuditLogService", () => ({
  auditLog: { record: vi.fn().mockResolvedValue(undefined) },
}));

const { secureGetMock, secureSetMock, secureDeleteMock } = vi.hoisted(() => ({
  secureGetMock: vi.fn(),
  secureSetMock: vi.fn().mockResolvedValue(undefined),
  secureDeleteMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    getSecret: secureGetMock,
    setSecret: secureSetMock,
    deleteSecret: secureDeleteMock,
  },
}));

import { auditLog } from "../../services/AuditLogService";

const okJson = (body: unknown) => ({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue(body),
});

/** A successful signing-service response: { payload, signature }. */
const signedResponse = (payloadOverrides: Partial<LicensePayload> = {}) => ({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue({
    payload: {
      v: 1,
      deviceId: "bf-test-device",
      validatedAt: Date.now(),
      ...payloadOverrides,
    },
    signature: "sig-placeholder",
  }),
});

/** A signing-service structured error. */
const errorResponse = (code: string, message = "license server error", status = 400) => ({
  ok: false,
  status,
  json: vi.fn().mockResolvedValue({ error: { code, message } }),
});

function seedState(
  overrides: Partial<{ key: string; instanceId: string; validatedAt: number; activationsLeft: number }> = {},
): void {
  const state = {
    deviceId: "bf-test-device",
    key: "BF-1111-2222-3333",
    instanceId: "inst-1",
    validatedAt: Date.now(),
    ...overrides,
  };
  const payload: LicensePayload = {
    v: 1,
    deviceId: state.deviceId,
    instanceId: state.instanceId,
    validatedAt: state.validatedAt,
    ...(state.activationsLeft === undefined
      ? {}
      : { activationsLeft: state.activationsLeft }),
  };
  localStorage.setItem(
    LICENSE_CONFIG.storageKeys.licenseState,
    JSON.stringify({ payload, signature: "sig-placeholder" }),
  );
  secureGetMock.mockResolvedValue(state.key);
  // Most service tests seed a state that has already completed the async
  // signature check; cold-start verification is covered separately below.
  (licenseService as any).state = state;
  (licenseService as any).stateLoaded = true;
  (licenseService as any).signatureValid = true;
}

/** Seed a persisted signed state ({ payload, signature }). */
function seedSignedState(payloadOverrides: Partial<LicensePayload> = {}): void {
  const payload: LicensePayload = {
    v: 1,
    deviceId: "bf-test-device",
    validatedAt: freshValidatedAt,
    ...payloadOverrides,
  };
  localStorage.setItem(
    LICENSE_CONFIG.storageKeys.licenseState,
    JSON.stringify({ payload, signature: "sig-placeholder" }),
  );
}

const staleValidatedAt = Date.now() - (LICENSE_CONFIG.cacheTtlMs + 3600 * 1000);
const freshValidatedAt = Date.now() - 60 * 1000;

describe("LicenseService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal("crypto", {
      randomUUID: () => "bf-test-device",
      subtle: (globalThis as { crypto: Crypto }).crypto.subtle,
    });
    (licenseService as any).state = null;
    (licenseService as any).stateLoaded = false;
    (licenseService as any).activationPromise = null;
    (licenseService as any).validationInFlight = null;
    (licenseService as any).signatureValid = null;
    (licenseService as any).signatureVerificationInFlight = null;
    secureGetMock.mockReset();
    secureGetMock.mockResolvedValue(null);
    secureSetMock.mockReset();
    secureSetMock.mockResolvedValue(undefined);
    secureDeleteMock.mockReset();
    secureDeleteMock.mockResolvedValue(undefined);
    verifyLicensePayloadMock.mockReset();
    verifyLicensePayloadMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getDeviceId", () => {
    test("is stable across calls and persisted", () => {
      const id1 = licenseService.getDeviceId();
      const id2 = licenseService.getDeviceId();
      expect(id1).toBe("bf-test-device");
      expect(id2).toBe(id1);
      expect(localStorage.getItem(LICENSE_CONFIG.storageKeys.deviceId)).toBe(id1);
    });
  });

  describe("getEntitlements / hasProAccess", () => {
    test("returns free when nothing is stored", () => {
      expect(licenseService.getEntitlements()).toEqual({ plan: "free", source: "none" });
      expect(licenseService.hasProAccess()).toBe(false);
    });

    test("returns pro/license on a fresh cached state", () => {
      seedState({ validatedAt: freshValidatedAt });
      expect(licenseService.getEntitlements()).toEqual({
        plan: "pro",
        source: "license",
        grace: false,
        activationsLeft: undefined,
      });
      expect(licenseService.hasProAccess()).toBe(true);
    });

    test("returns pro/license with grace on a stale cached state", () => {
      seedState({ validatedAt: staleValidatedAt });
      const e = licenseService.getEntitlements();
      expect(e.plan).toBe("pro");
      expect(e.source).toBe("license");
      expect(e.grace).toBe(true);
    });

    test("does not grant Pro from an editable local trial timestamp", () => {
      const startedAt = Date.now();
      localStorage.setItem(LICENSE_CONFIG.storageKeys.trialStartedAt, String(startedAt));
      expect(licenseService.getEntitlements()).toEqual({ plan: "free", source: "none" });
      expect(licenseService.isTrialActive()).toBe(false);
    });

    test("returns free when the trial has expired", () => {
      const startedAt = Date.now() - (LICENSE_CONFIG.trialDays + 1) * 24 * 60 * 60 * 1000;
      localStorage.setItem(LICENSE_CONFIG.storageKeys.trialStartedAt, String(startedAt));
      expect(licenseService.getEntitlements().plan).toBe("free");
    });

    test("isTrialActive tolerates corrupted trial timestamps", () => {
      localStorage.setItem(LICENSE_CONFIG.storageKeys.trialStartedAt, "not-a-number");
      expect(licenseService.isTrialActive()).toBe(false);
    });
  });

  describe("hasLicense / getStoredLicenseKey", () => {
    test("reads the key from the verified in-memory state", () => {
      seedState({ key: "BF-AAAA" });
      expect(licenseService.hasLicense()).toBe(true);
      expect(licenseService.getStoredLicenseKey()).toBe("BF-AAAA");
    });

    test("rejects legacy unsigned state instead of migrating it as Pro", async () => {
      localStorage.setItem(
        LICENSE_CONFIG.storageKeys.licenseState,
        JSON.stringify({
          key: "BF-LEGACY",
          instanceId: "inst-1",
          validatedAt: Date.now(),
        }),
      );
      expect(licenseService.hasLicense()).toBe(false);
      expect(licenseService.getEntitlements().plan).toBe("free");
      expect(localStorage.getItem(LICENSE_CONFIG.storageKeys.licenseState)).toBeNull();
      await expect(licenseService.getStoredLicenseKeyAsync()).resolves.toBeNull();
      expect(secureSetMock).not.toHaveBeenCalled();
    });

    test("does not treat a plaintext legacy key without metadata as a license", async () => {
      localStorage.setItem(LICENSE_CONFIG.storageKeys.licenseKey, "BF-BBBB");
      expect(licenseService.hasLicense()).toBe(false);
      expect(licenseService.getStoredLicenseKey()).toBeNull();
      await expect(licenseService.getStoredLicenseKeyAsync()).resolves.toBeNull();
    });
  });

  describe("startTrial", () => {
    test("fails closed and does not persist a client-controlled trial timestamp", () => {
      const e1 = licenseService.startTrial();
      expect(e1).toEqual({ plan: "free", source: "none" });
      expect(localStorage.getItem(LICENSE_CONFIG.storageKeys.trialStartedAt)).toBeNull();
    });
  });

  describe("activate", () => {
    test("POSTs to the signing service, verifies and persists the signed state", async () => {
      firewalledFetchMock.mockResolvedValue(
        signedResponse({ instanceId: "inst-1", activationsLeft: 3 }),
      );
      const e = await licenseService.activate(" BF-1111-2222-3333 ");

      expect(firewalledFetchMock).toHaveBeenCalledWith(
        `${LICENSE_CONFIG.signingServiceBaseUrl}/activate`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            license_key: "BF-1111-2222-3333",
            instance_name: "bf-test-device",
          }),
        }),
        "LicenseService",
      );

      expect(e.plan).toBe("pro");
      expect(e.source).toBe("license");
      expect(e.activationsLeft).toBe(3);
      expect(licenseService.getStoredLicenseKey()).toBe("BF-1111-2222-3333");
      expect(secureSetMock).toHaveBeenCalledWith(
        "bf_license_key_secure",
        "BF-1111-2222-3333",
      );
      expect(localStorage.getItem(LICENSE_CONFIG.storageKeys.licenseKey)).toBeNull();
      const persisted = JSON.parse(
        localStorage.getItem(LICENSE_CONFIG.storageKeys.licenseState)!,
      ) as { payload: LicensePayload; signature: string };
      expect(persisted.payload.instanceId).toBe("inst-1");
      // The license key is NEVER part of the persisted payload.
      expect(persisted.payload).not.toHaveProperty("key");
      expect(persisted.signature).toBe("sig-placeholder");
      expect(verifyLicensePayloadMock).toHaveBeenCalledWith(
        expect.objectContaining({ instanceId: "inst-1", deviceId: "bf-test-device" }),
        "sig-placeholder",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "license_activated", target: "license" }),
      );
    });

    test("rejects an empty key without hitting the network", async () => {
      await expect(licenseService.activate("   ")).rejects.toMatchObject({
        code: "INVALID_KEY",
      });
      expect(firewalledFetchMock).not.toHaveBeenCalled();
    });

    test("maps an invalid-key service error to INVALID_KEY", async () => {
      firewalledFetchMock.mockResolvedValue(
        errorResponse("INVALID_KEY", "This license key is invalid"),
      );
      await expect(licenseService.activate("BF-BAD")).rejects.toMatchObject({
        code: "INVALID_KEY",
      });
      expect(licenseService.hasLicense()).toBe(false);
    });

    test("maps a max-activations service error to MAX_ACTIVATIONS", async () => {
      firewalledFetchMock.mockResolvedValue(
        errorResponse("MAX_ACTIVATIONS", "Maximum number of activations reached", 409),
      );
      await expect(licenseService.activate("BF-FULL")).rejects.toMatchObject({
        code: "MAX_ACTIVATIONS",
      });
    });

    test("wraps network failures as NETWORK", async () => {
      firewalledFetchMock.mockRejectedValue(new Error("Failed to fetch"));
      await expect(licenseService.activate("BF-KEY")).rejects.toMatchObject({
        code: "NETWORK",
      });
    });

    test("wraps non-2xx responses as SERVER", async () => {
      firewalledFetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error("bad json")),
      });
      await expect(licenseService.activate("BF-KEY")).rejects.toMatchObject({
        code: "SERVER",
      });
    });

    test("wraps malformed JSON as SERVER", async () => {
      firewalledFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new Error("bad json")),
      });
      await expect(licenseService.activate("BF-KEY")).rejects.toMatchObject({
        code: "SERVER",
      });
    });

    test("rejects a service response whose signature fails verification", async () => {
      firewalledFetchMock.mockResolvedValue(
        signedResponse({ instanceId: "inst-1" }),
      );
      verifyLicensePayloadMock.mockResolvedValue(false);
      await expect(licenseService.activate("BF-KEY")).rejects.toMatchObject({
        code: "SERVER",
      });
      expect(licenseService.hasLicense()).toBe(false);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "license_signature_invalid" }),
      );
    });

    test("serializes concurrent activations without corrupting state", async () => {
      firewalledFetchMock.mockResolvedValue(
        signedResponse({ instanceId: "inst-1", activationsLeft: 3 }),
      );
      const results = await Promise.all([
        licenseService.activate("BF-KEY"),
        licenseService.activate("BF-KEY"),
      ]);
      expect(results.every((e) => e.plan === "pro")).toBe(true);
      expect(firewalledFetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("validateInBackground", () => {
    test("returns false without a network call when no license is cached", async () => {
      await expect(licenseService.validateInBackground()).resolves.toBe(false);
      expect(firewalledFetchMock).not.toHaveBeenCalled();
    });

    test("skips the network while the cache is fresh", async () => {
      seedState({ validatedAt: freshValidatedAt });
      await expect(licenseService.validateInBackground()).resolves.toBe(true);
      expect(firewalledFetchMock).not.toHaveBeenCalled();
    });

    test("re-validates a stale license and refreshes validatedAt on success", async () => {
      seedState({ validatedAt: staleValidatedAt });
      firewalledFetchMock.mockResolvedValue(
        signedResponse({ instanceId: "inst-1", activationsLeft: 3, validatedAt: Date.now() }),
      );
      await expect(licenseService.validateInBackground()).resolves.toBe(true);
      const persisted = JSON.parse(
        localStorage.getItem(LICENSE_CONFIG.storageKeys.licenseState)!,
      ) as { payload: LicensePayload };
      expect(persisted.payload.validatedAt).toBeGreaterThan(staleValidatedAt);
      expect(persisted.payload.activationsLeft).toBe(3);
      expect(licenseService.getEntitlements().grace).toBe(false);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "license_validated", result: "success" }),
      );
    });

    test("downgrades to Free on an explicit invalid answer", async () => {
      seedState({ validatedAt: staleValidatedAt });
      firewalledFetchMock.mockResolvedValue(
        errorResponse("INVALID", "expired", 401),
      );
      await expect(licenseService.validateInBackground()).resolves.toBe(false);
      expect(licenseService.hasLicense()).toBe(false);
      expect(licenseService.getEntitlements().plan).toBe("free");
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "license_validated", result: "failure" }),
      );
    });

    test("keeps the cached state (offline grace) on network failure", async () => {
      seedState({ validatedAt: staleValidatedAt });
      firewalledFetchMock.mockRejectedValue(new Error("offline"));
      await expect(licenseService.validateInBackground()).resolves.toBe(true);
      expect(licenseService.hasLicense()).toBe(true);
      expect(licenseService.getEntitlements().grace).toBe(true);
    });

    test("rethrows non-network failures (e.g. server 5xx)", async () => {
      seedState({ validatedAt: staleValidatedAt });
      firewalledFetchMock.mockResolvedValue(
        errorResponse("SERVER", "boom", 500),
      );
      await expect(licenseService.validateInBackground()).rejects.toMatchObject({
        code: "SERVER",
      });
      expect(licenseService.hasLicense()).toBe(true);
    });

    test("dedupes concurrent re-validation rounds", async () => {
      seedState({ validatedAt: staleValidatedAt });
      firewalledFetchMock.mockResolvedValue(
        signedResponse({ instanceId: "inst-1", validatedAt: Date.now() }),
      );
      const p1 = licenseService.validateInBackground();
      const p2 = licenseService.validateInBackground();
      await Promise.all([p1, p2]);
      expect(firewalledFetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("deactivate", () => {
    test("calls the deactivate endpoint and clears local state", async () => {
      seedState({ key: "BF-1111", instanceId: "inst-9" });
      firewalledFetchMock.mockResolvedValue(okJson({ ok: true }));
      await licenseService.deactivate();

      expect(firewalledFetchMock).toHaveBeenCalledWith(
        `${LICENSE_CONFIG.signingServiceBaseUrl}/deactivate`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ license_key: "BF-1111", instance_id: "inst-9" }),
        }),
        "LicenseService",
      );
      expect(licenseService.hasLicense()).toBe(false);
      expect(licenseService.getStoredLicenseKey()).toBeNull();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "license_deactivated" }),
      );
    });

    test("clears local state even when the network call fails", async () => {
      seedState({ key: "BF-1111", instanceId: "inst-9" });
      firewalledFetchMock.mockRejectedValue(new Error("offline"));
      await expect(licenseService.deactivate()).resolves.toBeUndefined();
      expect(licenseService.hasLicense()).toBe(false);
    });
  });

  describe("canAddBookmarks", () => {
    test("caps the free tier at FREE_LIMITS.maxBookmarks", async () => {
      expect(await licenseService.canAddBookmarks(FREE_LIMITS.maxBookmarks - 1)).toBe(true);
      expect(await licenseService.canAddBookmarks(FREE_LIMITS.maxBookmarks)).toBe(false);
      expect(await licenseService.canAddBookmarks(FREE_LIMITS.maxBookmarks, 3)).toBe(false);
    });

    test("always allows inserts for Pro (license)", async () => {
      seedState({ validatedAt: freshValidatedAt });
      expect(await licenseService.canAddBookmarks(200)).toBe(true);
      expect(await licenseService.canAddBookmarks(10000)).toBe(true);
    });

    test("does not allow inserts from a client-controlled trial timestamp", async () => {
      localStorage.setItem(LICENSE_CONFIG.storageKeys.trialStartedAt, String(Date.now()));
      expect(await licenseService.canAddBookmarks(FREE_LIMITS.maxBookmarks)).toBe(false);
    });

    test("FREE_LIMITS mirrors the expected values", () => {
      // The literal pin lives in src/tests/constants/license.test.ts; this row
      // records the value the service actually caps against.
      expect(FREE_LIMITS.maxBookmarks).toBe(2500);
      expect(FREE_LIMITS.maxDevices).toBe(0);
    });
  });

  // ── Signed-state integrity (server-signed, client-verified) ─────────
  describe("signed license state", () => {
    test("activate persists a signed state whose signature was verified", async () => {
      firewalledFetchMock.mockResolvedValue(
        signedResponse({ instanceId: "inst-1", activationsLeft: 3 }),
      );
      const entitlements = await licenseService.activate("BF-1111-2222-3333");
      expect(entitlements.plan).toBe("pro");

      const raw = localStorage.getItem(LICENSE_CONFIG.storageKeys.licenseState);
      expect(raw).not.toBeNull();
      const stored = JSON.parse(raw!) as { payload: LicensePayload; signature: string };
      expect(stored.signature).toBeTruthy();
      expect(stored.payload.deviceId).toBe("bf-test-device");
      expect(stored.payload.instanceId).toBe("inst-1");
      expect(verifyLicensePayloadMock).toHaveBeenCalledWith(stored.payload, stored.signature);
    });

    test("a service-provided expiresAt is carried into the persisted payload", async () => {
      const expiry = Date.parse("2027-01-01T00:00:00.000Z");
      firewalledFetchMock.mockResolvedValue(
        signedResponse({ expiresAt: expiry }),
      );
      await licenseService.activate("BF-1111-2222-3333");
      const stored = JSON.parse(
        localStorage.getItem(LICENSE_CONFIG.storageKeys.licenseState)!,
      ) as { payload: LicensePayload };
      expect(stored.payload.expiresAt).toBe(expiry);
    });

    test("a tampered state (edited validatedAt) is downgraded to Free", async () => {
      seedSignedState();
      // Tamper: extend the cache window by hand — must break the signature.
      verifyLicensePayloadMock.mockResolvedValue(false);
      const raw = JSON.parse(
        localStorage.getItem(LICENSE_CONFIG.storageKeys.licenseState)!,
      ) as { payload: LicensePayload; signature: string };
      raw.payload.validatedAt = Date.now();
      localStorage.setItem(
        LICENSE_CONFIG.storageKeys.licenseState,
        JSON.stringify(raw),
      );

      // The state is denied immediately while async verification runs; it must
      // never grant a temporary Pro window to an unverified payload.
      expect(licenseService.getEntitlements().plan).toBe("free");
      await vi.waitFor(() => {
        expect(licenseService.getEntitlements().plan).toBe("free");
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "license_state_tampered" }),
      );
      expect(localStorage.getItem(LICENSE_CONFIG.storageKeys.licenseState)).toBeNull();
    });

    test("offline expiry enforcement: past expiresAt ends the grace", async () => {
      // Stale cache + past expiry → no offline grace.
      seedSignedState({
        validatedAt: staleValidatedAt,
        expiresAt: Date.now() - 24 * 60 * 60 * 1000,
      });
      expect(licenseService.getEntitlements().plan).toBe("free");
    });

    test("offline grace keeps Pro until the signed expiry", async () => {
      seedSignedState({
        validatedAt: staleValidatedAt,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      await licenseService.verifyCachedState();
      const e = licenseService.getEntitlements();
      expect(e.plan).toBe("pro");
      expect(e.grace).toBe(true);
      expect(e.expiresAt).toBeGreaterThan(Date.now());
    });

    test("legacy unsigned state is rejected instead of keeping offline grace", async () => {
      localStorage.setItem(
        LICENSE_CONFIG.storageKeys.licenseState,
        JSON.stringify({
          key: "BF-LEGACY",
          instanceId: "inst-1",
          validatedAt: staleValidatedAt,
        }),
      );
      expect(licenseService.getEntitlements().plan).toBe("free");
      expect(licenseService.hasLicense()).toBe(false);
    });
  });

  // The deployment verifies the proof and answers with the plan; Pro stops
  // being a claim the browser makes about itself.
  describe("refreshEntitlementFromServer", () => {
    test("downgrades to Free when the server denies the entitlement", async () => {
      seedState();
      firewalledFetchMock.mockResolvedValue(
        okJson({ plan: "free", source: "none", reason: "EXPIRED" }),
      );

      const entitlements = await licenseService.refreshEntitlementFromServer();

      expect(entitlements.plan).toBe("free");
      expect(localStorage.getItem(LICENSE_CONFIG.storageKeys.licenseState)).toBeNull();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "license_validated", result: "failure" }),
      );
      // The proof travels in the body: the license key never leaves the device.
      const call = firewalledFetchMock.mock.calls[0] as [unknown, RequestInit];
      const [url, init] = call;
      expect(String(url)).toContain("/entitlement");
      expect(String(init.body)).toContain("signature");
      expect(String(init.body)).not.toContain("BF-1111-2222-3333");
    });

    test("keeps the local state when the server confirms Pro", async () => {
      seedState();
      firewalledFetchMock.mockResolvedValue(okJson({ plan: "pro", source: "license" }));

      const entitlements = await licenseService.refreshEntitlementFromServer();

      expect(entitlements.plan).toBe("pro");
      expect(licenseService.hasProAccess()).toBe(true);
    });

    test("keeps offline grace when the endpoint is unreachable", async () => {
      seedState();
      firewalledFetchMock.mockRejectedValue(new Error("Failed to fetch"));

      await expect(licenseService.refreshEntitlementFromServer()).rejects.toMatchObject({
        code: "NETWORK",
      });
      expect(licenseService.hasProAccess()).toBe(true);
    });

    test("never downgrades a paying user when the deployment cannot verify", async () => {
      seedState();
      firewalledFetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({
          error: { code: "SIGNING_KEY_INVALID", message: "license verification is misconfigured" },
        }),
      });

      await expect(licenseService.refreshEntitlementFromServer()).rejects.toMatchObject({
        code: "SERVER",
      });
      expect(licenseService.getEntitlements().plan).toBe("pro");
      expect(localStorage.getItem(LICENSE_CONFIG.storageKeys.licenseState)).not.toBeNull();
    });

    test("does not call the network without a signed proof to present", async () => {
      expect((await licenseService.refreshEntitlementFromServer()).plan).toBe("free");
      expect(firewalledFetchMock).not.toHaveBeenCalled();
    });
  });
});
