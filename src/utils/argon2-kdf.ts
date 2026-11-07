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
 * Parameters follow RFC 9106's memory-constrained recommendation (§4): t=3,
 * p=1, dkLen=32. The RFC's *first* recommended option uses p=4; p=1 is the
 * single-lane profile it explicitly allows for constrained clients, which is
 * what a browser tab is. Memory (§3.1) is the parameter doing the work here.
 *
 * Memory cost (m) is adaptive:
 *   - Desktop: 131072 KiB (128 MiB) — OWASP recommended for sensitive data
 *   - Mobile/tablet: 65536 KiB (64 MiB) — conserves RAM on constrained devices
 *   - Test: 8192 KiB (8 MiB) — keeps tests fast
 */

// Pre-compiled regex for mobile detection (avoid recompilation on each call)
const MOBILE_UA_REGEX = /mobile|android|iphone|ipad|ipod|tablet/;

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
    return MOBILE_UA_REGEX.test(ua);
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

/**
 * The parameters a derivation actually ran with.
 *
 * Since the v7 envelope (A-01) these travel INSIDE the payload, so a blob
 * written on one device/profile opens on another instead of deriving a
 * different key and reporting "wrong password".
 */
export interface Argon2Params {
  /** Memory cost in KiB. */
  m: number;
  /** Iterations. */
  t: number;
  /** Parallelism. */
  p: number;
  /** Derived key length in bytes. */
  dkLen: number;
}

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

/**
 * The parameters new payloads are written with on this device/build.
 *
 * Read it ONLY to label a fresh payload; never to decide how to open an
 * existing one — that answer comes from the payload itself (v7).
 */
export function getActiveArgon2Params(): Argon2Params {
  return { ...ARGON2_PARAMS };
}

export async function deriveArgon2idKey(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
): Promise<Uint8Array> {
  return await deriveArgon2idKeyWithParams(passwordBytes, salt, ARGON2_PARAMS);
}

/**
 * Argon2id with EXPLICIT parameters — the v7 read path uses the ones carried by
 * the payload, so a desktop blob opens on mobile and vice versa.
 *
 * The working copy of the password is zeroized on every exit path (A-02/B-02):
 * a thrown derivation must not leave credential bytes in the heap.
 */
async function deriveArgon2idKeyWithParams(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  const mod = await getArgon2();
  // Work on a copy so we never mutate the caller's buffer (the caller may
  // legitimately reuse the same Uint8Array for multiple derivations).
  const pwCopy = passwordBytes.slice();
  let dk: Uint8Array;
  try {
    dk = mod.argon2id(pwCopy, salt, params);
  } finally {
    pwCopy.fill(0);
  }
  // E2E diagnostics (gated in publishKdfParams; no-op in real production
  // builds): expose the resolved profile so the mobile-device profile can
  // assert the 64 MiB mobile parameters instead of inferring from timing.
  void publishKdfParams({
    m: params.m,
    t: params.t,
    p: params.p,
  });
  return dk;
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
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
 * AES-GCM key from an EXPLICIT parameter set (A2, audit 2026-11-05).
 *
 * The portable binary backup container (`encryptBinary`/`decryptBinary`) carries
 * its Argon2id parameters, so a `.bmf` file written on a desktop (128 MiB) opens
 * on a phone (64 MiB) and vice versa. Exactly the same contract as the v7 read
 * path: the parameters come from the payload, never from the local profile.
 *
 * Ownership contract: identical to `deriveArgon2idAesKey` — the caller keeps
 * ownership of `passwordBytes` (this function derives from a private copy and
 * zeroizes it), and the raw derived key is wiped after the import.
 */
export async function deriveArgon2idAesKeyWithParams(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<CryptoKey> {
  const dk = await deriveArgon2idKeyWithParams(passwordBytes, salt, params);
  try {
    return await importAesKey(dk);
  } finally {
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
  return await deriveArgon2idHkdfBaseKeyWithParams(
    passwordBytes,
    salt,
    ARGON2_PARAMS,
  );
}

/** HKDF base key derived with the EXPLICIT parameters carried by a v7 blob. */
export async function deriveArgon2idHkdfBaseKeyWithParams(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<CryptoKey> {
  const dk = await deriveArgon2idKeyWithParams(passwordBytes, salt, params);
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
