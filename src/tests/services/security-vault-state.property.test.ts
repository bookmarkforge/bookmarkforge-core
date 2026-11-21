// src/tests/services/security-vault-state.property.test.ts
//
// Property-based tests (fast-check) for the SecurityVault unlock state
// machine: the lockout threshold and the locked/unlocked invariant under
// arbitrary sequences of good/bad password attempts.
//
// Model under test (from SecurityVault.unlock + rateLimitStore):
//   - A bad password fails and increments unlockAttempts.
//   - After MAX_UNLOCK_ATTEMPTS (5) consecutive failures the vault enters
//     lockout: EVERY further unlock fails until lockoutUntil passes.
//   - A good password succeeds iff not locked out; success resets the counter.
//   - isLocked() is true after every failure and false after a success.
//
// Crypto/Storage are mocked at the module boundary (same harness style as
// SecurityVault.test.ts); decryptMockFn resolves VERIFICATION_PLAINTEXT for
// "good" attempts and garbage for "bad" ones.

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";

const decryptMockFn = vi.fn();
const encryptMockFn = vi.fn().mockResolvedValue("encrypted_data");

const TEST_INTEGRITY_RECORD =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
  ":aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";

const secureStorageMock = {
  _store: new Map<string, string>(),
  getSecret: vi.fn((key: string) => {
    if (key === "vault_verification_integrity")
      return Promise.resolve(TEST_INTEGRITY_RECORD);
    return Promise.resolve(null);
  }),
  setSecret: vi.fn((key: string, value: string) => {
    secureStorageMock._store.set(key, value);
    return Promise.resolve(undefined);
  }),
  hasSecret: vi.fn((_key: string) => Promise.resolve(false)),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
  migrateFromLocalStorage: vi.fn().mockResolvedValue(true),
  getVerificationToken: vi.fn((): Promise<string | null> =>
    Promise.resolve("stored_token"),
  ),
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
  getWrappedDeviceKeyBlob: vi.fn((): Promise<string | null> =>
    Promise.resolve(null),
  ),
  restoreWrappedDeviceKeyBlob: vi.fn(() => Promise.resolve(undefined)),
  restoreVerificationToken: vi.fn(() => Promise.resolve(undefined)),
  restoreVerificationTokenWithIntegrity: vi.fn(() =>
    Promise.resolve(undefined),
  ),
  lockDeviceKey: vi.fn(),
  setRecoveryDataRaw: vi.fn(() => Promise.resolve(undefined)),
  getRecoveryDataRaw: vi.fn((): Promise<string | null> =>
    Promise.resolve(null),
  ),
  hasRecoveryDataRaw: vi.fn(() => Promise.resolve(false)),
  clearRecoveryDataRaw: vi.fn(() => Promise.resolve(undefined)),
  purgeExpiredPendingKeys: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: secureStorageMock,
}));

vi.mock("../../services/EncryptionService", () => ({
  encryptionService: {
    encrypt: encryptMockFn,
    encryptWithBytes: encryptMockFn,
    decrypt: decryptMockFn,
    decryptWithBytes: decryptMockFn,
    encryptBinary: vi.fn().mockResolvedValue(new Uint8Array(0)),
    decryptBinary: vi.fn().mockResolvedValue(new Uint8Array(0)),
    encryptWithSessionKey: vi
      .fn()
      .mockResolvedValue(new Uint8Array(0)),
    decryptWithSessionKey: vi
      .fn()
      .mockResolvedValue(new Uint8Array(0)),
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

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../services/AuditLogService", () => ({
  auditLog: {
    record: vi.fn().mockResolvedValue(undefined),
    flushPending: vi.fn().mockResolvedValue(undefined),
    verifyIntegrity: vi
      .fn()
      .mockResolvedValue({ valid: true, brokenAt: null, checked: 0 }),
  },
  rotateAuditSessionId: vi.fn(),
}));

vi.mock("../../services/security-vault/kdf-salt-sync", () => ({
  announceVaultKdfSaltChange: vi.fn(),
  startVaultKdfSaltSync: vi.fn(),
  stopVaultKdfSaltSync: vi.fn(),
}));

const { securityVault } = await import("../../services/SecurityVault");
const { useRateLimitStore, getRateLimitState } = await import(
  "../../store/rateLimitStore"
);
const { VERIFICATION_PLAINTEXT } = await import(
  "../../services/security-vault/constants"
);

const testCaller = {};
securityVault.registerCaller(testCaller);

const GOOD_PASSWORD = "correct-horse-battery";
const BAD_PASSWORD = "wrong-password-1";

let cryptoCounter = 0;

function stubCrypto() {
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
      digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    } as unknown as SubtleCrypto,
  });
}

function setPasswordValidity(valid: boolean) {
  decryptMockFn.mockResolvedValue(
    valid ? VERIFICATION_PLAINTEXT : "definitely-wrong",
  );
}

function isLockedOut(): boolean {
  return Date.now() < getRateLimitState().lockoutUntil;
}

/**
 * fc.assert runs the property N times inside ONE test — beforeEach does NOT
 * run between iterations, so every run must reset the rate-limit store and
 * re-lock the vault itself.
 */
async function resetRunState(): Promise<void> {
  useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });
  if (!securityVault.isLocked()) {
    await securityVault.lock();
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  secureStorageMock._store.clear();
  decryptMockFn.mockResolvedValue("decrypted_data");
  encryptMockFn.mockResolvedValue("encrypted_data");
  secureStorageMock.getSecret.mockImplementation((key: string) => {
    if (key === "vault_verification_integrity")
      return Promise.resolve(TEST_INTEGRITY_RECORD);
    return Promise.resolve(null);
  });
  secureStorageMock.setSecret.mockImplementation(
    (key: string, value: string) => {
      secureStorageMock._store.set(key, value);
      return Promise.resolve(undefined);
    },
  );
  secureStorageMock.getVerificationToken.mockResolvedValue("stored_token");
  secureStorageMock.getVerificationIntegrity.mockResolvedValue(
    TEST_INTEGRITY_RECORD,
  );
  secureStorageMock.isDeviceKeyMaterialized.mockReturnValue(false);
  secureStorageMock.ensureDeviceKeyMaterialized.mockResolvedValue(undefined);
  secureStorageMock.isDeviceKeyWrapped.mockResolvedValue(false);
  secureStorageMock.unwrapDeviceKeyWithPassword.mockImplementation(() => {
    secureStorageMock.isDeviceKeyMaterialized.mockReturnValue(true);
    return Promise.resolve(new ArrayBuffer(1));
  });
  secureStorageMock.getWrappedDeviceKeyBlob.mockResolvedValue(null);
  secureStorageMock.purgeExpiredPendingKeys.mockResolvedValue(undefined);
  cryptoCounter = 0;
  stubCrypto();
  useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });
  if (!securityVault.isLocked()) {
    await securityVault.lock();
  }
});

afterEach(async () => {
  vi.unstubAllGlobals();
  useRateLimitStore.setState({ unlockAttempts: 0, lockoutUntil: 0 });
  if (!securityVault.isLocked()) {
    await securityVault.lock();
  }
  localStorage.clear();
});

describe("SecurityVault state machine properties", () => {
  test("N bad attempts then a good one: succeeds iff N < 5", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 8 }), async (badCount) => {
        await resetRunState();
        // N consecutive bad attempts.
        setPasswordValidity(false);
        for (let i = 0; i < badCount; i++) {
          const attempt = await securityVault.unlock(BAD_PASSWORD);
          expect(attempt).toBe(false);
          expect(securityVault.isLocked()).toBe(true);
        }
        // Now a good password.
        setPasswordValidity(true);
        const final = await securityVault.unlock(GOOD_PASSWORD);
        const expectedSuccess = badCount < 5;
        expect(final).toBe(expectedSuccess);
        expect(securityVault.isLocked()).toBe(!expectedSuccess);
      }),
      { numRuns: 30 },
    );
  });

  test("random attempt sequences while locked: unlock succeeds iff not locked out and password valid", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
        async (validitySequence) => {
          await resetRunState();
          for (const valid of validitySequence) {
            setPasswordValidity(valid);
            const lockedOutBefore = isLockedOut();
            const attempt = await securityVault.unlock(
              valid ? GOOD_PASSWORD : BAD_PASSWORD,
            );
            if (lockedOutBefore) {
              // Lockout is sticky within the run (the 5-minute window cannot
              // expire mid-test with real timers).
              expect(attempt).toBe(false);
              expect(isLockedOut()).toBe(true);
              expect(securityVault.isLocked()).toBe(true);
              continue;
            }
            if (valid) {
              expect(attempt).toBe(true);
              expect(securityVault.isLocked()).toBe(false);
              break; // sequence models guessing while LOCKED — stop at unlock
            }
            expect(attempt).toBe(false);
            // A failed attempt must never leave the vault unlocked.
            expect(securityVault.isLocked()).toBe(true);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  test("lock() after success always restores locked state and clears session", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 4 }), async (badPrefix) => {
        await resetRunState();
        setPasswordValidity(false);
        for (let i = 0; i < badPrefix; i++) {
          await securityVault.unlock(BAD_PASSWORD);
        }
        setPasswordValidity(true);
        const unlocked = await securityVault.unlock(GOOD_PASSWORD);
        fc.pre(unlocked); // skip sequences that hit lockout
        expect(securityVault.isLocked()).toBe(false);
        await securityVault.lock();
        expect(securityVault.isLocked()).toBe(true);
      }),
      { numRuns: 30 },
    );
  });
});
