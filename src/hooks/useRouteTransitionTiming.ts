import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { logger } from "../utils/logger";

/**
 * Lightweight route transition timing via performance.mark / performance.measure.
 *
 * Marks a "route-transition" span from the moment the location changes to
 * after the browser has painted the new route. The measured duration is logged
 * at info level in dev and fed into the DiagnosticService's performance
 * metrics in production (via the existing PerformanceObserver infrastructure).
 *
 * Safe to use in production — the overhead of two performance.mark calls per
 * navigation is negligible (< 0.01 ms).
 */
export function useRouteTransitionTiming(): void {
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);
  const rafIdsRef = useRef<number[]>([]);

  useEffect(() => {
    const prevPath = prevPathRef.current;
    const currentPath = location.pathname;

    // Skip the very first render (no transition) and same-path searches
    if (prevPath === currentPath) {
      return;
    }

    prevPathRef.current = currentPath;

    const markName = `route-transition:${currentPath}`;
    performance.mark(markName);

    // Measure after the next paint so the span includes React's commit +
    // browser layout/paint. requestAnimationFrame alone is not enough in
    // some browsers that batch paints; a double-rAF is reliable.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        try {
          performance.measure(markName, markName);
          const entries = performance.getEntriesByName(markName, "measure");
          const last = entries[entries.length - 1];
          if (last) {
            const ms = Math.round(last.duration);
            if (import.meta.env.DEV) {
              logger.info(
                `[RouteTransition] ${prevPath} → ${currentPath}: ${ms}ms`,
              );
            }
            // Clean up the measure entry to avoid memory growth in SPA
            // with hundreds of navigations.
            performance.clearMeasures(markName);
            performance.clearMarks(markName);
          }
        } catch {
          /* INTENTIONAL SILENCE: Performance.measure may throw in rare
             cross-origin or test environments — never let timing crash the app. */
        }
      });
      rafIdsRef.current = [raf2];
    });
    rafIdsRef.current = [raf1];

    return () => {
      for (const id of rafIdsRef.current) {
        cancelAnimationFrame(id);
      }
      rafIdsRef.current = [];
    };
  }, [location.pathname]);
}
