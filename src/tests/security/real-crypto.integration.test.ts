import { describe, it, expect, vi, beforeEach } from "vitest";

// TST-01 — REAL cryptographic tests (NO mocked crypto).
// These exercise the actual encryption primitives that protect user data,
// instead of stubbing crypto.subtle.

import {
  encrypt,
  decrypt,
  setVaultKdfSalt,
  deriveArgon2Key,
  zeroPasswordBytes,
} from "../../utils/crypto-core";
import { deriveArgon2idKey } from "../../utils/argon2-kdf";

describe("TST-01 — REAL crypto-core (Argon2id + AES-GCM)", () => {
  beforeEach(() => {
    // Produce v6: format (per-vault salt) so decryption doesn't hit
    // the v5 legacy cutoff enforced by VITE_ALLOW_V5_LEGACY_READ.
    setVaultKdfSalt(crypto.getRandomValues(new Uint8Array(16)));
  });

  it("round-trips plaintext through encrypt/decrypt with real Argon2id", async () => {
    const secret = "my-super-secret-password-12345678";
    const plaintext = "Bookmarks are the soul of the web 🔖";
    const ct = await encrypt(plaintext, secret);
    expect(ct.startsWith("v6:")).toBe(true);
    const back = await decrypt(ct, secret);
    expect(back).toBe(plaintext);
  });

  it("fails to decrypt when the ciphertext is tampered (GCM auth)", async () => {
    const secret = "another-secret-password-abcdefg";
    const ct = await encrypt("payload", secret);
    const b64 = ct.substring(3);
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    raw[raw.length - 1]! ^= 0x01;
    const tampered = "v6:" + btoa(String.fromCharCode(...raw));
    await expect(decrypt(tampered, secret)).rejects.toBeDefined();
  });

  it("fails to decrypt with the wrong password", async () => {
    const ct = await encrypt("data", "correct-horse-battery-staple");
    await expect(decrypt(ct, "wrong-password")).rejects.toBeDefined();
  });

  it("derives a deterministic key for the same password+salt", async () => {
    const pw = new TextEncoder().encode("deterministic-password");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const k1 = await deriveArgon2idKey(pw, salt);
    const k2 = await deriveArgon2idKey(pw, salt);
    expect(Array.from(k1)).toEqual(Array.from(k2));
    const pk = await deriveArgon2Key(pw, salt);
    expect(pk).toBeInstanceOf(CryptoKey);
    zeroPasswordBytes(pw);
    expect(Array.from(pw)).toEqual(new Array(pw.length).fill(0));
  });
});
