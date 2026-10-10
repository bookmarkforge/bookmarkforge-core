import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

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
    // A-1: per-vault Argon2id salt installation (unlock provisions it).
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
    // S1: return a valid integrity record by default so tests that use
    // verification tokens don't need to set up the integrity mock explicitly.
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
  // Audit H5 — master-password wrapping + raw tokens
  getVerificationToken: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  storeVerificationToken: vi.fn(() => Promise.resolve(undefined)),
  // A-1: token + integrity record are written in ONE transaction.
  storeVerificationTokenWithIntegrity: vi.fn(() => Promise.resolve(undefined)),
  // S1: raw integrity record (readable while the vault is locked).
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
  // Mirrors the real unwrap: a successful unwrap materializes the key in
  // memory (isDeviceKeyMaterialized becomes true) — the unlock post-condition
  // depends on this coupling.
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

// A-1 / ADR-046: the cross-tab notification is mocked so the assertions can be
// about WHEN the vault announces (a committed rotation, never a rollback). The
// transport itself — channel, storage-authoritative adoption, forged-message
// inertness — is covered by p0-vault-kdf-salt.regression.test.ts.
vi.mock("../../services/security-vault/kdf-salt-sync", () => ({
  announceVaultKdfSaltChange: vi.fn(),
  startVaultKdfSaltSync: vi.fn(),
  stopVaultKdfSaltSync: vi.fn(),
}));

const { securityVault } = await import("../../services/SecurityVault");
const { useRateLimitStore } = await import("../../store/rateLimitStore");
const { auditLog, rotateAuditSessionId } =
  await import("../../services/AuditLogService");
const { logger } = await import("../../utils/logger");

const testCaller = {};
securityVault.registerCaller(testCaller);

/**
 * Resets all mock call history but restores critical mock implementations
 * that unlock/lock/encrypt/decrypt depend on.
 * Tests use this instead of bare vi.clearAllMocks() which destroys all.
 */
async function resetMocks(): Promise<void> {
  vi.clearAllMocks();
  // Restore auditLog - unlock/lock/encrypt/decrypt call .catch() on it
  (auditLog.record as any).mockResolvedValue(undefined);
  (auditLog.flushPending as any).mockResolvedValue(undefined);
  // Restore encryptionService mocks (clearAllMocks resets mockResolvedValue)
  decryptMockFn.mockResolvedValue("decrypted_data");
  encryptMockFn.mockResolvedValue("encrypted_data");
  // Restore SecureStorage mock implementations
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
  secureStorageMock.setMasterPasswordConfiguredFlag.mockResolvedValue(undefined);
  secureStorageMock.hasMasterPasswordConfiguredFlagRaw.mockResolvedValue(false);
  secureStorageMock.isDeviceKeyMaterialized.mockReturnValue(false);
  secureStorageMock.ensureDeviceKeyMaterialized.mockResolvedValue(undefined);
  secureStorageMock.isDeviceKeyWrapped.mockResolvedValue(false);
  secureStorageMock.wrapDeviceKeyWithPassword.mockResolvedValue(undefined);
  secureStorageMock.unwrapDeviceKeyWithPassword.mockImplementation(() => {
    secureStorageMock.isDeviceKeyMaterialized.mockReturnValue(true);
    return Promise.resolve(new ArrayBuffer(1));
  });
  secureStorageMock.rewrapDeviceKeyWithPasswordBytes.mockResolvedValue(undefined);
  secureStorageMock.lockDeviceKey.mockReset();
  secureStorageMock.setRecoveryDataRaw.mockResolvedValue(undefined);
  secureStorageMock.getRecoveryDataRaw.mockResolvedValue(null);
  secureStorageMock.hasRecoveryDataRaw.mockResolvedValue(false);
  secureStorageMock.clearRecoveryDataRaw.mockResolvedValue(undefined);
  secureStorageMock.purgeExpiredPendingKeys.mockResolvedValue(undefined);
}

// Counter to generate different tokens in the crypto mock
let cryptoCounter = 0;

describe("SecurityVault", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear accumulated state in SecureStorage mock
    secureStorageMock._store.clear();
    // Re-apply default implementations that clearAllMocks() does NOT reset
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
    // Reset auditLog mocks (clearAllMocks resets mockResolvedValue)
    (auditLog.record as any).mockResolvedValue(undefined);
    (auditLog.flushPending as any).mockResolvedValue(undefined);
    (auditLog.verifyIntegrity as any).mockResolvedValue({
      valid: true,
      brokenAt: null,
      checked: 0,
    });
    vi.useFakeTimers();
    cryptoCounter = 0;
    if (!securityVault.isLocked()) {
      await securityVault.lock();
    }
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
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (!securityVault.isLocked()) {
      await securityVault.lock();
    }
    useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });
    localStorage.clear();
  });

  describe("unlock", () => {
    it("sets master password and generates session token", async () => {
      await securityVault.unlock("my_secret_password");
      expect(securityVault.isLocked()).toBe(false);
      expect(securityVault.withMasterPasswordBytes(testCaller, (p) => p ? new TextDecoder().decode(p) : null)).toBe(
        "my_secret_password",
      );
      expect(securityVault.getSessionToken()).not.toBeNull();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "vault_unlock",
          result: "success",
          origin: "SecurityVault",
        }),
      );
    });

    it("generates a 64-hex-char session token", async () => {
      await securityVault.unlock("password123456");
      const token = securityVault.getSessionToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it("cleans up the device key when verification-token creation fails", async () => {
      (crypto.subtle.sign as any).mockRejectedValueOnce(
        new Error("Integrity signing unavailable"),
      );

      await expect(securityVault.unlock("password123456")).resolves.toBe(false);
      expect(securityVault.isLocked()).toBe(true);
      expect(securityVault.getSessionToken()).toBeNull();
      expect(secureStorageMock.lockDeviceKey).toHaveBeenCalled();
      expect(secureStorageMock.isDeviceKeyMaterialized()).toBe(false);
    });

    it("starts session rotation on unlock", async () => {
      await securityVault.unlock("password123456");
      expect((securityVault as any).rotationTimer).not.toBeNull();
    });

    it("calls crypto.getRandomValues to generate the token", async () => {
      await securityVault.unlock("password123456");
      expect(crypto.getRandomValues).toHaveBeenCalled();
    });

    it("rejects an invalid password when a verification token exists", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getVerificationToken as any).mockResolvedValueOnce(
        "encrypted_vault_verification",
      );
      (encryptionService.decryptWithBytes as any).mockResolvedValueOnce(
        "wrong_decrypted_value",
      );
      // S1: mock the integrity record so HMAC validation passes.
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "vault_verification_integrity") {
          return Promise.resolve(
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
            ":aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
          );
        }
        return Promise.resolve(null);
      });

      const result = await securityVault.unlock("wrong_password");
      expect(result).toBe(false);
      expect(securityVault.isLocked()).toBe(true);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "vault_unlock_failed",
          result: "failure",
          origin: "SecurityVault",
        }),
      );
    });

    it("rejects the password when decrypt throws (corrupt token)", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getVerificationToken as any).mockResolvedValueOnce("corrupted_token");      (encryptionService.decryptWithBytes as any).mockRejectedValueOnce(
        new Error("Decrypt failed"),
      );
      // S1: mock the integrity record so HMAC validation passes.
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "vault_verification_integrity") {
          return Promise.resolve(
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
            ":aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
          );
        }
        return Promise.resolve(null);
      });

      const result = await securityVault.unlock("password123456");
      expect(result).toBe(false);
      expect(securityVault.isLocked()).toBe(true);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "vault_unlock_failed",
          result: "failure",
          origin: "SecurityVault",
        }),
      );
    });


    it("accepts the correct password when a verification token exists", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getVerificationToken as any).mockResolvedValueOnce(
        "encrypted_vault_verification",
      );
      (encryptionService.decrypt as any).mockResolvedValueOnce(
        "bookmarkforge-verify-ok",
      );

      const result = await securityVault.unlock("correct_password");
      expect(result).toBe(true);
      expect(securityVault.isLocked()).toBe(false);
      expect(securityVault.withMasterPasswordBytes(testCaller, (p) => p ? new TextDecoder().decode(p) : null)).toBe(
        "correct_password",
      );
    });

    it("creates the verification token on first unlock (did not exist before)", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");

      await securityVault.unlock("first_time_password");

      // S1: createVerificationToken now calls encryptWithBytes with Uint8Array
      expect(encryptionService.encryptWithBytes).toHaveBeenCalledWith(
        "bookmarkforge-verify-ok",
        expect.any(Uint8Array),
      );
      // Audit H5: token is stored raw (password-encrypted only), so it
      // stays readable while the vault is locked. A-1: the token and its S1
      // integrity record are persisted in ONE transaction so a crash can
      // never leave a token/HMAC pair that no password unlocks.
      expect(
        secureStorage.storeVerificationTokenWithIntegrity,
      ).toHaveBeenCalledWith(
        "encrypted_data",
        expect.stringMatching(/^[0-9a-f]{64}:[0-9a-f]{64}$/),
      );
      // H5: first unlock wraps the device key with the master password.
      expect(secureStorage.wrapDeviceKeyWithPassword).toHaveBeenCalledWith(
        "first_time_password",
      );
    });

    // ── A-1: per-vault Argon2id salt + transparent migration ─────────────

    it("provisions a per-vault KDF salt on unlock and re-wraps a legacy token", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const { encryptionService } =
        await import("../../services/EncryptionService");
      secureStorageMock.hasSecret.mockImplementation((key: string) =>
        Promise.resolve(key === "vault_verification"),
      );
      secureStorageMock.getVerificationToken.mockResolvedValue(
        "v5:legacy-token",
      );
      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );

      const result = await securityVault.unlock("correct_password");

      expect(result).toBe(true);
      // The salt is minted, persisted under its own storage key and installed
      // in the crypto layer.
      const storedSalt = secureStorageMock._store.get("kdf_salt");
      expect(storedSalt).toMatch(/^[0-9a-f]{32}$/);
      expect(encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        storedSalt,
      );
      // …and the legacy (fixed-salt) verification token is re-minted as a v6
      // payload, together with its integrity record in one write.
      expect(
        secureStorage.storeVerificationTokenWithIntegrity,
      ).toHaveBeenCalledWith(
        "encrypted_data",
        expect.stringMatching(/^[0-9a-f]{64}:[0-9a-f]{64}$/),
      );
    });

    it("does not re-mint a token that is already salted (idempotent unlock)", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const { encryptionService } =
        await import("../../services/EncryptionService");
      secureStorageMock.hasSecret.mockImplementation((key: string) =>
        Promise.resolve(key === "vault_verification"),
      );
      secureStorageMock.getVerificationToken.mockResolvedValue(
        "v6:already-salted-token",
      );
      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );

      const result = await securityVault.unlock("correct_password");

      expect(result).toBe(true);
      expect(
        secureStorage.storeVerificationTokenWithIntegrity,
      ).not.toHaveBeenCalled();
    });

    it("keeps unlocking when the KDF salt cannot be provisioned", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      // Storage rejects the read (e.g. wrapped device key): the vault stays in
      // legacy mode instead of failing the unlock.
      (secureStorageMock.getSecret as any).mockImplementation(
        (key: string) => {
          if (key === "kdf_salt") {
            return Promise.reject(new Error("unreadable"));
          }
          return Promise.resolve(null);
        },
      );

      const result = await securityVault.unlock("correct_password");

      expect(result).toBe(true);
      expect(encryptionService.configureVaultKdfSalt).not.toHaveBeenCalled();
    });

    it("initializes zero-memory processor after successful unlock", async () => {
      await securityVault.unlock("password123456");
      const processor = (securityVault as any).zeroMemoryProcessor;
      expect(processor).not.toBeNull();
      expect(typeof processor.zeroBytes).toBe("function");
    });

    it("does not throw if auditLog.record fails during a successful unlock", async () => {
      (auditLog.record as any).mockRejectedValueOnce(
        new Error("Audit log failed"),
      );
      const result = await securityVault.unlock("password123456");
      // Must keep working even if auditLog fails
      expect(result).toBe(true);
      expect(securityVault.isLocked()).toBe(false);
    });

    it("rejects an empty password or one shorter than 8 characters", async () => {
      const result = await securityVault.unlock("");
      expect(result).toBe(false);
      expect(securityVault.isLocked()).toBe(true);
    });

    it("rejects a short password (< 8 chars)", async () => {
      const result = await securityVault.unlock("abc1234");
      expect(result).toBe(false);
      expect(securityVault.isLocked()).toBe(true);
    });

    it("locks vault after 5 consecutive failed attempts", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getVerificationToken as any).mockResolvedValue(
        "encrypted_vault_verification",
      );
      (encryptionService.decrypt as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );

      // Primer unlock exitoso
      await securityVault.unlock("correct_password");
      expect(securityVault.isLocked()).toBe(false);
      securityVault.lock();

      // Force verifyPassword to fail for the next attempts
      (encryptionService.decrypt as any).mockResolvedValue("wrong_value");

      // 5 intentos fallidos
      for (let i = 0; i < 5; i++) {
        const attempt = await securityVault.unlock("wrong_password");
        expect(attempt).toBe(false);
        expect(securityVault.isLocked()).toBe(true);
      }

      // The vault is locked out — even a correct password fails
      (encryptionService.decrypt as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );
      const afterLockout = await securityVault.unlock("correct_password");
      expect(afterLockout).toBe(false);
      expect(securityVault.isLocked()).toBe(true);
    });
  });

  describe("lock", () => {
    it("clears password, token and expiry", async () => {
      await securityVault.unlock("password123456");
      await resetMocks();
      securityVault.lock();
      expect(securityVault.isLocked()).toBe(true);
      expect(securityVault.withMasterPasswordBytes(testCaller, (p) => p ? new TextDecoder().decode(p) : null)).toBeNull();
      expect(securityVault.getSessionToken()).toBeNull();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "vault_lock",
          result: "success",
          origin: "SecurityVault",
        }),
      );
    });

    it("flushes the lock audit before dropping the device key", async () => {
      await securityVault.unlock("password123456");
      let release!: () => void;
      (auditLog.flushPending as any).mockImplementationOnce(
        () => new Promise<void>((resolve) => { release = resolve; }),
      );

      const lockPromise = securityVault.lock();
      expect(securityVault.isLocked()).toBe(true);
      expect(auditLog.flushPending).toHaveBeenCalledTimes(1);
      expect(secureStorageMock.lockDeviceKey).not.toHaveBeenCalled();

      release();
      await lockPromise;
      expect(secureStorageMock.lockDeviceKey).toHaveBeenCalledTimes(1);
    });

    it("stops session rotation", async () => {
      await securityVault.unlock("password123456");
      await securityVault.lock();
      expect((securityVault as any).rotationTimer).toBeNull();
    });

    it("does not start rotation when window is undefined (SSR) (L-09)", async () => {
      // Before L-09, startSessionRotation crashed in window-less environments.
      vi.stubGlobal("window", undefined);
      (securityVault as any).startSessionRotation();
      expect((securityVault as any).rotationTimer).toBeNull();
      vi.unstubAllGlobals();
    });
  });

  describe("lock/unlock listeners", () => {
    it("emits onLock when locking the vault", async () => {
      const onLock = vi.fn();
      const unsubscribe = securityVault.onLock(onLock);
      await securityVault.unlock("password123456");
      onLock.mockClear();
      await securityVault.lock();
      expect(onLock).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("emits onUnlock after a successful unlock", async () => {
      const onUnlock = vi.fn();
      const unsubscribe = securityVault.onUnlock(onUnlock);
      await securityVault.unlock("password123456");
      expect(onUnlock).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("does not emit onUnlock if the unlock fails", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getVerificationToken as any).mockResolvedValueOnce(
        "encrypted_vault_verification",
      );
      (encryptionService.decrypt as any).mockResolvedValueOnce(
        "wrong_decrypted_value",
      );

      const onUnlock = vi.fn();
      securityVault.onUnlock(onUnlock);
      // Invalid password → unlock fails and must not emit onUnlock
      const result = await securityVault.unlock("wrong_password");
      expect(result).toBe(false);
      expect(onUnlock).not.toHaveBeenCalled();
    });

    it("unsubscribe removes the listener", async () => {
      const onLock = vi.fn();
      const unsubscribe = securityVault.onLock(onLock);
      unsubscribe();
      await securityVault.unlock("password123456");
      await securityVault.lock();
      expect(onLock).not.toHaveBeenCalled();
    });
  });

  describe("isLocked", () => {
    it("returns true after construction", () => {
      expect(securityVault.isLocked()).toBe(true);
    });

    it("returns false after unlock", async () => {
      await securityVault.unlock("password123456");
      expect(securityVault.isLocked()).toBe(false);
    });

    it("returns true after lock", async () => {
      await securityVault.unlock("password123456");
      securityVault.lock();
      expect(securityVault.isLocked()).toBe(true);
    });
  });

  describe("getSessionToken", () => {
    it("returns the token when the vault is unlocked and not expired", async () => {
      await securityVault.unlock("password123456");
      const token = securityVault.getSessionToken();
      expect(token).not.toBeNull();
      expect(typeof token).toBe("string");
    });

    it("returns null when the vault is locked", () => {
      expect(securityVault.getSessionToken()).toBeNull();
    });

    it("returns a non-null token after rotation (rotation keeps it alive)", async () => {
      // Session rotation (15 min) renews the token before it expires (30 min)
      // By design, the token never expires while rotation is active
      await securityVault.unlock("password123456");

      const tokenOriginal = securityVault.getSessionToken();
      // Advance beyond the first rotation interval (15 min)
      await vi.advanceTimersByTimeAsync(16 * 60 * 1000);

      const tokenDespues = securityVault.getSessionToken();
      // The token is NOT null - rotation renewed it
      expect(tokenDespues).not.toBeNull();
      // El token es diferente al original (fue rotado)
      expect(tokenDespues).not.toBe(tokenOriginal);
    });

    it("returns the token when not expired (14 min later)", async () => {
      await securityVault.unlock("password123456");
      vi.advanceTimersByTime(14 * 60 * 1000);
      expect(securityVault.getSessionToken()).not.toBeNull();
    });
  });

  describe("encryptSecret", () => {
    it("cifra y almacena un secreto", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");

      await securityVault.unlock("password123456");
      await resetMocks();
      const result = await securityVault.encryptSecret("api_key_123");

      expect(encryptionService.encryptWithBytes).toHaveBeenCalledWith(
        "api_key_123",
        expect.any(Uint8Array),
      );
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_api_key",
        "encrypted_data",
      );
      expect(result).toBe("encrypted_data");
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "secret_encrypt",
          result: "success",
          origin: "SecurityVault",
        }),
      );
    });

    it("throws if the vault is locked", async () => {
      await expect(securityVault.encryptSecret("secret")).rejects.toThrow(
        "Vault is locked",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "secret_encrypt",
          result: "failure",
          origin: "SecurityVault",
        }),
      );
    });

    it("uses a custom key if provided", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.unlock("password123456");
      await securityVault.encryptSecret("my_value", "custom_key");
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "custom_key",
        "encrypted_data",
      );
    });
  });

  describe("decryptSecret", () => {
    it("descifra un secreto almacenado", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.unlock("password123456");
      await resetMocks();
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "vault_verification_integrity") return Promise.resolve(TEST_INTEGRITY_RECORD);
        if (key === "encrypted_api_key") return Promise.resolve("stored_secret");
        return Promise.resolve(null);
      });
      const result = await securityVault.decryptSecret();

      expect(result).toBe("decrypted_data");
      expect(encryptionService.decryptWithBytes).toHaveBeenCalledWith(
        "stored_secret",
        expect.any(Uint8Array),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "secret_decrypt",
          result: "success",
          origin: "SecurityVault",
        }),
      );
    });

    it("throws if the vault is locked", async () => {
      await expect(securityVault.decryptSecret()).rejects.toThrow(
        "Vault is locked",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "secret_decrypt",
          result: "failure",
          origin: "SecurityVault",
        }),
      );
    });

    it("lanza error si no hay secreto almacenado", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.unlock("password123456");
      (secureStorage.getSecret as any).mockResolvedValueOnce(null);
      await expect(securityVault.decryptSecret()).rejects.toThrow(
        "Secret not found",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "secret_decrypt",
          result: "failure",
          origin: "SecurityVault",
        }),
      );
    });

    it("uses a custom key if provided", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.unlock("password123456");
      // Mock getSecret to return something for custom_key so decryptSecret succeeds.
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "vault_verification_integrity") return Promise.resolve(TEST_INTEGRITY_RECORD);
        if (key === "custom_key") return Promise.resolve("stored_secret");
        return Promise.resolve(null);
      });
      await securityVault.decryptSecret("custom_key");
      expect(secureStorage.getSecret).toHaveBeenCalledWith("custom_key");
    });
  });

  describe("setRecoveryData", () => {
    it("stores recovery data (via raw, H5)", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.setRecoveryData("encrypted_recovery");
      expect(secureStorage.setRecoveryDataRaw).toHaveBeenCalledWith(
        "encrypted_recovery",
      );
    });
  });

  describe("getRecoveryData", () => {
    it("returns recovery data (via raw, H5)", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getRecoveryDataRaw as any).mockResolvedValue(
        "stored_secret",
      );
      const data = await securityVault.getRecoveryData();
      expect(data).toBe("stored_secret");
    });

    it("returns null when there is no data", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getRecoveryDataRaw as any).mockResolvedValueOnce(null);
      const data = await securityVault.getRecoveryData();
      expect(data).toBeNull();
    });
  });

  describe("hasRecoveryData", () => {
    it("returns true when recovery data exists (via raw, H5)", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.hasRecoveryDataRaw as any).mockResolvedValue(true);
      const result = await securityVault.hasRecoveryData();
      expect(result).toBe(true);
    });

    it("returns false if it does not exist", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.hasRecoveryDataRaw as any).mockResolvedValueOnce(false);
      const result = await securityVault.hasRecoveryData();
      expect(result).toBe(false);
    });
  });

  describe("clearRecoveryData", () => {
    it("deletes recovery data (via raw, H5)", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.clearRecoveryData();
      expect(secureStorage.clearRecoveryDataRaw).toHaveBeenCalled();
    });
  });

  describe("hasSecret", () => {
    it("checks whether a secret exists", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.hasSecret as any).mockImplementation((key: string) => {
        if (key === "encrypted_api_key") return Promise.resolve(true);
        return Promise.resolve(false);
      });
      const result = await securityVault.hasSecret();
      expect(result).toBe(true);
    });

    it("checks with a custom key", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.hasSecret("mi_key");
      expect(secureStorage.hasSecret).toHaveBeenCalledWith("mi_key");
    });
  });

  describe("rotateMasterPassword", () => {
    it("rotates the password with an explicit oldPassword", async () => {
      await securityVault.unlock("old_password123");
      await resetMocks();
      const result = await securityVault.rotateMasterPassword(
        "new_password_123",
        "old_password123",
      );
      expect(result).toBe(true);
      expect(securityVault.withMasterPasswordBytes(testCaller, (p) => p ? new TextDecoder().decode(p) : null)).toBe(
        "new_password_123",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "master_password_rotate",
          result: "success",
          origin: "SecurityVault",
        }),
      );
    });

    it("rotates the password using the stored master password", async () => {
      await securityVault.unlock("current_pass");
      await resetMocks();
      const result = await securityVault.rotateMasterPassword("new_password_123");
      expect(result).toBe(true);
      expect(securityVault.withMasterPasswordBytes(testCaller, (p) => p ? new TextDecoder().decode(p) : null)).toBe(
        "new_password_123",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "master_password_rotate",
          result: "success",
          origin: "SecurityVault",
        }),
      );
    });

    it("returns false when the vault is locked and no oldPassword is given", async () => {
      const result = await securityVault.rotateMasterPassword("new_password_123");
      expect(result).toBe(false);
    });

    it("does not restore an unlocked session when locked during rotation", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.unlock("old_password123");
      let releaseSnapshot!: (value: string) => void;
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "encrypted_api_key") {
          return new Promise<string>((resolve) => { releaseSnapshot = resolve; });
        }
        return Promise.resolve(null);
      });

      const rotation = securityVault.rotateMasterPassword(
        "new_password_123",
        "old_password123",
      );
      await Promise.resolve();
      securityVault.lock();
      releaseSnapshot("encrypted_api_key_snapshot");

      await expect(rotation).resolves.toBe(false);
      expect(securityVault.isLocked()).toBe(true);
      expect(
        securityVault.withMasterPasswordBytes(testCaller, (p) => p),
      ).toBeNull();
    });

    it("rejects a new password with leading or trailing whitespace (M-05)", async () => {
      const { secureStorage } =
        await import("../../services/SecureStorage");
      await securityVault.unlock("old_password123");
      (secureStorage.setSecret as any).mockClear();
      const result = await securityVault.rotateMasterPassword(
        "  padded_pass  ",
        "old_password123",
      );
      expect(result).toBe(false);
      // The in-memory password must not have changed
      expect(
        securityVault.withMasterPasswordBytes(testCaller, (p) =>
          p ? new TextDecoder().decode(p) : null,
        ),
      ).toBe("old_password123");
      // NO secret re-write must have occurred (no partial rotation)
      expect(secureStorage.setSecret).not.toHaveBeenCalled();
    });

    it("rejects a new password shorter than 8 characters (M-05)", async () => {
      await securityVault.unlock("old_password123");
      const result = await securityVault.rotateMasterPassword(
        "short",
        "old_password123",
      );
      expect(result).toBe(false);
      expect(
        securityVault.withMasterPasswordBytes(testCaller, (p) =>
          p ? new TextDecoder().decode(p) : null,
        ),
      ).toBe("old_password123");
    });

    it("returns false if the oldPassword does not match", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.unlock("real_password123");
      (secureStorage.getSecret as any).mockResolvedValue("encrypted-secret");
      (encryptionService.decryptWithBytes as any).mockRejectedValue(
        new Error("Wrong password"),
      );
      const result = await securityVault.rotateMasterPassword(
        "new_password_123",
        "wrong_pass",
      );
      expect(result).toBe(false);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "master_password_rotate",
          result: "failure",
          origin: "SecurityVault",
        }),
      );
    });

    it("decrypts and re-encrypts secrets with the correct passwords", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getSecret as any).mockResolvedValue("encrypted-secret");
      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "plaintext",
      );
      (encryptionService.encryptWithBytes as any).mockResolvedValue(
        "re-encrypted",
      );

      await securityVault.unlock("old_password123");
      await securityVault.rotateMasterPassword("new_password_123", "old_password123");
      expect(encryptionService.decryptWithBytes).toHaveBeenCalled();
      // S1: createVerificationToken calls encryptWithBytes first, so the
      // first decryptWithBytes call is at index 0 (the secret decryption).
      const decryptCall = (encryptionService.decryptWithBytes as any).mock
        .calls[0];
      expect(decryptCall[0]).toBe("encrypted-secret");
      expect(decryptCall[1]).toBeDefined();
      expect(encryptionService.encryptWithBytes).toHaveBeenCalled();
      // S1: the first encryptWithBytes call is from createVerificationToken
      // (encrypting "bookmarkforge-verify-ok"), the second is the secret re-encryption.
      const encryptCalls = (encryptionService.encryptWithBytes as any).mock.calls;
      const hasPlaintextCall = encryptCalls.some((call: unknown[]) => call[0] === "plaintext");
      expect(hasPlaintextCall).toBe(true);
    });

    it("regenerates the session token after rotation", async () => {
      // crypto mock produces different tokens on each call
      await securityVault.unlock("old_password123");
      const tokenAntes = securityVault.getSessionToken();
      await securityVault.rotateMasterPassword("new_password_123", "old_password123");
      const tokenDespues = securityVault.getSessionToken();
      expect(tokenAntes).not.toBe(tokenDespues);
    });

    it("restores original secrets if encrypt fails (rollback)", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.unlock("old_password123");

      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "encrypted_api_key")
          return Promise.resolve("original_api_encrypted");
        if (key === "recovery_data")
          return Promise.resolve("original_recovery_encrypted");
        if (key === "encrypted_db_key")
          return Promise.resolve("original_db_encrypted");
        return Promise.resolve("stored_secret");
      });

      // decrypt succeeds, encrypt fails (simulates a partial failure after the first re-encryption)
      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "plaintext",
      );
      (encryptionService.encryptWithBytes as any).mockRejectedValueOnce(
        new Error("Encryption failed"),
      );

      const result = await securityVault.rotateMasterPassword(
        "new_password_123",
        "old_password123",
      );
      expect(result).toBe(false);

      // Verify that the original secrets were restored
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_api_key",
        "original_api_encrypted",
      );
      // recovery_data is NOT rotated (encrypted with the recovery phrase,
      // not the master password) — it must never be touched
      expect(secureStorage.setSecret).not.toHaveBeenCalledWith(
        "recovery_data",
        expect.anything(),
      );
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_db_key",
        "original_db_encrypted",
      );
      // The in-memory password must remain the original
      expect(securityVault.withMasterPasswordBytes(testCaller, (p) => p ? new TextDecoder().decode(p) : null)).toBe(
        "old_password123",
      );
    });

    it("restores original secrets even if setSecret fails during rollback", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.unlock("old_password123");

      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "encrypted_api_key")
          return Promise.resolve("original_api_encrypted");
        if (key === "recovery_data")
          return Promise.resolve("original_recovery_encrypted");
        if (key === "encrypted_db_key")
          return Promise.resolve("original_db_encrypted");
        return Promise.resolve("stored_secret");
      });

      // encrypt fails on the first key — forcing rollback
      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "plaintext",
      );
      (encryptionService.encryptWithBytes as any).mockRejectedValueOnce(
        new Error("Encryption failed"),
      );
      // Every payload write fails (the salt one excepted), so the failure AND
      // the rollback writes both hit a dead storage — the .catch(() => {})
      // must swallow both and still report a clean `false`. Expressed as a
      // per-key rule rather than a `...Once()` so the test cannot depend on
      // which write happens to come first.
      (secureStorage.setSecret as any).mockImplementation(
        (key: string, value: string) => {
          if (key === "kdf_salt") {
            secureStorageMock._store.set(key, value);
            return Promise.resolve(undefined);
          }
          return Promise.reject(new Error("Storage write failed"));
        },
      );

      const result = await securityVault.rotateMasterPassword(
        "new_password_123",
        "old_password123",
      );
      // Must not throw — the rollback uses .catch(() => {})
      expect(result).toBe(false);
      // The in-memory password must remain the original
      expect(securityVault.withMasterPasswordBytes(testCaller, (p) => p ? new TextDecoder().decode(p) : null)).toBe(
        "old_password123",
      );
    });

    it("continues rollback when some snapshots are null", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.unlock("old_password123");

      // encrypted_db_key no existe en secureStorage → snapshot null
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "encrypted_api_key")
          return Promise.resolve("original_api_encrypted");
        if (key === "recovery_data")
          return Promise.resolve("original_recovery_encrypted");
        if (key === "encrypted_db_key")
          return Promise.resolve(null); // este es null
        return Promise.resolve("stored_secret");
      });

      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "plaintext",
      );
      (encryptionService.encryptWithBytes as any).mockRejectedValueOnce(
        new Error("Encryption failed"),
      );

      const result = await securityVault.rotateMasterPassword(
        "new_password_123",
        "old_password123",
      );
      expect(result).toBe(false);

      // The ones that had values must be restored
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_api_key",
        "original_api_encrypted",
      );
      // recovery_data is NOT rotated — must never be touched
      expect(secureStorage.setSecret).not.toHaveBeenCalledWith(
        "recovery_data",
        expect.anything(),
      );
      // encrypted_db_key must not be restored because its snapshot was null
      // but the other two were restored
      expect(securityVault.withMasterPasswordBytes(testCaller, (p) => p ? new TextDecoder().decode(p) : null)).toBe(
        "old_password123",
      );
    });

    it("does not throw if auditLog.record fails during rollback and the password does not change", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.unlock("old_password123");

      // Mock getSecret so the snapshot has data, then decrypt will fail.
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "vault_verification_integrity") return Promise.resolve(TEST_INTEGRITY_RECORD);
        if (key === "encrypted_api_key") return Promise.resolve("original_api_encrypted");
        if (key === "encrypted_db_key") return Promise.resolve("original_db_encrypted");
        return Promise.resolve(null);
      });
      (encryptionService.decryptWithBytes as any).mockRejectedValue(
        new Error("Decrypt failed"),
      );
      (auditLog.record as any).mockRejectedValue(
        new Error("Audit log unavailable"),
      );

      const result = await securityVault.rotateMasterPassword(
        "new_password_123",
        "wrong_pass",
      );
      expect(result).toBe(false);
      // The in-memory password must not have changed
      expect(securityVault.withMasterPasswordBytes(testCaller, (p) => p ? new TextDecoder().decode(p) : null)).toBe(
        "old_password123",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "master_password_rotate",
          result: "failure",
        }),
      );
    });

    it("rollback restores all keys even if some were already re-encrypted", async () => {
      // Arrange: all keys have unique values
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.unlock("old_password123");

      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "encrypted_api_key")
          return Promise.resolve("original_api_encrypted");
        if (key === "recovery_data")
          return Promise.resolve("original_recovery_encrypted");
        if (key === "encrypted_db_key")
          return Promise.resolve("original_db_encrypted");
        return Promise.resolve("stored_secret");
      });

      // decrypt always succeeds
      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "plaintext",
      );

      // encrypt: key 1 (api_key) → succeeds, key 2 (db_key) → fails
      // key 1 was already updated with the new password in SecureStorage
      // The rollback must restore it to its original value
      const encryptMock = encryptionService.encryptWithBytes as any;
      encryptMock
        .mockResolvedValueOnce("re-encrypted_api")   // Key 1: success
        .mockRejectedValueOnce(new Error("Encryption failed")); // Key 2: fails

      // Act
      const result = await securityVault.rotateMasterPassword(
        "new_password_123",
        "old_password123",
      );

      // Assert: rollback must restore ALL keys (including key 1)
      expect(result).toBe(false);
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_api_key",
        "original_api_encrypted",  // Restaurado al snapshot original
      );
      // recovery_data is NOT rotated — must never be touched
      expect(secureStorage.setSecret).not.toHaveBeenCalledWith(
        "recovery_data",
        expect.anything(),
      );
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_db_key",
        "original_db_encrypted",
      );

      // Verify the in-memory password did NOT change
      expect(securityVault.withMasterPasswordBytes(testCaller, (p) => p ? new TextDecoder().decode(p) : null)).toBe(
        "old_password123",
      );
    });

    it("successfully re-encrypts all keys when all have secrets", async () => {
      // Arrange: the 3 keys have stored secrets
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.unlock("old_password123");

      let callCount = 0;
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        callCount++;
        if (key === "encrypted_api_key")
          return Promise.resolve("api_encrypted_" + callCount);
        if (key === "recovery_data")
          return Promise.resolve("recovery_encrypted_" + callCount);
        if (key === "encrypted_db_key")
          return Promise.resolve("db_encrypted_" + callCount);
        return Promise.resolve("stored_secret");
      });

      (encryptionService.decryptWithBytes as any).mockImplementation(
        (encrypted: string) => Promise.resolve(`decrypted_${encrypted}`),
      );

      let encryptCount = 0;
      (encryptionService.encryptWithBytes as any).mockImplementation(
        (plaintext: string) => {
          encryptCount++;
          return Promise.resolve(`re-encrypted_key${encryptCount}`);
        },
      );

      // Act
      const result = await securityVault.rotateMasterPassword(
        "new_password_123",
        "old_password123",
      );

      // Assert
      expect(result).toBe(true);

      // Each key was decrypted with the old password and re-encrypted with the new one.
      // S1: createVerificationToken also calls encryptWithBytes (for the
      // verification token and potentially other operations), so the total
      // is higher than 2. Just verify each secret was processed.
      expect(encryptionService.decryptWithBytes).toHaveBeenCalledTimes(2);
      expect(encryptionService.encryptWithBytes).toHaveBeenCalled();

      // Each key was saved with the new re-encrypted value.
      // S1: setSecret is also called for the verification token and integrity record,
      // so the total calls are higher. Just verify the api/db re-encryptions happened.
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_api_key",
        expect.any(String),
      );
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_db_key",
        expect.any(String),
      );
      // recovery_data is NOT rotated — must never be touched
      expect(secureStorage.setSecret).not.toHaveBeenCalledWith(
        "recovery_data",
        expect.anything(),
      );
      // The stale recovery_data copy is cleared after success (via raw, H5)
      expect(secureStorage.clearRecoveryDataRaw).toHaveBeenCalled();

      // The in-memory password was updated
      expect(securityVault.withMasterPasswordBytes(testCaller, (p) => p ? new TextDecoder().decode(p) : null)).toBe(
        "new_password_123",
      );

      // A new verification token was created (S1: now uses encryptWithBytes with Uint8Array)
      expect(encryptionService.encryptWithBytes).toHaveBeenCalledWith(
        "bookmarkforge-verify-ok",
        expect.any(Uint8Array),
      );
    });

    it("re-mints the per-vault KDF salt and re-wraps every secret under it (A-1)", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      const OLD_SALT = "ab".repeat(16);

      await securityVault.unlock("old_password123");
      (secureStorage.getSecret as any).mockImplementation((key: string) =>
        Promise.resolve(
          key === "kdf_salt"
            ? OLD_SALT
            : key === "encrypted_api_key"
              ? "original_api_encrypted"
              : key === "encrypted_db_key"
                ? "original_db_encrypted"
                : null,
        ),
      );
      (encryptionService.getVaultKdfSaltHex as any).mockReturnValue(OLD_SALT);
      // Drop the calls made by unlock() itself, so the order assertions below
      // describe the rotation and nothing else.
      (secureStorage.setSecret as any).mockClear();
      (encryptionService.configureVaultKdfSalt as any).mockClear();
      (encryptionService.encryptWithBytes as any).mockClear();
      (encryptionService.decryptWithBytes as any).mockClear();

      const result = await securityVault.rotateMasterPassword(
        "new_password_123",
        "old_password123",
      );
      expect(result).toBe(true);

      const setSecretCalls = (secureStorage.setSecret as any).mock
        .calls as Array<[string, string]>;
      const saltWrites = setSecretCalls.filter(([key]) => key === "kdf_salt");
      expect(saltWrites).toHaveLength(1);
      const newSalt = saltWrites[0]![1];
      expect(newSalt).toMatch(/^[0-9a-f]{32}$/);
      expect(newSalt).not.toBe(OLD_SALT);

      // Persist-then-install, and persist BEFORE anything is re-wrapped: the
      // vault must not write a single payload under a salt storage has not
      // accepted yet.
      expect(setSecretCalls[0]![0]).toBe("kdf_salt");
      expect(encryptionService.configureVaultKdfSalt).toHaveBeenCalledWith(
        newSalt,
      );
      expect(
        (encryptionService.configureVaultKdfSalt as any).mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        (encryptionService.encryptWithBytes as any).mock
          .invocationCallOrder[0]!,
      );

      // Every re-wrapped payload was re-encrypted AFTER the swap, i.e. under
      // the new salt (`v6:` payloads embed it).
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_api_key",
        "encrypted_data",
      );
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_db_key",
        "encrypted_data",
      );

      // A-1 / ADR-046: the committed rotation is announced ONCE to the sibling
      // tabs, so the ones already open re-read the salt instead of keeping to
      // write under the one the vault just retired.
      const { announceVaultKdfSaltChange } = await import(
        "../../services/security-vault/kdf-salt-sync"
      );
      expect(announceVaultKdfSaltChange).toHaveBeenCalledTimes(1);
    });

    it("restores the previous KDF salt when the rotation fails halfway (A-1 rollback)", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      const OLD_SALT = "cd".repeat(16);

      await securityVault.unlock("old_password123");
      (secureStorage.getSecret as any).mockImplementation((key: string) =>
        Promise.resolve(
          key === "kdf_salt"
            ? OLD_SALT
            : key === "encrypted_api_key"
              ? "original_api_encrypted"
              : key === "encrypted_db_key"
                ? "original_db_encrypted"
                : null,
        ),
      );
      (encryptionService.getVaultKdfSaltHex as any).mockReturnValue(OLD_SALT);
      (encryptionService.decryptWithBytes as any).mockResolvedValue("plaintext");
      // First key re-wraps (under the new salt), second one fails.
      (encryptionService.encryptWithBytes as any)
        .mockResolvedValueOnce("re-encrypted_api")
        .mockRejectedValueOnce(new Error("Encryption failed"));
      (encryptionService.configureVaultKdfSalt as any).mockClear();

      const result = await securityVault.rotateMasterPassword(
        "new_password_123",
        "old_password123",
      );
      expect(result).toBe(false);

      const installed = (
        (encryptionService.configureVaultKdfSalt as any).mock.calls as Array<
          [string | null]
        >
      ).map((call) => call[0]);
      // The new salt did reach the crypto layer…
      expect(installed.some((salt) => salt !== null && salt !== OLD_SALT)).toBe(
        true,
      );
      // …but the LAST thing installed is the previous salt: the session keeps
      // the old password, so it must keep the derivation that password was
      // stretched with.
      expect(installed[installed.length - 1]).toBe(OLD_SALT);
      // Both halves are restored — the stored one is what the next unlock uses.
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "kdf_salt",
        OLD_SALT,
      );
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_api_key",
        "original_api_encrypted",
      );
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "encrypted_db_key",
        "original_db_encrypted",
      );

      // A-1 / ADR-046: no announcement. The sibling tabs never left the
      // previous salt, and storage holds it again, so notifying them would
      // only make them re-read a value nothing changed — and announcing while
      // the rotation was still undoable is precisely what would leave them on
      // an uncommitted salt.
      const { announceVaultKdfSaltChange } = await import(
        "../../services/security-vault/kdf-salt-sync"
      );
      expect(announceVaultKdfSaltChange).not.toHaveBeenCalled();
    });

    it("aborts before touching any payload when the new salt cannot be persisted (A-1)", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      const OLD_SALT = "ef".repeat(16);

      await securityVault.unlock("old_password123");
      (secureStorage.getSecret as any).mockImplementation((key: string) =>
        Promise.resolve(
          key === "kdf_salt"
            ? OLD_SALT
            : key === "encrypted_api_key"
              ? "original_api_encrypted"
              : key === "encrypted_db_key"
                ? "original_db_encrypted"
                : null,
        ),
      );
      (encryptionService.getVaultKdfSaltHex as any).mockReturnValue(OLD_SALT);
      (encryptionService.configureVaultKdfSalt as any).mockClear();
      (encryptionService.encryptWithBytes as any).mockClear();
      (encryptionService.decryptWithBytes as any).mockClear();
      // The FIRST write of the rotation is the salt: make it fail.
      (secureStorage.setSecret as any).mockRejectedValueOnce(
        new Error("quota exceeded"),
      );

      const result = await securityVault.rotateMasterPassword(
        "new_password_123",
        "old_password123",
      );
      expect(result).toBe(false);
      // Fail-closed: no payload was read, re-wrapped or written, and the salt
      // the session continues on is the old one.
      expect(encryptionService.decryptWithBytes).not.toHaveBeenCalled();
      expect(encryptionService.encryptWithBytes).not.toHaveBeenCalled();
      const installed = (
        (encryptionService.configureVaultKdfSalt as any).mock.calls as Array<
          [string | null]
        >
      ).map((call) => call[0]);
      expect(installed.every((salt) => salt === OLD_SALT)).toBe(true);
      expect(
        securityVault.withMasterPasswordBytes(testCaller, (p) =>
          p ? new TextDecoder().decode(p) : null,
        ),
      ).toBe("old_password123");
    });
  });

  describe("deleteSecret", () => {
    it("deletes a secret", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.deleteSecret();
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith(
        "encrypted_api_key",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "secret_delete",
          result: "success",
          origin: "SecurityVault",
        }),
      );
    });

    it("deletes with a custom key", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.deleteSecret("custom_key");
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith("custom_key");
    });
  });

  describe("migrateFromLocalStorage", () => {
    it("migra datos de localStorage a IndexedDB", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      await securityVault.migrateFromLocalStorage();
      expect(secureStorage.migrateFromLocalStorage).toHaveBeenCalledWith(
        "forge_recovery_data",
        "recovery_data",
      );
      expect(secureStorage.migrateFromLocalStorage).toHaveBeenCalledWith(
        "encrypted_api_key",
        "encrypted_api_key",
      );
    });
  });

  describe("hasMasterPassword", () => {
    it("returns true when master_password_setup exists in SecureStorage", async () => {
      secureStorageMock.hasMasterPasswordConfiguredFlagRaw.mockResolvedValue(
        true,
      );
      const result = await securityVault.hasMasterPassword();
      expect(result).toBe(true);
    });

    it("returns true and migrates from legacy localStorage", async () => {
      secureStorageMock.hasSecret.mockImplementation((key: string) => {
        if (key === "vault_verification") return Promise.resolve(false);
        return Promise.resolve(false);
      });
      localStorage.setItem("forge_has_master_password", "true");
      const result = await securityVault.hasMasterPassword();
      expect(result).toBe(true);
      expect(secureStorageMock.setMasterPasswordConfiguredFlag).toHaveBeenCalled();
    });

    it("returns false when the flag does not exist in any storage", async () => {
      secureStorageMock.hasSecret.mockImplementation((key: string) => {
        if (key === "vault_verification") return Promise.resolve(false);
        return Promise.resolve(false);
      });
      const result = await securityVault.hasMasterPassword();
      expect(result).toBe(false);
    });

    it("returns false when window is undefined (SSR)", async () => {
      vi.stubGlobal("window", undefined);
      const result = await securityVault.hasMasterPassword();
      expect(result).toBe(false);
    });
  });

  describe("setMasterPasswordFlag", () => {
    it("persists the flag in SecureStorage (raw) and localStorage", async () => {
      await securityVault.setMasterPasswordFlag();
      expect(secureStorageMock.setMasterPasswordConfiguredFlag).toHaveBeenCalled();
      expect(localStorage.getItem("forge_has_master_password")).toBe("true");
    });
  });

  describe("deriveBridgeKey", () => {
    it("returns a CryptoKey when the vault is unlocked", async () => {
      await securityVault.unlock("password123456");
      await resetMocks();

      const key = await securityVault.deriveBridgeKey();

      expect(key).not.toBeNull();
      expect(crypto.subtle.importKey).toHaveBeenCalledWith(
        "raw",
        expect.any(Uint8Array),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      );
    });

    it("returns null when the vault is locked", async () => {
      const key = await securityVault.deriveBridgeKey();
      expect(key).toBeNull();
    });

    it("returns null when crypto.subtle.importKey throws", async () => {
      await securityVault.unlock("password123456");
      (crypto.subtle.importKey as any).mockRejectedValue(
        new Error("Import failed"),
      );

      const key = await securityVault.deriveBridgeKey();
      expect(key).toBeNull();
    });
  });

  describe("withMasterPasswordBytes", () => {
    it("returns the password bytes when the vault is unlocked", async () => {
      await securityVault.unlock("test_password");
      await resetMocks();

      const result = securityVault.withMasterPasswordBytes(
        testCaller,
        (bytes) => (bytes ? new TextDecoder().decode(bytes) : null),
      );
      expect(result).toBe("test_password");
    });

    it("returns null when the vault is locked", () => {
      const result = securityVault.withMasterPasswordBytes(
        testCaller,
        (bytes) => bytes,
      );
      expect(result).toBeNull();
    });

    it("lanza error para caller no autorizado", () => {
      const unauthorized = {};
      expect(() =>
        securityVault.withMasterPasswordBytes(unauthorized, (bytes) => bytes),
      ).toThrow(
        "Unauthorized: caller not registered for master password access",
      );
    });
  });

  describe("session rotation", () => {
    it("rotates the token after the rotation interval", async () => {
      await securityVault.unlock("password123456");
      const tokenOriginal = securityVault.getSessionToken();

      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

      const tokenRotado = securityVault.getSessionToken();
      expect(tokenRotado).not.toBe(tokenOriginal);
    });

    it("stops rotation if the vault locks during rotation", async () => {
      await securityVault.unlock("password123456");
      vi.advanceTimersByTime(14 * 60 * 1000);
      securityVault.lock();
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect((securityVault as any).rotationTimer).toBeNull();
    });

    it("does not throw if generateSessionToken fails during rotation", async () => {
      await securityVault.unlock("password123456");
      await resetMocks();

      // Make getRandomValues throw to trigger generateSessionToken rejection
      (crypto.getRandomValues as any).mockImplementation(() => {
        throw new Error("Random values unavailable");
      });

      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

      // catch handler logs error instead of crashing
      expect(logger.error).toHaveBeenCalledWith(
        "[SecurityVault] Session rotation failed",
        expect.any(Object),
      );
    });

    // La rama else del intervalo (isLocked=true → stopSessionRotation) es un safety net
    // for real-time race conditions that fake timers cannot reproduce.
    // lock() always clears the timer synchronously before the callback can run.

    it("clears the previous timer when unlock is called multiple times", async () => {
      await securityVault.unlock("password123456");
      const timer1 = (securityVault as any).rotationTimer;
      securityVault.lock();
      await securityVault.unlock("password123456");
      const timer2 = (securityVault as any).rotationTimer;
      expect(timer2).not.toBeNull();
      expect(timer1).not.toBe(timer2);
    });
  });

  describe("unlockFromShare", () => {
    const SALT_HEX = "[1,2,3,4]";

    it("unlocks the vault with a valid share secret", async () => {
      await securityVault.unlock("password123456");
      await resetMocks();

      const result = await securityVault.unlockFromShare(
        "0000000000000000000000000000000000000000000000000000000000000000",
        SALT_HEX,
      );

      expect(result).toBe(true);
      expect(securityVault.isLocked()).toBe(false);
      // Session token is a fresh derivation (not the share secret) —
      // the share secret is only used for authentication, never as
      // a reusable credential.
      const token = securityVault.getSessionToken();
      expect(token).not.toBeNull();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "vault_unlock_from_share",
          result: "success",
          origin: "SecurityVault",
        }),
      );
    });

    it("allows bootstrap on a fresh device with an ephemeral credential derived from the payload", async () => {
      secureStorageMock.hasSecret.mockResolvedValue(false);
      secureStorageMock.getVerificationToken.mockResolvedValue(null);
      secureStorageMock.hasRecoveryDataRaw.mockResolvedValue(false);

      const result = await securityVault.unlockFromShare(
        "a".repeat(64),
        JSON.stringify(new Array(16).fill(7)),
        { allowFreshDevice: true, emptyLocalDatabase: true },
      );

      expect(result).toBe(true);
      expect(securityVault.isLocked()).toBe(false);
      expect(
        securityVault.withMasterPasswordBytes(testCaller, (bytes) => bytes),
      ).toBeNull();
      expect((securityVault as any).shareCredentialBytes).toBeInstanceOf(
        Uint8Array,
      );
      expect((securityVault as any).shareCredentialBytes).toHaveLength(32);

      securityVault.lock();
      expect(securityVault.isLocked()).toBe(true);
      expect((securityVault as any).shareCredentialBytes).toBeNull();
    });

    it("does not allow bootstrap unless the fresh-device flag is explicitly set", async () => {
      secureStorageMock.hasSecret.mockResolvedValue(false);
      secureStorageMock.getVerificationToken.mockResolvedValue(null);
      secureStorageMock.hasRecoveryDataRaw.mockResolvedValue(false);

      const result = await securityVault.unlockFromShare(
        "a".repeat(64),
        JSON.stringify(new Array(16).fill(7)),
      );

      expect(result).toBe(false);
      expect(securityVault.isLocked()).toBe(true);
    });

    it("rejects an invalid share secret (HKDF mismatch)", async () => {
      await securityVault.unlock("password123456");
      await resetMocks();

      const result = await securityVault.unlockFromShare(
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        SALT_HEX,
      );

      expect(result).toBe(false);
      expect(securityVault.isLocked()).toBe(false);
      expect(useRateLimitStore.getState().unlockAttempts).toBeGreaterThan(0);
    });

    it("rejects when the vault is locked (no master password)", async () => {
      const result = await securityVault.unlockFromShare(
        "0000000000000000000000000000000000000000000000000000000000000000",
        SALT_HEX,
      );

      expect(result).toBe(false);
      expect(securityVault.isLocked()).toBe(true);
    });

    it("rejects if rate-limited", async () => {
      await securityVault.unlock("password123456");
      useRateLimitStore.setState({
        lockoutUntil: Date.now() + 60000,
        unlockAttempts: 5,
      });

      const result = await securityVault.unlockFromShare(
        "0000000000000000000000000000000000000000000000000000000000000000",
        SALT_HEX,
      );

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        "[SecurityVault] unlockFromShare rate limited",
        expect.objectContaining({ remainingSeconds: expect.any(Number) }),
      );
    });

    it("rejects if HKDF derivation fails", async () => {
      await securityVault.unlock("password123456");
      await resetMocks();

      (crypto.subtle.deriveBits as any).mockRejectedValue(
        new Error("HKDF failed"),
      );

      const result = await securityVault.unlockFromShare(
        "0000000000000000000000000000000000000000000000000000000000000000",
        SALT_HEX,
      );

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "[SecurityVault] unlockFromShare HKDF derivation failed",
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("rejects if saltHex has malformed JSON", async () => {
      await securityVault.unlock("password123456");
      await resetMocks();

      const result = await securityVault.unlockFromShare(
        "0000000000000000000000000000000000000000000000000000000000000000",
        "not-valid-json",
      );

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "[SecurityVault] unlockFromShare HKDF derivation failed",
        expect.any(Object),
      );
      expect(useRateLimitStore.getState().unlockAttempts).toBeGreaterThan(0);
    });

    it("rejects if crypto.subtle.importKey fails (different from deriveBits)", async () => {
      await securityVault.unlock("password123456");
      await resetMocks();

      (crypto.subtle.importKey as any).mockRejectedValue(
        new Error("Import key failed"),
      );

      const result = await securityVault.unlockFromShare(
        "0000000000000000000000000000000000000000000000000000000000000000",
        SALT_HEX,
      );

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "[SecurityVault] unlockFromShare HKDF derivation failed",
        expect.any(Object),
      );
    });

    it("starts session rotation after a successful unlock", async () => {
      await securityVault.unlock("password123456");
      await resetMocks();

      expect((securityVault as any).rotationTimer).not.toBeNull();
      const timerAntes = (securityVault as any).rotationTimer;

      securityVault.lock();
      await securityVault.unlock("password123456");

      // Desbloquear por unlockFromShare
      await securityVault.unlockFromShare(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        SALT_HEX,
      );

      const timerDespues = (securityVault as any).rotationTimer;
      // rotationTimer must have been renewed
      expect(timerDespues).not.toBeNull();
    });
  });

  // ── Audit H5: master-password wrapping of the device key ────────────

  describe("H5 — device key wrapping", () => {
    it("unwraps the device key after verifying the password in a wrapped vault", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      secureStorageMock.getWrappedDeviceKeyBlob.mockResolvedValue(
        "v5:wrapped-blob",
      );
      secureStorageMock.getVerificationToken.mockResolvedValue(
        "encrypted_vault_verification",
      );
      secureStorageMock.getVerificationIntegrity.mockResolvedValue(
        TEST_INTEGRITY_RECORD,
      );
      const { encryptionService } =
        await import("../../services/EncryptionService");
      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );

      const result = await securityVault.unlock("correct_password");

      expect(result).toBe(true);
      expect(secureStorage.unwrapDeviceKeyWithPassword).toHaveBeenCalledWith(
        "correct_password",
      );
    });

    it("does not unwrap when the device key is not wrapped (legacy path intact)", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      secureStorageMock.getWrappedDeviceKeyBlob.mockResolvedValue(null);
      secureStorageMock.getVerificationToken.mockResolvedValue(
        "encrypted_vault_verification",
      );
      secureStorageMock.getVerificationIntegrity.mockResolvedValue(
        TEST_INTEGRITY_RECORD,
      );
      const { encryptionService } =
        await import("../../services/EncryptionService");
      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );

      await securityVault.unlock("correct_password");

      expect(secureStorage.unwrapDeviceKeyWithPassword).not.toHaveBeenCalled();
    });

    it("fail-closed: unlock fails if the device key unwrap fails", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      secureStorageMock.getWrappedDeviceKeyBlob.mockResolvedValue(
        "v5:wrapped-blob",
      );
      secureStorageMock.getVerificationToken.mockResolvedValue(
        "encrypted_vault_verification",
      );
      secureStorageMock.getVerificationIntegrity.mockResolvedValue(
        TEST_INTEGRITY_RECORD,
      );
      const { encryptionService } =
        await import("../../services/EncryptionService");
      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );
      secureStorageMock.unwrapDeviceKeyWithPassword.mockRejectedValue(
        new Error("unwrap failed"),
      );

      const result = await securityVault.unlock("correct_password");

      expect(result).toBe(false);
      expect(securityVault.isLocked()).toBe(true);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "vault_unlock_failed",
          result: "failure",
        }),
      );
      expect(useRateLimitStore.getState().unlockAttempts).toBeGreaterThan(0);
    });

    it("lock() descarta el device key en memoria", async () => {
      await securityVault.unlock("password123456");
      await resetMocks();

      await securityVault.lock();

      expect(secureStorageMock.lockDeviceKey).toHaveBeenCalled();
    });

    it("verifyPassword reads the token via the raw path (getVerificationToken)", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const { encryptionService } =
        await import("../../services/EncryptionService");
      secureStorageMock.getVerificationToken.mockResolvedValue(
        "encrypted_vault_verification",
      );
      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );

      const result = await securityVault.verifyPasswordRateLimited("correct_password");

      expect(result).toBe(true);
      expect(secureStorage.getVerificationToken).toHaveBeenCalled();
      // S1: verifyPassword now calls decryptWithBytes with a Uint8Array
      expect(encryptionService.decryptWithBytes).toHaveBeenCalledWith(
        "encrypted_vault_verification",
        expect.any(Uint8Array),
      );
    });

    it("setMasterPasswordFlag persists via the raw flag (no device key)", async () => {
      await securityVault.setMasterPasswordFlag();
      expect(secureStorageMock.setMasterPasswordConfiguredFlag).toHaveBeenCalled();
    });

    it("rotateMasterPassword re-wraps the device key with the new password", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const { encryptionService } =
        await import("../../services/EncryptionService");
      await securityVault.unlock("old_password123");
      secureStorageMock.isDeviceKeyWrapped.mockResolvedValue(true);
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "encrypted_api_key")
          return Promise.resolve("original_api_encrypted");
        if (key === "encrypted_db_key")
          return Promise.resolve("original_db_encrypted");
        return Promise.resolve("stored_secret");
      });
      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "plaintext",
      );
      (encryptionService.encryptWithBytes as any).mockResolvedValue(
        "re_encrypted",
      );
      // The oldPwBytes array is zeroed after the call (finally), so
      // we copy the bytes at invocation time.
      let oldPwCopy: string | null = null;
      (secureStorage.rewrapDeviceKeyWithPasswordBytes as any).mockImplementation(
        (oldPw: Uint8Array, _newPw: Uint8Array) => {
          oldPwCopy = new TextDecoder().decode(new Uint8Array(oldPw));
          return Promise.resolve(undefined);
        },
      );

      const result = await securityVault.rotateMasterPassword("new_password_123");

      expect(result).toBe(true);
      expect(secureStorage.rewrapDeviceKeyWithPasswordBytes).toHaveBeenCalledTimes(
        1,
      );
      expect(oldPwCopy).toBe("old_password123");
    });

    it("rotateMasterPassword does NOT re-wrap when the device key is not wrapped", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      await securityVault.unlock("old_password123");
      secureStorageMock.isDeviceKeyWrapped.mockResolvedValue(false);
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "encrypted_api_key")
          return Promise.resolve("original_api_encrypted");
        if (key === "encrypted_db_key")
          return Promise.resolve("original_db_encrypted");
        return Promise.resolve("stored_secret");
      });
      (encryptionService.decryptWithBytes as any).mockResolvedValue(
        "plaintext",
      );
      (encryptionService.encryptWithBytes as any).mockResolvedValue(
        "re_encrypted",
      );

      await securityVault.rotateMasterPassword("new_password_123");

      expect(secureStorage.rewrapDeviceKeyWithPasswordBytes).not.toHaveBeenCalled();
    });

    it("recovery data is read/written via the raw path (readable while the vault is locked)", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");

      await securityVault.setRecoveryData("phrase_encrypted_blob");
      expect(secureStorage.setRecoveryDataRaw).toHaveBeenCalledWith(
        "phrase_encrypted_blob",
      );

      secureStorageMock.getRecoveryDataRaw.mockResolvedValue(
        "phrase_encrypted_blob",
      );
      secureStorageMock.hasRecoveryDataRaw.mockResolvedValue(true);
      expect(await securityVault.getRecoveryData()).toBe(
        "phrase_encrypted_blob",
      );
      expect(await securityVault.hasRecoveryData()).toBe(true);

      await securityVault.clearRecoveryData();
      expect(secureStorage.clearRecoveryDataRaw).toHaveBeenCalled();
    });
  });

  describe("rate-limited verification and share decrypt (RL-1 / RL-2)", () => {
    it("verifyPasswordRateLimited rejects during lockout without calling decrypt", async () => {
      const { encryptionService } = await import("../../services/EncryptionService");
      secureStorageMock.getVerificationToken.mockResolvedValue(
        "encrypted_vault_verification",
      );
      const decryptSpy = encryptionService.decrypt as any;
      decryptSpy.mockClear();
      useRateLimitStore.setState({
        lockoutUntil: Date.now() + 60000,
        unlockAttempts: 5,
      });

      const result = await securityVault.verifyPasswordRateLimited(
        "correct_password",
      );
      expect(result).toBe(false);
      expect(decryptSpy).not.toHaveBeenCalled();
    });

    it("verifyPasswordRateLimited increments attempts on failure", async () => {
      const { encryptionService } = await import("../../services/EncryptionService");
      secureStorageMock.getVerificationToken.mockResolvedValue(
        "encrypted_vault_verification",
      );
      (encryptionService.decrypt as any).mockResolvedValue("wrong_value");
      useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });

      const result = await securityVault.verifyPasswordRateLimited(
        "wrong_password",
      );
      expect(result).toBe(false);
      expect(useRateLimitStore.getState().unlockAttempts).toBe(1);
    });

    it("verifyPasswordRateLimited accepts the correct password and resets attempts", async () => {
      const { encryptionService } = await import("../../services/EncryptionService");
      secureStorageMock.getVerificationToken.mockResolvedValue(
        "encrypted_vault_verification",
      );
      (encryptionService.decrypt as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );
      useRateLimitStore.setState({ unlockAttempts: 3, lockoutUntil: 0 });

      const result = await securityVault.verifyPasswordRateLimited(
        "correct_password",
      );
      expect(result).toBe(true);
      expect(useRateLimitStore.getState().unlockAttempts).toBe(0);
    });

    it("verifyPasswordRateLimited rejects a short password and counts an attempt without decrypting", async () => {
      const { encryptionService } = await import("../../services/EncryptionService");
      const decryptSpy = encryptionService.decrypt as any;
      decryptSpy.mockClear();
      useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });

      const result = await securityVault.verifyPasswordRateLimited(
        "1234567",
      );
      expect(result).toBe(false);
      expect(useRateLimitStore.getState().unlockAttempts).toBe(1);
      expect(decryptSpy).not.toHaveBeenCalled();
    });

    it("5 consecutive failures trigger lockout and block the correct password", async () => {
      const { encryptionService } = await import("../../services/EncryptionService");
      secureStorageMock.getVerificationToken.mockResolvedValue(
        "encrypted_vault_verification",
      );
      (encryptionService.decrypt as any).mockResolvedValue("wrong_value");
      useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });

      for (let i = 0; i < 5; i++) {
        await securityVault.verifyPasswordRateLimited("wrong_password");
      }
      expect(useRateLimitStore.getState().lockoutUntil).toBeGreaterThan(
        Date.now(),
      );

      (encryptionService.decrypt as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );
      const blocked = await securityVault.verifyPasswordRateLimited(
        "correct_password",
      );
      expect(blocked).toBe(false);
    });

    it("decryptShareWithRateLimit rejects during lockout without decrypting (RL-2)", async () => {
      const { encryptionService } = await import("../../services/EncryptionService");
      const decryptSpy = encryptionService.decrypt as any;
      decryptSpy.mockClear();
      useRateLimitStore.setState({
        lockoutUntil: Date.now() + 60000,
        unlockAttempts: 5,
      });

      const result = await securityVault.decryptShareWithRateLimit(
        "encrypted-key",
        "share-password",
      );
      expect(result).toBeNull();
      expect(decryptSpy).not.toHaveBeenCalled();
    });

    it("decryptShareWithRateLimit cuenta un decrypt fallido como intento (RL-2)", async () => {
      const { encryptionService } = await import("../../services/EncryptionService");
      (encryptionService.decrypt as any).mockRejectedValue(
        new Error("AES-GCM auth failed"),
      );
      useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });

      const result = await securityVault.decryptShareWithRateLimit(
        "encrypted-key",
        "wrong-share-password",
      );
      expect(result).toBeNull();
      expect(useRateLimitStore.getState().unlockAttempts).toBe(1);
    });

    it("decryptShareWithRateLimit returns the payload on success without counting attempts (RL-2)", async () => {
      const { encryptionService } = await import("../../services/EncryptionService");
      const payload = JSON.stringify({ shareSecret: "a".repeat(64) });
      (encryptionService.decrypt as any).mockResolvedValue(payload);
      useRateLimitStore.setState({ unlockAttempts: 2, lockoutUntil: 0 });

      const result = await securityVault.decryptShareWithRateLimit(
        "encrypted-key",
        "correct-share-password",
      );
      expect(result).toBe(payload);
      expect(useRateLimitStore.getState().unlockAttempts).toBe(2);
    });

    it("lockout expires: verifyPasswordRateLimited accepts the correct password again", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      secureStorageMock.getVerificationToken.mockResolvedValue(
        "encrypted_vault_verification",
      );
      (encryptionService.decrypt as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );
      useRateLimitStore.setState({
        unlockAttempts: 5,
        lockoutUntil: Date.now() + 60000,
      });

      // During lockout the correct password is rejected.
      const blocked = await securityVault.verifyPasswordRateLimited(
        "correct_password",
      );
      expect(blocked).toBe(false);

      // The lockout window (5 min) expires.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);

      const afterExpiry = await securityVault.verifyPasswordRateLimited(
        "correct_password",
      );
      expect(afterExpiry).toBe(true);
      expect(useRateLimitStore.getState().unlockAttempts).toBe(0);
    });

    it("the lockout re-arms after expiring with 5 new failures", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      secureStorageMock.getVerificationToken.mockResolvedValue(
        "encrypted_vault_verification",
      );
      (encryptionService.decrypt as any).mockResolvedValue("wrong_value");
      useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });

      // First lockout: 5 consecutive failures.
      for (let i = 0; i < 5; i++) {
        await securityVault.verifyPasswordRateLimited("wrong_password");
      }
      const firstLockout = useRateLimitStore.getState().lockoutUntil;
      expect(firstLockout).toBeGreaterThan(Date.now());

      // Expira.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
      expect(Date.now()).toBeGreaterThan(firstLockout);

      // 5 new failures → the lockout re-arms to a later instant.
      for (let i = 0; i < 5; i++) {
        await securityVault.verifyPasswordRateLimited("wrong_password");
      }
      const rearmed = useRateLimitStore.getState().lockoutUntil;
      expect(rearmed).toBeGreaterThan(firstLockout);
      expect(rearmed).toBeGreaterThan(Date.now());

      // Locked again even though the password is correct.
      (encryptionService.decrypt as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );
      const blocked = await securityVault.verifyPasswordRateLimited(
        "correct_password",
      );
      expect(blocked).toBe(false);
    });

    it("unlock() respects lockout expiry and the re-arm", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getVerificationToken as any).mockResolvedValue(
        "encrypted_vault_verification",
      );

      // 5 failures via unlock → lockout active.
      (encryptionService.decrypt as any).mockResolvedValue("wrong_value");
      for (let i = 0; i < 5; i++) {
        await securityVault.unlock("wrong_password");
      }
      const lockout1 = useRateLimitStore.getState().lockoutUntil;
      expect(lockout1).toBeGreaterThan(Date.now());

      // The correct password stays blocked during the window.
      (encryptionService.decrypt as any).mockResolvedValue(
        "bookmarkforge-verify-ok",
      );
      expect(await securityVault.unlock("correct_password")).toBe(false);

      // Expires → the correct password unlocks again.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
      const unlocked = await securityVault.unlock("correct_password");
      expect(unlocked).toBe(true);
      expect(securityVault.isLocked()).toBe(false);
      securityVault.lock();

      // Re-arm: 5 more failures re-activate lockout at a later instant.
      (encryptionService.decrypt as any).mockResolvedValue("wrong_value");
      for (let i = 0; i < 5; i++) {
        await securityVault.unlock("wrong_password");
      }
      const lockout2 = useRateLimitStore.getState().lockoutUntil;
      expect(lockout2).toBeGreaterThan(lockout1);
    });

    it("5 incorrect share passwords trigger lockout that blocks the correct one (RL-2 scaled)", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const decryptSpy = encryptionService.decrypt as any;
      const payload = JSON.stringify({ shareSecret: "a".repeat(64) });
      (encryptionService.decrypt as any).mockRejectedValue(
        new Error("AES-GCM auth failed"),
      );
      useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });

      for (let i = 0; i < 5; i++) {
        const result = await securityVault.decryptShareWithRateLimit(
          "encrypted-key",
          "wrong-share-password",
        );
        expect(result).toBeNull();
      }
      expect(useRateLimitStore.getState().lockoutUntil).toBeGreaterThan(
        Date.now(),
      );

      // With the correct password, the lockout blocks it BEFORE decrypting.
      decryptSpy.mockClear();
      (encryptionService.decrypt as any).mockResolvedValue(payload);
      const blocked = await securityVault.decryptShareWithRateLimit(
        "encrypted-key",
        "correct-share-password",
      );
      expect(blocked).toBeNull();
      expect(decryptSpy).not.toHaveBeenCalled();
    });

    it("the share lockout expires and the correct password decrypts again (RL-2)", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const payload = JSON.stringify({ shareSecret: "a".repeat(64) });
      useRateLimitStore.setState({
        unlockAttempts: 0,
        lockoutUntil: Date.now() + 60000,
      });

      const blocked = await securityVault.decryptShareWithRateLimit(
        "encrypted-key",
        "correct-share-password",
      );
      expect(blocked).toBeNull();

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);

      (encryptionService.decrypt as any).mockResolvedValue(payload);
      const ok = await securityVault.decryptShareWithRateLimit(
        "encrypted-key",
        "correct-share-password",
      );
      expect(ok).toBe(payload);
    });
  });

  // ── P1 mock-contract sweep — H2 audit-chain verification after unlock ──
  describe("P1 — audit integrity hook after unlock (H2)", () => {
    it("runs auditLog.verifyIntegrity after a successful unlock", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const { encryptionService } = await import("../../services/EncryptionService");
      (secureStorage.getVerificationToken as any).mockResolvedValueOnce(
        "encrypted_vault_verification",
      );
      vi.spyOn(encryptionService, "decrypt").mockResolvedValueOnce(
        "bookmarkforge-verify-ok",
      );

      const result = await securityVault.unlock("correct_password");

      expect(result).toBe(true);
      expect(auditLog.verifyIntegrity).toHaveBeenCalled();
    });

    it("records audit_integrity_failed when the chain reports tampering", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const { encryptionService } = await import("../../services/EncryptionService");
      (secureStorage.getVerificationToken as any).mockResolvedValueOnce(
        "encrypted_vault_verification",
      );
      vi.spyOn(encryptionService, "decrypt").mockResolvedValueOnce(
        "bookmarkforge-verify-ok",
      );
      (auditLog.verifyIntegrity as any).mockResolvedValueOnce({
        valid: false,
        brokenAt: 7,
        checked: 10,
      });

      await securityVault.unlock("correct_password");

      await vi.waitFor(() => {
        expect(auditLog.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "audit_integrity_failed",
            result: "failure",
            origin: "SecurityVault",
          }),
        );
      });
      expect(logger.error).toHaveBeenCalledWith(
        "[SecurityVault] Audit log integrity check FAILED — possible tampering",
        { brokenAt: 7 },
      );
    });
  });
});

describe("SecurityVault — pending-key purge bounded logging (B1)", () => {
  it("logs a rate-limited warning and leaves the purge pending when the purge fails", async () => {
    const { secureStorage } = await import("../../services/SecureStorage");
    const { logger } = await import("../../utils/logger");
    const { resetRateLimitedLogging } = await import("../../utils/boundedLog");
    resetRateLimitedLogging();
    (secureStorage.purgeExpiredPendingKeys as any).mockRejectedValue(
      new Error("IDB blocked by another tab"),
    );
    (logger.warn as any).mockClear();
    (securityVault as any).constructor._purgePendingCalled = false;

    await securityVault.unlock("password123456");

    // unlock() fires the purge without awaiting it; wait for the microtask.
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("[security-vault-pending-key-purge]"),
        expect.objectContaining({ error: "IDB blocked by another tab" }),
      );
    });
    // The flag is only set on SUCCESS, so the next lifecycle call retries.
    expect((securityVault as any).constructor._purgePendingCalled).toBe(false);
  });

  it("marks the purge as done on success without a bounded warning", async () => {
    const { secureStorage } = await import("../../services/SecureStorage");
    const { logger } = await import("../../utils/logger");
    const { resetRateLimitedLogging } = await import("../../utils/boundedLog");
    resetRateLimitedLogging();
    (secureStorage.purgeExpiredPendingKeys as any).mockResolvedValue(undefined);
    (logger.warn as any).mockClear();
    (securityVault as any).constructor._purgePendingCalled = false;

    await securityVault.unlock("password123456");

    await vi.waitFor(() => {
      expect((securityVault as any).constructor._purgePendingCalled).toBe(true);
    });
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("[security-vault-pending-key-purge]"),
      expect.anything(),
    );
  });
});
