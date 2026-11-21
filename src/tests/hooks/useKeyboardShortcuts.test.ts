import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

describe("useKeyboardShortcuts", () => {
  let setShowOmnibar: ReturnType<typeof vi.fn>;
  let toggleTheme: ReturnType<typeof vi.fn>;
  let setShowSettings: ReturnType<typeof vi.fn>;
  let setActiveTab: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    setShowOmnibar = vi.fn();
    toggleTheme = vi.fn();
    setShowSettings = vi.fn();
    setActiveTab = vi.fn();
  });

  const setupHook = async () => {
    const { useKeyboardShortcuts } =
      await import("../../hooks/useKeyboardShortcuts");
    renderHook(() =>
      useKeyboardShortcuts(
        setShowOmnibar as any,
        toggleTheme as any,
        setShowSettings as any,
        setActiveTab as any,
      ),
    );
  };

  it("should toggle omnibar on Ctrl+K", async () => {
    await setupHook();
    await userEvent.keyboard(`{Control>}k{/Control}`);
    expect(setShowOmnibar).toHaveBeenCalled();
  });

  it("should toggle omnibar on Cmd+K", async () => {
    await setupHook();
    await userEvent.keyboard(`{Meta>}k{/Meta}`);
    expect(setShowOmnibar).toHaveBeenCalled();
  });

  it("should toggle theme on Ctrl+Shift+D", async () => {
    await setupHook();
    await userEvent.keyboard(`{Control>}d{/Control}`);
    expect(toggleTheme).toHaveBeenCalled();
  });

  it("should toggle settings on Ctrl+,", async () => {
    await setupHook();
    await userEvent.keyboard(`{Control>},{/Control}`);
    expect(setShowSettings).toHaveBeenCalled();
  });

  it("should switch to bookmarks tab on Ctrl+4", async () => {
    await setupHook();
    await userEvent.keyboard(`{Control>}4{/Control}`);
    expect(setActiveTab).toHaveBeenCalledWith("bookmarks");
  });

  it("should clean up event listener on unmount", async () => {
    const handlerSpy = vi.spyOn(window, "removeEventListener");
    await setupHook();
    const { unmount } = renderHook(
      () => import("../../hooks/useKeyboardShortcuts"),
    );
    // Actually test the hook directly
    const mod = await import("../../hooks/useKeyboardShortcuts");
    const { unmount: unmountHook } = renderHook(() =>
      mod.useKeyboardShortcuts(
        setShowOmnibar as any,
        toggleTheme as any,
        setShowSettings as any,
        setActiveTab as any,
      ),
    );
    unmountHook();
    expect(window.removeEventListener).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
    );
  });
});
