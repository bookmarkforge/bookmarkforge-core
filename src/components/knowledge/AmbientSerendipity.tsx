import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, RotateCcw, BookOpen, Stars } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { CardProps } from "./shared-props";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";

interface Props extends CardProps {
  t: TFunction;
}

interface BookmarkDoc {
  id: string;
  title?: string;
  tags?: string[];
  createdAt: string;
  lastVisitedAt?: string;
  isDeleted?: boolean;
}

export const AmbientSerendipity: React.FC<Props> = ({ cardVariants }) => {
  const { t } = useTranslation();
  const [bookmarks, setBookmarks] = useState<BookmarkDoc[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [aiContext, setAiContext] = useState("");
  const [isActive, setIsActive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contextCache = useRef<Map<string, string>>(new Map());
  const translationRef = useRef(t);
  translationRef.current = t;
  const { loading } = useGuardedDataLoad<BookmarkDoc[]>(
    async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB();
      const all: BookmarkDoc[] = (await db.bookmarks
        .find({ selector: { isDeleted: false, isPrivate: false } })
        .exec()).map(
        (d: { toJSON: () => unknown }) =>
          d.toJSON() as unknown as BookmarkDoc,
      );
      if (signal.aborted) {return [];}

      const now = Date.now();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      const fourteenDays = 14 * 24 * 60 * 60 * 1000;

      const forgotten = all.filter((b) => {
        if (b.isDeleted) {return false;}
        const createdAt = new Date(b.createdAt).getTime();
        if (now - createdAt < fourteenDays) {return false;}
        if (!b.lastVisitedAt) {return true;}
        const lastVisited = new Date(b.lastVisitedAt).getTime();
        return now - lastVisited > thirtyDays;
      });
      return forgotten;
    },
    {
      onSuccess: (forgotten) => setBookmarks(forgotten),
      onError: () => setBookmarks([]),
    },
  );

  const {
    runWithSignal,
    cancel,
  } = useGuardedAction<string>({
    // Refresh-style: each bookmark change supersedes the previous in-flight
    // generation (the original begin()-per-call semantics).
    blockReentry: false,
    onSuccess: (context) => {
      setAiContext(context);
    },
    onError: () => {
      setAiContext(
        translationRef.current(
          "ambientSerendipity_contextError",
          "Unable to generate context at this time.",
        ),
      );
    },
  });

  const generateContext = useCallback(
    (bm: BookmarkDoc) => {
      void runWithSignal(async (signal) => {
        const cached = contextCache.current.get(bm.id);
        if (cached) {
          return cached;
        }

        setAiContext("");
        const { agentService } = await import("../../services/ai/AgentService");
        const prompt = `Given this bookmark titled "${bm.title}" with tags [${(bm.tags || []).join(", ")}] saved on ${bm.createdAt?.slice(0, 10)}, explain in 1-2 sentences why it might be relevant or interesting to revisit right now. Be specific and insightful.`;
        // Stream real tokens live into the context card while generating.
        const res = await agentService.globalChat(
          prompt,
          undefined,
          false,
          undefined,
          (chunk) => {
            if (!signal.aborted) {
              setAiContext((prev) => prev + chunk);
            }
          },
          undefined,
          undefined,
          signal,
        );
        const context = res.text;
        contextCache.current.set(bm.id, context);
        return context;
      });
    },
    [runWithSignal],
  );

  useEffect(() => {
    if (isActive && bookmarks.length > 0) {
      const bm = bookmarks[currentIndex];
      if (bm) {
        generateContext(bm);
      }
    }
  }, [isActive, currentIndex, bookmarks, generateContext]);

  useEffect(() => {
    if (isActive && bookmarks.length > 1) {
      intervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % bookmarks.length);
      }, 15000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive, bookmarks.length]);

  const handleToggle = () => {
    if (isActive) {
      cancel();
      setAiContext("");
    } else if (bookmarks.length > 0) {
      setCurrentIndex(0);
    }
    setIsActive((prev) => !prev);
  };

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? bookmarks.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % bookmarks.length);
  };

  const daysAgo = (dateStr?: string) => {
    if (!dateStr) {return 0;}
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  if (loading) {return null;}

  return (
    <motion.div variants={cardVariants} className="bento-item p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
            <Stars className="size-5 text-amber-500" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white">
              {t("ambientSerendipity_title", "Ambient Serendipity")}
            </h3>
            <p className="text-[10px] text-[var(--text-muted)]">
              {t(
                "ambientSerendipity_subtitle",
                "Digital fireplace for forgotten bookmarks",
              )}
            </p>
          </div>
        </div>
        <button
          onClick={handleToggle}
          disabled={bookmarks.length === 0}
          className={`truncate flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-xl transition-all ${
            isActive
              ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
              : "bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-amber-500"
          }`}
        >
          <Sparkles className={`size-3 ${isActive ? "animate-pulse" : ""}`} />
          {isActive
            ? t("ambientSerendipity_stop", "Stop Serendipity")
            : t("ambientSerendipity_start", "Start Serendipity")}
        </button>
      </div>

      {bookmarks.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center py-6">
          <BookOpen className="size-8 text-[var(--text-muted)] mb-2" />
          <p className="text-xs text-[var(--text-muted)]">
            {t(
              "ambientSerendipity_noForgotten",
              "No forgotten bookmarks yet. Save more bookmarks and come back later.",
            )}
          </p>
        </div>
      )}

      <AnimatePresence mode="wait">
        {isActive && bookmarks.length > 0 && (
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4 }}
            className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50 to-orange-100 dark:from-amber-900/20 dark:to-orange-900/20 p-6 shadow-inner"
          >
            <div className="absolute -right-10 -top-10 size-40 bg-amber-200/30 dark:bg-amber-500/10 rounded-full blur-3xl" />
            <div className="absolute -left-10 -bottom-10 size-32 bg-orange-200/30 dark:bg-orange-500/10 rounded-full blur-3xl" />

            <div className="relative z-10">
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2 rounded-xl bg-white/60 dark:bg-white/10 shadow-sm">
                  <BookOpen className="size-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-base font-bold text-amber-900 dark:text-amber-100 truncate">
                    {bookmarks[currentIndex]?.title || ""}
                  </h4>
                  <p className="text-[10px] text-amber-600/70 dark:text-amber-400/70 mt-0.5">
                    {t(
                      "ambientSerendipity_savedDaysAgo",
                      "Saved {{count}} days ago",
                      {
                        count: daysAgo(bookmarks[currentIndex]?.createdAt),
                      },
                    )}
                  </p>
                </div>
              </div>

              {(bookmarks[currentIndex]?.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {(bookmarks[currentIndex]?.tags || []).map(
                    (tag: string, i: number) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded-full bg-white/50 dark:bg-white/10 text-amber-700 dark:text-amber-300"
                      >
                        {tag}
                      </span>
                    ),
                  )}
                </div>
              )}

              {aiContext && (
                <div className="p-3 rounded-xl bg-white/40 dark:bg-black/10 backdrop-blur-sm border border-amber-200/50 dark:border-amber-500/20">
                  <div className="flex items-start gap-2">
                    <Sparkles className="size-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                      <span className="font-semibold">
                        {t(
                          "ambientSerendipity_whyNow",
                          "Why this matters now:",
                        )}
                      </span>{" "}
                      {aiContext}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-center gap-3 mt-5">
                <button
                  onClick={handlePrevious}
                  className="p-2 rounded-xl bg-white/60 dark:bg-white/10 hover:bg-white dark:hover:bg-white/20 text-amber-700 dark:text-amber-300 transition-all shadow-sm"
                  aria-label={t("app_previous", "Previous")}
                >
                  <RotateCcw className="size-3.5" />
                </button>
                <span className="text-[10px] font-mono text-amber-600/60 dark:text-amber-400/60">
                  {currentIndex + 1} / {bookmarks.length}
                </span>
                <button
                  onClick={handleNext}
                  className="p-2 rounded-xl bg-white/60 dark:bg-white/10 hover:bg-white dark:hover:bg-white/20 text-amber-700 dark:text-amber-300 transition-all shadow-sm"
                  aria-label={t("app_next", "Next")}
                >
                  <RotateCcw className="size-3.5 rotate-180" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!isActive && bookmarks.length > 0 && (
        <div className="flex flex-col items-center justify-center text-center py-6">
          <Stars className="size-8 text-amber-300 mb-2" />
          <p className="text-xs text-[var(--text-muted)]">
            {t(
              "ambientSerendipity_idle",
              "{{count}} forgotten bookmarks waiting to be rediscovered",
              {
                count: bookmarks.length,
              },
            )}
          </p>
        </div>
      )}
    </motion.div>
  );
};
