import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";

vi.mock("../../hooks/useRequestGuard", () => ({
  useRequestGuard: () => ({
    begin: () => ({
      generation: 1,
      signal: new AbortController().signal,
    }),
    isCurrent: () => true,
    cancel: vi.fn(),
  }),
}));

describe("useGuardedDataLoad", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with loading true by default", () => {
    const loader = vi.fn().mockResolvedValue("data");
    const { result } = renderHook(() => useGuardedDataLoad(loader, { autoLoad: false }));

    expect(result.current.loading).toBe(true);
  });

  it("initializes with loading false when initialLoading is false", () => {
    const loader = vi.fn().mockResolvedValue("data");
    const { result } = renderHook(() =>
      useGuardedDataLoad(loader, { initialLoading: false, autoLoad: false }),
    );

    expect(result.current.loading).toBe(false);
  });

  it("executes operation successfully", async () => {
    const loader = vi.fn().mockResolvedValue("data");
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedDataLoad(loader, { onSuccess, autoLoad: false }),
    );

    await act(async () => {
      const data = await result.current.load();
      expect(data).toBe("data");
    });

    expect(loader).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith("data");
    expect(result.current.loading).toBe(false);
  });

  it("calls onError on load failure", async () => {
    const error = new Error("Test error");
    const loader = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useGuardedDataLoad(loader, { onError, autoLoad: false }),
    );

    await act(async () => {
      await result.current.load();
    });

    expect(onError).toHaveBeenCalledWith(error);
    expect(result.current.loading).toBe(false);
  });

  it("does not auto load when autoLoad is false", () => {
    const loader = vi.fn().mockResolvedValue("data");
    renderHook(() => useGuardedDataLoad(loader, { autoLoad: false }));

    expect(loader).not.toHaveBeenCalled();
  });

  it("has cancel function", () => {
    const loader = vi.fn().mockResolvedValue("data");
    const { result } = renderHook(() =>
      useGuardedDataLoad(loader, { autoLoad: false }),
    );

    expect(typeof result.current.cancel).toBe("function");
  });
});
