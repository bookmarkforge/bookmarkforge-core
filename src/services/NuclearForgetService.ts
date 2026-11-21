/**
 * S4/R12 fix: Nuclear Forget Service.
 *
 * Implements the user's "Right to be Forgotten" guarantee under GDPR Art. 17.
 *
 * `nuclearForget()` destroys:
 *   1. RxDB main database (`bookmarkforge_v5` IndexedDB)
 *   2. SecureStorage vault (`bookmarkforge_secure_vault`)
 *   3. Voy HNSW index (`VoyIndexDB` — encrypted since S2)
 *   3b. Semantic cache index (`bookmarkforge-semantic-cache` — persisted AI responses)
 *   4. All auto-backup blobs
 *   5. Local audit log
 *   6. Cached embeddings + API keys in memory
 *   7. RxDB dev mode cache (rxdb-dev-mode)
 *
 * After nuclearForget, the app shows a fresh-install UI. The user is also
 * reminded that PEER devices with prior sync may still retain copies. Breaking
 * sync requires a separate action on each peer (out of scope here).
 *
 * SAFETY: the operation requires either `password` (vault pre-unlock confirmation)
 * or `confirm: true` (explicit user confirmation). Without one, throws.
 *
 * Idempotent: if a target IDB doesn't exist, skip silently.
 */

import { logger } from "../utils/logger";
import { securityVault } from "./SecurityVault";
import { getRateLimitState } from "../store/rateLimitStore";
import { secureStorage } from "./SecureStorage";
import { destroyDB } from "../db/database";
import { auditLog } from "./AuditLogService";
import { safeRemove, safeSessionClear } from "../store/safeStorage";
import { logRateLimited } from "../utils/boundedLog";

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface NuclearForgetOptions {
  /** Master password verification (recommended when vault is unlocked). */
  password?: string;
  /** Explicit user acknowledgement — set true if user saw and confirmed the warning. */
  confirm: boolean;
  /** Skip audit log entry (true in tests; false in production). */
  skipAudit?: boolean;
  /**
   * LocalStorage keys to PRESERVE in addition to the default allowlist
   * (`i18nextLng`, `forge_csp_profile`). Power users can extend; default is
   * minimal to maximise user's "delete everything" intent.
   */
  preserveKeys?: ReadonlyArray<string>;
}

interface NuclearForgetReport {
  wiped: string[];
  failed: { target: string; reason: string }[];
  durationMs: number;
}

const VOY_DB = "VoyIndexDB";
const RXDB_DB = "bookmarkforge_v5";
const SECURE_DB = "bookmarkforge_secure_vault";
const RXDB_DEV_DB = "rxdb-dev-mode";
const ERROR_REPORTER_DB = "bookmarkforge-errors";
const SUPPORT_DIAGNOSTICS_DB = "bmf-support-diag";

function deleteIndexedDB(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve();
      return;
    }
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () =>
      reject(req.error || new Error(`Failed to delete ${name}`));
    req.onblocked = () => {
      // A blocked deletion means data may still be readable. Do not report
      // this target as wiped; callers need an explicit failure to surface the
      // remaining connection and retry after it is closed.
      const error = new Error(
        `Deletion of ${name} blocked by an open connection`,
      );
      logger.warn(`[NuclearForget] ${error.message}`);
      reject(error);
    };
  });
}

async function wipeLocalStorageByAllowlist(
  preserve: ReadonlyArray<string>,
): Promise<{ removed: number; kept: number }> {
  if (typeof localStorage === "undefined") {return { removed: 0, kept: 0 };}
  const preserveSet = new Set(preserve);
  let removed = 0;
  let kept = 0;
  // Snapshot keys first (mutating during iteration is forbidden).
  const snapshot: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    snapshot.push(localStorage.key(i) ?? "");
  }
  for (const k of snapshot) {
    if (!k) {continue;}
    if (preserveSet.has(k)) {
      kept += 1;
      continue;
    }
    safeRemove(k);
    removed += 1;
  }
  return { removed, kept };
}

// HIGH #6 (post-review): write the audit record to a dedicated IndexedDB
// BEFORE we wipe the main IDBs, so the user can read a permanent forensic
// record of the action if needed (this IDB survives nuclearForget because
// the user can opt to delete it manually afterwards).
import { STORAGE_KEYS } from "../constants/storage-keys";

const NUCLEAR_AUDIT_DB = STORAGE_KEYS.NUCLEAR_AUDIT;
export const NUCLEAR_AUDIT_STORE = "audit";
const NUCLEAR_AUDIT_KEY = "last_forget";

async function recordPreWipeAudit(
  payload: Record<string, string>,
): Promise<void> {
  if (typeof indexedDB === "undefined") {return;}
  let db: IDBDatabase | null = null;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(NUCLEAR_AUDIT_DB, 1);
      req.onupgradeneeded = (e) => {
        const d = (e.target as IDBOpenDBRequest).result;
        if (!d.objectStoreNames.contains(NUCLEAR_AUDIT_STORE)) {
          d.createObjectStore(NUCLEAR_AUDIT_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () =>
        reject(new Error("Nuclear audit database open was blocked"));
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(NUCLEAR_AUDIT_STORE, "readwrite");
      tx.objectStore(NUCLEAR_AUDIT_STORE).put(
        { ...payload, ts: new Date().toISOString() },
        NUCLEAR_AUDIT_KEY,
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error("Nuclear audit transaction aborted"));
    });
  } catch (e) {
    logger.warn("[NuclearForget] Failed to write pre-wipe audit", { error: e });
  } finally {
    // Close even when the transaction fails; otherwise this audit connection
    // can itself block the subsequent nuclear deletion of IndexedDB files.
    db?.close();
  }
}

class NuclearForgetService {
  private listeners: Array<(report: NuclearForgetReport) => void> = [];
  private inFlight: Promise<NuclearForgetReport> | null = null;

  onComplete(cb: (report: NuclearForgetReport) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  /**
   * Permanently destroys ALL local BookmarkForge data, including:
   *   - vault, databases, indexes
   *   - API keys & recovery data
   *   - audit log
   *   - in-memory caches (master password bytes, embeddings, AI service state)
   *
   * Peer devices that previously synced via P2P must delete their own copies.
   *
   * @throws if `confirm !== true` AND no `password` provided
   */
  async nuclearForget(
    opts: NuclearForgetOptions,
  ): Promise<NuclearForgetReport> {
    if (!opts.confirm) {
      throw new Error(
        "NuclearForget requires explicit confirm:true.",
      );
    }
    // Destructive cleanup is single-flight. Concurrent confirmation clicks
    // must not interleave database deletion, storage wiping, and listeners.
    if (this.inFlight) {
      return this.inFlight;
    }
    const operation = this.nuclearForgetInternal(opts);
    this.inFlight = operation;
    operation.finally(() => {
      if (this.inFlight === operation) {
        this.inFlight = null;
      }
    }).catch(() => undefined);
    return operation;
  }

  private async nuclearForgetInternal(
    opts: NuclearForgetOptions,
  ): Promise<NuclearForgetReport> {
    if (opts.password) {
      const isValid = await securityVault.verifyPasswordRateLimited(opts.password);
      if (!isValid) {
        // RL-1: the check runs through the same lockout gate as unlock().
        // A locked-out vault rejects even the correct password, so report
        // that distinctly instead of a misleading "wrong password".
        if (Date.now() < getRateLimitState().lockoutUntil) {
          throw new Error(
            "NuclearForget: vault is rate limited. Try again after the lockout window.",
          );
        }
        throw new Error(
          "NuclearForget: incorrect master password. Operation aborted.",
        );
      }
    }

    const start = Date.now();
    const report: NuclearForgetReport = {
      wiped: [],
      failed: [],
      durationMs: 0,
    };

    // Persist an intent record before the first destructive mutation. If the
    // tab crashes or an IDB deletion is blocked, the surviving audit DB still
    // proves that the operation started and must not be mistaken for success.
    if (!opts.skipAudit) {
      await recordPreWipeAudit({
        action: "nuclear_forget_started",
        result: "pending",
        origin: "NuclearForgetService",
      });
    }

    // ---- 0b. Suspend the audit log before any destructive step ----
    // The wipe deletes SecureStorage (vault + audit log) below. From this
    // point on, NOTHING may flush through auditLog — including the
    // `vault_lock` entry lock() queues in the next step and the pagehide
    // forceFlush that fires while the page reloads after the wipe. A flush
    // would recreate the secure vault IndexedDB with a freshly minted
    // device key, silently undoing the wipe. The forensic entry is written
    // to the dedicated audit IDB (step 10), never through auditLog.
    auditLog.suspend();

    // ---- 1. Lock vault and zero password bytes ----
    try {
      await securityVault.lock();
      report.wiped.push("vault-lock");
    } catch (e: unknown) {
      report.failed.push({
        target: "vault-lock",
        reason: reason(e),
      });
    }

    // ---- 2. Destroy RxDB main instance (in-memory) ----
    try {
      await destroyDB();
      report.wiped.push("rxdb-instance-destroy");
    } catch (e: unknown) {
      report.failed.push({
        target: "rxdb-instance-destroy",
        reason: reason(e),
      });
    }

    // ---- 3. Drop RxDB on-disk IndexedDB ----
    try {
      await deleteIndexedDB(RXDB_DB);
      report.wiped.push(`idb:${RXDB_DB}`);
    } catch (e: unknown) {
      report.failed.push({
        target: `idb:${RXDB_DB}`,
        reason: reason(e),
      });
    }

    // ---- 4. Clear, close, then drop the SecureStorage vault ----
    // Order matters: clearAll() runs FIRST against the live connection
    // (clears ciphertexts, removes the device-key JWK from localStorage,
    // drops the in-memory key), then close() releases the connection so
    // the drop is not blocked, then deleteDatabase() removes the vault.
    // Running clearAll() AFTER the drop would silently RECREATE the vault:
    // openDB() on a deleted database mints a fresh empty store, reopening
    // a device-key minting path. The wipe must end with no
    // bookmarkforge_secure_vault database at all.
    try {
      await secureStorage.clearAll();
      report.wiped.push("secure-storage-clearAll");
    } catch (e: unknown) {
      report.failed.push({
        target: "secure-storage-clearAll",
        reason: reason(e),
      });
    }
    try {
      await secureStorage.close();
      report.wiped.push("secure-storage-close");
    } catch (e: unknown) {
      report.failed.push({
        target: "secure-storage-close",
        reason: reason(e),
      });
    }
    try {
      await deleteIndexedDB(SECURE_DB);
      report.wiped.push(`idb:${SECURE_DB}`);
    } catch (e: unknown) {
      report.failed.push({
        target: `idb:${SECURE_DB}`,
        reason: reason(e),
      });
    }

    // ---- 5. Drop Voy HNSW index IndexedDB (encrypted since S2) ----
    try {
      await deleteIndexedDB(VOY_DB);
      report.wiped.push(`idb:${VOY_DB}`);
    } catch (e: unknown) {
      report.failed.push({
        target: `idb:${VOY_DB}`,
        reason: reason(e),
      });
    }

    // ---- 5b. Drop semantic cache IndexedDB (persisted AI responses) ----
    try {
      const { SEMANTIC_CACHE_DB, semanticCache } =
        await import("./ai/SemanticCacheService");
      // Clear the store AND release the connection first — otherwise
      // deleteDatabase is blocked by the open connection and the persisted
      // AI responses would survive the "Right to be Forgotten".
      await semanticCache.wipePersistence();
      await deleteIndexedDB(SEMANTIC_CACHE_DB);
      report.wiped.push(`idb:${SEMANTIC_CACHE_DB}`);
    } catch (e: unknown) {
      report.failed.push({
        target: "idb:semantic-cache",
        reason: reason(e),
      });
    }

    // ---- 6. Drop RxDB dev-mode cache ----
    try {
      await deleteIndexedDB(RXDB_DEV_DB);
      report.wiped.push(`idb:${RXDB_DEV_DB}`);
    } catch (_err) {
      // Optional — ignore if not present
    }

    // ---- 6b. Drop local diagnostic/error databases ----
    // These stores are opt-in and sanitized, but they can still contain
    // user-derived error messages, URLs, or stack context. A nuclear wipe
    // must remove them rather than relying on their retention limits.
    for (const name of [ERROR_REPORTER_DB, SUPPORT_DIAGNOSTICS_DB]) {
      try {
        await deleteIndexedDB(name);
        report.wiped.push(`idb:${name}`);
      } catch (e: unknown) {
        report.failed.push({
          target: `idb:${name}`,
          reason: reason(e),
        });
      }
    }

    // ---- 8. Wipe localStorage (HIGH #10: clear all with small allowlist) ----
    // User-confirmed nuclearForget must respect their wish: clear everything
    // they accumulated. We preserve only:
    //   - i18nextLng (UI language, not sensitive)
    //   - forge_csp_profile (user setting, recreated on next install)
    //   - any extra keys passed via opts.preserveKeys
    try {
      const defaultAllow = ["i18nextLng", STORAGE_KEYS.CSP_PROFILE];
      // Maintenance history contains only bounded operational metadata, but
      // it belongs to this feature's local state and must not survive a full
      // user-requested wipe.
      safeRemove(STORAGE_KEYS.INTELLIGENT_MAINTENANCE_HISTORY);
      const allow = Array.from(
        new Set([...defaultAllow, ...(opts.preserveKeys ?? [])]),
      );
      const result = await wipeLocalStorageByAllowlist(allow);
      report.wiped.push(
        `localStorage(${result.removed}-removed/${result.kept}-kept)`,
      );
    } catch (e: unknown) {
      report.failed.push({
        target: "localStorage",
        reason: reason(e),
      });
    }
    try {
      safeSessionClear();
      report.wiped.push("sessionStorage");
    } catch (e: unknown) {
      report.failed.push({
        target: "sessionStorage",
        reason: reason(e),
      });
    }

    // ---- 8b. Clear Cache API, Service Worker registrations and WASM cache ----
    // HIGH #A1 fix: a "Right to be Forgotten" must not leave reconstructed
    // data in browser caches or a live service worker that can repopulate them.
    try {
      if (typeof caches !== "undefined") {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((k) => caches.delete(k)));
        if (cacheKeys.length) {report.wiped.push(`caches:${cacheKeys.length}`);}
      }
    } catch (e: unknown) {
      report.failed.push({
        target: "cache-api",
        reason: reason(e),
      });
    }
    try {
      if (typeof navigator !== "undefined" && navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        if (regs.length) {report.wiped.push(`sw:${regs.length}`);}
      }
    } catch (e: unknown) {
      report.failed.push({
        target: "service-worker",
        reason: reason(e),
      });
    }
    try {
      const { clearWASMCache } = await import("../utils/wasm-core");
      clearWASMCache();
      report.wiped.push("wasm-cache");
    } catch (e: unknown) {
      report.failed.push({
        target: "wasm-cache",
        reason: reason(e),
      });
    }

    // ---- 9. Clear in-memory caches ----
    try {
      // AI request cache, semantic cache, embeddings, etc.
      const { ragEngine } = await import("./ai/RAGEngine");
      await ragEngine.unload();
      report.wiped.push("ai-cache");
    } catch (e: unknown) {
      report.failed.push({
        target: "ai-cache",
        reason: reason(e),
      });
    }

    // ---- 10. Forensic audit record (the ONLY post-wipe audit write) ----
    // recordPreWipeAudit targets the dedicated forensic IDB
    // (forge_nuclear_audit/last_forget), which survives the wipe on purpose
    // so the user can read a permanent record of the action. Do NOT mirror
    // this to auditLog.record(): the audit log lives in SecureStorage,
    // which was deleted above — a queued flush would recreate the secure
    // vault IDB with a fresh device key, and the page reload right after
    // the wipe would force exactly that flush via the pagehide handler.
    if (!opts.skipAudit) {
      try {
        await recordPreWipeAudit({
          action: "nuclear_forget_executed",
          result: report.failed.length === 0 ? "success" : "failure",
          origin: "NuclearForgetService",
          wipedCount: String(report.wiped.length),
          failedCount: String(report.failed.length),
        });
      } catch (e: unknown) {
        logger.warn("[NuclearForget] recordPreWipeAudit failed", { error: e });
      }
    }

    report.durationMs = Date.now() - start;
    logger.info("[NuclearForget] Complete", { report });

    for (const cb of this.listeners) {
      try {
        cb(report);
      } catch (error) {
        // One observer must not prevent the remaining wipe listeners from
        // running, but callback failures remain diagnosable and bounded.
        logRateLimited(
          "warn",
          "nuclear-forget-listener",
          "Nuclear Forget listener failed",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }

    return report;
  }
}

export const nuclearForgetService = new NuclearForgetService();
