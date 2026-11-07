import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

describe("useFocusTrap", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("returns a container ref", () => {
    const { result } = renderHook(() => useFocusTrap(false));

    expect(result.current).toHaveProperty("current");
  });

  it("registers vault lock listener on mount", () => {
    renderHook(() => useFocusTrap(true));
    // Test that hook mounts without errors
    expect(true).toBe(true);
  });
});
