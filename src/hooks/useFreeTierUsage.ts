import { useEffect, useState } from "react";
import { combineLatest } from "rxjs";
import { initDB } from "../container/database";
import { licenseService } from "../services/LicenseService";
import { FREE_LIMITS } from "../constants/license";
import { useSecurityStore } from "./useSecurityStore";
import { logger } from "../utils/logger";

/**
 * Live free-tier usage for the upgrade nudge surfaces.
 *
 * Subscribes to the same reactive count query the enforcement hook counts
 * with (attachBookmarkFreeLimit), so the meter and the wall can never
 * disagree. Everything is a no-op for Pro users — the nudge must not exist
 * for them.
 */
interface FreeTierUsage {
  /**
   * Count of the fullest limited collection (bookmarks and documents each
   * have their own FREE_LIMITS.maxBookmarks ceiling). The meter reports the
   * collection nearest its wall — undefined while loading.
   */
  count: number | undefined;
  /** Free ceiling (FREE_LIMITS.maxBookmarks). */
  limit: number;
  /** True when the vault is at the wall — new saves pause. */
  atWall: boolean;
  /** True within the nudge's quiet-approach window (count ≥ 90% of limit). */
  nearWall: boolean;
  /** False while the user has Pro access (or state is still resolving). */
  isFree: boolean;
  /** Whether one more bookmark is allowed by LicenseService. */
  canAddBookmark: boolean | undefined;
}

const EMPTY: FreeTierUsage = {
  count: undefined,
  limit: FREE_LIMITS.maxBookmarks,
  atWall: false,
  nearWall: false,
  isFree: false,
  canAddBookmark: undefined,
};

export function useFreeTierUsage(): FreeTierUsage {
  // The lock screen gates the whole app shell; when it lifts, the DB
  // connection exists. Re-evaluating on this flip covers cold start and
  // re-lock/unlock cycles in one dependency.
  const isLocked = useSecurityStore((state) => state.isLocked);
  const [usage, setUsage] = useState<FreeTierUsage>(EMPTY);

  useEffect(() => {
    if (isLocked) {
      setUsage(EMPTY);
      return;
    }

    let cancelled = false;
    let subscription: { unsubscribe: () => void } | null = null;
    // evaluate() is re-entrant (storage events, lock flips): a generation
    // counter plus unsubscribe-before-resubscribe keeps in-flight calls
    // from orphaning an RxDB subscription.
    let evaluateGeneration = 0;

    const evaluate = async () => {
      const generation = ++evaluateGeneration;
      subscription?.unsubscribe();
      subscription = null;
      if (licenseService.hasProAccess()) {
        if (!cancelled) {setUsage(EMPTY);}
        return;
      }
      try {
        // initDB() reuses the live connection created at unlock — no second
        // database instance is opened (see useDatabaseInit).
        const db = await initDB();
        if (
          cancelled ||
          generation !== evaluateGeneration ||
          licenseService.hasProAccess()
        ) {
          return;
        }
        // Reactive query: same { isDeleted: false } shape the preInsert walls
        // count with — each collection has its OWN ceiling, so the meter
        // reports the fullest one and never disagrees with either wall.
        const count$ = combineLatest([
          db.bookmarks.count({ selector: { isDeleted: false } }).$,
          db.documents.count({ selector: { isDeleted: false } }).$,
        ]);
        const sub = count$.subscribe({
          next: ([bookmarkCount, documentCount]: [number, number]) => {
            if (cancelled || licenseService.hasProAccess()) {return;}
            const count = Math.max(bookmarkCount, documentCount);
            // canAddBookmark is bookmark-specific: the save-hint surfaces
            // (Capture, QuickCapture) only create bookmarks, so the document
            // wall must not pause them.
            void licenseService.canAddBookmarks(bookmarkCount).then((canAddBookmark) => {
              if (cancelled || licenseService.hasProAccess()) {return;}
              setUsage({
                count,
                limit: FREE_LIMITS.maxBookmarks,
                // Either collection at its own ceiling counts as "at the
                // wall" for dashboard-level nudges; capture surfaces use
                // canAddBookmark (bookmark-specific) instead.
                atWall: count >= FREE_LIMITS.maxBookmarks,
                nearWall: count >= Math.floor(FREE_LIMITS.maxBookmarks * 0.9),
                isFree: true,
                canAddBookmark,
              });
            });
          },
          error: (error: unknown) => {
            logger.warn("[useFreeTierUsage] count query failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          },
        });
        // A newer evaluate() (or unmount) may have superseded this one while
        // initDB() was in flight — never keep a stale subscription.
        if (cancelled || generation !== evaluateGeneration) {
          sub.unsubscribe();
          return;
        }
        subscription = sub;
      } catch (error) {
        // DB not initialized yet (locked vault, cold start): stay quiet.
        logger.debug("[useFreeTierUsage] db unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void evaluate();

    // License flips (activate/deactivate) re-evaluate the gate.
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith("bf_")) {void evaluate();}
    };
    window.addEventListener("storage", onStorage);

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, [isLocked]);

  return usage;
}
