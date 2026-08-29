import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RxDatabase } from "rxdb";

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    getSecret: vi.fn(async () => null),
    setSecret: vi.fn(async () => undefined),
    hasSecret: vi.fn(async () => false),
    deleteSecret: vi.fn(async () => undefined),
    // H5 (device-key wrapping): SecurityVault.lock()/unlock() touch these.
    getVerificationToken: vi.fn(async () => null),
    storeVerificationToken: vi.fn(async () => undefined),
    setMasterPasswordConfiguredFlag: vi.fn(async () => undefined),
    hasMasterPasswordConfiguredFlagRaw: vi.fn(async () => false),
    isDeviceKeyWrapped: vi.fn(async () => false),
    wrapDeviceKeyWithPassword: vi.fn(async () => undefined),
    unwrapDeviceKeyWithPassword: vi.fn(async () => undefined),
    rewrapDeviceKeyWithPasswordBytes: vi.fn(async () => undefined),
    lockDeviceKey: vi.fn(() => undefined),
    setRecoveryDataRaw: vi.fn(async () => undefined),
    getRecoveryDataRaw: vi.fn(async () => null),
    hasRecoveryDataRaw: vi.fn(async () => false),
    clearRecoveryDataRaw: vi.fn(async () => undefined),
  },
}));
vi.mock("../../workers/crypto.worker.ts", () => ({}));

import { collaborationService } from "../../services/CollaborationService";
import { securityVault } from "../../services/SecurityVault";
import { encryptionService } from "../../services/EncryptionService";

describe("P0 regression — legacy share mismatch rejection (SecurityVault unchanged)", () => {
  beforeEach(() => {
    // Force the vault into a known-locked state before every test so a
    // leaked masterPasswordBytes from a prior suite cannot poison the
    // assertion `isLocked()` / `getSessionToken()`.
    securityVault.lock();
    vi.restoreAllMocks();
  });

  it("returns false and leaves SecurityVault LOCKED when a legacy 16-byte-salt payload's share secret does not match the HKDF-derived expected value", async () => {
    // Spy on withMasterPasswordBytes so the LEGACY verifier can run HKDF WITHOUT
    // requiring a real masterPassword to be loaded. This is critical: the
    // alternate path (`securityVault.unlock("...")`) would mutate state and
    // defeat the goal of assertable vault invariants.
    const spyWithMasterPassword = vi
      .spyOn(securityVault, "withMasterPasswordBytes")
      .mockImplementation((_caller, fn) => fn(new TextEncoder().encode("synthetic-master-password")));

    // Force encryptionService.decrypt to return a fixed dummy share secret
    // that the HKDF derivation will never reproduce under the wrong salt —
    // guaranteeing the assertion `expected !== shareSecret` triggers.
    const dummyShareSecret = "deadbeef".repeat(8); // 64 hex chars
    const spyDecrypt = vi
      .spyOn(encryptionService, "decrypt")
      .mockResolvedValue(dummyShareSecret);

    // Craft a LEGACY payload: NO `version` field, 16-byte salt. The legacy
    // verifier reads the salt bytes verbatim and HKDF-derives with
    // info="bookmarkforge-share".
    const legacyPayload = btoa(
      JSON.stringify({
        encryptedKey: "v2:placeholder-base64",
        salt: new Array(16).fill(1), // Wrong salt bytes
      }),
    );

    const result = await collaborationService.importSharedVault(
      legacyPayload,
      "sharePassword",
      {} as unknown as RxDatabase,
    );

    // The function MUST resolve false on mismatch.
    expect(result).toBe(false);

    // State invariants: vault STILL locked, sessionToken STILL null.
    expect(securityVault.isLocked()).toBe(true);
    expect(securityVault.getSessionToken()).toBeNull();

    // Sanity: the legacy branch actually ran (otherwise the test would be
    // a tautology). decrypt was called to extract the shareSecret.
    expect(spyDecrypt).toHaveBeenCalled();
  });

  it("returns false on a LEGACY-shaped payload with an EMPTY salt array (defective shape)", async () => {
    vi.spyOn(securityVault, "withMasterPasswordBytes").mockImplementation(
      (_caller, fn) => fn(new TextEncoder().encode("synthetic-master-password")),
    );
    vi.spyOn(encryptionService, "decrypt").mockResolvedValue("anything");

    const bad = btoa(
      JSON.stringify({
        encryptedKey: "v2:abc",
        salt: [], // Defective: empty array, salt of length 0
      }),
    );

    const result = await collaborationService.importSharedVault(
      bad,
      "sharePassword",
      {} as unknown as RxDatabase,
    );

    expect(result).toBe(false);
    expect(securityVault.isLocked()).toBe(true);
    expect(securityVault.getSessionToken()).toBeNull();
  });

  it("returns false on a non-base64 payload without throwing (defensive try/catch)", async () => {
    const result = await collaborationService.importSharedVault(
      "this-is-not-base64-$$$",
      "sharePassword",
      {} as unknown as RxDatabase,
    );
    expect(result).toBe(false);
    expect(securityVault.isLocked()).toBe(true);
    expect(securityVault.getSessionToken()).toBeNull();
  });
});
