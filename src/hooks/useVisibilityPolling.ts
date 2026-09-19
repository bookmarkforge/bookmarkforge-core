import { useEffect, useRef } from "react";

/**
 * Options for {@link useVisibilityPolling}.
 */
interface UseVisibilityPollingOptions {
  /** Polling cadence in milliseconds. */
  intervalMs: number;
  /**
   * When the tab returns from hidden to visible, invoke the callback once
   * before resuming the cadence so the UI is not stale for up to one
   * `intervalMs` after the user comes back. Default `true`.
   */
  refreshOnResume?: boolean;
  /**
   * If the tab is hidden when the hook mounts, do not start polling until
   * it becomes visible. Default `true`. Set to `false` for callers that
   * want polling to start regardless (e.g. background data sync).
   */
  waitForVisibility?: boolean;
  /**
   * Skip polling entirely while the tab is hidden. Set to `false` only if
   * `waitForVisibility` is also `false` and the caller explicitly wants
   * a background poll. Default `true` — keep polling responsive to the
   * user's attention.
   */
  pauseOnHidden?: boolean;
}

/**
 * Run `callback` on a fixed cadence, but only while the document is
 * visible.
 *
 * Three behaviors that motivated extracting the hook:
 *   - **Battery / CPU**: a 5 s `setInterval` keeps waking the JS event
 *     loop on a background tab. Pausing while hidden stops the wake-ups.
 *   - **ResourceManager Interaction**: `ResourceManager` already treats
 *     hidden tabs as a no-op, but a stale-interval tick still costs a
 *     function call and a Promise microtask.
 *   - **Visible-Resume UX**: when the user returns to the tab, the UI
 *     should not show stale state for up to one `intervalMs`. The hook
 *     can fire `callback` once on resume before resuming the cadence.
 *
 * The implementation listens to `document.visibilitychange`. SSR-safe:
 * `document` is unguarded because this hook is React-only and runs in
 * the browser. Native event listeners (`visibilitychange`) are still
 * supported on tab switch.
 *
 * @example
 *   useEffect(() => {
 *     void loadStats(); // initial fire from caller
 *   }, []);
 *   useVisibilityPolling(() => void loadStats(), {
 *     intervalMs: 5_000,
 *   });
 */
export function useVisibilityPolling(
  callback: () => void,
  options: UseVisibilityPollingOptions,
): void {
  const {
    intervalMs,
    refreshOnResume = true,
    waitForVisibility = true,
    pauseOnHidden = true,
  } = options;

  // Store the latest callback in a ref to avoid re-creating the interval
  // when the caller passes a new function reference (inline arrow, etc.).
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (typeof document === "undefined") {
      // SSR safety: nothing to do without a document.
      return;
    }
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval !== null) {return;}
      interval = setInterval(() => callbackRef.current(), intervalMs);
    };
    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (refreshOnResume) {
          callbackRef.current();
        }
        start();
      } else if (pauseOnHidden) {
        stop();
      }
    };
    if (document.visibilityState === "visible") {
      start();
    } else if (!waitForVisibility) {
      // Caller wants background polling — start even though hidden.
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [intervalMs, refreshOnResume, waitForVisibility, pauseOnHidden]);
}
