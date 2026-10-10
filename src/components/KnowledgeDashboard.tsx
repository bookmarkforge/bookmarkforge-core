import { useState, useEffect, lazy, Suspense } from "react";
import { initDB } from "../container/database";
import { Activity, Bookmark, Tag, Brain, FileText, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../utils/localization";
import { useTheme } from "../contexts/ThemeContext";
import { motion, type Variants } from "motion/react";
import { EASE_OUT, DURATION_MENU } from "../constants/motion";
import { SystemIntegrity } from "./analytics/SystemIntegrity";
import type { BookmarkDocType, DocumentDocType } from "../db/schema";
import type { DashboardStats } from "./knowledge/types";
const ActivityChartSection = lazy(() =>
  import("./knowledge/ActivityChartSection").then((m) => ({ default: m.ActivityChartSection })),
);
const TagDistributionCard = lazy(() =>
  import("./knowledge/TagDistributionCard").then((m) => ({ default: m.TagDistributionCard })),
);
const AIInsightsCard = lazy(() =>
  import("./knowledge/AIInsightsCard").then((m) => ({ default: m.AIInsightsCard })),
);
const QuickActionCard = lazy(() =>
  import("./knowledge/QuickActionCard").then((m) => ({ default: m.QuickActionCard })),
);
const DigestCard = lazy(() =>
  import("./knowledge/DigestCard").then((m) => ({ default: m.DigestCard })),
);
const ReadingPathsCard = lazy(() =>
  import("./knowledge/ReadingPathsCard").then((m) => ({ default: m.ReadingPathsCard })),
);
const KnowledgeDecayHeatmap = lazy(() =>
  import("./knowledge/KnowledgeDecayHeatmap").then((m) => ({ default: m.KnowledgeDecayHeatmap })),
);
const BlindspotDetection = lazy(() =>
  import("./knowledge/BlindspotDetection").then((m) => ({ default: m.BlindspotDetection })),
);
const BookmarkPersonality = lazy(() =>
  import("./knowledge/BookmarkPersonality").then((m) => ({ default: m.BookmarkPersonality })),
);
const BookmarkFusion = lazy(() =>
  import("./knowledge/BookmarkFusion").then((m) => ({ default: m.BookmarkFusion })),
);
const CrossLanguageBridge = lazy(() =>
  import("./knowledge/CrossLanguageBridge").then((m) => ({ default: m.CrossLanguageBridge })),
);
const EphemeralBookmarks = lazy(() =>
  import("./knowledge/EphemeralBookmarks").then((m) => ({ default: m.EphemeralBookmarks })),
);
const BookmarkTimeMachine = lazy(() =>
  import("./knowledge/BookmarkTimeMachine").then((m) => ({ default: m.BookmarkTimeMachine })),
);
const BookmarkAntonyms = lazy(() =>
  import("./knowledge/BookmarkAntonyms").then((m) => ({ default: m.BookmarkAntonyms })),
);
const ReadingStreaksDebt = lazy(() =>
  import("./knowledge/ReadingStreaksDebt").then((m) => ({ default: m.ReadingStreaksDebt })),
);
const AmbientSerendipity = lazy(() =>
  import("./knowledge/AmbientSerendipity").then((m) => ({ default: m.AmbientSerendipity })),
);
const BookmarkCoverSongs = lazy(() =>
  import("./knowledge/BookmarkCoverSongs").then((m) => ({ default: m.BookmarkCoverSongs })),
);
const KnowledgeAvatars = lazy(() =>
  import("./knowledge/KnowledgeAvatars").then((m) => ({ default: m.KnowledgeAvatars })),
);
const BookmarkNostalgia = lazy(() =>
  import("./knowledge/BookmarkNostalgia").then((m) => ({ default: m.BookmarkNostalgia })),
);
import { KnowledgeFengShui } from "./knowledge/KnowledgeFengShui";
import { BookmarkEchoes } from "./knowledge/BookmarkEchoes";
import { KnowledgeMigration } from "./knowledge/KnowledgeMigration";
import { AISommelier } from "./knowledge/AISommelier";
import { KnowledgeAudit } from "./knowledge/KnowledgeAudit";
import { MeetingPrepMode } from "./knowledge/MeetingPrepMode";
import { QuizGenerator } from "./knowledge/QuizGenerator";
import { KnowledgeBasePublisher } from "./knowledge/KnowledgeBasePublisher";
import { autoProcessorService } from "../services/ai/AutoProcessorService";
import { DependencyMap } from "./knowledge/DependencyMap";
import { logger } from "../utils/logger";
import { toast } from "sonner";
import { RouteErrorBoundary } from "./errors/RouteErrorBoundary";
import { useGuardedAction } from "../hooks/useGuardedAction";

const KnowledgeDashboard = () => {
  const { t, i18n } = useTranslation();
  const { isDark } = useTheme();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [bookmarkTitles, setBookmarkTitles] = useState<string[]>([]);
  const [, setHasReceivedData] = useState(false);
  // blockReentry (default true): an in-flight reindex ignores new clicks.
  const { run: runReindex, isRunning: isReindexing } = useGuardedAction<number>({
    onSuccess: () => toast.success(t("app_reprocessStarted")),
    onError: (error) => {
      logger.error("[KnowledgeDashboard] Re-indexing failed", { error });
      toast.error(t("app_reprocessError", "Re-indexing failed"));
    },
  });

  const handleForceReindex = () => {
    void runReindex(() => autoProcessorService.forceReprocessAll());
  };

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    // initDB() is async: if it resolves after the effect was torn down, the
    // late code must not create subscriptions (a leak) nor set state on a
    // component that is gone.
    let cancelled = false;
    let subDocs: { unsubscribe: () => void } | null = null;
    let subBookmarks: { unsubscribe: () => void } | null = null;

    const setup = async () => {
      try {
        const db = await initDB();
        if (cancelled) {return;}

        const updateStats = (
          docs: DocumentDocType[],
          bookmarks: BookmarkDocType[],
        ) => {
          if (cancelled) {return;}
          const activeDocs = docs.filter((item) => !item.isDeleted);
          const activeBookmarks = bookmarks.filter((item) => !item.isDeleted);
          // Titles feed cloud-capable knowledge cards; never include private
          // bookmark metadata in that prompt surface.
          setBookmarkTitles(
            activeBookmarks.filter((bookmark) => bookmark.isPrivate === false).map((b) => b.title),
          );
          const allTags: { [key: string]: number } = {};
          const activityData: { [key: string]: { label: string; count: number } } = {};

          [...activeDocs, ...activeBookmarks].forEach((item) => {
            (item.tags || []).forEach((tag: string) => {
              allTags[tag] = (allTags[tag] || 0) + 1;
            });
            const dateValue = new Date(item.createdAt);
            if (Number.isNaN(dateValue.getTime())) {return;}
            // Keep the ISO day as the aggregation key. Display labels are
            // localized separately; sorting localized labels as dates can
            // produce Invalid Date and reorder the chart unpredictably.
            const dayKey = dateValue.toISOString().slice(0, 10);
            activityData[dayKey] = {
              label: formatDate(dateValue, {
                month: "short",
                day: "numeric",
              }, i18n.language),
              count: (activityData[dayKey]?.count ?? 0) + 1,
            };
          });

          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
          const bookmarksThisWeekCount = activeBookmarks.filter(
            (b) => new Date(b.createdAt) > oneWeekAgo,
          ).length;

          const tagChartData = Object.entries(allTags)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5);

          const activityChartData = Object.entries(activityData)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-14)
            .map(([, value]) => ({ date: value.label, count: value.count }));

          const mostRead = activeBookmarks
            .filter((b: BookmarkDocType) => (b.visitCount || 0) > 0)
            .sort(
              (a: BookmarkDocType, b: BookmarkDocType) =>
                (b.visitCount || 0) - (a.visitCount || 0),
            )
            .slice(0, 5)
            .map((b: BookmarkDocType) => ({
              id: b.id,
              title: b.title,
              visitCount: b.visitCount || 0,
            }));

          setHasReceivedData(true);
          setStats({
            totalDocs: activeDocs.length,
            totalBookmarks: activeBookmarks.length,
            totalTags: Object.keys(allTags).length,
            missingEmbeddings: activeDocs.filter(
              (d) => !d.embedding || d.embedding.length === 0,
            ).length,
            missingSummaries: activeBookmarks.filter((b) => !b.summary).length,
            tagChartData,
            activityChartData,
            topTags: tagChartData.slice(0, 5).map((t) => t.name),
            healthScore: Math.min(
              100,
              Math.floor(((activeDocs.length + activeBookmarks.length) / 50) * 100) || 0,
            ),
            bookmarksThisWeek: bookmarksThisWeekCount,
            mostRead,
          });
          setLoading(false);
        };

        const docs$ = db.documents.find().$;
        const bookmarks$ = db.bookmarks.find().$;

        let currentDocs: DocumentDocType[] = [];
        let currentBookmarks: BookmarkDocType[] = [];

        subDocs = docs$.subscribe((docs: DocumentDocType[]) => {
          currentDocs = docs;
          updateStats(currentDocs, currentBookmarks);
        });

        subBookmarks = bookmarks$.subscribe((bookmarks: BookmarkDocType[]) => {
          currentBookmarks = bookmarks;
          updateStats(currentDocs, currentBookmarks);
        });
      } catch (err) {
        if (cancelled) {return;}
        logger.warn("Dashboard setup error", err);
        setLoading(false);
        setLoadError(true);
      }
    };

    setup();

    return () => {
      cancelled = true;
      subDocs?.unsubscribe();
      subBookmarks?.unsubscribe();
    };
  }, [i18n.language, reloadToken]);

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };

  const cardVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: DURATION_MENU, ease: EASE_OUT },
    },
  };

  if (loadError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center h-[calc(100vh-200px)] gap-4 text-center"
      >
        <p className="font-semibold ds-text-primary">
          {t("app_errorOccurred", "Unable to load analytics right now.")}
        </p>
        <button
          type="button"
          onClick={() => setReloadToken((token) => token + 1)}
          className="truncate px-4 py-2 text-sm font-semibold btn-primary"
        >
          {t("app_retry", "Retry")}
        </button>
      </div>
    );
  }

  if (loading || !stats) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center h-[calc(100vh-200px)] gap-4"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="size-12 border-4 border-t-transparent rounded-full ds-border-accent-primary ds-border-t-transparent"
        />
        <p className="font-semibold uppercase tracking-widest text-xs animate-pulse ds-text-muted">
          {t("app_analyzingBrain")}
        </p>
      </div>
    );
  }

  const statConfig = [
    {
      label: t("app_totalDocs"),
      value: stats.totalDocs,
      icon: FileText,
      color: "var(--accent-primary)",
      bg: "var(--accent-soft)",
    },
    {
      label: t("app_totalBookmarks"),
      value: stats.totalBookmarks,
      icon: Bookmark,
      color: "var(--accent-primary)",
      bg: "var(--accent-soft)",
    },
    {
      label: t("app_totalTags"),
      value: stats.totalTags,
      icon: Tag,
      color: "var(--accent-primary)",
      bg: "var(--accent-soft)",
    },
    {
      label: t("app_knowledgeIntegrity"),
      value: `${stats.healthScore}%`,
      icon: Brain,
      color: "var(--accent-primary)",
      bg: "var(--accent-soft)",
    },
  ];

  return (
    <RouteErrorBoundary
      fallback={
        <div className="p-8 text-center">
          <p className="text-sm ds-text-muted">Knowledge Dashboard encountered an error.</p>
        </div>
      }
    >
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="px-2 py-4 space-y-6 mx-auto w-full max-w-[100%]"
    >
      {/* Premium Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="ds-h1 mb-2">{t("app_analytics")}</h1>
          <p className="font-bold text-lg ds-text-secondary">
            {t("app_analyticsSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3 px-6 py-3 ds-radius-card ds-bg-card ds-border">
          <Activity className="size-5 ds-text-success" />
          <span className="text-xs font-semibold uppercase tracking-wider whitespace-nowrap ds-text-primary">
            {t("app_analysisEngineActive")}
          </span>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        {statConfig.map((item, i) => {
          const IconCmp = item.icon;
          return (
            <motion.div
              key={i}
              variants={cardVariants}
              className="p-2 md:p-3 shadow-sm hover:shadow-2xl transition-all group relative overflow-hidden ds-radius-card ds-bg-card ds-border-inactive"
            >
              <div
                className="absolute -right-4 -top-4 size-32 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700"
                style={{ background: item.bg }}
              />
              <div className="relative z-10 flex items-center justify-between">
                <div className="p-4 group-hover:scale-110 transition-transform duration-500 shadow-sm ds-radius-widget ds-bg-accent-soft ds-text-accent">
                  <IconCmp className="size-6" />
                </div>
                <span className="text-4xl font-semibold tracking-tighter tabular-nums ds-text-primary">
                  {item.value}
                </span>
              </div>
              <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors whitespace-nowrap ds-text-muted">
                {item.label}
              </p>
            </motion.div>
          );
        })}
      </div>

      {stats.mostRead.length > 0 && (
        <motion.div variants={cardVariants} className="grid grid-cols-1 gap-8">
          <div className="bento-item p-5">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 rounded-lg bg-violet-50 dark:bg-violet-900/20">
                <Eye className="size-5 text-violet-500" />
              </div>
              <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white">
                {t("app_mostRead", "Most Read")}
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {stats.mostRead.map((item, i) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]"
                >
                  <span className="text-[10px] font-bold text-[var(--text-muted)] w-4">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-xs font-medium truncate text-[var(--text-primary)] dark:text-white">
                    {item.title}
                  </span>
                  <span className="text-[10px] font-bold text-violet-500">
                    {item.visitCount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      <Suspense fallback={null}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <DigestCard />
        <ReadingPathsCard cardVariants={cardVariants} t={t} />
        <BookmarkTimeMachine cardVariants={cardVariants} t={t} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <KnowledgeDecayHeatmap cardVariants={cardVariants} t={t} />
        <EphemeralBookmarks cardVariants={cardVariants} t={t} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <CrossLanguageBridge cardVariants={cardVariants} t={t} />
        <BlindspotDetection
          bookmarkTitles={bookmarkTitles}
          cardVariants={cardVariants}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <BookmarkPersonality
          bookmarkTitles={bookmarkTitles}
          cardVariants={cardVariants}
        />
        <BookmarkFusion cardVariants={cardVariants} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <BookmarkCoverSongs cardVariants={cardVariants} t={t} />
        <BookmarkAntonyms cardVariants={cardVariants} t={t} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <KnowledgeAvatars cardVariants={cardVariants} t={t} />
        <BookmarkNostalgia cardVariants={cardVariants} t={t} />
        <KnowledgeFengShui cardVariants={cardVariants} t={t} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <KnowledgeMigration cardVariants={cardVariants} t={t} />
        <AISommelier cardVariants={cardVariants} t={t} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <KnowledgeAudit cardVariants={cardVariants} t={t} />
        <DependencyMap cardVariants={cardVariants} t={t} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <MeetingPrepMode cardVariants={cardVariants} t={t} />
        <QuizGenerator cardVariants={cardVariants} />
        <KnowledgeBasePublisher cardVariants={cardVariants} t={t} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <BookmarkEchoes cardVariants={cardVariants} t={t} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <ReadingStreaksDebt cardVariants={cardVariants} t={t} />
        <AmbientSerendipity cardVariants={cardVariants} t={t} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <ActivityChartSection
          data={stats.activityChartData}
          isDark={isDark}
          cardVariants={cardVariants}
          t={t}
        />
        <TagDistributionCard
          data={stats.tagChartData}
          totalTags={stats.totalTags}
          cardVariants={cardVariants}
          t={t}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <AIInsightsCard
          topTags={stats.topTags}
          bookmarksThisWeek={stats.bookmarksThisWeek}
          cardVariants={cardVariants}
          t={t}
        />
        <QuickActionCard
          cardVariants={cardVariants}
          t={t}
          onForceReindex={handleForceReindex}
          isReindexing={isReindexing}
        />
      </div>

      </Suspense>

      <motion.div variants={cardVariants} className="pt-6">
        <SystemIntegrity />
      </motion.div>
    </motion.div>
    </RouteErrorBoundary>
  );
};

export default KnowledgeDashboard;
