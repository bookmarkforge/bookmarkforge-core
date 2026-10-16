import React, { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  Loader2,
  ExternalLink,
  Clock,
  Database,
  Settings,
  X,
  Zap,
  Link,
} from "lucide-react";
import { sanitizeUrl } from "../services/SanitizationService";
import {
  webSearchService,
  SearchResult,
  SearchResponse,
} from "../services/ai/WebSearchService";
import { useTranslation } from "react-i18next";
import { useGuardedAction } from "../hooks/useGuardedAction";

interface ResearchAssistantProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ResearchAssistant = ({
  isOpen,
  onClose,
}: ResearchAssistantProps) => {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState(() => webSearchService.getStats());
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const {
    run,
    isRunning: isSearching,
  } = useGuardedAction<SearchResponse>({
    onStart: () => setError(null),
    onSuccess: (result) => {
      setResponse(result);
      setStats(webSearchService.getStats());
    },
    onError: (err) => {
      setError(
        err instanceof Error
          ? err.message
          : t("app_searchFailed", "Search failed"),
      );
    },
  });

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSearch = useCallback(async () => {
    if (!query.trim() || isSearching) {
      return;
    }
    await run(async () => webSearchService.search(query));
  }, [query, isSearching, run]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  const handleClear = () => {
    setQuery("");
    setResponse(null);
    setError(null);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 ds-bg-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden">
        <div className="p-4 border-b dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Search className="size-5 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              aria-label={t("research_placeholder", "Ask anything...")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("research_placeholder", "Ask anything...")}
              className="flex-1 bg-transparent outline-none text-lg"
              disabled={isSearching}
            />
            {isSearching && (
              <Loader2 className="size-5 animate-spin text-blue-500" />
            )}
            {(query || response) && (
              <button
                onClick={handleClear}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                aria-label={t("app_clear", "Clear")}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-4 bg-[var(--danger-soft)] dark:bg-[var(--color-danger)]/20 ds-text-danger dark:ds-text-danger"
            >
              {error}
            </motion.div>
          )}

          {response && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-h-[60vh] overflow-y-auto"
            >
              <div className="p-3 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between text-sm">
                <div className="flex items gap-4">
                  {response.cached ? (
                    <span className="flex items gap-1 ds-text-success">
                      <Database className="size-4" />{" "}
                      {t("research_cached", "Cached")}
                    </span>
                  ) : (
                    <span className="flex items gap-1 text-blue-600">
                      <Zap className="size-4" /> {t("research_live", "Live")}
                    </span>
                  )}
                  <span className="text-gray-500">
                    {response.results.length} {t("research_results", "results")}
                  </span>
                  {response.tokens && (
                    <span className="text-gray-500">
                      {response.tokens} {t("research_tokens", "tokens")}
                    </span>
                  )}
                </div>
                <div className="flex items gap-2">
                  <button
                    onClick={() => setStats(webSearchService.getStats())}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                    title={t("research_stats", "Stats")}
                  >
                    <Clock className="size-4" />
                  </button>
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                    title={t("research_settings", "Settings")}
                  >
                    <Settings className="size-4" />
                  </button>
                </div>
              </div>

              {showSettings && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: "auto" }}
                  exit={{ height: 0 }}
                  className="p-3 bg-gray-100 dark:bg-gray-800 border-b dark:border-gray-700"
                >
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-gray-500">
                        {t("research_requests", "Requests:")}
                      </span>
                      <span>{stats.requestCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">
                        {t("research_tokensLabel", "Tokens:")}
                      </span>
                      <span>{stats.requestTokens}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">
                        {t("research_cacheLabel", "Cache:")}
                      </span>
                      <span>
                        {stats.cacheSize} {t("research_items", "items")}
                      </span>
                    </div>
                    <button
                      onClick={() => webSearchService.clearCache()}
                      className="truncate mt-2 w-full py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded"
                    >
                      {t("research_clearCache", "Clear Cache")}
                    </button>
                  </div>
                </motion.div>
              )}

              <div className="p-4">
                <div className="prose dark:prose-invert max-w-none">
                  {response.text.split("\n").map((line, i) => (
                    <p key={i} className="mb-2">
                      {line || <br />}
                    </p>
                  ))}
                </div>

                {response.results.length > 0 && (
                  <div className="mt-4 pt-4 border-t dark:border-gray-700">
                    <h4 className="text-sm font-medium text-gray-500 mb-2 flex items gap-2">
                      <Link className="size-4" />{" "}
                      {t("research_sources", "Sources")}
                    </h4>
                    <div className="space-y-2">
                      {response.results.map((result, i) => (
                        <ResearchResultCard key={i} result={result} index={i} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {!query && !response && !isSearching && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-8 text-center text-gray-500"
            >
              <Search className="size-12 mx-auto mb-4 opacity-30" />
              <p>
                {t("research_hint", "Type a question to start researching")}
              </p>
              <p className="text-sm mt-2">
                {t("research_features", "AI-powered search with caching")}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

interface ResearchResultCardProps {
  result: SearchResult;
  index: number;
}

const ResearchResultCard = ({ result, index }: ResearchResultCardProps) => {
  const safeUrl = sanitizeUrl(result.url);
  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
    >
      <div className="flex items-start gap-2">
        <span className="flex-shrink-0 size-6 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-full text-xs">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <h5 className="font-medium text-blue-600 dark:text-blue-400 truncate">
            {result.title}
          </h5>
          <p className="text-sm text-gray-500 truncate">{result.source}</p>
          {result.snippet && (
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mt-1">
              {result.snippet}
            </p>
          )}
        </div>
        <ExternalLink className="size-4 flex-shrink-0 text-gray-400" />
      </div>
    </a>
  );
};
