import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGuardedAction } from "../../hooks/useGuardedAction";

describe("useGuardedAction", () => {
  it("runs the operation and calls onSuccess with its result", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedAction<number>({ onSuccess }),
    );
    let resolveOp!: (v: number) => void;
    const op = () =>
      new Promise<number>((resolve) => {
        resolveOp = resolve;
      });

    let promise!: Promise<number | undefined>;
    act(() => {
      promise = result.current.run(op);
    });
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      resolveOp(42);
      await promise;
    });

    expect(result.current.isRunning).toBe(false);
    expect(onSuccess).toHaveBeenCalledWith(42);
  });

  it("calls onError with the thrown error and resets isRunning", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useGuardedAction({ onError }));
    const boom = new Error("boom");

    let promise!: Promise<void | undefined>;
    act(() => {
      promise = result.current.run(async () => {
        throw boom;
      });
    });
    await act(async () => {
      await promise;
    });

    expect(onError).toHaveBeenCalledWith(boom);
    expect(result.current.isRunning).toBe(false);
  });

  it("drops success toasts/results that resolve after the component unmounts", async () => {
    const onSuccess = vi.fn();
    const { result, unmount } = renderHook(() => useGuardedAction({ onSuccess }));
    let resolveOp!: () => void;
    const op = () =>
      new Promise<void>((resolve) => {
        resolveOp = resolve;
      });

    act(() => {
      void result.current.run(op);
    });
    unmount();

    await act(async () => {
      resolveOp();
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("drops errors that resolve after the component unmounts", async () => {
    const onError = vi.fn();
    const { result, unmount } = renderHook(() => useGuardedAction({ onError }));
    let rejectOp!: () => void;
    const op = () =>
      new Promise<void>((_, reject) => {
        rejectOp = () => reject(new Error("late"));
      });

    act(() => {
      void result.current.run(op);
    });
    unmount();

    await act(async () => {
      rejectOp();
    });

    expect(onError).not.toHaveBeenCalled();
  });

  it("supersedes a running operation when blockReentry is false (refresh pattern)", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedAction({ onSuccess, blockReentry: false }),
    );
    const resolvers: Array<() => void> = [];
    const makeOp = () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });

    let first!: Promise<void | undefined>;
    act(() => {
      first = result.current.run(makeOp);
    });
    let second!: Promise<void | undefined>;
    act(() => {
      second = result.current.run(makeOp);
    });

    // First operation resolves after the second began → dropped.
    await act(async () => {
      resolvers[0]!();
      await first;
    });
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => {
      resolvers[1]!();
      await second;
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("blocks re-entry by default (force-reprocess pattern)", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useGuardedAction({ onSuccess }));
    let resolveOp!: () => void;
    const op = () =>
      new Promise<void>((resolve) => {
        resolveOp = resolve;
      });

    let first!: Promise<void | undefined>;
    act(() => {
      first = result.current.run(op);
    });
    // Second call while running → no-op.
    let second!: Promise<void | undefined>;
    act(() => {
      second = result.current.run(op);
    });

    await act(async () => {
      resolveOp();
      await first;
      await second;
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("runWithSignal hands the guard's AbortSignal to the operation", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useGuardedAction({ onSuccess }));
    let receivedSignal: AbortSignal | null = null;
    let resolveOp!: () => void;
    act(() => {
      void result.current.runWithSignal((signal) => {
        receivedSignal = signal;
        return new Promise<void>((resolve) => {
          resolveOp = resolve;
        });
      });
    });
    expect(receivedSignal).not.toBeNull();
    expect(receivedSignal!.aborted).toBe(false);

    // cancel() aborts the in-flight operation's signal (unmount behaviour).
    act(() => result.current.cancel());
    expect(receivedSignal!.aborted).toBe(true);
    await act(async () => {
      resolveOp();
    });
    // Late success after cancel is dropped.
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("onStart creates a loading toast and passes its id to onSuccess", async () => {
    const onStart = vi.fn(() => "toast-1");
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedAction<string>({ onStart, onSuccess }),
    );

    let promise!: Promise<string | undefined>;
    act(() => {
      promise = result.current.run(() => Promise.resolve("done"));
    });
    await act(async () => {
      await promise;
    });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("done", "toast-1");
  });

  it("keeps run's identity stable across renders with fresh callbacks", async () => {
    const { result, rerender } = renderHook(
      (props: { onSuccess: () => void }) => useGuardedAction({ onSuccess: props.onSuccess }),
      { initialProps: { onSuccess: vi.fn() } },
    );
    const firstRun = result.current.run;
    rerender({ onSuccess: vi.fn() });
    expect(result.current.run).toBe(firstRun);
  });

  it("cancel resets isRunning while the component stays mounted (year-switch pattern)", async () => {
    const { result } = renderHook(() => useGuardedAction<string>());
    let resolveOp!: (v: string) => void;
    let promise!: Promise<string | undefined>;
    act(() => {
      promise = result.current.run(
        () =>
          new Promise<string>((resolve) => {
            resolveOp = resolve;
          }),
      );
    });
    expect(result.current.isRunning).toBe(true);

    act(() => {
      result.current.cancel();
    });
    expect(result.current.isRunning).toBe(false);

    // The late resolution is dropped and does not resurrect the flag.
    await act(async () => {
      resolveOp("late");
      await promise;
    });
    expect(result.current.isRunning).toBe(false);
  });
});
