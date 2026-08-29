// src/services/licenseSigning.ts
//
// Client-side license-state VERIFICATION (server-side signing).
//
// The signing private key lives in the signing service
// (server/src/license-signing.ts) and is never shipped in the client bundle.
// The app only VERIFIES the license state it receives from that service with
// the committed public key (see licenseKeys.ts), so a hand-edited cached
// state (localStorage) fails verification and the app downgrades to Free
// (tamper audit recorded). Because the private key is not in the bundle,
// forging a "Pro forever" signature is no longer a matter of extracting a
// key from the shipped JS — it requires the server-held secret.
//
// RSA-PSS (SHA-256, salt 32) is used because WebCrypto's
// `crypto.subtle.sign`/`verify` implement it in every evergreen browser
// (Ed25519 is not portable via WebCrypto), and it is byte-compatible with
// the Node crypto RSA-PSS used by the signing service.

import { LICENSE_PUBLIC_KEY_SPKI } from "./licenseKeys";
import { logger } from "../utils/logger";
import { base64ToU8a } from "../utils/crypto-core";

export interface LicensePayload {
  /** Format version — bump on any breaking payload change. */
  v: 1;
  /** Per-install UUID; binds the token to this device install. */
  deviceId: string;
  /** Epoch ms of the last successful validation. */
  validatedAt: number;
  /** Epoch ms when the entitlement ends (undefined = lifetime license). */
  expiresAt?: number;
  /** Remaining activations reported by the license server (display only). */
  activationsLeft?: number;
  /** License server instance id (binds the token to the activated instance). */
  instanceId?: string;
}

const SIGN_ALG = {
  name: "RSA-PSS",
  hash: "SHA-256",
} as const;
const SIGN_OPTIONS: RsaPssParams = {
  name: "RSA-PSS",
  saltLength: 32,
};

let publicKeyPromise: Promise<CryptoKey> | null = null;

function importPublicKey(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    base64ToU8a(spkiBase64) as Uint8Array<ArrayBuffer>,
    SIGN_ALG,
    false,
    ["verify"],
  );
}

function loadCommittedPublicKey(): Promise<CryptoKey> {
  if (publicKeyPromise) {return publicKeyPromise;}
  publicKeyPromise = importPublicKey(LICENSE_PUBLIC_KEY_SPKI);
  return publicKeyPromise;
}

/**
 * Canonical serialization for signing/verifying: key-sorted JSON so the
 * payload's object key order can never invalidate a signature. This MUST
 * byte-match the server's canonicalization (server/src/license-signing.ts).
 */
export function canonicalLicenseJson(payload: LicensePayload): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    const value = (payload as unknown as Record<string, unknown>)[key];
    if (value !== undefined) {
      sorted[key] = value;
    }
  }
  return JSON.stringify(sorted);
}

/**
 * Verify a license payload's signature against an arbitrary public key.
 * Exported for the server↔client contract tests; production callers use
 * `verifyLicensePayload` with the committed key.
 */
export async function verifyLicenseSignature(
  payload: LicensePayload,
  signature: string,
  publicKeySpkiBase64: string,
): Promise<boolean> {
  try {
    const publicKey = await importPublicKey(publicKeySpkiBase64);
    const data = new TextEncoder().encode(canonicalLicenseJson(payload));
    return await crypto.subtle.verify(
      SIGN_OPTIONS,
      publicKey,
      base64ToU8a(signature) as Uint8Array<ArrayBuffer>,
      data,
    );
  } catch (error) {
    logger.warn("[licenseSigning] verification unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Verify a license payload's signature against the committed public key.
 * Never throws on a bad signature.
 */
export async function verifyLicensePayload(
  payload: LicensePayload,
  signature: string,
): Promise<boolean> {
  try {
    const publicKey = await loadCommittedPublicKey();
    const data = new TextEncoder().encode(canonicalLicenseJson(payload));
    return await crypto.subtle.verify(
      SIGN_OPTIONS,
      publicKey,
      base64ToU8a(signature) as Uint8Array<ArrayBuffer>,
      data,
    );
  } catch (error) {
    logger.warn("[licenseSigning] verification unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Unit-test escape hatch: forget the cached public key (key rotation tests). */
export function resetLicenseVerifyCache(): void {
  publicKeyPromise = null;
}
