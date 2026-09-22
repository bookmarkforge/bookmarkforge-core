/**
 * RxDB database initialization and lifecycle management for BookmarkForge.
 * ADR-019: Argon2id migration / Security hardening (encrypted database)
 *
 * Handles: storage backend selection (Dexie/IndexedDB → Memory fallback),
 * mandatory AES-256-GCM encryption via PBKDF2-derived keys, schema migration,
 * collection creation, and retry logic for slow environments.
 *
 * The database singleton is created once via {@link initDB} and reused
 * across the application. Password-protected databases decrypt the
 * storage key from IndexedDB on each startup.
 *
 * @example
 * ```ts
 * const db = await initDB('user_password');
 * const bookmarks = await db.bookmarks.find().exec();
 * ```
 */
import { createRxDatabase, addRxPlugin, RxDatabase } from "rxdb";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { createRxStorage } from "../utils/rxdbStorage";
import { wrappedKeyEncryptionCryptoJsStorage } from "rxdb/plugins/encryption-crypto-js";
import { wrappedValidateZSchemaStorage } from "rxdb/plugins/validate-z-schema";
import { authenticatedEncryptionStorage } from "./authEncryptionStorage";
import {
  RxDBDevModePlugin,
  disableWarnings as disableRxDBWarnings,
} from "rxdb/plugins/dev-mode";
import { RxDBQueryBuilderPlugin } from "rxdb/plugins/query-builder";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { RxDBCleanupPlugin } from "rxdb/plugins/cleanup";
import { RxDBLeaderElectionPlugin } from "rxdb/plugins/leader-election";
import { secureStorage } from "../services/SecureStorage";
import { logger } from "../utils/logger";
import { encryptionService } from "../services/EncryptionService";
import { SECURE_STORAGE_KEYS } from "../services/SecurityVault";
import { DB_SALT_DESCRIPTOR } from "../services/security-vault/salt-registry";
import { DB_CONFIG } from "../constants/config";
import { safeGet, safeRemove } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";

import { COLLECTIONS } from "./database.core";
import { estimateExistingRows as estimateRows } from "./estimate-rows";
import {
  resetMigrationProgress,
  setVaultLoadingRows,
  updateCollectionMigrationProgress,
  type CollectionMigrationProgress,
} from "./migration-progress";
import type { BookmarkForgeDB } from "./types";
import type { BookmarkDocType } from "./schema";
import { licenseService, LicenseError } from "../services/LicenseService";
import { FREE_LIMITS } from "../constants/license";
export {
  defaultConflictHandler,
  migrationStrategies,
  COLLECTIONS,
} from "./database.core";
export type {
  ConflictHandlerInput,
  ConflictHandlerOutput,
  RxDatabaseWithMethods,
} from "./database.core";

// ─── Internal utilities (exported for testing) ──────────────────────
//
// NOTE: walkErrorChain, classifyDbError and redactKeyMaterial are
// exported inline with `export function` below. Do NOT add a separate
// `export { ... }` block — Vite/ESBuild rejects duplicate exports
// with a SyntaxError.

// NOTE: ErrorFrame is declared and exported inline below (export interface
// ErrorFrame) — do NOT re-export it here (TS2484 duplicate export).

// ─── Plugin registration (called at module load) ────────────────────

function registerRxDBPlugins(): void {
  if (import.meta.env.DEV || import.meta.env.MODE === "test") {
    try {
      // RxDB emits its informational banner while the plugin is registered,
      // so the test-only suppression must happen first. Validation itself
      // stays enabled; only the marketing/diagnostic banner is muted.
      if (import.meta.env.MODE === "test") {
        disableRxDBWarnings();
      }
      addRxPlugin(RxDBDevModePlugin);
    } catch (err) {
      logger.warn("[DB] Failed to add dev mode plugin", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    addRxPlugin(RxDBQueryBuilderPlugin);
  } catch (err) {
    logger.warn("[DB] Failed to add query builder plugin", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    addRxPlugin(RxDBMigrationSchemaPlugin);
  } catch (err) {
    logger.warn("[DB] Failed to add migration plugin", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    addRxPlugin(RxDBCleanupPlugin);
  } catch (err) {
    logger.warn("[DB] Failed to add cleanup plugin", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    addRxPlugin(RxDBLeaderElectionPlugin);
  } catch (err) {
    logger.warn("[DB] Failed to add leader election plugin", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
registerRxDBPlugins();

// ─── Module-level singleton state ───────────────────────────────────
//
// IMPORTANT: this singleton lives on globalThis, NOT module scope. Vite's
// dev server can instantiate this module more than once — the app's import
// graph uses HMR-timestamped URLs (/src/db/database.ts?t=...) while a
// page.evaluate() dynamic import uses the plain URL. Each copy would
// otherwise carry its own dbInstance/initPromise AND its own fresh Memory
// storage, so data written through one copy was invisible to the others
// (E2E-caught: vault-backup-flow exported 0 docs although the helper had
// inserted 1 bookmark). One page ⇒ one RxDatabase, period.

interface DbSingletonState {
  dbInstance: BookmarkForgeDB | null;
  initPromise: Promise<BookmarkForgeDB> | null;
  isDestroying: boolean;
  destroyPromise: Promise<void> | null;
  /** Storage backend that successfully initialized the DB (null before init). */
  activeBackend: "Dexie" | "Memory" | null;
  /** Duration of the last successful initDB call, in milliseconds. */
  initDurationMs: number | null;
  /** Number of backend attempts used by the last successful initialization. */
  initAttempts: number | null;
}

const DB_SINGLETON_KEY = "__bookmarkforge_db_singleton_v5__";

function getDbState(): DbSingletonState {
  const g = globalThis as Record<string, unknown>;
  let s = g[DB_SINGLETON_KEY] as DbSingletonState | undefined;
  if (!s) {
    s = {
      dbInstance: null,
      initPromise: null,
      isDestroying: false,
      destroyPromise: null,
      activeBackend: null,
      initDurationMs: null,
      initAttempts: null,
    };
    g[DB_SINGLETON_KEY] = s;
  }
  return s;
}

/**
 * Window key the e2e suite reads to assert the app booted on the durable
 * Dexie/IndexedDB backend. Exposed only in dev/test builds — a spec running
 * silently against the in-memory fallback makes every persistence/reload
 * assertion meaningless, so the suite must fail loudly instead.
 */
const E2E_STORAGE_BACKEND_KEY = "__bmf_active_storage_backend__";

type ActiveStorageBackend = "Dexie" | "Memory" | null;

function publishStorageBackend(backend: ActiveStorageBackend): void {
  // Dev/test builds always publish (E2E storage-backend guard). Production
  // builds only publish when built explicitly for the preview E2E
  // (VITE_E2E_PREVIEW_DIAGNOSTICS=true) — real production bundles ship
  // without this diagnostic hook.
  if (
    import.meta.env.PROD &&
    import.meta.env.VITE_E2E_PREVIEW_DIAGNOSTICS !== "true"
  ) {
    return;
  }  try {
    (globalThis as unknown as Record<string, unknown>)[E2E_STORAGE_BACKEND_KEY] =
      backend;
  } catch {
    /* Non-configurable globalThis — diagnostics only. */
  }
}

// ─── DB error classification ────────────────────────────────────────
//
// Why a custom classifier instead of `errStr.includes("DB1")`?
//
// The previous heuristic substring-matched the top-level error message for
// "DB1" (RxDB's "wrong-password" / encrypted-bulkWrite failure code). It
// over-fired when a disk-corruption error from the encryption wrapper
// happened to surface a DB1-named error in its message — locking users
// out of a vault whose password was actually correct. It also collapsed
// every non-DB1 failure into `throw err`, leaving the UI with no friendly
// fallback for "storage is unreachable / schema mismatch / IDB blocked".
//
// The new walker inspects `.code` on **every** Error in the cause chain
// (RxDB often wraps the underlying Dexie/DOMException under multiple
// layers). It also distinguishes DB1 (WRONG_PASSWORD) from DB3
// (INACCESSIBLE: corrupt IDB state, version mismatch, Dexie race with
// another tab) and falls back to INACCESSIBLE for anything else — so the
// UI gets a real signal even when RxDB emits a code we don't recognize.

export type DbErrorClass =
  | "WRONG_PASSWORD"
  | "VAULT_LOCKED"
  | "INACCESSIBLE"
  | "UNKNOWN";

// Hard cap on per-frame message length. A pathological Dexie error can
// include an entire failing row's worth of data; this cap prevents log
// flooding AND reduces the surface area for accidental data leakage.
const FRAME_MESSAGE_MAX = 500;

export interface ErrorFrame {
  message: string;
  code?: string;
  name?: string;
}

const CHAIN_DEPTH_LIMIT = 10;

/**
 * Walks the cause chain of a thrown value and returns one normalized
 * frame per Error in the chain. Handles `Error`, string, and plain-object
 * frames (RxDB / Dexie occasionally attach raw objects with `.code`)
 * because the throw site doesn't always wrap in a real Error. Cycle-safe
 * via WeakSet + depth limit so a pathological self-referential chain
 * can't blow the stack.
 *
 * Sensitive-leak guard: any frame whose message looks like it might be
 * carrying key material (long hex/base64 strings right next to the words
 * "key" / "password" / "secret") has the suspect span replaced with
 * '[REDACTED]' before logging. This is defence-in-depth — RxDB doesn't
 * normally include the actual password in its messages but the encryption
 * wrapper has been known to surface the derived key in some failure paths.
 * A second pass redacts any standalone run ≥ 40 chars (catches raw UUIDs,
 * Dexie primary keys, derived AES keys, etc.) since a hostile RxDB code
 * shape could position them without a keyword neighbour.
 *
 * Stack traces are deliberately NOT captured here — the inner
 * `createDBInstance` storage-backend loop already logs `errorObject`
 * per fallback. Capturing `stack` here would double-log the same stack.
 */
export function walkErrorChain(err: unknown, seen = new WeakSet<object>()): ErrorFrame[] {
  const frames: ErrorFrame[] = [];
  let current: unknown = err;
  let depth = 0;
  while (current !== undefined && current !== null && depth < CHAIN_DEPTH_LIMIT) {
    if (current instanceof Error) {
      if (seen.has(current)) {
        frames.push({ message: "[circular cause chain]", name: "Circular" });
        break;
      }
      seen.add(current);
      frames.push({
        message: capFrameMessage(redactKeyMaterial(current.message ?? "")),
        code: (current as { code?: string }).code,
        name: current.name,
      });
      const cause = (current as { cause?: unknown }).cause;
      if (cause === undefined) {
        break;
      }
      current = cause;
    } else if (typeof current === "string") {
      frames.push({ message: capFrameMessage(redactKeyMaterial(current)) });
      break;
    } else if (typeof current === "object") {
      const obj = current as {
        message?: string;
        code?: string;
        name?: string;
        cause?: unknown;
      };
      frames.push({
        message: capFrameMessage(
          redactKeyMaterial(obj.message ?? safeStringify(current)),
        ),
        code: obj.code,
        name: obj.name,
      });
      if (obj.cause === undefined) {
        break;
      }
      current = obj.cause;
    } else {
      // number / boolean / bigint / symbol / undefined — terminal leaf.
      frames.push({ message: capFrameMessage(String(current)) });
      break;
    }
    depth++;
  }
  return frames;
}

/**
 * Hard-caps a frame's message text to FRAME_MESSAGE_MAX. Applied AFTER
 * redaction so the `[REDACTED]` tokens themselves never get sliced in
 * half by the truncation ellipsis.
 */
function capFrameMessage(input: string): string {
  return input.length > FRAME_MESSAGE_MAX
    ? input.slice(0, FRAME_MESSAGE_MAX) + "\u2026"
    : input;
}

// Phase 1: keyword-anchored matched. Catches "password=..." / "key: ..." /
// "cipher:'...'" style runs of 32+ chars adjacent to a secret-ish word.
const KEYWORD_ANCHORED_REGEX =
  /(password|key|secret|token|cipher)\s*[:=]?\s*["']?([A-Za-z0-9+/=_-]{32,})["']?/gi;
// Phase 2: standalone long run. Catches UUIDs, derived AES keys, IDB
// row IDs, Dexie primary keys. 40+ chars so we don't redact typical
// English words or short identifiers.
const STANDALONE_LONG_RUN_REGEX = /\b[A-Za-z0-9+/=_-]{40,}\b/g;
export function redactKeyMaterial(input: string, maxLen = FRAME_MESSAGE_MAX): string {
  const phase1 = input.replace(
    KEYWORD_ANCHORED_REGEX,
    (_m, kw, _val) => `${kw}=[REDACTED]`,
  );
  const phase2 = phase1.replace(STANDALONE_LONG_RUN_REGEX, "[REDACTED]");
  // Hard cap so a single maliciously-large message can't flood the log.
  return phase2.length > maxLen ? phase2.slice(0, maxLen) + "\u2026" : phase2;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 1000);
  } catch {
    return "[unserializable object]";
  }
}

/**
 * Inspects the error chain and classifies it. Uses ONLY the `.code`
 * property of each Error frame — never the message — so a typo or a
 * disk-corruption message that incidentally contains "DB1" cannot
 * masquerade as WRONG_PASSWORD. Returns 'UNKNOWN' for any chain that
 * doesn't carry a recognized code; callers should treat UNKNOWN as
 * INACCESSIBLE for UI purposes (lost data / unexpected failure).
 *
 * Recognized codes:
 *   DB1 — wrong password (or empty password against an encrypted vault).
 *         Maps to WRONG_PASSWORD so the UI prompts for re-entry.
 *   DEVICE_KEY_WRAPPED — the vault is locked: the device key is wrapped
 *         by the master password and was not materialized this session.
 *         This is NOT a wrong password (the password may be correct);
 *         it means the vault must be unlocked first. Maps to VAULT_LOCKED
 *         so the UI does not show a misleading "Invalid password".
 *   DB3..DB9 — any other RxDB v15+ storage failure (corrupt IDB state,
 *         schema mismatch, cross-tab conflict, storage destroy in flight,
 *         leader-election failure). All map to INACCESSIBLE so the UI
 *         shows "Database inaccessible" (localized) and offers a recovery path.
 *
 * The raw `f.code` value is preserved on the thrown error's
 * `dbErrorCode` property so telemetry can spot common sub-cases later
 * without re-running the classifier. We deliberately do not maintain a
 * per-code sub-meaning table in source — the names RxDB assigns to
 * higher-numbered storage codes drift across versions and the precise
 * mapping is better tracked in the telemetry layer than pinned here.
 */
export function classifyDbError(frames: ErrorFrame[]): DbErrorClass {
  for (const f of frames) {
    // SecureStorage.getDeviceKey() tags the "vault is locked" error with
    // name=DEVICE_KEY_WRAPPED (no code property); recognize it by either.
    if (f.name === "DEVICE_KEY_WRAPPED" || f.code === "DEVICE_KEY_WRAPPED") {
      return "VAULT_LOCKED";
    }
    if (!f.code) continue;
    if (f.code === "DB1") return "WRONG_PASSWORD";
    if (/^DB[3-9]$/.test(f.code)) return "INACCESSIBLE";
  }
  return "UNKNOWN";
}

/**
 * Builds a tagged Error so the UI can branch on `.name` instead of
 * substring-matching on `.message`. Carries `dbErrorCode` for anyone who
 * wants the raw RxDB code (e.g., telemetry).
 */
function makeClassifiedError(
  name:
    | "INVALID_PASSWORD"
    | "VAULT_LOCKED"
    | "DB_INACCESSIBLE"
    | "DB_UNKNOWN",
  message: string,
  dbErrorCode?: string,
): Error {
  const e = new Error(message);
  e.name = name;
  if (dbErrorCode) {
    (e as Error & { dbErrorCode?: string }).dbErrorCode = dbErrorCode;
  }
  return e;
}

/**
 * Public type guards so consumers can branch without depending on the
 * exact message string or the dbErrorCode property layout.
 */
export function isInvalidDbPasswordError(err: unknown): boolean {
  return err instanceof Error && err.name === "INVALID_PASSWORD";
}

export function isDbInaccessibleError(err: unknown): boolean {
  return err instanceof Error && err.name === "DB_INACCESSIBLE";
}

export function isVaultLockedError(err: unknown): boolean {
  return err instanceof Error && err.name === "VAULT_LOCKED";
}

// ─── Extracted helpers ──────────────────────────────────────────────

/**
 * Best-effort teardown of an RxDB instance.
 *
 * RxDB v16 renamed the old `destroy()` API: `remove()` closes the instance
 * AND deletes its data from the underlying storage, while `close()` closes
 * the connection but keeps the data. Older versions expose `destroy()`
 * (close-only semantics). Never throws — callers use it for best-effort
 * cleanup.
 *
 * `removeData` controls whether the vault data survives the teardown:
 * - `removeData: true` (destroyDB — an explicit user wipe) prefers
 *   `remove()` so a subsequent init with a different password does not
 *   collide with stale auto-key data on the same storage adapter (which
 *   would surface as DB1 "another instance on this adapter has a different
 *   password").
 * - `removeData: false` (timeout/retry path) NEVER calls `remove()`: the
 *   instance is closed but its data — including a half-migrated vault and
 *   the migration replication checkpoints — is kept so the next attempt
 *   re-opens the same storage and RESUMES the migration instead of
 *   presenting an empty vault.
 */
async function teardownRxDB(
  instance: unknown,
  opts: { removeData?: boolean } = {},
): Promise<Error | null> {
  const candidate = instance as {
    remove?: () => Promise<unknown>;
    close?: () => Promise<unknown>;
    destroy?: () => Promise<unknown>;
  } | null;
  if (!candidate) {return null;}
  // removeData=true prefers remove() (destroys data), falling back to
  // close() (keeps data, closes connections) so a remove() rejection on the
  // encrypted Dexie adapter never leaves the IndexedDB connections open —
  // destroyDB sweeps the databases afterwards and needs them closed, else
  // deleteDatabase is blocked. removeData=false (default) uses close()/destroy()
  // only: wiping a half-migrated vault on a transient timeout is data loss.
  const methods = [
    ...(opts.removeData === true && typeof candidate.remove === "function"
      ? [candidate.remove]
      : []),
    typeof candidate.close === "function" ? candidate.close : null,
    typeof candidate.destroy === "function" ? candidate.destroy : null,
  ].filter((m): m is () => Promise<unknown> => m !== null);
  if (methods.length === 0) {
    logger.warn(
      "[DB] Instance exposes no remove()/close()/destroy() — skipping cleanup",
    );
    return null;
  }
  let lastError: unknown = null;
  for (const method of methods) {
    try {
      await method.call(candidate);
      return null;
    } catch (err) {
      lastError = err;
    }
  }
  logger.warn("[DB] Best-effort teardown rejected (continuing)", {
    error:
      lastError instanceof Error ? lastError.message : String(lastError),
  });
  return lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Derives a database encryption key from a master password and salt
 * using PBKDF2 with the configured iteration count.
 */
async function deriveDbKey(password: string, salt: string): Promise<string> {
  // S1/R3: derives via Argon2id (V4). No iteration config needed.
  return encryptionService.deriveDbKey(password, salt);
}

/**
 * Resolves the database encryption password.
 *
 * Priority order:
 * 1. If an encrypted DB key exists in SecureStorage AND a password is
 *    provided, decrypt and return the stored key.
 * 2. If a password is provided, derive a new key and encrypt-store it.
 * 3. If no password, use or generate a stored auto-key.
 *
 * Handles legacy localStorage migration transparently.
 */
async function resolveDbPassword(pw?: string): Promise<string> {
  const hasEncryptedDbKey = await secureStorage.hasSecret(SECURE_STORAGE_KEYS.DB_KEY);

  if (hasEncryptedDbKey && pw && pw.trim() !== "") {
    try {
      const encrypted = await secureStorage.getSecret(SECURE_STORAGE_KEYS.DB_KEY);
      if (encrypted) {
        return await encryptionService.decrypt(encrypted, pw);
      }
    } catch (err) {
      // A wrapped-but-not-materialized device key means the vault is
      // LOCKED, not that the password is wrong — the password may be
      // perfectly correct. Surface it as VAULT_LOCKED so the UI does not
      // show a misleading "Invalid password" and the user is pointed at
      // unlocking the vault instead of re-entering a correct password.
      if (err instanceof Error && err.name === "DEVICE_KEY_WRAPPED") {
        logger.error(
          "[DB] encrypted_db_key unreadable: device key wrapped (vault locked) — not a password error",
          { error: err },
        );
        const lockedError = new Error(
          "Vault is locked. Unlock the vault to decrypt your data.",
        );
        lockedError.name = "VAULT_LOCKED";
        throw lockedError;
      }
      logger.error("[DB] Failed to decrypt encrypted_db_key", { error: err });
      const pwError = new Error(
        "Invalid password. Please provide your correct vault password to decrypt your data.",
      );
      pwError.name = "INVALID_PASSWORD";
      throw pwError;
    }
  }

  const legacySalt = safeGet(STORAGE_KEYS.VAULT_SALT);
  const legacyKey = safeGet(STORAGE_KEYS.VAULT_CRYPTO_KEY);

  // Determine salt (migrate from localStorage if needed). ADR-053: the key
  // and its minting contract come from the salt registry — the db_salt is
  // minted once per vault with CSPRNG and never rotates.
  let salt = await secureStorage.getSecret(DB_SALT_DESCRIPTOR.storageKey);
  if (!salt && legacySalt) {
    await secureStorage.setSecret(DB_SALT_DESCRIPTOR.storageKey, legacySalt);
    safeRemove(STORAGE_KEYS.VAULT_SALT);
    salt = legacySalt;
  }
  if (!salt) {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    salt = Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
    await secureStorage.setSecret(DB_SALT_DESCRIPTOR.storageKey, salt);
  }

  // Determine DB key
  let dbKey: string;
  if (pw && pw.trim() !== "") {
    dbKey = await deriveDbKey(pw, salt);
    try {
      const encrypted = await encryptionService.encrypt(dbKey, pw);
      await secureStorage.setSecret(SECURE_STORAGE_KEYS.DB_KEY, encrypted);
    } catch (err) {
      logger.error("[DB] Failed to save encrypted_db_key", { error: err });
    }
  } else {
    let storedKey = await secureStorage.getSecret("vault_crypto_key");
    if (!storedKey && legacyKey) {
      await secureStorage.setSecret("vault_crypto_key", legacyKey);
      safeRemove(STORAGE_KEYS.VAULT_CRYPTO_KEY);
      storedKey = legacyKey;
    }
    if (!storedKey) {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      storedKey = Array.from(array, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      await secureStorage.setSecret("vault_crypto_key", storedKey);
    }
    dbKey = storedKey;
  }
  return dbKey;
}

/**
 * Counts the rows already stored in the vault's Dexie databases WITHOUT
 * opening an RxDB instance, to size the adaptive init timeout (see
 * DB_CONFIG.MIGRATION_PER_ROW_BUDGET_MS). Implemented in the
 * dependency-free `estimate-rows.ts`: Chromium/Firefox enumerate via
 * `indexedDB.databases()`; Safari (no `databases()`) probes the known
 * store names for the schema versions below each collection's current
 * one, never creating databases. Falls back to 0 (→ base budget) when
 * IndexedDB is unavailable.
 */
const estimateExistingRows = (dbName: string): Promise<number> =>
  estimateRows(
    dbName,
    Object.entries(COLLECTIONS).map(([name, config]) => ({
      name,
      version: config.schema.version,
    })),
  );

/** Structural subset of RxDB's RxMigrationStatus (its published .d.ts does
 * not survive the project's strict lib-check, so we avoid importing it). */
interface RxMigrationStatusLike {
  collectionName: string;
  status: "RUNNING" | "DONE" | "ERROR";
  error?: { message?: string } | undefined;
  count: { total: number; handled: number; percent: number };
}

/** Structural subset of RxDB's RxMigrationState. */
interface RxMigrationStateLike {
  $: {
    subscribe: (next: (status: RxMigrationStatusLike) => void) => {
      unsubscribe: () => void;
    };
  };
}

/**
 * Mirrors RxDB's schema-migration status into the UI progress store while
 * `addCollections` runs. Subscribes to `db.migrationStates()` (emits the
 * collection migration states, added as migrations start) and to each
 * state's `$` status observable (per-batch `{total, handled, percent}`
 * updates written to the internal store). Returns a cleanup function that
 * unsubscribes everything and resets the store — the caller invokes it in
 * the `finally` of the addCollections step.
 */
function wireMigrationProgress(createdDb: unknown): () => void {
  const db = createdDb as {
    migrationStates?: () => {
      subscribe: (observer: {
        next: (states: RxMigrationStateLike[]) => void;
        error?: (err: unknown) => void;
      }) => { unsubscribe: () => void };
    };
  };
  if (typeof db.migrationStates !== "function") {
    logger.error("[PROGRESS] migrationStates unavailable on createdDb");
    return () => resetMigrationProgress();
  }

  const statusSubs = new Set<{ unsubscribe: () => void }>();
  const subscribedStates = new WeakSet<RxMigrationStateLike>();

  const mapStatus = (
    status: RxMigrationStatusLike,
  ): CollectionMigrationProgress => ({
    collectionName: status.collectionName,
    status: status.status,
    total: status.count.total,
    handled: status.count.handled,
    percent: status.count.percent,
    error: status.error ? status.error.message : undefined,
  });

  const statesSub = db.migrationStates().subscribe({
    next: (states) => {
      for (const state of states) {
        if (subscribedStates.has(state)) {
          continue;
        }
        subscribedStates.add(state);
        // RxDB broadcasts each migration state from its constructor BEFORE
        // assigning `state.$` (rx-migration-state.js: addMigrationStateToDatabase
        // runs, then `this.$ = observeSingle(...)`). Reading `state.$`
        // synchronously here therefore throws. Deferring to a microtask lets
        // the constructor finish; the sharedReplay then emits the current
        // status immediately and every subsequent per-batch update.
        queueMicrotask(() => {
          if (typeof state.$ !== "object" || state.$ === null) {
            return;
          }
          statusSubs.add(
            state.$.subscribe((status: RxMigrationStatusLike) => {
              updateCollectionMigrationProgress(mapStatus(status));
            }),
          );
        });
      }
    },
    error: () => {
      resetMigrationProgress();
    },
  });

  return () => {
    statesSub?.unsubscribe();
    for (const sub of statusSubs) {
      sub.unsubscribe();
    }
    statusSubs.clear();
    resetMigrationProgress();
  };
}

/**
 * Creates an RxDB database instance with retry logic and storage backend fallback.
 *
 * Tries Dexie (IndexedDB) first. Memory storage is used only for explicit
 * non-production automated/test runs; production never falls back silently.
 * Retries up to MAX_RETRIES times with exponential backoff on timeout.
 *
 * The timeout budget is ADAPTIVE: the base budget grows per attempt, PLUS
 * MIGRATION_PER_ROW_BUDGET_MS per row already in the vault (see
 * estimateExistingRows). A schema migration (e.g. the F-06 authenticated
 * v6→v7 rewrite) is bounded, resumable work that costs ~8-21ms/row, so a
 * fixed small timeout would abort healthy migrations on any vault over a
 * few thousand rows.
 */
async function createDBInstance(
  name: string,
  pw: string,
  attempt: number = 0,
): Promise<BookmarkForgeDB> {
  const INITIAL_TIMEOUT_MS = DB_CONFIG.INITIAL_TIMEOUT_MS;
  const MAX_TIMEOUT_MS = DB_CONFIG.MAX_TIMEOUT_MS;
  const MAX_RETRIES = DB_CONFIG.MAX_RETRIES;

  const estimatedRows = await estimateExistingRows(name);
  // Surface the reopen progress to the UI: while createRxDatabase and
  // addCollections open the vault's stores (a normal reopen WITHOUT a
  // schema migration), the shell shows a "Loading vault… N items"
  // indicator instead of a static spinner. If a migration then starts,
  // updateCollectionMigrationProgress supersedes this with the per-batch
  // migrating screen; the init cleanup (wireMigrationProgress' cleanup)
  // resets it in the finally block.
  setVaultLoadingRows(estimatedRows);
  const timeoutMs = Math.min(
    INITIAL_TIMEOUT_MS * Math.pow(1.5, attempt) +
      estimatedRows * DB_CONFIG.MIGRATION_PER_ROW_BUDGET_MS,
    MAX_TIMEOUT_MS,
  );

  logger.info(
    `[DB] Creating instance with timeout ${timeoutMs}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1}, ~${estimatedRows} existing rows)`,
  );

  // Allow test environments to explicitly force Dexie (IndexedDB) even when
  // running in headless/automated browsers. Only active when the env var is
  // literally "true" — anything else falls through to the normal detection.
  const forceDexie = import.meta.env.VITE_FORCE_DEXIE_STORAGE === "true";
  const forceMemory = import.meta.env.VITE_FORCE_MEMORY_STORAGE === "true";
  const isProduction = import.meta.env.PROD === true;

  // Memory storage is acceptable only for explicit non-production test runs.
  // Falling back to it in a deployed vault would make writes disappear on
  // reload while presenting a healthy-looking UI — silent data loss is worse
  // than a visible startup error. Production also must not infer "automated"
  // from navigator.webdriver: a production browser under a CI/security tool
  // still needs durable IndexedDB semantics.
  if (isProduction && forceMemory) {
    throw new Error(
      "Production database refused VITE_FORCE_MEMORY_STORAGE: persistent IndexedDB storage is required.",
    );
  }

  const isAutomated =
    !isProduction &&
    (forceMemory ||
      (!forceDexie &&
        typeof navigator !== "undefined" &&
        ((navigator as Navigator).webdriver === true ||
          /headless|phantom|selenium|puppeteer/i.test(navigator.userAgent))));

  const storageBackends = forceDexie
    ? [{ name: "Dexie", getter: () => getRxStorageDexie() }]
    : isAutomated
      ? [{ name: "Memory", getter: () => getRxStorageMemory() }]
      : isProduction
        ? [{ name: "Dexie", getter: () => getRxStorageDexie() }]
        : [
            { name: "Dexie", getter: () => createRxStorage() },
            { name: "Memory", getter: () => getRxStorageMemory() },
          ];

  for (const backend of storageBackends) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`DB_INIT_TIMEOUT after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    try {
      const baseStorage = backend.getter();
      const encryptedStorage = wrappedKeyEncryptionCryptoJsStorage({
        storage: baseStorage as Parameters<
          typeof wrappedKeyEncryptionCryptoJsStorage
        >[0]["storage"],
      });
      // F-06: authenticated AES-GCM envelope around the inner CryptoJS
      // field encryption. Schema version bumps rewrite legacy rows through
      // this layer; reads accept both legacy (inner-only) and authenticated
      // rows so existing vaults stay readable.
      const authenticatedStorage = authenticatedEncryptionStorage({
        storage: encryptedStorage,
      });
      const finalStorage = wrappedValidateZSchemaStorage({
        storage: authenticatedStorage,
      });

      let createdDb: RxDatabase;
      try {
        const dbPromise = createRxDatabase({
          name,
          storage: finalStorage,
          password: pw || "",
          closeDuplicates: true,
          cleanupPolicy: {
            minimumDeletedTime: 1000 * 60 * 60 * 24 * 30,
            runEach: 1000 * 60 * 60 * 12,
          },
        });
        // Suppress unhandled rejection from the losing Promise.race
        // participant. When the timeout fires first, createRxDatabase
        // continues in the background and eventually rejects; without this
        // handler that rejection becomes an unhandled promise rejection.
        dbPromise.catch(() => {});
        createdDb = await Promise.race([dbPromise, timeoutPromise]);
      } catch (e) {
        // createRxDatabase rejected (likely DB_INIT_TIMEOUT). The outer
        // for-loop catch handles the retry/fallback. Do not clearTimeout
        // here — the same timeoutPromise must race the addCollections step
        // below so that a hung disk-touching addCollections also trips the
        // safety timeout.
        throw e;
      }

      if (pw) {
        try {
          const hasPassword =
            typeof (createdDb as unknown as Record<string, unknown>)
              .password !== "undefined";
          if (!hasPassword) {
            logger.error(
              "[DB] CRITICAL: Password provided but encryption may not be active. The wrappedKeyEncryptionCryptoJsStorage plugin may not be loaded.",
            );
          }
        } catch (error) {
          logger.warn("[DB] Could not verify encryption status.", { error });
        }
      }

      // ADR-019: RxDB/Dexie opens the actual IndexedDB connection LAZILY
      // during addCollections, not during createRxDatabase. We must therefore
      // add collections inside the storage-backend loop, under the same
      // Promise.race(timeoutPromise) constraint. If addCollections throws
      // DXE1/DB3 (corrupt IDB state, version mismatch, Dexie race with another
      // tab), destroying the half-built instance and re-throwing engages the
      // Memory storage fallback in the outer backend loop instead of crashing
      // the entire init. The previous structure called addCollections AFTER
      // createDBInstance returned, which bypassed the fallback loop and made
      // the app unrecoverable on every cold boot under headless or otherwise
      // partially-failed storage conditions.
      const typedCreated = createdDb as unknown as Record<string, unknown>;
      const missingCollections: Record<string, unknown> = {};
      for (const [name, config] of Object.entries(COLLECTIONS)) {
        if (!typedCreated[name]) {
          missingCollections[name] = config;
        }
      }
      if (Object.keys(missingCollections).length > 0) {
        // Wire the RxDB migration progress into the UI store BEFORE
        // addCollections: migrations start (and mostly run) inside this
        // await, and the UI never sees the RxDatabase object until it
        // resolves. Best-effort — if migrationStates() is unavailable
        // (unit mocks, missing plugin), the UI just falls back to the
        // plain loading state.
        const migrationCleanup = wireMigrationProgress(createdDb);
        try {
          const addCollectionsPromise = (createdDb as BookmarkForgeDB).addCollections(missingCollections);
          // Same unhandled-rejection suppression as the createRxDatabase race.
          addCollectionsPromise.catch(() => {});
          await Promise.race([
            addCollectionsPromise,
            timeoutPromise,
          ]);
        } catch (collectionErr) {
          const msg =
            collectionErr instanceof Error
              ? collectionErr.message
              : String(collectionErr);
          logger.warn(
            `[DB] addCollections failed in ${backend.name} backend — closing half-built instance (data kept) and falling through`,
            { error: msg },
          );
          // Best-effort teardown so the next backend (or retry of this one)
          // does not see a leftover connection. The instance is CLOSED but
          // its data is NEVER removed here: a DB_INIT_TIMEOUT fires mid-
          // migration, and RxDB's migration replication keeps checkpoints in
          // the rx-migration-state-meta store, so the retry re-opens the same
          // storage and RESUMES the migration. Calling remove() in this path
          // would wipe the half-migrated vault (Dexie remove() clears the
          // docs tables) and the retry would boot an empty vault over the
          // user's real data. RxDB v16 renamed destroy() → remove()/close();
          // calling the non-existent destroy() threw a SYNCHRONOUS TypeError
          // (not swallowed by .catch()) that masked the real addCollections
          // error and misclassified init as DB_INACCESSIBLE, breaking
          // first-run vault setup.
          await teardownRxDB(createdDb, { removeData: false });
          throw collectionErr;
        } finally {
          // Disarm the outer timeout only after both createRxDatabase AND
          // addCollections have settled. Without this, addCollections hangs
          // would never trip the safety timeout (the reviewer-flagged bug).
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          // The migration either finished or was aborted — drop the
          // subscriptions and clear the store so a later boot starts
          // fresh (and the plain loading state returns when no migration
          // is pending).
          migrationCleanup();
        }
      }

      const state = getDbState();
      state.activeBackend = backend.name as "Dexie" | "Memory";
      state.initAttempts = attempt + 1;
      publishStorageBackend(state.activeBackend);
      return createdDb as BookmarkForgeDB;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errName = (error as Error)?.name;
      const errCode = (error as Error & { code?: string })?.code;

      logger.error(`[DB] ${backend.name} storage failed`, {
        error: errMsg,
        errorName: errName,
        errorCode: errCode,
        errorObject: error,
        attempt,
        timeoutMs,
      });

      // F-06 (benchmark follow-up): a DB_INIT_TIMEOUT means the schema
      // migration did not finish in the budget. Migration is bounded,
      // resumable work (RxDB re-runs it on the next open) — falling back
      // to Memory storage here would present an EMPTY vault over real
      // data and make the next write silently non-durable. So a timeout
      // NEVER falls through to the next backend: retry the same backend
      // with a larger budget, and rethrow when retries are exhausted.
      if (errMsg.includes("DB_INIT_TIMEOUT")) {
        if (attempt < MAX_RETRIES) {
          logger.warn(
            `[DB] Timeout on attempt ${attempt + 1}, retrying with a larger budget...`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, 500 * (attempt + 1)),
          );
          return createDBInstance(name, pw, attempt + 1);
        }
        throw error;
      }
      if (backend.name === storageBackends[storageBackends.length - 1]!.name) {
        throw error;
      } else {
        logger.warn(
          `[DB] ${backend.name} storage failed, trying next backend...`,
        );
      }
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    }
  }

  throw new Error("All storage backends failed");
}

/**
 * Ensures all configured collections exist on the database instance.
 *
 * If collections are missing, calls `addCollections`. Handles DXE1/DB3
 * errors gracefully when collections are already accessible despite
 * the addCollections rejection.
 */

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Initializes (or returns) the RxDB database singleton.
 *
 * First call creates the database with retry logic (up to 3 attempts with
 * exponential backoff). Subsequent calls return the cached instance.
 * Detects headless/automated test environments and uses Memory storage there;
 * production always requires persistent IndexedDB.
 *
 * Uses `initPromise` as a mutex — JavaScript's single-threaded synchronous
 * execution guarantees only one caller enters the initialization path.
 *
 * @param password - Optional vault password to derive the encryption key.
 *   If omitted, uses a stored auto-generated key for encrypted storage.
 * @returns The initialized RxDB database instance
 * @throws {Error} `INVALID_PASSWORD` if the password doesn't match an existing DB
 * @throws {Error} `DB_INIT_TIMEOUT` if all retries are exhausted
 */
/**
 * Centralized free-tier enforcement for bookmark inserts. Attached once per
 * db instance (initDB caches the instance, so hooks never double-register).
 *
 * Every insert path (UI, clipper bridge, importer, broadcast) funnels through
 * the bookmarks collection, so a middleware here is the single choke point:
 * Pro (license or trial) inserts always pass; Free users get a
 * LicenseError once FREE_LIMITS.maxBookmarks is reached. The count query
 * only runs for non-Pro, so the O(n) cost is bounded to ≤200 docs.
 */
function attachBookmarkFreeLimit(db: BookmarkForgeDB): void {
  const col = db.bookmarks as typeof db.bookmarks & {
    preInsert(
      hook: (data: BookmarkDocType) => void | Promise<void>,
      parallel: boolean,
    ): void;
  };
  try {
    col.preInsert(async () => {
      if (licenseService.hasProAccess()) {return;}
      const count = await col.count({ selector: { isDeleted: false } }).exec();
      if (count >= FREE_LIMITS.maxBookmarks) {
        throw new LicenseError(
          `Free plan is limited to ${FREE_LIMITS.maxBookmarks} bookmarks. ` +
            "Upgrade to Pro for unlimited bookmarks.",
          "FREE_LIMIT_REACHED",
        );
      }
    }, false);
  } catch (error) {
    logger.warn("[DB] Failed to attach bookmark limit middleware", { error });
  }
}

export const initDB = async (password?: string): Promise<BookmarkForgeDB> => {
  const state = getDbState();

  // Never return an instance while destroyDB() is still tearing it down. If
  // destruction started during an in-flight init, wait for that init first so
  // destroyDB can finish without a promise cycle, then await the teardown.
  if (state.isDestroying && state.destroyPromise) {
    if (!state.dbInstance && state.initPromise) {
      try {
        await state.initPromise;
      } catch (error) {
        logger.warn("[DB] init failed while destroy was waiting", { error });
      }
    }
    try {
      await state.destroyPromise;
    } catch (error) {
      logger.warn("[DB] destroy failed while re-initializing", { error });
    }
  }

  if (state.dbInstance) {
    return state.dbInstance;
  }

  if (state.initPromise) {
    return state.initPromise;
  }

  const initStartedAt = performance.now();
  const currentInitPromise = (async () => {
    if (state.dbInstance) {
      return state.dbInstance;
    }

    const preferredPw = await resolveDbPassword(password);

    let db;
    try {
      // addCollections runs inside createDBInstance's storage-backend loop
      // (Dexie → Memory), so DXE1/DB3 errors fall through to the Memory
      // backend rather than crashing the entire init.
      const dbName = import.meta.env.VITE_DB_NAME || "bookmarkforge_v5";
      db = await createDBInstance(dbName, preferredPw, 0);
      attachBookmarkFreeLimit(db);
    } catch (err) {
      state.initPromise = null;
      // Walk the FULL cause chain before remapping. RxDB/Dexie often
      // wrap the underlying DOMException under 2-3 layers; the top-level
      // message alone is unreliable. Logging each frame (with
      // key-material redaction) gives us actionable diagnostics when
      // a user reports the vault locked them out.
      const frames = walkErrorChain(err);
      logger.error("[DB] initDB failed — full error chain", {
        frames,
        bottomErrorName: err instanceof Error ? err.name : typeof err,
        bottomErrorMessage:
          err instanceof Error ? err.message : String(err),
      });
      const cls = classifyDbError(frames);

      // Errors already classified by resolveDbPassword (VAULT_LOCKED,
      // INVALID_PASSWORD) must NOT be re-mapped: VAULT_LOCKED in
      // particular is a distinct state — the vault is locked, not a wrong
      // password — and reclassifying it as INACCESSIBLE would hide the
      // unlock path from the user.
      if (isVaultLockedError(err)) {
        throw err;
      }
      if (isInvalidDbPasswordError(err)) {
        throw err;
      }

      if (cls === "WRONG_PASSWORD") {
        // Only emit the password error when a password was actually
        // supplied. If the user is trying to open an encrypted vault
        // with an empty key (predefined auto-key path), DB1 here means
        // "this vault needs a password" — we still want to surface the
        // password prompt, so the WRONG_PASSWORD label is fine.
        throw makeClassifiedError(
          "INVALID_PASSWORD",
          "Invalid password. Please provide your correct vault password to decrypt your data.",
          frames.find((f) => f.code === "DB1")?.code,
        );
      }
      if (cls === "INACCESSIBLE") {
        throw makeClassifiedError(
          "DB_INACCESSIBLE",
          "Database inaccessible. The encrypted vault storage may be corrupted, locked by another tab, or have an incompatible schema.",
          frames.find((f) => f.code === "DB3")?.code,
        );
      }
      // UNKNOWN — chain has no DB1/DB3 code. Surface as INACCESSIBLE so
      // the UI shows a friendly fallback instead of dumping the raw
      // RxDB stack at the user. We preserve the original error on a
      // property so it can still be inspected via telemetry.
      const ia = makeClassifiedError(
        "DB_INACCESSIBLE",
        "Database inaccessible. The encrypted vault storage may be corrupted or an unexpected internal error occurred.",
      );
      (ia as Error & { dbOriginalError?: unknown }).dbOriginalError = err;
      throw ia;
    }

    state.dbInstance = db;
    state.initDurationMs = Math.round(performance.now() - initStartedAt);
    return db;
  })();
  state.initPromise = currentInitPromise;

  try {
    return await state.initPromise;
  } catch (error) {
    // Only clear initPromise if we still own it — another caller may have
    // already set a new one after our createDBInstance failed.
    if (state.initPromise === currentInitPromise) {
      state.initPromise = null;
    }
    throw error;
  }
};

/**
 * Returns the existing database instance without creating one.
 * Useful for reads that should not trigger initialization side effects.
 * @returns The database instance, or `null` if not yet initialized
 */
export const getDB = async (): Promise<BookmarkForgeDB | null> => {
  const state = getDbState();

  // Reads must not observe an instance while destroyDB() is closing or
  // removing it. Mirror initDB's deadlock-safe ordering for an init that is
  // still pending underneath the destroy operation.
  if (state.isDestroying && state.destroyPromise) {
    if (!state.dbInstance && state.initPromise) {
      try {
        await state.initPromise;
      } catch (error) {
        logger.warn("[getDB] init failed while destroy was waiting", { error });
      }
    }
    try {
      await state.destroyPromise;
    } catch (error) {
      logger.warn("[getDB] destroy failed while reading", { error });
    }
  }

  if (state.dbInstance) {
    return state.dbInstance;
  }
  if (state.initPromise) {
    try {
      return await state.initPromise;
    } catch (error) {
      logger.warn("[getDB] initPromise rejected", { error });
      return null;
    }
  }
  return null;
};

/** Returns `true` if the database singleton has been created. */
export const isDBInitialized = (): boolean => {
  return getDbState().dbInstance !== null;
};

/**
 * Returns the storage backend that successfully initialized the database
 * singleton, or `null` if it has not initialized yet (or was destroyed).
 * Used by the e2e suite to reject runs that silently fell back to Memory.
 */
export const getActiveStorageBackend = (): ActiveStorageBackend => {
  return getDbState().activeBackend;
};

/** Returns the duration of the last successful database initialization. */
export const getDBInitDurationMs = (): number | null =>
  getDbState().initDurationMs ?? null;

/** Returns the number of backend attempts used by the last successful init. */
export const getDBInitAttempts = (): number | null =>
  getDbState().initAttempts ?? null;

/**
 * Enumerates and deletes every per-collection Dexie database belonging to the
 * vault (`rxdb-dexie-<dbName>--<version>--<collection>`). These hold the
 * actual document/tombstone rows; deleting only the bare `bookmarkforge_v5`
 * leaves them behind, so a corrupted vault is never recoverable after a
 * restore and a re-open with a different password hits RxDB DB1
 * ("another instance on this adapter has a different password").
 *
 * SAFETY vs DatabaseClosedError: this MUST run after teardownRxDB() has
 * closed the Dexie connections. rxdb's closeDexieDb() (triggered by
 * close()/destroy()) both closes the connection AND evicts the name from the
 * module-level DEXIE_STATE_DB_BY_NAME cache — so a subsequent initDB() mints
 * fresh instances instead of reusing a closed one. Deleting the IndexedDB
 * files here is then safe because no live connection holds them open (an
 * open connection would otherwise block deleteDatabase). Best-effort: a
 * single blocked/failed deletion must not abort the wipe of the others.
 */
async function wipeDexieDatabases(dbName: string): Promise<string[]> {
  const prefix = `rxdb-dexie-${dbName}--`;
  // indexedDB.databases() is unavailable in some non-browser/unit-test
  // environments (e.g. a stubbed IDB without SQLiteConnection enumerations).
  // In that case there is nothing to enumerate/wipe — skip silently so a
  // per-browser-only cleanup never breaks a destroy/restore in tests.
  if (typeof indexedDB === "undefined" || !("databases" in indexedDB)) {
    return [];
  }
  const targets =
    (await indexedDB.databases())
      ?.map((d) => d.name)
      .filter((name): name is string => !!name && name.startsWith(prefix)) ?? [];
  const wiped: string[] = [];
  for (const name of targets) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error(`deleteDatabase failed for ${name}`));
        req.onblocked = () =>
          reject(new Error(`Deletion of ${name} blocked by an open connection`));
      });
      wiped.push(name);
    } catch (err) {
      logger.warn("[DB] Failed to wipe Dexie database", {
        name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (wiped.length > 0) {
    logger.info("[DB] Wiped per-collection Dexie databases", { count: wiped.length });
  }
  return wiped;
}

/**
 * Destroys the database instance and deletes it from IndexedDB storage.
 * Resets all module-level state so {@link initDB} can re-initialize.
 * @throws {Error} If database destruction or IndexedDB deletion fails.
 */
export const destroyDB = async (): Promise<void> => {
  const state = getDbState();
  if (state.isDestroying && state.destroyPromise) {
    await state.destroyPromise;
    return;
  }

  state.isDestroying = true;
  state.destroyPromise = (async () => {
    logger.info(
      "[DB] Destroying database instance and removing from storage...",
    );
    let dbDestroyError: Error | null = null;
    if (state.initPromise) {
      try {
        const db = await state.initPromise;
        // RxDB v16 renamed destroy() → remove() (removes data) / close()
        // (keeps data). remove() must be used so the subsequent initDB with
        // the real master password does not collide with stale auto-key data
        // on the same storage adapter (DB1 "another instance on this adapter
        // has a different password"). destroyDB is an explicit user wipe, so
        // removeData: true. teardownRxDB returns the failure so destroyDB
        // can propagate it (tests expect destroy errors to reject).
        const teardownErr = await teardownRxDB(db, { removeData: true });
        if (teardownErr) {
          dbDestroyError =
            teardownErr instanceof Error
              ? teardownErr
              : new Error(String(teardownErr));
          logger.error("[DB] Error destroying RxDB instance", {
            error: dbDestroyError,
          });
        }
      } catch (err) {
        dbDestroyError = err instanceof Error ? err : new Error(String(err));
        logger.error("[DB] Error destroying RxDB instance", {
          error: dbDestroyError,
        });
      }
    }

    try {
      const dbName = import.meta.env.VITE_DB_NAME || "bookmarkforge_v5";
      // NOTE: the previous implementation also deleted the Dexie-per-collection
      // databases (`rxdb-dexie-<dbName>--...`) with raw indexedDB.deleteDatabase.
      // That fights RxDB's module-level Dexie instance cache
      // (DEXIE_STATE_DB_BY_NAME): Dexie auto-closes its connections in
      // response ("Another connection wants to delete database... Closing db
      // now"), the cached instances stay closed, and the next initDB() reuses
      // a closed instance → DatabaseClosedError → silent Memory fallback.
      // RxDB v16's own RxDatabase.remove()/teardown is the correct cleanup;
      // keep only the legacy bare-name delete for parity with the old reset
      // path (harmless: the Dexie DBs are named rxdb-dexie-*, not dbName).
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => {
          logger.warn("[DB] deleteDatabase failed for " + dbName, {
            error: req.error,
          });
          // Propagate so callers (and initDB's re-init guard) see the failure.
          reject(req.error || new Error("deleteDatabase failed for " + dbName));
        };
        req.onblocked = () => {
          logger.warn(
            "[DB] deleteDatabase blocked by active connection for " + dbName,
          );
          resolve();
        };
      });
      logger.info("[DB] Database cleanly removed from disk");
      // The per-collection rxdb-dexie-* databases carry the actual rows.
      // Wiping them here (after the connections were closed + cache evicted
      // by teardownRxDB) makes a corrupted vault actually recoverable on
      // re-open and avoids DB1 password collisions on a subsequent seed.
      // Best-effort: a failure to wipe one DB is logged, not fatal.
      await wipeDexieDatabases(dbName);
    } catch (err) {
      logger.error("[DB] Error removing database from disk", { error: err });
      if (!dbDestroyError) {
        dbDestroyError = err instanceof Error ? err : new Error(String(err));
      }
    }

    // Nullify state AFTER IndexedDB deletion to prevent initDB from creating
    // a new instance that races with the in-flight deleteDatabase call.
    state.dbInstance = null;
    state.initPromise = null;
    state.activeBackend = null;
    state.initDurationMs = null;
    state.initAttempts = null;
    publishStorageBackend(null);

    if (dbDestroyError) {
      throw dbDestroyError;
    }
  })();

  try {
    await state.destroyPromise;
  } finally {
    state.isDestroying = false;
    state.destroyPromise = null;
  }
};
