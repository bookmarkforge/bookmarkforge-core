import { useState, useCallback, useRef } from "react";
import { Bookmark } from "../../types";
import { initDB } from "../../container/database";
import { aiManager } from "../../services/ai/ProviderManager";
import { taggingService } from "../../services/ai/TaggingService";
import { ragEngine } from "../../services/ai/RAGEngine";
import { bookmarkAIService } from "../../services/BookmarkAIService";
import { SanitizationService } from "../../services/SanitizationService";
import { useTranslation } from "react-i18next";
import { logger } from "../../utils/logger";
import { useGuardedAction } from "../../hooks/useGuardedAction";

interface UseBookmarkBulkActionsProps {
  bookmarks: Bookmark[];
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

interface UseBookmarkBulkActionsReturn {
  isBulkTagging: boolean;
  isCleaningContent: boolean;
  isSummarizingCollection: boolean;
  isGeneratingAllOverviews: boolean;
  isGeneratingEmbeddings: boolean;
  bulkTagInput: string;
  setBulkTagInput: React.Dispatch<React.SetStateAction<string>>;
  handleBulkSummarize: () => Promise<void>;
  handleBulkAutoTag: () => Promise<void>;
  handleBulkAddTag: () => Promise<void>;
  handleBulkRemoveTag: () => Promise<void>;
  handleBulkClearTags: () => Promise<void>;
  handleBulkDelete: () => Promise<void>;
  handleBulkGenerateOverviews: () => Promise<void>;
  handleBulkGenerateEmbeddings: () => Promise<void>;
  handleBulkCleanContent: () => Promise<void>;
}

export function useBookmarkBulkActions({
  bookmarks,
  selectedIds,
  setSelectedIds,
  setError,
}: UseBookmarkBulkActionsProps): UseBookmarkBulkActionsReturn {
  const { t } = useTranslation();
  const [isBulkTagging, setIsBulkTagging] = useState(false);
  const [isCleaningContent, setIsCleaningContent] = useState(false);
  const [isSummarizingCollection, setIsSummarizingCollection] = useState(false);
  const [isGeneratingEmbeddings, setIsGeneratingEmbeddings] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState("");
  const bulkMutationRef = useRef(false);
  // Only the overview batch uses a guard (long-running + cancellable); the
  // other bulk flows are plain sequential DB loops without UI cancellation.
  const {
    runWithSignal: runGenerateOverviews,
    isRunning: isGeneratingAllOverviews,
  } = useGuardedAction<void>({
    onError: (error) =>
      logger.error("Bulk generate overviews failed", { error }),
  });

  const handleBulkSummarize = useCallback(async () => {
    if (selectedIds.size === 0 || bulkMutationRef.current) {return;}
    bulkMutationRef.current = true;
    setIsSummarizingCollection(true);
    setError(null);
    try {
      const selectedBookmarks = bookmarks.filter((b) => selectedIds.has(b.id));
      const combinedText = selectedBookmarks
        .map(
          (b) =>
            `Title: ${b.title}\nSummary: ${b.summary}\nContent: ${b.content || ""}`,
        )
        .join("\n---\n");

      const response = await aiManager.generateText(
        t("app_bulkSummarizePrompt", { content: combinedText }),
        undefined,
        {
          isPrivate: selectedBookmarks.some(
            (bookmark) => bookmark.isPrivate !== false,
          ),
        },
      );
      // Keep the result visible instead of silently logging it. A synthesis is
      // not a bookmark field, so show it as a toast that users can copy.
      const { toast } = await import("sonner");
      toast.success(t("app_summaryAdded"), {
        description: response.text.slice(0, 2_000),
        duration: 10_000,
      });
    } catch (err: unknown) {
      logger.error("Bulk summarize failed", { error: err });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSummarizingCollection(false);
      bulkMutationRef.current = false;
    }
  }, [selectedIds, bookmarks, t, setError]);

  const handleBulkAutoTag = useCallback(async () => {
    if (selectedIds.size === 0 || isBulkTagging || bulkMutationRef.current) {return;}
    bulkMutationRef.current = true;
    setIsBulkTagging(true);
    try {
      const db = await initDB();
      const selectedBookmarks = bookmarks.filter((b) => selectedIds.has(b.id));

      for (const b of selectedBookmarks) {
        const textToAnalyze = `${b.title} ${b.summary || ""} ${b.content || ""}`;
        const tags = await taggingService.suggestTags(
          textToAnalyze,
          "en",
          b.title,
          b.tags || [],
          b.isPrivate !== false,
        );
        if (tags.length > 0) {
          const currentTags = b.tags || [];
          const newTags = Array.from(new Set([...currentTags, ...tags]));
          const doc = await db.bookmarks.findOne(b.id).exec();
          if (doc) {
            await doc.incrementalPatch({ tags: newTags });
          }
        }
      }
    } catch (error) {
      logger.error("Bulk auto-tag failed", { error });
    } finally {
      setIsBulkTagging(false);
      bulkMutationRef.current = false;
    }
  }, [selectedIds, bookmarks, isBulkTagging]);

  const handleBulkAddTag = useCallback(async () => {
    if (selectedIds.size === 0 || !bulkTagInput.trim() || bulkMutationRef.current) {return;}
    bulkMutationRef.current = true;
    try {
      const db = await initDB();
      for (const id of selectedIds) {
        const doc = await db.bookmarks.findOne(id).exec();
        if (doc) {
          const currentTags = doc.tags || [];
          const newTags = Array.from(
            new Set([...currentTags, bulkTagInput.trim()]),
          );
          await doc.incrementalPatch({ tags: newTags });
        }
      }
      setBulkTagInput("");
    } catch (error) {
      logger.error("Bulk add tag failed", { error });
    } finally {
      bulkMutationRef.current = false;
    }
  }, [selectedIds, bulkTagInput]);

  const handleBulkRemoveTag = useCallback(async () => {
    if (selectedIds.size === 0 || !bulkTagInput.trim() || bulkMutationRef.current) {return;}
    bulkMutationRef.current = true;
    try {
      const db = await initDB();
      for (const id of selectedIds) {
        const doc = await db.bookmarks.findOne(id).exec();
        if (doc) {
          const currentTags = doc.tags || [];
          const newTags = currentTags.filter(
            (t: string) => t !== bulkTagInput.trim(),
          );
          await doc.incrementalPatch({ tags: newTags });
        }
      }
      setBulkTagInput("");
    } catch (error) {
      logger.error("Bulk remove tag failed", { error });
    } finally {
      bulkMutationRef.current = false;
    }
  }, [selectedIds, bulkTagInput]);

  const handleBulkClearTags = useCallback(async () => {
    if (selectedIds.size === 0 || bulkMutationRef.current) {return;}
    bulkMutationRef.current = true;
    try {
      const db = await initDB();
      for (const id of selectedIds) {
        const doc = await db.bookmarks.findOne(id).exec();
        if (doc) {
          await doc.incrementalPatch({ tags: [] });
        }
      }
    } catch (error) {
      logger.error("Bulk clear tags failed", { error });
    } finally {
      bulkMutationRef.current = false;
    }
  }, [selectedIds]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0 || bulkMutationRef.current) {return;}
    bulkMutationRef.current = true;
    try {
      const db = await initDB();
      for (const id of selectedIds) {
        const doc = await db.bookmarks.findOne(id).exec();
        if (doc) {
          await doc.incrementalPatch({
            isDeleted: true,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      setSelectedIds(new Set());
    } catch (error) {
      logger.error("Bulk delete failed", { error });
    } finally {
      bulkMutationRef.current = false;
    }
  }, [selectedIds, setSelectedIds]);

  const handleBulkGenerateOverviews = useCallback(async () => {
    if (selectedIds.size === 0 || bulkMutationRef.current) {return;}
    bulkMutationRef.current = true;
    try {
      await runGenerateOverviews(async (signal) => {
      await bookmarkAIService.batchGenerateOverviewsByIds(
        selectedIds,
        t as unknown as (key: string) => string,
        aiManager,
        signal,
        );
      });
    } finally {
      bulkMutationRef.current = false;
    }
  }, [runGenerateOverviews, selectedIds, t]);

  const handleBulkGenerateEmbeddings = useCallback(async () => {
    if (selectedIds.size === 0 || bulkMutationRef.current) {return;}
    bulkMutationRef.current = true;
    setIsGeneratingEmbeddings(true);
    try {
      const selectedBookmarks = bookmarks.filter((b) => selectedIds.has(b.id));
      const db = await initDB();
      for (const bookmark of selectedBookmarks) {
        if (!bookmark.embedding || bookmark.embedding.length === 0) {
          const embedding = await ragEngine.generateEmbedding(
            bookmark.content || bookmark.title || "",
          );
          const doc = await db.bookmarks.findOne(bookmark.id).exec();
          if (doc) {
            await doc.incrementalPatch({
              embedding,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (error) {
      logger.error("Bulk generate embeddings failed", { error });
    } finally {
      setIsGeneratingEmbeddings(false);
      bulkMutationRef.current = false;
    }
  }, [selectedIds, bookmarks]);

  const handleBulkCleanContent = useCallback(async () => {
    if (selectedIds.size === 0 || bulkMutationRef.current) {return;}
    bulkMutationRef.current = true;
    setIsCleaningContent(true);
    try {
      const db = await initDB();
      for (const id of selectedIds) {
        const doc = await db.bookmarks.findOne(id).exec();
        if (doc && doc.content) {
          const cleaned = SanitizationService.sanitizeHtml(doc.content);
          if (cleaned !== doc.content) {
            await doc.incrementalPatch({ content: cleaned });
          }
        }
      }
    } catch (error) {
      logger.error("Bulk clean content failed", { error });
    } finally {
      setIsCleaningContent(false);
      bulkMutationRef.current = false;
    }
  }, [selectedIds]);

  return {
    isBulkTagging,
    isCleaningContent,
    isSummarizingCollection,
    isGeneratingAllOverviews,
    isGeneratingEmbeddings,
    bulkTagInput,
    setBulkTagInput,
    handleBulkSummarize,
    handleBulkAutoTag,
    handleBulkAddTag,
    handleBulkRemoveTag,
    handleBulkClearTags,
    handleBulkDelete,
    handleBulkGenerateOverviews,
    handleBulkGenerateEmbeddings,
    handleBulkCleanContent,
  };
}
