// ADR-019: Argon2id V4 KDF and zero-memory hardening
import { isProdBuild, isTestMode } from "./env";
// Static import so Rolldown deduplicates @noble/hashes/argon2 across
// all chunks that consume argon2-kdf (main thread + workers).
import { argon2id } from "@noble/hashes/argon2.js";
// Publishes the resolved KDF profile on window for E2E diagnostics (no-op
// unless built with VITE_E2E_KDF_DIAGNOSTICS=true; never ships in prod).
// LEAF module on purpose — importing anything heavier (e.g. the database
// layer) would drag RxDB into every worker chunk that derives a key.
import { publishKdfParams } from "./e2e-diagnostics";

/**
 * S1/R3: Argon2id KDF (V4 — the ONLY supported KDF).
 *
 * Parameters adhere to RFC 9106 § 4:
 *   - t (time cost)        = 3
 *   - p (parallelism)      = 1
 *   - dkLen (derived len)  = 32 bytes
 *
 * Memory cost (m) is adaptive:
 *   - Desktop: 131072 KiB (128 MiB) — OWASP recommended for sensitive data
 *   - Mobile/tablet: 65536 KiB (64 MiB) — conserves RAM on constrained devices
 *   - Test: 8192 KiB (8 MiB) — keeps tests fast
 */

/**
 * Detects whether the device is likely a mobile phone or tablet.
 * Works in both main-thread and Web Worker contexts.
 *
 * Heuristic:
 *   1. `navigator.maxTouchPoints > 0` — touch-capable device.
 *   2. UA check for mobile/tablet keywords — distinguishes phones/tablets
 *      from desktop machines that happen to have a touchscreen.
 *
 * Falls back to `false` (desktop) when `navigator` is unavailable (SSR,
 * test environments) so the stronger 128 MiB parameters are the default.
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") {return false;}
  try {
    const hasTouch = navigator.maxTouchPoints > 0;
    if (!hasTouch) {return false;}
    const ua =
      typeof navigator.userAgent === "string"
        ? navigator.userAgent.toLowerCase()
        : "";
    // Match phones and tablets; exclude desktop touchscreens.
    return /mobile|android|iphone|ipad|ipod|tablet/.test(ua);
  } catch {
    return false;
  }
}

// RFC 9106 §4 desktop parameters (memory-hard Argon2id for non-mobile devices).
const ARGON2_PARAMS_DESKTOP = {
  t: 3,
  m: 131_072, // 128 MiB — OWASP recommended for sensitive data
  p: 1,
  dkLen: 32,
} as const;

// RFC 9106 §4 mobile parameters (lighter memory cost for constrained devices).
const ARGON2_PARAMS_MOBILE = {
  t: 3,
  m: 65_536, // 64 MiB — above OWASP interactive minimum (37 MiB)
  p: 1,
  dkLen: 32,
} as const;

// Fast parameters for test environments (8 MiB, t=1).
const ARGON2_PARAMS_TEST = {
  t: 1,
  m: 8_192, // 8 MiB
  p: 1,
  dkLen: 32,
} as const;

const ARGON2_PARAMS = isProdBuild()
  ? isMobileDevice()
    ? ARGON2_PARAMS_MOBILE
    : ARGON2_PARAMS_DESKTOP
  : isTestMode()
    ? ARGON2_PARAMS_TEST
    : isMobileDevice()
      ? ARGON2_PARAMS_MOBILE
      : ARGON2_PARAMS_DESKTOP;

async function loadArgon2(): Promise<{
  argon2id: (
    pw: Uint8Array,
    salt: Uint8Array,
    opts: { t: number; m: number; p: number; dkLen: number },
  ) => Uint8Array;
}> {
  if (typeof argon2id !== "function")
    {throw new Error("@noble/hashes/argon2.argon2id is not a function");}
  return { argon2id };
}

let argon2Promise: ReturnType<typeof loadArgon2> | null = null;

function getArgon2() {
  if (!argon2Promise) {argon2Promise = loadArgon2();}
  return argon2Promise;
}

export async function deriveArgon2idKey(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const mod = await getArgon2();
  // Work on a copy so we never mutate the caller's buffer (the caller may
  // legitimately reuse the same Uint8Array for multiple derivations).
  const pwCopy = passwordBytes.slice();
  const dk = mod.argon2id(pwCopy, salt, ARGON2_PARAMS);
  // Zeroize the working copy immediately after deriving.
  pwCopy.fill(0);
  // E2E diagnostics (gated in publishKdfParams; no-op in real production
  // builds): expose the resolved profile so the mobile-device profile can
  // assert the 64 MiB mobile parameters instead of inferring from timing.
  void publishKdfParams({
    m: ARGON2_PARAMS.m,
    t: ARGON2_PARAMS.t,
    p: ARGON2_PARAMS.p,
  });
  return dk;
}

export async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    rawKey as Uint8Array<ArrayBuffer>,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function deriveArgon2idAesKey(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const dk = await deriveArgon2idKey(passwordBytes, salt);
  try {
    return await importAesKey(dk);
  } finally {
    // Zeroize the raw derived material on success and on failure: once
    // imported into a non-extractable CryptoKey, the bytes are no longer needed.
    dk.fill(0);
  }
}

/**
 * Argon2id-derived key usable as the BASE KEY of an HKDF derivation
 * (V5 session/master-key pattern: Argon2id once, HKDF per operation).
 * AES-GCM keys from `deriveArgon2idAesKey` only carry `encrypt`/`decrypt`
 * usages, so `crypto.subtle.deriveKey` rejects them with
 * `InvalidAccessError: baseKey does not have deriveKey usage`. The raw
 * Argon2id output is imported as an HKDF base key instead.
 */
export async function deriveArgon2idHkdfBaseKey(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const dk = await deriveArgon2idKey(passwordBytes, salt);
  try {
    return await crypto.subtle.importKey(
      "raw",
      dk as Uint8Array<ArrayBuffer>,
      { name: "HKDF" },
      false,
      ["deriveKey"],
    );
  } finally {
    // Same contract: the raw material is not kept after the import.
    dk.fill(0);
  }
}
