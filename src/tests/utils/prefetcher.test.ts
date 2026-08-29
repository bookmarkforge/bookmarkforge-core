import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { routePrefetcher } from "../../utils/prefetcher";
import { logger } from "../../utils/logger";

describe("RoutePrefetcher", () => {
  let loggerWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    loggerWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("config por defecto", () => {
    it("has threshold 200 by default", () => {
      expect(routePrefetcher.config.threshold).toBe(200);
    });

    it("has enabled true by default", () => {
      expect(routePrefetcher.config.enabled).toBe(true);
    });

    it("has routes as empty object by default", () => {
      expect(routePrefetcher.config.routes).toEqual({});
    });
  });

  describe("prefetchRoute", () => {
    beforeEach(() => {
      routePrefetcher.config.enabled = true;
      routePrefetcher.config.routes = {
        "/editor": vi.fn(() => Promise.resolve("editor-data")),
        "/bookmarks": vi.fn(() => Promise.resolve("bookmarks-data")),
        "/fail": vi.fn(() => Promise.reject(new Error("fail"))),
      };
      // Clear cache between tests (singleton persists across tests)
      routePrefetcher.disconnect();
    });

    afterEach(() => {
      routePrefetcher.config.routes = {};
      routePrefetcher.disconnect();
    });

    it("prefetches a route without errors", async () => {
      await expect(
        routePrefetcher.prefetchRoute("/editor"),
      ).resolves.toBeUndefined();
      expect(routePrefetcher.config.routes["/editor"]).toHaveBeenCalled();
    });

    it("caches: the second call does not execute the loader", async () => {
      await routePrefetcher.prefetchRoute("/editor");
      const callsBefore = (routePrefetcher.config.routes["/editor"] as ReturnType<typeof vi.fn>).mock.calls.length;
      await routePrefetcher.prefetchRoute("/editor");
      expect(routePrefetcher.config.routes["/editor"]).toHaveBeenCalledTimes(callsBefore);
    });

    it("does nothing if the route has no loader", async () => {
      await expect(
        routePrefetcher.prefetchRoute("/nonexistent"),
      ).resolves.toBeUndefined();
    });

    it("does nothing if enabled is false", async () => {
      routePrefetcher.config.enabled = false;
      await routePrefetcher.prefetchRoute("/editor");
      expect(routePrefetcher.config.routes["/editor"]).not.toHaveBeenCalled();
    });

    it("does not fail if the route is null", async () => {
      await expect(
        routePrefetcher.prefetchRoute(null as unknown as string),
      ).resolves.toBeUndefined();
    });

    it("does not fail if the route is undefined", async () => {
      await expect(
        routePrefetcher.prefetchRoute(undefined as unknown as string),
      ).resolves.toBeUndefined();
    });

    it("logs a warn if the prefetch fails", async () => {
      await routePrefetcher.prefetchRoute("/fail");
      expect(loggerWarnSpy).toHaveBeenCalled();
      expect(loggerWarnSpy.mock.calls[0][0]).toContain("Failed to prefetch");
    });
  });

  describe("extractRouteFromHref (private — tested via as any)", () => {
    const extract = (href: string): string | null =>
      (routePrefetcher as any).extractRouteFromHref(href);

    it("extracts /editor correctly", () => {
      expect(extract("http://localhost:5173/editor")).toBe("/editor");
    });

    it("extracts /bookmarks correctly", () => {
      expect(extract("/bookmarks")).toBe("/bookmarks");
    });

    it("extracts /chat correctly", () => {
      expect(extract("/chat")).toBe("/chat");
    });

    it("extracts /graph correctly", () => {
      expect(extract("/graph")).toBe("/graph");
    });

    it("extracts /canvas correctly", () => {
      expect(extract("/canvas")).toBe("/canvas");
    });

    it("extracts /analytics correctly", () => {
      expect(extract("/analytics")).toBe("/analytics");
    });

    it("extracts /collaboration correctly", () => {
      expect(extract("/collaboration")).toBe("/collaboration");
    });

    it("extracts /voiceLocal correctly", () => {
      expect(extract("/voiceLocal")).toBe("/voiceLocal");
    });

    it("extracts /settings correctly", () => {
      expect(extract("/settings")).toBe("/settings");
    });

    it("extracts /list /gallery /timeline", () => {
      expect(extract("/list")).toBe("/list");
      expect(extract("/gallery")).toBe("/gallery");
      expect(extract("/timeline")).toBe("/timeline");
    });

    it("extracts with query params", () => {
      expect(extract("/settings?tab=api")).toBe("/settings");
    });

    it("returns null for unknown routes", () => {
      expect(extract("/unknown")).toBeNull();
    });

    it("returns null for empty href", () => {
      expect(extract("")).toBeNull();
    });

    it("returns null for malformed URL (URL constructor catch)", () => {
      expect(extract("http://[invalid")).toBeNull();
      expect(extract("http://exa mple.com/broken")).toBeNull();
    });
  });

  describe("prefetchVisibleRoutes (private — via documento real)", () => {
    let links: HTMLAnchorElement[];

    beforeEach(() => {
      routePrefetcher.config.enabled = true;
      routePrefetcher.config.routes = {
        "/editor": vi.fn(() => Promise.resolve("e")),
        "/bookmarks": vi.fn(() => Promise.resolve("b")),
        "/chat": vi.fn(() => Promise.resolve("c")),
        "/graph": vi.fn(() => Promise.resolve("g")),
      };
      links = ["/editor", "/bookmarks", "/chat", "/graph", "/editor"].map(
        (href) => {
          const a = document.createElement("a");
          a.setAttribute("href", href);
          document.body.appendChild(a);
          return a;
        },
      );
    });

    afterEach(() => {
      links.forEach((l) => l.remove());
      routePrefetcher.config.routes = {};
      routePrefetcher.disconnect();
    });

    it("prefetches the 3 most likely unique routes of the document", () => {
      (routePrefetcher as any).prefetchVisibleRoutes();
      // Unique routes en orden: /editor, /bookmarks, /chat, /graph → top 3.
      expect(routePrefetcher.config.routes["/editor"]).toHaveBeenCalled();
      expect(routePrefetcher.config.routes["/bookmarks"]).toHaveBeenCalled();
      expect(routePrefetcher.config.routes["/chat"]).toHaveBeenCalled();
      expect(routePrefetcher.config.routes["/graph"]).not.toHaveBeenCalled();
    });

    it("ignores links with empty href (ternary falsy branch)", () => {
      const empty = document.createElement("a");
      empty.setAttribute("href", "");
      document.body.appendChild(empty);
      links.push(empty);
      (routePrefetcher as any).prefetchVisibleRoutes();
      // Does not throw and the valid routes keep being preloaded.
      expect(routePrefetcher.config.routes["/editor"]).toHaveBeenCalled();
    });

    it("does not prefetch anything if enabled is false", () => {
      routePrefetcher.config.enabled = false;
      (routePrefetcher as any).prefetchVisibleRoutes();
      expect(routePrefetcher.config.routes["/editor"]).not.toHaveBeenCalled();
    });
  });

  describe("constructor con IntersectionObserver disponible", () => {
    afterEach(() => {
      delete (globalThis as any).IntersectionObserver;
    });

    it("creates an observer and prefetches visible routes when the callback fires", async () => {
      vi.resetModules();
      let callback: (entries: Array<{ isIntersecting: boolean }>) => void;
      const observed: Element[] = [];
      class MockIntersectionObserver {
        constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
          callback = cb;
        }
        observe(el: Element) {observed.push(el);}
        disconnect() {}
      }
      (globalThis as any).IntersectionObserver = MockIntersectionObserver;

      const mod = await import("../../utils/prefetcher");
      const fresh = mod.routePrefetcher;
      expect(observed.length).toBeGreaterThan(0); // observa document.body

      fresh.config.enabled = true;
      fresh.config.routes = {
        "/editor": vi.fn(() => Promise.resolve("e")),
      };
      const a = document.createElement("a");
      a.setAttribute("href", "/editor");
      document.body.appendChild(a);
      try {
        callback!([{ isIntersecting: true }]);
        expect(fresh.config.routes["/editor"]).toHaveBeenCalled();
      } finally {
        a.remove();
        fresh.disconnect();
      }
    });
  });

  describe("observe / disconnect", () => {
    it("observe does not fail if the element is null", () => {
      routePrefetcher.observe(null as unknown as Element);
    });

    it("observe does not fail with a valid element", () => {
      const el = document.createElement("div");
      routePrefetcher.observe(el);
    });

    it("disconnect no lanza error", () => {
      expect(() => routePrefetcher.disconnect()).not.toThrow();
    });
  });

  describe("recordNavigation", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // The singleton's config persists across tests — an earlier test that
      // set `enabled = false` must not leak into this describe.
      routePrefetcher.config.enabled = true;
      routePrefetcher.config.routes = {
        "/editor": vi.fn(() => Promise.resolve("editor")),
        "/bookmarks": vi.fn(() => Promise.resolve("bookmarks")),
        "/analytics": vi.fn(() => Promise.resolve("analytics")),
      };
      // Fresh prefetch cache so a route prefetched by an earlier test in
      // this describe cannot short-circuit the loader call.
      routePrefetcher.disconnect();
    });

    afterEach(() => {
      vi.useRealTimers();
      routePrefetcher.config.routes = {};
      routePrefetcher.disconnect();
    });

    it("programa prefetch de rutas relacionadas sin errores", () => {
      routePrefetcher.recordNavigation("/editor");
      vi.advanceTimersByTime(201);
    });

    it("prefetches related routes of a known route", () => {
      // /bookmarks → ["/analytics"] in the related-routes map.
      routePrefetcher.recordNavigation("/bookmarks");
      vi.advanceTimersByTime(201);
      expect(routePrefetcher.config.routes["/analytics"]).toHaveBeenCalled();
      expect(routePrefetcher.config.routes["/editor"]).not.toHaveBeenCalled();
    });

    it("does not fail with an unknown route", () => {
      routePrefetcher.recordNavigation("/unknown");
      vi.advanceTimersByTime(201);
    });

    it("cancels the deferred prefetch on disconnect", () => {
      routePrefetcher.recordNavigation("/bookmarks");
      routePrefetcher.disconnect();
      vi.advanceTimersByTime(201);

      expect(routePrefetcher.config.routes["/analytics"]).not.toHaveBeenCalled();
    });
  });

  describe("routePrefetcher singleton", () => {
    it("is an object with config", () => {
      expect(routePrefetcher).toBeDefined();
      expect(routePrefetcher.config).toBeDefined();
      expect(typeof routePrefetcher.config.threshold).toBe("number");
      expect(typeof routePrefetcher.config.enabled).toBe("boolean");
    });

    it("has expected methods", () => {
      expect(typeof routePrefetcher.prefetchRoute).toBe("function");
      expect(typeof routePrefetcher.observe).toBe("function");
      expect(typeof routePrefetcher.disconnect).toBe("function");
      expect(typeof routePrefetcher.recordNavigation).toBe("function");
    });
  });
});
