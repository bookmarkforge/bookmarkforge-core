import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGuardedAction } from "../../hooks/useGuardedAction";

describe("useGuardedAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with isRunning false", () => {
    const { result } = renderHook(() => useGuardedAction());

    expect(result.current.isRunning).toBe(false);
  });

  it("executes operation successfully", async () => {
    const operation = vi.fn().mockResolvedValue("result");
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useGuardedAction({ onSuccess }));

    await act(async () => {
      const returned = await result.current.run(operation);
      expect(returned).toBe("result");
    });

    expect(operation).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith("result");
    expect(result.current.isRunning).toBe(false);
  });

  it("sets isRunning to true during operation", async () => {
    let resolveOperation: (() => void) | undefined;
    const operation = new Promise<void>((resolve) => {
      resolveOperation = resolve;
    });
    const { result } = renderHook(() => useGuardedAction());

    act(() => {
      result.current.run(() => operation);
    });

    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      resolveOperation!();
    });

    expect(result.current.isRunning).toBe(false);
  });

  it("calls onError on operation failure", async () => {
    const error = new Error("Test error");
    const operation = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const { result } = renderHook(() => useGuardedAction({ onError }));

    await act(async () => {
      await result.current.run(operation);
    });

    expect(onError).toHaveBeenCalledWith(error);
    expect(result.current.isRunning).toBe(false);
  });

  it("calls onStart before operation", async () => {
    const operation = vi.fn().mockResolvedValue("result");
    const onStart = vi.fn().mockReturnValue("toast-id");
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useGuardedAction({ onStart, onSuccess }));

    await act(async () => {
      await result.current.run(operation);
    });

    expect(onStart).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith("result", "toast-id");
  });

  it("blocks reentry by default", async () => {
    let resolveFirst: (() => void) | undefined;
    const firstOp = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const secondOp = vi.fn().mockResolvedValue("second");
    const { result } = renderHook(() => useGuardedAction());

    act(() => {
      result.current.run(() => firstOp);
    });

    expect(result.current.isRunning).toBe(true);

    const secondResult = await act(async () => {
      return await result.current.run(secondOp);
    });

    expect(secondResult).toBeUndefined();
    expect(secondOp).not.toHaveBeenCalled();
  });

  it("allows reentry when blockReentry is false", async () => {
    const operation = vi.fn().mockResolvedValue("result");
    const { result } = renderHook(() => useGuardedAction({ blockReentry: false }));

    await act(async () => {
      await result.current.run(operation);
    });

    expect(operation).toHaveBeenCalled();
    expect(result.current.isRunning).toBe(false);
  });

  it("supports runWithSignal", async () => {
    const operation = vi.fn().mockResolvedValue("result");
    const { result } = renderHook(() => useGuardedAction());

    await act(async () => {
      await result.current.runWithSignal(operation);
    });

    expect(operation).toHaveBeenCalled();
    expect(operation.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
  });

  it("has cancel function", () => {
    const { result } = renderHook(() => useGuardedAction());

    expect(typeof result.current.cancel).toBe("function");
  });
});
