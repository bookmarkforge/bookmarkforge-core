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
import {
  computeBridges,
  type Bridge,
  type BridgeScanOptions,
  type ScanBookmark,
} from "../utils/knowledgeScan";
// `?worker&url` is required: the worker is created indirectly via
// getWorkerPool(), and Vite's static worker detection only compiles workers
// for `new Worker(new URL(...))` patterns (see RAGEngine's embedding worker).
import knowledgeScanWorkerUrl from "../workers/knowledgeScan.worker.ts?worker&url";
import { createScanWorkerBridge } from "./scanWorkerBridge";

function createAbortError(): Error {
  const error = new Error("Knowledge scan aborted");
  error.name = "AbortError";
  return error;
}

const runWorkerScan = createScanWorkerBridge<
  { bookmarks: readonly ScanBookmark[]; options: BridgeScanOptions },
  Bridge[]
>({
  poolName: "knowledge-scan",
  workerUrl: knowledgeScanWorkerUrl,
  taskName: "crossLanguageScan",
  timeoutMs: 10_000,
  abortMessage: "Knowledge scan aborted",
  timeoutMessage: "Knowledge scan timed out",
  logTag: "[knowledgeScan]",
  isValidResult: (value): value is Bridge[] => Array.isArray(value),
  payload: (input) => ({
    bookmarks: [...input.bookmarks],
    options: input.options,
  }),
});

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

  return runWorkerScan({ bookmarks, options }, inline, { signal, onProgress });
}
