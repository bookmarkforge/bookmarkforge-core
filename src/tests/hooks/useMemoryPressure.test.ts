import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock all external dependencies at the top level
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/ai/ResourceManager", () => ({
  resourceManager: { unload: vi.fn() },
}));

vi.mock("../../services/GarbageCollectionService", () => ({
  garbageCollectionService: {
    triggerManualCleanup: vi.fn().mockResolvedValue(undefined),
  },
}));

// WebLLMService is Pro: the double is installed at the pro-access loader
// instead of at the Pro module (the hook unloads engines through the gate).
vi.mock("../../services/pro-access", () => ({
  loadWebLLMService: () =>
    Promise.resolve({
      unload: vi.fn().mockResolvedValue(undefined),
    }),
  ProUnavailableError: class ProUnavailableError extends Error {},
}));

vi.mock("../services/ai/RAGEngine", () => ({
  ragEngine: { unload: vi.fn().mockResolvedValue(undefined) },
}));

import { useMemoryPressure } from "../../hooks/useMemoryPressure";

describe("useMemoryPressure", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const perfMemory = {
      usedJSHeapSize: 500_000_000,
      jsHeapSizeLimit: 1_000_000_000,
    };
    Object.defineProperty(performance, "memory", {
      value: perfMemory,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as any).MemoryPressureObserver;
    delete (window as any).onmemorypressure;
  });

  it("starts without memory pressure", () => {
    const { result } = renderHook(() => useMemoryPressure());
    expect(result.current).toBe(false);
  });

  it("detects moderate pressure via performance.memory (80%)", () => {
    Object.defineProperty(performance, "memory", {
      value: { usedJSHeapSize: 800_000_000, jsHeapSizeLimit: 1_000_000_000 },
      configurable: true,
    });
    const { result } = renderHook(() => useMemoryPressure());
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    expect(result.current).toBe(true);
  });

  it("detects critical pressure via performance.memory (95%)", () => {
    Object.defineProperty(performance, "memory", {
      value: { usedJSHeapSize: 950_000_000, jsHeapSizeLimit: 1_000_000_000 },
      configurable: true,
    });
    const { result } = renderHook(() => useMemoryPressure());
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    expect(result.current).toBe(true);
  });

  it("does not detect pressure when usage is low (50%)", () => {
    const { result } = renderHook(() => useMemoryPressure());
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    expect(result.current).toBe(false);
  });

  it("responds to the custom simulate-memory-pressure event (critical)", async () => {
    const { result } = renderHook(() => useMemoryPressure());
    act(() => {
      window.dispatchEvent(
        new CustomEvent("simulate-memory-pressure", {
          detail: { pressure: "critical" },
        }),
      );
    });
    await act(async () => {});
    expect(result.current).toBe(true);
  });

  it("responds to the custom simulate-memory-pressure event (moderate)", async () => {
    const { result } = renderHook(() => useMemoryPressure());
    act(() => {
      window.dispatchEvent(
        new CustomEvent("simulate-memory-pressure", {
          detail: { pressure: "moderate" },
        }),
      );
    });
    await act(async () => {});
    expect(result.current).toBe(true);
  });

  it("calls toast.error on critical pressure", async () => {
    const { toast } = await import("sonner");
    renderHook(() => useMemoryPressure());
    act(() => {
      window.dispatchEvent(
        new CustomEvent("simulate-memory-pressure", {
          detail: { pressure: "critical" },
        }),
      );
    });
    await act(async () => {});
    expect(toast.error).toHaveBeenCalled();
  });

  it("does not call toast.error on moderate pressure", async () => {
    const { toast } = await import("sonner");
    renderHook(() => useMemoryPressure());
    act(() => {
      window.dispatchEvent(
        new CustomEvent("simulate-memory-pressure", {
          detail: { pressure: "moderate" },
        }),
      );
    });
    await act(async () => {});
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("uses MemoryPressureObserver if available", () => {
    const observeMock = vi.fn();
    const disconnectMock = vi.fn();
    class MockObserver {
      constructor(
        public callback: (event: { pressure: "moderate" | "critical" }) => void,
      ) {}
      observe = observeMock;
      disconnect = disconnectMock;
    }
    (window as any).MemoryPressureObserver = MockObserver;

    renderHook(() => useMemoryPressure());
    expect(observeMock).toHaveBeenCalled();
  });

  it("disconnects MemoryPressureObserver on unmount", () => {
    const disconnectMock = vi.fn();
    class MockObserver {
      constructor(_cb: any) {}
      observe = vi.fn();
      disconnect = disconnectMock;
    }
    (window as any).MemoryPressureObserver = MockObserver;

    const { unmount } = renderHook(() => useMemoryPressure());
    unmount();
    expect(disconnectMock).toHaveBeenCalled();
  });

  it("clears the interval on unmount", () => {
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const { unmount } = renderHook(() => useMemoryPressure());
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it("clears the simulate-memory-pressure event on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useMemoryPressure());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith(
      "simulate-memory-pressure",
      expect.any(Function),
    );
  });

  it("sets pressure to false when memory is below the threshold", () => {
    // Set high memory usage first to trigger pressure
    Object.defineProperty(performance, "memory", {
      value: { usedJSHeapSize: 800_000_000, jsHeapSizeLimit: 1_000_000_000 },
      configurable: true,
    });
    const { result } = renderHook(() => useMemoryPressure());
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    expect(result.current).toBe(true);

    // Then set low memory usage
    Object.defineProperty(performance, "memory", {
      value: { usedJSHeapSize: 500_000_000, jsHeapSizeLimit: 1_000_000_000 },
      configurable: true,
    });
    // Need to wait for the next interval check
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    expect(result.current).toBe(false);
  });

  it("pauses polling while the tab is hidden and resumes on visibility change", () => {
    Object.defineProperty(performance, "memory", {
      value: { usedJSHeapSize: 500_000_000, jsHeapSizeLimit: 1_000_000_000 },
      configurable: true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    const { unmount } = renderHook(() => useMemoryPressure());
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    // Hide the tab: setInterval must be cleared and no new interval
    // scheduled while hidden, even if timers advance.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    setIntervalSpy.mockClear();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(60000);
    });
    expect(setIntervalSpy).not.toHaveBeenCalled();

    // Resume on visibility: a new setInterval is scheduled, polling restarts.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    setIntervalSpy.mockRestore();
    unmount();
  });
});
