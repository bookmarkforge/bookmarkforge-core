import type { BookmarkForgeDB } from "../../db/types";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Eye, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { logger } from "../../utils/logger";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { CardProps } from "./shared-props";

interface Props extends CardProps {
  t: TFunction;
}

interface EchoEntry {
  id: string;
  title: string;
  daysSinceVisit: number;
  daysSinceSave: number;
  echoLevel: number;
  tags: string[];
  neverVisited: boolean;
}

export const BookmarkEchoes: React.FC<Props> = ({ cardVariants }) => {
  const { t } = useTranslation();
  const [echoes, setEchoes] = useState<EchoEntry[]>([]);

  // Mount load + revive action — the guard family: a late load result after
  // unmount is dropped, and a revive superseded mid-patch is a no-op.
  const { loading } = useGuardedDataLoad<EchoEntry[]>(
    async () => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      const bookmarks = await db.bookmarks.find().exec();

      const now = Date.now();
      const entries: EchoEntry[] = [];

      for (const bm of bookmarks) {
        if (bm.isDeleted) {continue;}
        const createdAt = new Date(bm.createdAt).getTime();
        const daysSinceSave = Math.floor(
          (now - createdAt) / (1000 * 60 * 60 * 24),
        );
        let echoLevel: number;
        let daysSinceVisit: number;
        let neverVisited: boolean;

        if (!bm.lastVisitedAt) {
          neverVisited = true;
          daysSinceVisit = daysSinceSave;
          echoLevel = Math.min(1, daysSinceSave / 90);
        } else {
          neverVisited = false;
          const lastVisited = new Date(bm.lastVisitedAt).getTime();
          daysSinceVisit = Math.floor(
            (now - lastVisited) / (1000 * 60 * 60 * 24),
          );
          echoLevel = Math.min(1, daysSinceVisit / 60);
        }

        if (echoLevel > 0) {
          entries.push({
            id: bm.id,
            title: bm.title || "Untitled",
            daysSinceVisit,
            daysSinceSave,
            echoLevel,
            tags: bm.tags || [],
            neverVisited,
          });
        }
      }

      entries.sort((a, b) => b.echoLevel - a.echoLevel);
      return entries.slice(0, 10);
    },
    {
      onSuccess: setEchoes,
      onError: () => setEchoes([]),
    },
  );

  const revive = useGuardedAction<string>({
    onSuccess: (id) =>
      setEchoes((prev) => prev.filter((e) => e.id !== id)),
    onError: (err) => logger.error("[BookmarkEchoes] revive failed", err),
  });
  const handleRevive = (id: string) => {
    void revive.run(async () => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      const doc = await db.bookmarks.findOne(id).exec();
      if (doc) {
        await doc.incrementalPatch({ lastVisitedAt: new Date().toISOString() });
      }
      return id;
    });
  };

  if (loading) {return null;}

  return (
    <motion.div
      variants={cardVariants}
      className="bento-item p-5 ds-bg-card ds-radius-card"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
          <Eye className="size-5 text-indigo-400" />
        </div>
        <div>
          <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white truncate">
            {t("bookmarkEchoes_title", "Bookmark Echoes")}
          </h3>
          <p className="text-[10px] text-[var(--text-muted)]">
            {t(
              "bookmarkEchoes_subtitle",
              "Fading bookmarks waiting for attention",
            )}
          </p>
        </div>
      </div>

      {echoes.length > 0 ? (
        <>
          <p className="text-xs text-[var(--text-muted)] mb-4">
            {t(
              "bookmarkEchoes_summary",
              "{{count}} fading bookmarks \u2014 read them before they fade away!",
              { count: echoes.length },
            )}
          </p>
          <AnimatePresence>
            <div className="space-y-3">
              {echoes.map((entry, i) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: i * 0.03 }}
                  className="p-4 rounded-2xl mb-3 transition-all ds-bg-card ds-border"
                  style={{
                    opacity: 1 - entry.echoLevel * 0.6,
                    filter: `saturate(${1 - entry.echoLevel})`,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="p-1.5 rounded-lg shrink-0"
                      style={{ background: "var(--bg-secondary)" }}
                    >
                      <Eye className="size-4 text-indigo-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] dark:text-white truncate">
                        {entry.title}
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                        {entry.neverVisited
                          ? t(
                              "bookmarkEchoes_neverVisited",
                              "Never visited (saved {{count}} days ago)",
                              { count: entry.daysSinceSave },
                            )
                          : t(
                              "bookmarkEchoes_visitedAgo",
                              "Visited {{count}} days ago",
                              { count: entry.daysSinceVisit },
                            )}
                      </p>
                      {entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {entry.tags.map((tag, j) => (
                            <span
                              key={j}
                              className="px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded-full ds-bg-muted ds-text-muted"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRevive(entry.id)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-all shrink-0"
                      title={t("bookmarkEchoes_revive", "Revive")}
                    >
                      <RotateCcw className="size-3" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Eye className="size-8 text-[var(--text-muted)] mb-2" />
          <p className="text-xs text-[var(--text-muted)]">
            {t(
              "bookmarkEchoes_empty",
              "Your library is well-tended. No fading bookmarks.",
            )}
          </p>
        </div>
      )}
    </motion.div>
  );
};
