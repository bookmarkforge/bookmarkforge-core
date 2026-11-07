/**
 * Knowledge-audit execution bridge: runs the audit aggregation in the
 * audit-scan Web Worker when available, falling back to the pure inline
 * computation (src/utils/auditScan.ts) when workers are unavailable or
 * repeatedly failing.
 *
 * The inline fallback is safe because the caller bounds the input to
 * MAX_AUDIT_SAMPLE bookmarks, so the worst case stays sub-second even
 * on the main thread.
 */
import { getWorkerPool } from "../utils/WorkerPool";
import { logger } from "../utils/logger";
import {
  computeAuditScan,
  type AuditBookmark,
  type AuditScanPhase,
  type AuditScanResult,
} from "../utils/auditScan";
// `?worker&url` is required: the worker is created indirectly via
// getWorkerPool(), and Vite's static worker detection only compiles workers
// for `new Worker(new URL(...))` patterns (see RAGEngine's embedding worker).
import auditScanWorkerUrl from "../workers/auditScan.worker.ts?worker&url";

const POOL_NAME = "audit-scan";
const SCAN_TIMEOUT_MS = 10_000;
// After two consecutive worker failures (timeout, reject, capacity error)
// stop trying the worker for this session: a permanently broken worker must
// not add a 10s delay to every scan. Transient failures self-heal inside
// WorkerPool (retries + worker retirement), so a single failure still falls
// back inline without disabling the pool.
const MAX_CONSECUTIVE_FAILURES = 2;

function createAbortError(): Error {
  const error = new Error("Audit scan aborted");
  error.name = "AbortError";
  return error;
}

let poolUnavailable = false;
let consecutiveFailures = 0;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {return;}
      settled = true;
      reject(new Error("Audit scan timed out"));
    }, ms);
    promise.then(
      (value) => {
        if (settled) {return;}
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {return;}
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isAuditResult(value: unknown): value is AuditScanResult {
  if (typeof value !== "object" || value === null) {return false;}
  const record = value as Record<string, unknown>;
  return (
    typeof record.totalTags === "number" &&
    typeof record.visitedIn30d === "number" &&
    typeof record.outdatedCount === "number" &&
    Array.isArray(record.coverageByTag)
  );
}

/**
 * Computes the audit metrics, preferring the Web Worker. Worker failures
 * fall back inline; an AbortSignal cancellation propagates as AbortError and
 * never restarts the scan on the main thread.
 */
interface AuditScanCancellation {
  /** Aborts the worker task or the inline scan at its next checkpoint. */
  signal?: AbortSignal;
  /** Receives coarse phase updates with a fraction in the 0..1 range. */
  onProgress?: (phase: AuditScanPhase, fraction: number) => void;
}

export async function runAuditScan(
  bookmarks: readonly AuditBookmark[],
  extras: AuditScanCancellation = {},
): Promise<AuditScanResult> {
  const { signal, onProgress } = extras;
  const inline = (): AuditScanResult => {
    if (signal?.aborted) {throw createAbortError();}
    return computeAuditScan(bookmarks, Date.now(), (phase, fraction) => {
      if (signal?.aborted) {throw createAbortError();}
      onProgress?.(phase, fraction);
    });
  };

  if (typeof Worker === "undefined" || poolUnavailable) {
    return inline();
  }

  try {
    // 1 worker is enough: scans are serialized by the caller's guard, and a
    // pool of N would only add idle memory for this lightweight workload.
    const pool = getWorkerPool(POOL_NAME, auditScanWorkerUrl, 1);
    const result = await withTimeout(
      pool.execute<{ bookmarks: AuditBookmark[] }, AuditScanResult>(
        "auditScan",
        { bookmarks: [...bookmarks] },
        undefined,
        (_taskId, phase, _message, fraction) => {
          if (fraction !== undefined) {
            onProgress?.(
              phase as AuditScanPhase,
              fraction,
            );
          }
        },
        signal,
      ),
      SCAN_TIMEOUT_MS,
    );
    if (isAuditResult(result)) {
      if (signal?.aborted) {throw createAbortError();}
      consecutiveFailures = 0;
      return result;
    }
    // A malformed result is not a valid audit — fall through.
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      // Cancellation is expected and must never restart the scan inline.
      throw error;
    }
    consecutiveFailures += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      poolUnavailable = true;
    }
    logger.warn(
      "[auditScan] worker scan failed, falling back to inline",
      { error: error instanceof Error ? error.message : String(error) },
    );
  }

  return inline();
}
