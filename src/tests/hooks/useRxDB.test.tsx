import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  DatabaseContextProvider,
  useRxDB,
  useRxQuery,
} from "../../hooks/useRxDB";

type TestDocument = { id: string };
type QueryObserver = {
  next: (documents: TestDocument[]) => void;
  error: () => void;
};

type QueryStub = {
  $: {
    subscribe: (observer: QueryObserver) => { unsubscribe: () => void };
  };
  exec: () => Promise<TestDocument[]>;
};

function createQueryStub(
  exec: () => Promise<TestDocument[]>,
): { query: QueryStub; observer: { current?: QueryObserver }; unsubscribe: ReturnType<typeof vi.fn> } {
  const observer: { current?: QueryObserver } = {};
  const unsubscribe = vi.fn();
  const query: QueryStub = {
    $: {
      subscribe: (nextObserver) => {
        observer.current = nextObserver;
        return { unsubscribe };
      },
    },
    exec,
  };
  return { query, observer, unsubscribe };
}

describe("useRxDB", () => {
  it("returns the database from DatabaseContextProvider", () => {
    const database = { name: "test-db" } as never;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContextProvider database={database}>{children}</DatabaseContextProvider>
    );

    const { result } = renderHook(() => useRxDB(), { wrapper });

    expect(result.current).toBe(database);
  });

  it("fails clearly when rendered outside the provider", () => {
    expect(() => renderHook(() => useRxDB())).toThrow(
      "RxDB database is not available in this component tree",
    );
  });
});

describe("useRxQuery", () => {
  it("returns an idle empty result when there is no query", () => {
    const { result } = renderHook(() => useRxQuery<TestDocument>(null));

    expect(result.current).toEqual({ result: [], loading: false });
  });

  it("subscribes, resolves the initial query, and unsubscribes on unmount", async () => {
    const documents = [{ id: "one" }];
    const { query, observer, unsubscribe } = createQueryStub(
      () => Promise.resolve(documents),
    );
    const { result, unmount } = renderHook(() => useRxQuery<TestDocument>(query as never));

    expect(result.current.loading).toBe(true);
    expect(observer.current).toBeDefined();

    await waitFor(() => {
      expect(result.current).toEqual({ result: documents, loading: false });
    });

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("accepts live subscription updates without waiting for exec", async () => {
    const { query, observer } = createQueryStub(
      () => new Promise<TestDocument[]>(() => {}),
    );
    const { result } = renderHook(() => useRxQuery<TestDocument>(query as never));

    act(() => {
      observer.current!.next([{ id: "live" }]);
    });

    await waitFor(() => {
      expect(result.current).toEqual({
        result: [{ id: "live" }],
        loading: false,
      });
    });
  });

  it("clears the result when the query errors", async () => {
    const { query } = createQueryStub(
      () => Promise.reject(new Error("query failed")),
    );
    const { result } = renderHook(() => useRxQuery<TestDocument>(query as never));

    await waitFor(() => {
      expect(result.current).toEqual({ result: [], loading: false });
    });
  });

  it("handles a live query error while still mounted", async () => {
    const { query, observer } = createQueryStub(
      () => new Promise<TestDocument[]>(() => {}),
    );
    const { result } = renderHook(() => useRxQuery<TestDocument>(query as never));

    act(() => {
      observer.current!.error();
    });

    await waitFor(() => {
      expect(result.current).toEqual({ result: [], loading: false });
    });
  });

  it("ignores callbacks after the query is unmounted", async () => {
    let rejectQuery!: (error: Error) => void;
    const { query, observer, unsubscribe } = createQueryStub(
      () =>
        new Promise<TestDocument[]>((_, reject) => {
          rejectQuery = reject;
        }),
    );
    const { result, unmount } = renderHook(() => useRxQuery<TestDocument>(query as never));

    unmount();
    act(() => {
      observer.current!.next([{ id: "stale" }]);
      observer.current!.error();
      rejectQuery(new Error("stale query failure"));
    });
    await Promise.resolve();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ result: [], loading: true });
  });
});
