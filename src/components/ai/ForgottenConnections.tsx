import React, { useState } from "react";
import { History, RefreshCw, Sparkles, ExternalLink } from "lucide-react";
import { motion } from "motion/react";
import { initDB } from "../../container/database";
import { BookmarkView, toBookmarkView } from "../../types/bookmark";
import { useTranslation } from "react-i18next";
import { logger } from "../../utils/logger";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";

export const ForgottenConnections: React.FC<{
  onSelect: (id: string) => void;
}> = ({ onSelect }) => {
  const { t } = useTranslation();
  const [suggestion, setSuggestion] = useState<BookmarkView | null>(null);
  // Mount load + shuffle share one data-load: autoLoad runs it once on mount
  // (the original Promise.resolve().then deferral), the shuffle button calls
  // load() again, and a newer load supersedes the previous pick (the
  // original begin()-per-call semantics). A missing suggestion surfaces as
  // null via onSuccess.
  const { load, loading } = useGuardedDataLoad<BookmarkView | null>(
    async (signal) => {
      const db = await initDB();
      // Fetch some old bookmarks (older than 1 month)
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      const oldBookmarks = await db.bookmarks
        .find({
          selector: {
            createdAt: { $lt: oneMonthAgo.toISOString() },
            isDeleted: { $ne: true },
          },
          limit: 20,
        })
        .exec();

      if (signal.aborted) {return null;}
      if (oldBookmarks.length === 0) {
        return null;
      }

      // Pick a random old one
      const randomOld =
        oldBookmarks[Math.floor(Math.random() * oldBookmarks.length)];
      return toBookmarkView(randomOld);
    },
    {
      onSuccess: (suggestion) => setSuggestion(suggestion),
      onError: (err) =>
        logger.error("[ForgottenConnections] Failed to fetch", err),
    },
  );

  const findForgottenConnection = () => {
    void load();
  };

  if (!suggestion && !loading) {return null;}

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 rounded-3xl shadow-2xl relative overflow-hidden group ds-bg-inverse ds-border"
    >
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
        <History className="size-24 rotate-12 ds-text-inverse" />
      </div>

      <div className="relative z-10">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest mb-4 ds-text-muted">
          <Sparkles className="size-3 ds-text-accent" />
          <span>
            {t("app_forgottenConnection", "Serendipity: From your past")}
          </span>
        </div>

        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 rounded w-3/4 ds-bg-secondary"></div>
            <div className="h-3 rounded w-1/2 ds-bg-secondary"></div>
          </div>
        ) : suggestion ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold mb-1 transition-colors ds-text-inverse">
                {suggestion.title}
              </h3>
              <p className="text-xs line-clamp-2 ds-text-muted">
                {suggestion.url}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => onSelect(suggestion.id)}
                className="truncate flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl transition-colors ds-bg-secondary ds-text-primary"
              >
                <ExternalLink className="size-3" />
                {t("app_revisit", "Revisit")}
              </button>
              <button
                onClick={findForgottenConnection}
                className="transition-colors ds-text-muted"
                title={t("app_shuffle", "Shuffle")}
                aria-label={t("app_shuffle", "Shuffle")}
              >
                <RefreshCw className="size-4" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
};
