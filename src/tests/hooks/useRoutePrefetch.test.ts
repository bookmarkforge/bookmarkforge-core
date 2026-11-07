import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock("../../utils/prefetcher", () => ({
  routePrefetcher: {
    config: { routes: {}, enabled: false },
    observe: vi.fn(),
    disconnect: vi.fn(),
    prefetchRoute: vi.fn(),
    recordNavigation: vi.fn(),
  },
}));

describe("useRoutePrefetch", () => {
  let useRoutePrefetch: any;

  beforeEach(async () => {
    const mod = await import("../../hooks/useRoutePrefetch");
    useRoutePrefetch = mod.useRoutePrefetch;
  });

  it("should return containerRef and helpers", () => {
    const { result } = renderHook(() => useRoutePrefetch());
    expect(result.current.containerRef).toBeDefined();
    expect(typeof result.current.prefetchRoute).toBe("function");
    expect(typeof result.current.recordNavigation).toBe("function");
  });

  it("should configure routes when enabled", async () => {
    const { routePrefetcher } = await import("../../utils/prefetcher");
    renderHook(() =>
      useRoutePrefetch({
        enabled: true,
        routes: { home: () => Promise.resolve() },
      }),
    );
    expect(routePrefetcher.config.enabled).toBe(true);
    expect(routePrefetcher.config.routes).toEqual({
      home: expect.any(Function),
    });
  });

  it("should not call observe when disabled", async () => {
    const { routePrefetcher } = await import("../../utils/prefetcher");
    renderHook(() => useRoutePrefetch({ enabled: false }));
    expect(routePrefetcher.observe).not.toHaveBeenCalled();
  });

  it("should call prefetchRoute", async () => {
    const { routePrefetcher } = await import("../../utils/prefetcher");
    const { result } = renderHook(() => useRoutePrefetch());
    act(() => {
      result.current.prefetchRoute("test-route");
    });
    expect(routePrefetcher.prefetchRoute).toHaveBeenCalledWith("test-route");
  });

  it("should call recordNavigation", async () => {
    const { routePrefetcher } = await import("../../utils/prefetcher");
    const { result } = renderHook(() => useRoutePrefetch());
    act(() => {
      result.current.recordNavigation("test-route");
    });
    expect(routePrefetcher.recordNavigation).toHaveBeenCalledWith("test-route");
  });

  it("should disconnect on unmount", async () => {
    const { routePrefetcher } = await import("../../utils/prefetcher");
    const { unmount } = renderHook(() => useRoutePrefetch({ enabled: true }));
    unmount();
    expect(routePrefetcher.disconnect).toHaveBeenCalled();
  });
});
