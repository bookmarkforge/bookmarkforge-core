// ADR-019: V4/V5 encryption formats, Argon2id key derivation and zeroization primitives
/**
 * Pure encryption/decryption primitives used by the crypto Web Worker.
 *
 * These functions have no Web Worker dependencies, so they can be tested
 * directly in a Node environment (which provides globalThis.crypto.subtle).
 *
 * Format timeline:
 *   v2 — PBKDF2 (legacy, read-only)
 *   v4 — Argon2id per operation (stored data)
 *   v5 — Argon2id-once + HKDF per operation, fixed bundle-wide Argon2id salt
 *   v6 — same as v5 but keyed by a random PER-VAULT Argon2id salt that is
 *        embedded in the payload (see setVaultKdfSalt / VAULT_KDF_SALT_BYTES)
 */

import {
  deriveArgon2idAesKey,
  deriveArgon2idHkdfBaseKey,
  deriveArgon2idKey,
} from "./argon2-kdf";
import { env } from "../env.config";

export const CRYPTO_ALGORITHM = "AES-GCM";

/** Error thrown when a v5 legacy format read is blocked by the cutoff. */
export class LegacyV5FormatRemovedError extends Error {
  constructor() {
    super("[crypto-core] v5 legacy format read is disabled by VITE_ALLOW_V5_LEGACY_READ");
    this.name = "LegacyV5FormatRemovedError";
  }
}

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

/**
 * Maximum number of master keys retained. Entries are keyed by
 * `purpose:salt`, so one vault normally holds two (legacy V5 blobs + V6
 * vault-salted blobs); the bound only exists to stop a stream of foreign
 * salts (shares/backups from other vaults) from growing the cache forever.
 */
const MAX_MASTER_KEY_CACHE_ENTRIES = 8;

interface CachedMasterKey {
  passwordTag: Uint8Array;
  key: CryptoKey;
  expiresAt: number;
}

/**
 * Master-key cache. Keyed by `purpose:saltTag`, NOT by password alone: a
 * single vault legitimately holds blobs under two different Argon2id salts
 * (legacy V5 blobs under the fixed bundle salt + V6 blobs under the vault's
 * random salt) and interleaved reads of both must never thrash, which would
 * re-run Argon2id on every row.
 */
const masterKeyCache = new Map<string, CachedMasterKey>();
let cacheExpiryTimer: ReturnType<typeof setTimeout> | null = null;

/** Tag used for the legacy, bundle-wide (fixed) Argon2id salt. */
const LEGACY_SALT_TAG = "legacy";

/**
 * Per-vault Argon2id salt (A-1 mitigation). `null` = legacy mode: the
 * derivation falls back to the fixed, bundle-wide salt and emits `v5:`
 * payloads. Set once per vault by the security vault
 * (src/services/security-vault/kdf-salt.ts) from a random value persisted in
 * SecureStorage.
 */
let vaultKdfSalt: Uint8Array | null = null;

/** Length of the per-vault Argon2id salt, in bytes. */
export const VAULT_KDF_SALT_BYTES = 16;

const HEX_SALT_RE = /^[0-9a-f]{32}$/;

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Installs (or clears) the per-vault Argon2id salt.
 *
 * The salt is NOT secret — it is stored next to the ciphertexts and travels
 * embedded in every `v6:` payload — but it must be unique per vault, which is
 * what defeats the cross-user precomputed-dictionary attack: with a shared
 * salt, one Argon2id pass over a candidate password serves every vault in the
 * world; with a per-vault salt, that pass only serves the vault the salt
 * belongs to.
 *
 * Cache safety: entries are keyed by salt, so switching salts never returns a
 * key derived under a different one. Pass `null` to return to legacy mode
 * (used by tests and by code paths that have no vault salt — e.g. a locked
 * vault whose storage is unreadable); new payloads are then `v5:` again.
 *
 * @param salt - 32 lowercase-hex characters, a 16-byte salt, or `null`.
 */
export function setVaultKdfSalt(salt: string | Uint8Array | null): void {
  if (salt === null) {
    if (vaultKdfSalt) {
      vaultKdfSalt.fill(0);
      vaultKdfSalt = null;
    }
    return;
  }
  let bytes: Uint8Array;
  if (typeof salt === "string") {
    const normalized = salt.trim().toLowerCase();
    if (!HEX_SALT_RE.test(normalized)) {
      throw new Error(
        `[crypto-core] Invalid vault KDF salt: expected ${VAULT_KDF_SALT_BYTES * 2} hex characters`,
      );
    }
    bytes = new Uint8Array(VAULT_KDF_SALT_BYTES);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
    }
  } else if (
    salt instanceof Uint8Array &&
    salt.length === VAULT_KDF_SALT_BYTES
  ) {
    bytes = new Uint8Array(salt);
  } else {
    throw new Error(
      `[crypto-core] Invalid vault KDF salt: expected ${VAULT_KDF_SALT_BYTES} bytes`,
    );
  }
  if (vaultKdfSalt) {vaultKdfSalt.fill(0);}
  vaultKdfSalt = bytes;
}

/** The active per-vault Argon2id salt as lowercase hex, or `null`. */
export function getVaultKdfSaltHex(): string | null {
  return vaultKdfSalt ? bytesToHex(vaultKdfSalt) : null;
}

/**
 * Context salt fed to Argon2id: SHA-256 over the (public) context string,
 * extended with the per-vault salt when one is active.
 *
 * Legacy compatibility is bit-exact: with no vault salt the digest input is
 * the bare context string, which is exactly what every pre-A-1 vault used, so
 * existing `v5:` ciphertexts keep decrypting.
 */
async function deriveContextSalt(
  context: string,
  salt: Uint8Array | null,
): Promise<Uint8Array> {
  const input = salt ? `${context}:v2:${bytesToHex(salt)}` : context;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return new Uint8Array(digest);
}

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
  const nextExpiry = Math.min(
    ...Array.from(masterKeyCache.values(), (entry) => entry.expiresAt),
  );
  if (!Number.isFinite(nextExpiry)) {return;}
  cacheExpiryTimer = setTimeout(() => {
    const currentTime = Date.now();
    for (const [key, entry] of masterKeyCache) {
      if (entry.expiresAt <= currentTime) {
        clearCacheEntry(entry);
        masterKeyCache.delete(key);
      }
    }
    scheduleCacheExpiry();
  }, Math.max(0, nextExpiry - now));
}

function cacheKey(purpose: "session" | "v5", salt: Uint8Array | null): string {
  return `${purpose}:${salt ? bytesToHex(salt) : LEGACY_SALT_TAG}`;
}

/**
 * Returns the cached master key for this (purpose, salt, password) triple,
 * refreshing its TTL. A password mismatch for the same purpose+salt evicts
 * the stale entry (a vault never legitimately holds two passwords' keys).
 */
function takeCachedMasterKey(
  key: string,
  passwordTag: Uint8Array,
): CryptoKey | null {
  const entry = masterKeyCache.get(key);
  if (!entry) {return null;}
  if (
    entry.expiresAt <= Date.now() ||
    !equalBytes(entry.passwordTag, passwordTag)
  ) {
    clearCacheEntry(entry);
    masterKeyCache.delete(key);
    return null;
  }
  entry.expiresAt = Date.now() + SESSION_KEY_CACHE_TTL_MS;
  scheduleCacheExpiry();
  return entry.key;
}

function storeCachedMasterKey(
  key: string,
  entry: CachedMasterKey,
): void {
  const existing = masterKeyCache.get(key);
  if (existing) {clearCacheEntry(existing);}
  if (!existing && masterKeyCache.size >= MAX_MASTER_KEY_CACHE_ENTRIES) {
    // Evict the entry closest to expiry (it is the least recently refreshed).
    let oldestKey: string | null = null;
    let oldestExpiry = Number.POSITIVE_INFINITY;
    for (const [candidate, value] of masterKeyCache) {
      if (value.expiresAt < oldestExpiry) {
        oldestExpiry = value.expiresAt;
        oldestKey = candidate;
      }
    }
    if (oldestKey !== null) {
      clearCacheEntry(masterKeyCache.get(oldestKey) ?? null);
      masterKeyCache.delete(oldestKey);
    }
  }
  masterKeyCache.set(key, entry);
  scheduleCacheExpiry();
}

/**
 * Argon2id-once master key for the given salt, cached per (purpose, salt).
 * @param purpose - Domain separation between session keys and V5/V6 keys.
 */
async function deriveCachedMasterKey(
  purpose: "session" | "v5",
  context: string,
  passwordBytes: Uint8Array,
  salt: Uint8Array | null,
): Promise<CryptoKey> {
  const key = cacheKey(purpose, salt);
  const passwordTag = await hashBytes(passwordBytes);
  const cached = takeCachedMasterKey(key, passwordTag);
  if (cached) {
    passwordTag.fill(0);
    return cached;
  }
  // HKDF base key (deriveKey usage) — not an AES-GCM key.
  try {
    const argonSalt = await deriveContextSalt(context, salt);
    const derived = await deriveArgon2idHkdfBaseKey(passwordBytes, argonSalt);
    storeCachedMasterKey(key, {
      passwordTag,
      key: derived,
      expiresAt: Date.now() + SESSION_KEY_CACHE_TTL_MS,
    });
    return derived;
  } catch (_error) {
    passwordTag.fill(0);
    throw new Error(
      "[crypto-core] Master key derivation failed",
    );
  }
}

/**
 * Session master key. Argon2id runs once per (password, salt) and is cached;
 * per-operation keys are derived from it with HKDF (see
 * encryptWithSessionKey).
 */
async function getSessionMasterKey(
  passwordBytes: Uint8Array,
  salt: Uint8Array | null,
): Promise<CryptoKey> {
  return deriveCachedMasterKey(
    "session",
    "bookmarkforge-session-master-key-v6",
    passwordBytes,
    salt,
  );
}

/**
 * V5/V6 master key. Same Argon2id-once + HKDF pattern as the session key, but
 * domain-separated by context so the same password never yields the same key
 * for both purposes.
 */
async function getV5MasterKey(
  passwordBytes: Uint8Array,
  salt: Uint8Array | null,
): Promise<CryptoKey> {
  return deriveCachedMasterKey(
    "v5",
    "bookmarkforge-v5-master-key",
    passwordBytes,
    salt,
  );
}

/**
 * Clear all cached master keys (called on vault lock / reset).
 *
 * The per-vault Argon2id salt is NOT part of the cache and is deliberately
 * kept: it is public vault metadata, not key material, and dropping it would
 * silently downgrade every subsequent write back to the legacy fixed salt.
 * Use `setVaultKdfSalt(null)` to clear it explicitly.
 */
export function resetSessionKeyCache(): void {
  if (cacheExpiryTimer) {
    clearTimeout(cacheExpiryTimer);
    cacheExpiryTimer = null;
  }
  for (const entry of masterKeyCache.values()) {
    clearCacheEntry(entry);
  }
  masterKeyCache.clear();
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
  // Max-effort zeroization (ADR): fill(0) → XOR 0xAA → fill(0) defeats
  // compiler elision, matching EncryptionService.zeroBytes.
  bytes.fill(0);
  for (let i = 0; i < bytes.length; i++) { bytes[i] = bytes[i]! ^ 0xAA; }
  bytes.fill(0);
  return bytes;
}

/**
 * Encrypts `text` with `password`, returning a `v6:`-prefixed payload when a
 * per-vault KDF salt is active, or `v5:` in legacy mode.
 *
 * Wire formats:
 *   v6: base64(vault_salt(16) || hkdf_salt(16) || iv(12) || ciphertext)
 *   v5: base64(hkdf_salt(16) || iv(12) || ciphertext)   (legacy)
 *
 * The vault salt is embedded so every payload is self-describing: decryption
 * never depends on the local salt state, which is what makes cross-device
 * shares/backups and post-provisioning reads of pre-migration blobs work.
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
  // V5/V6: Argon2id-once + HKDF per operation. The master key is cached
  // per (password, salt) so subsequent encryptions with the same password
  // skip the expensive Argon2id derivation entirely.
  const vaultSalt = vaultKdfSalt;
  const hkdfSalt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const pwBytes = getPasswordBytes(password);
  let masterKey: CryptoKey;
  try {
    masterKey = await getV5MasterKey(pwBytes, vaultSalt);
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

  const headerLength = (vaultSalt ? vaultSalt.length : 0) + 16 + 12;
  const combined = new Uint8Array(headerLength + ciphertext.byteLength);
  let offset = 0;
  if (vaultSalt) {
    combined.set(vaultSalt, 0);
    offset += vaultSalt.length;
  }
  combined.set(hkdfSalt, offset);
  combined.set(iv, offset + 16);
  combined.set(new Uint8Array(ciphertext), headerLength);

  return (vaultSalt ? "v6:" : "v5:") + u8aToBase64(combined);
}

/**
 * Decrypts a `v6:`/`v5:`/`v4:`/`v2:` payload with `password`.
 *
 * `v6:` carries its own per-vault salt, so it decrypts with the password from
 * any device/session regardless of the locally provisioned salt. `v5:` and
 * older formats keep using the legacy fixed-salt/Argon2id-per-op derivations.
 *
 * Ownership contract: same as `encrypt` — a `Uint8Array` password is
 * CONSUMED (zeroized via `zeroPasswordBytes` after key derivation) and
 * must not be reused by the caller.
 */
export async function decrypt(
  encryptedBase64: string,
  password: string | Uint8Array,
): Promise<string> {
  if (encryptedBase64.startsWith("v6:")) {
    // V6 (per-vault Argon2id salt) — current format.
    // Wire format: vault_salt(16) || hkdf_salt(16) || iv(12) || ciphertext
    const data = encryptedBase64.substring(3);
    const combined = base64ToU8a(data);
    const vaultSalt = combined.slice(0, VAULT_KDF_SALT_BYTES);
    const hkdfSalt = combined.slice(
      VAULT_KDF_SALT_BYTES,
      VAULT_KDF_SALT_BYTES + 16,
    );
    const iv = combined.slice(VAULT_KDF_SALT_BYTES + 16, VAULT_KDF_SALT_BYTES + 28);
    const ciphertext = combined.slice(VAULT_KDF_SALT_BYTES + 28);
    if (vaultSalt.length !== VAULT_KDF_SALT_BYTES) {
      throw new Error("[crypto-core] Malformed v6 payload: missing vault salt");
    }

    const pwBytes = getPasswordBytes(password);
    let masterKey: CryptoKey;
    try {
      // The EMBEDDED salt wins over the module-level one: it is the salt the
      // payload was actually written with.
      masterKey = await getV5MasterKey(pwBytes, vaultSalt);
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

  if (encryptedBase64.startsWith("v5:")) {
    // ADR-052 Fase 3 — cutoff switch. Default (flag unset/false) keeps
    // the legacy read path open: v5 payloads decrypt under the retired
    // bundle-wide static salt while the sunset criterion (zero residual
    // v5 across two consecutive unlocks) has not been met. When
    // VITE_ALLOW_V5_LEGACY_READ=true the cutoff is activated and v5
    // reads fail closed with LegacyV5FormatRemovedError.
    if (env.allowV5LegacyRead === true) {
      throw new LegacyV5FormatRemovedError();
    }
    // V5 (Argon2id-once + HKDF, legacy fixed salt) — still read for every
    // payload written before the per-vault salt existed, and for new writes
    // on code paths that run without a provisioned vault salt.
    // Wire format: hkdf_salt(16) || iv(12) || ciphertext
    const data = encryptedBase64.substring(3);
    const combined = base64ToU8a(data);
    const hkdfSalt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const ciphertext = combined.slice(28);

    const pwBytes = getPasswordBytes(password);
    let masterKey: CryptoKey;
    try {
      masterKey = await getV5MasterKey(pwBytes, null);
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

  throw new Error("Unsupported encryption format — expected v6:, v5:, v4: or v2:");
}

/**
 * Marker byte prefixing the vault-salted session-key wire format.
 * Legacy payloads start with the (random) HKDF salt, so a legacy blob matches
 * this marker with probability 1/256 — see `decryptWithSessionKey`, which
 * falls back to the legacy layout after a failed v6 attempt.
 */
const SESSION_V6_MARKER = 0x06;

/**
 * Encrypts `data` with a session-scoped HKDF-derived key.
 *
 * Wire format (v6, when a per-vault KDF salt is active):
 *   0x06 || vault_salt(16) || hkdf_salt(16) || iv(12) || ciphertext
 * Wire format (legacy, no vault salt):
 *   hkdf_salt(16) || iv(12) || ciphertext
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
  const vaultSalt = vaultKdfSalt;
  const hkdfSalt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pwBytes = getPasswordBytes(password);
  let masterKey: CryptoKey;
  try {
    masterKey = await getSessionMasterKey(pwBytes, vaultSalt);
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

  // Wire format: [0x06 || vault_salt(16)] || hkdf_salt(16) || iv(12) || ct
  const headerLength = (vaultSalt ? 1 + vaultSalt.length : 0) + 16 + 12;
  const combined = new Uint8Array(headerLength + ciphertext.byteLength);
  let offset = 0;
  if (vaultSalt) {
    combined[0] = SESSION_V6_MARKER;
    combined.set(vaultSalt, 1);
    offset = 1 + vaultSalt.length;
  }
  combined.set(hkdfSalt, offset);
  combined.set(iv, offset + 16);
  combined.set(new Uint8Array(ciphertext), headerLength);
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
  // Each layout attempt gets its OWN password material. `decryptSessionPayload`
  // consumes the buffer it is handed (zeroizing it once the master key is
  // derived), so a Uint8Array password passed straight to the v6 attempt would
  // reach the legacy retry below all-zero: the retry would then hash zeros,
  // miss the cache and derive the wrong master key — failing for exactly the
  // legacy blobs this retry exists for (random first byte equal to
  // SESSION_V6_MARKER, 1/256). A string password encoded fresh per attempt
  // never showed this; the service layer always passes bytes.
  const owned = password instanceof Uint8Array ? password : null;
  const attempt = (): string | Uint8Array => (owned ? owned.slice() : (password as string));
  try {
    if (data.length > 1 + VAULT_KDF_SALT_BYTES + 28 && data[0] === SESSION_V6_MARKER) {
      // V6 layout. The marker is not a hard guarantee for LEGACY blobs (their
      // first byte is random HKDF salt), so a failed v6 attempt falls through
      // to the legacy layout instead of surfacing an auth error for a blob that
      // is actually legacy.
      const vaultSalt = data.slice(1, 1 + VAULT_KDF_SALT_BYTES);
      const hkdfSalt = data.slice(1 + VAULT_KDF_SALT_BYTES, 1 + VAULT_KDF_SALT_BYTES + 16);
      const iv = data.slice(1 + VAULT_KDF_SALT_BYTES + 16, 1 + VAULT_KDF_SALT_BYTES + 28);
      const ciphertext = data.slice(1 + VAULT_KDF_SALT_BYTES + 28);
      try {
        return await decryptSessionPayload(
          ciphertext,
          iv,
          hkdfSalt,
          vaultSalt,
          attempt(),
        );
      } catch (error) {
        // Ambiguous legacy payload whose first byte happened to equal the
        // marker: retry with the legacy layout before failing.
        void error;
      }
    }

    // Legacy layout: hkdf_salt(16) || iv(12) || ciphertext
    return await decryptSessionPayload(
      data.slice(28),
      data.slice(16, 28),
      data.slice(0, 16),
      null,
      attempt(),
    );
  } finally {
    // Ownership contract unchanged: a Uint8Array password is consumed (and
    // warned about if already zero) exactly once, by this call.
    if (owned) {zeroPasswordBytes(owned);}
  }
}

/** Shared body of the session-key decrypt paths (v6 and legacy). */
async function decryptSessionPayload(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  hkdfSalt: Uint8Array,
  vaultSalt: Uint8Array | null,
  password: string | Uint8Array,
): Promise<Uint8Array> {
  const pwBytes = getPasswordBytes(password);
  let masterKey: CryptoKey;
  try {
    masterKey = await getSessionMasterKey(pwBytes, vaultSalt);
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
    { name: CRYPTO_ALGORITHM, iv: iv as Uint8Array<ArrayBuffer> },
    opKey,
    ciphertext as Uint8Array<ArrayBuffer>,
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
