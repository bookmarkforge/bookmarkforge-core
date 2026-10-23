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
import { deriveArgon2idKey } from "../../utils/argon2-kdf";

/**
 * Derives the HMAC key for the verification-token integrity record (S1).
 *
 * C1 (2026-10-20 audit): this used to be HKDF-SHA256 straight over the
 * password, with the public integrity nonce as salt. Both halves of that
 * record are stored unencrypted so they stay readable while the vault is
 * locked — which turned them into an offline password verifier costing one
 * HKDF per candidate. An attacker with the vault files could therefore skip
 * Argon2id (128 MiB, t=3) entirely and brute-force the master password at
 * hash-table speed, defeating the KDF the whole design is built on.
 *
 * The key is now derived with Argon2id, using the stored nonce as its salt:
 * the record stays stateless and readable while locked (the nonce travels with
 * it), but every guess now costs the same memory-hard work as a real unlock.
 * The trade-off is one extra KDF per *verification attempt* (rate-limited to
 * 5 per 5 minutes), never per ciphertext operation.
 */
export async function deriveIntegrityHmacKey(
  passwordBytes: Uint8Array,
  nonce: Uint8Array,
): Promise<CryptoKey> {
  const derived = await deriveArgon2idKey(passwordBytes, nonce);
  try {
    return await crypto.subtle.importKey(
      "raw",
      derived as Uint8Array<ArrayBuffer>,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  } finally {
    // The raw HMAC key never outlives the import: the record only ever holds
    // an HMAC tag and the CryptoKey stays non-extractable.
    derived.fill(0);
  }
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
  // Tracks the early zeroization so the finally block zeroizes only when the
  // early path did not run (error before the HMAC step). Avoids a false
  // "possible reuse" warning on every successful token creation.
  let zeroizedEarly = false;
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
    // C1: the signature is Argon2id-keyed (see deriveIntegrityHmacKey), so
    // this raw record cannot be used as a cheap offline password oracle.
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
    zeroizedEarly = true;
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
    // Defense-in-depth: zeroize on every error path that skipped the early pass.
    if (!zeroizedEarly) {zeroPasswordBytes(passwordBytes);}
  }
 }
