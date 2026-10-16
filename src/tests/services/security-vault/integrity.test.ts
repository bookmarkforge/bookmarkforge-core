import { describe, it, expect, beforeEach, vi } from "vitest";
import { VERIFICATION_PLAINTEXT } from "../../../services/security-vault/constants";
import {
  deriveIntegrityHmacKey,
  validateVerificationIntegrity,
  createVerificationToken,
} from "../../../services/security-vault/integrity";
import { logger } from "../../../utils/logger";

/**
 * Direct unit tests for src/services/security-vault/integrity.ts (S1 HMAC
 * verification-token integrity). SecureStorage / EncryptionService are
 * mocked; the HKDF + HMAC crypto runs against the real WebCrypto
 * implementation.
 */

const mocks = vi.hoisted(() => ({
  secureStorage: {
    getVerificationIntegrity: vi.fn(),
    storeVerificationToken: vi.fn(),
    storeVerificationIntegrity: vi.fn(),
    storeVerificationTokenWithIntegrity: vi.fn(),
  },
  encryptionService: {
    encryptWithBytes: vi.fn(),
  },
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../services/SecureStorage", () => ({
  secureStorage: mocks.secureStorage,
}));
vi.mock("../../../services/EncryptionService", () => ({
  encryptionService: mocks.encryptionService,
}));
vi.mock("../../../utils/logger", () => ({
  logger: mocks.logger,
}));

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const encode = (value: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;

/** Build a genuine integrity record (`<64-hex-nonce>:<64-hex-hmac>`). */
async function makeIntegrityRecord(
  password: string,
  ciphertext: string,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const hmacKey = await deriveIntegrityHmacKey(encode(password), nonce);
  const signature = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encode(ciphertext),
  );
  return `${bytesToHex(nonce)}:${bytesToHex(new Uint8Array(signature))}`;
}

describe("security-vault integrity helpers", () => {
  beforeEach(() => {
    mocks.secureStorage.getVerificationIntegrity.mockReset();
    mocks.secureStorage.storeVerificationToken.mockReset();
    mocks.secureStorage.storeVerificationIntegrity.mockReset();
    mocks.secureStorage.storeVerificationTokenWithIntegrity.mockReset();
    mocks.encryptionService.encryptWithBytes.mockReset();
    mocks.logger.error.mockClear();
  });

  describe("deriveIntegrityHmacKey", () => {
    it("derives deterministically from the same password + nonce", async () => {
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const keyA = await deriveIntegrityHmacKey(encode("hunter2"), nonce);
      const keyB = await deriveIntegrityHmacKey(encode("hunter2"), nonce);
      const payload = encode("verify-me");
      const sigA = await crypto.subtle.sign("HMAC", keyA, payload);
      const verifiedWithB = await crypto.subtle.verify("HMAC", keyB, sigA, payload);
      expect(verifiedWithB).toBe(true);
    });

    it("produces a different key for a different password", async () => {
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const keyA = await deriveIntegrityHmacKey(encode("hunter2"), nonce);
      const keyB = await deriveIntegrityHmacKey(encode("hunter3"), nonce);
      const payload = encode("verify-me");
      const sigA = await crypto.subtle.sign("HMAC", keyA, payload);
      const verifiedWithB = await crypto.subtle.verify("HMAC", keyB, sigA, payload);
      expect(verifiedWithB).toBe(false);
    });
  });

  describe("validateVerificationIntegrity", () => {
    it("returns false and logs when the integrity record is missing", async () => {
      mocks.secureStorage.getVerificationIntegrity.mockResolvedValue(null);
      await expect(
        validateVerificationIntegrity("ciphertext", encode("pw")),
      ).resolves.toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("missing"),
      );
    });

    it("rejects a record without a colon separator", async () => {
      mocks.secureStorage.getVerificationIntegrity.mockResolvedValue("not-a-record");
      await expect(
        validateVerificationIntegrity("ciphertext", encode("pw")),
      ).resolves.toBe(false);
    });

    it("rejects a record whose nonce is not 32 bytes (colon at the wrong index)", async () => {
      mocks.secureStorage.getVerificationIntegrity.mockResolvedValue(
        "abcd:efgh",
      );
      await expect(
        validateVerificationIntegrity("ciphertext", encode("pw")),
      ).resolves.toBe(false);
    });

    it("rejects records with non-hex parts", async () => {
      const nonHex = "z".repeat(64);
      mocks.secureStorage.getVerificationIntegrity.mockResolvedValue(
        `${nonHex}:${"0".repeat(64)}`,
      );
      await expect(
        validateVerificationIntegrity("ciphertext", encode("pw")),
      ).resolves.toBe(false);
      mocks.secureStorage.getVerificationIntegrity.mockResolvedValue(
        `${"0".repeat(64)}:${nonHex}`,
      );
      await expect(
        validateVerificationIntegrity("ciphertext", encode("pw")),
      ).resolves.toBe(false);
    });

    it("accepts a genuine record with the right password", async () => {
      const ciphertext = "v1.generated-ciphertext";
      const record = await makeIntegrityRecord("correct-pw", ciphertext);
      mocks.secureStorage.getVerificationIntegrity.mockResolvedValue(record);
      await expect(
        validateVerificationIntegrity(ciphertext, encode("correct-pw")),
      ).resolves.toBe(true);
    });

    it("rejects a genuine record with the wrong password", async () => {
      const ciphertext = "v1.generated-ciphertext";
      const record = await makeIntegrityRecord("correct-pw", ciphertext);
      mocks.secureStorage.getVerificationIntegrity.mockResolvedValue(record);
      await expect(
        validateVerificationIntegrity(ciphertext, encode("wrong-pw")),
      ).resolves.toBe(false);
    });

    it("rejects when the ciphertext was tampered with", async () => {
      const record = await makeIntegrityRecord("correct-pw", "original");
      mocks.secureStorage.getVerificationIntegrity.mockResolvedValue(record);
      await expect(
        validateVerificationIntegrity("tampered-ciphertext", encode("correct-pw")),
      ).resolves.toBe(false);
    });
  });

  describe("createVerificationToken", () => {
    it("stores the encrypted token and a matching integrity record", async () => {
      const ciphertext = "v1.token-ciphertext";
      mocks.encryptionService.encryptWithBytes.mockResolvedValue(ciphertext);

      await createVerificationToken("master-pw");

      expect(mocks.encryptionService.encryptWithBytes).toHaveBeenCalledWith(
        VERIFICATION_PLAINTEXT,
        expect.any(Uint8Array),
      );
      // Token + HMAC record go through ONE storage call (single IndexedDB
      // transaction): verifyPassword() rejects a token whose record does not
      // match, so a crash between two separate writes would brick the vault.
      expect(mocks.secureStorage.storeVerificationToken).not.toHaveBeenCalled();
      expect(
        mocks.secureStorage.storeVerificationIntegrity,
      ).not.toHaveBeenCalled();
      expect(
        mocks.secureStorage.storeVerificationTokenWithIntegrity,
      ).toHaveBeenCalledTimes(1);
      const [storedToken, record] = mocks.secureStorage
        .storeVerificationTokenWithIntegrity.mock.calls[0]! as [string, string];
      expect(storedToken).toBe(ciphertext);
      expect(record).toMatch(/^[0-9a-f]{64}:[0-9a-f]{64}$/);

      // The stored integrity record must validate the stored ciphertext —
      // proving token and HMAC were built with the same password derivation.
      mocks.secureStorage.getVerificationIntegrity.mockResolvedValue(record);
      await expect(
        validateVerificationIntegrity(ciphertext, encode("master-pw")),
      ).resolves.toBe(true);
      await expect(
        validateVerificationIntegrity(ciphertext, encode("other-pw")),
      ).resolves.toBe(false);
    });
  });
});
