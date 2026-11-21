/**
 * src/services/scanWorkerBridge.ts — shared worker-pool bridge for the
 * bounded scan services (auditScan, knowledgeScan).
 *
 * Both services had near-verbatim scaffolding (, ~250
 * duplicated lines): a WorkerPool-backed attempt with timeout, consecutive-
 * failure circuit breaking, AbortError passthrough and an inline fallback.
 * This factory owns that machinery once; each service supplies only its
 * payload shape, result guard and inline computation.
 */
import { getWorkerPool } from "../utils/WorkerPool";
import { logger } from "../utils/logger";

export interface ScanWorkerBridgeConfig<TInput, TResult> {
  /** WorkerPool name — one pool per worker module. */
  poolName: string;
  /** Vite `?worker&url` import for the worker entry. */
  workerUrl: string;
  /** Task name the worker protocol expects. */
  taskName: string;
  timeoutMs: number;
  /** Error message/name used for caller cancellation. */
  abortMessage: string;
  timeoutMessage: string;
  /** logger.warn tag, e.g. "[auditScan]". */
  logTag: string;
  isValidResult: (value: unknown) => value is TResult;
  /** Serialize caller input into the worker task payload. */
  payload: (input: TInput) => unknown;
}

export interface ScanBridgeExtras {
  signal?: AbortSignal;
  onProgress?: (phase: string, fraction: number) => void;
}

// After two consecutive worker failures (timeout, reject, capacity error)
// stop trying the worker for this session: a permanently broken worker must
// not add a SCAN_TIMEOUT delay to every scan. Transient failures self-heal
// inside WorkerPool (retries + worker retirement), so a single failure still
// falls back inline without disabling the pool.
const MAX_CONSECUTIVE_FAILURES = 2;

export function createScanWorkerBridge<TInput, TResult>(
  config: ScanWorkerBridgeConfig<TInput, TResult>,
): (
  input: TInput,
  inline: () => TResult,
  extras?: ScanBridgeExtras,
) => Promise<TResult> {
  let poolUnavailable = false;
  let consecutiveFailures = 0;

  const createAbortError = (): Error => {
    const error = new Error(config.abortMessage);
    error.name = "AbortError";
    return error;
  };

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(config.timeoutMessage));
      }, ms);
      promise.then(
        (value) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  return async function runScan(
    input: TInput,
    inline: () => TResult,
    extras: ScanBridgeExtras = {},
  ): Promise<TResult> {
    const { signal, onProgress } = extras;

    if (typeof Worker === "undefined" || poolUnavailable) {
      return inline();
    }

    try {
      // 1 worker is enough: scans are serialized by the caller's guard, and a
      // pool of N would only add idle memory for this lightweight workload.
      // getWorkerPool() self-heals: a pool terminated by pagehide/nuclear-forget
      // is replaced with a fresh instance on the next call.
      const pool = getWorkerPool(config.poolName, config.workerUrl, 1);
      const result = await withTimeout(
        pool.execute<Record<string, unknown>, TResult>(
          config.taskName,
          config.payload(input) as Record<string, unknown>,
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
        config.timeoutMs,
      );
      if (config.isValidResult(result)) {
        if (signal?.aborted) {
          throw createAbortError();
        }
        consecutiveFailures = 0;
        return result;
      }
      // A malformed result is not a valid scan output — fall through.
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // Cancellation is expected and must never restart the scan inline.
        throw error;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        poolUnavailable = true;
      }
      logger.warn(`${config.logTag} worker scan failed, falling back to inline`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return inline();
  };
}
