import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import React from "react";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";

function Harness({
  loader,
  onSuccess,
  onError,
  autoLoad = true,
  triggerReload,
}: {
  loader: (signal: AbortSignal) => Promise<string>;
  onSuccess?: (data: string) => void;
  onError?: (error: unknown) => void;
  autoLoad?: boolean;
  triggerReload?: (load: () => Promise<string | undefined>) => void;
}) {
  const { load, loading, cancel } = useGuardedDataLoad(loader, {
    onSuccess,
    onError,
    autoLoad,
  });
  if (triggerReload) {
    triggerReload(load);
  }
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <button onClick={() => void load()}>reload</button>
      <button onClick={cancel}>cancel</button>
    </div>
  );
}

describe("useGuardedDataLoad", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-loads on mount, calls onSuccess and resets loading", async () => {
    const onSuccess = vi.fn();
    render(
      <Harness
        loader={async () => "data"}
        onSuccess={onSuccess}
      />,
    );
    expect(screen.getByTestId("loading").textContent).toBe("true");
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("data");
    });
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
  });

  it("does not auto-load when autoLoad is false", async () => {
    const loader = vi.fn(async () => "data");
    render(<Harness loader={loader} autoLoad={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(loader).not.toHaveBeenCalled();
  });

  it("load() has stable identity across renders", async () => {
    const identities: Array<() => Promise<string | undefined>> = [];
    const TestHarness = () => {
      const [count, setCount] = React.useState(0);
      const { load } = useGuardedDataLoad(
        async () => "data",
        { autoLoad: false },
      );
      identities.push(load);
      return (
        <button
          onClick={() => setCount(count + 1)}
          data-count={count}
          data-testid="rerender-btn"
          className="max-w-xs"
        >
          rerender
        </button>
      );
    };
    render(<TestHarness />);
    await waitFor(() => {
      expect(screen.getByTestId("rerender-btn").getAttribute("data-count")).toBe("0");
    });
    screen.getByTestId("rerender-btn").click();
    await waitFor(() => {
      expect(screen.getByTestId("rerender-btn").getAttribute("data-count")).toBe("1");
    });
    expect(identities[0]).toBe(identities[1]);
  });

  it("drops onSuccess and keeps loading true after unmount", async () => {
    const onSuccess = vi.fn();
    const { unmount } = render(
      <Harness
        loader={async () => {
          await new Promise((r) => setTimeout(r, 30));
          return "late";
        }}
        onSuccess={onSuccess}
      />,
    );
    unmount();
    await new Promise((r) => setTimeout(r, 60));
    expect(onSuccess).not.toHaveBeenCalled();
  });  it("a newer load supersedes an in-flight one (late result dropped)", async () => {
    const onSuccess = vi.fn();
    let TestHarness: React.FC = () => null;
    TestHarness = () => {
      // The mutable store lives INSIDE the component (the only place hooks
      // are legal). We expose two DOM buttons: "load" triggers a load,
      // "resolve-late" resolves the first in-flight promise. No outer
      // variables are reassigned during render.
      const stateRef = React.useRef<{
        calls: number;
        resolveFirst: (v: string) => void;
      }>({ calls: 0, resolveFirst: () => {} });
      const { load } = useGuardedDataLoad(
        async () => {
          stateRef.current.calls += 1;
          if (stateRef.current.calls === 1) {
            return await new Promise<string>((resolve) => {
              stateRef.current.resolveFirst = resolve;
            });
          }
          return "second";
        },
        { onSuccess, autoLoad: false },
      );
      return (
        <>
          <button onClick={() => void load()}>load</button>
          <button
            onClick={() =>
              stateRef.current.resolveFirst("late")
            }
          >
            resolve-late
          </button>
        </>
      );
    };
    render(<TestHarness />);
    const loadBtn = screen.getByRole("button", { name: "load" });
    // First load in flight, never resolves until we release it.
    act(() => loadBtn.click());
    await Promise.resolve();
    // Second load begins while the first is pending — supersedes it.
    act(() => loadBtn.click());
    await Promise.resolve();
    // The second load (synchronous loader) already landed while the first
    // was still pending — that is the supersede working, not a bug.
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("second");
    });
    // Release the FIRST call late: its result must be dropped, leaving only
    // the second load's result.
    await act(async () => {
      screen.getByRole("button", { name: "resolve-late" }).click();
    });
    expect(onSuccess).not.toHaveBeenCalledWith("late");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("hands the loader a real AbortSignal and aborts it when a newer load supersedes", async () => {
    const onSuccess = vi.fn();
    const signals: AbortSignal[] = [];
    const resolvers: Array<(v: string) => void> = [];
    const TestHarness = () => {
      const { load } = useGuardedDataLoad(
        (signal) => {
          // Recording the signal and resolver happens at load time (not
          // render), so plain arrays are fine here.
          signals.push(signal);
          return new Promise<string>((resolve) => {
            resolvers.push(resolve);
          });
        },
        { onSuccess, autoLoad: false },
      );
      return <button onClick={() => void load()}>load</button>;
    };
    render(<TestHarness />);
    const loadBtn = screen.getByRole("button", { name: "load" });

    act(() => loadBtn.click());
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);

    // A second load supersedes the first: the first loader's signal must be
    // aborted for real, so the loader can early-exit at an await boundary
    // (the runWithSignal equivalent — the hook injects the guard's signal
    // into the loader argument).
    act(() => loadBtn.click());
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);

    // Late resolve of the FIRST load is dropped; only the current load's
    // success fires, and its signal stays un-aborted.
    await act(async () => {
      resolvers[0]!("late");
      resolvers[1]!("second");
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("second");
    expect(signals[1]!.aborted).toBe(false);
  });

  it("aborts the loader's signal on unmount", async () => {
    const onSuccess = vi.fn();
    let capturedSignal: AbortSignal | undefined;
    const TestHarness = () => {
      const { load } = useGuardedDataLoad(
        (signal) => {
          capturedSignal = signal;
          // Never settles: the only way the load ends is the guard's abort.
          return new Promise<string>(() => {});
        },
        { onSuccess },
      );
      return <button onClick={() => void load()}>reload</button>;
    };
    const { unmount } = render(<TestHarness />);
    await waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal!.aborted).toBe(false);

    unmount();
    expect(capturedSignal!.aborted).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("keeps loading until the last of three loads settles (double supersede, latest wins)", async () => {
    const onSuccess = vi.fn();
    const resolvers: Array<(v: string) => void> = [];
    const TestHarness = () => {
      const { load, loading } = useGuardedDataLoad(
        () =>
          new Promise<string>((resolve) => {
            resolvers.push(resolve);
          }),
        { onSuccess, autoLoad: false },
      );
      return (
        <>
          <span data-testid="loading">{String(loading)}</span>
          <button onClick={() => void load()}>load</button>
        </>
      );
    };
    render(<TestHarness />);
    const loadBtn = screen.getByRole("button", { name: "load" });

    act(() => loadBtn.click());
    act(() => loadBtn.click());
    act(() => loadBtn.click());
    expect(resolvers).toHaveLength(3);
    expect(screen.getByTestId("loading").textContent).toBe("true");

    // Loads 1 and 2 settle late while load 3 is still in flight: their
    // results are dropped AND loading must stay true until the current
    // load resolves.
    await act(async () => {
      resolvers[0]!("first");
      resolvers[1]!("second");
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId("loading").textContent).toBe("true");

    await act(async () => {
      resolvers[2]!("third");
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("third");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("calls onError with the rejection when current", async () => {
    const onError = vi.fn();
    render(
      <Harness
        loader={async () => {
          throw new Error("boom");
        }}
        onError={onError}
      />,
    );
    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    const err = onError.mock.calls[0]![0] as Error;
    expect(err.message).toBe("boom");
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
  });

  it("drops onError after unmount", async () => {
    const onError = vi.fn();
    const { unmount } = render(
      <Harness
        loader={async () => {
          await new Promise((r) => setTimeout(r, 30));
          throw new Error("late error");
        }}
        onError={onError}
      />,
    );
    unmount();
    await new Promise((r) => setTimeout(r, 60));
    expect(onError).not.toHaveBeenCalled();
  });

  it("explicit cancel resets loading while mounted and drops the late result", async () => {
    const onSuccess = vi.fn();
    let resolveOp!: (v: string) => void;
    render(
      <Harness
        loader={async () =>
          new Promise<string>((resolve) => {
            resolveOp = resolve;
          })
        }
        onSuccess={onSuccess}
      />,
    );
    // Load in flight → loading true.
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("true");
    });
    // Explicit cancel while mounted (the DocumentManager folder-switch
    // pattern): loading must reset and the late result must be dropped.
    screen.getByText("cancel").click();
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    await act(async () => {
      resolveOp("late");
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
