import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGuardedActions } from "../../hooks/useGuardedActions";

describe("useGuardedActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with all actions not running", () => {
    const { result } = renderHook(() =>
      useGuardedActions({
        action1: {},
        action2: {},
      }),
    );

    expect(result.current.action1.isRunning).toBe(false);
    expect(result.current.action2.isRunning).toBe(false);
  });

  it("executes action successfully", async () => {
    const operation = vi.fn().mockResolvedValue("result");
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedActions({
        action1: { onSuccess },
      }),
    );

    await act(async () => {
      await result.current.action1.run(operation);
    });

    expect(operation).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith("result");
    expect(result.current.action1.isRunning).toBe(false);
  });

  it("sets isRunning to true during operation", async () => {
    let resolveOperation: (value: any) => void;
    const operation = new Promise((resolve) => {
      resolveOperation = resolve;
    });
    const { result } = renderHook(() =>
      useGuardedActions({
        action1: {},
      }),
    );

    act(() => {
      result.current.action1.run(() => operation);
    });

    expect(result.current.action1.isRunning).toBe(true);

    await act(async () => {
      resolveOperation!("result");
    });

    expect(result.current.action1.isRunning).toBe(false);
  });

  it("calls onError on operation failure", async () => {
    const error = new Error("Test error");
    const operation = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useGuardedActions({
        action1: { onError },
      }),
    );

    await act(async () => {
      await result.current.action1.run(operation);
    });

    expect(onError).toHaveBeenCalledWith(error);
    expect(result.current.action1.isRunning).toBe(false);
  });

  it("calls onStart before operation", async () => {
    const operation = vi.fn().mockResolvedValue("result");
    const onStart = vi.fn().mockReturnValue("toast-id");
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedActions({
        action1: { onStart, onSuccess },
      }),
    );

    await act(async () => {
      await result.current.action1.run(operation);
    });

    expect(onStart).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith("result", "toast-id");
  });

  it("blocks reentry by default", async () => {
    let resolveFirst: (value: any) => void;
    const firstOp = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondOp = vi.fn().mockResolvedValue("second");
    const { result } = renderHook(() =>
      useGuardedActions({
        action1: {},
      }),
    );

    act(() => {
      result.current.action1.run(() => firstOp);
    });

    expect(result.current.action1.isRunning).toBe(true);

    const secondResult = await act(async () => {
      return await result.current.action1.run(secondOp);
    });

    expect(secondResult).toBeUndefined();
    expect(secondOp).not.toHaveBeenCalled();
  });

  it("allows reentry when blockReentry is false", async () => {
    const operation = vi.fn().mockResolvedValue("result");
    const { result } = renderHook(() =>
      useGuardedActions({
        action1: { blockReentry: false },
      }),
    );

    await act(async () => {
      await result.current.action1.run(operation);
    });

    expect(operation).toHaveBeenCalled();
    expect(result.current.action1.isRunning).toBe(false);
  });

  it("supports runWithSignal", async () => {
    const operation = vi.fn().mockResolvedValue("result");
    const { result } = renderHook(() =>
      useGuardedActions({
        action1: {},
      }),
    );

    await act(async () => {
      await result.current.action1.runWithSignal(operation);
    });

    expect(operation).toHaveBeenCalled();
    expect(operation.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
  });

  it("tracks running state per action", async () => {
    let resolveAction1: (value: any) => void;
    const action1Op = new Promise((resolve) => {
      resolveAction1 = resolve;
    });
    const action2Op = vi.fn().mockResolvedValue("result2");

    const { result } = renderHook(() =>
      useGuardedActions({
        action1: {},
        action2: {},
      }),
    );

    act(() => {
      result.current.action1.run(() => action1Op);
    });

    expect(result.current.action1.isRunning).toBe(true);
    expect(result.current.action2.isRunning).toBe(false);

    await act(async () => {
      await result.current.action2.run(action2Op);
    });

    expect(result.current.action2.isRunning).toBe(false);
  });

  it("has cancel function", () => {
    const { result } = renderHook(() =>
      useGuardedActions({
        action1: {},
        action2: {},
      }),
    );

    expect(typeof result.current.cancel).toBe("function");
  });
});
