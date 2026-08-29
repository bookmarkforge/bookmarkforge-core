import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockSetForceSetup = vi.fn();
const mockToast = { info: vi.fn() };

vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: () => ({
    isLocked: false,
    setForceSetup: mockSetForceSetup,
  }),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({
    autoLockEnabled: true,
    autoLockTimeout: 300000,
  }),
}));

vi.mock("sonner", () => ({
  toast: { info: (...args: unknown[]) => mockToast.info(...args) },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { AutoLockManager } from "../../hooks/AutoLockManager";

describe("AutoLockManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSetForceSetup.mockClear();
    mockToast.info.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing", () => {
    // AutoLockManager returns null; renderHook executes the component and
    // surfaces its return value (the MantineProvider wrapper injected by
    // setup.ts would otherwise put <style> tags into the container).
    const { result } = renderHook(() => AutoLockManager());
    expect(result.current).toBeNull();
  });

  it("locks vault after timeout", () => {
    renderHook(() => AutoLockManager());

    act(() => {
      vi.advanceTimersByTime(300000); // 5 minutes
    });

    expect(mockSetForceSetup).toHaveBeenCalledWith(true);
    expect(mockToast.info).toHaveBeenCalled();
  });

  it("does not lock before timeout", () => {
    renderHook(() => AutoLockManager());

    act(() => {
      vi.advanceTimersByTime(299000); // Just under 5 minutes
    });

    expect(mockSetForceSetup).not.toHaveBeenCalled();
  });

  it("resets timer on activity", () => {
    renderHook(() => AutoLockManager());

    // Advance 4 minutes
    act(() => {
      vi.advanceTimersByTime(240000);
    });

    // Simulate activity
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove"));
    });

    // Advance another 4 minutes (total 8 min, but only 4 since activity)
    act(() => {
      vi.advanceTimersByTime(240000);
    });

    // Should not have locked yet (only 4 min since last activity)
    expect(mockSetForceSetup).not.toHaveBeenCalled();
  });

  it("respects cooldown period", () => {
    renderHook(() => AutoLockManager());

    // Two rapid mouse moves within cooldown (2s)
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove"));
    });

    act(() => {
      vi.advanceTimersByTime(1000); // 1 second
    });

    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove"));
    });

    // The timer should only have been reset once (second event was within cooldown)
  });

  it("cleans up event listeners on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => AutoLockManager());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "mousemove",
      expect.any(Function),
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
    );

    removeEventListenerSpy.mockRestore();
  });

  it("clears timeout on unmount", () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const { unmount } = renderHook(() => AutoLockManager());

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it("responds to keyboard events", () => {
    renderHook(() => AutoLockManager());

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });

    // Timer should be reset
    act(() => {
      vi.advanceTimersByTime(300000);
    });

    expect(mockSetForceSetup).toHaveBeenCalled();
  });

  it("responds to click events", () => {
    renderHook(() => AutoLockManager());

    act(() => {
      window.dispatchEvent(new MouseEvent("click"));
    });

    act(() => {
      vi.advanceTimersByTime(300000);
    });

    expect(mockSetForceSetup).toHaveBeenCalled();
  });

  it("responds to scroll events", () => {
    renderHook(() => AutoLockManager());

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    act(() => {
      vi.advanceTimersByTime(300000);
    });

    expect(mockSetForceSetup).toHaveBeenCalled();
  });
});
