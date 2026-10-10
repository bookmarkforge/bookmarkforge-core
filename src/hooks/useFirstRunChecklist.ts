import { useCallback, useEffect, useState } from "react";
import { initDB } from "../db/database";
import { safeGet, safeSet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { useSecurityStore } from "./useSecurityStore";
import { logger } from "../utils/logger";

/**
 * Broadcast after any surface records first-run progress — today only "the
 * user opened search". Lets an already-mounted checklist re-read its state
 * without waiting for a remount.
 */
export const FIRST_RUN_PROGRESS_EVENT = "forge:first-run-progress";

interface FirstRunChecklistState {
  /** Non-deleted bookmarks; undefined while the count is still loading. */
  bookmarkCount: number | undefined;
  /** Non-deleted documents; undefined while the count is still loading. */
  documentCount: number | undefined;
  /** True once search has been opened at least once. */
  searchTried: boolean;
  /** True once the user hid the checklist — it stays hidden afterwards. */
  dismissed: boolean;
  /** Hides the checklist for good. */
  dismiss: () => void;
}

/** Records that the user tried search. Safe to call from any surface. */
export function markFirstRunSearchTried(): void {
  safeSet(STORAGE_KEYS.FIRST_RUN_SEARCH_TRIED, "1");
  window.dispatchEvent(new Event(FIRST_RUN_PROGRESS_EVENT));
}

function isSearchTried(): boolean {
  return safeGet(STORAGE_KEYS.FIRST_RUN_SEARCH_TRIED) === "1";
}

function isDismissed(): boolean {
  return safeGet(STORAGE_KEYS.FIRST_RUN_CHECKLIST_DISMISSED) === "true";
}

/**
 * Live first-run progress for the dashboard checklist.
 *
 * The two counts come from the vault DB, which only exists once the vault is
 * unlocked — so the effect re-reads on every lock/unlock flip and the
 * checklist stays in its loading state while the DB is unavailable. Search
 * progress is a persisted flag (no query), so it is read synchronously on
 * mount and refreshed whenever a surface announces progress.
 */
export function useFirstRunChecklist(): FirstRunChecklistState {
  const isLocked = useSecurityStore((state) => state.isLocked);
  const [bookmarkCount, setBookmarkCount] = useState<number | undefined>(
    undefined,
  );
  const [documentCount, setDocumentCount] = useState<number | undefined>(
    undefined,
  );
  const [searchTried, setSearchTried] = useState<boolean>(isSearchTried);
  const [dismissed, setDismissed] = useState<boolean>(isDismissed);

  useEffect(() => {
    if (isLocked) {
      setBookmarkCount(undefined);
      setDocumentCount(undefined);
      return;
    }

    let cancelled = false;

    const readCounts = async () => {
      try {
        const db = await initDB();
        if (cancelled) {
          return;
        }
        const [bookmarks, documents] = await Promise.all([
          db.bookmarks.count({ selector: { isDeleted: false } }).exec(),
          db.documents.count({ selector: { isDeleted: false } }).exec(),
        ]);
        if (cancelled) {
          return;
        }
        setBookmarkCount(bookmarks);
        setDocumentCount(documents);
      } catch (error) {
        // A missing or uninitialized DB is not a failure for a first-run
        // surface: the checklist keeps its loading state and stays out of
        // the way of whatever the user is actually doing.
        logger.debug("[useFirstRunChecklist] counts unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const readFlags = () => {
      setSearchTried(isSearchTried());
      setDismissed(isDismissed());
    };

    void readCounts();
    window.addEventListener(FIRST_RUN_PROGRESS_EVENT, readFlags);

    return () => {
      cancelled = true;
      window.removeEventListener(FIRST_RUN_PROGRESS_EVENT, readFlags);
    };
  }, [isLocked]);

  const dismiss = useCallback(() => {
    safeSet(STORAGE_KEYS.FIRST_RUN_CHECKLIST_DISMISSED, "true");
    setDismissed(true);
    window.dispatchEvent(new Event(FIRST_RUN_PROGRESS_EVENT));
  }, []);

  return {
    bookmarkCount,
    documentCount,
    searchTried,
    dismissed,
    dismiss,
  };
}
