import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Calendar, CheckCircle2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../utils/localization";
import {
  crossPollinationService,
  type Insight,
} from "../../services/ai/CrossPollinationService";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";

export function DigestCard() {
  const { t, i18n } = useTranslation();
  const [digest, setDigest] = useState<Insight | null>(null);
  // Call-time id for the read action: onSuccess resolves asynchronously, so
  // reading `digest` there would see the LATEST digest, not the one clicked.
  const readDigestIdRef = React.useRef<string | null>(null);
  const {
    loading,
  } = useGuardedDataLoad<Insight | null>(
    async () => {
      const insights = await crossPollinationService.getPersistedInsights();
      return insights.find((i) => i.type === "suggestion") || null;
    },
    {
      onSuccess: (latest) => setDigest(latest),
    },
  );

  const {
    runWithSignal: runGenerate,
    isRunning: generating,
  } = useGuardedAction<Insight | null>({
    blockReentry: false,
    onSuccess: (result) => {
      if (result) {
        setDigest(result);
      }
    },
    // Cancellation and provider failures keep the current digest visible.
  });

  const { runWithSignal: runMarkRead } = useGuardedAction<void>({
    blockReentry: false,
    onSuccess: () => {
      const digestId = readDigestIdRef.current;
      setDigest((current) =>
        current?.id === digestId ? { ...current, isRead: true } : current,
      );
    },
    // Keep the local state unchanged when persistence fails or is stale.
  });

  const handleGenerate = () => {
    runGenerate((signal) =>
      crossPollinationService.generateWeeklyCuration(i18n.language, signal),
    );
  };

  const handleMarkRead = () => {
    if (!digest) {return;}
    readDigestIdRef.current = digest.id;
    runMarkRead((signal) =>
      crossPollinationService.markInsightAsRead(digest.id, signal),
    );
  };

  if (loading) {return null;}

  return (
    <AnimatePresence mode="wait">
      {digest ? (
        <motion.div
          key={digest.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`bento-item p-5 ${!digest.isRead ? "ring-2 ring-amber-400/50 dark:ring-amber-500/30" : ""}`}
        >
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
                <Calendar className="size-5 text-amber-500" />
              </div>
              <div>
                <h2 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white">
                  {t("app_weeklyDigest", "Weekly Digest")}
                </h2>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {formatDate(digest.createdAt, {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  }, i18n.language)}
                </p>
              </div>
            </div>
            <div className="flex gap-1">
              {!digest.isRead && (
                <button
                  onClick={handleMarkRead}
                  className="p-1.5 rounded-lg hover:bg-[var(--state-hover-bg)] text-[var(--text-muted)] hover:text-green-500 transition-all"
                  title={t("app_markAsRead", "Mark as read")}
                >
                  <CheckCircle2 className="size-4" />
                </button>
              )}
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="p-1.5 rounded-lg hover:bg-[var(--state-hover-bg)] text-[var(--text-muted)] hover:text-blue-500 transition-all disabled:opacity-50"
                title={t("app_regenerate", "Regenerate")}
              >
                <RefreshCw
                  className={`size-4 ${generating ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </div>

          <h3 className="font-bold text-base text-[var(--text-primary)] dark:text-white mb-2 leading-snug">
            {digest.title}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">
            {digest.content}
          </p>

          {!digest.isRead && (
            <div className="mt-4 flex items-center gap-2">
              <Sparkles className="size-3 text-amber-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">
                {t("app_newDigest", "New")}
              </span>
            </div>
          )}
        </motion.div>
      ) : (
        <motion.div
          key="empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bento-item p-5 flex flex-col items-center justify-center text-center py-8"
        >
          <div className="p-3 rounded-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] mb-4">
            <Calendar className="size-6 text-[var(--text-muted)]" />
          </div>
          <h2 className="font-semibold text-sm mb-1 text-[var(--text-primary)] dark:text-white">
            {t("app_noDigestYet", "No weekly digest yet")}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mb-4 max-w-[200px]">
            {t(
              "app_digestDescription",
              "Generate a summary of your week's bookmarks and documents",
            )}
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="truncate flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
          >
            {generating ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {generating
              ? t("app_generating", "Generating...")
              : t("app_generateDigest", "Generate My Digest")}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
