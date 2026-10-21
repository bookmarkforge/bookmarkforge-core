import { useState } from "react";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { motion, AnimatePresence } from "motion/react";
import { Clock, Download, RotateCcw, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { logger } from "../../utils/logger";
import { logRateLimited } from "../../utils/boundedLog";
import { CardProps } from "./shared-props";
import {
  boundedBookmarkQuery,
  MAX_KNOWLEDGE_SCAN_ITEMS,
  MAX_SELECT_ITEMS,
} from "../../utils/knowledgeCardBounds";

interface Props extends CardProps {
  t: TFunction;
}

interface EphemeralEntry {
  id: string;
  title: string;
  expiresAt: string;
}

function getExpiryInfo(expiresAt: string) {
  const now = Date.now();
  const expiry = new Date(expiresAt).getTime();
  const diff = expiry - now;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  const hours = Math.ceil(diff / (1000 * 60 * 60));

  let colorClass = "";
  let label = "";

  if (diff <= 0) {
    colorClass = "text-gray-400 dark:text-gray-600";
    label = "ephemeral_expired";
  } else if (days > 7) {
    colorClass = "text-green-500";
    label = "ephemeral_green";
  } else if (days >= 1) {
    colorClass = "text-yellow-500";
    label = "ephemeral_yellow";
  } else {
    colorClass = "text-red-500";
    label = "ephemeral_red";
  }

  return { diff, days, hours, colorClass, label, isExpired: diff <= 0 };
}

export function EphemeralBookmarks({
  cardVariants: _cardVariants,
  t: _t,
}: Props) {
  const { t } = useTranslation();
  const [ephemeral, setEphemeral] = useState<EphemeralEntry[]>([]);
  const [titleInput, setTitleInput] = useState("");
  const [selectedDays, setSelectedDays] = useState(7);

  // Mount load + mutation-refresh actions — the guard family: late results
  // after unmount are dropped (the original had no unmount protection), and
  // each mutation reloads via the stable `load` identity.
  const { load: loadEphemeral, loading } = useGuardedDataLoad<EphemeralEntry[]>(
    async () => {
      const { initDB } = await import("../../container/database");
      const db = await initDB();
      // `lastChecked` is a JSON payload rather than an indexed expiry field,
      // so scan a bounded recent sample instead of materializing the vault.
      const bookmarks = await boundedBookmarkQuery(
        db.bookmarks,
        MAX_KNOWLEDGE_SCAN_ITEMS,
        { isDeleted: false },
      ).exec();

      const entries: EphemeralEntry[] = [];
      for (const bm of bookmarks) {
        if (!bm.lastChecked) {continue;}
        try {
          const parsed = JSON.parse(bm.lastChecked);
          if (parsed && parsed.expiresAt) {
            entries.push({
              id: bm.id,
              title: bm.title,
              expiresAt: parsed.expiresAt,
            });
          }
        } catch {
          /* not our format — skip */
          logRateLimited(
            "warn",
            "ephemeral-lastchecked-parse",
            "Bookmark lastChecked is not valid JSON; skipping ephemeral entry",
            { bookmarkId: bm.id },
          );
        }
      }
      return entries;
    },
    {
      onSuccess: setEphemeral,
      onError: (err) =>
        logger.error("[EphemeralBookmarks] load failed", err),
    },
  );

  const applyExpiry = useGuardedAction<void>({
    onSuccess: () => {
      setTitleInput("");
      void loadEphemeral();
    },
    onError: (err) =>
      logger.error("[EphemeralBookmarks] set expiry failed", err),
  });
  const applying = applyExpiry.isRunning;

  const handleSetExpiry = () => {
    if (!titleInput.trim()) {return;}
    void applyExpiry.run(async () => {
      const { initDB } = await import("../../container/database");
      const db = await initDB();
      const bookmarks = await boundedBookmarkQuery(
        db.bookmarks,
        MAX_SELECT_ITEMS,
        {
          isDeleted: false,
          title: { $regex: titleInput.trim(), $options: "i" },
        },
      ).exec();

      const expiresAt = new Date(
        Date.now() + selectedDays * 24 * 60 * 60 * 1000,
      ).toISOString();

      for (const bm of bookmarks) {
        await bm.incrementalPatch({
          lastChecked: JSON.stringify({ expiresAt }),
          updatedAt: new Date().toISOString(),
        });
      }
    });
  };

  const restoreEntry = useGuardedAction<boolean>({
    onSuccess: (didRestore) => {
      if (didRestore) {void loadEphemeral();}
    },
    onError: (err) =>
      logger.error("[EphemeralBookmarks] restore failed", err),
  });
  const handleRestore = (id: string) => {
    void restoreEntry.run(async () => {
      const { initDB } = await import("../../container/database");
      const db = await initDB();
      const doc = await db.bookmarks.findOne(id).exec();
      if (doc) {
        await doc.incrementalPatch({
          lastChecked: JSON.stringify({}),
          updatedAt: new Date().toISOString(),
        });
        return true;
      }
      return false;
    });
  };

  const archiveAll = useGuardedAction<void>({
    onSuccess: () => void loadEphemeral(),
    onError: (err) =>
      logger.error("[EphemeralBookmarks] archive all failed", err),
  });
  const handleArchiveAll = () => {
    void archiveAll.run(async () => {
      const { initDB } = await import("../../container/database");
      const db = await initDB();
      const now = new Date().toISOString();

      for (const entry of ephemeral) {
        if (new Date(entry.expiresAt).getTime() <= Date.now()) {
          const doc = await db.bookmarks.findOne(entry.id).exec();
          if (doc) {
            await doc.incrementalPatch({
              isDeleted: true,
              updatedAt: now,
            });
          }
        }
      }
    });
  };

  // Hide only while NOTHING is loaded yet — the original `loading` stayed
  // false on refresh reloads, so the card must not flash away mid-session.
  if (loading && ephemeral.length === 0) {return null;}

  const expiredCount = ephemeral.filter(
    (e) => new Date(e.expiresAt).getTime() <= Date.now(),
  ).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bento-item p-5"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-50 dark:bg-orange-900/20">
            <Clock className="size-5 text-orange-500" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white">
              {t("ephemeral_title", "Ephemeral Bookmarks")}
            </h3>
            <p className="text-[10px] text-[var(--text-muted)]">
              {t("ephemeral_subtitle", "Auto-expiring bookmarks")}
            </p>
          </div>
        </div>
        {expiredCount > 0 && (
          <button
            onClick={handleArchiveAll}
            className="truncate flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-xl bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-all"
          >
            <Download className="size-3" />
            {t("ephemeral_archiveAll", "Archive {{count}} expired", {
              count: expiredCount,
            })}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          aria-label={t("ephemeral_searchPlaceholder", "Search bookmark title")}
          placeholder={t(
            "ephemeral_searchPlaceholder",
            "Search bookmark title...",
          )}
          className="flex-1 px-3 py-2 text-xs rounded-xl border ds-border bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        <select
          value={selectedDays}
          onChange={(e) => setSelectedDays(Number(e.target.value))}
          aria-label={t("ephemeral_expiryDays", "Expiry period")}
          className="px-2 py-2 text-xs rounded-xl border ds-border bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          <option value={7}>{t("ephemeral_7days", "7 days")}</option>
          <option value={30}>{t("ephemeral_30days", "30 days")}</option>
          <option value={90}>{t("ephemeral_90days", "90 days")}</option>
        </select>
        <button
          onClick={handleSetExpiry}
          disabled={!titleInput.trim() || applying}
          className="truncate px-3 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-all whitespace-nowrap"
        >
          {applying
            ? t("ephemeral_applying", "Applying...")
            : t("ephemeral_apply", "Apply")}
        </button>
      </div>

      {ephemeral.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center py-6">
          <Clock className="size-8 text-[var(--text-muted)] mb-2" />
          <p className="text-xs text-[var(--text-muted)]">
            {t(
              "ephemeral_noEntries",
              "No ephemeral bookmarks yet. Search a bookmark title and set an expiry above.",
            )}
          </p>
        </div>
      )}

      <AnimatePresence>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {ephemeral.map((entry, i) => {
            const { days, hours, colorClass, isExpired } = getExpiryInfo(
              entry.expiresAt,
            );
            return (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`flex items-center justify-between p-3 rounded-2xl ds-bg-card ds-border ${isExpired ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Clock className={`size-4 shrink-0 ${colorClass}`} />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-[var(--text-primary)] dark:text-white truncate block">
                      {entry.title}
                    </span>
                    {!isExpired ? (
                      <span
                        className={`text-[10px] font-semibold ${colorClass}`}
                      >
                        {days > 0
                          ? t("ephemeral_daysRemaining", "{{count}} days", {
                              count: days,
                            })
                          : t("ephemeral_hoursRemaining", "{{count}} hours", {
                              count: hours,
                            })}
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <AlertTriangle className="size-3 text-red-400" />
                        <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">
                          {t("ephemeral_archived", "ARCHIVED")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                {isExpired && (
                  <button
                    onClick={() => handleRestore(entry.id)}
                    className="truncate flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-xl bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all shrink-0 ms-2"
                  >
                    <RotateCcw className="size-3" />
                    {t("ephemeral_restore", "Restore")}
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>
      </AnimatePresence>
    </motion.div>
  );
}
