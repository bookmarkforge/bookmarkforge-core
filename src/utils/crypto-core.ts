// ADR-019: V4/V5 encryption formats, Argon2id key derivation and zeroization primitives
/**
 * Pure encryption/decryption primitives used by the crypto Web Worker.
 *
 * These functions have no Web Worker dependencies, so they can be tested
 * directly in a Node environment (which provides globalThis.crypto.subtle).
 *
 * Format timeline:
 * v2 — PBKDF2 (legacy, read-only)
 * v4 — Argon2id per operation (stored data)
 * v5 — Argon2id-once + HKDF per operation, fixed bundle-wide Argon2id salt.
 * REMOVED (ADR-052 Phase 4): the parser is gone, so decrypt() refuses
 * `v5:` payloads with LegacyV5FormatRemovedError. encrypt() stopped
 * producing it in A-02 (see KdfSaltUnavailableError).
 * v6 — same as v5 but keyed by a random PER-VAULT Argon2id salt that is
 * embedded in the payload (see setVaultKdfSalt / VAULT_KDF_SALT_BYTES).
 * v7 — v6 + the Argon2id PARAMETERS embedded in the payload (A-01) + the
 * payload's logical purpose authenticated as AES-GCM AAD (M-02).
 * The ONLY writable format; v6 and older are read-only.
 */

import {
  deriveArgon2idAesKey,
  deriveArgon2idAesKeyWithParams,
  deriveArgon2idHkdfBaseKey,
  deriveArgon2idHkdfBaseKeyWithParams,
  deriveArgon2idKey,
  getActiveArgon2Params,
  type Argon2Params,
} from "./argon2-kdf";
import { env } from "../env.config";

export const CRYPTO_ALGORITHM = "AES-GCM";

/**
 * Error thrown when a v5 legacy format read is blocked by the cutoff.
 *
 * ADR-052 Phase 3 requires this to be TYPED and ACTIONABLE: the caller must be
 * able to tell it apart from a wrong password (retrying cannot help) and the
 * message must say what to do. The stable `V5_LEGACY_FORMAT_RETIRED` token is
 * what survives the Worker boundary, where the error class is reduced to its
 * message (same contract as KdfSaltUnavailableError.CODE).
 */
export class LegacyV5FormatRemovedError extends Error {
  static readonly CODE = "V5_LEGACY_FORMAT_RETIRED";
  readonly code = LegacyV5FormatRemovedError.CODE;

  constructor(detail?: string) {
    super(
      `[${LegacyV5FormatRemovedError.CODE}] This data was encrypted with the ` +
        "retired v5 legacy format (one bundle-wide Argon2id salt), which this " +
        "build refuses to read. Re-entering the password cannot help. " +
        "Actionable remedies: (1) open it with an older release that still " +
        "supports v5, unlock, and re-export/restore so the data is rewritten " +
        "as v7; or (2) restore a backup exported by a current build. " +
        "See ADR-052." +
        (detail ? ` (${detail})` : ""),
    );
    this.name = "LegacyV5FormatRemovedError";
  }
}

/**
 * Recognises the retired-v5 refusal across boundaries that lose the class:
 * Worker error serialisation, DB error classification and wrapped `cause`
 * chains. Matches the name, the stable code or the message token so a caller
 * can decide to show the remedy instead of "invalid password".
 */
export function isLegacyV5FormatRemovedError(error: unknown): boolean {
  if (typeof error === "string") {
    return error.includes(LegacyV5FormatRemovedError.CODE);
  }
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    if (candidate.name === "LegacyV5FormatRemovedError") {return true;}
    if (candidate.code === LegacyV5FormatRemovedError.CODE) {return true;}
    if (
      typeof candidate.message === "string" &&
      candidate.message.includes(LegacyV5FormatRemovedError.CODE)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * Thrown when a write is attempted with no per-vault Argon2id salt installed.
 *
 * `encrypt()` used to degrade to a `v5:` payload in that state, keyed by
 * the fixed bundle-wide salt. `decrypt()` rejects `v5:` by default
 * (LegacyV5FormatRemovedError), so the degraded payload was persisted
 * successfully and could never be read back — silent, permanent loss of
 * whatever secret it wrapped (API key, recovery data, encrypted DB key).
 *
 * Encryption now fails closed instead: nothing is persisted, the previous
 * value survives, and the caller learns that the vault is not writable yet.
 * Decryption of existing `v5:` blobs is unaffected (still gated by the
 * migration switch), so legacy data and rollbacks keep working.
 */
export class KdfSaltUnavailableError extends Error {
  /** Stable token for logs and for worker-error round-trips (which drop `name`). */
  static readonly CODE = "KDF_SALT_UNAVAILABLE";
  readonly code = KdfSaltUnavailableError.CODE;

  constructor(detail?: string) {
    super(
      `[${KdfSaltUnavailableError.CODE}] Refusing to encrypt without a per-vault ` +
        "Argon2id salt: the payload would be a legacy v5: blob, which decrypt() " +
        "rejects by default. Provision the vault KDF salt before writing" +
        (detail ? ` (${detail})` : ""),
    );
    this.name = "KdfSaltUnavailableError";
  }
}

// ─── Session-key master-key cache ───────────────────────────────────
//
// Argon2id runs ONCE per password to derive a session master key.
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
const MAX_MASTER_KEY_CACHE_ENTRIES = 12;

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
 * Per-vault Argon2id salt (A-1 mitigation). `null` = no salt installed: only
 * READS of pre-existing `v5:` blobs may use the fixed bundle-wide salt;
 * `encrypt()` refuses to write in that state (A-02) rather than producing a
 * payload the app cannot decrypt. Set once per vault by the security vault
 * (src/services/security-vault/kdf-salt.ts) from a random value persisted in
 * SecureStorage.
 */
let vaultKdfSalt: Uint8Array | null = null;

/** Length of the per-vault Argon2id salt, in bytes. */
export const VAULT_KDF_SALT_BYTES = 16;

const HEX_SALT_RE = /^[0-9a-f]{32}$/;

// ─── v7 envelope ────────────────────────────────────────────────────
//
// the Argon2id parameters a payload was written with travel INSIDE it.
// Before v7 they were resolved from the device/profile at open time, so a blob
// written on a desktop (128 MiB) and opened on a phone (64 MiB) derived a
// different key and the app reported "wrong password".
//
// the logical identity of the payload (its "purpose") is authenticated
// as AES-GCM additional data, so a ciphertext cannot be moved to another slot
// (`encrypted_api_key` → `encrypted_db_key`) and still decrypt.
//
// Wire format (after the `v7:` prefix):
// byte 0 params version (1)
// bytes 1..4 m, memory cost in KiB (u32 big-endian)
// bytes 5..8 t, iterations (u32 big-endian)
// byte 9 p, parallelism
// byte 10 dkLen, Argon2id output length in bytes
// bytes 11..27 per-vault Argon2id salt (16)
// bytes 27..43 per-operation HKDF salt (16)
// bytes 43..55 IV (12)
// bytes 55.. ciphertext || GCM tag
//
// Nothing else needs authenticating: m/t/p/salt feed the KDF and the IV feeds
// GCM, so tampering with any of them fails the tag.
export const V7_PARAMS_VERSION = 1;
const V7_HEADER_BYTES = 11;
const V7_HKDF_INFO = "bmf-v7-op-key";
const V7_AAD_PREFIX = "bmf-v7";
const V7_IV_BYTES = 12;
const V7_MIN_PAYLOAD_BYTES =
  V7_HEADER_BYTES + VAULT_KDF_SALT_BYTES + 16 + V7_IV_BYTES + 16;

/** Structural bounds accepted from a v7 payload's KDF parameters. */
const KDF_M_MIN_KIB = 8_192;
const KDF_M_MAX_KIB = 4 * 1024 * 1024; // 4 GiB cap: refuses an allocation attack
const KDF_T_MAX = 64;
const KDF_P_MAX = 16;
/**
 * Production floor. A payload may not ask for less than the weakest profile
 * this codebase ships, so a crafted blob cannot talk the reader into a cheap
 * derivation. Tests run below it (the test profile is 8 MiB / t=1) and are
 * exempt because `env.isProd` is false there.
 */
const KDF_M_PROD_FLOOR_KIB = 65_536;
const KDF_T_PROD_FLOOR = 3;

/** Options that shape (and later authenticate) a v7 payload. */
export interface EnvelopeOptions {
  /**
   * Logical identity of the plaintext (`secure-storage:encrypted_api_key`,
   * `row:bookmarks:title`, …), authenticated as AAD. A payload written for one
   * purpose cannot be decrypted as another. Omitted → the empty purpose.
   *
   * v6 and older payloads were written with NO additional data, so a purpose
   * passed while decrypting them is ignored (they cannot be retroactively
   * bound). Use `hasEmbeddedVaultSalt`/the prefix to know which format you
   * have; `encrypt` only ever writes v7.
   */
  purpose?: string;
}

/** A payload asked for KDF parameters this build refuses to run. */
export class KdfParamsUnsupportedError extends Error {
  /** Stable token for logs and worker-error round-trips (which drop `name`). */
  static readonly CODE = "KDF_PARAMS_UNSUPPORTED";
  readonly code = KdfParamsUnsupportedError.CODE;

  constructor(reason: string) {
    super(`[${KdfParamsUnsupportedError.CODE}] ${reason}`);
    this.name = "KdfParamsUnsupportedError";
  }
}

/**
 * True for payloads that carry their own per-vault Argon2id salt (`v6:`/`v7:`).
 * Used by migration code that must not re-wrap an already self-describing blob.
 */
export function hasEmbeddedVaultSalt(payload: string): boolean {
  return payload.startsWith("v6:") || payload.startsWith("v7:");
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function readUint32(source: Uint8Array, offset: number): number {
  return (
    ((source[offset]! << 24) |
      (source[offset + 1]! << 16) |
      (source[offset + 2]! << 8) |
      source[offset + 3]!) >>>
    0
  );
}

function encodeV7Header(params: Argon2Params): Uint8Array {
  const header = new Uint8Array(V7_HEADER_BYTES);
  header[0] = V7_PARAMS_VERSION;
  writeUint32(header, 1, params.m);
  writeUint32(header, 5, params.t);
  header[9] = params.p;
  header[10] = params.dkLen;
  return header;
}

/**
 * Rejects parameters this build will not run. Crypto correctness (the tag)
 * already prevents a forged payload from decrypting; this bounds the WORK a
 * payload can ask for (an Argon2 allocation of 2^22 KiB would be a trivial
 * resource-exhaustion attack) and keeps a production vault from being
 * downgraded to a weak derivation.
 */
function assertSupportedKdfParams(
  params: Argon2Params,
  version: number,
): void {
  const fail = (reason: string): never => {
    throw new KdfParamsUnsupportedError(`params v${version}: ${reason}`);
  };
  if (!Number.isInteger(params.m) || params.m < KDF_M_MIN_KIB || params.m > KDF_M_MAX_KIB) {
    fail(`memory cost ${params.m} KiB is outside ${KDF_M_MIN_KIB}..${KDF_M_MAX_KIB}`);
  }
  if (!Number.isInteger(params.t) || params.t < 1 || params.t > KDF_T_MAX) {
    fail(`iteration count ${params.t} is outside 1..${KDF_T_MAX}`);
  }
  if (!Number.isInteger(params.p) || params.p < 1 || params.p > KDF_P_MAX) {
    fail(`parallelism ${params.p} is outside 1..${KDF_P_MAX}`);
  }
  if (params.dkLen !== 32) {
    fail(`derived key length ${params.dkLen} is not 32`);
  }
  if (
    env.isProd === true &&
    (params.m < KDF_M_PROD_FLOOR_KIB || params.t < KDF_T_PROD_FLOOR)
  ) {
    fail(
      `m=${params.m}/t=${params.t} is below the production floor ` +
        `(m>=${KDF_M_PROD_FLOOR_KIB}, t>=${KDF_T_PROD_FLOOR})`,
    );
  }
}

/** AAD binding the plaintext to its logical slot. */
function purposeAad(purpose: string | undefined): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${V7_AAD_PREFIX}|${purpose ?? ""}`);
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bytesToHex(bytes: Uint8Array): string {
  // Optimized: single loop without intermediate array
  const hex = new Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    hex[i * 2] = (b >> 4).toString(16);
    hex[i * 2 + 1] = (b & 0xf).toString(16);
  }
  return hex.join("");
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
 * key derived under a different one. Pass `null` to return to legacy
 * read-only mode (used by tests and by code paths that have no vault salt —
 * e.g. a locked vault whose storage is unreadable): existing `v5:` blobs stay
 * decryptable, but `encrypt()` fails closed with KdfSaltUnavailableError
 * instead of writing more of them (A-02).
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
    // Optimized: single loop without substring allocations
    for (let i = 0; i < bytes.length; i++) {
      const hi = parseInt(normalized[i * 2]!, 16);
      const lo = parseInt(normalized[i * 2 + 1]!, 16);
      bytes[i] = (hi << 4) | lo;
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

/**
 * Per-session random key for the master-key cache's password tag.
 *
 * M4 (2026-10-20 audit): the tag used to be a bare SHA-256 of the password.
 * That made a process-memory dump a fast offline verifier for the master
 * password — cheaper than the Argon2id the vault is built around. Keying the
 * tag with a random per-session secret keeps the cache's equality check while
 * making the stored tag useless once the process is gone.
 */
let cacheTagKeyPromise: Promise<CryptoKey> | null = null;

async function computeCacheTag(passwordBytes: Uint8Array): Promise<Uint8Array> {
  cacheTagKeyPromise ??= crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const key = await cacheTagKeyPromise;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    passwordBytes as Uint8Array<ArrayBuffer>,
  );
  return new Uint8Array(signature);
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

/**
 * Cache identity of a master key. Parameters are part of it: since v7 the same
 * (purpose, salt) can legitimately appear with several KDF profiles (a vault
 * written on a phone and one written on a desktop), and returning a key
 * derived under the wrong profile would be indistinguishable from a wrong
 * password.
 */
function cacheKey(
  purpose: "session" | "v5" | "v7",
  salt: Uint8Array | null,
  params?: Argon2Params,
): string {
  const base = `${purpose}:${salt ? bytesToHex(salt) : LEGACY_SALT_TAG}`;
  return params
    ? `${base}:${params.m}:${params.t}:${params.p}:${params.dkLen}`
    : base;
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
  purpose: "session" | "v5" | "v7",
  context: string,
  passwordBytes: Uint8Array,
  salt: Uint8Array | null,
  params?: Argon2Params,
): Promise<CryptoKey> {
  const key = cacheKey(purpose, salt, params);
  const passwordTag = await computeCacheTag(passwordBytes);
  const cached = takeCachedMasterKey(key, passwordTag);
  if (cached) {
    passwordTag.fill(0);
    return cached;
  }
  // HKDF base key (deriveKey usage) — not an AES-GCM key.
  try {
    const argonSalt = await deriveContextSalt(context, salt);
    // v7 carries its own parameters; session-key and legacy v5/v6 derivations
    // keep using the build's active profile (that is exactly the A-01 bug, and
    // it stays confined to the read-only formats).
    const derived = params
      ? await deriveArgon2idHkdfBaseKeyWithParams(
          passwordBytes,
          argonSalt,
          params,
        )
      : await deriveArgon2idHkdfBaseKey(passwordBytes, argonSalt);
    // SECURITY: Clone passwordTag before storing in cache to prevent memory leak.
    // The local buffer is zeroized immediately after; the cache holds its own copy.
    const passwordTagCopy = passwordTag.slice();
    passwordTag.fill(0);
    storeCachedMasterKey(key, {
      passwordTag: passwordTagCopy,
      key: derived,
      expiresAt: Date.now() + SESSION_KEY_CACHE_TTL_MS,
    });
    return derived;
  } catch (error) {
    passwordTag.fill(0);
    // Preserve the cause: the previous generic rethrow hid whether the failure
    // was Argon2, HKDF or a missing environment (M5). Callers can still rely on
    // the stable prefix, and diagnostics keep the real reason.
    throw new Error("[crypto-core] Master key derivation failed", {
      cause: error,
    });
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
 * v7 master key: Argon2id with the payload's own parameters, domain-separated
 * from the v5/v6 derivation so a blob can never be re-interpreted across
 * formats.
 */
async function getV7MasterKey(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<CryptoKey> {
  return deriveCachedMasterKey(
    "v7",
    "bookmarkforge-v7-master-key",
    passwordBytes,
    salt,
    params,
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

/**
 * Domain-separated HMAC key derived from the master password: Argon2id once
 * (cached session base key) + HKDF with a caller-chosen `info` context.
 *
 * Used for cross-context authentication (e.g. the BroadcastChannel bridge)
 * where the raw password bytes must NEVER be imported directly as the HMAC
 * key — that would let a same-origin observer brute-force the master password
 * at SHA-256 speed, bypassing Argon2id entirely.
 */
export async function deriveDomainHmacKey(
  passwordBytes: Uint8Array,
  info: string,
): Promise<CryptoKey> {
  const baseKey = await deriveCachedMasterKey(
    "session",
    "bookmarkforge-domain-hmac",
    passwordBytes,
    null,
  );
  return await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: { name: "SHA-256" },
      // RFC 5869: an absent salt defaults to HashLen zero bytes — spell it
      // out because WebCrypto implementations (Node's, and stricter
      // browsers) reject an HKDF params object without `salt`.
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(info),
    },
    baseKey,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign", "verify"],
  );
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
 * @param onReuse - Optional reuse-warning sink (e.g. the app logger). Defaults
 * to `console.warn`, so the worker-side callers keep their existing behaviour.
 * @returns The same buffer (now zero-filled) for chaining.
 */
export function zeroPasswordBytes(
  bytes: Uint8Array,
  onReuse?: (message: string) => void,
): Uint8Array {
  // Fail-closed: detect reuse before the fill so we can warn even though
  // the buffer is about to become all-zeros anyway.
  if (bytes.length > 0 && bytes.every((b) => b === 0)) {
    const message =
      "[zeroPasswordBytes] Buffer is already zeroized — possible reuse of a consumed password. " +
      "Callers must pass a fresh copy if the bytes are needed after a crypto operation.";
    if (onReuse) {
      onReuse(message);
    } else {
      console.warn(message);
    }
  }
  // Max-effort zeroization (ADR): fill(0) → XOR 0xAA → fill(0) defeats
  // compiler elision, matching EncryptionService.zeroBytes.
  bytes.fill(0);
  for (let i = 0; i < bytes.length; i++) { bytes[i] = bytes[i]! ^ 0xAA; }
  bytes.fill(0);
  return bytes;
}

/**
 * Encrypts `text` with `password`, always returning a `v7:`-prefixed payload.
 *
 * Wire format: see the v7 block above (params ‖ vault salt ‖ HKDF salt ‖ IV ‖
 * ciphertext). There is no other writable format: v6 and older are read-only.
 *
 * throws KdfSaltUnavailableError when no per-vault KDF salt is
 * installed. The `v5:` write path is gone on purpose — `decrypt()` rejects
 * `v5:` by default, so emitting one meant persisting a secret nobody (not even
 * this session) could read back. Every caller that reaches here without a salt
 * is in a provisioning failure; failing the write keeps the previous value
 * intact and surfaces the real problem.
 *
 * The vault salt AND the KDF parameters are embedded, so every payload is
 * self-describing: decryption never depends on the local device/profile, which
 * is what makes cross-device shares, backups and restores work (A-01).
 *
 * `options.purpose` is bound as AES-GCM additional data (M-02): the same
 * ciphertext in a different slot fails authentication instead of decrypting to
 * a plausible-but-wrong secret.
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
  options?: EnvelopeOptions,
): Promise<string> {
  // v7: Argon2id-once + HKDF per operation. The master key is cached per
  // (password, salt, params) so subsequent encryptions with the same password
  // and profile skip the expensive Argon2id derivation entirely.
  const vaultSalt = vaultKdfSalt;
  // fail closed BEFORE deriving anything or touching the caller's
  // password buffer — a refused write must not consume the credential.
  if (!vaultSalt) {
    throw new KdfSaltUnavailableError();
  }
  const params = getActiveArgon2Params();
  const hkdfSalt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(V7_IV_BYTES));
  const encoder = new TextEncoder();
  const pwBytes = getPasswordBytes(password);
  let masterKey: CryptoKey;
  try {
    masterKey = await getV7MasterKey(pwBytes, vaultSalt, params);
  } finally {
    // Argon2id/HKDF can reject before the normal post-derivation cleanup.
    // Clear the caller-owned bytes on both success and failure. Uses the
    // max-effort zeroizer (double fill + XOR + reuse guard) so the documented
    // ownership contract in AGENTS §2 holds for the primitives too (M6).
    zeroPasswordBytes(pwBytes);
  }

  const opKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: hkdfSalt as Uint8Array<ArrayBuffer>,
      info: new TextEncoder().encode(V7_HKDF_INFO),
      hash: "SHA-256",
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: CRYPTO_ALGORITHM,
      iv,
      additionalData: purposeAad(options?.purpose),
    },
    opKey,
    encoder.encode(text),
  );

  const header = encodeV7Header(params);
  const headerLength =
    V7_HEADER_BYTES + VAULT_KDF_SALT_BYTES + 16 + V7_IV_BYTES;
  const combined = new Uint8Array(headerLength + ciphertext.byteLength);
  combined.set(header, 0);
  combined.set(vaultSalt, V7_HEADER_BYTES);
  combined.set(hkdfSalt, V7_HEADER_BYTES + VAULT_KDF_SALT_BYTES);
  combined.set(
    iv,
    V7_HEADER_BYTES + VAULT_KDF_SALT_BYTES + 16,
  );
  combined.set(new Uint8Array(ciphertext), headerLength);

  return "v7:" + u8aToBase64(combined);
}

/**
 * Opens a v7 payload. The KDF parameters and the per-vault salt come from the
 * payload itself (A-01); `purpose` must be the one it was written with, since
 * it is authenticated as additional data (M-02).
 *
 * A wrong purpose and a wrong password are indistinguishable here on purpose:
 * both are AES-GCM authentication failures, and an oracle that told them apart
 * would leak whether a slot guess was right.
 */
async function decryptV7(
  payloadBase64: string,
  password: string | Uint8Array,
  purpose: string | undefined,
): Promise<string> {
  const combined = base64ToU8a(payloadBase64);
  if (combined.length < V7_MIN_PAYLOAD_BYTES) {
    throw new Error("[crypto-core] Malformed v7 payload: truncated header");
  }

  const version = combined[0]!;
  if (version !== V7_PARAMS_VERSION) {
    throw new KdfParamsUnsupportedError(
      `unsupported params version ${version} (this build reads v${V7_PARAMS_VERSION})`,
    );
  }
  const params: Argon2Params = {
    m: readUint32(combined, 1),
    t: readUint32(combined, 5),
    p: combined[9]!,
    dkLen: combined[10]!,
  };
  assertSupportedKdfParams(params, version);

  const saltStart = V7_HEADER_BYTES;
  const hkdfStart = saltStart + VAULT_KDF_SALT_BYTES;
  const ivStart = hkdfStart + 16;
  const ciphertextStart = ivStart + V7_IV_BYTES;
  const vaultSalt = combined.slice(saltStart, hkdfStart);
  const hkdfSalt = combined.slice(hkdfStart, ivStart);
  const iv = combined.slice(ivStart, ciphertextStart);
  const ciphertext = combined.slice(ciphertextStart);

  const pwBytes = getPasswordBytes(password);
  let masterKey: CryptoKey;
  try {
    masterKey = await getV7MasterKey(pwBytes, vaultSalt, params);
  } finally {
    zeroPasswordBytes(pwBytes);
  }

  const opKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: hkdfSalt as Uint8Array<ArrayBuffer>,
      info: new TextEncoder().encode(V7_HKDF_INFO),
      hash: "SHA-256",
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const decrypted = await crypto.subtle.decrypt(
    {
      name: CRYPTO_ALGORITHM,
      iv: iv as Uint8Array<ArrayBuffer>,
      additionalData: purposeAad(purpose),
    },
    opKey,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Decrypts a `v7:`/`v6:`/`v5:`/`v4:`/`v2:` payload with `password`.
 *
 * `v7:` and `v6:` carry their own per-vault salt, so they decrypt with the
 * password from any device/session regardless of the locally provisioned salt.
 * Only `v7:` also carries its KDF parameters and binds a purpose (AAD). `v5:`
 * and older formats keep using the legacy fixed-salt/Argon2id-per-op
 * derivations.
 *
 * Ownership contract: same as `encrypt` — a `Uint8Array` password is
 * CONSUMED (zeroized via `zeroPasswordBytes` after key derivation) and
 * must not be reused by the caller.
 */
export async function decrypt(
  encryptedBase64: string,
  password: string | Uint8Array,
  options?: EnvelopeOptions,
): Promise<string> {
  if (encryptedBase64.startsWith("v7:")) {
    return await decryptV7(
      encryptedBase64.substring(3),
      password,
      options?.purpose,
    );
  }

  // v6 and older were written with NO additional data, so `options.purpose`
  // does not apply to them (it cannot be retroactively bound).
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
      zeroPasswordBytes(pwBytes);
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
    // ADR-052 Phase 4: the v5 parser is REMOVED. The format is not readable by
    // any build of this codebase; the blob has to be converted by an older
    // release (Phase 3 kept a bridge flag, Phase 4 deleted both). Throw the
    // typed, actionable error rather than letting it fall through to the
    // generic "unsupported format" message.
    throw new LegacyV5FormatRemovedError();
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
      zeroPasswordBytes(pwBytes);
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
    // a) Colon-separated: v2:<base64(salt)>:<base64(iv)>:<base64(ciphertext)>
    // b) Concatenated: v2:<base64(salt||iv||ciphertext)>
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
      zeroPasswordBytes(pwBytes);
    }
  }

  throw new Error("Unsupported encryption format — expected v7:, v6:, v5:, v4: or v2:");
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
 * 0x06 || vault_salt(16) || hkdf_salt(16) || iv(12) || ciphertext
 * Wire format (legacy, no vault salt):
 * hkdf_salt(16) || iv(12) || ciphertext
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
  // derive the session master key via Argon2id ONCE (cached per
  // password). Per-operation keys are derived from it via HKDF-SHA256,
  // which is ~1000× faster than a fresh Argon2id per operation.
  const vaultSalt = vaultKdfSalt;
  if (!vaultSalt) {
    // ADR-052 Phase 4: the legacy session layout (bundle-wide salt, no marker)
    // is no longer readable, so writing it would create data this build can
    // never open. Fail closed on write instead (same contract as encrypt(),
    // A-02): nothing is persisted and the caller learns the vault is not
    // writable yet.
    throw new KdfSaltUnavailableError("session-key write");
  }
  const hkdfSalt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pwBytes = getPasswordBytes(password);
  let masterKey: CryptoKey;
  try {
    masterKey = await getSessionMasterKey(pwBytes, vaultSalt);
  } finally {
    zeroPasswordBytes(pwBytes);
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

  // Wire format: 0x06 || vault_salt(16) || hkdf_salt(16) || iv(12) || ct
  const headerLength = 1 + vaultSalt.length + 16 + 12;
  const combined = new Uint8Array(headerLength + ciphertext.byteLength);
  combined[0] = SESSION_V6_MARKER;
  combined.set(vaultSalt, 1);
  const offset = 1 + vaultSalt.length;
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
  // ADR-052 Phase 4: the legacy (pre-marker, bundle-wide-salt) session layout
  // is gone. A blob without the v6 marker is retired-format data, not a v7
  // payload with a corrupt header, so it fails with the typed, actionable
  // error instead of a generic authentication failure.
  const owned = password instanceof Uint8Array ? password : null;
  const attempt = (): string | Uint8Array => (owned ? owned.slice() : (password as string));
  try {
    if (
      !(
        data.length > 1 + VAULT_KDF_SALT_BYTES + 28 &&
        data[0] === SESSION_V6_MARKER
      )
    ) {
      throw new LegacyV5FormatRemovedError();
    }
    const vaultSalt = data.slice(1, 1 + VAULT_KDF_SALT_BYTES);
    const hkdfSalt = data.slice(1 + VAULT_KDF_SALT_BYTES, 1 + VAULT_KDF_SALT_BYTES + 16);
    const iv = data.slice(1 + VAULT_KDF_SALT_BYTES + 16, 1 + VAULT_KDF_SALT_BYTES + 28);
    const ciphertext = data.slice(1 + VAULT_KDF_SALT_BYTES + 28);
    return await decryptSessionPayload(
      ciphertext,
      iv,
      hkdfSalt,
      vaultSalt,
      attempt(),
    );
  } finally {
    // Ownership contract unchanged: a Uint8Array password is consumed (and
    // warned about if already zero) exactly once, by this call.
    if (owned) {zeroPasswordBytes(owned);}
  }
}

/** Shared body of the session-key decrypt path (v7-era marker layout). */
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
    zeroPasswordBytes(pwBytes);
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

// ─── Portable binary container (BMF2) ───────────────────────────────
//
// encrypted `.bmf` backups used to be
// `salt(16) || iv(12) || ciphertext` with NO Argon2id parameters, so the reader
// re-derived with its LOCAL profile (128 MiB on desktop, 64 MiB on mobile) and
// reported "wrong password" for a file written on the other class of device —
// exactly the situation a backup exists for. The container now carries the
// parameters, mirroring the v7 string envelope (A-01) for the same reason.
//
// Wire format (byte offsets):
// 0..3 magic "BMF2" (0x42 0x4d 0x46 0x32)
// 4 params version (1)
// 5..8 m, memory cost in KiB (u32 big-endian)
// 9..12 t, iterations (u32 big-endian)
// 13 p, parallelism
// 14 dkLen, Argon2id output length in bytes
// 15..30 Argon2id salt (16)
// 31..42 IV (12)
// 43.. ciphertext || GCM tag
//
// Nothing else needs authenticating: m/t/p/salt feed the KDF and the IV feeds
// GCM, so tampering with any of them fails the tag.
const BINARY_MAGIC = new Uint8Array([0x42, 0x4d, 0x46, 0x32]); // "BMF2"
const BINARY_MAGIC_BYTES = 4;
const BINARY_PARAMS_VERSION = 1;
const BINARY_PARAMS_OFFSET = BINARY_MAGIC_BYTES + 1; // 5
const BINARY_HEADER_BYTES = BINARY_PARAMS_OFFSET + 10; // 15
const BINARY_SALT_BYTES = 16;
const BINARY_IV_BYTES = 12;
const BINARY_PREFIX_BYTES =
  BINARY_HEADER_BYTES + BINARY_SALT_BYTES + BINARY_IV_BYTES; // 43
/** Legacy (pre-BMF2) container: salt || iv || ciphertext. */
const LEGACY_BINARY_PREFIX_BYTES = 16 + 12;

function hasBinaryParamsHeader(payload: Uint8Array): boolean {
  if (payload.length < BINARY_PREFIX_BYTES) {return false;}
  for (let i = 0; i < BINARY_MAGIC_BYTES; i++) {
    if (payload[i] !== BINARY_MAGIC[i]) {return false;}
  }
  return true;
}

/**
 * Encrypts binary `data` into the portable BMF2 container.
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
  const params = getActiveArgon2Params();
  const salt = crypto.getRandomValues(new Uint8Array(BINARY_SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(BINARY_IV_BYTES));
  const pwBytes = getPasswordBytes(password);
  let key: CryptoKey;
  try {
    key = await deriveArgon2idAesKeyWithParams(pwBytes, salt, params);
  } finally {
    zeroPasswordBytes(pwBytes);
  }

  const ciphertext = await crypto.subtle.encrypt(
    { name: CRYPTO_ALGORITHM, iv },
    key,
    data as Uint8Array<ArrayBuffer>,
  );

  const combined = new Uint8Array(BINARY_PREFIX_BYTES + ciphertext.byteLength);
  combined.set(BINARY_MAGIC, 0);
  combined[BINARY_MAGIC_BYTES] = BINARY_PARAMS_VERSION;
  writeUint32(combined, BINARY_PARAMS_OFFSET, params.m);
  writeUint32(combined, BINARY_PARAMS_OFFSET + 4, params.t);
  combined[BINARY_PARAMS_OFFSET + 8] = params.p;
  combined[BINARY_PARAMS_OFFSET + 9] = params.dkLen;
  combined.set(salt, BINARY_HEADER_BYTES);
  combined.set(iv, BINARY_HEADER_BYTES + BINARY_SALT_BYTES);
  combined.set(new Uint8Array(ciphertext), BINARY_PREFIX_BYTES);
  return combined;
}

/**
 * Decrypts a binary payload written by `encryptBinary`.
 *
 * Reads BOTH containers: BMF2 (self-describing — the Argon2id parameters come
 * from the file, so it opens on any device profile) and the legacy
 * `salt || iv || ciphertext` layout, which has no parameters and therefore can
 * only be opened by a device using the profile it was written with.
 *
 * Ownership contract: same as `encryptBinary` — a `Uint8Array` password
 * is CONSUMED (zeroized via `zeroPasswordBytes` after key derivation)
 * and must not be reused by the caller.
 */
export async function decryptBinary(
  combined: Uint8Array,
  password: string | Uint8Array,
): Promise<Uint8Array> {
  let params: Argon2Params;
  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;

  if (hasBinaryParamsHeader(combined)) {
    const version = combined[BINARY_MAGIC_BYTES]!;
    if (version !== BINARY_PARAMS_VERSION) {
      throw new KdfParamsUnsupportedError(
        `binary envelope: unsupported params version ${version} (this build reads v${BINARY_PARAMS_VERSION})`,
      );
    }
    params = {
      m: readUint32(combined, BINARY_PARAMS_OFFSET),
      t: readUint32(combined, BINARY_PARAMS_OFFSET + 4),
      p: combined[BINARY_PARAMS_OFFSET + 8]!,
      dkLen: combined[BINARY_PARAMS_OFFSET + 9]!,
    };
    // Same bounds as the v7 read path: a payload may not talk this build into
    // an unbounded Argon2 allocation or a downgraded derivation.
    assertSupportedKdfParams(params, version);
    const saltStart = BINARY_HEADER_BYTES;
    const ivStart = saltStart + BINARY_SALT_BYTES;
    salt = combined.slice(saltStart, ivStart);
    iv = combined.slice(ivStart, BINARY_PREFIX_BYTES);
    ciphertext = combined.slice(BINARY_PREFIX_BYTES);
  } else {
    if (combined.length <= LEGACY_BINARY_PREFIX_BYTES) {
      throw new Error(
        "[crypto-core] Malformed binary payload: truncated header",
      );
    }
    // Legacy container: no parameters inside, so the local profile decides.
    params = getActiveArgon2Params();
    salt = combined.slice(0, 16);
    iv = combined.slice(16, LEGACY_BINARY_PREFIX_BYTES);
    ciphertext = combined.slice(LEGACY_BINARY_PREFIX_BYTES);
  }

  const pwBytes = getPasswordBytes(password);
  let key: CryptoKey;
  try {
    key = await deriveArgon2idAesKeyWithParams(pwBytes, salt, params);
  } finally {
    zeroPasswordBytes(pwBytes);
  }

  const decrypted = await crypto.subtle.decrypt(
    { name: CRYPTO_ALGORITHM, iv: iv as Uint8Array<ArrayBuffer> },
    key,
    ciphertext as Uint8Array<ArrayBuffer>,
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
  // SECURITY: Validate salt length to prevent potential DoS or memory issues // i18n-allow: DoS is a technical acronym
  // with extremely long salts. SHA-256 handles long inputs well, but a reasonable
  // bound (1024 chars) prevents abuse while being more than sufficient for
  // deterministic key derivation.
  if (salt.length > 1024) {
    throw new Error("Salt too long (max 1024 characters)");
  }

  const encoder = new TextEncoder();
  const pwBytes = getPasswordBytes(password);
  const saltBytes = encoder.encode(salt);
  // Argon2id requires a salt of at least 8 bytes. Hash the user-provided salt
  // with SHA-256 to obtain a deterministic 32-byte salt that satisfies the constraint.
  let rawKey: Uint8Array;
  try {
    const saltHash = await crypto.subtle.digest("SHA-256", saltBytes);
    rawKey = await deriveArgon2idKey(pwBytes, new Uint8Array(saltHash));
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
  } finally {
    zeroPasswordBytes(pwBytes);
  }
}

export function generateSecureSalt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
