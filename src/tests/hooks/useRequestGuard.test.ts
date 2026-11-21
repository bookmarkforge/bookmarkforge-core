import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRequestGuard } from "../../hooks/useRequestGuard";

describe("useRequestGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns begin, isCurrent, and cancel functions", () => {
    const { result } = renderHook(() => useRequestGuard());

    expect(typeof result.current.begin).toBe("function");
    expect(typeof result.current.isCurrent).toBe("function");
    expect(typeof result.current.cancel).toBe("function");
  });

  it("begin returns unique generation", () => {
    const { result } = renderHook(() => useRequestGuard());

    const handle1 = result.current.begin();
    const handle2 = result.current.begin();

    expect(handle1.generation).not.toBe(handle2.generation);
  });
});
