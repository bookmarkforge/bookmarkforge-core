// ADR-019: V4/V5 encryption formats, Argon2id key derivation and zeroization primitives
/**
 * Pure encryption/decryption primitives used by the crypto Web Worker.
 *
 * These functions have no Web Worker dependencies, so they can be tested
 * directly in a Node environment (which provides globalThis.crypto.subtle).
 *
 * Format timeline:
 *   v2 — PBKDF2 (legacy, read-only)
 *   v4 — Argon2id per operation (current stored data)
 *   v5 — Argon2id-once + HKDF per operation (new encryptions)
 */

import {
  deriveArgon2idAesKey,
  deriveArgon2idHkdfBaseKey,
  deriveArgon2idKey,
} from "./argon2-kdf";

export const CRYPTO_ALGORITHM = "AES-GCM";

// ─── Session-key master-key cache ───────────────────────────────────
//
// S6: Argon2id runs ONCE per password to derive a session master key.
// Per-operation keys are derived from it via HKDF-SHA256 (~1000× faster
// than Argon2id). The cache lives for the lifetime of the module (worker
// or main-thread fallback) and is cleared on vault lock / reset.

// The cache verifier is deliberately short-lived as well as session-scoped.
// A password-derived comparison value is unavoidable if Argon2id is to run
// only once per session, but it must not remain in memory indefinitely while
// the vault is unlocked. The expiry is refreshed only by successful cache
// hits; lock/reset clears it immediately.
const SESSION_KEY_CACHE_TTL_MS = 5 * 60_000;

interface CachedMasterKey {
  passwordTag: Uint8Array;
  key: CryptoKey;
  expiresAt: number;
}

let cachedMasterKey: CachedMasterKey | null = null;
let cacheExpiryTimer: ReturnType<typeof setTimeout> | null = null;

async function hashBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return new Uint8Array(buf);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {return false;}
  let difference = 0;
  for (let i = 0; i < left.length; i++) {
    difference |= left[i]! ^ right[i]!;
  }
  return difference === 0;
}

function clearCacheEntry(entry: CachedMasterKey | null): void {
  entry?.passwordTag.fill(0);
}

function scheduleCacheExpiry(): void {
  if (cacheExpiryTimer) {
    clearTimeout(cacheExpiryTimer);
    cacheExpiryTimer = null;
  }
  const now = Date.now();
  const expiries = [cachedMasterKey, cachedV5MasterKey]
    .filter((entry): entry is CachedMasterKey => entry !== null)
    .map((entry) => entry.expiresAt);
  const nextExpiry = Math.min(...expiries);
  if (Number.isFinite(nextExpiry)) {
    cacheExpiryTimer = setTimeout(() => {
      const currentTime = Date.now();
      if (cachedMasterKey && cachedMasterKey.expiresAt <= currentTime) {
        clearCacheEntry(cachedMasterKey);
        cachedMasterKey = null;
      }
      if (cachedV5MasterKey && cachedV5MasterKey.expiresAt <= currentTime) {
        clearCacheEntry(cachedV5MasterKey);
        cachedV5MasterKey = null;
      }
      scheduleCacheExpiry();
    }, Math.max(0, nextExpiry - now));
  }
}

function cacheEntryIsValid(
  entry: CachedMasterKey | null,
  passwordTag: Uint8Array,
): entry is CachedMasterKey {
  return Boolean(
    entry &&
      entry.expiresAt > Date.now() &&
      equalBytes(entry.passwordTag, passwordTag),
  );
}

async function getSessionMasterKey(
  passwordBytes: Uint8Array,
): Promise<CryptoKey> {
  const passwordTag = await hashBytes(passwordBytes);
  if (cacheEntryIsValid(cachedMasterKey, passwordTag)) {
    passwordTag.fill(0);
    cachedMasterKey.expiresAt = Date.now() + SESSION_KEY_CACHE_TTL_MS;
    scheduleCacheExpiry();
    return cachedMasterKey.key;
  }
  clearCacheEntry(cachedMasterKey);
  cachedMasterKey = null;
  // Deterministic 32-byte salt so the same password always yields the
  // same master key across encrypt / decrypt calls in this session.
  const contextSalt = new TextEncoder().encode(
    "bookmarkforge-session-master-key-v6",
  );
  const saltHash = await crypto.subtle.digest("SHA-256", contextSalt);
  // HKDF base key (deriveKey usage) — not an AES-GCM key.
  try {
    const key = await deriveArgon2idHkdfBaseKey(
      passwordBytes,
      new Uint8Array(saltHash),
    );
    cachedMasterKey = {
      passwordTag,
      key,
      expiresAt: Date.now() + SESSION_KEY_CACHE_TTL_MS,
    };
    scheduleCacheExpiry();
    return key;
  } catch (error) {
    passwordTag.fill(0);
    throw error;
  }
}

// ─── V5 master-key cache (domain-separated from session keys) ───────
//
// V5 uses the same Argon2id-once + HKDF pattern as session keys but with
// a different context salt so the derived master key is distinct even for
// the same password.

let cachedV5MasterKey: CachedMasterKey | null = null;

async function getV5MasterKey(
  passwordBytes: Uint8Array,
): Promise<CryptoKey> {
  const passwordTag = await hashBytes(passwordBytes);
  if (cacheEntryIsValid(cachedV5MasterKey, passwordTag)) {
    passwordTag.fill(0);
    cachedV5MasterKey.expiresAt = Date.now() + SESSION_KEY_CACHE_TTL_MS;
    scheduleCacheExpiry();
    return cachedV5MasterKey.key;
  }
  clearCacheEntry(cachedV5MasterKey);
  cachedV5MasterKey = null;
  const contextSalt = new TextEncoder().encode("bookmarkforge-v5-master-key");
  const saltHash = await crypto.subtle.digest("SHA-256", contextSalt);
  // HKDF base key (deriveKey usage) — not an AES-GCM key.
  try {
    const key = await deriveArgon2idHkdfBaseKey(
      passwordBytes,
      new Uint8Array(saltHash),
    );
    cachedV5MasterKey = {
      passwordTag,
      key,
      expiresAt: Date.now() + SESSION_KEY_CACHE_TTL_MS,
    };
    scheduleCacheExpiry();
    return key;
  } catch (error) {
    passwordTag.fill(0);
    throw error;
  }
}

/** Clear all cached master keys (called on vault lock / reset). */
export function resetSessionKeyCache(): void {
  if (cacheExpiryTimer) {
    clearTimeout(cacheExpiryTimer);
    cacheExpiryTimer = null;
  }
  clearCacheEntry(cachedMasterKey);
  clearCacheEntry(cachedV5MasterKey);
  cachedMasterKey = null;
  cachedV5MasterKey = null;
}

/** @deprecated Use resetSessionKeyCache() instead. */
export function resetSessionSalt(): void {
  resetSessionKeyCache();
}

export async function deriveArgon2Key(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const key = await deriveArgon2idAesKey(passwordBytes, salt);
  if (!key) {throw new Error("Argon2id key derivation failed");}
  return key;
}

export function u8aToBase64(bytes: Uint8Array): string {
  const CHUNK = 32768;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]!);
    }
  }
  return btoa(binary);
}

export function base64ToU8a(encoded: string): Uint8Array {
  const binaryStr = atob(encoded);
  const len = binaryStr.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {out[i] = binaryStr.charCodeAt(i);}
  return out;
}

function getPasswordBytes(password: string | Uint8Array): Uint8Array {
  if (password instanceof Uint8Array) {
    return password;
  }
  const encoder = new TextEncoder();
  return encoder.encode(password);
}

/**
 * Zeroizes a password buffer in-place and returns it for chaining.
 *
 * Fail-closed reuse guard: if every byte is already zero BEFORE the
 * zeroization, a warning is emitted — the buffer was likely already
 * consumed by a prior crypto call. This catches the class of bugs where
 * a caller passes the same `Uint8Array` to two functions that both
 * claim ownership (e.g. `encryptWithBytes` then `deriveIntegrityHmacKey`
 * without a fresh copy).
 *
 * @returns The same buffer (now zero-filled) for chaining.
 */
export function zeroPasswordBytes(bytes: Uint8Array): Uint8Array {
  // Fail-closed: detect reuse before the fill so we can warn even though
  // the buffer is about to become all-zeros anyway.
  if (bytes.length > 0 && bytes.every((b) => b === 0)) {
    console.warn(
      "[zeroPasswordBytes] Buffer is already zeroized — possible reuse of a consumed password. " +
        "Callers must pass a fresh copy if the bytes are needed after a crypto operation.",
    );
  }
  bytes.fill(0);
  return bytes;
}

/**
 * Encrypts `text` with `password`, returning a `v5:`-prefixed payload.
 *
 * Ownership contract: when `password` is a `Uint8Array`, the buffer is
 * CONSUMED — zeroized via `zeroPasswordBytes` right after the master key
 * is derived, because it holds the raw secret material. Callers must NOT
 * reuse it afterwards; pass a fresh copy if the bytes are needed again
 * (e.g. `new TextEncoder().encode(password)`). A `string` password is
 * encoded internally and the transient copy is zeroized too.
 */
export async function encrypt(
  text: string,
  password: string | Uint8Array,
): Promise<string> {
  // V5: Argon2id-once + HKDF per operation. The master key is cached
  // per password so subsequent encryptions with the same password skip
  // the expensive Argon2id derivation entirely.
  const hkdfSalt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const pwBytes = getPasswordBytes(password);
  let masterKey: CryptoKey;
  try {
    masterKey = await getV5MasterKey(pwBytes);
  } finally {
    // Argon2id/HKDF can reject before the normal post-derivation cleanup.
    // Clear the caller-owned bytes on both success and failure.
    pwBytes.fill(0);
  }

  const opKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: hkdfSalt as Uint8Array<ArrayBuffer>,
      info: new TextEncoder().encode("bmf-v5-op-key"),
      hash: "SHA-256",
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: CRYPTO_ALGORITHM, iv },
    opKey,
    encoder.encode(text),
  );

  const combined = new Uint8Array(
    hkdfSalt.length + iv.length + ciphertext.byteLength,
  );
  combined.set(hkdfSalt);
  combined.set(iv, hkdfSalt.length);
  combined.set(new Uint8Array(ciphertext), hkdfSalt.length + iv.length);

  return "v5:" + u8aToBase64(combined);
}

/**
 * Decrypts a `v5:`/`v4:`/`v2:` payload with `password`.
 *
 * Ownership contract: same as `encrypt` — a `Uint8Array` password is
 * CONSUMED (zeroized via `zeroPasswordBytes` after key derivation) and
 * must not be reused by the caller.
 */
export async function decrypt(
  encryptedBase64: string,
  password: string | Uint8Array,
): Promise<string> {
  if (encryptedBase64.startsWith("v5:")) {
    // V5 (Argon2id-once + HKDF) — current format
    // Wire format: hkdf_salt(16) || iv(12) || ciphertext
    const data = encryptedBase64.substring(3);
    const combined = base64ToU8a(data);
    const hkdfSalt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const ciphertext = combined.slice(28);

    const pwBytes = getPasswordBytes(password);
    let masterKey: CryptoKey;
    try {
      masterKey = await getV5MasterKey(pwBytes);
    } finally {
      pwBytes.fill(0);
    }

    const opKey = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        salt: hkdfSalt as Uint8Array<ArrayBuffer>,
        info: new TextEncoder().encode("bmf-v5-op-key"),
        hash: "SHA-256",
      },
      masterKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: CRYPTO_ALGORITHM, iv },
      opKey,
      ciphertext,
    );
    return new TextDecoder().decode(decrypted);
  }

  if (encryptedBase64.startsWith("v4:")) {
    // V4 (Argon2id) — current format
    const data = encryptedBase64.substring(3);
    const combined = base64ToU8a(data);
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const ciphertext = combined.slice(28);

    const pwBytes = getPasswordBytes(password);
    let key: CryptoKey;
    try {
      key = await deriveArgon2Key(pwBytes, salt);
    } finally {
      pwBytes.fill(0);
    }

    const decrypted = await crypto.subtle.decrypt(
      { name: CRYPTO_ALGORITHM, iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(decrypted);
  }

  if (encryptedBase64.startsWith("v2:")) {
    // V2 (PBKDF2) — legacy format, used by test helpers and older vault seeds.
    // Supports two layouts:
    //   a) Colon-separated: v2:<base64(salt)>:<base64(iv)>:<base64(ciphertext)>
    //   b) Concatenated:    v2:<base64(salt||iv||ciphertext)>
    const body = encryptedBase64.substring(3);
    const parts = body.split(":");

    let salt: Uint8Array;
    let iv: Uint8Array;
    let ciphertext: Uint8Array;

    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      // Layout (a): colon-separated
      salt = base64ToU8a(parts[0]);
      iv = base64ToU8a(parts[1]);
      ciphertext = base64ToU8a(parts[2]);
    } else {
      // Layout (b): concatenated
      const combined = base64ToU8a(body);
      salt = combined.slice(0, 16);
      iv = combined.slice(16, 28);
      ciphertext = combined.slice(28);
    }

    const pwBytes = getPasswordBytes(password);
    try {
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        pwBytes as Uint8Array<ArrayBuffer>,
        "PBKDF2",
        false,
        ["deriveKey"],
      );
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt as Uint8Array<ArrayBuffer>, iterations: 600000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );

      const decrypted = await crypto.subtle.decrypt(
        { name: CRYPTO_ALGORITHM, iv: iv as Uint8Array<ArrayBuffer> },
        key,
        ciphertext as Uint8Array<ArrayBuffer>,
      );
      return new TextDecoder().decode(decrypted);
    } finally {
      pwBytes.fill(0);
    }
  }

  throw new Error("Unsupported encryption format — expected v5:, v4: or v2:");
}

/**
 * Encrypts `data` with a session-scoped HKDF-derived key.
 *
 * Ownership contract: when `password` is a `Uint8Array`, the buffer is
 * CONSUMED — zeroized via `zeroPasswordBytes` right after the session
 * master key is derived. Callers must NOT reuse it afterwards; pass a
 * fresh copy if the bytes are needed again. A `string` password is
 * encoded internally and the transient copy is zeroized too.
 */
export async function encryptWithSessionKey(
  data: Uint8Array,
  password: string | Uint8Array,
): Promise<Uint8Array> {
  // S6: derive the session master key via Argon2id ONCE (cached per
  // password). Per-operation keys are derived from it via HKDF-SHA256,
  // which is ~1000× faster than a fresh Argon2id per operation.
  const hkdfSalt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pwBytes = getPasswordBytes(password);
  let masterKey: CryptoKey;
  try {
    masterKey = await getSessionMasterKey(pwBytes);
  } finally {
    pwBytes.fill(0);
  }

  // HKDF-SHA256: derive a unique per-operation AES-256-GCM key.
  const opKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: hkdfSalt as Uint8Array<ArrayBuffer>,
      info: new TextEncoder().encode("bmf-session-key-v6"),
      hash: "SHA-256",
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: CRYPTO_ALGORITHM, iv },
    opKey,
    data as Uint8Array<ArrayBuffer>,
  );

  // Wire format: hkdf_salt(16) || iv(12) || ciphertext
  const combined = new Uint8Array(
    hkdfSalt.length + iv.length + ciphertext.byteLength,
  );
  combined.set(hkdfSalt);
  combined.set(iv, hkdfSalt.length);
  combined.set(
    new Uint8Array(ciphertext),
    hkdfSalt.length + iv.length,
  );
  return combined;
}

/**
 * Decrypts `data` that was encrypted with `encryptWithSessionKey`.
 *
 * Ownership contract: same as `encryptWithSessionKey` — a `Uint8Array`
 * password is CONSUMED (zeroized via `zeroPasswordBytes` after master-key
 * derivation) and must not be reused by the caller.
 */
export async function decryptWithSessionKey(
  data: Uint8Array,
  password: string | Uint8Array,
): Promise<Uint8Array> {
  // S6 wire format: hkdf_salt(16) || iv(12) || ciphertext
  const hkdfSalt = data.slice(0, 16);
  const iv = data.slice(16, 28);
  const ciphertext = data.slice(28);
  const pwBytes = getPasswordBytes(password);
  let masterKey: CryptoKey;
  try {
    masterKey = await getSessionMasterKey(pwBytes);
  } finally {
    pwBytes.fill(0);
  }

  // HKDF-SHA256: derive the same per-operation key used at encrypt time.
  const opKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: hkdfSalt as Uint8Array<ArrayBuffer>,
      info: new TextEncoder().encode("bmf-session-key-v6"),
      hash: "SHA-256",
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: CRYPTO_ALGORITHM, iv },
    opKey,
    ciphertext,
  );
  return new Uint8Array(decrypted);
}

/**
 * Encrypts binary `data` with Argon2id key derivation (v4 wire format).
 *
 * Ownership contract: when `password` is a `Uint8Array`, the buffer is
 * CONSUMED — zeroized via `zeroPasswordBytes` right after the AES key is
 * derived from Argon2id. Callers must NOT reuse it afterwards; pass a
 * fresh copy if the bytes are needed again. A `string` password is
 * encoded internally and the transient copy is zeroized too.
 */
export async function encryptBinary(
  data: Uint8Array,
  password: string | Uint8Array,
): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pwBytes = getPasswordBytes(password);
  let key: CryptoKey;
  try {
    key = await deriveArgon2Key(pwBytes, salt);
  } finally {
    pwBytes.fill(0);
  }

  const ciphertext = await crypto.subtle.encrypt(
    { name: CRYPTO_ALGORITHM, iv },
    key,
    data as Uint8Array<ArrayBuffer>,
  );

  const combined = new Uint8Array(
    salt.length + iv.length + ciphertext.byteLength,
  );
  combined.set(salt);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);
  return combined;
}

/**
 * Decrypts binary `combined` data that was encrypted with `encryptBinary`.
 *
 * Ownership contract: same as `encryptBinary` — a `Uint8Array` password
 * is CONSUMED (zeroized via `zeroPasswordBytes` after key derivation)
 * and must not be reused by the caller.
 */
export async function decryptBinary(
  combined: Uint8Array,
  password: string | Uint8Array,
): Promise<Uint8Array> {
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const ciphertext = combined.slice(28);
  const pwBytes = getPasswordBytes(password);
  let key: CryptoKey;
  try {
    key = await deriveArgon2Key(pwBytes, salt);
  } finally {
    pwBytes.fill(0);
  }

  const decrypted = await crypto.subtle.decrypt(
    { name: CRYPTO_ALGORITHM, iv },
    key,
    ciphertext,
  );
  return new Uint8Array(decrypted);
}

export async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Derives a deterministic 64-character hex database key from a password
 * and salt.
 *
 * The user-provided salt is first hashed with SHA-256 to guarantee a
 * 32-byte salt for Argon2id. The raw Argon2id-derived key is then hashed
 * with SHA-256 to produce a fixed-length hex string suitable for
 * RxDB/CryptoJS.
 *
 * Ownership contract: when `password` is a `Uint8Array`, the buffer is
 * CONSUMED — zeroized via `zeroPasswordBytes` right after the Argon2id
 * key derivation completes. Callers must NOT reuse it afterwards; pass a
 * fresh copy if the bytes are needed again. A `string` password is
 * encoded internally and the transient copy is zeroized too.
 *
 * Note: this function intentionally returns a SHA-256 digest of the
 * derived raw key because the underlying AES key is imported as
 * non-extractable.
 */
export async function deriveDbKey(
  password: string | Uint8Array,
  salt: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const pwBytes = getPasswordBytes(password);
  const saltBytes = encoder.encode(salt);
  // Argon2id requires a salt of at least 8 bytes. Hash the user-provided salt
  // with SHA-256 to obtain a deterministic 32-byte salt that satisfies the constraint.
  let rawKey: Uint8Array;
  try {
    const saltHash = await crypto.subtle.digest("SHA-256", saltBytes);
    rawKey = await deriveArgon2idKey(pwBytes, new Uint8Array(saltHash));
  } finally {
    pwBytes.fill(0);
  }
  // Hash the raw derived key with SHA-256 to produce a deterministic hex DB key.
  const dbKeyBuffer = await crypto.subtle.digest(
    "SHA-256",
    rawKey as Uint8Array<ArrayBuffer>,
  );
  // Zeroize the raw Argon2id material: only its SHA-256 digest (the hex
  // returned) is the DB key; the derived bytes must not stay in memory.
  rawKey.fill(0);
  return Array.from(new Uint8Array(dbKeyBuffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export function generateSecureSalt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
