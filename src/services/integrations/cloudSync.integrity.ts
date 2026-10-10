/**
 * Per-version remote backup integrity (HMAC sidecar).
 *
 * Problem: AES-GCM authenticates the ciphertext, but only AFTER the full
 * download + Argon2id key derivation. A provider (or an attacker with
 * provider access) can silently truncate or corrupt a stored backup and the
 * user only finds out when the restore fails — possibly after the local
 * vault was already overwritten.
 *
 * Solution: every upload publishes a tiny JSON sidecar next to the payload
 * containing an HMAC-SHA256 over the exact uploaded bytes. The HMAC key is
 * derived from the master password via HKDF-SHA256 with a dedicated info
 * label (never the AES key), so:
 *   - the provider cannot compute or forge tags without the password;
 *   - tags are verified BEFORE Base64 decoding and BEFORE any Argon2id work
 *     or database write, making truncation/tampering/corruption detectable
 *     at the cheapest possible point.
 *
 * Tag format (hex `nonce64:hmac64`, same shape as vault integrity records):
 *   `sidecar-v1:` + 64 hex chars (32-byte random HKDF salt/nonce)
 *   + ":" + 64 hex chars (HMAC-SHA256 over the payload bytes).
 *
 * Sidecar JSON: `{ v: 1, alg: "HMAC-SHA256", fileName, size, hmac }` — the
 * `size` field is cross-checked against the downloaded length so truncation
 * at the transport level fails even before the HMAC comparison.
 */

import { logger } from "../../utils/logger";
import { constantTimeCompare } from "../security-vault/compare";

/** Filename suffix for the integrity sidecar of a remote backup. */
export const INTEGRITY_SIDECAR_SUFFIX = ".integrity.json";

/** Algorithms accepted when verifying a sidecar (extensible, pinned for now). */
const SUPPORTED_SIDECAR_VERSIONS = [1] as const;

interface RemoteIntegritySidecar {
  v: number;
  alg: "HMAC-SHA256";
  fileName: string;
  size: number;
  hmac: string;
}

/**
 * Derives the sidecar HMAC key from the master password via HKDF-SHA256.
 * The `info` label is distinct from the vault verification integrity label,
 * so a key leak in one subsystem cannot sign payloads in the other. The
 * password buffer is zeroized by the caller (same ownership rules as the
 * vault: the caller passes a fresh copy it owns).
 */
async function deriveRemoteIntegrityHmacKey(
  passwordBytes: Uint8Array,
  nonce: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBytes as Uint8Array<ArrayBuffer>,
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: nonce as Uint8Array<ArrayBuffer>,
      info: new TextEncoder().encode("bmf-remote-backup-integrity-v1"),
      hash: "SHA-256",
    },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Sidecar filename for a given payload filename. */
export function getSidecarFileName(payloadFileName: string): string {
  return `${payloadFileName}${INTEGRITY_SIDECAR_SUFFIX}`;
}

/**
 * Computes the integrity tag over the exact payload bytes with a fresh
 * random nonce and returns the ready-to-upload sidecar JSON string.
 * Throws when WebCrypto is unavailable (fail-closed: no untagged upload).
 */
export async function createRemoteIntegritySidecar(
  payloadBytes: Uint8Array,
  payloadFileName: string,
  passwordBytes: Uint8Array,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const hmacKey = await deriveRemoteIntegrityHmacKey(passwordBytes, nonce);
  const signature = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    payloadBytes as Uint8Array<ArrayBuffer>,
  );
  const sidecar: RemoteIntegritySidecar = {
    v: 1,
    alg: "HMAC-SHA256",
    fileName: payloadFileName,
    size: payloadBytes.length,
    hmac: `sidecar-v1:${toHex(nonce)}:${toHex(new Uint8Array(signature))}`,
  };
  return JSON.stringify(sidecar);
}

export type RemoteIntegrityResult =
  | { status: "verified"; size: number }
  | { status: "mismatch"; reason: "truncated" | "tampered" | "tag-format" }
  | { status: "missing" };

/**
 * Verifies a downloaded payload against its integrity sidecar BEFORE the
 * payload is decoded or decrypted. Never throws: returns a discriminated
 * result so callers map outcomes to their own localized errors.
 *
 * A failed comparison is computed via constant-time compare to avoid any
 * oracle from early-exit timing on attacker-controlled tags.
 */
export async function verifyRemoteBackupIntegrity(
  payloadBytes: Uint8Array,
  sidecarJson: string | null,
  passwordBytes: Uint8Array,
  expectedFileName?: string,
): Promise<RemoteIntegrityResult> {
  if (!sidecarJson) {
    return { status: "missing" };
  }

  let sidecar: RemoteIntegritySidecar | null = null;
  try {
    const parsed: unknown = JSON.parse(sidecarJson);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as RemoteIntegritySidecar).hmac === "string" &&
      typeof (parsed as RemoteIntegritySidecar).size === "number" &&
      (parsed as RemoteIntegritySidecar).v === 1 &&
      (parsed as RemoteIntegritySidecar).alg === "HMAC-SHA256"
    ) {
      sidecar = parsed as RemoteIntegritySidecar;
    }
  } catch {
    sidecar = null;
  }
  if (!sidecar) {
    logger.warn("cloudSync.integrity", { action: "sidecar-malformed" });
    return { status: "mismatch", reason: "tag-format" };
  }
  // Bind the tag to the exact remote version: a sidecar written for another
  // backup file must never authenticate this payload.
  if (expectedFileName !== undefined && sidecar.fileName !== expectedFileName) {
    logger.warn("cloudSync.integrity", { action: "file-name-mismatch" });
    return { status: "mismatch", reason: "tag-format" };
  }

  if (sidecar.size !== payloadBytes.length) {
    logger.warn("cloudSync.integrity", {
      action: "size-mismatch",
      expected: sidecar.size,
      actual: payloadBytes.length,
    });
    return { status: "mismatch", reason: "truncated" };
  }

  const match = /^sidecar-v1:([0-9a-f]{64}):([0-9a-f]{64})$/.exec(sidecar.hmac);
  if (!match) {
    return { status: "mismatch", reason: "tag-format" };
  }
  const nonceHex = match[1] ?? "";
  const expectedHex = match[2] ?? "";

  const nonce = new Uint8Array(32);
  for (let i = 0; i < 64; i += 2) {
    nonce[i / 2] = parseInt(nonceHex.slice(i, i + 2), 16);
  }

  const hmacKey = await deriveRemoteIntegrityHmacKey(passwordBytes, nonce);
  const signature = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    payloadBytes as Uint8Array<ArrayBuffer>,
  );
  const actualHex = toHex(new Uint8Array(signature));

  // Constant-time comparison: never leak tag prefix similarity through timing.
  if (!constantTimeCompare(actualHex, expectedHex)) {
    logger.warn("cloudSync.integrity", { action: "hmac-mismatch" });
    return { status: "mismatch", reason: "tampered" };
  }
  return { status: "verified", size: payloadBytes.length };
}

export function isSupportedSidecarVersion(v: unknown): boolean {
  return (
    typeof v === "number" &&
    (SUPPORTED_SIDECAR_VERSIONS as readonly number[]).includes(v)
  );
}
