/**
 * Intelligent route prefetching utility
 * Prefetches routes based on user behavior patterns
 */
import { logger } from "./logger";

interface PrefetchConfig {
  threshold?: number; // Time in ms before prefetching
  enabled?: boolean;
  routes?: Record<string, () => Promise<unknown>>;
}

class RoutePrefetcher {
  public config: Required<PrefetchConfig>;
  private prefetchCache = new Map<string, Promise<unknown>>();
  private observer: IntersectionObserver | null = null;
  private pendingNavigationTimers = new Set<ReturnType<typeof setTimeout>>();
  private lastNavigation = Date.now();

  constructor(config: PrefetchConfig = {}) {
    this.config = {
      threshold: 200,
      enabled: true,
      routes: {},
      ...config,
    };

    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.prefetchVisibleRoutes();
          }
        });
      });
      if (typeof document !== "undefined" && document.body) {
        this.observer.observe(document.body);
      }
    }
  }

  /**
   * Prefetch a specific route
   */
  async prefetchRoute(route: string): Promise<void> {
    if (!this.config.enabled || this.prefetchCache.has(route)) {
      return;
    }

    const routeLoader = this.config.routes[route];
    if (!routeLoader) {
      return;
    }

    try {
      const promise = routeLoader();
      this.prefetchCache.set(route, promise);
      await promise;
    } catch (error) {
      logger.warn(`[RoutePrefetcher] Failed to prefetch ${route}`, { error });
      this.prefetchCache.delete(route);
    }
  }

  /**
   * Prefetch routes that are likely to be visited next
   */
  private prefetchVisibleRoutes(): void {
    const links = document.querySelectorAll("a[href]");
    const routes = Array.from(links)
      .map((link) => {
        const href = link.getAttribute("href");
        return href ? this.extractRouteFromHref(href) : null;
      })
      .filter((route): route is string => route !== null);

    // Prefetch top 3 most likely routes
    const uniqueRoutes = [...new Set(routes)].slice(0, 3);
    uniqueRoutes.forEach((route) => {
      this.prefetchRoute(route);
    });
  }

  /**
   * Extract route name from href
   */
  private extractRouteFromHref(href: string): string | null {
    try {
      const url = new URL(href, window.location.origin);
      const path = url.pathname;

      // Map paths to route keys
      const routeMap: Record<string, string> = {
        "/editor": "/editor",
        "/bookmarks": "/bookmarks",
        "/chat": "/chat",
        "/graph": "/graph",
        "/canvas": "/canvas",
        "/list": "/list",
        "/gallery": "/gallery",
        "/timeline": "/timeline",
        "/analytics": "/analytics",
        "/collaboration": "/collaboration",
        "/voiceLocal": "/voiceLocal",
        "/settings": "/settings",
      };

      return routeMap[path] || null;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Start observing the document for prefetching opportunities
   */
  observe(element: Element): void {
    if (this.observer && element) {
      this.observer.observe(element);
    }
  }

  /**
   * Stop observing
   */
  disconnect(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    for (const timer of this.pendingNavigationTimers) {
      clearTimeout(timer);
    }
    this.pendingNavigationTimers.clear();
    this.prefetchCache.clear();
  }

  /**
   * Record navigation for intelligent prefetching
   */
  recordNavigation(route: string): void {
    this.lastNavigation = Date.now();

    // Prefetch related routes after navigation. Keep the timer cancellable so
    // an unmounted hook cannot retain stale route loaders or start work after
    // its owner has disconnected the prefetcher.
    const timer = setTimeout(() => {
      this.pendingNavigationTimers.delete(timer);
      this.prefetchRelatedRoutes(route);
    }, this.config.threshold);
    this.pendingNavigationTimers.add(timer);
  }

  /**
   * Prefetch routes related to the current route
   */
  private prefetchRelatedRoutes(currentRoute: string): void {
    const relatedRoutes: Record<string, string[]> = {
      "/bookmarks": ["/analytics"],
      "/chat": ["/bookmarks"],
      "/graph": ["/bookmarks"],
      "/canvas": ["/bookmarks"],
      "/gallery": ["/bookmarks"],
      "/timeline": ["/bookmarks"],
      "/analytics": ["/bookmarks"],
      "/collaboration": ["/bookmarks"],
      "/voiceLocal": ["/bookmarks"],
      "/settings": ["/bookmarks"],
    };

    const related = relatedRoutes[currentRoute] || [];
    related.forEach((route) => {
      this.prefetchRoute(route);
    });
  }
}

export const routePrefetcher = new RoutePrefetcher();
