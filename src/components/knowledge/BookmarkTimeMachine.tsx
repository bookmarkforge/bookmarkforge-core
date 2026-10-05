import type { BookmarkForgeDB } from "../../db/types";
import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Calendar, Clock, Bookmark } from "lucide-react";
import type { TFunction } from "i18next";
import { formatDate } from "../../utils/localization";
import i18n from "../../i18n";
import { logger } from "../../utils/logger";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { CardProps } from "./shared-props";

interface Props extends CardProps {
  t: TFunction;
}

interface TimelineItem {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
}

interface TimelineMonth {
  month: string;
  year: number;
  items: TimelineItem[];
}

export const BookmarkTimeMachine: React.FC<Props> = ({ cardVariants, t }) => {
  const [timelineData, setTimelineData] = useState<TimelineMonth[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [_scrollPos, setScrollPos] = useState(0);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Mount load — useGuardedDataLoad: a late result after unmount is dropped
  // and loading resets automatically.
  const { loading } = useGuardedDataLoad<TimelineMonth[]>(
    async () => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      const bookmarks = await db.bookmarks.find().exec();

      const grouped: Record<string, TimelineMonth> = {};

      for (const bm of bookmarks) {
        const date = new Date(bm.createdAt);
        const month = formatDate(date, { month: "long" }, i18n.language);
        const year = date.getFullYear();
        const key = `${month}-${year}`;

        if (!grouped[key]) {
          grouped[key] = { month, year, items: [] };
        }

        grouped[key].items.push({
          id: bm.id,
          title: bm.title || bm.url || "",
          tags: bm.tags || [],
          createdAt: bm.createdAt,
        });
      }

      const sorted = Object.values(grouped).sort((a, b) => {
        const dateA = new Date(`${a.month} 1, ${a.year}`);
        const dateB = new Date(`${b.month} 1, ${b.year}`);
        return dateB.getTime() - dateA.getTime();
      });

      return sorted;
    },
    {
      onSuccess: setTimelineData,
      onError: (err) =>
        logger.error("Failed to load bookmarks for timeline", err),
    },
  );

  const handleScroll = () => {
    if (timelineRef.current) {
      setScrollPos(timelineRef.current.scrollLeft);
    }
  };

  const getPillarColor = (count: number) => {
    if (count <= 3) {return "bg-blue-500/10 border-blue-500/20";}
    if (count <= 10) {return "bg-purple-500/10 border-purple-500/20";}
    return "bg-amber-500/10 border-amber-500/20";
  };

  const getBadgeColor = (count: number) => {
    if (count <= 3) {return "bg-blue-500/20 text-blue-300";}
    if (count <= 10) {return "bg-purple-500/20 text-purple-300";}
    return "bg-amber-500/20 text-amber-300";
  };

  const getTopTags = (
    items: TimelineItem[],
  ): { tag: string; count: number }[] => {
    const tagCount: Record<string, number> = {};
    for (const item of items) {
      for (const tag of item.tags) {
        tagCount[tag] = (tagCount[tag] || 0) + 1;
      }
    }
    return Object.entries(tagCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag, count]) => ({ tag, count }));
  };

  if (loading) {
    return (
      <motion.div
        variants={cardVariants}
        className="p-2 md:p-3 rounded-[3rem] shadow-sm ds-card"
      >
        <div className="flex items-center justify-center h-40 ds-text-muted">
          {t("bookmarkTimeMachine_loading", {
            defaultValue: "Loading timeline...",
          })}
        </div>
      </motion.div>
    );
  }

  if (timelineData.length === 0) {
    return (
      <motion.div
        variants={cardVariants}
        className="p-2 md:p-3 rounded-[3rem] shadow-sm ds-card"
      >
        <div className="flex flex-col items-center justify-center h-40 gap-3 ds-text-muted">
          <Bookmark className="size-8 opacity-40" />
          <span className="text-sm">
            {t("bookmarkTimeMachine_empty", {
              defaultValue: "No bookmarks yet. Your timeline will appear here.",
            })}
          </span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={cardVariants}
      className="p-2 md:p-3 rounded-[3rem] shadow-sm ds-card"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="ds-h2 truncate">
            {t("bookmarkTimeMachine_title", { defaultValue: "Time Machine" })}
          </h2>
          <p className="ds-label-section mt-1 whitespace-nowrap ds-text-muted">
            {t("bookmarkTimeMachine_subtitle", {
              defaultValue: "Your interests over time",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-2xl text-[10px] font-semibold uppercase tracking-wider border whitespace-nowrap ds-bg-accent-soft ds-text-accent ds-border-accent-glow">
          <Clock className="size-3" />
          {t("bookmarkTimeMachine_badge", { defaultValue: "Timeline" })}
        </div>
      </div>

      <div
        ref={timelineRef}
        onScroll={handleScroll}
        className="overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 ds-bg-card ds-radius-card"
      >
        <div className="flex gap-4">
          {timelineData.map((monthData) => {
            const key = `${monthData.month}-${monthData.year}`;
            const count = monthData.items.length;
            const topTags = getTopTags(monthData.items);
            const isSelected = selectedMonth === key;

            return (
              <motion.div
                key={key}
                layout
                onClick={() => setSelectedMonth(isSelected ? null : key)}
                className={`min-w-[180px] rounded-2xl p-5 snap-start border cursor-pointer transition-all duration-200 hover:scale-[1.02] ${getPillarColor(count)}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="size-4 opacity-60" />
                  <span className="text-sm font-bold whitespace-nowrap">
                    {t("bookmarkTimeMachine_month", {
                      defaultValue: `${monthData.month} ${monthData.year}`,
                    })}
                  </span>
                </div>

                <div
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${getBadgeColor(count)}`}
                >
                  <Bookmark className="size-3" />
                  {t("bookmarkTimeMachine_count", {
                    defaultValue: `${count}`,
                  })}
                </div>

                {topTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {topTags.map(({ tag }) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-full text-[10px] bg-opacity-20 ds-text-muted ds-bg-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <AnimatePresence>
                  {isSelected && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden mt-3"
                    >
                      <ul className="space-y-1.5 border-t pt-3 ds-border-muted">
                        {monthData.items.map((item) => (
                          <li
                            key={item.id}
                            className="text-xs ds-text-muted truncate hover:text-white transition-colors"
                          >
                            {item.title}
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};
