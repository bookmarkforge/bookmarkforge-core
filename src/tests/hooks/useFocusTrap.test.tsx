import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../../store/safeStorage", () => ({
  safeGet: vi.fn(() => null),
  safeSet: vi.fn(),
}));

import { useFocusTrap } from "../../hooks/useFocusTrap";

describe("useFocusTrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a ref with null current initially", () => {
    const { result } = renderHook(() => useFocusTrap(false));
    expect(result.current.current).toBeNull();
  });

  it("attaches a keydown listener and traps Tab when active with a mounted ref", () => {
    // Mount inactive first so the effect is skipped while the ref is null;
    // then attach the ref and flip isActive so the effect re-runs with the
    // container wired up (the effect depends on isActive, not on the ref).
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useFocusTrap(active),
      { initialProps: { active: false } },
    );

    const container = document.createElement("div");
    const first = document.createElement("button");
    const last = document.createElement("button");
    container.appendChild(first);
    container.appendChild(last);
    document.body.appendChild(container);

    act(() => {
      result.current.current = container;
    });
    rerender({ active: true });

    act(() => {
      last.focus();
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(first);

    act(() => {
      first.focus();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(last);

    document.body.removeChild(container);
  });

  it("can deactivate without restoring focus for nested dialogs", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useFocusTrap(active, false),
      { initialProps: { active: false } },
    );
    const container = document.createElement("div");
    const opener = document.createElement("button");
    const dialogButton = document.createElement("button");
    container.appendChild(dialogButton);
    document.body.append(opener, container);
    opener.focus();
    act(() => { result.current.current = container; });
    rerender({ active: true });
    expect(document.activeElement).toBe(dialogButton);
    act(() => { rerender({ active: false }); });
    expect(document.activeElement).not.toBe(opener);
    document.body.removeChild(opener);
    document.body.removeChild(container);
  });

  it("removes the event listener on unmount", () => {
    // The listener only attaches when the ref is mounted and active, so wire
    // the container up before unmounting (same pattern as the trap test).
    const { result, rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => useFocusTrap(active),
      { initialProps: { active: false } },
    );
    const container = document.createElement("div");
    container.appendChild(document.createElement("button"));
    document.body.appendChild(container);
    act(() => {
      result.current.current = container;
    });
    rerender({ active: true });

    const removeEventSpy = vi.spyOn(document, "removeEventListener");
    unmount();

    expect(removeEventSpy).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
    );
    removeEventSpy.mockRestore();
    document.body.removeChild(container);
  });
});
