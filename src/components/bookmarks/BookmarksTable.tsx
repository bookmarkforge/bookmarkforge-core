import { useCallback, useEffect, useDeferredValue, useRef, useState } from "react";
import React from "react";
import { initDB } from "../../container/database";
import { aiManager } from "../../services/ai/ProviderManager";
import { ragEngine } from "../../services/ai/RAGEngine";
import { ttsService } from "../../services/ai/TTSService";
import {
  loadFlashcardService,
  ProUnavailableError,
} from "../../services/pro-access";
import { contentFetchService } from "../../services/ContentFetchService";
import { useTranslation } from "react-i18next";
import {
  ShareBookmarkModal,
  BookmarkRow,
  ExpandedBookmarkRow,
  BookmarkReaderModal,
  ApiSettingsModal,
  useBookmarkSearch,
  useBookmarkSelection,
  useBookmarkBulkActions,
  BookmarkToolbar,
  SearchBar,
  BulkActionsBar,
  EmptyState,
  SkeletonLoader,
  TagFilterBar,
  exportJSON,
  exportCSV,
  exportMarkdown,
  exportPDF,
} from "./";

import { useBookmarkData } from "../../hooks/useBookmarkData";
import { useBookmarkCRUD } from "../../hooks/useBookmarkCRUD";
import { useBookmarkAI } from "../../hooks/useBookmarkAI";
import { useBookmarkUI } from "../../hooks/useBookmarkUI";
import { useBookmarkSort } from "./useBookmarkSort";
import { Bookmark } from "../../types";
import { AlertCircle, X, CheckSquare, Square } from "lucide-react";
import { logger } from "../../utils/logger";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGuardedAction } from "../../hooks/useGuardedAction";

export default function BookmarksTable() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as "en" | "es";

  // --- Data ---
  const { bookmarks, isLoading } = useBookmarkData();
  // --- Search (client-side filtering + semantic) ---
  const {
    searchQuery,
    setSearchQuery,
    isSemanticSearch,
    setIsSemanticSearch,
    isSearching,
    semanticSearchError,
    filteredBookmarks: searchFiltered,
    selectedTags,
    setSelectedTags,
  } = useBookmarkSearch({ bookmarks, ragEngine });

  // Defer the search query so the input stays responsive while the
  // expensive filter + virtualized-list re-render is deprioritized.
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const isSearchStale = searchQuery !== deferredSearchQuery;

  // --- Sort ---
  const { sortField, sortDirection, sortedBookmarks, handleSort, SortIcon } =
    useBookmarkSort({ bookmarks: searchFiltered });

  // --- All unique tags ---
  const allTags = React.useMemo(() => {
    const tagsSet = new Set<string>();
    bookmarks.forEach((b) => {
      (b.tags || []).forEach((tag) => tagsSet.add(tag));
    });
    return Array.from(tagsSet).sort();
  }, [bookmarks]);

  // --- Selection ---
  const {
    selectedIds,
    setSelectedIds,
    expandedIds,
    handleSelectAll,
    handleSelect,
    handleToggleExpand,
    selectedRowRef,
  } = useBookmarkSelection({ filteredBookmarks: sortedBookmarks });

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isFetchingContent, setIsFetchingContent] = useState<string | null>(
    null,
  );

  // --- CRUD ---
  const {
    handleDelete,
    handleAddTag,
    handleRemoveTag,
    handleClearTags,
    handleUpdateTitle,
    handleImportHTML,
    isImporting,
  } = useBookmarkCRUD(t);

  // --- AI --- (must be before bulk actions so setError is available)
  const {
    isSummarizing,
    isSummarizingAll,
    isGeneratingAllOverviews,
    isGeneratingEmbeddings: isGeneratingAllEmbeddings,
    isGeneratingContent,
    isAutoTagging,
    isCleaningContent,
    setIsCleaningContent,
    error,
    setError,
    handleSummarize,
    handleGenerateDetailedContent,
    handleSummarizeAll,
    handleGenerateAllOverviews,
    handleGenerateMissingEmbeddings,
  } = useBookmarkAI(t, aiManager, bookmarks);

  // --- Bulk actions ---
  const {
    bulkTagInput,
    setBulkTagInput,
    isSummarizingCollection,
    isBulkTagging,
    handleBulkSummarize,
    handleBulkAutoTag,
    handleBulkAddTag: handleBulkAddT,
    handleBulkRemoveTag: handleBulkRemT,
    handleBulkClearTags,
    handleBulkDelete,
    handleBulkGenerateOverviews,
  } = useBookmarkBulkActions({
    bookmarks,
    selectedIds,
    setSelectedIds,
    setError,
  });

  // --- UI state ---
  const {
    viewingContent,
    setViewingContent,
    sharingBookmark,
    setSharingBookmark,
    shareEmail,
    setShareEmail,
    showApiSettings,
    setShowApiSettings,
    apiKeyInput,
    setApiKeyInput,
    providerInfo,
    setProviderInfo,
  } = useBookmarkUI();

  const allVisibleSelected =
    sortedBookmarks.length > 0 &&
    sortedBookmarks.every((bookmark) => selectedIds.has(bookmark.id));

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // runWithSignal delivers the guard's AbortSignal to the PDF export: cancel()
  // on unmount aborts an in-flight export (same semantics as begin/request.signal).
  const { runWithSignal: runPdfExport, cancel: cancelPdfExport } =
    useGuardedAction();
  const contentFetchAbortRef = useRef<AbortController | null>(null);
  const contentFetchRequestRef = useRef(0);
  const flashcardAbortRef = useRef<AbortController | null>(null);
  const flashcardRequestRef = useRef(0);
  // The generate button lives on the expanded row, so generation always starts
  // expanded. Only a later collapse is an explicit cancel gesture; without
  // this, the abort effect would cancel the request on the very next render
  // because the expanded-state Set updates in the same commit.
  const flashcardExpandedAtStartRef = useRef(false);

  const cancelContentFetch = useCallback(() => {
    contentFetchRequestRef.current += 1;
    contentFetchAbortRef.current?.abort();
    contentFetchAbortRef.current = null;
    setIsFetchingContent(null);
  }, []);

  useEffect(() => () => {
    cancelPdfExport();
    contentFetchAbortRef.current?.abort();
    contentFetchAbortRef.current = null;
    flashcardAbortRef.current?.abort();
    flashcardAbortRef.current = null;
  }, [cancelPdfExport]);

  const handleSetViewingContent = useCallback(
    (content: Bookmark | null) => {
      cancelContentFetch();
      setViewingContent(content);
    },
    [cancelContentFetch],
  );

  const handleViewContent = useCallback(
    (bookmark: Bookmark) => {
      cancelContentFetch();
      cancelPdfExport();
      setViewingContent(bookmark);
    },
    [cancelContentFetch, cancelPdfExport],
  );

  const handleExportPDF = useCallback(
    (bookmark: Bookmark) => {
      void runPdfExport((signal) => exportPDF(bookmark, signal));
    },
    [runPdfExport],
  );

  const handleAudioSummary = useCallback(
    async (bookmark: Bookmark) => {
      if (isSpeaking) {return;}
      setIsSpeaking(true);
      try {
        const text = bookmark.summary || bookmark.title;
        const result = await ttsService.generateAudio(text, lang, undefined, {
          // Missing privacy metadata fails closed to the local TTS provider.
          isPrivate: bookmark.isPrivate !== false,
        });
        if (!result?.url) {return;}
        const audio = new Audio(result.url);
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("Audio playback failed"));
          void audio.play().catch(reject);
        });
      } catch (error) {
        logger.error("[BookmarksTable] Audio summary failed", { error });
      } finally {
        setIsSpeaking(false);
      }
    },
    [isSpeaking, lang],
  );

  const [isGeneratingFlashcards, setIsGeneratingFlashcards] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (
      isGeneratingFlashcards &&
      flashcardExpandedAtStartRef.current &&
      !expandedIds.has(isGeneratingFlashcards)
    ) {
      flashcardRequestRef.current += 1;
      flashcardAbortRef.current?.abort();
      flashcardAbortRef.current = null;
      setIsGeneratingFlashcards(null);
    }
  }, [expandedIds, isGeneratingFlashcards]);

  // Mirror ref of expandedIds so handleGenerateFlashcards stays stable
  // (if it depended on expandedIds, expanding a row would recreate the
  // handler and re-render every memoized row).
  const expandedIdsRef = useRef(expandedIds);
  expandedIdsRef.current = expandedIds;

  const handleGenerateFlashcards = useCallback(
    async (bookmark: Bookmark) => {
      if (flashcardAbortRef.current) {return;}
      // The generate button lives on the expanded row, so generation always
      // starts expanded. Record that invariant and let only a later collapse
      // cancel it.
      flashcardExpandedAtStartRef.current = expandedIdsRef.current.has(
        bookmark.id,
      );
    const text = bookmark.content || bookmark.summary || "";
    const controller = new AbortController();
    const requestId = ++flashcardRequestRef.current;
    flashcardAbortRef.current = controller;
    setIsGeneratingFlashcards(bookmark.id);
    try {
      // Gated Pro resolution: under Free (or an Open Core export) the loader
      // rejects and the catch below reports the upgrade message instead of
      // failing with an import error.
      const flashcardService = await loadFlashcardService();
      const count = await flashcardService.generateFromBookmark(
        bookmark.id,
        bookmark.title,
        text,
        lang,
        bookmark.isPrivate !== false,
        controller.signal,
      );
      if (
        count > 0 &&
        !controller.signal.aborted &&
        requestId === flashcardRequestRef.current
      ) {
        const { toast } = await import("sonner");
        toast.success(
          t("app_flashcardsGenerated", {
            defaultValue: `✨ ${count} flashcards generated`,
          }),
        );
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        if (err instanceof ProUnavailableError) {
          // Toast with an action — not a dead info line: the action opens
          // the Pro section, the same bridge the shared Pro state uses.
          const { toast } = await import("sonner");
          toast.info(t("app_flashcardsProRequired"), {
            action: {
              label: t("app_proStateToastAction", "See Pro"),
              onClick: () =>
                window.dispatchEvent(new CustomEvent("forge:open-settings")),
            },
          });
        } else {
          logger.error("[BookmarksTable] Flashcard generation failed", { err });
        }
      }
    } finally {
      if (flashcardAbortRef.current === controller) {
        flashcardAbortRef.current = null;
        setIsGeneratingFlashcards(null);
      }
    }
  }, [lang, t]);

  // Wrapper for single bookmark cleaning
  const handleCleanContent = useCallback(async (bookmark: Bookmark) => {
    setIsCleaningContent(bookmark.id);
    try {
      const db = await initDB();
      const doc = await db.bookmarks.findOne(bookmark.id).exec();
      if (doc && doc.content) {
        const cleaned = doc.content
          .replace(/\s+/g, " ")
          .replace(/\n\s*\n/g, "\n\n")
          .trim();
        await doc.incrementalPatch({
          content: cleaned,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error("[BookmarksTable] Error cleaning content", { error });
    } finally {
      setIsCleaningContent(null);
    }
  }, []);

  const handleFetchContent = useCallback(async (bookmark: Bookmark) => {
    contentFetchAbortRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++contentFetchRequestRef.current;
    contentFetchAbortRef.current = controller;
    setIsFetchingContent(bookmark.id);
    try {
      const result = await contentFetchService.fetchAndExtract(
        bookmark,
        controller.signal,
      );
      if (
        result &&
        !controller.signal.aborted &&
        requestId === contentFetchRequestRef.current
      ) {
        setViewingContent({ ...bookmark, ...result });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        logger.error("[BookmarksTable] Error fetching content", { error });
      }
    } finally {
      if (contentFetchAbortRef.current === controller) {
        contentFetchAbortRef.current = null;
        setIsFetchingContent(null);
      }
    }
  }, []);

  const handleShare = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!shareEmail || !sharingBookmark) {return;}
      const subject = encodeURIComponent(
        `Check out this bookmark: ${sharingBookmark.title}`,
      );
      const body = encodeURIComponent(
        `I thought you might find this interesting:\n\nTitle: ${sharingBookmark.title}\nURL: ${sharingBookmark.url}`,
      );
      window.location.href = `mailto:${encodeURIComponent(shareEmail)}?subject=${subject}&body=${body}`;
      setSharingBookmark(null);
      setShareEmail("");
    },
    [shareEmail, sharingBookmark],
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: sortedBookmarks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const bookmarkId = sortedBookmarks[index]?.id;
      return expandedIds.has(bookmarkId || "") ? 200 : 80;
    },
    overscan: 5,
  });

  return (
    <div className="max-w-7xl mx-auto p-3 md:p-8">
      <BookmarkToolbar
        bookmarks={bookmarks}
        selectedIds={selectedIds}
        bulkTagInput={bulkTagInput}
        setBulkTagInput={setBulkTagInput}
        isGeneratingEmbeddings={isGeneratingAllEmbeddings}
        isSummarizingAll={isSummarizingAll}
        isGeneratingAllOverviews={isGeneratingAllOverviews}
        isImporting={isImporting}
        isBulkTagging={isBulkTagging}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        isSemanticSearch={isSemanticSearch}
        setIsSemanticSearch={setIsSemanticSearch}
        isSearching={isSearching}
        semanticSearchError={semanticSearchError}
        onSelectAll={handleSelectAll}
        onBulkAddTag={handleBulkAddT}
        onBulkRemoveTag={handleBulkRemT}
        onBulkClearTags={handleBulkClearTags}
        onBulkDelete={handleBulkDelete}
        onBulkExport={() =>
          exportJSON(bookmarks.filter((b) => selectedIds.has(b.id)))
        }
        onBulkSummarize={handleBulkSummarize}
        onBulkAutoTag={handleBulkAutoTag}
        onBulkGenerateOverviews={handleBulkGenerateOverviews}
        onGenerateEmbeddings={() => void handleGenerateMissingEmbeddings()}
        onSummarizeAll={() => void handleSummarizeAll()}
        onGenerateAllOverviews={() => void handleGenerateAllOverviews()}
        onImportHTML={(file) => void handleImportHTML(file)}
        onShowApiSettings={() => setShowApiSettings(true)}
        onExportCSV={() => exportCSV(sortedBookmarks, t)}
        fileInputRef={fileInputRef!}
      />

      {error && (
        <div
          role="alert"
          className="mb-6 bg-[var(--danger-soft)] dark:bg-[var(--color-danger)]/10 border border-[var(--danger-soft-border)] dark:border-[var(--danger-soft-border)]/20 rounded-2xl p-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <AlertCircle
              className="size-5 ds-text-danger dark:ds-text-danger"
              aria-hidden="true"
            />
            <p className="text-sm font-medium ds-text-danger dark:ds-text-danger">
              {error}
            </p>
          </div>
          <button
            onClick={() => setError(null)}
            className="ds-text-danger dark:ds-text-danger hover:ds-text-danger dark:hover:ds-text-danger"
            aria-label={t("app_dismissError", "Dismiss error")}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <SearchBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        isSemanticSearch={isSemanticSearch}
        setIsSemanticSearch={setIsSemanticSearch}
        isSearching={isSearching}
        semanticSearchError={semanticSearchError}
      />

      <TagFilterBar
        allTags={allTags}
        selectedTags={selectedTags}
        onToggleTag={(tag) =>
          setSelectedTags(
            selectedTags.includes(tag)
              ? selectedTags.filter((t) => t !== tag)
              : [...selectedTags, tag],
          )
        }
        onClearTags={() => setSelectedTags([])}
      />

      <BulkActionsBar
        selectedIds={selectedIds}
        bulkTagInput={bulkTagInput}
        setBulkTagInput={setBulkTagInput}
        onBulkAddTag={handleBulkAddT}
        onBulkRemoveTag={handleBulkRemT}
        onBulkClearTags={handleBulkClearTags}
        onBulkDelete={handleBulkDelete}
        onBulkExport={() =>
          exportJSON(bookmarks.filter((b) => selectedIds.has(b.id)))
        }
        onBulkSummarize={handleBulkSummarize}
        onBulkAutoTag={handleBulkAutoTag}
        onBulkGenerateOverviews={handleBulkGenerateOverviews}
        bookmarks={bookmarks}
        isBulkTagging={isBulkTagging}
        isGeneratingAllOverviews={isGeneratingAllOverviews}
        isSummarizingCollection={isSummarizingCollection}
      />

      {/* Table */}
      <div className="bg-white dark:bg-[var(--bg-primary)]/40 border border-[var(--divider)] dark:border-[var(--divider)]/50 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[48px_1fr_80px] md:grid-cols-[48px_1.5fr_1fr_2fr_1.5fr_120px_180px] text-xs font-bold uppercase tracking-wider ds-border-b ds-bg-topbar ds-text-muted">
          <div className="p-4 flex items-center justify-center">
            <button
              type="button"
              onClick={handleSelectAll}
              aria-label={
                allVisibleSelected
                  ? t("app_deselectAll", "Deselect all")
                  : t("app_selectAll", "Select all")
              }
              aria-pressed={allVisibleSelected}
              disabled={sortedBookmarks.length === 0}
              className="truncate text-[var(--text-muted)] hover:text-[var(--text-primary)] dark:hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {allVisibleSelected ? (
                <CheckSquare className="size-4" aria-hidden="true" />
              ) : (
                <Square className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={() => handleSort("title")}
            className="truncate p-4 flex items-center gap-2 cursor-pointer hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-colors text-start bg-transparent border-0 ds-text-muted uppercase tracking-wider text-xs font-bold"
          >
            <span>{t("app_title")}</span>
            <SortIcon
              field="title"
              currentField={sortField}
              direction={sortDirection}
            />
          </button>
          <button
            type="button"
            onClick={() => handleSort("url")}
            className="truncate hidden md:flex p-4 items-center gap-2 cursor-pointer hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-colors text-start bg-transparent border-0 ds-text-muted uppercase tracking-wider text-xs font-bold"
          >
            <span>{t("app_url")}</span>
            <SortIcon
              field="url"
              currentField={sortField}
              direction={sortDirection}
            />
          </button>
          <button
            type="button"
            data-testid="sort-by-createdAt"
            onClick={() => handleSort("createdAt")}
            className="truncate hidden md:flex p-4 items-center gap-2 cursor-pointer hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-colors text-start bg-transparent border-0 ds-text-muted uppercase tracking-wider text-xs font-bold"
          >
            <span>{t("app_createdAt")}</span>
            <SortIcon
              field="createdAt"
              currentField={sortField}
              direction={sortDirection}
            />
          </button>
          <button
            type="button"
            onClick={() => handleSort("updatedAt")}
            className="truncate hidden md:flex p-4 items-center gap-2 cursor-pointer hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-colors text-start bg-transparent border-0 ds-text-muted uppercase tracking-wider text-xs font-bold"
          >
            <span>{t("app_updatedAt")}</span>
            <SortIcon
              field="updatedAt"
              currentField={sortField}
              direction={sortDirection}
            />
          </button>
          <div className="hidden md:block p-4 text-center">{t("app_tags")}</div>
          <div className="p-4 text-center">{t("app_actions")}</div>
        </div>

        <div
          ref={parentRef}
          className={`h-[600px] overflow-auto transition-opacity duration-150${isSearchStale ? " opacity-60" : ""}`}
          aria-label={t("app_bookmarksList", "Bookmarks list")}
        >
          {isLoading ? (
            <SkeletonLoader />
          ) : sortedBookmarks.length === 0 ? (
            <EmptyState
              searchQuery={searchQuery}
              selectedTags={selectedTags}
              onClearFilters={() => setSelectedTags([])}
            />
          ) : (
            <div
              role="list"
              // Locale-independent handle for e2e: `aria-label` is
              // i18n-allow — localized (es → "Marcadores (virtualizados)", ar →
              // RTL script) so a text-based locator would break per
              // locale. The text-fit stress spec counts rows via this.
              data-testid="bookmarks-virtual-list"
              aria-label={t(
                "app_bookmarksVirtualList",
                "Bookmarks (virtualized)",
              )}
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                const bookmark = sortedBookmarks[virtualItem.index];
                if (!bookmark) {return null;}
                const isSelected = selectedIds.has(bookmark.id);
                const isExpanded = expandedIds.has(bookmark.id);

                return (
                  <div
                    key={bookmark.id}
                    role="listitem"
                    ref={
                      isSelected
                        ? (selectedRowRef as React.RefObject<HTMLDivElement>)
                        : null
                    }
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualItem.size}px`,
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <BookmarkRow
                      bookmark={bookmark}
                      isSelected={isSelected}
                      isExpanded={isExpanded}
                      isAutoTagging={
                        isAutoTagging === bookmark.id ? bookmark.id : null
                      }
                      isSummarizing={
                        isSummarizing === bookmark.id ? bookmark.id : null
                      }
                      isGeneratingContent={
                        isGeneratingContent === bookmark.id ? bookmark.id : null
                      }
                      isSpeaking={isSpeaking}
                      allTags={allTags}
                      t={t}
                      aiManager={aiManager}
                      handleSelect={handleSelect}
                      handleToggleExpand={handleToggleExpand}
                      handleUpdateTitle={handleUpdateTitle}
                      handleSummarize={handleSummarize}
                      handleAddTag={handleAddTag}
                      handleRemoveTag={handleRemoveTag}
                      handleViewContent={handleViewContent}
                      handleGenerateDetailedContent={
                        handleGenerateDetailedContent
                      }
                      handleAudioSummary={handleAudioSummary}
                      setSharingBookmark={setSharingBookmark}
                      handleDelete={handleDelete}
                      setViewingContent={handleSetViewingContent}
                      isGeneratingFlashcards={
                        isGeneratingFlashcards === bookmark.id
                      }
                      onGenerateFlashcards={handleGenerateFlashcards}
                    />
                    {isExpanded && (
                      <ExpandedBookmarkRow
                        bookmark={bookmark}
                        bookmarks={bookmarks}
                        allTags={allTags}
                        t={t as (key: string, options?: unknown) => string}
                        handleAddTag={handleAddTag}
                        handleRemoveTag={handleRemoveTag}
                        handleClearTags={handleClearTags}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {sharingBookmark && (
        <ShareBookmarkModal
          sharingBookmark={sharingBookmark}
          shareEmail={shareEmail}
          setShareEmail={setShareEmail}
          setSharingBookmark={setSharingBookmark}
          handleShare={handleShare}
          t={t as unknown as (key: string, options?: unknown) => string}
        />
      )}

      {viewingContent && (
        <BookmarkReaderModal
          viewingContent={viewingContent}
          setViewingContent={handleSetViewingContent}
          handleExportPDF={() => void handleExportPDF(viewingContent)}
          handleExportMarkdown={() => exportMarkdown(viewingContent, t)}
          handleCleanContent={handleCleanContent}
          handleFetchContent={handleFetchContent}
          isCleaningContent={isCleaningContent}
          isFetchingContent={isFetchingContent}
          t={t}
        />
      )}

      <ApiSettingsModal
        showApiSettings={showApiSettings}
        setShowApiSettings={setShowApiSettings}
        aiManager={aiManager}
        apiKeyInput={apiKeyInput}
        setApiKeyInput={setApiKeyInput}
        providerInfo={providerInfo}
        setProviderInfo={setProviderInfo}
        t={t}
      />
    </div>
  );
}
