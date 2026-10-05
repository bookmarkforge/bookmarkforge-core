import { useCallback, useState } from "react";
import { Bookmark, TranslationFunction, AIManager } from "../types";
import { bookmarkAIService } from "../services/BookmarkAIService";
import { logger } from "../utils/logger";
import { useRequestGuard } from "./useRequestGuard";

/**
 * Manages all AI-powered bookmark operations:
 * - Summarize single/all bookmarks
 * - Generate detailed content for single/all
 * - Generate missing embeddings
 * - Bulk generate overviews by IDs
 * Tracks loading state and errors for each operation.
 */
export function useBookmarkAI(
  t: TranslationFunction,
  aiManager: AIManager,
  bookmarks: Bookmark[],
) {
  const [isSummarizing, setIsSummarizing] = useState<string | null>(null);
  const [isSummarizingAll, setIsSummarizingAll] = useState(false);
  const [isGeneratingAllOverviews, setIsGeneratingAllOverviews] =
    useState(false);
  const [isGeneratingEmbeddings, setIsGeneratingEmbeddings] = useState(false);
  const [isGeneratingContent, setIsGeneratingContent] = useState<string | null>(
    null,
  );
  const [isAutoTagging, setIsAutoTagging] = useState<string | null>(null);
  const [isCleaningContent, setIsCleaningContent] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // Deliberately stays on the manual guard (not useGuardedAction/
  // useGuardedActions): the loading flags are per-id strings (which bookmark
  // is summarizing), the batch flows report mid-flight progress via
  // isCurrent-gated callbacks, and handleBulkGenerateOverviews RE-THROWS the
  // error for the caller to handle — none of which map to the helper's
  // boolean isRunning + swallowed errors contract.
  const { begin, isCurrent, cancel } = useRequestGuard();

  // Stable handlers for the memoized BookmarksTable rows: only
  // depend on t/aiManager/begin/isCurrent (stable) or on bookmarks
  // (the bulk ones, which do not reach the rows).
  const handleSummarize = useCallback(async (bookmark: Bookmark) => {
    const request = begin();
    setIsSummarizing(bookmark.id);
    setError(null);
    try {
      await bookmarkAIService.summarize(
        bookmark,
        t,
        aiManager,
        request.signal,
      );
    } catch (error: unknown) {
      if (isCurrent(request.generation)) {
        logger.error("Error summarizing", { error });
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (isCurrent(request.generation)) {
        setIsSummarizing(null);
      }
    }
  }, [t, aiManager, begin, isCurrent]);

  const handleGenerateDetailedContent = useCallback(
    async (bookmark: Bookmark) => {
      const request = begin();
      setIsGeneratingContent(bookmark.id);
      setError(null);
      try {
        await bookmarkAIService.generateDetailedContent(
          bookmark,
          t,
          aiManager,
          request.signal,
        );
      } catch (error: unknown) {
        if (isCurrent(request.generation)) {
          logger.error("Error generating detailed content", { error });
          setError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (isCurrent(request.generation)) {
          setIsGeneratingContent(null);
        }
      }
    },
    [t, aiManager, begin, isCurrent],
  );

  const handleSummarizeAll = useCallback(async () => {
    const request = begin();
    setIsSummarizingAll(true);
    setError(null);
    try {
      await bookmarkAIService.batchSummarize(bookmarks, t, aiManager, (id) => {
        if (isCurrent(request.generation)) {
          setIsSummarizing(id);
        }
      }, request.signal);
    } catch (error: unknown) {
      if (isCurrent(request.generation)) {
        logger.error("Error summarizing all bookmarks", { error });
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (isCurrent(request.generation)) {
        setIsSummarizingAll(false);
        setIsSummarizing(null);
      }
    }
  }, [t, aiManager, bookmarks, begin, isCurrent]);

  const handleGenerateAllOverviews = useCallback(async () => {
    const request = begin();
    setIsGeneratingAllOverviews(true);
    setError(null);
    try {
      await bookmarkAIService.batchGenerateOverviews(
        bookmarks,
        t,
        aiManager,
        (id) => {
          if (isCurrent(request.generation)) {
            setIsGeneratingContent(id);
          }
        },
        request.signal,
      );
    } catch (error: unknown) {
      if (isCurrent(request.generation)) {
        logger.error("Error generating all overviews", { error });
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (isCurrent(request.generation)) {
        setIsGeneratingAllOverviews(false);
        setIsGeneratingContent(null);
      }
    }
  }, [t, aiManager, bookmarks, begin, isCurrent]);

  const handleGenerateMissingEmbeddings = useCallback(async () => {
    const request = begin();
    setIsGeneratingEmbeddings(true);
    setError(null);
    try {
      await bookmarkAIService.generateMissingEmbeddings(
        bookmarks,
        () => {},
        request.signal,
      );
    } catch (error: unknown) {
      if (isCurrent(request.generation)) {
        logger.error("Error generating missing embeddings", { error });
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (isCurrent(request.generation)) {
        setIsGeneratingEmbeddings(false);
      }
    }
  }, [bookmarks, begin, isCurrent]);

  const handleBulkGenerateOverviews = useCallback(
    async (ids: Set<string>) => {
      const request = begin();
      setIsGeneratingAllOverviews(true);
      setError(null);
      try {
        await bookmarkAIService.batchGenerateOverviewsByIds(
          ids,
          t,
          aiManager,
          request.signal,
        );
      } catch (error: unknown) {
        if (isCurrent(request.generation)) {
          logger.error("Error generating overviews by ID", { error });
          setError(error instanceof Error ? error.message : String(error));
        }
        throw error;
      } finally {
        if (isCurrent(request.generation)) {
          setIsGeneratingAllOverviews(false);
        }
      }
    },
    [t, aiManager, begin, isCurrent],
  );

  return {
    isSummarizing,
    setIsSummarizing,
    isSummarizingAll,
    setIsSummarizingAll,
    isGeneratingAllOverviews,
    setIsGeneratingAllOverviews,
    isGeneratingEmbeddings,
    setIsGeneratingEmbeddings,
    isGeneratingContent,
    setIsGeneratingContent,
    isAutoTagging,
    setIsAutoTagging,
    isCleaningContent,
    setIsCleaningContent,
    error,
    setError,
    cancel,
    handleSummarize,
    handleGenerateDetailedContent,
    handleSummarizeAll,
    handleGenerateAllOverviews,
    handleGenerateMissingEmbeddings,
    handleBulkGenerateOverviews,
  };
}
