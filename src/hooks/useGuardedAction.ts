import { useCallback, useRef, useState } from "react";
import { useRequestGuard } from "./useRequestGuard";

/**
 * Consolidates the `useRequestGuard` + loading-state + toast boilerplate that
 * ~80 components reproduce by hand:
 *
 *   const { generation } = guard.begin();
 *   setLoading(true);
 *   try {
 *     await op();
 *     if (!guard.isCurrent(generation)) return;
 *     toast.success(...);
 *   } catch (e) {
 *     if (!guard.isCurrent(generation)) return;
 *     toast.error(...);
 *   } finally {
 *     if (guard.isCurrent(generation)) setLoading(false);
 *   }
 *
 * Semantics preserved exactly:
 *   - Results/toasts that resolve after unmount or after a newer request are
 *     dropped (the guard's generation + abort).
 *   - `blockReentry: true` (default) makes a second call while one is running
 *     a no-op — the AdvancedSection force-reprocess pattern. Pass `false` for
 *     refresh-style actions where a newer call must supersede the previous
 *     one (the ModelManager loadStatus pattern), exactly like begin() does.
 *   - `onSuccess`/`onError` are read through a ref, so passing new closures
 *     each render never changes `run`'s identity — safe to hand to
 *     memoized children.
 *
 * Callback contract (ref-read at settle time): all option callbacks
 * (`onStart`, `onSuccess`, `onError`) are looked up in `optionsRef` when the
 * event fires — i.e. they run the closures from the LATEST render, not the
 * options that were in scope when the invocation began. Generation gating
 * still decides WHETHER a callback fires (only a current invocation may
 * fire); the ref decides WHICH closure runs. So a long-running operation
 * that settles after several re-renders invokes the NEW `onSuccess`,
 * not the one that started it. This is the deliberate cost of keeping
 * `run`/`runWithSignal` identity-stable: the wrapper never closes over a
 * specific render's callbacks, so it never needs to change identity.
 * Do not rely on stale-callback semantics.
 */
export function useGuardedAction<T = void>(options?: {
  /** Runs right after begin(), before the operation. May return a sonner
   *  toast id (e.g. from `toast.loading(...)`); the id is handed to
   *  onSuccess/onError so they can replace the loading toast with
   *  `{ id }` — the PdfUploader/BackupReminderBanner pattern. */
  onStart?: () => string | number | void;
  onSuccess?: (result: T, toastId?: string | number) => void;
  onError?: (error: unknown, toastId?: string | number) => void;
  blockReentry?: boolean;
}): {
  run: (operation: () => Promise<T>) => Promise<T | undefined>;
  /** Variant that hands the operation the guard's AbortSignal (fetch/worker
   *  cancellation, e.g. the PDF export path that must abort on unmount). */
  runWithSignal: (
    operation: (signal: AbortSignal) => Promise<T>,
  ) => Promise<T | undefined>;
  isRunning: boolean;
  cancel: () => void;
} {
  const { begin, isCurrent, cancel: cancelGuard } = useRequestGuard();
  const [isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const runWithSignal = useCallback(
    async (
      operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<T | undefined> => {
      if (optionsRef.current?.blockReentry !== false && isRunningRef.current) {
        return undefined;
      }
      const { generation, signal } = begin();
      isRunningRef.current = true;
      setIsRunning(true);
      let toastId: string | number | undefined;
      const startId = optionsRef.current?.onStart?.();
      if (typeof startId === "string" || typeof startId === "number") {
        toastId = startId;
      }
      try {
        const result = await operation(signal);
        if (!isCurrent(generation)) {return undefined;}
        if (toastId === undefined) {
          optionsRef.current?.onSuccess?.(result);
        } else {
          optionsRef.current?.onSuccess?.(result, toastId);
        }
        return result;
      } catch (error) {
        if (!isCurrent(generation)) {return undefined;}
        if (toastId === undefined) {
          optionsRef.current?.onError?.(error);
        } else {
          optionsRef.current?.onError?.(error, toastId);
        }
        return undefined;
      } finally {
        isRunningRef.current = false;
        if (isCurrent(generation)) {
          setIsRunning(false);
        }
      }
    },
    [begin, isCurrent],
  );

  const run = useCallback(
    (operation: () => Promise<T>): Promise<T | undefined> =>
      runWithSignal(() => operation()),
    [runWithSignal],
  );

  // Explicit cancel (e.g. a parent action that must abort an in-flight
  // operation while still mounted, like BookmarkNostalgia's year switch)
  // must also reset the running flag: the operation's finally skips
  // setIsRunning(false) because its generation is no longer current.
  const cancel = useCallback(() => {
    isRunningRef.current = false;
    setIsRunning(false);
    cancelGuard();
  }, [cancelGuard]);

  return { run, runWithSignal, isRunning, cancel };
}
