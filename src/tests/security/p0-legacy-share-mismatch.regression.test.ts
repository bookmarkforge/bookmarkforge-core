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
    // P1 mock-contract sweep — the members below are part of the
    // SecureStorage contract SecurityVault consumes; the factory used to
    // omit them, so any test reaching those branches crashed (or passed
    // only because the crash was swallowed). Exercised by the
    // "lifecycle contract (P1 mock sweep)" block at the bottom of this file
    // and by p0-vault-rotation-rollback-drill (rotation domain).
    purgeExpiredPendingKeys: vi.fn(async () => undefined),
    migrateFromLocalStorage: vi.fn(async () => true),
    getWrappedDeviceKeyBlob: vi.fn(async (): Promise<string | null> => null),
    ensureDeviceKeyMaterialized: vi.fn(async () => undefined),
    isDeviceKeyMaterialized: vi.fn(() => false),
    getVerificationIntegrity: vi.fn(async (): Promise<string | null> =>
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
        ":aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
    ),
    storeVerificationIntegrity: vi.fn(async () => undefined),
    restoreWrappedDeviceKeyBlob: vi.fn(async () => undefined),
    restoreVerificationToken: vi.fn(async () => undefined),
    storeVerificationTokenWithIntegrity: vi.fn(async () => undefined),
  },
}));
vi.mock("../../workers/crypto.worker.ts", () => ({}));

import { collaborationService } from "../../services/CollaborationService";
import { securityVault } from "../../services/SecurityVault";
import { encryptionService } from "../../services/EncryptionService";
import { secureStorage } from "../../services/SecureStorage";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import {
  SECURE_STORAGE_KEYS,
  VERIFICATION_PLAINTEXT,
} from "../../services/security-vault/constants";

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

  // ── P1 mock-contract sweep ────────────────────────────────────────────────
  // Each test drives a SecurityVault lifecycle branch whose secureStorage
  // members were missing from this file's vi.mock factory: the branch either
  // crashed on the incomplete contract or was never reachable at all.
  describe("lifecycle contract (P1 mock sweep)", () => {
    const TEST_INTEGRITY_RECORD =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
      ":aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";

    /** Verify-password passthrough so unlock() reaches unlockDeviceKey(). */
    async function primeUnlockFor(password: string): Promise<void> {
      const TOKEN = "encrypted_vault_verification";
      (secureStorage.getVerificationToken as any).mockResolvedValueOnce(TOKEN);
      vi.spyOn(encryptionService, "decryptWithBytes").mockResolvedValueOnce(
        VERIFICATION_PLAINTEXT as any,
      );
      // A REAL S1 integrity record: verifyPassword HMAC-verifies the stored
      // token against it with real WebCrypto (HKDF + HMAC), so the branch
      // runs for real instead of being stubbed out.
      const { deriveIntegrityHmacKey } = await import(
        "../../services/security-vault/integrity"
      );
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const hmacKey = await deriveIntegrityHmacKey(
        new TextEncoder().encode(password),
        nonce,
      );
      const mac = new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          hmacKey,
          new TextEncoder().encode(TOKEN),
        ),
      );
      const hex = (bytes: Uint8Array) =>
        Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      (secureStorage.getVerificationIntegrity as any).mockResolvedValueOnce(
        `${hex(nonce)}:${hex(mac)}`,
      );
      (secureStorage.getSecret as any).mockImplementation((key: string) =>
        key === "vault_verification_integrity"
          ? Promise.resolve(TEST_INTEGRITY_RECORD)
          : Promise.resolve(null),
      );
      // Skip createVerificationToken() so the mint path (real KDF) never runs.
      (secureStorage.hasSecret as any).mockImplementation(
        (key: string) =>
          Promise.resolve(key === SECURE_STORAGE_KEYS.VERIFICATION),
      );
      // Best-effort Argon2id salt install must not gate this test.
      vi.spyOn(securityVault as any, "installVaultKdfSalt").mockResolvedValue(
        null,
      );
    }

    it("purges expired pending keys on the first unlock attempt (once per process)", async () => {
      // unlock() fires _purgePendingOnce() BEFORE password validation (Fase 9).
      await securityVault.unlock("");
      await vi.waitFor(() => {
        expect(secureStorage.purgeExpiredPendingKeys).toHaveBeenCalled();
      });
    });

    it("migrates legacy recovery and API-key data out of localStorage", async () => {
      await securityVault.migrateFromLocalStorage();

      expect(secureStorage.migrateFromLocalStorage).toHaveBeenCalledTimes(2);
      expect(secureStorage.migrateFromLocalStorage).toHaveBeenCalledWith(
        STORAGE_KEYS.RECOVERY_DATA,
        SECURE_STORAGE_KEYS.RECOVERY_DATA,
      );
      expect(secureStorage.migrateFromLocalStorage).toHaveBeenCalledWith(
        "encrypted_api_key",
        SECURE_STORAGE_KEYS.API_KEY,
      );
    });

    it("materializes the device key on first-run unlock (no wrapped blob)", async () => {
      await primeUnlockFor("correct_password");

      const result = await securityVault.unlock("correct_password");

      expect(secureStorage.getWrappedDeviceKeyBlob).toHaveBeenCalled();
      expect(secureStorage.ensureDeviceKeyMaterialized).toHaveBeenCalled();
      expect(result).toBe(true);
      expect(securityVault.isLocked()).toBe(false);
      await securityVault.lock();
    });

    it("fails closed when a wrapped blob exists but unwrap leaves the device key unmaterialized", async () => {
      expect(secureStorage.getWrappedDeviceKeyBlob).toBeDefined();
      await primeUnlockFor("correct_password");
      // The factory's unwrap does NOT flip isDeviceKeyMaterialized → post-condition fails.
      (secureStorage.getWrappedDeviceKeyBlob as any).mockResolvedValueOnce(
        "wrapped-blob",
      );

      const result = await securityVault.unlock("correct_password");

      expect(secureStorage.getWrappedDeviceKeyBlob).toHaveBeenCalled();
      expect(secureStorage.unwrapDeviceKeyWithPassword).toHaveBeenCalledWith(
        "correct_password",
      );
      expect(secureStorage.isDeviceKeyMaterialized).toHaveBeenCalled();
      expect(result).toBe(false);
      expect(securityVault.isLocked()).toBe(true);
      await securityVault.lock();
    });
  });
});
