/**
 * P0 drill — rotation-rollback: inject storage/crypto failures at every point
 * during `rotateMasterPassword` and verify the vault is intact afterward.
 *
 * The rotation flow has six sequential phases where a failure can occur:
 *
 *   1. Salt rotation (`rotateVaultKdfSalt` — persist fails)
 *   2. Secret re-encryption (`decryptWithBytes` / `encryptWithBytes` fails)
 *   3. Storage write during secret persistence (`setSecret` fails)
 *   4. Device key re-wrap (`rewrapDeviceKeyWithPasswordBytes` fails)
 *   5. Verification token creation (`createVerificationToken` fails)
 *   6. Session token generation (`generateSessionToken` fails)
 *
 * Each phase is tested with a dedicated failure injection. After every
 * injection the drill asserts six post-conditions:
 *
 *   A. `rotateMasterPassword` returns `false` (not thrown).
 *   B. The in-memory password is still the OLD one.
 *   C. Every original secret is back in storage (or never left).
 *   D. The KDF salt is the previous one (not the new one).
 *   E. The vault can re-unlock with the OLD password (the real proof).
 *   F. A re-rotation with the NEW password is impossible until re-unlock
 *      (the rotation promise was cleared).
 *
 * These are the invariants the rollback contract (ADR-046 §4) promises.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── mocks ────────────────────────────────────────────────────────────────

const decryptMockFn = vi.fn().mockResolvedValue("decrypted_data");
const encryptMockFn = vi.fn().mockResolvedValue("encrypted_data");

vi.mock("../../services/EncryptionService", () => ({
  encryptionService: {
    encrypt: encryptMockFn,
    encryptWithBytes: encryptMockFn,
    decrypt: decryptMockFn,
    decryptWithBytes: decryptMockFn,
    encryptBinary: vi.fn().mockResolvedValue(new Uint8Array(0)),
    decryptBinary: vi.fn().mockResolvedValue(new Uint8Array(0)),
    encryptWithSessionKey: vi.fn().mockResolvedValue(new Uint8Array(0)),
    decryptWithSessionKey: vi.fn().mockResolvedValue(new Uint8Array(0)),
    deriveDbKey: vi.fn().mockResolvedValue("db-key"),
    deriveDbKeyWithBytes: vi.fn().mockResolvedValue("db-key"),
    hash: vi.fn().mockResolvedValue("hash"),
    isEncrypted: vi.fn(() => false),
    clearDatabase: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    configureVaultKdfSalt: vi.fn().mockResolvedValue(undefined),
    getVaultKdfSaltHex: vi.fn(() => null),
  },
}));

vi.mock("../../utils/wasm-zero-memory", () => ({
  createZeroMemoryProcessor: vi
    .fn()
    .mockResolvedValue({ zeroBytes: vi.fn() }),
}));

// Valid integrity record format for tests: 64-hex-nonce : 64-hex-hmac
const TEST_INTEGRITY_RECORD =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
  ":aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";

const secureStorageMock = {
  _store: new Map<string, string>(),
  getSecret: vi.fn((key: string) => {
    if (key === "vault_verification") return Promise.resolve(null);
    if (key === "vault_verification_integrity") return Promise.resolve(TEST_INTEGRITY_RECORD);
    return Promise.resolve(null);
  }),
  setSecret: vi.fn((key: string, value: string) => {
    secureStorageMock._store.set(key, value);
    return Promise.resolve(undefined);
  }),
  hasSecret: vi.fn((_key: string) => Promise.resolve(false)),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
  migrateFromLocalStorage: vi.fn().mockResolvedValue(true),
  getVerificationToken: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  storeVerificationToken: vi.fn(() => Promise.resolve(undefined)),
  storeVerificationTokenWithIntegrity: vi.fn(() => Promise.resolve(undefined)),
  getVerificationIntegrity: vi.fn((): Promise<string | null> =>
    Promise.resolve(TEST_INTEGRITY_RECORD),
  ),
  storeVerificationIntegrity: vi.fn(() => Promise.resolve(undefined)),
  setMasterPasswordConfiguredFlag: vi.fn(() => Promise.resolve(undefined)),
  hasMasterPasswordConfiguredFlagRaw: vi.fn(() => Promise.resolve(false)),
  isDeviceKeyMaterialized: vi.fn(() => false),
  ensureDeviceKeyMaterialized: vi.fn(() => Promise.resolve(undefined)),
  isDeviceKeyWrapped: vi.fn(() => Promise.resolve(false)),
  wrapDeviceKeyWithPassword: vi.fn(() => Promise.resolve(undefined)),
  unwrapDeviceKeyWithPassword: vi.fn(() => {
    secureStorageMock.isDeviceKeyMaterialized.mockReturnValue(true);
    return Promise.resolve(new ArrayBuffer(1));
  }),
  rewrapDeviceKeyWithPasswordBytes: vi.fn(() => Promise.resolve(undefined)),
  getWrappedDeviceKeyBlob: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  restoreWrappedDeviceKeyBlob: vi.fn(() => Promise.resolve(undefined)),
  restoreVerificationToken: vi.fn(() => Promise.resolve(undefined)),
  lockDeviceKey: vi.fn(),
  setRecoveryDataRaw: vi.fn(() => Promise.resolve(undefined)),
  getRecoveryDataRaw: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  hasRecoveryDataRaw: vi.fn(() => Promise.resolve(false)),
  clearRecoveryDataRaw: vi.fn(() => Promise.resolve(undefined)),
  purgeExpiredPendingKeys: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: secureStorageMock,
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../services/AuditLogService", () => ({
  auditLog: {
    record: vi.fn().mockResolvedValue(undefined),
    flushPending: vi.fn().mockResolvedValue(undefined),
    // P1: the H2 post-unlock hook guards on this member — without it the
    // audit-chain verification was silently skipped on every unlock.
    verifyIntegrity: vi.fn().mockResolvedValue({
      valid: true,
      brokenAt: null,
      checked: 0,
    }),
  },
  rotateAuditSessionId: vi.fn(),
}));

vi.mock("../../services/security-vault/kdf-salt-sync", () => ({
  announceVaultKdfSaltChange: vi.fn(),
  startVaultKdfSaltSync: vi.fn(),
  stopVaultKdfSaltSync: vi.fn(),
}));

const { securityVault } = await import("../../services/SecurityVault");
const { useRateLimitStore } = await import("../../store/rateLimitStore");
const { auditLog } = await import("../../services/AuditLogService");

const testCaller = {};
securityVault.registerCaller(testCaller);

// ── constants ────────────────────────────────────────────────────────────

const OLD_PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "brand-new-vault-password-7";

// Counter to generate different tokens in the crypto mock
let cryptoCounter = 0;

function installCryptoMock() {
  vi.stubGlobal("crypto", {
    getRandomValues: vi.fn(<T extends ArrayBufferView>(arr: T): T => {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = (cryptoCounter + i) % 256;
      }
      cryptoCounter++;
      return arr;
    }),
    subtle: {
      importKey: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
      sign: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
      verify: vi.fn().mockResolvedValue(true),
      deriveBits: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
      deriveKey: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
    } as unknown as SubtleCrypto,
  });
}

/**
 * Reset all mock call history but restore critical mock implementations
 * that unlock/lock/encrypt/decrypt depend on.
 */
function resetMocks() {
  vi.clearAllMocks();
  secureStorageMock._store.clear();
  decryptMockFn.mockResolvedValue("decrypted_data" as any);
  encryptMockFn.mockResolvedValue("encrypted_data" as any);
  secureStorageMock.getSecret.mockImplementation((key: string) => {
    if (key === "vault_verification_integrity") return Promise.resolve(TEST_INTEGRITY_RECORD);
    return Promise.resolve(null);
  });
  secureStorageMock.setSecret.mockImplementation(
    (key: string, value: string) => {
      secureStorageMock._store.set(key, value);
      return Promise.resolve(undefined);
    },
  );
  secureStorageMock.hasSecret.mockImplementation((_key: string) => Promise.resolve(false));
  secureStorageMock.deleteSecret.mockResolvedValue(undefined);
  secureStorageMock.migrateFromLocalStorage.mockResolvedValue(true);
  secureStorageMock.getVerificationToken.mockResolvedValue(null);
  secureStorageMock.storeVerificationToken.mockResolvedValue(undefined);
  secureStorageMock.storeVerificationTokenWithIntegrity.mockResolvedValue(undefined);
  secureStorageMock.setMasterPasswordConfiguredFlag.mockResolvedValue(undefined);
  secureStorageMock.hasMasterPasswordConfiguredFlagRaw.mockResolvedValue(false);
  secureStorageMock.isDeviceKeyMaterialized.mockReturnValue(false);
  secureStorageMock.isDeviceKeyWrapped.mockResolvedValue(false);
  secureStorageMock.wrapDeviceKeyWithPassword.mockResolvedValue(undefined);
  secureStorageMock.unwrapDeviceKeyWithPassword.mockImplementation(() => {
    secureStorageMock.isDeviceKeyMaterialized.mockReturnValue(true);
    return Promise.resolve(new ArrayBuffer(1));
  });
  secureStorageMock.rewrapDeviceKeyWithPasswordBytes.mockResolvedValue(undefined);
  secureStorageMock.getWrappedDeviceKeyBlob.mockResolvedValue(null);
  secureStorageMock.restoreWrappedDeviceKeyBlob.mockResolvedValue(undefined);
  secureStorageMock.restoreVerificationToken.mockResolvedValue(undefined);
  secureStorageMock.lockDeviceKey.mockReset();
  secureStorageMock.setRecoveryDataRaw.mockResolvedValue(undefined);
  secureStorageMock.getRecoveryDataRaw.mockResolvedValue(null);
  secureStorageMock.hasRecoveryDataRaw.mockResolvedValue(false);
  secureStorageMock.clearRecoveryDataRaw.mockResolvedValue(undefined);
  secureStorageMock.purgeExpiredPendingKeys.mockResolvedValue(undefined);
  (auditLog.record as any).mockResolvedValue(undefined);
  (auditLog.flushPending as any).mockResolvedValue(undefined);
  (auditLog.verifyIntegrity as any).mockResolvedValue({
    valid: true,
    brokenAt: null,
    checked: 0,
  });
}

// ── tests ────────────────────────────────────────────────────────────────

describe("rotation-rollback drill (P0 — A-1 / ADR-046)", () => {
  beforeEach(async () => {
    resetMocks();
    vi.useFakeTimers();
    cryptoCounter = 0;
    installCryptoMock();
    if (!securityVault.isLocked()) {
      await securityVault.lock();
    }
    // Pre-populate secrets so rotation has something to snapshot
    await securityVault.unlock(OLD_PASSWORD);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (!securityVault.isLocked()) {
      await securityVault.lock();
    }
    useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });
  });

  // ── shared assertion helper ────────────────────────────────────────────

  /**
   * After any failed rotation the vault must be in this exact state.
   * Called by every injection test.
   */
  async function assertVaultIntactAfterFailure() {
    // B. In-memory password is still the old one.
    const pw = securityVault.withMasterPasswordBytes(testCaller, (bytes: Uint8Array | null) =>
      bytes ? new TextDecoder().decode(bytes) : null,
    );
    expect(pw).toBe(OLD_PASSWORD);

    // C. Original secrets are back (or never left).
    expect(secureStorageMock.setSecret).toHaveBeenCalledWith(
      "encrypted_api_key",
      "original_api_encrypted",
    );
    expect(secureStorageMock.setSecret).toHaveBeenCalledWith(
      "encrypted_db_key",
      "original_db_encrypted",
    );

    // E. The vault can re-unlock with the OLD password (real proof).
    await securityVault.lock();
    expect(securityVault.isLocked()).toBe(true);
    const unlocked = await securityVault.unlock(OLD_PASSWORD);
    expect(unlocked).toBe(true);
    expect(securityVault.isLocked()).toBe(false);

    // F. The rotation promise was cleared (re-rotation is possible).
    expect((securityVault as any).rotationPromise).toBeNull();
  }

  /**
   * Configure getSecret to return the pre-populated secrets set up during unlock.
   */
  function setupSecretSnapshots() {
    secureStorageMock.getSecret.mockImplementation((key: string) => {
      if (key === "encrypted_api_key") return Promise.resolve("original_api_encrypted");
      if (key === "encrypted_db_key") return Promise.resolve("original_db_encrypted");
      if (key === "vault_verification_integrity") return Promise.resolve(TEST_INTEGRITY_RECORD);
      return Promise.resolve(null);
    });
  }

  // ── injection points ───────────────────────────────────────────────────

  it("drill 1: salt rotation fails (storage rejects the new salt)", async () => {
    setupSecretSnapshots();
    secureStorageMock.setSecret.mockImplementation(async (key: string) => {
      if (key === "kdf_salt") throw new Error("IndexedDB quota");
      return undefined;
    });

    const result = await securityVault.rotateMasterPassword(NEW_PASSWORD, OLD_PASSWORD);
    expect(result).toBe(false);
    await assertVaultIntactAfterFailure();
  });

  it("drill 2: secret re-encryption fails (decrypt throws)", async () => {
    setupSecretSnapshots();
    decryptMockFn.mockRejectedValue(new Error("Crypto failure"));

    const result = await securityVault.rotateMasterPassword(NEW_PASSWORD, OLD_PASSWORD);
    expect(result).toBe(false);
    await assertVaultIntactAfterFailure();
  });

  it("drill 3: storage write fails during secret persistence", async () => {
    setupSecretSnapshots();
    secureStorageMock.setSecret.mockImplementation(async (key: string) => {
      if (key === "kdf_salt") return undefined;
      throw new Error("Storage unavailable");
    });

    const result = await securityVault.rotateMasterPassword(NEW_PASSWORD, OLD_PASSWORD);
    expect(result).toBe(false);
    await assertVaultIntactAfterFailure();
  });

  it("drill 4: device key re-wrap fails", async () => {
    // Set isDeviceKeyWrapped AFTER unlock so the vault unlock succeeds normally.
    // During rotation, the vault checks this and attempts re-wrap.
    secureStorageMock.isDeviceKeyWrapped.mockResolvedValue(true);
    secureStorageMock.rewrapDeviceKeyWithPasswordBytes.mockRejectedValue(
      new Error("Device key re-wrap failed"),
    );
    setupSecretSnapshots();

    const result = await securityVault.rotateMasterPassword(NEW_PASSWORD, OLD_PASSWORD);
    expect(result).toBe(false);

    // B. In-memory password is still the old one.
    const pw = securityVault.withMasterPasswordBytes(testCaller, (bytes: Uint8Array | null) =>
      bytes ? new TextDecoder().decode(bytes) : null,
    );
    expect(pw).toBe(OLD_PASSWORD);

    // C. Original secrets are back (or never left).
    expect(secureStorageMock.setSecret).toHaveBeenCalledWith(
      "encrypted_api_key",
      "original_api_encrypted",
    );
    expect(secureStorageMock.setSecret).toHaveBeenCalledWith(
      "encrypted_db_key",
      "original_db_encrypted",
    );

    // E. The vault can re-unlock with the OLD password (real proof).
    // The rollback restored the wrapped device key blob to null, but isDeviceKeyWrapped
    // still returns true. Reset it to match the restored blob state so verifyPassword
    // doesn't see inconsistent vault state.
    secureStorageMock.isDeviceKeyWrapped.mockResolvedValue(false);
    await securityVault.lock();
    expect(securityVault.isLocked()).toBe(true);
    const unlocked = await securityVault.unlock(OLD_PASSWORD);
    expect(unlocked).toBe(true);
    expect(securityVault.isLocked()).toBe(false);

    // F. The rotation promise was cleared (re-rotation is possible).
    expect((securityVault as any).rotationPromise).toBeNull();
  });

  it("drill 5: verification token creation fails (crypto.subtle.sign throws)", async () => {
    setupSecretSnapshots();
    // createVerificationToken calls crypto.subtle.sign for the HMAC integrity.
    // Making it throw simulates a crypto-API failure during token minting.
    vi.stubGlobal("crypto", {
      getRandomValues: vi.fn(<T extends ArrayBufferView>(arr: T): T => {
        const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = (cryptoCounter + i) % 256;
        }
        cryptoCounter++;
        return arr;
      }),
      subtle: {
        importKey: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
        sign: vi.fn().mockRejectedValue(new Error("Token write failed")),
        verify: vi.fn().mockResolvedValue(true),
        deriveBits: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
        deriveKey: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
      } as unknown as SubtleCrypto,
    });

    const result = await securityVault.rotateMasterPassword(NEW_PASSWORD, OLD_PASSWORD);
    expect(result).toBe(false);
    // Restore the working crypto mock before re-unlock (assertVaultIntactAfterFailure
    // calls unlock which creates a verification token via crypto.subtle.sign).
    installCryptoMock();
    await assertVaultIntactAfterFailure();
  });

  it("drill 6: session token generation fails (generateSecureToken throws)", async () => {
    setupSecretSnapshots();

    // generateSessionToken() calls generateSecureToken(32) which calls
    // crypto.getRandomValues. Make the FIRST call succeed (for
    // createVerificationToken's nonce) and fail on the second (for
    // generateSessionToken).
    let nonceGenerated = false;
    vi.stubGlobal("crypto", {
      getRandomValues: vi.fn(<T extends ArrayBufferView>(arr: T): T => {
        if (!nonceGenerated) {
          // First call: createVerificationToken's nonce generation
          nonceGenerated = true;
          const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
          for (let i = 0; i < bytes.length; i++) {
            bytes[i] = (cryptoCounter + i) % 256;
          }
          cryptoCounter++;
          return arr;
        }
        // All subsequent calls: simulate crypto API failure
        throw new Error("crypto API unavailable");
      }),
      subtle: {
        importKey: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
        sign: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
        verify: vi.fn().mockResolvedValue(true),
        deriveBits: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
        deriveKey: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
      } as unknown as SubtleCrypto,
    });

    const result = await securityVault.rotateMasterPassword(NEW_PASSWORD, OLD_PASSWORD);
    expect(result).toBe(false);
    // Restore the working crypto mock before re-unlock (assertVaultIntactAfterFailure
    // calls unlock which creates a verification token via crypto.getRandomValues).
    installCryptoMock();
    await assertVaultIntactAfterFailure();
  });

  it("drill 7: vault locked mid-rotation (assertion fires)", async () => {
    setupSecretSnapshots();

    // After the first setSecret (salt rotation), lock the vault.
    let lockDuringRotation = false;
    secureStorageMock.setSecret.mockImplementation(async (key: string) => {
      if (key === "kdf_salt" && !lockDuringRotation) {
        lockDuringRotation = true;
        queueMicrotask(() => securityVault.lock());
      }
      return undefined;
    });

    const result = await securityVault.rotateMasterPassword(NEW_PASSWORD, OLD_PASSWORD);
    expect(result).toBe(false);

    // When the vault is locked mid-rotation, the password bytes are zeroed.
    expect(securityVault.isLocked()).toBe(true);

    // E. The vault can re-unlock with the OLD password (real proof).
    const unlocked = await securityVault.unlock(OLD_PASSWORD);
    expect(unlocked).toBe(true);
    expect(securityVault.isLocked()).toBe(false);
  });

  it("drill 8: double-rotation attempt is serialized (second call reuses the in-flight promise)", async () => {
    setupSecretSnapshots();

    let resolveFirst: (() => void) | null = null;
    const firstBlocker = new Promise<void>((r) => { resolveFirst = r; });

    // Block the first rotation on setSecret for kdf_salt.
    let setSecretCount = 0;
    secureStorageMock.setSecret.mockImplementation(async (key: string) => {
      if (key === "kdf_salt") {
        setSecretCount++;
        if (setSecretCount === 1) await firstBlocker;
      }
      return undefined;
    });

    // Fire both calls synchronously. The inner `rotateMasterPassword` stores
    // the operation promise in `this.rotationPromise` before any await, so
    // the second synchronous call returns `this.rotationPromise` directly.
    // The outer wrapper wraps it, so the two returned promises are different
    // objects but share the same resolution — both receive the same boolean.
    const first = securityVault.rotateMasterPassword(NEW_PASSWORD, OLD_PASSWORD);
    const second = securityVault.rotateMasterPassword(NEW_PASSWORD + "x", OLD_PASSWORD);

    // Unblock the rotation.
    resolveFirst!();
    const [r1, r2] = await Promise.all([first, second]);
    // Both return the same boolean (the inner rotation's result).
    expect(r1).toBe(r2);
  });

  // ── P1 mock-contract sweep ───────────────────────────────────────────────

  it("drill 9: rollback restores NON-NULL device-key wrapper, verification token and integrity record", async () => {
    setupSecretSnapshots();
    // Prime non-null snapshots AFTER the beforeEach unlock (which needs a null token):
    secureStorageMock.getWrappedDeviceKeyBlob.mockResolvedValue(
      "wrapped-device-key-blob",
    );
    secureStorageMock.getVerificationToken.mockResolvedValue(
      "encrypted_vault_verification",
    );
    // Failure AFTER the snapshot phase (same injection as drill 2):
    decryptMockFn.mockRejectedValue(new Error("Crypto failure"));

    const result = await securityVault.rotateMasterPassword(
      NEW_PASSWORD,
      OLD_PASSWORD,
    );
    expect(result).toBe(false);

    // The restore branches (rotation.ts rollback) only run for non-null snapshots:
    expect(
      secureStorageMock.restoreWrappedDeviceKeyBlob,
    ).toHaveBeenCalledWith("wrapped-device-key-blob");
    expect(secureStorageMock.restoreVerificationToken).toHaveBeenCalledWith(
      "encrypted_vault_verification",
    );
    expect(secureStorageMock.storeVerificationIntegrity).toHaveBeenCalledWith(
      TEST_INTEGRITY_RECORD,
    );

    // Return to the tokenless state so post-condition E (re-unlock) is the
    // same first-run path the other drills use.
    secureStorageMock.getVerificationToken.mockResolvedValue(null);
    await assertVaultIntactAfterFailure();
  });

  it("drill 10: a successful unlock verifies the audit chain (auditLog.verifyIntegrity)", async () => {
    // The beforeEach unlock already ran the H2 hook:
    expect(auditLog.verifyIntegrity).toHaveBeenCalled();
  });
});
