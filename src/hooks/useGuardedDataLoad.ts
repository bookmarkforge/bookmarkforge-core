import { useCallback, useEffect, useRef, useState } from "react";
import { useRequestGuard } from "./useRequestGuard";

/**
 * Consolidates the data-load boilerplate that the knowledge/* cards,
 * TimelineView and ListView reproduce by hand:
 *
 *   const [loading, setLoading] = useState(true);
 *   const { begin, isCurrent } = useRequestGuard();
 *   const load = useCallback(async () => {
 *     const request = begin();
 *     try {
 *       ... await work() ...
 *       if (!isCurrent(request.generation)) return;
 *       setData(result);
 *     } catch (err) {
 *       if (isCurrent(request.generation)) logger.error(err);
 *     } finally {
 *       if (isCurrent(request.generation)) setLoading(false);
 *     }
 *   }, [begin, isCurrent]);
 *   useEffect(() => { void load(); }, [load]);
 *
 * The hook owns the guard and the loading flag:
 *   - `load` begins a new generation each call, so a newer load (or unmount,
 *     via the guard's auto-cancel) invalidates any in-flight one — late
 *     results and errors are dropped, and loading is only reset by the
 *     invocation that is still current.
 *   - The loader receives the guard's AbortSignal so it can early-exit
 *     expensive work at await boundaries (`signal.aborted`) exactly like the
 *     hand-written `isCurrent(generation)` checks — the hook ALSO gates
 *     onSuccess/onError by generation, so the loader does not need to.
 *   - `load`'s identity is stable (the loader is read through a ref), so it
 *     is safe as a useEffect dependency and can be handed to actions that
 *     must refresh the data after a mutation.
 *   - `autoLoad` (default true) runs the load on mount, replacing the
 *     `useEffect(() => { void load(); }, [load])` line.
 *
 * Callback contract — ref-read-latest time: `onSuccess`/`onError` follow the
 * same contract as the action hooks: they are looked up in `optionsRef` when
 * the settle happens, so they run the closures from the LATEST render, not
 * the ones passed when the load began. Generation gating decides WHETHER
 * they fire. The loader itself is read from `loaderRef` at the moment
 * `load()` is invoked (the ref points at the latest render's loader when
 * the call starts), so the earliest invocation always runs the newest
 * loader — consistent with the stable-identity design. Do not rely on
 * stale-closure semantics.
 */
export function useGuardedDataLoad<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  options?: {
    onSuccess?: (data: T) => void;
    onError?: (error: unknown) => void;
    /** Runs `load` once on mount. Default true. */
    autoLoad?: boolean;
    /** Initial loading state. Default true (all existing data-loads start
     *  showing a spinner/empty shell until the first fetch settles). */
    initialLoading?: boolean;
  },
): {
  /** Stable identity. Returns the data (or undefined when superseded). */
  load: () => Promise<T | undefined>;
  loading: boolean;
  cancel: () => void;
} {
  const { begin, isCurrent, cancel: cancelGuard } = useRequestGuard();
  const [loading, setLoading] = useState(options?.initialLoading ?? true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const load = useCallback(async (): Promise<T | undefined> => {
    const { generation, signal } = begin();
    setLoading(true);
    try {
      const data = await loaderRef.current(signal);
      if (!isCurrent(generation)) {return undefined;}
      optionsRef.current?.onSuccess?.(data);
      return data;
    } catch (error) {
      if (!isCurrent(generation)) {return undefined;}
      optionsRef.current?.onError?.(error);
      return undefined;
    } finally {
      if (isCurrent(generation)) {
        setLoading(false);
      }
    }
  }, [begin, isCurrent]);

  const autoLoad = options?.autoLoad ?? true;
  useEffect(() => {
    if (autoLoad) {
      void load();
    }
  }, [autoLoad, load]);

  // Explicit cancel (e.g. a parent effect that must invalidate an in-flight
  // load while still mounted, like DocumentManager's semantic-search effect)
  // must also reset the loading flag: the load's finally skips
  // setLoading(false) because its generation is no longer current. Mirrors
  // the useGuardedAction cancel contract.
  const cancel = useCallback(() => {
    setLoading(false);
    cancelGuard();
  }, [cancelGuard]);

  return { load, loading, cancel };
}
