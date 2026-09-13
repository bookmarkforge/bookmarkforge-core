// src/tests/store/useLicenseStore.test.ts
//
// useLicenseStore — reactive mirror of licenseService entitlements.
// Covers: initial snapshot, activate (success/failure), startTrial,
// deactivate and refresh (grace re-validation).

import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Entitlements } from "../../services/LicenseService";

const { mockService } = vi.hoisted(() => ({
  mockService: {
    getEntitlements: vi.fn<() => Entitlements>(() => ({ plan: "free", source: "none" })),
    verifyCachedState: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    // Server-authoritative check: runs BEFORE the key-based re-validation, so
    // an authoritative downgrade short-circuits it.
    refreshEntitlementFromServer: vi.fn<() => Promise<Entitlements>>().mockResolvedValue({
      plan: "pro",
      source: "license",
    }),
    validateInBackground: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    activate: vi.fn<(key: string) => Promise<Entitlements>>().mockResolvedValue({
      plan: "pro",
      source: "license",
    }),
    startTrial: vi.fn<() => Entitlements>(() => ({
      plan: "pro",
      source: "trial",
      expiresAt: Date.now() + 1000,
    })),
    deactivate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

vi.mock("../../services/LicenseService", () => ({
  licenseService: mockService,
  LicenseError: class LicenseError extends Error {},
}));

import { useLicenseStore } from "../../store/useLicenseStore";

const FREE: Entitlements = { plan: "free", source: "none" };
const PRO_LICENSE: Entitlements = { plan: "pro", source: "license" };
const PRO_GRACE: Entitlements = { plan: "pro", source: "license", grace: true };
const PRO_TRIAL: Entitlements = { plan: "pro", source: "trial", expiresAt: Date.now() + 1000 };

describe("useLicenseStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.refreshEntitlementFromServer.mockResolvedValue(PRO_LICENSE);
    mockService.validateInBackground.mockResolvedValue(true);
    mockService.getEntitlements.mockReturnValue(FREE);
    mockService.activate.mockResolvedValue(PRO_LICENSE);
    mockService.startTrial.mockReturnValue(PRO_TRIAL);
    mockService.deactivate.mockResolvedValue(undefined);
    useLicenseStore.setState({ entitlements: FREE, busy: false, error: null });
  });

  test("starts with the service snapshot and idle flags", () => {
    const s = useLicenseStore.getState();
    expect(s.entitlements).toEqual(FREE);
    expect(s.busy).toBe(false);
    expect(s.error).toBeNull();
  });

  test("activate() returns true and publishes pro entitlements", async () => {
    const ok = await useLicenseStore.getState().activate("BF-KEY");
    expect(ok).toBe(true);
    expect(mockService.activate).toHaveBeenCalledWith("BF-KEY");
    const s = useLicenseStore.getState();
    expect(s.entitlements).toEqual(PRO_LICENSE);
    expect(s.busy).toBe(false);
    expect(s.error).toBeNull();
  });

  test("activate() surfaces the error and returns false on failure", async () => {
    mockService.activate.mockRejectedValue(new Error("Invalid license key"));
    const ok = await useLicenseStore.getState().activate("BF-BAD");
    expect(ok).toBe(false);
    const s = useLicenseStore.getState();
    expect(s.error).toBe("Invalid license key");
    expect(s.busy).toBe(false);
  });

  test("startTrial() publishes the trial entitlements", () => {
    useLicenseStore.getState().startTrial();
    expect(mockService.startTrial).toHaveBeenCalled();
    expect(useLicenseStore.getState().entitlements).toEqual(PRO_TRIAL);
  });

  test("deactivate() clears to free and flips busy around the call", async () => {
    const store = useLicenseStore.getState();
    await store.deactivate();
    expect(mockService.deactivate).toHaveBeenCalled();
    expect(useLicenseStore.getState().entitlements).toEqual(FREE);
    expect(useLicenseStore.getState().busy).toBe(false);
  });

  test("refresh() does not re-validate while not in grace", async () => {
    await useLicenseStore.getState().refresh();
    expect(mockService.validateInBackground).not.toHaveBeenCalled();
    expect(mockService.refreshEntitlementFromServer).not.toHaveBeenCalled();
  });

  test("refresh() asks the server first and re-snapshots while in grace", async () => {
    mockService.getEntitlements.mockReturnValueOnce(PRO_GRACE);
    useLicenseStore.setState({ entitlements: PRO_GRACE });
    mockService.getEntitlements.mockReturnValue(PRO_LICENSE);

    await useLicenseStore.getState().refresh();
    expect(mockService.refreshEntitlementFromServer).toHaveBeenCalled();
    expect(mockService.validateInBackground).toHaveBeenCalled();
    expect(useLicenseStore.getState().entitlements).toEqual(PRO_LICENSE);
  });

  test("refresh() stops at an authoritative downgrade from the server", async () => {
    mockService.getEntitlements.mockReturnValueOnce(PRO_GRACE);
    useLicenseStore.setState({ entitlements: PRO_GRACE });
    mockService.refreshEntitlementFromServer.mockResolvedValueOnce(FREE);
    mockService.getEntitlements.mockReturnValue(FREE);

    await useLicenseStore.getState().refresh();

    expect(useLicenseStore.getState().entitlements).toEqual(FREE);
    expect(useLicenseStore.getState().error).toBeNull();
    // No point re-validating with the license key: the entitlement is gone.
    expect(mockService.validateInBackground).not.toHaveBeenCalled();
  });

  test("refresh() contains background validation failures", async () => {
    mockService.getEntitlements.mockReturnValueOnce(PRO_GRACE);
    useLicenseStore.setState({ entitlements: PRO_GRACE });
    mockService.validateInBackground.mockRejectedValueOnce(
      new Error("license server unavailable"),
    );

    await expect(useLicenseStore.getState().refresh()).resolves.toBeUndefined();
    expect(useLicenseStore.getState().error).toBe("license server unavailable");
    expect(useLicenseStore.getState().entitlements).toEqual(PRO_GRACE);
  });

  test("deactivate() clears busy and surfaces storage failures", async () => {
    mockService.deactivate.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(useLicenseStore.getState().deactivate()).resolves.toBeUndefined();
    expect(useLicenseStore.getState().busy).toBe(false);
    expect(useLicenseStore.getState().error).toBe("storage unavailable");
  });
});
