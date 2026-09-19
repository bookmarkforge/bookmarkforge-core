// ADR-019: Argon2id migration / Security hardening (dedicated IndexedDB vault)
import { logRateLimited } from "../utils/boundedLog";
import { logger } from "../utils/logger";
import { getIndexedDB } from "../utils/indexedDB";
import { safeGet, safeRemove } from "../store/safeStorage";
import { zeroPasswordBytes } from "../utils/crypto-core";
// Audit H5: the wrapped device key uses the vault's own Argon2id KDF
// (crypto-core encrypt/decrypt — the "v4:" format) so the master password
// protects it with the same memory-hard derivation as every other secret.
import {
  encrypt as kdfEncrypt,
  decrypt as kdfDecrypt,
} from "../utils/crypto-core";

/**
 * SecureStorage - IndexedDB storage for sensitive data.
 * AES-256-GCM at rest with a device-bound key; S9 separation keeps the
 * key JWK in localStorage and ciphertexts in IDB (both surfaces are
 * required to decrypt). Not a substitute for the master-password vault.
 */

interface SecureData {
  id: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}

function isDeviceKeyLifecycleError(error: unknown): boolean {
  const name =
    error instanceof Error
      ? error.name
      : (error as { name?: unknown } | null)?.name;
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === "DEVICE_KEY_WRAPPED" ||
    name === "DEVICE_KEY_MISSING" ||
    name === "DEVICE_KEY_CORRUPT" ||
    message.includes("unlock the vault first") ||
    message.includes("device key is missing") ||
    message.includes("device key is corrupt")
  );
}

export class SecureStorage {
  private static readonly DB_NAME = "bookmarkforge_secure_vault";
  private static readonly STORE_NAME = "secrets";
  private static readonly DB_VERSION = 1;
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;
  private readonly MAX_RETRIES = 3;
  private static readonly DEVICE_KEY_ID = "__device_key__";
  // S9: JWK stored in localStorage (bmf_device_key_jwk) instead of
  // IndexedDB — separates key material from ciphertexts so an attacker
  // who compromises only one storage surface (e.g. IDB via extension,
  // or localStorage via XSS) cannot decrypt secrets.
  private static readonly LOCALSTORAGE_KEY_JWK = "bmf_device_key_jwk";
  // Audit H5: master-password wrapping. With a master password the device
  // key JWK is never persisted in plaintext: it lives in IndexedDB wrapped
  // with AES-256-GCM under a master-password-derived key and only exists in
  // memory while unlocked. The raw tokens below stay outside the device-key
  // layer on purpose — they must be readable while locked (verification
  // token is password-encrypted; recovery data is phrase-encrypted; setup
  // flag is not secret), so unlock can verify the password BEFORE unwrapping
  // the device key. Without this, unlock would deadlock (verify → needs
  // device key → needs password).
  private static readonly IDB_KEY_WRAPPED = "bmf_device_key_wrapped";
  private static readonly IDB_VERIFICATION_TOKEN = "vault_verification";
  private static readonly IDB_VERIFICATION_INTEGRITY = "vault_verification_integrity";
  private static readonly IDB_MASTER_PASSWORD_FLAG = "master_password_setup";
  private static readonly IDB_RECOVERY_DATA = "recovery_data";
  private deviceKey: CryptoKey | null = null;
  private deviceKeyPromise: Promise<CryptoKey> | null = null;
  // Serialize password wrapping and invalidate async key materialization when
  // the vault locks or the database closes.
  private deviceKeyWrapPromise: Promise<void> | null = null;
  private deviceKeyLifecycle = 0;
  // Serialize the IndexedDB lifecycle against data operations: a purge /
  // lock / close must never tear down the connection while another
  // operation sits between init() and transaction(). Also provides a single
  // ordering point so operations queued after a close transparently reopen.
  private opChain: Promise<unknown> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(fn);
    this.opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Initialize the IndexedDB database with retry logic.
   * Uses a locking promise pattern — all concurrent callers await the same promise.
   */
  private async init(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }
    if (this.initPromise) {
      const pendingInit = this.initPromise;
      try {
        return await pendingInit;
      } catch (error) {
        logger.warn("[SecureStorage] Previous init failed, retrying", {
          error,
        });
        // Another concurrent caller may have already replaced the failed
        // promise while we were awaiting it — reuse that fresh promise
        // instead of opening a duplicate connection. Compare by identity
        // so we don't return the same rejected promise.
        if (this.initPromise && this.initPromise !== pendingInit) {
          return this.initPromise;
        }
        this.initPromise = this.openWithRetry();
        return this.initPromise;
      }
    }
    this.initPromise = this.openWithRetry();
    return this.initPromise;
  }

  /**
   * Open IndexedDB with exponential backoff retry
   */
  private async openWithRetry(): Promise<IDBDatabase> {
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const db = await this.openDB();
        this.db = db;
        return db;
      } catch (error) {
        logger.warn("[SecureStorage] Init attempt failed", { attempt, error });
        if (attempt < this.MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 100 * Math.pow(2, attempt)));
        } else {
          this.initPromise = null;
          throw error;
        }
      }
    }
    throw new Error("SecureStorage init failed after retries");
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const idb = getIndexedDB();
      if (!idb) {
        reject(new Error("IndexedDB not available"));
        return;
      }

      const request = idb.open(SecureStorage.DB_NAME, SecureStorage.DB_VERSION);

      request.onerror = () => {
        reject(request.error || new Error("Failed to open database"));
      };

      request.onblocked = () => {
        // Another tab holds an old-version connection. Do not wait forever:
        // a blocked open keeps the request alive and can stall every caller.
        reject(new Error("Failed to open database: upgrade blocked"));
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          try {db.close();} catch { /* INTENTIONAL SILENCE: the SecureStorage connection is already closed. */ }
          if (this.db === db) {this.db = null;}
        };
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(SecureStorage.STORE_NAME)) {
          const store = db.createObjectStore(SecureStorage.STORE_NAME, {
            keyPath: "id",
          });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };
    });
  }

  /**
   * Get (or lazily create + persist) the device-bound AES-GCM key used to
   * encrypt all secrets at rest. The key lives only in this browser/profile.
   */
  /**
   * Read the device key JWK from localStorage. Returns null if absent
   * or if localStorage is unavailable (SSR/worker).
   */
  private readKeyJwkFromLocalStorage(): string | null {
    try {
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(SecureStorage.LOCALSTORAGE_KEY_JWK);
    } catch (_err) {
      return null;
    }
  }

  /**
   * Write the device key JWK to localStorage. No-op if unavailable.
   */
  private writeKeyJwkToLocalStorage(jwk: string): void {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(SecureStorage.LOCALSTORAGE_KEY_JWK, jwk);
    } catch (error) {
      // The in-memory key keeps the active session usable, but persistence
      // failure matters for restart/recovery and must be observable.
      logRateLimited(
        "warn",
        "secure-storage-device-key-localstorage",
        "Failed to persist the device-key recovery copy; keeping it in memory",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  // ─── Cross-tab mutual exclusion for device-key generation ────────

  /**
   * Lock name scoped to this origin + DB so two tabs opening the same
   * vault on the same device serialize device-key creation. Without this,
   * both tabs can enter the generate-and-persist path, write different
   * JWKs to localStorage, and end up with divergent keys — one tab's
   * subsequent encrypt/decrypt operations fail irreversibly.
   *
   * Falls back to the raw callback when the Web Locks API is unavailable
   * (SSR, older browsers, test environments, Web Workers). No cross-tab
   * serialization in that case, but per-tab behaviour is unchanged.
   */
  private static readonly DEVICE_KEY_LOCK = `${SecureStorage.DB_NAME}::device-key`;

  private static async withDeviceKeyLock<T>(
    fn: () => Promise<T>,
  ): Promise<T> {
    if (
      typeof navigator !== "undefined" &&
      navigator.locks &&
      typeof navigator.locks.request === "function"
    ) {
      // navigator.locks.request() already returns Promise<T> when the
      // callback returns Promise<T> — no manual resolve/reject wrapping.
      return navigator.locks.request(SecureStorage.DEVICE_KEY_LOCK, fn);
    }
    // Fallback: no cross-tab serialization, but per-tab behaviour is
    // unchanged from the pre-lock implementation.
    return fn();
  }

  // ─── Audit H5: master-password wrapping of the device key ────────────

  /** True when the device key is wrapped by the master password. */
  async isDeviceKeyWrapped(): Promise<boolean> {
    const blob = await this.rawGet(SecureStorage.IDB_KEY_WRAPPED);
    return blob !== null;
  }

  /**
   * True when the unwrapped device key is cached in memory for this
   * session. Used by unlock() as a post-condition: a wrapped vault must
   * never proceed past materialization without the key in memory, or a
   * later re-wrap would mint a fresh key and orphan every ciphertext.
   */
  isDeviceKeyMaterialized(): boolean {
    return this.deviceKey !== null || this.deviceKeyPromise !== null;
  }

  /** Materialize the device key for first-run setup before encrypted writes. */
  async ensureDeviceKeyMaterialized(): Promise<void> {
    await this.getDeviceKey();
  }

  /** Snapshot/restore helpers used to make password rotation rollback-safe. */
  async getWrappedDeviceKeyBlob(): Promise<string | null> {
    return this.rawGet(SecureStorage.IDB_KEY_WRAPPED);
  }

  async restoreWrappedDeviceKeyBlob(blob: string | null): Promise<void> {
    if (blob === null) {
      await this.rawDelete(SecureStorage.IDB_KEY_WRAPPED);
    } else {
      await this.rawPut(SecureStorage.IDB_KEY_WRAPPED, blob);
    }
    // The current unlocked session can keep using its materialized key. A
    // subsequent lock clears both caches, so the next unlock reads this
    // restored wrapper from IndexedDB rather than a stale promise.
    this.deviceKeyPromise = this.deviceKey
      ? Promise.resolve(this.deviceKey)
      : null;
  }

  /**
   * Wrap the device key JWK with the master password (Argon2id + AES-GCM,
   * same "v4:" format as the rest of the vault) and remove every
   * plaintext copy. Idempotent — no-op when already wrapped. Keeps the
   * in-memory key loaded so the ongoing session stays usable.
   */
  async wrapDeviceKeyWithPassword(password: string): Promise<void> {
    if (this.deviceKeyWrapPromise) {
      return this.deviceKeyWrapPromise;
    }
    const pending = SecureStorage.withDeviceKeyLock(() =>
      this.wrapDeviceKeyWithPasswordInternal(password),
    );
    const wrapped = pending.finally(() => {
      if (this.deviceKeyWrapPromise === wrapped) {
        this.deviceKeyWrapPromise = null;
      }
    });
    this.deviceKeyWrapPromise = wrapped;
    return wrapped;
  }

  private async wrapDeviceKeyWithPasswordInternal(
    password: string,
  ): Promise<void> {
    const lifecycle = this.deviceKeyLifecycle;
    if (await this.isDeviceKeyWrapped()) {
      return;
    }
    if (!SecureStorage.hasWebCrypto()) {
      throw new Error(
        "[SecureStorage] Web Crypto unavailable — cannot wrap device key",
      );
    }

    let rawJwk = this.readKeyJwkFromLocalStorage();
    if (!rawJwk) {
      rawJwk = await this.rawGet(SecureStorage.DEVICE_KEY_ID);
    }
    if (!rawJwk) {
      const fresh = await this.generateDeviceKeySafe();
      rawJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", fresh));
    }

    const ciphertext = await kdfEncrypt(rawJwk, password);
    // close()/lockDeviceKey() may have crossed the async KDF boundary. Do not
    // persist a new wrapper after that lifecycle boundary; otherwise a close
    // racing this operation can write sensitive state after teardown.
    if (this.deviceKeyLifecycle !== lifecycle) {
      throw new Error("[SecureStorage] Device key was locked during wrapping");
    }
    await this.rawPut(SecureStorage.IDB_KEY_WRAPPED, ciphertext);

    // Remove every plaintext copy of the JWK (localStorage + legacy IDB).
    try {
      localStorage.removeItem(SecureStorage.LOCALSTORAGE_KEY_JWK);
    } catch (error) {
      logRateLimited(
        "warn",
        "secure-storage-device-key-plaintext-remove",
        "Failed to remove the plaintext device-key recovery copy",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
    try {
      await this.rawDelete(SecureStorage.DEVICE_KEY_ID);
    } catch (error) {
      logRateLimited(
        "warn",
        "secure-storage-device-key-legacy-remove",
        "Failed to remove the legacy plaintext device-key record",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

    // Keep the key usable for the rest of this (unlocked) session. If the
    // vault locked while KDF/IDB work was pending, do not resurrect a key in
    // memory after the lock boundary.
    if (this.deviceKeyLifecycle !== lifecycle) {
      return;
    }
    try {
      const imported = await crypto.subtle.importKey(
        "jwk",
        JSON.parse(rawJwk) as JsonWebKey,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      );
      if (this.deviceKeyLifecycle !== lifecycle) {
        return;
      }
      this.deviceKey = imported;
      this.deviceKeyPromise = Promise.resolve(imported);
    } catch (_err) {
      logger.error(
        "[SecureStorage] Wrapped device key could not be re-imported in memory",
      );
    }
  }

  /**
   * Unwrap the device key with the master password. Only path into the
   * device key while wrapped. NEVER regenerates on failure — a wrong
   * password or corrupted blob throws so callers fail closed.
   */
  async unwrapDeviceKeyWithPassword(password: string): Promise<CryptoKey> {
    if (this.deviceKey) {return this.deviceKey;}
    if (this.deviceKeyPromise) {return this.deviceKeyPromise;}

    const lifecycle = this.deviceKeyLifecycle;
    const blob = await this.rawGet(SecureStorage.IDB_KEY_WRAPPED);
    if (blob === null) {
      // Not wrapped — fall back to the legacy localStorage key path.
      return this.getDeviceKey();
    }
    if (!SecureStorage.hasWebCrypto()) {
      throw new Error(
        "[SecureStorage] Web Crypto unavailable — cannot unwrap device key",
      );
    }

    let rawJwk: string;
    try {
      rawJwk = await kdfDecrypt(blob, password);
    } catch (_err) {
      logger.error(
        "[SecureStorage] Failed to unwrap device key (wrong password or corrupted blob) — refusing to regenerate",
      );
      throw new Error("[SecureStorage] Failed to unwrap device key");
    }
    let imported: CryptoKey;
    try {
      imported = await crypto.subtle.importKey(
        "jwk",
        JSON.parse(rawJwk) as JsonWebKey,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      );
    } catch (_err) {
      throw new Error(
        "[SecureStorage] Corrupt wrapped device key — vault data is unrecoverable without a backup",
      );
    }
    if (this.deviceKeyLifecycle !== lifecycle) {
      throw new Error("[SecureStorage] Device key was locked during unlock");
    }
    this.deviceKey = imported;
    this.deviceKeyPromise = Promise.resolve(imported);
    return imported;
  }

  /**
   * Re-wrap the device key blob with a new password (master-password
   * rotation). No-op when the key is not wrapped.
   *
   * The caller retains ownership of both input buffers. crypto-core consumes
   * Uint8Array passwords, so this method uses private copies and clears them
   * on every path; otherwise SecurityVault's rotation cleanup would observe
   * already-zeroized buffers and report a false reuse warning.
   */
  async rewrapDeviceKeyWithPasswordBytes(
    oldPasswordBytes: Uint8Array,
    newPasswordBytes: Uint8Array,
  ): Promise<void> {
    return SecureStorage.withDeviceKeyLock(() =>
      this.rewrapDeviceKeyWithPasswordBytesInternal(
        oldPasswordBytes,
        newPasswordBytes,
      ),
    );
  }

  private async rewrapDeviceKeyWithPasswordBytesInternal(
    oldPasswordBytes: Uint8Array,
    newPasswordBytes: Uint8Array,
  ): Promise<void> {
    const lifecycle = this.deviceKeyLifecycle;
    const blob = await this.rawGet(SecureStorage.IDB_KEY_WRAPPED);
    if (blob === null) {
      return;
    }
    const oldPasswordCopy = oldPasswordBytes.slice();
    let plaintext: string;
try {
       try {
         plaintext = await kdfDecrypt(blob, oldPasswordCopy);
       } catch (_err) {
         throw new Error(
           "[SecureStorage] Failed to re-wrap device key (old password mismatch)",
         );
       }
} finally {
        // crypto-core normally consumes the copy itself; this also covers
        // derivation/authentication failures before it reaches zeroization.
        if (oldPasswordCopy) {
          zeroPasswordBytes(oldPasswordCopy);
        }
      }

      const newPasswordCopy = newPasswordBytes.slice();
      try {
        const ciphertext = await kdfEncrypt(plaintext, newPasswordCopy);
        // A lock/close can happen while Argon2id derives the replacement.
        // Refuse to write the new wrapper after that lifecycle boundary.
        if (this.deviceKeyLifecycle !== lifecycle) {
          throw new Error("[SecureStorage] Device key was locked during re-wrapping");
        }
        await this.rawPut(SecureStorage.IDB_KEY_WRAPPED, ciphertext);
      } finally {
        // Keep the caller-owned buffer available to SecurityVault's outer
        // rotation finally block while ensuring this private copy never leaks.
        if (newPasswordCopy) {
          zeroPasswordBytes(newPasswordCopy);
        }
      }

    // Keep rotation usable in the current unlocked session. The caller has
    // already verified the old password and may have a live device key; the
    // wrapped blob changes only the next cold-start unlock path. If a lock
    // crossed the async rotation, leave the key absent from memory.
    if (this.deviceKeyLifecycle !== lifecycle) {
      return;
    }
    try {
      const imported = await crypto.subtle.importKey(
        "jwk",
        JSON.parse(plaintext) as JsonWebKey,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      );
      if (this.deviceKeyLifecycle !== lifecycle) {
        return;
      }
      this.deviceKey = imported;
      this.deviceKeyPromise = Promise.resolve(imported);
    } catch (_err) {
      throw new Error(
        "[SecureStorage] Failed to restore device key after password rotation",
      );
    }
  }

  /** Drop the in-memory device key (called when the vault locks). */
  lockDeviceKey(): void {
    this.deviceKeyLifecycle += 1;
    this.deviceKey = null;
    this.deviceKeyPromise = null;
  }

  // ─── Audit H5: raw tokens (readable while the vault is locked) ──────

  /**
   * The password-encrypted verification token, stored without the
   * device-key layer. Falls back to the pre-H5 device-key-encrypted
   * format for legacy installations.
   */
  async getVerificationToken(): Promise<string | null> {
    const raw = await this.rawGet(SecureStorage.IDB_VERIFICATION_TOKEN);
    if (raw !== null) {return raw;}
    try {
      return await this.getSecret(SecureStorage.IDB_VERIFICATION_TOKEN);
    } catch (_err) {
      return null;
    }
  }

  /** Store the password-encrypted verification token (raw, no device key). */
  async storeVerificationToken(ciphertext: string): Promise<void> {
    await this.rawPut(SecureStorage.IDB_VERIFICATION_TOKEN, ciphertext);
  }

  /**
   * Store the verification token AND its S1 integrity record in a single
   * IndexedDB transaction.
   *
   * The two records must always agree: verifyPassword() rejects any unlock
   * whose stored token does not match the HMAC record, so a crash between two
   * independent writes would leave a vault that no password can open. The A-1
   * vault-salt migration rewrites both records, which is exactly the window
   * this removes (rotation carries the same risk and uses it too).
   */
  async storeVerificationTokenWithIntegrity(
    ciphertext: string,
    integrityRecord: string,
  ): Promise<void> {
    await this.rawPutMany([
      [SecureStorage.IDB_VERIFICATION_TOKEN, ciphertext],
      [SecureStorage.IDB_VERIFICATION_INTEGRITY, integrityRecord],
    ]);
  }

  async restoreVerificationToken(ciphertext: string | null): Promise<void> {
    if (ciphertext === null) {
      await this.rawDelete(SecureStorage.IDB_VERIFICATION_TOKEN);
    } else {
      await this.rawPut(SecureStorage.IDB_VERIFICATION_TOKEN, ciphertext);
    }
  }

  /**
   * The S1 verification integrity record (`nonce:hmac`), stored raw like
   * the verification token. It must be readable WHILE THE VAULT IS LOCKED:
   * `verifyPassword()` validates the HMAC before the wrapped device key is
   * materialized, so the device-key layer would deadlock every reload-unlock
   * (the record contains only a public nonce and a password-derived HMAC
   * signature — no secret material). Falls back to the legacy
   * device-key-encrypted format for installations that predate this fix.
   */
  async getVerificationIntegrity(): Promise<string | null> {
    const raw = await this.rawGet(SecureStorage.IDB_VERIFICATION_INTEGRITY);
    if (raw !== null) {return raw;}
    try {
      return await this.getSecret(SecureStorage.IDB_VERIFICATION_INTEGRITY);
    } catch (_err) {
      return null;
    }
  }

  /** Store the raw (non-secret) verification integrity record. */
  async storeVerificationIntegrity(raw: string): Promise<void> {
    await this.rawPut(SecureStorage.IDB_VERIFICATION_INTEGRITY, raw);
  }

  /** Persist the master-password-configured flag (raw — not a secret). */
  async setMasterPasswordConfiguredFlag(): Promise<void> {
    await this.rawPut(SecureStorage.IDB_MASTER_PASSWORD_FLAG, "true");
  }

  /**
   * True when the master-password-configured flag is present. Reads the
   * raw IndexedDB flag directly — deliberately NO device-key decryption
   * path (unlike getSecret/hasSecret-by-decrypt). unlock() must be able to
   * ask "is a master password configured?" while the vault is locked and
   * the device key is still wrapped, otherwise a wrapped vault deadlocks
   * (verify → needs flag → needs device key → needs password).
   */
  async hasMasterPasswordConfiguredFlagRaw(): Promise<boolean> {
    try {
      return (await this.rawGet(SecureStorage.IDB_MASTER_PASSWORD_FLAG)) !== null;
    } catch (error) {
      // DOMException can cross the jsdom/Node realm boundary in tests and
      // embedded browser contexts, making `instanceof DOMException` false.
      // Preserve corruption failures by checking the stable name as well;
      // otherwise a DataError is incorrectly downgraded to `false`.
      const errorName =
        error instanceof Error
          ? error.name
          : (error as { name?: unknown } | null)?.name;
      const corruptionNames = [
        "DataError",
        "UnknownError",
        "InvalidStateError",
        "VersionError",
      ];
      const errMsg = error instanceof Error ? error.message : String(error);
      if (
        (typeof errorName === "string" && corruptionNames.includes(errorName)) ||
        corruptionNames.some((name) => errMsg.includes(name))
      ) {
        throw error;
      }
      if (
        errMsg.includes("corrupt") ||
        errMsg.includes("corrupted") ||
        errMsg.includes("malformed")
      ) {
        throw error;
      }
      logger.error("[SecureStorage] Failed to check master password flag", {
        error,
      });
      return false;
    }
  }

  /**
   * Recovery data is stored raw: it is already encrypted with the BIP39
   * recovery phrase, and it must be readable WHILE THE VAULT IS LOCKED
   * (the recovery flow runs before the password is known). The pre-H5
   * device-key layer made it unreadable exactly when it was needed.
   */
  async getRecoveryDataRaw(): Promise<string | null> {
    const raw = await this.rawGet(SecureStorage.IDB_RECOVERY_DATA);
    if (raw !== null) {return raw;}
    try {
      return await this.getSecret(SecureStorage.IDB_RECOVERY_DATA);
    } catch (_err) {
      return null;
    }
  }

  async setRecoveryDataRaw(data: string): Promise<void> {
    await this.rawPut(SecureStorage.IDB_RECOVERY_DATA, data);
  }

  async hasRecoveryDataRaw(): Promise<boolean> {
    return (await this.getRecoveryDataRaw()) !== null;
  }

  async clearRecoveryDataRaw(): Promise<void> {
    await this.rawDelete(SecureStorage.IDB_RECOVERY_DATA);
  }

  private async getDeviceKey(): Promise<CryptoKey> {
    if (this.deviceKey) {return this.deviceKey;}
    if (this.deviceKeyPromise) {return this.deviceKeyPromise;}
    const lifecycle = this.deviceKeyLifecycle;

    // Audit H5: when the device key is wrapped by the master password it
    // must NEVER be lazily regenerated or persisted in plaintext — a
    // regenerated key could never decrypt existing ciphertexts, and
    // writing the fresh JWK to localStorage would undo the wrap. The only
    // way in is unwrapDeviceKeyWithPassword() (called on vault unlock).
    //
    // The error carries a stable `name` (DEVICE_KEY_WRAPPED) so callers
    // like resolveDbPassword() can distinguish "vault is locked" from
    // "wrong password" — the password may be perfectly correct while the
    // device key simply has not been materialized this session.
    if (await this.isDeviceKeyWrapped()) {
      const err = new Error(
        "[SecureStorage] Device key is wrapped by the master password — unlock the vault first",
      );
      err.name = "DEVICE_KEY_WRAPPED";
      throw err;
    }

    const rawKeyPromise = SecureStorage.withDeviceKeyLock(async () => {
      if (this.deviceKeyLifecycle !== lifecycle) {
        throw new Error("[SecureStorage] Device key lifecycle changed");
      }
      // Re-check the in-memory cache inside the lock: another tab may
      // have generated and persisted the key while we were queued, and a
      // concurrent caller in the SAME tab (same promise) already resolved.
      if (this.deviceKey) {return this.deviceKey;}

      // S9: prefer localStorage (separated from IndexedDB ciphertexts).
      // Fall back to legacy IndexedDB location for existing installations.
      // Re-read localStorage inside the lock so a key written by another
      // tab is picked up instead of generating a divergent second key.
      let rawJwk = this.readKeyJwkFromLocalStorage();

      if (!rawJwk) {
        // Legacy migration: try the old IndexedDB location.
        const legacyRaw = await this.rawGet(SecureStorage.DEVICE_KEY_ID);
        if (legacyRaw) {
          // Migrate to localStorage and remove from IndexedDB.
          this.writeKeyJwkToLocalStorage(legacyRaw);
          try {
            await this.rawDelete(SecureStorage.DEVICE_KEY_ID);
          } catch (error) {
            logRateLimited(
              "warn",
              "secure-storage-device-key-migration-remove",
              "Failed to remove the migrated plaintext device-key record",
              { error: error instanceof Error ? error.message : String(error) },
            );
          }
          rawJwk = legacyRaw;
        }
      }

      if (rawJwk) {
        let imported: CryptoKey;
        try {
          const jwk = JSON.parse(rawJwk) as JsonWebKey;
          imported = await crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "AES-GCM" },
            false,
            ["encrypt", "decrypt"],
          );
        } catch (_err) {
          // Never replace a corrupt key silently: a new key cannot decrypt
          // existing ciphertexts and would cause irreversible data loss.
          const corruptionError = new Error(
            "[SecureStorage] Device key is corrupt and cannot decrypt stored secrets",
          );
          corruptionError.name = "DEVICE_KEY_CORRUPT";
          logger.error("[SecureStorage] Refusing to regenerate corrupt device key");
          throw corruptionError;
        }
        if (this.deviceKeyLifecycle !== lifecycle) {
          throw new Error("[SecureStorage] Device key lifecycle changed");
        }
        this.deviceKey = imported;
        return imported;
      }

      // No key exists at all. A truly empty store is a new installation and
      // may generate one; existing ciphertexts require recovery instead.
      if (await this.hasEncryptedSecretRecords()) {
        const missingError = new Error(
          "[SecureStorage] Device key is missing while encrypted secrets exist",
        );
        missingError.name = "DEVICE_KEY_MISSING";
        logger.error("[SecureStorage] Refusing to regenerate missing device key");
        throw missingError;
      }
      const key = await this.generateDeviceKeySafe();
      const jwk = await crypto.subtle.exportKey("jwk", key);
      if (this.deviceKeyLifecycle !== lifecycle) {
        throw new Error("[SecureStorage] Device key lifecycle changed");
      }
      this.writeKeyJwkToLocalStorage(JSON.stringify(jwk));
      this.deviceKey = key;
      return key;
    });
    const keyPromise = rawKeyPromise.catch((error: unknown) => {
      // Do not cache a rejected promise forever. A recovery flow may repair
      // or restore the key and then retry without recreating SecureStorage.
      if (this.deviceKeyPromise === keyPromise) {
        this.deviceKeyPromise = null;
      }
      throw error;
    });
    this.deviceKeyPromise = keyPromise;

    return keyPromise;
  }

  /**
   * Encrypt a plaintext string with the device key (AES-256-GCM).
   * Format: base64(iv || ciphertext). Web Crypto is required; there is no
   * insecure fallback. The test-mode short-circuit keeps unit tests hermetic.
   */
  private async encryptValue(plaintext: string): Promise<string> {
    if (SecureStorage.isTestEnv()) {
      // Tests exercise raw storage behavior; encryption is active in prod.
      return plaintext;
    }
    if (!SecureStorage.hasWebCrypto()) {
      // Never silently store secrets unencrypted in a non-test environment.
      throw new Error(
        "[SecureStorage] Web Crypto unavailable — cannot encrypt secret",
      );
    }
    try {
      const key = await this.getDeviceKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(plaintext);
      const cipher = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoded,
      );
      const combined = new Uint8Array(iv.length + cipher.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(cipher), iv.length);
      return this.toBase64(combined);
    } catch (error) {
      if (!isDeviceKeyLifecycleError(error)) {
        logger.error("[SecureStorage] AES-GCM encryption failed", { error });
      }
      if (
        error instanceof Error &&
        (error.name === "DEVICE_KEY_CORRUPT" ||
          error.name === "DEVICE_KEY_MISSING" ||
          error.name === "DEVICE_KEY_WRAPPED")
      ) {
        throw error;
      }
      throw new Error("[SecureStorage] Failed to encrypt secret");
    }
  }

  /**
   * Decrypt a value produced by encryptValue.
   */
  private async decryptValue(payload: string): Promise<string> {
    if (SecureStorage.isTestEnv()) {
      return payload;
    }
    if (!SecureStorage.hasWebCrypto()) {
      throw new Error(
        "[SecureStorage] Encrypted value present but Web Crypto unavailable",
      );
    }
    if (payload.startsWith("__plain__")) {
      // A plaintext marker must never be honored outside a test environment.
      throw new Error("[SecureStorage] Refusing to decrypt plaintext marker");
    }
    try {
      const key = await this.getDeviceKey();
      const combined = this.fromBase64(payload);
      const iv = combined.slice(0, 12);
      const cipher = combined.slice(12);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        cipher,
      );
      return new TextDecoder().decode(plain);
    } catch (error) {
      if (!isDeviceKeyLifecycleError(error)) {
        logger.error("[SecureStorage] AES-GCM decryption failed", { error });
      }
      if (
        error instanceof Error &&
        (error.name === "DEVICE_KEY_CORRUPT" ||
          error.name === "DEVICE_KEY_MISSING" ||
          error.name === "DEVICE_KEY_WRAPPED")
      ) {
        throw error;
      }
      throw new Error("[SecureStorage] Failed to decrypt secret");
    }
  }

  private toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }

  /**
   * Generate an AES-GCM device key. Web Crypto is required; there is no
   * insecure fallback for environments without it.
   *
   * IMPORTANT: extractable MUST be true here so the JWK can be persisted
   * to IndexedDB via crypto.subtle.exportKey() (see getDeviceKey). A
   * non-extractable key throws InvalidAccessError at exportKey, which
   * cascades to a hard crash on cold boot (every encrypted secret
   * operation fails). The key material alongside the ciphertexts in
   * IndexedDB is defense-in-depth only — the SecurityVault master-password
   * flow remains the recommended path for high-value secrets. After import
   * (see getDeviceKey) we set extractable=false again so the in-memory
   * handle cannot be re-exported without re-reading the JWK.
   */
  private async generateDeviceKeySafe(): Promise<CryptoKey> {
    if (!SecureStorage.hasWebCrypto()) {
      throw new Error(
        "[SecureStorage] Web Crypto unavailable — cannot generate device key",
      );
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<CryptoKey>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("crypto timeout")), 2000);
    });
    return Promise.race([
      crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
        "encrypt",
        "decrypt",
      ]),
      timeout,
    ]).finally(() => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    });
  }

  private static isTestEnv(): boolean {
    // W-2: Vite statically inlines `import.meta.env.PROD` at build time, so
    // in a production bundle this guard becomes `if (true) return false;`
    // and is dead-code-eliminated: the plaintext bypass below can NEVER
    // compile into a production build, even if NODE_ENV leaks as "test"
    // (e.g. a misconfigured CI/hosting build). This gate is checked first
    // and is intentionally non-negotiable.
    if (import.meta.env.PROD) {
      return false;
    }
    // NODE_ENV is intentionally the only runtime switch here. Some Vitest
    // tests exercise the production encryption path while Vite MODE remains
    // "test"; using import.meta.env.MODE would silently bypass encryption.
    // (import.meta.vitest is NOT the switch either: Vitest only defines it
    // in test files, never in this source module, so it could never gate
    // this check — and if a future Vitest injected it here, it would
    // silently bypass the NODE_ENV="production" suites that assert real
    // encryption at rest.)
    return typeof process !== "undefined" && process.env?.NODE_ENV === "test";
  }

  private static hasWebCrypto(): boolean {
    return (
      typeof crypto !== "undefined" &&
      typeof crypto.subtle !== "undefined" &&
      typeof crypto.getRandomValues === "function" &&
      typeof btoa === "function" &&
      typeof atob === "function"
    );
  }

  private fromBase64(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Run an IndexedDB operation against a live connection. If the cached
   * connection was closed underneath us — e.g. `deleteDatabase()` during
   * nuclear forget delivered its `versionchange` while this operation sat
   * between `init()` and `transaction()`, leaving a stale handle whose
   * `transaction()` throws InvalidStateError ("connection is closing") — the
   * stale handle is dropped and the operation is retried once against a
   * freshly opened connection.
   */
  private async withLiveConnection<T>(
    fn: (db: IDBDatabase) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const db = await this.init();
      try {
        return await fn(db);
      } catch (error) {
        const name =
          error instanceof DOMException
            ? error.name
            : (error as { name?: string } | null)?.name;
        if (name === "InvalidStateError" && attempt === 0) {
          logger.warn(
            "[SecureStorage] Connection closed mid-operation; reopening",
            { error },
          );
          this.db = null;
          this.initPromise = null;
          continue;
        }
        throw error;
      }
    }
    throw new Error("[SecureStorage] Failed to acquire a live connection");
  }

  /**
   * Low-level multi-record put in ONE transaction (no encryption — callers
   * pass already-stored-raw values, e.g. the verification token pair).
   */
  private async rawPutMany(entries: Array<[string, string]>): Promise<void> {
    if (entries.length === 0) {return;}
    return this.enqueue(() =>
      this.withLiveConnection(async (db) => {
        const transaction = db.transaction(
          [SecureStorage.STORE_NAME],
          "readwrite",
        );
        const store = transaction.objectStore(SecureStorage.STORE_NAME);
        const requests: IDBRequest[] = [];
        for (const [id, value] of entries) {
          const now = Date.now();
          const data: SecureData = {
            id,
            value,
            createdAt: now,
            updatedAt: now,
          };
          requests.push(store.put(data));
        }
        // Resolve on transaction commit: every put in this transaction is
        // durable together, or none of them are.
        await this.waitForWriteTransaction(transaction, requests[0]!);
      }),
    );
  }

  /** Low-level put that does NOT encrypt (used for the device key itself). */
  private async rawPut(id: string, value: string): Promise<void> {
    return this.enqueue(() =>
      this.withLiveConnection(async (db) => {
        const transaction = db.transaction([SecureStorage.STORE_NAME], "readwrite");
        const store = transaction.objectStore(SecureStorage.STORE_NAME);
        const data: SecureData = {
          id,
          value,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const request = store.put(data);
        await this.waitForWriteTransaction(transaction, request);
      }),
    );
  }

  /**
   * Resolve a mutating IndexedDB operation only after its transaction commits.
   * Request success alone is not durable: a later constraint or quota error
   * can still abort the transaction after the request callback fires.
   */
  private waitForWriteTransaction(
    transaction: IDBTransaction,
    request: IDBRequest,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) {return;}
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      request.onerror = () =>
        fail(request.error ?? new Error("IndexedDB write request failed"));
      transaction.onerror = () =>
        fail(transaction.error ?? new Error("IndexedDB transaction failed"));
      transaction.onabort = () =>
        fail(transaction.error ?? new Error("IndexedDB transaction aborted"));
      transaction.oncomplete = () => {
        if (settled) {return;}
        settled = true;
        resolve();
      };
    });
  }

  /** Low-level get that does NOT decrypt (used for the device key itself). */
  private async rawGet(id: string): Promise<string | null> {
    return this.enqueue(() =>
      this.withLiveConnection(async (db) => {
        const transaction = db.transaction([SecureStorage.STORE_NAME], "readonly");
        const store = transaction.objectStore(SecureStorage.STORE_NAME);
        const request = store.get(id);
        return new Promise((resolve, reject) => {
          let settled = false;
          let value: string | null = null;
          const finish = (error?: unknown) => {
            if (settled) {return;}
            settled = true;
            if (error) {
              const errorObject = error as {
                name?: unknown;
                message?: unknown;
              } | null;
              // Preserve DOMException instances (including cross-realm ones)
              // so callers can distinguish IndexedDB corruption from a
              // transient storage failure.
              if (
                error instanceof Error ||
                (errorObject &&
                  typeof errorObject.name === "string" &&
                  typeof errorObject.message === "string")
              ) {
                reject(error);
              } else {
                reject(new Error(String(error)));
              }
            } else {
              resolve(value);
            }
          };
          request.onsuccess = () => {
            const result = request.result as SecureData | undefined;
            value = result ? result.value : null;
          };
          request.onerror = () => finish(request.error);
          // Resolve only after the transaction settles so a late abort/error
          // is never reported as a successful read.
          transaction.oncomplete = () => finish();
          transaction.onerror = () => finish(transaction.error);
          transaction.onabort = () =>
            finish(
              transaction.error ||
                new Error("IndexedDB read transaction aborted"),
            );
        });
      }),
    );
  }

  /**
   * Detects encrypted records that would become unreadable if a missing
   * device key were replaced. Raw vault metadata is excluded because it is
   * intentionally readable without the device key.
   */
  private async hasEncryptedSecretRecords(): Promise<boolean> {
    const rawIds = new Set([
      SecureStorage.DEVICE_KEY_ID,
      SecureStorage.IDB_KEY_WRAPPED,
      SecureStorage.IDB_VERIFICATION_TOKEN,
      SecureStorage.IDB_MASTER_PASSWORD_FLAG,
      SecureStorage.IDB_RECOVERY_DATA,
    ]);
    return this.enqueue(() =>
      this.withLiveConnection(async (db) => {
        const transaction = db.transaction([SecureStorage.STORE_NAME], "readonly");
        const store = transaction.objectStore(SecureStorage.STORE_NAME);
        const request = store.openCursor();
        return new Promise((resolve, reject) => {
          let settled = false;
          let found = false;
          const finish = (error?: unknown) => {
            if (settled) {return;}
            settled = true;
            if (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            } else {
              resolve(found);
            }
          };
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              finish(); // cursor exhausted — no more records
              return;
            }
            const record = cursor.value as SecureData;
            if (!rawIds.has(record.id)) {
              found = true;
              finish(); // an encrypted secret exists; the transaction may abort
              return;  // late, without changing the answer
            }
            cursor.continue();
          };
          request.onerror = () => finish(request.error);
          transaction.oncomplete = () => finish();
          transaction.onerror = () => finish(transaction.error);
          transaction.onabort = () =>
            finish(
              transaction.error ||
                new Error("IndexedDB scan transaction aborted"),
            );
        });
      }),
    );
  }

  /**
   * Store a secret securely (encrypted at rest with the device key).
   */
  async setSecret(id: string, encryptedValue: string): Promise<void> {
    try {
      const ciphertext = await this.encryptValue(encryptedValue);
      await this.rawPut(id, ciphertext);
    } catch (error) {
      logger.error("[SecureStorage] Failed to store secret", { error });
      throw error;
    }
  }

  /**
   * Retrieve a secret securely (decrypted with the device key).
   */
  async getSecret(id: string): Promise<string | null> {
    try {
      const ciphertext = await this.rawGet(id);
      if (ciphertext === null) {return null;}
      return await this.decryptValue(ciphertext);
    } catch (error) {
      if (!isDeviceKeyLifecycleError(error)) {
        logger.error("[SecureStorage] Failed to retrieve secret", { error });
      }
      throw error;
    }
  }

  /**
   * Delete a secret
   */
  async deleteSecret(id: string): Promise<void> {
    try {
      await this.enqueue(() =>
        this.withLiveConnection(async (db) => {
          const transaction = db.transaction(
            [SecureStorage.STORE_NAME],
            "readwrite",
          );
          const store = transaction.objectStore(SecureStorage.STORE_NAME);
          const request = store.delete(id);
          await this.waitForWriteTransaction(transaction, request);
        }),
      );
    } catch (error) {
      logger.error("[SecureStorage] Failed to delete secret", { error });
      throw error;
    }
  }

  /**
   * Check if a secret exists (uses rawGet to avoid unnecessary decryption).
   */
  async hasSecret(id: string): Promise<boolean> {
    try {
      const raw = await this.rawGet(id);
      return raw !== null;
    } catch (error) {
      // DOMException can cross the jsdom/Node realm boundary in tests and
      // embedded browser contexts, making `instanceof DOMException` false.
      // Preserve corruption failures by checking the stable name as well;
      // otherwise a DataError is incorrectly downgraded to `false`.
      const errorName =
        error instanceof Error
          ? error.name
          : (error as { name?: unknown } | null)?.name;
      const corruptionNames = [
        "DataError",
        "UnknownError",
        "InvalidStateError",
        "VersionError",
      ];
      const errMsg = error instanceof Error ? error.message : String(error);
      if (
        (typeof errorName === "string" && corruptionNames.includes(errorName)) ||
        corruptionNames.some((name) => errMsg.includes(name))
      ) {
        throw error;
      }
      if (
        errMsg.includes("corrupt") ||
        errMsg.includes("corrupted") ||
        errMsg.includes("malformed")
      ) {
        throw error;
      }
      logger.error("[SecureStorage] Failed to check secret existence", {
        error,
        secretId: id,
      });
      return false;
    }
  }

  /** Low-level delete (used for legacy key migration). */
  private async rawDelete(id: string): Promise<void> {
    return this.enqueue(() =>
      this.withLiveConnection(async (db) => {
        const transaction = db.transaction([SecureStorage.STORE_NAME], "readwrite");
        const store = transaction.objectStore(SecureStorage.STORE_NAME);
        const request = store.delete(id);
        await this.waitForWriteTransaction(transaction, request);
      }),
    );
  }

  /**
   * Clear all secrets (use with caution)
   */
  async clearAll(): Promise<void> {
    try {
      await this.enqueue(() =>
        this.withLiveConnection(async (db) => {
          const transaction = db.transaction(
            [SecureStorage.STORE_NAME],
            "readwrite",
          );
          const store = transaction.objectStore(SecureStorage.STORE_NAME);
          const request = store.clear();

          // Wait for the durable clear before removing the recovery copy of
          // the device key. If the transaction aborts, retaining the key
          // avoids turning a transient quota/IDB failure into permanent
          // data loss.
          await this.waitForWriteTransaction(transaction, request);
          try {
            localStorage.removeItem(SecureStorage.LOCALSTORAGE_KEY_JWK);
          } catch (error) {
            logRateLimited(
              "warn",
              "secure-storage-device-key-clear-recovery",
              "Failed to remove the device-key recovery copy during clear",
              { error: error instanceof Error ? error.message : String(error) },
            );
          }
          this.lockDeviceKey();
        }),
      );
    } catch (error) {
      logger.error("[SecureStorage] Failed to clear secrets", { error });
      throw error;
    }
  }

  /**
   * Migrate data from localStorage to IndexedDB
   */
  async migrateFromLocalStorage(
    localStorageKey: string,
    indexedDBKey: string,
  ): Promise<boolean> {
    try {
      if (typeof window === "undefined") {
        logger.warn(
          "[SecureStorage] localStorage not available in this environment",
        );
        return false;
      }
      const existingValue = safeGet(localStorageKey);
      if (!existingValue) {
        return false; // Nothing to migrate
      }

      // Check if already migrated
      const alreadyMigrated = await this.hasSecret(indexedDBKey);
      if (alreadyMigrated) {
        // Remove from localStorage if already migrated
        safeRemove(localStorageKey);
        return true;
      }

      // Store in IndexedDB
      await this.setSecret(indexedDBKey, existingValue);

      // Remove from localStorage after successful migration
      safeRemove(localStorageKey);

      logger.info(
        `[SecureStorage] Successfully migrated ${localStorageKey} to IndexedDB`,
      );
      return true;
    } catch (error) {
      logger.error(`[SecureStorage] Failed to migrate ${localStorageKey}`, {
        error,
      });
      return false;
    }
  }

  /**
   * Generic get method for non-string values (JSON-serialized).
   * Convenience alias used by plugin services (CostTracker, RoutingOptimizer, etc.).
   */
  async get<T>(id: string): Promise<T | null> {
    const raw = await this.getSecret(id);
    if (raw === null || raw === undefined) {return null;}
    try {
      return JSON.parse(raw) as T;
    } catch (_err) {
      return raw as unknown as T;
    }
  }

  /**
   * Generic set method for non-string values (JSON-serialized).
   * Convenience alias used by plugin services (CostTracker, RoutingOptimizer, etc.).
   */
  async set<T>(id: string, value: T): Promise<void> {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    await this.setSecret(id, serialized);
  }

  /**
   * Alias for deleteSecret. Used by plugin services expecting a .remove() method.
   */
  async remove(id: string): Promise<void> {
    await this.deleteSecret(id);
  }

  /**
   * Close the database connection safely
   */
  async close(): Promise<void> {
    // Serialized against data operations: queued ops finish first, and ops
    // queued after the close transparently reopen on their next init().
    return this.enqueue(async () => {
      try {
        // Closing/resetting storage is also a security boundary. Invalidate
        // pending unwrap/wrap continuations before waiting on IndexedDB so a
        // late crypto promise cannot repopulate the in-memory key.
        this.lockDeviceKey();
        // Wait for any pending initialization to complete
        if (this.initPromise) {
          try {
            await this.initPromise;
          } catch (error) {
            logger.warn("[SecureStorage] Ignoring init error during close", {
              error,
            });
          }
        }

        // Close the database
        if (this.db) {
          this.db.close();
          this.db = null;
        }

        this.initPromise = null;
        logger.info("[SecureStorage] Database connection closed");
      } catch (error) {
        logger.error("[SecureStorage] Error closing database", { error });
      }
    });
  }

  /**
   * Check if database is ready
   */
  isReady(): boolean {
    return this.db !== null;
  }

  /**
   * Purge expired pending API keys that were stored while the vault was
   * locked and never promoted to the encrypted vault. Without this, a
   * plaintext API key persists in IndexedDB indefinitely if the user never
   * unlocks the vault after setting it.
   *
   * Called once on app startup from SecurityVault.
   */
  async purgeExpiredPendingKeys(
    maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
  ): Promise<void> {
    const defaultAgeMs = 7 * 24 * 60 * 60 * 1000;
    const safeMaxAgeMs =
      Number.isFinite(maxAgeMs) && maxAgeMs >= 0
        ? Math.min(maxAgeMs, 365 * 24 * 60 * 60 * 1000)
        : defaultAgeMs;
    try {
      await this.enqueue(() =>
        this.withLiveConnection(async (db) => {
          const tx = db.transaction([SecureStorage.STORE_NAME], "readwrite");
          const store = tx.objectStore(SecureStorage.STORE_NAME);
          const index = store.index("createdAt");
          const cutoff = Date.now() - safeMaxAgeMs;
          const range = IDBKeyRange.upperBound(cutoff);
          const req = index.openCursor(range);

          // The previous implementation returned immediately after registering
          // the cursor callback. Callers could therefore observe completion
          // while the plaintext pending key was still present. Wait for the
          // transaction itself so purgeExpiredPendingKeys has a real
          // completion contract.
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const rejectOnce = (error: unknown) => {
              if (settled) {return;}
              settled = true;
              reject(error instanceof Error ? error : new Error(String(error)));
            };
            tx.oncomplete = () => {
              if (settled) {return;}
              settled = true;
              resolve();
            };
            tx.onerror = () =>
              rejectOnce(
                tx.error ?? new Error("Pending-key purge transaction failed"),
              );
            tx.onabort = () =>
              rejectOnce(
                tx.error ?? new Error("Pending-key purge transaction aborted"),
              );
            req.onsuccess = (e) => {
              const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
              if (!cursor) {return;}
              const record = cursor.value as SecureData;
              // Only purge pending_api_key entries; leave other secrets alone.
              if (record.id === "pending_api_key") {
                cursor.delete();
                logger.info(
                  "[SecureStorage] Purged expired pending_api_key (age > %d days)",
                  Math.round(safeMaxAgeMs / 86400000),
                );
              }
              cursor.continue();
            };
            req.onerror = () =>
              rejectOnce(req.error ?? new Error("Pending-key purge scan failed"));
          });
        }),
      );
    } catch (err) {
      logger.warn("[SecureStorage] purgeExpiredPendingKeys failed", { error: err });
    }
  }

  /**
   * Force re-initialization (useful for recovery)
   */
  async reset(): Promise<void> {
    try {
      await this.close();
      // Next init() call will reinitialize
      logger.info(
        "[SecureStorage] Reset complete, ready for re-initialization",
      );
    } catch (error) {
      logger.error("[SecureStorage] Error during reset", { error });
    }
  }
}

export const secureStorage = new SecureStorage();
