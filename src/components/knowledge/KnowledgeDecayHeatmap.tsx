import type { BookmarkForgeDB } from "../../db/types";
import { useState } from "react";
import { Calendar, Zap, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import type { TFunction } from "i18next";
import { logger } from "../../utils/logger";
import { CardProps } from "./shared-props";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";

interface DecayEntry {
  tag: string;
  score: number;
  lastRead: string;
  count: number;
}

interface Props extends CardProps {
  t: TFunction;
}

export const KnowledgeDecayHeatmap: React.FC<Props> = ({ cardVariants, t }) => {
  const [decayData, setDecayData] = useState<DecayEntry[]>([]);

  const {
    load: loadDecayData,
    loading,
  } = useGuardedDataLoad(
    async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      const bookmarks = await db.bookmarks.find().exec();
      if (signal.aborted) {return [];}
      const tagMap = new Map<string, { lastRead: number; count: number }>();
      const now = Date.now();

      for (const bm of bookmarks) {
        const doc = bm.toMutableJSON();
        const tags = doc.tags ?? [];
        const lastRead = doc.lastVisitedAt || doc.createdAt;
        const lastReadTime = lastRead ? new Date(lastRead).getTime() : now;

        for (const tag of tags) {
          const existing = tagMap.get(tag);
          if (!existing) {
            tagMap.set(tag, { lastRead: lastReadTime, count: 1 });
          } else {
            existing.count += 1;
            if (lastReadTime > existing.lastRead) {
              existing.lastRead = lastReadTime;
            }
          }
        }
      }

      const data: DecayEntry[] = [];
      for (const [tag, info] of tagMap) {
        const daysSince = (now - info.lastRead) / 86400000;
        const score = Math.min(1, daysSince / 30);
        data.push({
          tag,
          score,
          lastRead: new Date(info.lastRead).toISOString(),
          count: info.count,
        });
      }

      data.sort((a, b) => b.score - a.score);
      return data;
    },
    {
      onSuccess: (data) => setDecayData(data),
      onError: (err) => logger.error("Failed to load decay data", err),
    },
  );

  const { run: runReset } = useGuardedAction<void>({
    onError: (err) => logger.error("Failed to reset decay", err),
  });

  const handleReset = (tag: string) =>
    runReset(async () => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      const bookmarks = await db.bookmarks.find().exec();
      const now = new Date().toISOString();
      const patches = bookmarks
        .filter((bm: { toMutableJSON(): { tags?: string[] } }) => (bm.toMutableJSON().tags ?? []).includes(tag))
        .map((bm: { incrementalPatch(data: Record<string, unknown>): Promise<unknown> }) => bm.incrementalPatch({ lastVisitedAt: now }));
      await Promise.all(patches);
      await loadDecayData();
    });

  const daysAgo = (dateStr: string) =>
    Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000);

  if (loading) {return null;}

  return (
    <motion.div
      variants={cardVariants}
      className="p-2 md:p-3 rounded-[3rem] shadow-sm ds-card"
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg ds-bg-warning-soft">
          <Zap className="size-5 ds-text-warning" />
        </div>
        <h2 className="ds-h2 truncate">{t("app_knowledgeDecay", "Knowledge Decay")}</h2>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {decayData.map((entry) => {
          const days = daysAgo(entry.lastRead);
          return (
            <div key={entry.tag} className="flex flex-col items-center gap-1">
              <div
                className="w-full aspect-square rounded-xl transition-transform hover:scale-110 relative group"
                style={{
                  backgroundColor: `hsl(${120 - entry.score * 120}, 70%, 50%)`,
                }}
                title={t("app_lastReadDaysAgo", {
                  count: days,
                  defaultValue: `Last read: ${days} days ago`,
                })}
              >
                <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/10 transition-colors" />
              </div>
              <div className="flex items-center gap-1 max-w-full">
                <span className="text-[10px] font-semibold truncate ds-text-secondary">
                  {entry.tag}
                </span>
                <button
                  onClick={() => handleReset(entry.tag)}
                  className="size-4 rounded flex items-center justify-center hover:ds-bg-muted transition-colors shrink-0"
                  title={t("app_resetDecay", "Reset")}
                >
                  <RotateCcw className="size-3 ds-text-muted" />
                </button>
              </div>
              <span className="text-[9px] tabular-nums ds-text-muted">
                {entry.count}
              </span>
            </div>
          );
        })}
      </div>

      {decayData.length > 0 && (
        <div className="mt-6 flex items-center justify-between gap-4 border-t ds-border pt-4">
          <div className="flex items-center gap-2">
            <Calendar className="size-4 ds-text-muted" />
            <span className="text-[10px] font-semibold uppercase tracking-widest ds-text-muted">
              {t("app_decayLegend", "Lower = Fresher")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <div
                key={v}
                className="size-4 rounded"
                style={{
                  backgroundColor: `hsl(${120 - v * 120}, 70%, 50%)`,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};
