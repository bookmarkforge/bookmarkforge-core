/**
 * Knowledge-scan execution bridge: runs the cross-language scan in the
 * knowledge-scan Web Worker when available, falling back to the pure inline
 * computation (src/utils/knowledgeScan.ts) when workers are unavailable or
 * repeatedly failing.
 *
 * The inline fallback is safe because computeBridges is bounded
 * (MAX_ITEMS_PER_LANG / MAX_SCAN_ITEMS), so the worst case stays sub-second
 * even on the main thread.
 */
import { getWorkerPool } from "../utils/WorkerPool";
import { logger } from "../utils/logger";
import {
  computeBridges,
  type Bridge,
  type BridgeScanOptions,
  type ScanBookmark,
} from "../utils/knowledgeScan";

function createAbortError(): Error {
  const error = new Error("Knowledge scan aborted");
  error.name = "AbortError";
  return error;
}
// `?worker&url` is required: the worker is created indirectly via
// getWorkerPool(), and Vite's static worker detection only compiles workers
// for `new Worker(new URL(...))` patterns (see RAGEngine's embedding worker).
import knowledgeScanWorkerUrl from "../workers/knowledgeScan.worker.ts?worker&url";

const POOL_NAME = "knowledge-scan";
const SCAN_TIMEOUT_MS = 10_000;
// After two consecutive worker failures (timeout, reject, capacity error)
// stop trying the worker for this session: a permanently broken worker must
// not add a 10s delay to every scan. Transient failures self-heal inside
// WorkerPool (retries + worker retirement), so a single failure still falls
// back inline without disabling the pool.
const MAX_CONSECUTIVE_FAILURES = 2;

let poolUnavailable = false;
let consecutiveFailures = 0;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {return;}
      settled = true;
      reject(new Error("Knowledge scan timed out"));
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

interface ScanCancellation {
  /** Aborts the worker task (retired) or the inline scan at the next
   *  phase checkpoint. The scan rejects with an AbortError. */
  signal?: AbortSignal;
  /** Receives (phase, fraction) progress updates; `fraction` is 0..1. */
  onProgress?: (phase: string, fraction: number) => void;
}

/**
 * Computes cross-language bridges, preferring the Web Worker. Falls back
 * inline on worker failures, but an AbortError always propagates to the
 * caller (a cancelled scan must not restart on the main thread).
 */
export async function scanCrossLanguageBridges(
  bookmarks: readonly ScanBookmark[],
  options: BridgeScanOptions = {},
  extras: ScanCancellation = {},
): Promise<Bridge[]> {
  const { signal, onProgress } = extras;

  const inline = (): Bridge[] => {
    if (signal?.aborted) {throw createAbortError();}
    // The bounded scan reports progress at phase checkpoints, where the
    // inline path also checks the signal: a cancelled fallback aborts at the
    // next checkpoint instead of running to completion.
    return computeBridges(bookmarks, options, (phase, fraction) => {
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
    // getWorkerPool() self-heals: a pool terminated by pagehide/nuclear-forget
    // is replaced with a fresh instance on the next call.
    const pool = getWorkerPool(POOL_NAME, knowledgeScanWorkerUrl, 1);
    const result = await withTimeout(
      pool.execute<
        { bookmarks: ScanBookmark[]; options: BridgeScanOptions },
        Bridge[]
      >(
        "crossLanguageScan",
        {
          bookmarks: [...bookmarks],
          options,
        },
        // transferables
        undefined,
        // onProgress: relay the worker's status + fraction to the caller.
        (_taskId, phase, _message, fraction) => {
          if (fraction !== undefined) {
            onProgress?.(phase ?? "scan", fraction);
          }
        },
        signal,
      ),
      SCAN_TIMEOUT_MS,
    );
    if (Array.isArray(result)) {
      consecutiveFailures = 0;
      return result;
    }
    // A non-array result is not a valid bridge list — fall through.
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      // The caller cancelled: never fall back inline, never count it as a
      // worker failure (an abort is not a broken worker).
      throw error;
    }
    consecutiveFailures += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      poolUnavailable = true;
    }
    logger.warn(
      "[knowledgeScan] worker scan failed, falling back to inline",
      { error: error instanceof Error ? error.message : String(error) },
    );
  }

  return inline();
}
