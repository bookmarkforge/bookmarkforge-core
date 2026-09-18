// ADR-019: Argon2id migration / Security hardening (AES-GCM + Argon2id V4)
import i18n from "../i18n";
import { logger, redactSecrets } from "../utils/logger";
import {
  decrypt,
  decryptBinary,
  decryptWithSessionKey,
  deriveDbKey,
  encrypt,
  encryptBinary,
  encryptWithSessionKey,
  generateSecureSalt,
  hashString,
  resetSessionKeyCache,
  setVaultKdfSalt,
} from "../utils/crypto-core";

/**
 * AES-256-GCM encryption service using Argon2id (V4/V5) key derivation.
 * All crypto operations are offloaded to a Web Worker in production.
 *
 * Encrypted format (V5 — current): `v5:<base64(hkdf_salt+iv+ciphertext)>`
 * HKDF salt = 16 bytes, IV = 12 bytes, ciphertext = variable.
 *
 * Encrypted format (V4 — stored data): `v4:<base64(salt+iv+ciphertext)>`
 * Salt = 16 bytes, IV = 12 bytes, ciphertext = variable.
 *
 * V5 derives a master key via Argon2id once (cached per password) and
 * then uses HKDF-SHA256 per operation — ~1000× faster for batches than
 * V4 which ran Argon2id per operation.
 *
 * SECURITY: in production builds the KDF/encryption runs inside a Web
 * Worker (the worker is the only place a derived AES key is materialised,
 * and source password bytes are zeroed inside the worker thread). In
 * automated/test environments (NODE_ENV === "test") the Web Worker may be
 * unavailable or hang (e.g. headless Chromium module-worker quirks), so we
 * fall back to running the SAME crypto-core primitives on the main thread.
 * This keeps tests hermetic without weakening production.
 */
const IS_TEST_ENV =
  (typeof process !== "undefined" && process.env?.NODE_ENV === "test") ||
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { MODE?: string; DEV?: boolean } }).env?.MODE ===
      "test");

/**
 * Encryption can fail during the very first vault boot, before i18next has
 * finished loading its namespace. Calling `i18n.t()` in that window emits a
 * misleading "not initialized" warning and can mask the crypto failure.
 * Preserve the existing key fallback while avoiding the premature lookup.
 */
function localizedError(key: string): string {
  return i18n.isInitialized ? i18n.t(key) : key;
}

export class EncryptionService {
  private static readonly ALGORITHM = "AES-GCM";

  private worker: Worker | null = null;
  private fatalError: Error | null = null;
  private pendingRequests: Map<
    string,
    {
      resolve: (val: string) => void;
      reject: (err: Error) => void;
      resolved: boolean;
    }
  > = new Map();
  private readonly MAX_PENDING_REQUESTS = 100;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  /** When false, crypto runs on the main thread (test/headless fallback). */
  private useWorker = !IS_TEST_ENV;
  /**
   * A-1: per-vault Argon2id salt (32 hex chars) currently installed, or null
   * for legacy mode. Not key material — see crypto-core.setVaultKdfSalt — but
   * it is retained across clear() so that re-initialising the worker (lock /
   * reset) can never silently downgrade new writes to the legacy fixed salt.
   * The security vault re-provisions it on every unlock.
   */
  private vaultKdfSaltHex: string | null = null;

  constructor() {
    this.initWorker();
    this.initPromise = Promise.resolve().then(() => {
      this.initialized = true;
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {return;}
    // Lazily re-initialize after destroy()/clear(). destroy() is called by
    // the security store when entering force-setup (to wipe key material in
    // memory), and the service MUST be usable again once the user creates
    // their vault — otherwise vault setup fails with "not initialized" and
    // the whole first-run flow breaks (regression caught by the E2E smoke
    // suite). A fatal worker error is NOT auto-recovered: runInWorker
    // re-throws it so a compromised/hung worker stays failed.
    if (this.initPromise === null && !this.fatalError) {
      // Only create a fresh worker when the previous one was actually torn
      // down (clear() terminates + nulls it). If initPromise was nulled
      // independently, reusing the live worker avoids a worker leak.
      if (!this.worker) {
        this.initWorker();
      }
      this.initPromise = Promise.resolve().then(() => {
        this.initialized = true;
      });
    }
    if (this.initPromise) {
      await this.initPromise;
      if (!this.initialized)
        {throw new Error("EncryptionService initialization failed");}
      return;
    }
    throw new Error("EncryptionService not initialized");
  }

  private initWorker() {
    if (typeof window !== "undefined" && window.Worker) {
      const worker = new Worker(
        new URL("../workers/crypto.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker = worker;
      if (this.vaultKdfSaltHex) {
        // Re-apply the vault salt to every freshly created worker (worker
        // replacement after clear(), or lazy re-init). Fire-and-forget: the
        // worker's FIFO queue guarantees it lands before any later operation,
        // and there is nothing to await (the salt setter cannot fail for a
        // salt this class already validated).
        try {
          worker.postMessage({
            id: crypto.randomUUID(),
            type: "set-vault-salt",
            payload: { salt: this.vaultKdfSaltHex },
          });
        } catch (error) {
          logger.error("[EncryptionService] Failed to re-apply vault salt", {
            error,
          });
        }
      }
      worker.onmessage = (e) => {
        // Ignore messages queued by a worker that was already replaced.
        if (this.worker !== worker) {return;}
        const { id, result, error, type } = e.data;
        if (type === "FATAL_WORKER_ERROR") {
          const drainError = new Error(error || "Fatal worker error");
          for (const [, pending] of this.pendingRequests) {
            pending.reject(drainError);
            pending.resolved = true;
          }
          this.pendingRequests.clear();
          this.fatalError = drainError;
          if (this.worker === worker) {
            worker.terminate();
            this.worker = null;
          }
          return;
        }
        const pending = this.pendingRequests.get(id);
        if (pending) {
          if (error) {
            pending.reject(new Error(error));
            pending.resolved = true;
          } else {
            pending.resolve(result);
            pending.resolved = true;
          }
          this.pendingRequests.delete(id);
        }
      };
      worker.onerror = (error) => {
        // A worker can emit a queued error after clear() created a
        // replacement. Never let an obsolete worker poison the replacement.
        if (this.worker !== worker) {return;}
        logger.error("[EncryptionService] Crypto worker error", { error });
        const workerError = new Error("Crypto worker encountered an error");
        for (const [, pending] of this.pendingRequests) {
          if (!pending.resolved) {
            pending.reject(workerError);
            pending.resolved = true;
          }
        }
        this.pendingRequests.clear();
        // A worker that emitted an error must never receive subsequent
        // requests. Mark it fatal and terminate it so callers fail fast
        // instead of waiting for the 15-second request timeout.
        this.fatalError = workerError;
        const failedWorker = this.worker;
        if (failedWorker) {
          failedWorker.terminate();
          if (this.worker === failedWorker) {
            this.worker = null;
          }
        }
      };
    }
  }

  /**
   * Double-fill zeroization with reuse guard (fail-closed).
   *
   * XORs every byte with 0xAA between two zero-fills to defeat
   * compiler optimisations that might elide a single fill.  Also
   * warns if the buffer was already all-zeros before the first
   * fill — the caller likely reused a consumed password.
   */
  private zeroBytes(bytes: Uint8Array): Uint8Array {
    if (bytes.length > 0 && bytes.every((b) => b === 0)) {
      logger.warn(
        "[EncryptionService.zeroBytes] Buffer is already zeroized — possible reuse of a consumed password.",
      );
    }
    bytes.fill(0);
    for (let i = 0; i < bytes.length; i++) {bytes[i] = bytes[i]! ^ 0xaa;}
    bytes.fill(0);
    return bytes;
  }

   
  private async runInWorker(
    type: string,
    payload?: Record<string, unknown>,
    passwordBytes?: Uint8Array,
  ): Promise<unknown> {
    if (this.fatalError) {
      if (passwordBytes) {this.zeroBytes(passwordBytes);}
      throw this.fatalError;
    }

    // Test/headless fallback: run the SAME crypto-core primitives on the
    // main thread (the Web Worker is unavailable or hangs in headless
    // Chromium). Production ALWAYS uses the worker (useWorker === true).
    if (!this.useWorker) {
      return await this.runOnMainThread(type, payload, passwordBytes);
    }

    if (!this.worker) {
      try {
        await this.initWorker();
      } catch (error) {
        if (passwordBytes) {this.zeroBytes(passwordBytes);}
        throw error;
      }
    }
    if (!this.worker) {
      if (passwordBytes) {this.zeroBytes(passwordBytes);}
      throw new Error("Web Worker API is not available");
    }

    if (this.pendingRequests.size >= this.MAX_PENDING_REQUESTS) {
      // Do not leave caller-owned password bytes alive when rejecting before
      // the worker request is registered.
      if (passwordBytes) {this.zeroBytes(passwordBytes);}
      throw new Error("Crypto worker request queue is full");
    }

    const id = crypto.randomUUID();
    const pending: {
      resolve: (val: string) => void;
      reject: (err: Error) => void;
      resolved: boolean;
    } = { resolve: () => {}, reject: () => {}, resolved: false };
    this.pendingRequests.set(id, pending);

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const p = this.pendingRequests.get(id);
        if (p && !p.resolved) {
          const err = new Error(`Worker timeout for ${type}`);
          p.reject(err);
          p.resolved = true;
          this.pendingRequests.delete(id);
          // A timed-out crypto worker may be stuck behind an operation that
          // never settles. Retire it immediately so queued requests cannot
          // accumulate behind a dead session-key cache.
          this.fatalError = err;
          const timedOutWorker = this.worker;
          if (timedOutWorker) {
            timedOutWorker.terminate();
            if (this.worker === timedOutWorker) {
              this.worker = null;
            }
          }
        }
      }, 15000);

      pending.resolve = (val: string) => {
        clearTimeout(timer);
        resolve(val);
      };
      pending.reject = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };

      const payloadToSend = { ...payload };
      if (passwordBytes) {
        payloadToSend.passwordBytes = passwordBytes;
        delete payloadToSend.password;
      }
      try {
        this.worker?.postMessage({ id, type, payload: payloadToSend });
      } catch (error) {
        pending.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
        pending.resolved = true;
        this.pendingRequests.delete(id);
      } finally {
        if (passwordBytes) {this.zeroBytes(passwordBytes);}
      }
    });
    return result;
  }

  /**
   * Main-thread dispatcher used in test/headless environments where the
   * crypto Web Worker is unavailable. Mirrors the worker's message
   * handler exactly, calling the shared `crypto-core` primitives.
   */
   
  private async runOnMainThread(
    type: string,
    payload?: Record<string, unknown>,
    passwordBytes?: Uint8Array,
  ): Promise<unknown> {
    let generatedPasswordBytes: Uint8Array | null = null;
    const getPw = (): Uint8Array => {
      if (passwordBytes) {
        // crypto-core consumes its Uint8Array input. Keep the wrapper's
        // caller-owned buffer for the final zeroization below and hand the
        // primitive a fresh copy, avoiding a misleading second zeroization
        // warning while preserving the ownership contract.
        return new Uint8Array(passwordBytes);
      }
      const p = payload?.password;
      if (typeof p === "string") {
        const bytes = new TextEncoder().encode(p);
        generatedPasswordBytes = bytes;
        payload = { ...payload };
        delete payload!.password;
        return bytes;
      }
      throw new Error("Missing password or passwordBytes in payload");
    };
    try {
      switch (type) {
        case "encrypt":
          return await encrypt(payload!.text as string, getPw());
        case "decrypt":
          return await decrypt(payload!.encryptedBase64 as string, getPw());
        case "encryptBinary":
          return await encryptBinary(payload!.data as Uint8Array, getPw());
        case "decryptBinary":
          return await decryptBinary(payload!.data as Uint8Array, getPw());
        case "deriveDbKey":
          return await deriveDbKey(getPw(), payload!.salt as string);
        case "encryptWithSessionKey":
          return await encryptWithSessionKey(
            payload!.data as Uint8Array,
            getPw(),
          );
        case "decryptWithSessionKey":
          return await decryptWithSessionKey(
            payload!.data as Uint8Array,
            getPw(),
          );
        case "hash":
          return await hashString(payload!.input as string);
        case "generateSecureSalt":
          return generateSecureSalt();
        case "set-vault-salt": {
          const salt = payload?.salt;
          setVaultKdfSalt(typeof salt === "string" ? salt : null);
          return "ok";
        }
        case "reset-session":
        case "clearDatabase":
          resetSessionKeyCache();
          return "ok";
        default:
          throw new Error(`Unknown crypto operation: ${type}`);
      }
    } finally {
      if (passwordBytes) {this.zeroBytes(passwordBytes);}
      // String passwords are converted to a temporary byte buffer on the
      // main-thread fallback. It has no caller-owned reference, so clear it
      // here as well instead of leaving it for GC.
      // Read through a cast: the assignment happens inside getPw(), which is
      // invisible to control-flow analysis and would otherwise narrow this
      // buffer to its null initializer.
      const generated = generatedPasswordBytes as Uint8Array | null;
      if (generated) {generated.fill(0);}
    }
  }

  /**
   * A-1: install (or clear) the per-vault Argon2id salt used by the v5/v6 and
   * session-key derivations.
   *
   * Callers own persistence: the security vault stores the salt in
   * SecureStorage and calls this on every unlock. Passing `null` restores
   * legacy fixed-salt behaviour (only tests and locked-vault paths do this).
   *
   * @param saltHex - 32 lowercase hex chars, or null.
   */
  async configureVaultKdfSalt(saltHex: string | null): Promise<void> {
    const normalized = saltHex === null ? null : saltHex.trim().toLowerCase();
    // Fail loudly on malformed input: a silently ignored salt would leave the
    // vault encrypting under the legacy fixed salt.
    setVaultKdfSalt(normalized);
    this.vaultKdfSaltHex = normalized;
    if (this.worker && this.useWorker) {
      try {
        this.worker.postMessage({
          id: crypto.randomUUID(),
          type: "set-vault-salt",
          payload: { salt: normalized },
        });
      } catch (error) {
        // A failed post leaves the worker on the previous salt, which would
        // mix formats within a session; surface it instead of hiding it.
        logger.error("[EncryptionService] Failed to configure vault salt", {
          error,
        });
        throw error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  /** The vault KDF salt currently installed, or null in legacy mode. */
  getVaultKdfSaltHex(): string | null {
    return this.vaultKdfSaltHex;
  }

  async encrypt(text: string, password: string): Promise<string> {
    await this.ensureInitialized();
    try {
      return await this.runInWorker("encrypt", { text, password }) as string;
    } catch (error) {
      logger.error("[EncryptionService] Encryption failed", { error: redactSecrets(error instanceof Error ? error.message : String(error)) });
      throw new Error(localizedError("encryptionError"));
    }
  }

  async encryptWithBytes(text: string, password: Uint8Array): Promise<string> {
    await this.ensureInitialized();
    try {
      return await this.runInWorker("encrypt", { text }, password) as string;
    } catch (error) {
      logger.error("[EncryptionService] encryptWithBytes failed", { error: redactSecrets(error instanceof Error ? error.message : String(error)) });
      throw new Error(localizedError("encryptionError"));
    }
  }

  async decrypt(encryptedBase64: string, password: string): Promise<string> {
    await this.ensureInitialized();
    try {
      return await this.runInWorker("decrypt", { encryptedBase64, password }) as string;
    } catch (error) {
      logger.error("[EncryptionService] Decryption failed", { error: redactSecrets(error instanceof Error ? error.message : String(error)) });
      throw new Error(localizedError("decryptionError"));
    }
  }

  async decryptWithBytes(
    encryptedBase64: string,
    password: Uint8Array,
  ): Promise<string> {
    await this.ensureInitialized();
    try {
      return await this.runInWorker("decrypt", { encryptedBase64 }, password) as string;
    } catch (error) {
      logger.error("[EncryptionService] decryptWithBytes failed", { error: redactSecrets(error instanceof Error ? error.message : String(error)) });
      throw new Error(localizedError("decryptionError"));
    }
  }

  async encryptWithSessionKey(
    data: Uint8Array,
    password: string,
  ): Promise<Uint8Array> {
    await this.ensureInitialized();
    try {
      return await this.runInWorker("encryptWithSessionKey", {
        data,
        password,
      }) as Uint8Array;
    } catch (error) {
      logger.error("[EncryptionService] SessionKey encryption failed", {
        error: redactSecrets(error instanceof Error ? error.message : String(error)),
      });
      throw new Error(localizedError("encryptionError"));
    }
  }

  async decryptWithSessionKey(
    data: Uint8Array,
    password: string,
  ): Promise<Uint8Array> {
    await this.ensureInitialized();
    try {
      return await this.runInWorker("decryptWithSessionKey", {
        data,
        password,
      }) as Uint8Array;
    } catch (error) {
      logger.error("[EncryptionService] SessionKey decryption failed", {
        error: redactSecrets(error instanceof Error ? error.message : String(error)),
      });
      throw new Error(localizedError("decryptionError"));
    }
  }

  async encryptBinary(data: Uint8Array, password: string): Promise<Uint8Array> {
    await this.ensureInitialized();
    try {
      return await this.runInWorker("encryptBinary", { data, password }) as Uint8Array;
    } catch (error) {
      logger.error("[EncryptionService] Binary encryption failed", { error: redactSecrets(error instanceof Error ? error.message : String(error)) });
      throw new Error(localizedError("encryptionError"));
    }
  }

  async decryptBinary(data: Uint8Array, password: string): Promise<Uint8Array> {
    await this.ensureInitialized();
    try {
      return await this.runInWorker("decryptBinary", { data, password }) as Uint8Array;
    } catch (error) {
      logger.error("[EncryptionService] Binary decryption failed", { error: redactSecrets(error instanceof Error ? error.message : String(error)) });
      throw new Error(localizedError("decryptionError"));
    }
  }

  async deriveDbKey(password: string, salt: string): Promise<string> {
    await this.ensureInitialized();
    try {
      return await this.runInWorker("deriveDbKey", { password, salt }) as string;
    } catch (error) {
      logger.error("[EncryptionService] DB key derivation failed", { error: redactSecrets(error instanceof Error ? error.message : String(error)) });
      throw new Error(localizedError("encryptionError"));
    }
  }

  async deriveDbKeyWithBytes(
    password: Uint8Array,
    salt: string,
  ): Promise<string> {
    await this.ensureInitialized();
    try {
      return await this.runInWorker("deriveDbKey", { salt }, password) as string;
    } catch (error) {
      logger.error("[EncryptionService] DB key derivation (bytes) failed", {
        error: redactSecrets(error instanceof Error ? error.message : String(error)),
      });
      throw new Error(localizedError("encryptionError"));
    }
  }

  async hash(data: string): Promise<string> {
    await this.ensureInitialized();
    try {
      return await this.runInWorker("hash", { input: data }) as string;
    } catch (error) {
      logger.error("[EncryptionService] Hash failed", { error: redactSecrets(error instanceof Error ? error.message : String(error)) });
      throw new Error(localizedError("encryptionError"));
    }
  }

  /**
   * Checks whether a string appears to be V4, V5 or V6 encrypted data.
   * Uses a strict base64 regex to avoid atob/btoa side effects and OOM risks.
   * Minimum body length of 40 base64 chars (~30 decoded bytes: 16 hkdf_salt
   * + 12 iv + 1+ ciphertext) prevents trivial spoofs like "v5:AAAA".
   */
  isEncrypted(str: string): boolean {
    if (typeof str !== "string" || !str) {return false;}
    const prefix =
      str.startsWith("v6:") || str.startsWith("v5:") || str.startsWith("v4:");
    if (!prefix) {return false;}
    const body = str.slice(3);
    // Minimum: 16-byte salt/hkdf_salt + 12-byte IV + 1-byte ciphertext
    // = 29 bytes → ~40 base64 characters.
    if (body.length < 40) {return false;}
    return /^[A-Za-z0-9+/]+={0,2}$/.test(body);
  }

  async clearDatabase(userPassword: string): Promise<void> {
    await this.ensureInitialized();
    try {
      await this.runInWorker("clearDatabase", { userPassword });
    } catch (error) {
      logger.error("[EncryptionService] Clear database failed", { error: redactSecrets(error instanceof Error ? error.message : String(error)) });
      throw new Error(localizedError("encryptionError"));
    }
  }

  async destroy(): Promise<void> {
    await this.clear();
  }

  async clear(): Promise<void> {
    // The main-thread fallback and the crypto worker each own a session-key
    // cache. Reset both explicitly; terminating the worker alone is not
    // sufficient in headless/dev environments.
    resetSessionKeyCache();
    const clearError = new Error("EncryptionService cleared");
    for (const pending of this.pendingRequests.values()) {
      if (!pending.resolved) {
        pending.reject(clearError);
        pending.resolved = true;
      }
    }
    this.pendingRequests.clear();
    this.fatalError = null;
    this.initPromise = null;
    this.initialized = false;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export const encryptionService = new EncryptionService();
