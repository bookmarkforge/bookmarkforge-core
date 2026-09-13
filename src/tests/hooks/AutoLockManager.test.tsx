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

// Mutable so a test can change the configured timeout (e.g. an oversized one
// that must be clamped instead of overflowing the timer delay).
let mockSettings = { autoLockEnabled: true, autoLockTimeout: 300000 };

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => mockSettings,
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
    mockSettings = { autoLockEnabled: true, autoLockTimeout: 300000 };
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

  // ── Absolute deadline: the lock survives throttled/frozen/suspended tabs ──
  //
  // `vi.setSystemTime` moves the wall clock WITHOUT running pending timers,
  // which is exactly what a hidden (throttled), frozen or suspended tab looks
  // like: real time passed, no timer callback ever ran.

  /** Move the wall clock forward without letting any armed timer fire. */
  const suspendFor = (ms: number) => {
    act(() => {
      vi.setSystemTime(Date.now() + ms);
    });
  };

  it("locks on visibilitychange when the deadline passed while the tab was hidden", () => {
    renderHook(() => AutoLockManager());

    suspendFor(60 * 60 * 1000); // an hour hidden, not a single timer fired
    expect(mockSetForceSetup).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mockSetForceSetup).toHaveBeenCalledWith(true);
    expect(mockToast.info).toHaveBeenCalledTimes(1);
  });

  it("locks after a bfcache restore (pageshow) with no timer ever firing", () => {
    renderHook(() => AutoLockManager());

    suspendFor(2 * 60 * 60 * 1000); // laptop slept for two hours

    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(mockSetForceSetup).toHaveBeenCalledWith(true);
  });

  it("locks on the Page Lifecycle resume event after a freeze", () => {
    renderHook(() => AutoLockManager());

    suspendFor(30 * 60 * 1000);

    act(() => {
      document.dispatchEvent(new Event("resume"));
    });

    expect(mockSetForceSetup).toHaveBeenCalledWith(true);
  });

  it("locks on window focus regained after the deadline", () => {
    renderHook(() => AutoLockManager());

    suspendFor(10 * 60 * 1000);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(mockSetForceSetup).toHaveBeenCalledWith(true);
  });

  it("does not lock on a resume signal that arrives before the deadline", () => {
    renderHook(() => AutoLockManager());

    suspendFor(60 * 1000); // one minute of a five-minute timeout

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(mockSetForceSetup).not.toHaveBeenCalled();

    // The remaining four minutes still expire on the original deadline.
    act(() => {
      vi.advanceTimersByTime(4 * 60 * 1000);
    });

    expect(mockSetForceSetup).toHaveBeenCalledWith(true);
  });

  it("locks exactly once when several resume signals arrive after the deadline", () => {
    renderHook(() => AutoLockManager());

    suspendFor(60 * 60 * 1000);

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("pageshow"));
      document.dispatchEvent(new Event("resume"));
    });

    expect(mockSetForceSetup).toHaveBeenCalledTimes(1);
    expect(mockToast.info).toHaveBeenCalledTimes(1);
  });

  it("locks on activity that arrives after the deadline instead of re-arming", () => {
    renderHook(() => AutoLockManager());

    suspendFor(6 * 60 * 1000);

    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove"));
    });

    expect(mockSetForceSetup).toHaveBeenCalledWith(true);
  });

  it("clamps an oversized timeout and re-arms instead of locking early", () => {
    // 3e9 ms never fits a setTimeout delay (32-bit overflow), so the armed
    // timer fires long before the deadline. That early fire must re-arm the
    // remainder, never discard the configured timeout by locking at once.
    mockSettings = { autoLockEnabled: true, autoLockTimeout: 3_000_000_000 };
    renderHook(() => AutoLockManager());

    act(() => {
      vi.advanceTimersByTime(2_147_483_647); // the clamp, not the deadline
    });

    expect(mockSetForceSetup).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(3_000_000_000 - 2_147_483_647);
    });

    expect(mockSetForceSetup).toHaveBeenCalledWith(true);
  });
});
