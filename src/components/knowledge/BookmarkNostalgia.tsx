import type { BookmarkForgeDB } from "../../db/types";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Crown,
  TrendingUp,
  Star,
  Clock,
  Sparkles,
  Bookmark,
} from "lucide-react";
import { logger } from "../../utils/logger";
import type { TFunction } from "i18next";
import { CardProps } from "./shared-props";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";

interface Props extends CardProps {
  t: TFunction;
}

interface YearData {
  year: number;
  totalSaved: number;
  topMonth: string;
  peakCount: number;
  favoriteTopic: string;
  favoriteBookmark: string;
  monthlyCounts: { month: string; count: number }[];
  topTags: string[];
  readingStreak: number;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const BookmarkNostalgia: React.FC<Props> = ({ cardVariants, t }) => {
  const [yearData, setYearData] = useState<YearData | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [reflection, setReflection] = useState("");

  const allYearDataRef = useState<Map<number, YearData>>(new Map())[0];
  const {
    runWithSignal: runGenerateReflection,
    isRunning: generatingReflection,
    cancel: cancelReflection,
  } = useGuardedAction<void>({
    blockReentry: false,
    onError: (error) => {
      const isAbortError =
        (error instanceof Error || error instanceof DOMException) &&
        error.name === "AbortError";
      if (!isAbortError) {
        setReflection(
          t("bookmarkNostalgia_reflectionError", {
            defaultValue: "The stars are quiet tonight. Try again later.",
          }),
        );
      }
    },
  });

  // Mount-only data load (autoLoad on mount, no reload on year switch —
  // handleYearChange reads from the allYearDataRef Map instead of re-pulling
  // the whole collection). The loader gates its side effects on the guard's
  // AbortSignal at the same await boundaries the old isCurrent checks did;
  // cancelNostalgiaLoad (year switch / unmount) drops the late result.
  const {
    loading,
    cancel: cancelNostalgiaLoad,
  } = useGuardedDataLoad<YearData | null>(
    async (signal) => {
      const { initDB } = await import("../../container/database");
      if (signal.aborted) {return null;}
      const db = await initDB() as BookmarkForgeDB;
      const bookmarks = await db.bookmarks
        .find({ selector: { isDeleted: false, isPrivate: false } })
        .exec();
      if (signal.aborted) {return null;}

      const byYear = new Map<number, typeof bookmarks[number][]>();
      for (const bm of bookmarks) {
        const year = new Date(bm.createdAt).getFullYear();
        if (!byYear.has(year)) {byYear.set(year, []);}
        byYear.get(year)!.push(bm);
      }

      const years = Array.from(byYear.keys()).sort(
        (a: number, b: number) => b - a,
      );
      if (signal.aborted) {return null;}
      setAvailableYears(years);
      if (
        years.length > 0 &&
        !years.includes(selectedYear) &&
        years[0] !== undefined
      ) {
        setSelectedYear(years[0]);
      }

      for (const [year, bms] of byYear) {
        const monthlyCounts = MONTHS.map((month) => {
          const count = bms.filter(
            (bm) =>
              new Date(bm.createdAt).getMonth() === MONTHS.indexOf(month),
          ).length;
          return { month, count };
        });

        const peak = monthlyCounts.reduce((max, m) =>
          m.count > max.count ? m : max,
        );

        const tagCounts = new Map<string, number>();
        for (const bm of bms) {
          if (bm.tags) {
            for (const tag of bm.tags) {
              tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
          }
        }
        const topTags = Array.from(tagCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([tag]) => tag);
        const favoriteTopic = topTags[0] || "—";

        const visitCounts = new Map<string, number>();
        for (const bm of bms) {
          const key = bm.title || bm.url || "Untitled";
          visitCounts.set(key, (visitCounts.get(key) || 0) + 1);
        }
        const favoriteBookmark =
          Array.from(visitCounts.entries()).sort(
            (a, b) => b[1] - a[1],
          )[0]?.[0] || "—";

        const dates = bms
          .map((bm) => new Date(bm.createdAt))
          .sort((a: Date, b: Date) => a.getTime() - b.getTime());

        let bestStreak = 0;
        let currentStreak = 0;
        let prevDate: Date | null = null;
        for (const date of dates) {
          const day = new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
          );
          if (prevDate) {
            const diff = (day.getTime() - prevDate.getTime()) / 86400000;
            if (diff === 1) {
              currentStreak++;
            } else if (diff > 1) {
              bestStreak = Math.max(bestStreak, currentStreak + 1);
              currentStreak = 0;
            }
          }
          prevDate = day;
        }
        bestStreak = Math.max(bestStreak, currentStreak + 1);

        byYear.set(year, bms);
        allYearDataRef.set(year, {
          year,
          totalSaved: bms.length,
          topMonth: peak.month,
          peakCount: peak.count,
          favoriteTopic,
          favoriteBookmark,
          monthlyCounts,
          topTags,
          readingStreak: bestStreak || 0,
        });
      }

      const targetYear = years.includes(selectedYear)
        ? selectedYear
        : years[0];
      return targetYear !== undefined
        ? allYearDataRef.get(targetYear) ?? null
        : null;
    },
    {
      onSuccess: (current) => {
        if (current) {setYearData(current);}
      },
      onError: (err) => {
        const isAbortError =
          (err instanceof Error || err instanceof DOMException) &&
          err.name === "AbortError";
        if (!isAbortError) {
          logger.error("Failed to load bookmarks for nostalgia", err);
        }
      },
    },
  );

  const handleYearChange = (year: number) => {
    cancelNostalgiaLoad();
    cancelReflection();
    setSelectedYear(year);
    setReflection("");
    const data = allYearDataRef.get(year);
    if (data) {setYearData(data);}
  };

  const handleGenerateReflection = () => {
    if (!yearData) {return;}
    const requestedYear = yearData;
    setReflection("");
    void runGenerateReflection(async (signal) => {
      const { agentService } = await import("../../services/ai/AgentService");
      if (signal.aborted) {return;}
      const monthlyStr = requestedYear.monthlyCounts
        .filter((m) => m.count > 0)
        .map((m) => `${m.month}: ${m.count}`)
        .join(", ");
      const prompt = `Look at these monthly bookmark counts for ${requestedYear.year}: ${monthlyStr}. Top tags: ${requestedYear.topTags.join(", ")}. Favorite: ${requestedYear.favoriteTopic}. Write one poetic sentence about this person's year of learning.`;
      // Stream real tokens live into the reflection blockquote.
      const res = await agentService.globalChat(
        prompt,
        undefined,
        false,
        undefined,
        (chunk) => {
          if (!signal.aborted) {
            setReflection((prev) => prev + chunk);
          }
        },
        undefined,
        undefined,
        signal,
      );
      if (signal.aborted) {return;}
      setReflection(res.text);
    });
  };

  if (loading) {
    return (
      <motion.div
        variants={cardVariants}
        className="p-2 md:p-3 rounded-[3rem] shadow-sm ds-card"
      >
        <div className="flex items-center justify-center h-40 ds-text-muted">
          {t("bookmarkNostalgia_loading", {
            defaultValue: "Rewinding the year...",
          })}
        </div>
      </motion.div>
    );
  }

  if (availableYears.length === 0) {
    return (
      <motion.div
        variants={cardVariants}
        className="p-2 md:p-3 rounded-[3rem] shadow-sm ds-card"
      >
        <div className="flex flex-col items-center justify-center h-40 gap-3 ds-text-muted">
          <Bookmark className="size-8 opacity-40" />
          <span className="text-sm">
            {t("bookmarkNostalgia_empty", {
              defaultValue:
                "No bookmarks yet. Start collecting to see your year in review.",
            })}
          </span>
        </div>
      </motion.div>
    );
  }

  const maxMonthlyCount = Math.max(
    ...(yearData?.monthlyCounts.map((m) => m.count) || [1]),
    1,
  );

  return (
    <motion.div
      variants={cardVariants}
      className="p-2 md:p-3 rounded-[3rem] shadow-sm ds-card bg-gradient-to-br from-purple-50 to-pink-100 dark:from-purple-900/20 dark:to-pink-900/20"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="ds-h2 truncate">
            {t("bookmarkNostalgia_title", { defaultValue: "Bookmark Wrapped" })}
          </h2>
          <p className="ds-label-section mt-1 ds-text-muted">
            {t("bookmarkNostalgia_subtitle", {
              defaultValue: "Your year in review",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-2xl text-[10px] font-semibold uppercase tracking-wider border ds-bg-accent-soft ds-text-accent ds-border-accent-glow">
          <Sparkles className="size-3" />
          {t("bookmarkNostalgia_badge", { defaultValue: "Nostalgia" })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {availableYears.map((year) => (
          <button
            key={year}
            onClick={() => handleYearChange(year)}
            className={`truncate px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
              selectedYear === year
                ? "bg-purple-500 text-white shadow-lg"
                : "ds-bg-muted ds-text-muted hover:ds-bg-accent-soft"
            }`}
          >
            {year}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {yearData && (
          <motion.div
            key={selectedYear}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            <div className="text-center py-4">
              <span className="text-7xl font-black tracking-tighter bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
                {selectedYear}
              </span>
              <p className="text-lg font-semibold mt-2 ds-text-primary">
                {t("bookmarkNostalgia_total", {
                  defaultValue: `You saved ${yearData.totalSaved} bookmarks in ${selectedYear}`,
                })}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl ds-bg-accent-soft ds-border-accent-glow">
                <Crown className="size-5 text-amber-400 mb-2" />
                <p className="text-xs ds-text-muted">
                  {t("bookmarkNostalgia_peakMonth", {
                    defaultValue: `${yearData.topMonth} was your peak (${yearData.peakCount} bookmarks)`,
                  })}
                </p>
              </div>
              <div className="p-4 rounded-2xl ds-bg-accent-soft ds-border-accent-glow">
                <Star className="size-5 text-amber-400 mb-2" />
                <p className="text-xs ds-text-muted">
                  {yearData.favoriteTopic}
                </p>
              </div>
              <div className="p-4 rounded-2xl ds-bg-accent-soft ds-border-accent-glow">
                <Star className="size-5 text-yellow-400 mb-2" />
                <p className="text-xs ds-text-muted truncate">
                  {yearData.favoriteBookmark}
                </p>
              </div>
              <div className="p-4 rounded-2xl ds-bg-accent-soft ds-border-accent-glow">
                <TrendingUp className="size-5 text-green-400 mb-2" />
                <p className="text-xs ds-text-muted">
                  {t("bookmarkNostalgia_streak", {
                    defaultValue: `${yearData.readingStreak} day streak`,
                  })}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest ds-text-muted mb-3">
                {t("bookmarkNostalgia_monthlyLabel", {
                  defaultValue: "Monthly Activity",
                })}
              </p>
              <div className="flex items-end gap-1 h-32">
                {yearData.monthlyCounts.map((m) => (
                  <div
                    key={m.month}
                    className="flex-1 flex flex-col items-center gap-1"
                  >
                    <span className="text-[9px] font-semibold ds-text-muted">
                      {m.count || ""}
                    </span>
                    <div
                      className="w-full rounded-t-md bg-gradient-to-t from-purple-400 to-pink-400 dark:from-purple-600 dark:to-pink-600 transition-all"
                      style={{
                        height: `${(m.count / maxMonthlyCount) * 100}%`,
                        minHeight: m.count > 0 ? "4px" : "0",
                      }}
                    />
                    <span className="text-[8px] ds-text-muted">
                      {m.month.slice(0, 3)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {yearData.topTags.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest ds-text-muted mb-3">
                  {t("bookmarkNostalgia_topTagsLabel", {
                    defaultValue: "Top Topics",
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {yearData.topTags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1.5 rounded-full text-[11px] font-semibold ds-bg-accent-soft ds-text-accent ds-border-accent-glow"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2">
              {!reflection && (
                <button
                  onClick={handleGenerateReflection}
                  disabled={generatingReflection}
                  className="truncate flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 mx-auto"
                >
                  {generatingReflection ? (
                    <Sparkles className="size-4 animate-pulse" />
                  ) : (
                    <Clock className="size-4" />
                  )}
                  {generatingReflection
                    ? t("bookmarkNostalgia_generating", {
                        defaultValue: "Generating...",
                      })
                    : t("bookmarkNostalgia_generate", {
                        defaultValue: "Generate Reflection",
                      })}
                </button>
              )}
              {reflection && (
                <motion.blockquote
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="italic text-sm text-center ds-text-muted border-s-4 border-purple-400 ps-4 py-2 mx-auto max-w-md"
                >
                  "{reflection}"
                </motion.blockquote>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
