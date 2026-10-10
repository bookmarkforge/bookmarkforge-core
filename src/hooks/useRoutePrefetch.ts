import { useEffect, useRef } from "react";
import { routePrefetcher } from "../utils/prefetcher";

interface UseRoutePrefetchOptions {
  enabled?: boolean;
  routes?: Record<string, () => Promise<unknown>>;
}

export function useRoutePrefetch(options: UseRoutePrefetchOptions = {}) {
  const { enabled = true, routes = {} } = options;
  const containerRef = useRef<HTMLDivElement>(null);

  // Store routes in a ref to avoid re-running the effect when the caller
  // passes a new object reference (inline object literal in JSX).
  const routesRef = useRef(routes);
  routesRef.current = routes;

  useEffect(() => {
    if (!enabled) {return;}

    // Configure route prefetcher
    routePrefetcher.config.routes = routesRef.current;
    routePrefetcher.config.enabled = true;

    // Start observing for prefetching opportunities
    if (containerRef.current) {
      routePrefetcher.observe(containerRef.current);
    }

    return () => {
      routePrefetcher.disconnect();
    };
  }, [enabled]);

  const prefetchRoute = (route: string) => {
    routePrefetcher.prefetchRoute(route);
  };

  const recordNavigation = (route: string) => {
    routePrefetcher.recordNavigation(route);
  };

  return {
    prefetchRoute,
    recordNavigation,
    containerRef,
  };
}
