/**
 * Error Reporter (privacy-first, local-first)
 *
 * BookmarkForge does NOT identify users, track IPs, or use cookies.
 * Errors are stored locally in IndexedDB (max 100 entries).
 * Storage is gated by the user's consent (`forge_consent_error_reporting`,
 * default OFF). Legacy keys (`bmf_local_error_storage`, `bmf_telemetry_optin`)
 * are honored as read-only migration fallbacks.
 * Errors are fingerprinted and grouped to avoid duplicates.
 * Sensitive data (passwords, API keys, tokens) is sanitized before storage.
 *
 * Remote telemetry is OPT-IN and disabled by default: when the operator
 * configures VITE_SENTRY_DSN at build time AND the user consents, redacted
 * technical errors are forwarded to Sentry (see remoteErrorReporter.ts,
 * with a sanitizing beforeSend). Without consent or without a DSN, error
 * reporting stays strictly local. `flush()` is a local-only no-op kept to
 * preserve backwards compatibility with existing callers.
 *
 * @example
 * ```ts
 * import { errorReporter, setupGlobalErrorHandler } from "~/telemetry/errorReporter";
 * setupGlobalErrorHandler();
 * await errorReporter.reportError(new Error("Something failed"));
 * ```
 */
import { logger, redactSecrets } from "../utils/logger";
import { safeGet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import {
  MAX_MESSAGE_LENGTH,
  MAX_STACK_LENGTH,
  sanitizeMessage,
  sanitizeStack,
} from "./sanitize";
import { initRemoteErrorReporting } from "./remoteErrorReporter";

const DB_NAME = "bookmarkforge-errors";
const STORE_NAME = "errors";
const DEFAULT_MAX = 100;
const MAX_CONTEXT_ENTRIES = 16;
const MAX_CONTEXT_VALUE_LENGTH = 512;

/**
 * Consent key for local IndexedDB-based error storage.
 *
 * Audit 2026-08-30: this previously read `bmf_local_error_storage`, a key
 * the ConsentBanner never writes. The user's error-reporting choice in the
 * banner (forge_consent_error_reporting) therefore had no effect — the
 * reporter was gated by a key that only the settings UI toggled. Now reads
 * the correct consent key; the legacy bmf_telemetry_optin and
 * bmf_local_error_storage keys are honored as read-only migration fallbacks.
 */
const CONSENT_KEY = STORAGE_KEYS.CONSENT_ERROR_REPORTING;
const LEGACY_CONSENT_KEY_1 = "bmf_local_error_storage";
const LEGACY_CONSENT_KEY_2 = "bmf_telemetry_optin";

interface StoredError {
  id: string;
  timestamp: number;
  type: string;
  message: string;
  stack?: string;
  appVersion: string;
  thread: "main" | "worker";
  context?: Record<string, string | number | boolean>;
  fingerprint: string;
  count: number;
}

function getAppVersion(): string {
  try {
    return (
      import.meta.env.VITE_APP_VERSION ||
      import.meta.env.PACKAGE_VERSION ||
      "0.0.0"
    );
  } catch (_err) {
    return "0.0.0";
  }
}

function detectThread(): "main" | "worker" {
  if (
    typeof WorkerGlobalScope !== "undefined" &&
    self instanceof WorkerGlobalScope
  ) {
    return "worker";
  }
  return "main";
}

function anonymizeStack(stack: string | undefined): string | undefined {
  if (!stack) {return undefined;}
  const lines = stack.slice(0, MAX_STACK_LENGTH * 2).split("\n");
  const root = typeof window !== "undefined" ? window.location.origin : "";
  return redactSecrets(
    lines.map((line) => line.replace(root, ".")).join("\n"),
  ).slice(0, MAX_STACK_LENGTH);
}

function generateId(): string {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  const hex = Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${Date.now()}-${hex}`;
}

function generateFingerprint(
  type: string,
  message: string,
  stack?: string,
): string {
  const key = `${type.slice(0, 128)}:${message.slice(0, MAX_MESSAGE_LENGTH)}:${stack?.split("\n").slice(0, 3).join("|").slice(0, MAX_STACK_LENGTH) || ""}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}

function isTelemetryEnabled(): boolean {
  try {
    // The ConsentBanner consent key wins when present. Legacy keys
    // (bmf_local_error_storage, bmf_telemetry_optin) are fallbacks for
    // installs that predate the consent banner — an explicit "false" on the
    // current key must never be overridden by a stale legacy "true".
    const current = safeGet(CONSENT_KEY);
    if (current !== null) {return current === "true";}
    const legacy1 = safeGet(LEGACY_CONSENT_KEY_1);
    if (legacy1 !== null) return legacy1 === "true";
    return safeGet(LEGACY_CONSENT_KEY_2) === "true";
  } catch (_err) {
    return false;
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) {return;}
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () =>
      fail(new Error("Error database open blocked"));
  });
}

class ErrorReporter {
  private initialized = false;
  private loggerSink: Parameters<typeof logger.addSink>[0] | null = null;
  private globalHandlers: {
    onError: (event: ErrorEvent) => void;
    onUnhandledRejection: (event: PromiseRejectionEvent) => void;
  } | null = null;
  private suppressLoggerSink = false;

  async init(): Promise<void> {
    if (this.initialized) {return;}
    this.initialized = true;
    this.setupLoggerSink();
    logger.info("[ErrorReporter] Initialized (local-only, zero remote sinks)");
  }

  dispose(): void {
    if (this.loggerSink) {
      logger.removeSink(this.loggerSink);
      this.loggerSink = null;
    }
    this.removeGlobalErrorHandlers();
    this.initialized = false;
  }

  private setupLoggerSink(): void {
    const sink: Parameters<typeof logger.addSink>[0] = (entry) => {
      if (entry.level !== "error" || this.suppressLoggerSink) {return;}
      const firstArg = entry.data?.[0];
      const err = firstArg instanceof Error ? firstArg : undefined;
      const msg = err?.message || entry.message;
      const errObj = err || new Error(msg);
      void this.reportError(errObj, { source: "logger-sink" }).catch((error) => {
        this.suppressLoggerSink = true;
        try {
          logger.warn("[ErrorReporter] Failed to report from logger sink", {
            error,
          });
        } finally {
          this.suppressLoggerSink = false;
        }
      });
    };
    this.loggerSink = sink;
    logger.addSink(sink);
  }

  async reportError(
    error: Error,
    context?: Record<string, string>,
  ): Promise<void> {
    if (!isTelemetryEnabled()) {return;}

    let storeError: Error | null = null;
    try {
      const message = sanitizeMessage(error.message);
      const stack = sanitizeStack(anonymizeStack(error.stack));
      const fingerprint = generateFingerprint(
        error.name || "Error",
        message,
        stack,
      );
      const entry: StoredError = {
        id: generateId(),
        timestamp: Date.now(),
        type: error.name || "Error",
        message,
        stack,
        appVersion: getAppVersion(),
        thread: detectThread(),
        context: context
          ? Object.fromEntries(
              Object.entries(context)
                .slice(0, MAX_CONTEXT_ENTRIES)
                .map(([k, v]) => [
                  k.slice(0, 128),
                  redactSecrets(String(v)).slice(0, MAX_CONTEXT_VALUE_LENGTH),
                ]),
            )
          : context,
        fingerprint,
        count: 1,
      };

      await this.storeError(entry);
      logger.warn("[ErrorReporter] Error stored locally", {
        type: entry.type,
        fingerprint,
      });
    } catch (e) {
      storeError = e instanceof Error ? e : new Error(String(e));
      this.suppressLoggerSink = true;
      try {
        logger.error("[ErrorReporter] Failed to report error", {
          originalError: sanitizeMessage(error.message),
          storeError: sanitizeMessage(storeError.message),
        });
      } finally {
        this.suppressLoggerSink = false;
      }
    }
  }

  private async storeError(entry: StoredError): Promise<void> {
    const max = DEFAULT_MAX;
    const db = await openDB();
    try {
      // Single readwrite transaction — the previous two-transaction approach
      // (readonly getAll → readwrite put) had a race window: two tabs could
      // read the same all[] snapshot, both decide the entry doesn't exist,
      // and insert a duplicate (Fase 3).
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown) => {
          if (settled) {return;}
          settled = true;
          if (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          } else {
            resolve();
          }
        };
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
          const all: StoredError[] = req.result;
          const existing = all.find((e) => e.fingerprint === entry.fingerprint);
          if (existing) {
            existing.count++;
            existing.timestamp = entry.timestamp;
            if (entry.context) {
              existing.context = { ...existing.context, ...entry.context };
            }
            store.put(existing);
          } else {
            if (all.length >= max) {
              all.sort((a, b) => a.timestamp - b.timestamp);
              const toRemove = all.slice(0, all.length - max + 1);
              for (const old of toRemove) {
                store.delete(old.id);
              }
            }
            store.put(entry);
          }
        };
        req.onerror = () => finish(req.error);

        tx.oncomplete = () => finish();
        tx.onerror = () => finish(tx.error);
        tx.onabort = () => finish(tx.error || new Error("Error transaction aborted"));
      });
    } finally {
      // Fail-safe: the transaction may throw synchronously (invalid state,
      // store removed) or a request error can reject before the transaction
      // handlers fire. The connection must never outlive the operation.
      try {db.close();} catch { /* INTENTIONAL SILENCE: a version-change event already closed the error DB. */ }
    }
  }

  /**
   * Local-only no-op retained for backwards compatibility.
   *
   * Since v1.0.1 there is no remote error sink: errors are persisted to
   * IndexedDB synchronously inside `reportError()`, so there is nothing
   * to "flush" out. This method is kept alive to preserve callers in
   * existing integrations (window unload handlers, export flows, etc.).
   */
  async flush(): Promise<void> {
    try {
      const errors = await this.getStoredErrors();
      logger.info(
        "[ErrorReporter] flush() no-op: errors persist locally via reportError(); " +
          `current local buffer contains ${errors.length} error(s).`,
      );
    } catch (e) {
      logger.error("[ErrorReporter] flush() failed (non-fatal)", {
        error: e,
      });
    }
  }

  async getStoredErrors(): Promise<StoredError[]> {
    try {
      const db = await openDB();
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        let result: StoredError[] = [];
        const all = await new Promise<StoredError[]>((resolve, reject) => {
          let settled = false;
          const finish = (error?: unknown) => {
            if (settled) {return;}
            settled = true;
            if (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            } else {
              resolve(result);
            }
          };
          const req = store.getAll();
          req.onsuccess = () => {
            result = req.result;
          };
          req.onerror = () => finish(req.error);
          tx.oncomplete = () => finish();
          tx.onerror = () => finish(tx.error);
          tx.onabort = () =>
            finish(tx.error || new Error("Error transaction aborted"));
        });
        return all.sort((a, b) => b.timestamp - a.timestamp);
      } finally {
        try {db.close();} catch { /* INTENTIONAL SILENCE: the error DB connection is already closed. */ }
      }
    } catch (_err) {
      return [];
    }
  }

  async clearErrors(): Promise<void> {
    try {
      const db = await openDB();
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = (error?: unknown) => {
            if (settled) {return;}
            settled = true;
            if (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            } else {
              resolve();
            }
          };
          tx.oncomplete = () => finish();
          tx.onerror = () => finish(tx.error);
          tx.onabort = () =>
            finish(tx.error || new Error("Error transaction aborted"));
        });
        logger.info("[ErrorReporter] All stored errors cleared");
      } finally {
        try {db.close();} catch { /* INTENTIONAL SILENCE: the error DB connection is already closed. */ }
      }
    } catch (e) {
      logger.error("[ErrorReporter] Failed to clear errors", { error: e });
    }
  }

  hasGlobalErrorHandlers(): boolean {
    return this.globalHandlers !== null;
  }

  setGlobalErrorHandlers(handlers: {
    onError: (event: ErrorEvent) => void;
    onUnhandledRejection: (event: PromiseRejectionEvent) => void;
  }): void {
    this.globalHandlers = handlers;
  }

  removeGlobalErrorHandlers(): void {
    if (!this.globalHandlers || typeof window === "undefined") {return;}
    window.removeEventListener("error", this.globalHandlers.onError);
    window.removeEventListener(
      "unhandledrejection",
      this.globalHandlers.onUnhandledRejection,
    );
    this.globalHandlers = null;
  }
}

export const errorReporter = new ErrorReporter();

export function setupGlobalErrorHandler(): () => void {
  void errorReporter.init().catch((error: unknown) => {
    logger.warn("[ErrorReporter] Initialization failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  // Optional remote sink: no-op unless VITE_SENTRY_DSN is set; every event
  // is additionally gated by the user's consent in beforeSend.
  void initRemoteErrorReporting();
  if (typeof window === "undefined") {
    return () => {};
  }
  if (errorReporter.hasGlobalErrorHandlers()) {
    return () => errorReporter.removeGlobalErrorHandlers();
  }

  const onError = (event: ErrorEvent) => {
    if (event.error) {
      void errorReporter.reportError(event.error, {
        source: event.filename || "unknown",
        lineno: String(event.lineno),
        colno: String(event.colno),
      });
    }
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      void errorReporter.reportError(reason, { type: "unhandledRejection" });
    } else if (reason) {
      void errorReporter.reportError(new Error(String(reason)), {
        type: "unhandledRejection",
        reasonType: typeof reason,
      });
    }
  };

  errorReporter.setGlobalErrorHandlers({ onError, onUnhandledRejection });
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  logger.info("[ErrorReporter] Global error handlers registered (local-only)");
  return () => errorReporter.removeGlobalErrorHandlers();
}
