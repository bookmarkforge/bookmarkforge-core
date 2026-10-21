import type { BookmarkForgeDB } from "../../db/types";
import { useState } from "react";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { motion, AnimatePresence } from "motion/react";
import { Activity, ArrowRight, Calendar, TrendingUp } from "lucide-react";
import type { TFunction } from "i18next";
import { CardProps } from "./shared-props";

interface Migration {
  fromTag: string;
  toTag: string;
  count: number;
  period: string;
}

interface Props extends CardProps {
  t: TFunction;
}

export const KnowledgeMigration: React.FC<Props> = ({ cardVariants, t }) => {
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [_timeline, setTimeline] = useState<
    { period: string; tags: Record<string, number> }[]
  >([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);

  const periods = [...new Set(migrations.map((m) => m.period))];

  const filteredMigrations = selectedPeriod
    ? migrations.filter((m) => m.period === selectedPeriod)
    : migrations;

  // Mount load — useGuardedDataLoad: a late result after unmount is dropped
  // and loading resets automatically.
  const { loading } = useGuardedDataLoad<{
    migrations: Migration[];
    timeline: { period: string; tags: Record<string, number> }[];
  }>(
    async () => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      const all = await db.bookmarks
        .find({ selector: { isDeleted: false, isPrivate: false } })
        .exec();

      const byMonth: Record<string, Record<string, number>> = {};
      for (const bm of all) {
        const date = new Date(bm.createdAt);
        if (Number.isNaN(date.getTime())) {continue;}
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (!byMonth[monthKey]) {byMonth[monthKey] = {};}
        const tags = bm.tags || [];
        for (const tag of tags) {
          byMonth[monthKey][tag] = (byMonth[monthKey][tag] || 0) + 1;
        }
      }

      const sortedMonths = Object.keys(byMonth).sort();

      const results: Migration[] = [];
      for (let i = 0; i < sortedMonths.length - 1; i++) {
        const m1 = sortedMonths[i]!;
        const m2 = sortedMonths[i + 1]!;
        const tags1 = byMonth[m1] || {};
        const tags2 = byMonth[m2] || {};

        const top1 = Object.entries(tags1)
          .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
          .slice(0, 5)
          .map(([tag]) => tag);
        const top2 = Object.entries(tags2)
          .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
          .slice(0, 5)
          .map(([tag]) => tag);

        const leaving = top1.filter((t) => !top2.includes(t));
        const arriving = top2.filter((t) => !top1.includes(t));

        for (const fromTag of leaving) {
          for (const toTag of arriving) {
            results.push({
              fromTag,
              toTag,
              count: 1,
              period: `${m1} \u2192 ${m2}`,
            });
          }
        }
      }

      return {
        migrations: results,
        timeline: sortedMonths.map((period) => ({
          period,
          tags: byMonth[period] || {},
        })),
      };
    },
    {
      onSuccess: (data) => {
        setTimeline(data.timeline);
        setMigrations(data.migrations);
      },
      onError: () => setMigrations([]),
    },
  );

  if (loading) {return null;}

  return (
    <motion.div
      variants={cardVariants}
      className="bento-item p-5 ds-bg-card ds-radius-card"
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-orange-50 dark:bg-orange-900/20">
          <TrendingUp className="size-5 text-orange-500" />
        </div>
        <div>
          <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white truncate">
            {t("km_title", "Knowledge Migration")}
          </h3>
          <p className="text-[10px] text-[var(--text-muted)]">
            {t("km_subtitle", "How your interests shift over time")}
          </p>
        </div>
      </div>

      {periods.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setSelectedPeriod(null)}
            className={`truncate px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
              selectedPeriod === null
                ? "ds-bg-accent-primary/20 ds-text-accent-primary"
                : "ds-bg-card ds-border ds-text-muted hover:ds-bg-accent-primary/10"
            }`}
          >
            {t("km_all", "All")}
          </button>
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setSelectedPeriod(p)}
              className={`truncate px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
                selectedPeriod === p
                  ? "ds-bg-accent-primary/20 ds-text-accent-primary"
                  : "ds-bg-card ds-border ds-text-muted hover:ds-bg-accent-primary/10"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <AnimatePresence mode="popLayout">
        {filteredMigrations.length > 0 ? (
          <div className="space-y-3">
            {filteredMigrations.map((m, idx) => (
              <motion.div
                key={`${m.fromTag}-${m.toTag}-${m.period}-${idx}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: idx * 0.03 }}
                className="flex items-center gap-3 p-3 rounded-xl ds-bg-card ds-border"
              >
                <span
                  className="px-3 py-1 rounded-full text-[11px] font-semibold bg-orange-100 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400"
                  style={{ opacity: 0.5 }}
                >
                  {m.fromTag}
                </span>
                <ArrowRight className="rtl-flip size-4 ds-text-muted shrink-0" />
                <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                  {m.toTag}
                </span>
                <span className="ml-auto flex items-center gap-1.5 text-[10px] font-bold ds-text-muted shrink-0">
                  <Activity className="size-3" />
                  {m.count}
                </span>
                <span className="text-[9px] ds-text-muted shrink-0 flex items-center gap-1">
                  <Calendar className="size-3" />
                  {m.period}
                </span>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Activity className="size-8 ds-text-muted mb-2" />
            <p className="text-xs ds-text-muted max-w-[220px]">
              {t(
                "km_noData",
                "Not enough data yet. Save more bookmarks across different topics to see patterns.",
              )}
            </p>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
