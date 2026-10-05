import { useState, useEffect, useRef, useCallback } from "react";
import { initDB } from "../db/database";
import type { Bookmark, RxDBSubscription } from "../types";
import { logger } from "../utils/logger";

/**
 * Manages the RxDB live subscription for bookmarks.
 * Returns the current bookmark list and loading state.
 */
export function useBookmarkData() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const bufferedDataRef = useRef<unknown>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const flushBookmarks = useCallback(() => {
    if (bufferedDataRef.current !== null) {
      setBookmarks(bufferedDataRef.current as unknown as Bookmark[]);
      bufferedDataRef.current = null;
    }
  }, []);

  useEffect(() => {
    let sub: RxDBSubscription | undefined;
    let loadingTimeout: NodeJS.Timeout;
    let cancelled = false;

    const setupDB = async () => {
      try {
        setIsLoading(true);

        const db = await initDB();

        if (cancelled) {
          return;
        }

        // Start timeout AFTER initDB resolves — the subscription should
        // emit its first value almost immediately. A 5 s guard covers
        // cold-start RxDB without firing prematurely during initDB.
        loadingTimeout = setTimeout(() => {
          logger.error("DB subscription timeout — no emission within 5 s");
          setIsLoading(false);
        }, 5_000);

        sub = db.bookmarks
          .find({
            selector: {
              isDeleted: { $ne: true },
            },
          })
          .sort({ createdAt: "desc" })
          .$.subscribe({
            next: (data: unknown) => {
              clearTimeout(loadingTimeout);
              bufferedDataRef.current = data;
              if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
              }
              debounceTimerRef.current = setTimeout(() => {
                debounceTimerRef.current = null;
                // A subscription emission may still land between the unmount
                // cleanup and the timer firing; never publish buffered data
                // after the hook has been torn down.
                if (cancelled) {return;}
                flushBookmarks();
                setIsLoading(false);
              }, 100);
            },
            error: (err: unknown) => {
              clearTimeout(loadingTimeout);
              logger.error("DB subscription error", { error: err });
              setIsLoading(false);
            },
            complete: () => {
              clearTimeout(loadingTimeout);
              setIsLoading(false);
            },
          });
      } catch (err) {
        clearTimeout(loadingTimeout);
        logger.error("Error setting up DB subscription", { error: err });
        setIsLoading(false);
      }
    };
    setupDB();
    return () => {
      cancelled = true;
      clearTimeout(loadingTimeout);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (sub && typeof sub.unsubscribe === "function") {
        sub.unsubscribe();
      }
    };
  }, [flushBookmarks]);

  return { bookmarks, setBookmarks, isLoading };
}
