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
import { createScanWorkerBridge } from "./scanWorkerBridge";

function createAbortError(): Error {
  const error = new Error("Audit scan aborted");
  error.name = "AbortError";
  return error;
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

const runWorkerScan = createScanWorkerBridge<readonly AuditBookmark[], AuditScanResult>({
  poolName: "audit-scan",
  workerUrl: auditScanWorkerUrl,
  taskName: "auditScan",
  timeoutMs: 10_000,
  abortMessage: "Audit scan aborted",
  timeoutMessage: "Audit scan timed out",
  logTag: "[auditScan]",
  isValidResult: isAuditResult,
  payload: (bookmarks) => ({ bookmarks: [...bookmarks] }),
});

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

  return runWorkerScan(bookmarks, inline, {
    signal,
    onProgress: onProgress
      ? (phase, fraction) => onProgress(phase as AuditScanPhase, fraction)
      : undefined,
  });
}
