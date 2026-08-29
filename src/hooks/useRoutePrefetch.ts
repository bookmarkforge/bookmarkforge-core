import { useEffect, useRef } from "react";
import { routePrefetcher } from "../utils/prefetcher";

interface UseRoutePrefetchOptions {
  enabled?: boolean;
  routes?: Record<string, () => Promise<unknown>>;
}

export function useRoutePrefetch(options: UseRoutePrefetchOptions = {}) {
  const { enabled = true, routes = {} } = options;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) {return;}

    // Configure route prefetcher
    routePrefetcher.config.routes = routes;
    routePrefetcher.config.enabled = true;

    // Start observing for prefetching opportunities
    if (containerRef.current) {
      routePrefetcher.observe(containerRef.current);
    }

    return () => {
      routePrefetcher.disconnect();
    };
  }, [enabled, routes]);

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
