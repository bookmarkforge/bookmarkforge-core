import { secureStorage } from "./SecureStorage";
import { logger } from "../utils/logger";
import { safeParseJsonArray } from "../utils/safeJsonArray";
import { safeErrorForLog } from "../utils/safeErrorForLog";

/**
 * AuditLogService — Structured, persistent audit log for security-sensitive actions.
 *
 * Complies with the secure-code-review-checklist requirement:
 * "All sensitive user actions are logged with: Where, What, When, Who, How answered"
 *
 * Logs are stored encrypted in SecureStorage (IndexedDB). Each entry captures:
 * - id: unique identifier
 * - timestamp: when it happened (ISO 8601)
 * - action: what was done (categorical enum)
 * - target: what was affected (resource id, domain)
 * - result: success | failure | denied
 * - origin: where the action originated (component, service, worker)
 * - context: optional structured metadata (HOW — method, HTTP verb, etc.)
 * - sessionId: correlated session identifier (WHO — anonymized, not PII)
 *
 * Privacy-first: NO PII (no IP, no user agent, no email, no device fingerprint).
 * Max 200 entries (S6-R10 scope reduction); oldest evicted on overflow.
 * Internal storage key names are sanitized to generic labels.
 */

export type AuditAction =
  | "vault_unlock"
  | "vault_lock"
  | "vault_unlock_failed"
  | "master_password_rotate"
  | "secret_encrypt"
  | "secret_decrypt"
  | "secret_delete"
  | "api_key_stored"
  | "api_key_used"
  | "api_key_deleted"
  | "network_origin_added"
  | "network_origin_removed"
  | "backup_exported"
  | "backup_imported"
  | "auto_backup_disk"
  | "settings_exported"
  | "settings_imported"
  | "data_exported"
  | "data_imported"
  | "license_validated"
  | "license_activated"
  | "license_deactivated"
  | "sync_started"
  | "sync_completed"
  | "share_created"
  | "share_accepted"
  | "recovery_phrase_set"
  | "recovery_phrase_used"
  | "recovery_phrase_cleared"
  | "suspicious_environment_detected"
  | "firewall_blocked_request"
  | "bundle_integrity_failed"
  | "vault_unlock_from_share"
  // Post-audit additions (2026-07-14, see AUDITORIA_SEGURIDAD.md § S4):
  | "nuclear_forget_executed"
  | "voy_index_encrypted"
  | "csp_report_throttled"
  | "voy_index_decrypt_failed"
  | "key_version_upgraded"
  | "audit_integrity_failed"
  | "license_state_tampered"
  | "license_signature_invalid";

export type AuditResult = "success" | "failure" | "denied";

export interface AuditEntry {
  id: string;
  timestamp: string; // ISO 8601
  action: AuditAction;
  target: string; // resource id, domain, or "system"
  result: AuditResult;
  origin: string; // component/service name
  context?: Record<string, string>; // sanitized metadata
  sessionId: string; // anonymized session correlation
}

const STORAGE_KEY = "audit_log";

/** Fallback key for unflushed entries when IndexedDB flush can't complete
 *  (e.g. during pagehide). sessionStorage is synchronous and survives the
 *  unload, so entries written here are picked up on next boot. */
const PENDING_FALLBACK_KEY = "audit_pending_fallback";
const MAX_ENTRIES = 200;

let currentSessionId: string | null = null;

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Returns the current anonymized session identifier.
 * Regenerated on vault lock/unlock to break correlation across sessions.
 */
export function getAuditSessionId(): string {
  if (!currentSessionId) {
    currentSessionId = `s_${generateId()}`;
  }
  return currentSessionId;
}

/** Rotates the session ID for privacy (call on vault lock). Sets to null so next unlock lazily generates a new one. */
export function rotateAuditSessionId(): void {
  currentSessionId = null;
}

// Internal storage key prefixes that should not leak into audit logs
const INTERNAL_KEY_PREFIXES = [
  "encrypted_",
  "vault_",
  "recovery_",
  "secure_",
  "backup_",
  "session_",
];

/** Sanitizes target values to prevent leaking internal storage key names. */
function sanitizeTarget(target: string): string {
  const lower = target.toLowerCase();
  for (const prefix of INTERNAL_KEY_PREFIXES) {
    if (lower.startsWith(prefix)) {return "internal_key";}
  }
  return target;
}

/** Sanitizes context values to prevent log injection or PII leaks. */
function sanitizeContextValue(value: string): string {
  return (
    value
      .replace(/[\n\r\t]/g, " ")
      .replace(/password[=:]\s*\S+/gi, "password=[REDACTED]")
      .replace(/api[_-]?key[=:]\s*\S+/gi, "api_key=[REDACTED]")
      .replace(/token[=:]\s*\S+/gi, "token=[REDACTED]")
      .replace(/secret[=:]\s*\S+/gi, "secret=[REDACTED]")
      // Redact common cloud API-key prefixes that may appear in URLs/JSON.
      .replace(/\b(sk-[a-zA-Z0-9]{8,})/g, "sk-[REDACTED]")
      .replace(/\b(gsk_[a-zA-Z0-9]{8,})/g, "gsk_[REDACTED]")
      .replace(/\b(AIza[0-9A-Za-z_-]{8,})/g, "AIza[REDACTED]")
      .replace(/\b(xox[baprs]-[a-zA-Z0-9-]{8,})/g, "xox[REDACTED]")
      .substring(0, 200)
  );
}

/**
 * The page-unload fallback is sessionStorage, not encrypted SecureStorage.
 * Keep only a whitelisted audit shape there: action/result/origin/timestamp.
 * Targets, contexts, and session identifiers can contain user-derived values
 * and must never be copied to the plaintext fallback surface.
 */
function sanitizeFallbackEntry(entry: Partial<AuditEntry>): AuditEntry {
  const action: AuditAction =
    typeof entry.action === "string"
      ? entry.action as AuditAction
      : "audit_integrity_failed";
  const result: AuditResult =
    entry.result === "success" ||
    entry.result === "failure" ||
    entry.result === "denied"
      ? entry.result
      : "failure";
  const timestamp =
    typeof entry.timestamp === "string" &&
    Number.isFinite(new Date(entry.timestamp).getTime())
      ? entry.timestamp
      : new Date().toISOString();

  return {
    id: typeof entry.id === "string" ? entry.id : generateId(),
    timestamp,
    action,
    target: "system",
    result,
    origin:
      typeof entry.origin === "string"
        ? sanitizeContextValue(entry.origin).substring(0, 100)
        : "AuditLogService",
    sessionId: "fallback",
  };
}

class AuditLogService {
  private cache: AuditEntry[] | null = null;
  private pendingWrites: AuditEntry[] = [];
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  // NuclearForgetService sets this while a wipe is in progress. While
  // suspended, record() drops entries and no path may touch SecureStorage
  // (flush/forceFlush/recover) — otherwise a queued entry would recreate
  // the deleted secure vault IndexedDB with a freshly minted device key.
  private suspended = false;
  private readonly BATCH_INTERVAL_MS = 5000; // Flush every 5 seconds

  // ── Attestation chain (H2) ──────────────────────────────────────────────
  // Every audit entry is also appended to the HMAC hash-chain
  // (src/services/security/AttestationChain.ts) so tampering with the stored
  // log is detectable via verifyIntegrity(). The chain is signed with the
  // master-password-derived key, so appends only succeed while the vault is
  // unlocked — entries recorded while locked are skipped (the chain verifies
  // the unlocked window). A promise queue serializes appends in record()
  // order so chain links stay ordered even though the write is async.
  private attestationQueue: Promise<void> = Promise.resolve();

  private appendToAttestationChain(entry: AuditEntry): void {
    this.attestationQueue = this.attestationQueue.then(async () => {
      try {
        // Dynamic import avoids the static cycle
        // AuditLogService -> AttestationChain -> SecurityVault -> AuditLogService.
        const { attestationChain } = await import("./security/AttestationChain");
        await attestationChain.append(entry.action, entry.id, {
          result: entry.result,
          origin: entry.origin,
          ts: entry.timestamp,
        });
      } catch {
        // Vault locked or storage failure — skip; never break the queue or
        // the caller (chain records the unlocked windows only).
      }
    });
  }

  /**
   * Verifies the HMAC attestation chain over all audit entries. Returns
   * `valid: false` when a link is broken (tampering or storage corruption)
   * and `error` when verification itself could not run (e.g. vault locked
   * or storage unavailable). Callers should only treat `valid: false` with
   * `checked > 0` as a tamper signal.
   */
  async verifyIntegrity(): Promise<{
    valid: boolean;
    brokenAt: number | null;
    checked: number;
    error?: string;
  }> {
    await this.attestationQueue;
    try {
      const { attestationChain } = await import("./security/AttestationChain");
      await attestationChain.init();
      const result = await attestationChain.verifyChain();
      return {
        valid: result.valid,
        brokenAt: result.brokenAt,
        checked: attestationChain.getLength(),
      };
    } catch (error) {
      return {
        valid: false,
        brokenAt: null,
        checked: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Suspends audit persistence for the current page session.
   *
   * Used by NuclearForgetService at the start of a wipe: the wipe deletes
   * the SecureStorage vault (which backs the audit log), so any entry
   * recorded from that point on — including the `vault_lock` emitted by
   * securityVault.lock() and the pagehide flush that runs while the page
   * reloads after the wipe — must never flush, or it would recreate the
   * secure vault IndexedDB with a freshly minted device key and silently
   * undo the wipe. Cancels any pending timer and drops queued entries.
   *
   * Suspension is intentionally one-way for the session: after a wipe the
   * page reloads (module state resets), so resume() is never required in
   * production — it exists for completeness and tests.
   */
  suspend(): void {
    this.suspended = true;
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.pendingWrites = [];
  }

  /** Re-enables audit persistence (clears the suspended state). */
  resume(): void {
    this.suspended = false;
  }

  /**
   * Records an audit entry. Batches writes to SecureStorage for performance.
   */
  async record(params: {
    action: AuditAction;
    target?: string;
    result: AuditResult;
    origin: string;
    context?: Record<string, string>;
  }): Promise<void> {
    if (this.suspended) {return;}
    const sanitizedContext: Record<string, string> | undefined = params.context
      ? Object.fromEntries(
          Object.entries(params.context).map(([k, v]) => [
            k,
            sanitizeContextValue(v),
          ]),
        )
      : undefined;

    const entry: AuditEntry = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      action: params.action,
      target: params.target ? sanitizeTarget(params.target) : "system",
      result: params.result,
      origin: params.origin,
      context: sanitizedContext,
      sessionId: getAuditSessionId(),
    };

    this.pendingWrites.push(entry);
    // Keep the volatile queue bounded even when IndexedDB is unavailable for
    // a long period (for example during storage pressure or page teardown).
    if (this.pendingWrites.length > MAX_ENTRIES) {
      this.pendingWrites.splice(0, this.pendingWrites.length - MAX_ENTRIES);
    }
    // H2: mirror the entry into the HMAC attestation chain (best-effort,
    // requires an unlocked vault). Fire-and-forget — the queue serializes
    // appends and swallows failures internally.
    this.appendToAttestationChain(entry);
    this.scheduleFlush();

    // Also emit to logger for real-time observability (logger is volatile)
    logger.info("[AuditLog]", {
      action: entry.action,
      result: entry.result,
      target: entry.target,
      origin: entry.origin,
    });
  }

  private scheduleFlush(): void {
    if (this.writeTimer) {return;}
    this.writeTimer = setTimeout(() => {
      this.flush().catch((err) =>
        logger.error("[AuditLog] Flush failed", { error: safeErrorForLog(err) }),
      );
    }, this.BATCH_INTERVAL_MS);
  }

  private flush(): Promise<void> {
    if (this.flushPromise) {return this.flushPromise;}
    const operation = this.flushInternal();
    this.flushPromise = operation;
    return operation;
  }

  private async flushInternal(): Promise<void> {
    if (this.suspended) {
      // A wipe is in progress: never touch SecureStorage (it may already
      // be deleted). Drop anything queued and release the in-flight slot.
      this.pendingWrites = [];
      this.flushPromise = null;
      return;
    }
    if (this.pendingWrites.length === 0) {
      this.flushPromise = null;
      return;
    }
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }

    const entries = [...this.pendingWrites];
    this.pendingWrites = [];

    try {
      const allEntries = await this.getAll();
      const merged = [...entries, ...allEntries];

      // Evict oldest if over limit
      if (merged.length > MAX_ENTRIES) {
        merged.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        merged.splice(0, merged.length - MAX_ENTRIES);
      }

      try {
        await secureStorage.setSecret(STORAGE_KEY, JSON.stringify(merged));
        this.cache = merged;
      } catch (error) {
        // A locked vault cannot use device-key encrypted storage. Preserve a
        // sanitized fallback instead of retrying a write that can never work
        // until unlock, which previously created repeated live errors.
        if (typeof sessionStorage !== "undefined") {
          try {
            const existing = sessionStorage.getItem(PENDING_FALLBACK_KEY);
            const fallback = safeParseJsonArray<Partial<AuditEntry>>(existing)
              .entries.map(sanitizeFallbackEntry);
            sessionStorage.setItem(
              PENDING_FALLBACK_KEY,
              JSON.stringify([...fallback, ...entries.map(sanitizeFallbackEntry)].slice(-MAX_ENTRIES)),
            );
            this.cache = merged;
            this.pendingWrites = [...entries, ...this.pendingWrites].slice(-MAX_ENTRIES);
            return;
          } catch {
            // Continue to the bounded in-memory queue below.
          }
        }
        throw error;
      }
    } catch (error) {
      logger.warn("[AuditLog] Persist deferred until vault unlock", { error: safeErrorForLog(error) });
      // Re-queue entries for next flush, retaining the same hard bound.
      this.pendingWrites = [...entries, ...this.pendingWrites].slice(-MAX_ENTRIES);
    } finally {
      // Clear this before the operation resolves so a new record arriving in
      // the same turn can schedule a fresh flush rather than being lost
      // behind a completed promise.
      this.flushPromise = null;
    }
  }

  /**
   * Flushes queued entries before a security lifecycle transition.
   *
   * This is intentionally separate from the unload-named forceFlush API:
   * SecurityVault must persist the `vault_lock` entry while the device key is
   * still materialized, then clear that key. Calling the old delayed batch
   * timer after lock made encryption fail and silently re-queued the entry.
   */
  async flushPending(): Promise<void> {
    await this.forceFlush();
  }

  /** Force flush pending entries (call on pagehide/beforeunload).
   *  Writes to sessionStorage as a synchronous fallback so entries survive
   *  even when the async IndexedDB write doesn't complete before unload. */
  async forceFlush(): Promise<void> {
    if (this.suspended) {return;}
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }

    // Synchronous fallback: serialize pending entries to sessionStorage
    // before the page terminates. sessionStorage is synchronous and survives
    // pagehide (but not browser close). On next boot these entries are
    // picked up and merged into the main log.
    if (this.pendingWrites.length > 0 && typeof sessionStorage !== "undefined") {
      try {
        const existing = sessionStorage.getItem(PENDING_FALLBACK_KEY);
        const fallbackEntries = safeParseJsonArray<Partial<AuditEntry>>(existing)
          .entries.map(sanitizeFallbackEntry);
        const merged = [
          ...fallbackEntries,
          ...this.pendingWrites.map(sanitizeFallbackEntry),
        ].slice(-MAX_ENTRIES);
        sessionStorage.setItem(PENDING_FALLBACK_KEY, JSON.stringify(merged));
      } catch (_err) {
        // sessionStorage full or unavailable — entries will be lost.
      }
    }

    await this.flush();
    // A record may arrive while the first flush is awaiting IndexedDB. Give
    // that batch one more turn before removing the unload fallback.
    if (this.pendingWrites.length > 0) {
      await this.flush();
    }

    // Only remove the fallback after all pending entries are gone. If the
    // IndexedDB write failed, retaining it prevents audit data loss on boot.
    // Do not remove the fallback merely because the in-memory queue was
    // drained: flushInternal may have copied entries to sessionStorage after
    // an encrypted write failed. Remove it only when the encrypted write was
    // actually successful (or when no fallback exists).
    if (this.pendingWrites.length === 0 && typeof sessionStorage !== "undefined") {
      try {
        const fallback = sessionStorage.getItem(PENDING_FALLBACK_KEY);
        if (fallback === null) {
          sessionStorage.removeItem(PENDING_FALLBACK_KEY);
        }
      } catch (_err) {
        // Best-effort cleanup.
      }
    }
  }

  /** On boot, merge any entries that were saved to sessionStorage during
   *  a previous unload into the main audit log. */
  async recoverFallbackEntries(): Promise<void> {
    if (this.suspended) {return;}
    if (typeof sessionStorage === "undefined") {return;}
    // Authentication failures are recorded before the vault/device key is
    // available. Keep the fallback queued until an unlocked lifecycle can
    // persist it; attempting SecureStorage here only creates noisy errors and
    // can trigger device-key initialization during the locked screen.
    try {
      if (
        (await secureStorage.isDeviceKeyWrapped()) &&
        !secureStorage.isDeviceKeyMaterialized()
      ) {
        return;
      }
    } catch {
      return;
    }
    const raw = sessionStorage.getItem(PENDING_FALLBACK_KEY);
    if (!raw) {return;}

    let fallbackEntries: AuditEntry[];
    try {
      const { entries, parseFailed } = safeParseJsonArray<AuditEntry>(raw);
      fallbackEntries = entries.map(sanitizeFallbackEntry);
      if (parseFailed) {
        // Invalid fallback data cannot be recovered; remove only this
        // malformed value, while preserving valid entries across transient
        // IDB failures.
        sessionStorage.removeItem(PENDING_FALLBACK_KEY);
        logger.warn("[AuditLog] Invalid fallback entries");
      }
    } catch (error) {
      sessionStorage.removeItem(PENDING_FALLBACK_KEY);
      logger.warn("[AuditLog] Invalid fallback entries", { error: safeErrorForLog(error) });
      return;
    }
    if (fallbackEntries.length === 0) {
      sessionStorage.removeItem(PENDING_FALLBACK_KEY);
      return;
    }

    try {
      const allEntries = await this.getAll();
      const merged = [...fallbackEntries, ...allEntries];
      if (merged.length > MAX_ENTRIES) {
        merged.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        merged.splice(0, merged.length - MAX_ENTRIES);
      }
      try {
        await secureStorage.setSecret(STORAGE_KEY, JSON.stringify(merged));
        this.cache = merged;
        sessionStorage.removeItem(PENDING_FALLBACK_KEY);
      } catch (error) {
        logger.warn("[AuditLog] Fallback retained until vault unlock", { error: safeErrorForLog(error) });
      }
      logger.info("[AuditLog] Recovered fallback entries", {
        count: fallbackEntries.length,
      });
    } catch (error) {
      logger.warn("[AuditLog] Failed to recover fallback entries", { error: safeErrorForLog(error) });
    }
  }

  /** Retrieves all audit entries, newest first. */
  async getAll(): Promise<AuditEntry[]> {
    if (this.cache) {return [...this.cache];}

    try {
      const stored = await secureStorage.getSecret(STORAGE_KEY);
      const { entries, parseFailed } = safeParseJsonArray<AuditEntry>(stored);
      if (parseFailed) {
        // A tampered/corrupt blob that is valid JSON but not an array must
        // not poison the in-memory cache: a non-array value here would crash
        // the NEXT getAll() when it spreads the cache.
        logger.warn(
          "[AuditLog] stored blob is not a valid JSON array; ignoring",
        );
      }
      this.cache = entries;
      return [...entries];
    } catch (error) {
      logger.error("[AuditLog] Failed to read entries", { error: safeErrorForLog(error) });
      return [];
    }
  }

  /** Returns entries filtered by action type, newest first. */
  async getByAction(action: AuditAction, limit = 50): Promise<AuditEntry[]> {
    const all = await this.getAll();
    return all.filter((e) => e.action === action).slice(0, limit);
  }

  /** Returns entries filtered by result type. */
  async getByResult(result: AuditResult, limit = 50): Promise<AuditEntry[]> {
    const all = await this.getAll();
    return all.filter((e) => e.result === result).slice(0, limit);
  }

  /** Returns entries within a time range. */
  async getByTimeRange(
    start: Date,
    end: Date,
    limit = 100,
  ): Promise<AuditEntry[]> {
    const all = await this.getAll();
    const startMs = start.getTime();
    const endMs = end.getTime();
    return all
      .filter((e) => {
        const ts = new Date(e.timestamp).getTime();
        return ts >= startMs && ts <= endMs;
      })
      .slice(0, limit);
  }

  /** Returns count of entries by action type. */
  async getActionCounts(): Promise<Record<string, number>> {
    const all = await this.getAll();
    const counts: Record<string, number> = {};
    for (const entry of all) {
      counts[entry.action] = (counts[entry.action] || 0) + 1;
    }
    return counts;
  }

  /** Clears the audit log (requires explicit confirmation in UI). */
  async clear(): Promise<void> {
    try {
      if (this.writeTimer) {
        clearTimeout(this.writeTimer);
        this.writeTimer = null;
      }
      await secureStorage.deleteSecret(STORAGE_KEY);
      this.cache = null;
      this.pendingWrites = [];
      if (typeof sessionStorage !== "undefined") {
        try {
          sessionStorage.removeItem(PENDING_FALLBACK_KEY);
        } catch {
          // Best-effort cleanup; the encrypted log was still cleared.
        }
      }
      logger.info("[AuditLog] All entries cleared");
    } catch (error) {
      logger.error("[AuditLog] Failed to clear entries", { error: safeErrorForLog(error) });
      throw error;
    }
  }

  /** Returns the total number of entries. */
  async count(): Promise<number> {
    const all = await this.getAll();
    return all.length;
  }

  /** Checks if the audit log has any entries. */
  async hasEntries(): Promise<boolean> {
    return (await this.count()) > 0;
  }
}

export const auditLog = new AuditLogService();

// Flush pending writes on page unload.
// Use `pagehide` (not `beforeunload`): it is the recommended event for
// short async work during unload and is not subject to the browser's
// "long task" blocking that `beforeunload` triggers. `beforeunload` does
// not wait for promises, so a flush scheduled there would always be lost.
if (typeof window !== "undefined") {
  // Recover any entries that were saved to sessionStorage during a
  // previous unload where the IndexedDB flush didn't complete.
  void auditLog.recoverFallbackEntries().catch((err) => {
    logger.warn("[AuditLog] Boot recovery failed", { error: safeErrorForLog(err) });
  });

  const flushHandler = () => {
    void auditLog.forceFlush().catch((err) => {
      logger.warn("[AuditLog] Unload flush failed", { error: safeErrorForLog(err) });
    });
  };
  window.addEventListener("pagehide", flushHandler);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {flushHandler();}
  });
}
