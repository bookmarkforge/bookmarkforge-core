import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { RxCollection, RxDatabase, RxDocument, RxQuery } from "rxdb";
import { logger } from "../utils/logger";
import { useRxCollection as useOfficialRxCollection } from "rxdb/plugins/react";

const DatabaseContext = createContext<RxDatabase | null>(null);

export function DatabaseContextProvider({
  database,
  children,
}: {
  database: RxDatabase;
  children: ReactNode;
}) {
  return (
    <DatabaseContext.Provider value={database}>
      {children}
    </DatabaseContext.Provider>
  );
}

export function useRxDB<T extends RxDatabase = RxDatabase>(): T {
  const database = useContext(DatabaseContext);
  if (!database) {
    throw new Error("RxDB database is not available in this component tree");
  }
  return database as T;
}

export function useRxCollection<T = unknown>(
  name: string,
): RxCollection<T> | undefined {
  return useOfficialRxCollection(name) as RxCollection<T> | undefined;
}

/**
 * Preserve the former `{ result }` contract while callers move to the
 * official RxDB React provider. RxQuery itself remains the source of truth;
 * the subscription is cleaned up whenever a component rebuilds its query.
 */
export function useRxQuery<T = unknown>(
  query: RxQuery<T> | null | undefined,
): { result: Array<RxDocument<T>>; loading: boolean } {
  const [result, setResult] = useState<Array<RxDocument<T>>>([]);
  const [loading, setLoading] = useState(Boolean(query));

  useEffect(() => {
    let cancelled = false;
    if (!query) {
      setResult([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const observableQuery = query as unknown as {
      $: {
        subscribe: (observer: {
          next: (documents: Array<RxDocument<T>>) => void;
          error: () => void;
        }) => { unsubscribe: () => void };
      };
    };
    const subscription = observableQuery.$.subscribe({
      next: (documents) => {
        if (!cancelled) {
          setResult(documents);
          setLoading(false);
        }
      },
      error: () => {
        if (!cancelled) {
          setResult([]);
          setLoading(false);
        }
      },
    });

    void query
      .exec()
      .then((documents) => {
        if (!cancelled) {
          setResult(documents as Array<RxDocument<T>>);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          logger.warn("[useRxDB] Query failed, returning empty result", { error });
          setResult([]);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [query]);

  return { result, loading };
}
