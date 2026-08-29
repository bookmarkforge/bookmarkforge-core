import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGuardedActions } from "../../hooks/useGuardedActions";

describe("useGuardedActions", () => {
  it("begins one action and invalidates another still in flight", async () => {
    const onLoadSuccess = vi.fn();
    const onDeleteSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedActions({
        load: { onSuccess: onLoadSuccess },
        del: { onSuccess: onDeleteSuccess },
      }),
    );
    const resolvers: Record<string, () => void> = {};
    const makeOp = (name: string) =>
      new Promise<void>((resolve) => {
        resolvers[name] = resolve;
      });

    let loadPromise!: Promise<void | undefined>;
    act(() => {
      loadPromise = result.current.load.run(() => makeOp("load"));
    });
    expect(result.current.load.isRunning).toBe(true);

    // Delete begins while load is in flight → shared guard invalidates load.
    let delPromise!: Promise<void | undefined>;
    act(() => {
      delPromise = result.current.del.run(() => makeOp("del"));
    });

    // Load resolves AFTER delete began → its success must be dropped.
    await act(async () => {
      resolvers["load"]!();
      await loadPromise;
    });
    expect(onLoadSuccess).not.toHaveBeenCalled();
    // Load's own flag clears even though delete is still running.
    expect(result.current.load.isRunning).toBe(false);
    expect(result.current.del.isRunning).toBe(true);

    await act(async () => {
      resolvers["del"]!();
      await delPromise;
    });
    expect(onDeleteSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.del.isRunning).toBe(false);
  });

  it("keeps a same-action refresh flag until the last invocation settles", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedActions({
        refresh: { onSuccess, blockReentry: false },
      }),
    );
    const resolvers: Array<() => void> = [];
    const makeOp = () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });

    let first!: Promise<void | undefined>;
    act(() => {
      first = result.current.refresh.run(makeOp);
    });
    let second!: Promise<void | undefined>;
    act(() => {
      second = result.current.refresh.run(makeOp);
    });

    // First settles while the second is in flight → dropped, flag stays set.
    await act(async () => {
      resolvers[0]!();
      await first;
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.refresh.isRunning).toBe(true);

    await act(async () => {
      resolvers[1]!();
      await second;
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.refresh.isRunning).toBe(false);
  });

  it("keeps the flag until the last resolves when two start in the same tick (concurrent re-entry)", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedActions({
        refresh: { onSuccess, blockReentry: false },
      }),
    );
    const resolvers: Array<() => void> = [];
    const makeOp = () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });

    let first!: Promise<void | undefined>;
    let second!: Promise<void | undefined>;
    // Two invocations in the SAME synchronous tick: no await between them,
    // so the counter must be reserved before begin() to avoid collapsing
    // 0+1 twice. This is the race the counter booking fixes.
    act(() => {
      first = result.current.refresh.run(makeOp);
      second = result.current.refresh.run(makeOp);
    });
    expect(result.current.refresh.isRunning).toBe(true);
    expect(resolvers.length).toBe(2);

    // First settles while the second is still in flight → dropped, and the
    // flag MUST stay set because the second invocation is still running.
    await act(async () => {
      resolvers[0]!();
      await first;
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.refresh.isRunning).toBe(true);

    // Second settles → the last invocation reports success and clears.
    await act(async () => {
      resolvers[1]!();
      await second;
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.refresh.isRunning).toBe(false);
  });

  it("drops success and clears the flag after unmount", async () => {
    const onSuccess = vi.fn();
    const { result, unmount } = renderHook(() =>
      useGuardedActions({ load: { onSuccess } }),
    );
    let resolveOp!: () => void;
    act(() => {
      void result.current.load.run(
        () =>
          new Promise<void>((resolve) => {
            resolveOp = resolve;
          }),
      );
    });
    unmount();
    await act(async () => {
      resolveOp();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("blocks re-entry per action by default", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedActions({ act: { onSuccess } }),
    );
    const resolvers: Array<() => void> = [];
    const makeOp = () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });

    let first!: Promise<void | undefined>;
    act(() => {
      first = result.current.act.run(makeOp);
    });
    let second!: Promise<void | undefined>;
    act(() => {
      second = result.current.act.run(makeOp);
    });

    await act(async () => {
      resolvers[0]!();
      await first;
      await second;
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("onStart creates a loading toast and passes its id to onSuccess/onError", async () => {
    const onStart = vi.fn(() => "toast-1");
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useGuardedActions({
        act: { onStart, onSuccess, onError },
      }),
    );

    let promise!: Promise<string | undefined>;
    act(() => {
      promise = result.current.act.run(() => Promise.resolve("done"));
    });
    await act(async () => {
      await promise;
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("done", "toast-1");

    // Error path receives the same toastId.
    act(() => {
      promise = result.current.act.run(() => Promise.reject(new Error("x")));
    });
    await act(async () => {
      await promise;
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "toast-1");
  });

  it("runWithSignal hands the guard's AbortSignal to the operation", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedActions({ act: { onSuccess }, other: {} }),
    );
    let seenSignal: AbortSignal | undefined;
    let resolveOp!: () => void;
    let promise!: Promise<string | undefined>;
    act(() => {
      promise = result.current.act.runWithSignal((signal) => {
        seenSignal = signal;
        return new Promise<string>((resolve) => {
          resolveOp = () => resolve("done");
        });
      });
    });
    expect(seenSignal?.aborted).toBe(false);

    // A newer action on the shared guard aborts the first invocation's signal.
    act(() => {
      void result.current.other.run(() => Promise.resolve());
    });
    expect(seenSignal?.aborted).toBe(true);

    await act(async () => {
      resolveOp();
      await promise;
    });
    // Superseded: the success is dropped even though the op resolved.
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("runWithSignal fires onSuccess with the result while current", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedActions({ act: { onSuccess } }),
    );
    let promise!: Promise<string | undefined>;
    act(() => {
      promise = result.current.act.runWithSignal(async (signal) => {
        expect(signal.aborted).toBe(false);
        return "done";
      });
    });
    await act(async () => {
      await promise;
    });
    expect(onSuccess).toHaveBeenCalledWith("done");
    expect(result.current.act.isRunning).toBe(false);
  });

  it("cancel resets every running flag and drops in-flight success while mounted", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useGuardedActions({
        load: { onSuccess },
        del: { onSuccess },
      }),
    );
    const resolvers: Array<() => void> = [];
    const makeOp = () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });

    let loadPromise!: Promise<void | undefined>;
    act(() => {
      loadPromise = result.current.load.run(makeOp);
    });
    expect(result.current.load.isRunning).toBe(true);

    // Explicit cancel while mounted (the DocumentManager folder-switch
    // pattern): both flags reset and the in-flight success is dropped.
    act(() => {
      result.current.cancel();
    });
    expect(result.current.load.isRunning).toBe(false);
    expect(result.current.del.isRunning).toBe(false);

    await act(async () => {
      resolvers[0]!();
      await loadPromise;
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.load.isRunning).toBe(false);
  });
});
