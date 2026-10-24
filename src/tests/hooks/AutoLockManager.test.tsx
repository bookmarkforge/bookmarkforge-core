import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockLock = vi.fn();
const mockToast = { info: vi.fn() };

vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: () => ({
    isLocked: false,
    lock: mockLock,
  }),
}));

vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    hasMasterPassword: vi.fn().mockResolvedValue(true),
    isLocked: vi.fn(() => false),
    lock: vi.fn().mockResolvedValue(undefined),
    onLock: vi.fn(),
    onUnlock: vi.fn(),
  },
}));

vi.mock("../../services/EncryptionService", () => ({
  encryptionService: {
    destroy: vi.fn().mockResolvedValue(undefined),
  },
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
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

import { AutoLockManager } from "../../hooks/AutoLockManager";
import { securityVault } from "../../services/SecurityVault";

const mockHasMasterPassword = vi.mocked(securityVault.hasMasterPassword);

describe("AutoLockManager", () => {
  const renderAutoLockManager = async () => {
    const hook = renderHook(() => AutoLockManager());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return hook;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockHasMasterPassword.mockResolvedValue(true);
    mockSettings = { autoLockEnabled: true, autoLockTimeout: 300000 };
    mockLock.mockClear();
    mockToast.info.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing", async () => {
    // AutoLockManager returns null; renderHook executes the component and
    // surfaces its return value (the MantineProvider wrapper injected by
    // setup.ts would otherwise put <style> tags into the container).
    const { result } = await renderAutoLockManager();
    expect(result.current).toBeNull();
  });

  it("locks vault after timeout", async () => {
    await renderAutoLockManager();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300000);
    });

    expect(mockLock).toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalled();
  });

  it("does not arm auto-lock for passwordless vaults", async () => {
    mockHasMasterPassword.mockResolvedValue(false);
    await renderAutoLockManager();

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });

    expect(mockLock).not.toHaveBeenCalled();
    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it("keeps auto-lock disabled when the password check fails", async () => {
    mockHasMasterPassword.mockRejectedValue(new Error("storage unavailable"));
    await renderAutoLockManager();

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });

    expect(mockLock).not.toHaveBeenCalled();
  });

  it("does not lock before timeout", async () => {
    await renderAutoLockManager();

    act(() => {
      vi.advanceTimersByTime(299000); // Just under 5 minutes
    });

    expect(mockLock).not.toHaveBeenCalled();
  });

  it("resets timer on activity", async () => {
    await renderAutoLockManager();

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
    expect(mockLock).not.toHaveBeenCalled();
  });

  it("respects cooldown period", async () => {
    await renderAutoLockManager();

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

  it("cleans up event listeners on unmount", async () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = await renderAutoLockManager();

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

  it("clears timeout on unmount", async () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const { unmount } = await renderAutoLockManager();

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it("responds to keyboard events", async () => {
    await renderAutoLockManager();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });

    // Timer should be reset
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300000);
    });

    expect(mockLock).toHaveBeenCalled();
  });

  it("responds to click events", async () => {
    await renderAutoLockManager();

    act(() => {
      window.dispatchEvent(new MouseEvent("click"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300000);
    });

    expect(mockLock).toHaveBeenCalled();
  });

  it("responds to scroll events", async () => {
    await renderAutoLockManager();

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300000);
    });

    expect(mockLock).toHaveBeenCalled();
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

  it("locks on visibilitychange when the deadline passed while the tab was hidden", async () => {
    await renderAutoLockManager();

    suspendFor(60 * 60 * 1000); // an hour hidden, not a single timer fired
    expect(mockLock).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mockLock).toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledTimes(1);
  });

  it("locks after a bfcache restore (pageshow) with no timer ever firing", async () => {
    await renderAutoLockManager();

    suspendFor(2 * 60 * 60 * 1000); // laptop slept for two hours

    await act(async () => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(mockLock).toHaveBeenCalled();
  });

  it("locks on the Page Lifecycle resume event after a freeze", async () => {
    await renderAutoLockManager();

    suspendFor(30 * 60 * 1000);

    await act(async () => {
      document.dispatchEvent(new Event("resume"));
    });

    expect(mockLock).toHaveBeenCalled();
  });

  it("locks on window focus regained after the deadline", async () => {
    await renderAutoLockManager();

    suspendFor(10 * 60 * 1000);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(mockLock).toHaveBeenCalled();
  });

  it("does not lock on a resume signal that arrives before the deadline", async () => {
    await renderAutoLockManager();

    suspendFor(60 * 1000); // one minute of a five-minute timeout

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(mockLock).not.toHaveBeenCalled();

    // The remaining four minutes still expire on the original deadline.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    });

    expect(mockLock).toHaveBeenCalled();
  });

  it("locks exactly once when several resume signals arrive after the deadline", async () => {
    await renderAutoLockManager();

    suspendFor(60 * 60 * 1000);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("pageshow"));
      document.dispatchEvent(new Event("resume"));
    });

    expect(mockLock).toHaveBeenCalledTimes(1);
    expect(mockToast.info).toHaveBeenCalledTimes(1);
  });

  it("locks on activity that arrives after the deadline instead of re-arming", async () => {
    await renderAutoLockManager();

    suspendFor(6 * 60 * 1000);

    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousemove"));
    });

    expect(mockLock).toHaveBeenCalled();
  });

  it("clamps an oversized timeout and re-arms instead of locking early", async () => {
    // 3e9 ms never fits a setTimeout delay (32-bit overflow), so the armed
    // timer fires long before the deadline. That early fire must re-arm the
    // remainder, never discard the configured timeout by locking at once.
    mockSettings = { autoLockEnabled: true, autoLockTimeout: 3_000_000_000 };
    await renderAutoLockManager();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_147_483_647); // the clamp, not the deadline
    });

    expect(mockLock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000_000_000 - 2_147_483_647);
    });

    expect(mockLock).toHaveBeenCalled();
  });
});
