import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";

const mockLoggerInfo = vi.fn();
vi.mock("../../utils/logger", () => ({
  logger: { info: mockLoggerInfo, error: vi.fn() },
}));

describe("usePWAInstall", () => {
  let usePWAInstall: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../hooks/usePWAInstall");
    usePWAInstall = mod.usePWAInstall;
  });

  afterEach(() => {
    cleanup();
  });

  it("should start with not installable", () => {
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.isInstallable).toBe(false);
    expect(typeof result.current.installPWA).toBe("function");
  });

  it("should become installable on beforeinstallprompt event", () => {
    const { result } = renderHook(() => usePWAInstall());
    const promptEvent = new Event("beforeinstallprompt");
    promptEvent.preventDefault = vi.fn();
    act(() => {
      window.dispatchEvent(promptEvent);
    });
    expect(result.current.isInstallable).toBe(true);
  });

  it("installPWA does nothing when deferredPrompt is null", async () => {
    const { result } = renderHook(() => usePWAInstall());
    await act(async () => {
      await result.current.installPWA();
    });
    expect(result.current.isInstallable).toBe(false);
  });

  it("installPWA calls prompt and logs accepted", async () => {
    const { result } = renderHook(() => usePWAInstall());
    const promptFn = vi.fn();
    const evt = new Event("beforeinstallprompt");
    evt.preventDefault = vi.fn();
    Object.defineProperties(evt, {
      prompt: { value: promptFn },
      userChoice: { value: Promise.resolve({ outcome: "accepted" }) },
    });
    act(() => {
      window.dispatchEvent(evt);
    });
    expect(result.current.isInstallable).toBe(true);
    await act(async () => {
      await result.current.installPWA();
    });
    expect(promptFn).toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      "User accepted the PWA install",
    );
    expect(result.current.isInstallable).toBe(false);
  });

  it("installPWA logs dismissed on user dismissal", async () => {
    const { result } = renderHook(() => usePWAInstall());
    const promptFn = vi.fn();
    const evt = new Event("beforeinstallprompt");
    evt.preventDefault = vi.fn();
    Object.defineProperties(evt, {
      prompt: { value: promptFn },
      userChoice: { value: Promise.resolve({ outcome: "dismissed" }) },
    });
    act(() => {
      window.dispatchEvent(evt);
    });
    expect(result.current.isInstallable).toBe(true);
    await act(async () => {
      await result.current.installPWA();
    });
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      "User dismissed the PWA install",
    );
    expect(result.current.isInstallable).toBe(false);
  });

  it("should remove event listener on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => usePWAInstall());
    expect(addSpy).toHaveBeenCalledWith(
      "beforeinstallprompt",
      expect.any(Function),
    );
    unmount();
    expect(removeSpy).toHaveBeenCalledWith(
      "beforeinstallprompt",
      expect.any(Function),
    );
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
