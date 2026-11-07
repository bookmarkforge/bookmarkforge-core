import { useCallback, useEffect, useRef, useState } from "react";
import { useRequestGuard } from "./useRequestGuard";

interface GuardedActionOptions<T> {
  /** Runs right after begin(), before the operation. May return a sonner
   *  toast id (e.g. from `toast.loading(...)`); the id is handed to
   *  onSuccess/onError so they can dismiss/replace it — the
   *  CloudSyncSection restore pattern. */
  onStart?: () => string | number | void;
  onSuccess?: (result: T, toastId?: string | number) => void;
  onError?: (error: unknown, toastId?: string | number) => void;
  blockReentry?: boolean;
}

type GuardedActionsConfig<M extends Record<string, unknown>> = {
  [K in keyof M]: GuardedActionOptions<M[K]>;
};

type GuardedActionsReturn<M extends Record<string, unknown>> = {
  [K in keyof M]: {
    run: (operation: () => Promise<M[K]>) => Promise<M[K] | undefined>;
    /** Variant that hands the operation the shared guard's AbortSignal
     *  (fetch/worker cancellation), mirroring `useGuardedAction`'s
     *  runWithSignal — the BookmarkReaderModal copilot pattern where each
     *  AI call must abort when superseded or on unmount. */
    runWithSignal: (
      operation: (signal: AbortSignal) => Promise<M[K]>,
    ) => Promise<M[K] | undefined>;
    isRunning: boolean;
  };
} & {
  /** Invalidates every in-flight action and resets all running flags — the
   *  DocumentManager pattern where switching folders drops the toasts of a
   *  slow mutation still in flight. */
  cancel: () => void;
};

/**
 * Shared-guard variant of `useGuardedAction`: every action runs through ONE
 * `useRequestGuard`, so beginning any action invalidates every other action
 * still in flight — the ModelManagerSection pattern where `deleteModel` begun
 * during a slow `loadStatus` must discard the stale status update (and its
 * toasts) when it resolves.
 *
 * Unlike the single-action helper, running state is tracked per action with
 * an in-flight COUNT (not a boolean): a same-action refresh
 * (`blockReentry: false`) keeps the flag set until the LAST invocation
 * settles, while a different action completing only clears its own flag.
 * `onSuccess`/`onError` still only fire while the invocation is current.
 *
 * `runWithSignal` hands the operation the AbortSignal of its own
 * invocation (the guard aborts it when a newer action begins or on unmount),
 * for AI/fetch calls that must stop at await boundaries.
 *
 * Callback contract — ref-read-latest time: like `useGuardedAction`, all
 * option callbacks (`onStart`, `onSuccess`, `onError`) are read from
 * `actionsRef` at the moment the event fires, so they run the closures from
 * the LATEST render, not the ones that began the invocation. Generation
 * gating decides WHETHER a callback fires; the ref decides WHICH closure
 * runs. `blockReentry` (and other per-action options) are likewise resolved
 * from the latest config at invocation time. Consumers swapping callbacks
 * between renders must expect the newest closure to handle a settle.
 */
export function useGuardedActions<
  M extends Record<string, unknown>,
>(actions: GuardedActionsConfig<M>): GuardedActionsReturn<M> {
  const { begin, isCurrent, cancel: cancelGuard } = useRequestGuard();
  // The value is never read: isRunning is derived from inFlightRef during
  // render; setRunning only forces the re-render when a flag flips.
  const [, setRunning] = useState<Record<string, boolean>>({});
  const inFlightRef = useRef<Record<string, number>>({});
  const actionsRef = useRef<GuardedActionsConfig<M>>(actions);
  actionsRef.current = actions;
  // After unmount the ref counts still settle, but setRunning must not fire
  // (React warns on state updates to unmounted components).
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const runShared = useCallback(
    (
      name: keyof M,
      operation: (signal: AbortSignal) => Promise<unknown>,
    ): Promise<unknown> => {
      const opts = actionsRef.current[name];
      const inFlight = inFlightRef.current[name as string] ?? 0;
      if (opts?.blockReentry !== false && inFlight > 0) {
        return Promise.resolve(undefined);
      }
      // Reserve the invocation BEFORE begin(): begin() aborts the previous
      // generation, but if two invocations of the same action enter here in
      // the same tick, both would read inFlight = 0 and both would write
      // 0 + 1, collapsing the count. Reserving first keeps the counter
      // monotonic so the in-flight flag stays set until the LAST settles.
      const nameKey = name as string;
      inFlightRef.current[nameKey] = inFlight + 1;
      // Shared guard: any new action invalidates everything in flight.
      const { generation, signal } = begin();
      if (mountedRef.current) {
        setRunning((r) => ({ ...r, [name as string]: true }));
      }
      let toastId: string | number | undefined;
      const startId = opts?.onStart?.();
      if (typeof startId === "string" || typeof startId === "number") {
        toastId = startId;
      }
      return (async () => {
        try {
          const result = await operation(signal);
          if (!isCurrent(generation)) {return undefined;}
          if (toastId === undefined) {
            opts?.onSuccess?.(result as M[keyof M]);
          } else {
            opts?.onSuccess?.(result as M[keyof M], toastId);
          }
          return result;
        } catch (error) {
          if (!isCurrent(generation)) {return undefined;}
          if (toastId === undefined) {
            opts?.onError?.(error);
          } else {
            opts?.onError?.(error, toastId);
          }
          return undefined;
        } finally {
          const next = (inFlightRef.current[name as string] ?? 1) - 1;
          if (next <= 0) {
            delete inFlightRef.current[name as string];
          } else {
            inFlightRef.current[name as string] = next;
          }
          if (mountedRef.current) {
            setRunning((r) => ({
              ...r,
              [name as string]: (inFlightRef.current[name as string] ?? 0) > 0,
            }));
          }
        }
      })();
    },
    [begin, isCurrent],
  );

  // Explicit cancel while still mounted: invalidate every in-flight action
  // and reset all running flags (the in-flight finallys skip setRunning
  // because their generations are no longer current, and their onSuccess/
  // onError are dropped by the guard — the DocumentManager folder-switch
  // semantics).
  const cancel = useCallback(() => {
    for (const key of Object.keys(inFlightRef.current)) {
      delete inFlightRef.current[key];
    }
    if (mountedRef.current) {
      setRunning({});
    }
    cancelGuard();
  }, [cancelGuard]);

  const result = {} as GuardedActionsReturn<M>;
  for (const name of Object.keys(actions) as Array<keyof M>) {
    result[name] = {
      run: (operation: () => Promise<M[keyof M]>) =>
        runShared(name, () => operation()) as Promise<M[keyof M] | undefined>,
      runWithSignal: (
        operation: (signal: AbortSignal) => Promise<M[keyof M]>,
      ) => runShared(name, operation) as Promise<M[keyof M] | undefined>,
      isRunning: (inFlightRef.current[name as string] ?? 0) > 0,
    } as GuardedActionsReturn<M>[keyof M];
  }
  result.cancel = cancel;
  return result;
}
