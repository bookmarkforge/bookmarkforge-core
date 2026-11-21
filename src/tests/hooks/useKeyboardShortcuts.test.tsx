import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";

describe("useKeyboardShortcuts", () => {
  const setShowOmnibar = vi.fn();
  const toggleTheme = vi.fn();
  const setShowSettings = vi.fn();
  const setActiveTab = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const dispatchKey = (key: string, extra: Partial<KeyboardEvent> = {}) => {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, ...extra }),
      );
    });
  };

  it("registers and removes a keydown listener on window", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() =>
      useKeyboardShortcuts(
        setShowOmnibar,
        toggleTheme,
        setShowSettings,
        setActiveTab,
      ),
    );
    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
    );

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("toggles the omnibar on Ctrl+K", () => {
    renderHook(() =>
      useKeyboardShortcuts(
        setShowOmnibar,
        toggleTheme,
        setShowSettings,
        setActiveTab,
      ),
    );
    dispatchKey("k", { ctrlKey: true });
    expect(setShowOmnibar).toHaveBeenCalledWith(expect.any(Function));
  });

  it("toggles the omnibar on Ctrl+Shift+P", () => {
    renderHook(() =>
      useKeyboardShortcuts(
        setShowOmnibar,
        toggleTheme,
        setShowSettings,
        setActiveTab,
      ),
    );
    dispatchKey("p", { ctrlKey: true, shiftKey: true });
    expect(setShowOmnibar).toHaveBeenCalledWith(expect.any(Function));
  });

  it("toggles the theme on Ctrl+D", () => {
    renderHook(() =>
      useKeyboardShortcuts(
        setShowOmnibar,
        toggleTheme,
        setShowSettings,
        setActiveTab,
      ),
    );
    dispatchKey("d", { ctrlKey: true });
    expect(toggleTheme).toHaveBeenCalled();
  });

  it("toggles settings on Ctrl+,", () => {
    renderHook(() =>
      useKeyboardShortcuts(
        setShowOmnibar,
        toggleTheme,
        setShowSettings,
        setActiveTab,
      ),
    );
    dispatchKey(",", { ctrlKey: true });
    expect(setShowSettings).toHaveBeenCalledWith(expect.any(Function));
  });

  it("switches tabs on Ctrl+1..6 (1-indexed)", () => {
    renderHook(() =>
      useKeyboardShortcuts(
        setShowOmnibar,
        toggleTheme,
        setShowSettings,
        setActiveTab,
      ),
    );
    dispatchKey("3", { ctrlKey: true });
    expect(setActiveTab).toHaveBeenCalledWith("documents");
    dispatchKey("1", { ctrlKey: true });
    expect(setActiveTab).toHaveBeenCalledWith("dashboard");
  });

  it("ignores number keys without Ctrl/Cmd", () => {
    renderHook(() =>
      useKeyboardShortcuts(
        setShowOmnibar,
        toggleTheme,
        setShowSettings,
        setActiveTab,
      ),
    );
    dispatchKey("3");
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it("ignores non-shortcut keys", () => {
    renderHook(() =>
      useKeyboardShortcuts(
        setShowOmnibar,
        toggleTheme,
        setShowSettings,
        setActiveTab,
      ),
    );
    dispatchKey("a", { ctrlKey: true });
    dispatchKey("9", { ctrlKey: true });
    expect(setActiveTab).not.toHaveBeenCalled();
    expect(toggleTheme).not.toHaveBeenCalled();
    expect(setShowOmnibar).not.toHaveBeenCalled();
  });
});
