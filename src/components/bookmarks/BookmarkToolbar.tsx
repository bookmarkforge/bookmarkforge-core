import React, { useTransition } from "react";
import {
  Database,
  Sparkles,
  FileText,
  Plus,
  Download,
  Settings,
  Search,
  X,
  Tags,
  Loader2,
  Trash2,
  Command,
  Bookmark as BookmarkIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Bookmark } from "../../types";
import { EmbeddingProgressIndicator } from "../EmbeddingProgressIndicator";

interface BookmarkToolbarProps {
  bookmarks: Bookmark[];
  selectedIds: Set<string>;
  bulkTagInput: string;
  setBulkTagInput: React.Dispatch<React.SetStateAction<string>>;
  isGeneratingEmbeddings: boolean;
  isSummarizingAll: boolean;
  isGeneratingAllOverviews: boolean;
  isImporting: boolean;
  isBulkTagging: boolean;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  isSemanticSearch: boolean;
  setIsSemanticSearch: React.Dispatch<React.SetStateAction<boolean>>;
  isSearching: boolean;
  semanticSearchError?: boolean;
  onSelectAll: () => void;
  onBulkAddTag: () => void;
  onBulkRemoveTag: () => void;
  onBulkClearTags: () => void;
  onBulkDelete: () => void;
  onBulkExport: () => void;
  onBulkSummarize: () => void;
  onBulkAutoTag: () => void;
  onBulkGenerateOverviews: () => void;
  onGenerateEmbeddings: () => void;
  onSummarizeAll: () => void;
  onGenerateAllOverviews: () => void;
  onImportHTML: (file: File) => void;
  onShowApiSettings: () => void;
  onExportCSV: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export function BookmarkToolbar({
  bookmarks,
  selectedIds,
  isGeneratingEmbeddings,
  isSummarizingAll,
  isGeneratingAllOverviews,
  isImporting,
  onGenerateEmbeddings,
  onSummarizeAll,
  onGenerateAllOverviews,
  onImportHTML,
  onShowApiSettings,
  onExportCSV,
  fileInputRef,
}: BookmarkToolbarProps) {
  const { t } = useTranslation();
  const _hasSelection = selectedIds.size > 0;

  // With tens of thousands of bookmarks, scanning the whole array inside
  // JSX (3 × filter per render) was O(3n) per frame. These flags only
  // depend on the content, so they are computed once per data change;
  // `some` short-circuits on the first matching element.
  const hasMissingEmbeddings = React.useMemo(
    () => bookmarks.some((b) => !b.embedding || b.embedding.length === 0),
    [bookmarks],
  );
  const hasMissingSummaries = React.useMemo(
    () => bookmarks.some((b) => !b.summary),
    [bookmarks],
  );
  const hasMissingContents = React.useMemo(
    () => bookmarks.some((b) => !b.content),
    [bookmarks],
  );

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 md:gap-6 mb-6 md:mb-10 font-sans">
      <div className="space-y-1">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight flex items-center gap-3 ds-text-primary">
          <BookmarkIcon className="size-8 ds-text-accent" aria-hidden="true" />
          {t("app_bookmarks")}
        </h1>
        <p className="text-sm font-medium max-w-md ds-text-secondary">
          {t("app_bookmarksDesc")}
        </p>
      </div>

      <div className="flex flex-wrap gap-3 w-full sm:w-auto p-2 shadow-sm ds-surface-secondary border border-[var(--divider)]">
        <button
          onClick={onGenerateEmbeddings}
          disabled={isGeneratingEmbeddings || !hasMissingEmbeddings}
          className="truncate text-xs font-bold transition-all hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 shadow-sm ds-bg-card-plain ds-text-primary border border-[var(--state-inactive-border)]"
        >
          <Database className="size-4 ds-text-success" />
          {isGeneratingEmbeddings
            ? t("app_generating")
            : t("app_generateEmbeddings")}
        </button>

        <button
          onClick={onSummarizeAll}
          disabled={isSummarizingAll || !hasMissingSummaries}
          className="truncate text-xs font-bold transition-all hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 shadow-sm ds-bg-card-plain ds-text-primary border border-[var(--state-inactive-border)]"
        >
          <Sparkles className="size-4 ds-text-accent" />
          {isSummarizingAll ? t("app_summarizing") : t("app_summarizeAll")}
        </button>

        <button
          onClick={onGenerateAllOverviews}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onGenerateAllOverviews();
            }
          }}
          disabled={isGeneratingAllOverviews || !hasMissingContents}
          className="truncate text-xs font-bold transition-all hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 shadow-sm ds-bg-card-plain ds-text-primary border border-[var(--state-inactive-border)]"
        >
          <FileText className="size-4 ds-text-blue" />
          {isGeneratingAllOverviews
            ? t("app_generating")
            : t("app_generateAllOverviews")}
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          disabled={isImporting}
          className="truncate text-xs font-bold transition-all hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 shadow-sm ds-bg-card-plain ds-text-primary border border-[var(--state-inactive-border)]"
        >
          <Plus className="size-4 ds-text-muted" />
          {isImporting ? t("app_importing") : t("app_importHtml")}
        </button>

        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {onImportHTML(file);}
          }}
          accept=".html"
          className="hidden"
          aria-label={t("app_importHtml")}
        />

        <button
          onClick={onExportCSV}
          data-testid="export-json-button"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onExportCSV();
            }
          }}
          className="truncate text-xs font-bold transition-all hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 shadow-sm ds-bg-card-plain ds-text-primary border border-[var(--state-inactive-border)]"
        >
          <Download className="size-4 ds-text-muted" />
          {t("app_exportCsv")}
        </button>

        <button
          onClick={onShowApiSettings}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onShowApiSettings();
            }
          }}
          className="truncate text-xs font-bold transition-all hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 shadow-sm ds-bg-card-plain ds-text-primary border border-[var(--state-inactive-border)]"
        >
          <Settings className="size-4 ds-text-muted" />
          {t("app_aiSettings")}
        </button>
      </div>
    </div>
  );
}

export function SearchBar({
  searchQuery,
  setSearchQuery,
  isSemanticSearch,
  setIsSemanticSearch,
  isSearching,
  semanticSearchError = false,
}: {
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  isSemanticSearch: boolean;
  setIsSemanticSearch: React.Dispatch<React.SetStateAction<boolean>>;
  isSearching: boolean;
  semanticSearchError?: boolean;
}) {
  const { t } = useTranslation();
  const [, startTransition] = useTransition();

  return (
    <div className="mb-6 md:mb-8 group">
      <div className="relative flex items-center shadow-sm transition-all duration-300 focus-within:shadow-xl ds-input ds-radius-input">
        <div className="flex items-center justify-center ps-5 pe-3">
          {isSearching ? (
            <Loader2 className="size-6 animate-spin ds-text-accent" />
          ) : (
            <Search className="size-6 text-[var(--text-muted)] group-focus-within:text-cyan-500 transition-colors" />
          )}
        </div>

        <input
          type="text"
          data-testid="search-input"
          placeholder={
            isSemanticSearch
              ? t("app_semanticSearchPlaceholder")
              : t("app_searchPlaceholder")
          }
          value={searchQuery}
          onChange={(e) => startTransition(() => setSearchQuery(e.target.value))}
          aria-label={
            isSemanticSearch
              ? t("app_semanticSearchPlaceholder")
              : t("app_searchPlaceholder")
          }
          className="flex-1 bg-transparent border-none py-4 text-lg text-[var(--text-primary)] dark:text-white placeholder:text-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] font-medium tracking-tight"
        />

        <div className="flex items-center gap-2 px-4 border-l border-[var(--divider)] dark:border-[var(--divider)] my-3">
          <button
            type="button"
            onClick={() => setIsSemanticSearch(!isSemanticSearch)}
            aria-pressed={isSemanticSearch}
            className={`truncate flex items-center gap-2 px-4 py-2 text-xs font-bold transition-all shadow-sm hover:scale-105 active:scale-95 ds-radius-button ${isSemanticSearch ? "ds-bg-accent ds-text-on-accent" : "ds-bg-secondary ds-text-secondary"}`}
          >
            <Sparkles
              className={`size-4 ${isSemanticSearch ? "animate-pulse" : ""}`}
            />
            <span className="hidden sm:inline uppercase tracking-widest">
              {t("app_aiSearch", "AI Search")}
            </span>
          </button>

          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/50 rounded-lg border border-[var(--divider)] dark:border-[var(--divider)]/50 text-[10px] font-bold text-[var(--text-muted)] shadow-inner">
            <Command className="size-3.5" />
            <span>K</span>
          </div>
        </div>

        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="pe-5 ps-2 text-[var(--text-muted)] hover:ds-text-danger transition-colors"
            aria-label="Clear search"
          >
            <X className="size-6" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 mt-3">
        <EmbeddingProgressIndicator />
        {isSemanticSearch && !semanticSearchError && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs font-bold uppercase tracking-widest ps-2 flex items-center gap-2 ds-text-accent"
          >
            <Sparkles className="size-3.5" />
            {t("app_thinkingSemantically", {
              defaultValue: "Semantic indexing active - searching by meaning",
            })}
          </motion.p>
        )}
        {isSemanticSearch && semanticSearchError && (
          <p
            role="status"
            data-testid="semantic-search-fallback"
            className="text-xs font-bold uppercase tracking-widest ps-2 flex items-center gap-2 text-blue-500"
          >
            <Sparkles className="size-3.5" />
            {t("app_semanticSearchUnavailable", {
              defaultValue:
                "Semantic search is temporarily unavailable; showing text matches",
            })}
          </p>
        )}
      </div>
    </div>
  );
}

export function BulkActionsBar({
  selectedIds,
  bulkTagInput,
  setBulkTagInput,
  onBulkAddTag,
  onBulkRemoveTag,
  onBulkClearTags,
  onBulkDelete,
  onBulkExport,
  onBulkSummarize,
  onBulkAutoTag,
  onBulkGenerateOverviews,
  isBulkTagging,
  isGeneratingAllOverviews,
  isSummarizingCollection,
}: {
  selectedIds: Set<string>;
  bulkTagInput: string;
  setBulkTagInput: React.Dispatch<React.SetStateAction<string>>;
  onBulkAddTag: () => void;
  onBulkRemoveTag: () => void;
  onBulkClearTags: () => void;
  onBulkDelete: () => void;
  onBulkExport: () => void;
  onBulkSummarize: () => void;
  onBulkAutoTag: () => void;
  onBulkGenerateOverviews: () => void;
  isBulkTagging: boolean;
  isGeneratingAllOverviews: boolean;
  isSummarizingCollection: boolean;
  bookmarks?: Bookmark[];
}) {
  const { t } = useTranslation();
  const hasSelection = selectedIds.size > 0;

  if (!hasSelection) {return null;}

  return (
    <div className="mb-6 md:mb-8 border border-[var(--divider)] dark:border-[var(--divider)] rounded-[24px] p-4 flex flex-wrap items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-4 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)] sticky bottom-24 md:bottom-8 z-40 mx-auto max-w-6xl bg-app-card">
      <div className="flex flex-wrap items-center gap-4 w-full md:w-auto justify-center md:justify-start">
        <span className="bg-[var(--bg-card)] dark:bg-[var(--bg-secondary)] text-white dark:text-[var(--text-primary)] text-xs font-semibold uppercase tracking-widest px-4 py-2 rounded-xl shadow-inner">
          {selectedIds.size} {t("app_selected")}
        </span>

        <div className="hidden sm:block h-8 w-px bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)]"></div>

        <div className="flex items-center gap-2">
          <Tags className="size-5 text-[var(--text-muted)] dark:text-[var(--text-muted)]" />
          <input
            type="text"
            data-testid="bookmark-tags-input"
            placeholder={t("app_typeTag")}
            value={bulkTagInput}
            onChange={(e) => setBulkTagInput(e.target.value)}
            aria-label={t("app_typeTag", "Type tag name")}
            className="bg-[var(--bg-primary)] dark:bg-white border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] dark:text-[var(--text-primary)] focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 w-40 sm:w-52 transition-all shadow-inner"
          />
          <button
            onClick={onBulkAddTag}
            disabled={!bulkTagInput.trim()}
            className="truncate text-xs font-bold bg-[var(--bg-card)] dark:bg-[var(--bg-secondary)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] text-white dark:text-[var(--text-primary)] px-4 py-2.5 rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 shadow-sm"
          >
            {t("app_addTag")}
          </button>
          <button
            onClick={onBulkRemoveTag}
            disabled={!bulkTagInput.trim()}
            className="truncate text-xs font-bold bg-[var(--bg-card)] dark:bg-[var(--bg-secondary)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] text-white dark:text-[var(--text-primary)] px-4 py-2.5 rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 shadow-sm"
          >
            {t("app_removeTag")}
          </button>
        </div>

        <div className="hidden lg:block h-8 w-px bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)]"></div>

        <div className="flex flex-wrap items-center justify-center gap-2 w-full lg:w-auto">
          <button
            onClick={onBulkDelete}
            className="truncate text-xs font-bold bg-[var(--color-danger)]/10 dark:bg-[var(--danger-soft)] hover:bg-[var(--color-danger)]/20 dark:hover:bg-[var(--danger-soft)] text-[#b91c1c] dark:ds-text-danger px-4 py-2.5 rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2 shadow-sm border border-[var(--danger-soft-border)]/20 dark:border-[var(--danger-soft-border)]"
          >
            <Trash2 className="size-4" />
            {t("app_deleteSelected")}
          </button>
          <button
            onClick={onBulkClearTags}
            className="truncate text-xs font-bold bg-[var(--bg-card)] dark:bg-[var(--bg-secondary)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] text-white dark:text-[var(--text-primary)] px-4 py-2.5 rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2 shadow-sm"
          >
            <X className="size-4 text-[var(--text-muted)]" />
            {t("app_clearTags")}
          </button>
          <button
            onClick={onBulkExport}
            className="truncate text-xs font-bold bg-[var(--bg-card)] dark:bg-[var(--bg-secondary)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] text-white dark:text-[var(--text-primary)] px-4 py-2.5 rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2 shadow-sm"
          >
            <Database className="size-4 text-[var(--text-muted)]" />
            {t("app_exportJson")}
          </button>
          <button
            onClick={onBulkGenerateOverviews}
            disabled={isGeneratingAllOverviews}
            className="truncate text-xs font-bold bg-blue-500/10 dark:bg-blue-50 hover:bg-blue-500/20 dark:hover:bg-blue-100 text-blue-700 dark:text-blue-700 px-4 py-2.5 rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:hover:scale-100 shadow-sm border border-blue-500/20 dark:border-blue-200"
          >
            <Sparkles className="size-4" />
            {isGeneratingAllOverviews
              ? t("app_generating")
              : t("app_generateOverviews")}
          </button>
          <button
            onClick={onBulkSummarize}
            disabled={isSummarizingCollection}
            className="truncate text-xs font-bold bg-cyan-500/10 dark:bg-cyan-50 hover:bg-cyan-500/20 dark:hover:bg-cyan-100 text-cyan-700 dark:text-cyan-700 px-4 py-2.5 rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:hover:scale-100 shadow-sm border border-cyan-500/20 dark:border-cyan-200"
          >
            <Sparkles className="size-4" />
            {isSummarizingCollection
              ? t("app_synthesizing")
              : t("app_summarizeCollection")}
          </button>
          <button
            onClick={onBulkAutoTag}
            disabled={isBulkTagging}
            className="truncate text-xs font-bold ds-bg-success/10 dark:ds-bg-success-soft hover:ds-bg-success/20 dark:hover:ds-bg-success-soft text-[#047857] dark:ds-text-success px-4 py-2.5 rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:hover:scale-100 shadow-sm border border-[var(--success-soft-border)]/20 dark:border-[var(--success-soft-border)]"
          >
            {isBulkTagging ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Tags className="size-4" />
            )}
            {t("app_autoTagPrompt")}
          </button>
        </div>
      </div>
    </div>
  );
}
