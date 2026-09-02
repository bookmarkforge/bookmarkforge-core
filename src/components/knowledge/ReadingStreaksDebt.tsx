import type { BookmarkDocType } from "../../db/schema";
import type { BookmarkForgeDB } from "../../db/types";
import { useState } from "react";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { motion } from "motion/react";
import { EASE_OUT, DURATION_MENU } from "../../constants/motion";
import { Flame, Bookmark, Calendar, TrendingUp, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { safeGet, safeSet } from "../../store/safeStorage";
import { CardProps } from "./shared-props";

interface Props extends CardProps {
  t: TFunction;
}

export const ReadingStreaksDebt: React.FC<Props> = ({ cardVariants }) => {
  const { t } = useTranslation();
  const [streak, setStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [totalBookmarks, setTotalBookmarks] = useState(0);
  const [unreadBookmarks, setUnreadBookmarks] = useState(0);
  const [debtDays, setDebtDays] = useState(0);

  // Mount load — useGuardedDataLoad: a late result after unmount is dropped
  // and loading resets automatically.
  const { loading } = useGuardedDataLoad<{
    streak: number;
    longestStreak: number;
    totalBookmarks: number;
    unreadBookmarks: number;
    debtDays: number;
  }>(
    async () => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      const bookmarks = await db.bookmarks.find().exec();

      const active = bookmarks.filter((b: BookmarkDocType) => !b.isDeleted);

      const unread = active.filter(
        (b: BookmarkDocType) => !b.lastVisitedAt || b.lastVisitedAt === b.createdAt,
      );
      const debtDays = Math.ceil(unread.length / 3);

      const dayMap = new Map<string, number>();
      for (const bm of active) {
        const day = bm.createdAt.slice(0, 10);
        dayMap.set(day, (dayMap.get(day) || 0) + 1);
      }

      let currentStreak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let i = 0; ; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        if (dayMap.has(key) && dayMap.get(key)! > 0) {
          currentStreak++;
        } else {
          break;
        }
      }

      const storedLongest = parseInt(
        safeGet("bookmarkforge_longest_streak") || "0",
        10,
      );
      if (currentStreak > storedLongest) {
        safeSet("bookmarkforge_longest_streak", String(currentStreak));
      }
      safeSet("bookmarkforge_current_streak", String(currentStreak));

      return {
        streak: currentStreak,
        longestStreak: Math.max(currentStreak, storedLongest),
        totalBookmarks: active.length,
        unreadBookmarks: unread.length,
        debtDays,
      };
    },
    {
      onSuccess: (data) => {
        setStreak(data.streak);
        setLongestStreak(data.longestStreak);
        setTotalBookmarks(data.totalBookmarks);
        setUnreadBookmarks(data.unreadBookmarks);
        setDebtDays(data.debtDays);
      },
      onError: () => {
        setStreak(0);
        setTotalBookmarks(0);
        setUnreadBookmarks(0);
        setDebtDays(0);
      },
    },
  );

  const readRatio =
    totalBookmarks > 0
      ? (totalBookmarks - unreadBookmarks) / totalBookmarks
      : 0;

  if (loading) {return null;}

  return (
    <motion.div variants={cardVariants} className="bento-item p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg ds-bg-gradient">
            <Flame className="size-5 text-orange-500" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white">
              {t("readingStreaks_title", "Reading Streaks")}
            </h3>
            <p className="text-[10px] text-[var(--text-muted)]">
              {t(
                "readingStreaks_subtitle",
                "Consecutive days with reading activity",
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-5">
        <div className="relative">
          <Flame
            className={`size-10 ${
              streak > 0
                ? "text-orange-500 animate-pulse"
                : "text-gray-300 dark:text-gray-600"
            }`}
          />
          <span className="absolute -top-1 -right-2 text-lg font-extrabold text-orange-500 tabular-nums">
            {streak}
          </span>
        </div>
        <div>
          <p className="text-xs font-semibold text-[var(--text-primary)] dark:text-white">
            {t("readingStreaks_current", "Current streak: {{count}} days", {
              count: streak,
            })}
          </p>
          <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
            <TrendingUp className="size-3" />
            {t("readingStreaks_longest", "Longest: {{count}} days", {
              count: longestStreak,
            })}
          </p>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between text-[10px] font-semibold text-[var(--text-muted)] mb-1.5">
          <span className="flex items-center gap-1">
            <Bookmark className="size-3" />
            {t("readingStreaks_progress", "Reading Progress")}
          </span>
          <span>{Math.round(readRatio * 100)}%</span>
        </div>
        <div className="w-full h-2 rounded-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] overflow-hidden">
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: readRatio }}
            transition={{ duration: DURATION_MENU, ease: EASE_OUT }}
            className="h-full w-full origin-left rounded-full bg-gradient-to-r from-orange-400 to-rose-500"
          />
        </div>
      </div>

      <div className="p-3 rounded-2xl ds-bg-card ds-border">
        <div className="flex items-center gap-2 mb-1.5">
          <Clock className="size-4 text-amber-500" />
          <span className="text-xs font-bold text-[var(--text-primary)] dark:text-white">
            {t("readingStreaks_knowledgeDebt", "Knowledge Debt")}
          </span>
        </div>
        <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed mb-2">
          {t(
            "readingStreaks_debtDescription",
            "{{unread}} unread (~{{days}} days to catch up)",
            {
              unread: unreadBookmarks,
              days: debtDays,
            },
          )}
        </p>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
          <Calendar className="size-3" />
          <span>
            {t(
              "readingStreaks_catchUpPlan",
              "Read 3 bookmarks/day for {{days}} days",
              {
                days: debtDays,
              },
            )}
          </span>
        </div>
      </div>
    </motion.div>
  );
};
