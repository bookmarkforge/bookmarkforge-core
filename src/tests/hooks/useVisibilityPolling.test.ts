import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useVisibilityPolling } from "../../hooks/useVisibilityPolling";

const setVisibilityState = (value: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
};

const dispatchVisibilityChange = () => {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

describe("useVisibilityPolling", () => {
  beforeEach(() => {
    setVisibilityState("visible");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts polling when the tab is initially visible", () => {
    const callback = vi.fn();
    renderHook(() => useVisibilityPolling(callback, { intervalMs: 1000 }));
    // One setInterval call on mount.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("pauses while hidden and resumes on visibility change", () => {
    const callback = vi.fn();
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const { unmount } = renderHook(() =>
      useVisibilityPolling(callback, { intervalMs: 1000 }),
    );
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    setVisibilityState("hidden");
    setIntervalSpy.mockClear();
    dispatchVisibilityChange();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    // No new setInterval should fire while hidden.
    expect(setIntervalSpy).not.toHaveBeenCalled();

    setVisibilityState("visible");
    dispatchVisibilityChange();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
    unmount();
  });

  it("fires callback once on resume by default (refreshOnResume: true)", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() =>
      useVisibilityPolling(callback, { intervalMs: 1000 }),
    );
    setVisibilityState("hidden");
    dispatchVisibilityChange();
    callback.mockClear();
    setVisibilityState("visible");
    dispatchVisibilityChange();
    // Fresh callback fired once on resume; the timer itself fires again on
    // its cadence after the resume.
    expect(callback).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(callback).toHaveBeenCalledTimes(4);
    unmount();
  });

  it("does not fire on resume when refreshOnResume is false", () => {
    const callback = vi.fn();
    setVisibilityState("hidden");
    renderHook(() =>
      useVisibilityPolling(callback, {
        intervalMs: 1000,
        refreshOnResume: false,
      }),
    );
    callback.mockClear();
    setVisibilityState("visible");
    dispatchVisibilityChange();
    expect(callback).toHaveBeenCalledTimes(0);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("does not start polling when initially hidden and waitForVisibility is true", () => {
    const callback = vi.fn();
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    setVisibilityState("hidden");
    renderHook(() => useVisibilityPolling(callback, { intervalMs: 1000 }));
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setVisibilityState("visible");
    dispatchVisibilityChange();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });

  it("starts polling immediately even when initially hidden if waitForVisibility is false", () => {
    const callback = vi.fn();
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    setVisibilityState("hidden");
    renderHook(() =>
      useVisibilityPolling(callback, {
        intervalMs: 1000,
        waitForVisibility: false,
      }),
    );
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });

  it("keeps polling on hidden tab if pauseOnHidden is false", () => {
    const callback = vi.fn();
    setVisibilityState("visible");
    const { unmount } = renderHook(() =>
      useVisibilityPolling(callback, {
        intervalMs: 1000,
        waitForVisibility: false,
        pauseOnHidden: false,
      }),
    );
    setVisibilityState("hidden");
    callback.mockClear();
    dispatchVisibilityChange();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // Polling continues despite hidden.
    expect(callback).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("clears interval on unmount", () => {
    const callback = vi.fn();
    const clearSpy = vi.spyOn(global, "clearInterval");
    const { unmount } = renderHook(() =>
      useVisibilityPolling(callback, { intervalMs: 1000 }),
    );
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("does not restart the interval when callback reference changes unnecessarily", () => {
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) =>
        useVisibilityPolling(cb, { intervalMs: 1000 }),
      { initialProps: { cb: vi.fn() } },
    );
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockClear();
    rerender({ cb: vi.fn() });
    // The hook stores the callback in a ref precisely so a new function
    // reference does NOT re-create the interval (see callbackRef in the
    // hook). Only option changes (intervalMs, flags) restart it.
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});
