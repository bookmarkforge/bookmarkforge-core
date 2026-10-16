import { useEffect, useState } from "react";
import { initDB } from "../db/database";
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
  /** Non-deleted bookmark count (undefined while loading). */
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

    const evaluate = async () => {
      if (licenseService.hasProAccess()) {
        if (!cancelled) {setUsage(EMPTY);}
        return;
      }
      try {
        // initDB() reuses the live connection created at unlock — no second
        // database instance is opened (see useDatabaseInit).
        const db = await initDB();
        if (cancelled || licenseService.hasProAccess()) {return;}
        // Reactive query: same shape the preInsert wall counts with
        // ({ isDeleted: false }), so the meter never disagrees with the wall.
        const count$ = db.bookmarks.count({
          selector: { isDeleted: false },
        }).$;
        subscription = count$.subscribe({
          next: (count: number) => {
            if (cancelled || licenseService.hasProAccess()) {return;}
            void licenseService.canAddBookmarks(count).then((canAddBookmark) => {
              if (cancelled || licenseService.hasProAccess()) {return;}
              setUsage({
                count,
                limit: FREE_LIMITS.maxBookmarks,
                atWall: !canAddBookmark,
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
