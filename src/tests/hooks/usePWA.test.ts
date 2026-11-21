import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("../../utils/logger", () => ({ logger: mockLogger }));

/**
 * usePWA.ts was trimmed to its consumed surface (audit): the combined
 * `usePWA()` barrel and unused sub-hooks (useAppBadge, useWebShare,
 * useShareTarget, useWindowControlsOverlay, useBackgroundSync) were removed
 * because nothing in the app consumed them — the share-target flow lives in
 * `src/utils/shareRewrite.ts`. These tests cover what remains:
 * `useInstallPrompt` (consumed by Header via `usePWAInstall`) and the
 * `useFileSystem` / `useDragAndDrop` re-exports.
 */

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
    writable: true,
    configurable: true,
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("useInstallPrompt", () => {
  it("should return install state with defaults", async () => {
    const { useInstallPrompt } = await import("../../hooks/usePWA");
    const { result } = renderHook(() => useInstallPrompt());
    expect(typeof result.current.promptInstall).toBe("function");
    expect(result.current.isInstallable).toBe(false);
    expect(result.current.isInstalled).toBe(false);
  });

  it("should set isInstallable on beforeinstallprompt event", async () => {
    const { useInstallPrompt } = await import("../../hooks/usePWA");
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.isInstallable).toBe(false);
    act(() => {
      window.dispatchEvent(new Event("beforeinstallprompt"));
    });
    expect(result.current.isInstallable).toBe(true);
  });

  it("promptInstall should return false when no deferred prompt", async () => {
    const { useInstallPrompt } = await import("../../hooks/usePWA");
    const { result } = renderHook(() => useInstallPrompt());
    const ok = await result.current.promptInstall();
    expect(ok).toBe(false);
  });

  it("should handle promptInstall accepted", async () => {
    const { useInstallPrompt } = await import("../../hooks/usePWA");
    const { result } = renderHook(() => useInstallPrompt());
    const userChoice = Promise.resolve({ outcome: "accepted" });
    const deferredPrompt = { prompt: vi.fn(), userChoice };
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("beforeinstallprompt"), deferredPrompt),
      );
    });
    await vi.waitFor(() => expect(result.current.isInstallable).toBe(true));
    let ok = false;
    await act(async () => {
      ok = await result.current.promptInstall();
    });
    await vi.waitFor(() => expect(result.current.isInstallable).toBe(false));
    expect(ok).toBe(true);
  });

  it("should handle promptInstall dismissed", async () => {
    const { useInstallPrompt } = await import("../../hooks/usePWA");
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("beforeinstallprompt"), {
          prompt: vi.fn(),
          userChoice: Promise.resolve({ outcome: "dismissed" }),
        }),
      );
    });
    await vi.waitFor(() => expect(result.current.isInstallable).toBe(true));
    let ok = false;
    await act(async () => {
      ok = await result.current.promptInstall();
    });
    expect(ok).toBe(false);
  });

  it("should set isInstalled on appinstalled event", async () => {
    const { useInstallPrompt } = await import("../../hooks/usePWA");
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current.isInstalled).toBe(true);
  });

  it("should detach the shared listeners after the last consumer unmounts", async () => {
    const { useInstallPrompt } = await import("../../hooks/usePWA");
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const first = renderHook(() => useInstallPrompt());
    const second = renderHook(() => useInstallPrompt());
    expect(addSpy).toHaveBeenCalledWith(
      "beforeinstallprompt",
      expect.any(Function),
    );
    // Only ONE beforeinstallprompt listener for any number of consumers.
    const installAdds = addSpy.mock.calls.filter(
      (call) => call[0] === ("beforeinstallprompt" as string),
    );
    expect(installAdds).toHaveLength(1);
    first.unmount();
    expect(removeSpy).not.toHaveBeenCalled();
    second.unmount();
    expect(removeSpy).toHaveBeenCalledWith(
      "beforeinstallprompt",
      expect.any(Function),
    );
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe("usePWA re-exports", () => {
  it("should re-export useFileSystem and useDragAndDrop", async () => {
    const mod = await import("../../hooks/usePWA");
    expect(typeof mod.useFileSystem).toBe("function");
    expect(typeof mod.useDragAndDrop).toBe("function");
  });
});
