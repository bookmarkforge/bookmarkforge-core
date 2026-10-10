/**
 * src/services/security-vault/share.ts
 *
 * Share-payload crypto helpers for the master-password vault (collaboration
 * vault sharing). Extracted from SecurityVault.ts (refactor, no behavior
 * change).
 */

import { deriveArgon2idKey } from "../../utils/argon2-kdf";
import { zeroPasswordBytes } from "../../utils/crypto-core";

/**
 * Derive the ephemeral, in-memory device credential used to unlock a session
 * from an authenticated share payload on a fresh device.
 *
 * S3: pass the share secret through Argon2id before HKDF so an attacker who
 * intercepts the share payload faces the same memory-hard KDF as the master
 * password (128 MiB desktop / 64 MiB mobile), not just raw HKDF-SHA256.
 */
export async function deriveShareCredential(
  shareSecret: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const shareBytes = new TextEncoder().encode(shareSecret);
  try {
    const argon2Key = await deriveArgon2idKey(shareBytes, salt);
    try {
      const baseKey = await crypto.subtle.importKey(
        "raw",
        argon2Key as Uint8Array<ArrayBuffer>,
        { name: "HKDF" },
        false,
        ["deriveBits"],
      );
const bits = await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          salt: salt as Uint8Array<ArrayBuffer>,
          info: new TextEncoder().encode("bookmarkforge-share-device-credential"),
          hash: "SHA-256",
        },
        baseKey,
        256,
      );
      return new Uint8Array(bits);
    } finally {
      zeroPasswordBytes(argon2Key);
    }
  } finally {
    zeroPasswordBytes(shareBytes);
  }
}

/**
 * Parse a JSON-serialized Uint8Array salt from a share payload.
 * Returns null when the value is malformed or out of bounds.
 */
export function parseShareSalt(
  saltJson: string,
  minimumLength = 1,
): Uint8Array | null {
  try {
    const parsed: unknown = JSON.parse(saltJson);
    if (
      !Array.isArray(parsed) ||
      parsed.length < minimumLength ||
      parsed.length > 64 ||
      parsed.some(
        (value) =>
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < 0 ||
          value > 255,
      )
    ) {
      return null;
    }
    return new Uint8Array(parsed);
  } catch {
    return null;
  }
}
