/**
 * src/services/security-vault/integrity.ts
 *
 * S1 HMAC integrity primitives for the master-password vault's verification
 * token. Extracted from SecurityVault.ts (refactor, no behavior change).
 */

import { encryptionService } from "../EncryptionService";
import { secureStorage } from "../SecureStorage";
import { logger } from "../../utils/logger";
import { VERIFICATION_PLAINTEXT } from "./constants";
import { zeroPasswordBytes } from "../../utils/crypto-core";

/**
 * Derives an HMAC key from a password and integrity nonce via HKDF-SHA256.
 * Used exclusively for verification-token integrity validation (S1 fix).
 */
export async function deriveIntegrityHmacKey(
  passwordBytes: Uint8Array,
  nonce: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBytes as Uint8Array<ArrayBuffer>,
    { name: "HKDF" },
    false,
    ["deriveBits", "deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: nonce as Uint8Array<ArrayBuffer>,
      info: new TextEncoder().encode("bmf-vault-verify-integrity"),
      hash: "SHA-256",
    },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

/**
 * Validates the HMAC integrity tag over the stored verification token.
 * Returns true when the ciphertext was produced by a genuine
 * createVerificationToken() call with the correct password.
 */
export async function validateVerificationIntegrity(
  ciphertext: string,
  passwordBytes: Uint8Array,
): Promise<boolean> {
  const integrityRaw = await secureStorage.getVerificationIntegrity();
  if (!integrityRaw) {
    logger.error(
      "[SecurityVault] Verification integrity record missing — possible tampering",
    );
    return false;
  }
  const colonIdx = integrityRaw.indexOf(":");
  if (colonIdx === -1 || colonIdx !== 64) {
    logger.error(
      "[SecurityVault] Verification integrity record malformed",
    );
    return false;
  }
  const nonceHex = integrityRaw.slice(0, colonIdx);
  const expectedHmacHex = integrityRaw.slice(colonIdx + 1);
  if (
    !/^[0-9a-f]{64}$/.test(nonceHex) ||
    !/^[0-9a-f]{64}$/.test(expectedHmacHex)
  ) {
    logger.error(
      "[SecurityVault] Verification integrity record has invalid hex",
    );
    return false;
  }
  try {
    const nonce = new Uint8Array(
      nonceHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
    );
    const hmacKey = await deriveIntegrityHmacKey(
      passwordBytes,
      nonce,
    );
    const expectedHmac = new Uint8Array(
      expectedHmacHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
    );
    return crypto.subtle.verify(
      "HMAC",
      hmacKey,
      expectedHmac,
      new TextEncoder().encode(ciphertext),
    );
  } catch (err) {
    logger.error("[SecurityVault] Integrity HMAC validation failed", {
      error: err,
    });
    return false;
  }
}

/**
 * Creates a verification token encrypted with the master password and stores
 * it together with its S1 HMAC integrity record.
 *
 * The token is used in unlock() to validate that the password is correct
 * before marking the vault as unlocked. It is stored RAW (password-encrypted
 * only, no device-key layer) so it stays readable while the vault is locked —
 * the password must be verified BEFORE the wrapped device key is materialized;
 * the device-key layer would deadlock unlock().
 */
export async function createVerificationToken(password: string): Promise<void> {
  const passwordBytes = new TextEncoder().encode(password);
  try {
    // encryptWithBytes zeroizes the transferred buffer (ownership
    // contract in crypto-core.ts). Pass a fresh copy so passwordBytes
    // survives for the HMAC integrity derivation below.
    // A-1: when a per-vault KDF salt is installed (the security vault installs
    // it before calling this, on both setup and rotation) the token is written
    // as a self-describing v6 payload; otherwise it stays v5.
    const ciphertext = await encryptionService.encryptWithBytes(
      VERIFICATION_PLAINTEXT,
      new Uint8Array(passwordBytes),
    );

    // S1: generate a fresh integrity nonce and HMAC over the ciphertext.
    // The record is stored raw (non-secret: public nonce + password-derived
    // HMAC signature) so it stays readable while the vault is locked —
    // verifyPassword() validates it BEFORE the wrapped device key is
    // materialized; the device-key layer would deadlock reload-unlock.
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const hmacKey = await deriveIntegrityHmacKey(
      passwordBytes,
      nonce,
    );
const hmacSig = await crypto.subtle.sign(
      "HMAC",
      hmacKey,
      new TextEncoder().encode(ciphertext),
    );
    // Zeroize passwordBytes immediately after HMAC derivation — no further
    // use. This shrinks the exposure window: the bytes no longer survive
    // during the IDB write below.
    zeroPasswordBytes(passwordBytes);
    const nonceHex = Array.from(nonce, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const hmacHex = Array.from(new Uint8Array(hmacSig), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    // Token + HMAC go in ONE transaction: verifyPassword() rejects an unlock
    // whose stored token does not match the record, so a crash between two
    // separate writes would leave a vault no password can open.
await secureStorage.storeVerificationTokenWithIntegrity(
      ciphertext,
      `${nonceHex}:${hmacHex}`,
    );
  } finally {
    // Defense-in-depth: zeroize even if the early fill(0) already ran.
    zeroPasswordBytes(passwordBytes);
  }
 }
