import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  deriveShareCredential,
  parseShareSalt,
} from "../../../services/security-vault/share";

/**
 * Direct unit tests for src/services/security-vault/share.ts (share-payload
 * helpers). The Argon2id KDF is mocked (memory-hard, not unit-testable in
 * reasonable time); the HKDF-SHA256 step runs on the real WebCrypto.
 */

const mocks = vi.hoisted(() => {
  // Snapshot of the password bytes as seen by the KDF; the module zeroizes
  // its own buffer right after, so content must be captured inside the mock.
  const capturedPasswordBytes: { passwordBytes: Uint8Array | null } = { passwordBytes: null };
  const deriveArgon2idKey = vi.fn(
    (passwordBytes: Uint8Array, salt: Uint8Array): Uint8Array => {
      capturedPasswordBytes.passwordBytes = passwordBytes.slice();
      // Deterministic stand-in derived from both inputs so different
      // secrets/salts yield different credentials (same shape as the real
      // Argon2id output: 32 bytes).
      const out = new Uint8Array(32);
      for (let i = 0; i < out.length; i += 1) {
        const pwByte = passwordBytes[i % Math.max(passwordBytes.length, 1)] ?? 0;
        const saltByte = salt[i % Math.max(salt.length, 1)] ?? 0;
        out[i] = (pwByte + saltByte + i) & 0xff;
      }
      return out;
    },
  );
  return { deriveArgon2idKey, capturedPasswordBytes };
});

vi.mock("../../../utils/argon2-kdf", () => ({
  deriveArgon2idKey: mocks.deriveArgon2idKey,
}));

const SALT_JSON = JSON.stringify(Array.from(new Uint8Array([1, 2, 3, 4, 5])));

describe("parseShareSalt", () => {
  it("parses a valid JSON byte array", () => {
    const salt = parseShareSalt(SALT_JSON);
    expect(salt).not.toBeNull();
    expect(Array.from(salt!)).toEqual([1, 2, 3, 4, 5]);
  });

  it("accepts an empty salt when minimumLength allows it", () => {
    expect(parseShareSalt("[]", 0)).toEqual(new Uint8Array(0));
  });

  it("rejects an empty salt with the default minimumLength", () => {
    expect(parseShareSalt("[]")).toBeNull();
  });

  it("rejects arrays longer than 64 bytes", () => {
    const long = JSON.stringify(Array.from(new Uint8Array(65).fill(1)));
    expect(parseShareSalt(long)).toBeNull();
  });

  it("accepts a 64-byte salt", () => {
    const long = JSON.stringify(Array.from(new Uint8Array(64).fill(7)));
    expect(Array.from(parseShareSalt(long)!)).toHaveLength(64);
  });

  it("rejects salts shorter than an explicit minimumLength", () => {
    expect(parseShareSalt(SALT_JSON, 6)).toBeNull();
  });

  it("rejects non-integer, negative, and out-of-range byte values", () => {
    expect(parseShareSalt("[1.5, 2]")).toBeNull();
    expect(parseShareSalt("[-1, 2]")).toBeNull();
    expect(parseShareSalt("[256, 2]")).toBeNull();
    expect(parseShareSalt("[0, 255]")).not.toBeNull();
  });

  it("rejects non-array JSON and invalid JSON fail-closed", () => {
    expect(parseShareSalt('{"0":1}')).toBeNull();
    expect(parseShareSalt("null")).toBeNull();
    expect(parseShareSalt("[1, \"a\"]")).toBeNull();
    expect(parseShareSalt("not-json")).toBeNull();
    expect(parseShareSalt("")).toBeNull();
  });
});

describe("deriveShareCredential", () => {
  const salt = new Uint8Array([9, 8, 7, 6, 5]);

  beforeEach(() => {
    mocks.deriveArgon2idKey.mockClear();
  });

  it("returns a deterministic 32-byte credential for identical inputs", async () => {
    const first = await deriveShareCredential("share-secret", salt);
    const second = await deriveShareCredential("share-secret", salt);
    expect(first).toHaveLength(32);
    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it("derives a different credential for a different share secret", async () => {
    const first = await deriveShareCredential("secret-a", salt);
    const second = await deriveShareCredential("secret-b", salt);
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  it("derives a different credential for a different salt", async () => {
    const otherSalt = new Uint8Array([1, 2, 3, 4, 5]);
    const first = await deriveShareCredential("secret", salt);
    const second = await deriveShareCredential("secret", otherSalt);
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  it("passes the UTF-8 share secret and the salt to the KDF", async () => {
    await deriveShareCredential("share-secret", salt);
    expect(mocks.deriveArgon2idKey).toHaveBeenCalledTimes(1);
    expect(mocks.deriveArgon2idKey).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      salt,
    );
    expect(Array.from(mocks.capturedPasswordBytes.passwordBytes ?? [])).toEqual(
      Array.from(new TextEncoder().encode("share-secret")),
    );
  });

  it("zeroizes the Argon2id key material after deriving", async () => {
    const leaked = new Uint8Array(32).fill(0xab);
    mocks.deriveArgon2idKey.mockReturnValueOnce(leaked);
    await deriveShareCredential("secret", salt);
    expect(Array.from(leaked).every((byte) => byte === 0)).toBe(true);
  });
});
