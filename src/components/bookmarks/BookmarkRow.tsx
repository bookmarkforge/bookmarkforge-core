import React from "react";
import { sanitizeUrl } from "../../services/SanitizationService";
import {
  Loader2,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Sparkles,
  Eye,
  FileText,
  Volume2,
  Share2,
  Trash2,
} from "lucide-react";
import { EditableTitle } from "./EditableTitle";
import { TagManager } from "./TagManager";

import { Bookmark } from "../../types";
import { ProviderManager } from "../../services/ai/ProviderManager";
import { SanitizationService } from "../../services/SanitizationService";
import i18n from "../../i18n";
import { formatDate } from "../../utils/localization";
import { logger } from "../../utils/logger";

interface BookmarkRowProps {
  bookmark: Bookmark;
  isSelected: boolean;
  isExpanded: boolean;
  isFocused?: boolean;
  isAutoTagging: string | null;
  isSummarizing: string | null;
  isGeneratingContent: string | null;
  isSpeaking: boolean;
  allTags: string[];
  t: (key: string) => string;
  aiManager: ProviderManager;
  handleSelect: (id: string) => void;
  handleToggleExpand: (id: string) => void;
  handleUpdateTitle: (id: string, title: string) => void;
  handleSummarize: (
    bookmark: Bookmark,
    t: (key: string) => string,
    aiManager: ProviderManager,
  ) => void;
  handleAddTag: (bookmark: Bookmark, tag: string) => void;
  handleRemoveTag: (bookmark: Bookmark, tag: string) => void;
  handleViewContent: (bookmark: Bookmark) => void;
  handleGenerateDetailedContent: (
    bookmark: Bookmark,
    t: (key: string) => string,
    aiManager: ProviderManager,
    showModal: boolean,
    setViewingContent: (content: Bookmark | null) => void,
  ) => void;
  handleAudioSummary: (bookmark: Bookmark) => void;
  setSharingBookmark: (bookmark: Bookmark | null) => void;
  handleDelete: (id: string) => void;
  setViewingContent: (bookmark: Bookmark | null) => void;
}

export const BookmarkRow = ({
    bookmark,
    isSelected,
    isExpanded,
    isFocused,
    isAutoTagging,
    isSummarizing,
    isGeneratingContent,
    isSpeaking,
    allTags,
    t,
    aiManager,
    handleSelect,
    handleToggleExpand,
    handleUpdateTitle,
    handleSummarize,
    handleAddTag,
    handleRemoveTag,
    handleViewContent,
    handleGenerateDetailedContent,
    handleAudioSummary,
    setSharingBookmark,
    handleDelete,
    setViewingContent,
    isGeneratingFlashcards: _isGeneratingFlashcards,
    onGenerateFlashcards: _onGenerateFlashcards,
  }: BookmarkRowProps & {
    isGeneratingFlashcards?: boolean;
    onGenerateFlashcards?: (bookmark: Bookmark) => void;
  }) => {
    const rowRef = React.useRef<HTMLTableRowElement>(null);

    React.useEffect(() => {
      if (isFocused && rowRef.current) {
        rowRef.current.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }
    }, [isFocused]);

    // Stable handlers for TagManager: the inline arrows that were recreated
    // on every render invalidated TagManager's React.memo (which has
    // internal state: input, AI suggestions, color picker). With the CRUD
    // handlers already stable, these callbacks only change when the
    // bookmark's identity changes.
    const handleRowAddTag = React.useCallback(
      (tag: string) => handleAddTag(bookmark, tag),
      [bookmark, handleAddTag],
    );
    const handleRowRemoveTag = React.useCallback(
      (tag: string) => handleRemoveTag(bookmark, tag),
      [bookmark, handleRemoveTag],
    );

    const handleNativeShare = async () => {
      if (navigator.share) {
        try {
          await navigator.share({
            title: bookmark.title,
            text: bookmark.summary || bookmark.title,
            url: bookmark.url,
          });
        } catch (error) {
          if ((error as Error).name !== "AbortError") {
            logger.error("Error sharing:", error);
            setSharingBookmark(bookmark);
          }
        }
      } else {
        setSharingBookmark(bookmark);
      }
    }

    return (
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        className={`grid grid-cols-[48px_1fr_80px] md:grid-cols-[48px_1.5fr_1fr_2fr_1.5fr_120px_180px] items-center transition-all duration-200 group mb-2`}
        style={{
          borderRadius: "var(--radius-item)",
          background: isSelected ? "var(--state-hover-bg)" : "transparent",
          border: isFocused ? "2px solid var(--accent-primary)" : "none",
        }}
        onClick={(e) => {
          // The row is a selectable surface, but its inner interactive
          // controls (select checkbox, expand, edit, delete, read, share,
          // links…) handle their own actions. Ignore clicks that started in
          // one of them so they never ALSO toggle row selection (the bubbled
          // duplicate would otherwise make the checkbox a no-op).
          const target = e.target as HTMLElement;
          // NOTE: the row itself is [role=button], so only native interactive
          // elements are excluded — [role=button] would match the row surface
          // itself and break click-to-select.
          if (target.closest("button, a, input, textarea, select")) {
            return;
          }
          handleSelect(bookmark.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleSelect(bookmark.id);
          }
        }}
      >
        <div className="p-4">
          <div className="flex items-center gap-2">
            {isAutoTagging === bookmark.id ? (
              <div className="relative flex items-center justify-center">
                <Loader2 className="size-4.5 animate-spin ds-text-accent" />
                <Sparkles className="size-2.5 absolute animate-pulse ds-text-accent" />
              </div>
            ) : (
              <button
                onClick={(e) => {
                  // The row wrapper is also a selectable role=button, so
                  // without stopping propagation the bubbled click would
                  // toggle the selection a second time (select on, then
                  // immediately off), making the checkbox a no-op.
                  e.stopPropagation();
                  handleSelect(bookmark.id);
                }}
                className="truncate transition-colors flex items-center justify-center p-1 rounded"
                style={{
                  color: isSelected
                    ? "var(--accent-primary)"
                    : "var(--text-muted)",
                }}
                aria-label={isSelected ? t("app_deselect") : t("app_select")}
              >
                {isSelected ? (
                  <CheckSquare className="size-4.5 text-blue-500" />
                ) : (
                  <Square className="size-4.5" />
                )}
              </button>
            )}{" "}
            <button
              onClick={() => handleToggleExpand(bookmark.id)}
              className="truncate transition-colors p-1 rounded ds-text-muted"
              aria-label={isExpanded ? t("app_collapse") : t("app_expand")}
            >
              {isExpanded ? (
                <ChevronDown className="size-4.5" />
              ) : (
                <ChevronRight className="rtl-flip size-4.5" />
              )}
            </button>
          </div>
        </div>
        <div className="p-4 font-semibold truncate ds-text-primary">
          <EditableTitle bookmark={bookmark} onSave={handleUpdateTitle} />
        </div>
        <div className="hidden md:block p-4 truncate ds-text-secondary">
          <a
            href={sanitizeUrl(bookmark.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1.5 transition-colors group/link"
          >
            <span className="truncate">{bookmark.url}</span>
            <ExternalLink className="size-3.5 opacity-0 group-hover/link:opacity-100 transition-opacity flex-shrink-0" />
            {bookmark.broken === true && (
              <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 ds-badge-danger">
                404
              </span>
            )}
          </a>
        </div>
        <div className="hidden md:block p-4 ds-text-secondary">
          {bookmark.summary ? (
            <p className="line-clamp-2 text-sm leading-relaxed">
              {bookmark.summary}
            </p>
          ) : (
            <button
              onClick={() => handleSummarize(bookmark, t, aiManager)}
              disabled={isSummarizing === bookmark.id}
              className="truncate text-xs font-medium flex items-center gap-1.5 px-2.5 py-1.5 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 ds-radius-button ds-bg-accent-soft ds-text-accent"
            >
              <Sparkles className="size-3.5" />
              {isSummarizing === bookmark.id
                ? t("app_generating")
                : t("app_autoSummarize")}
            </button>
          )}
        </div>
        <div className="hidden md:block p-4">
          <TagManager
            tags={bookmark.tags || []}
            allTags={allTags}
            onAddTag={handleRowAddTag}
            onRemoveTag={handleRowRemoveTag}
            content={bookmark.content}
            isPrivate={bookmark.isPrivate}
          />
        </div>
        <div className="hidden md:block p-4 text-sm font-medium ds-text-muted">
          {formatDate(bookmark.createdAt, {}, i18n.language)}
        </div>
        <div className="p-4 text-end">
          <div className="flex items-center justify-end gap-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 relative z-50">
            <button
              onClick={() => handleViewContent(bookmark)}
              className="truncate text-xs font-medium flex items-center gap-1.5 ds-text-success dark:ds-text-success hover:ds-text-success dark:hover:ds-text-success ds-bg-success-soft dark:ds-bg-success/10 p-2 md:px-2.5 md:py-1.5 rounded-lg transition-all hover:scale-105 active:scale-95"
              title={t("app_read")}
            >
              <Eye className="size-4 md:w-3.5 md:h-3.5" />
              <span className="hidden xl:inline">{t("app_read")}</span>
            </button>
            <div className="hidden md:flex items-center gap-2">
              <a
                href={sanitizeUrl(bookmark.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium flex items-center gap-1.5 text-[var(--text-secondary)] dark:text-[var(--text-muted)] hover:text-[var(--text-primary)] dark:hover:white bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] px-2.5 py-1.5 rounded-lg transition-all hover:scale-105 active:scale-95"
                title={t("app_visit")}
              >
                <ExternalLink className="size-3.5" />
                <span className="hidden xl:inline">{t("app_visit")}</span>
              </a>
              {!bookmark.summary && (
                <button
                  onClick={() => handleSummarize(bookmark, t, aiManager)}
                  disabled={isSummarizing === bookmark.id}
                  className="truncate text-xs font-medium flex items-center gap-1.5 ds-text-warning dark:ds-text-warning hover:ds-text-warning dark:hover:ds-text-warning ds-bg-warning-soft dark:bg-[var(--color-warning)]/10 px-2.5 py-1.5 rounded-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
                  title={t("app_summarize")}
                >
                  {isSummarizing === bookmark.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  <span className="hidden xl:inline">{t("app_summarize")}</span>
                </button>
              )}
              <button
                onClick={() =>
                  handleGenerateDetailedContent(
                    bookmark,
                    t,
                    aiManager,
                    true,
                    setViewingContent,
                  )
                }
                disabled={isGeneratingContent === bookmark.id}
                className="truncate text-xs font-medium flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-500/10 px-2.5 py-1.5 rounded-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
                title={t("app_generateOverview")}
              >
                <FileText className="size-3.5" />
                <span className="hidden xl:inline">
                  {isGeneratingContent === bookmark.id
                    ? t("app_generating")
                    : t("app_generateOverview")}
                </span>
              </button>
              <button
                onClick={() => handleAudioSummary(bookmark)}
                disabled={isSpeaking}
                className="truncate text-xs font-medium flex items-center gap-1.5 ds-text-warning dark:ds-text-warning hover:ds-text-warning dark:hover:ds-text-warning ds-bg-warning-soft dark:bg-[var(--color-warning)]/10 px-2.5 py-1.5 rounded-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
                title={t("app_listen")}
              >
                {isSpeaking ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Volume2 className="size-3.5" />
                )}
                <span className="hidden xl:inline">{t("app_listen")}</span>
              </button>
              <button
                onClick={handleNativeShare}
                className="truncate text-xs font-medium flex items-center gap-1.5 text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 bg-cyan-50 dark:bg-cyan-500/10 px-2.5 py-1.5 rounded-lg transition-all hover:scale-105 active:scale-95"
                title={t("app_shareNative")}
              >
                <Share2 className="size-3.5" />
                <span className="hidden xl:inline">{t("app_share")}</span>
              </button>
              <button
                onClick={() => handleToggleExpand(bookmark.id)}
                data-testid="edit-bookmark-button"
                className="text-[var(--text-muted)] hover:ds-text-accent dark:text-[var(--text-muted)] dark:hover:ds-text-accent transition-colors p-1.5 rounded-lg hover:bg-[var(--accent-soft)] dark:hover:bg-[var(--accent-primary)]/10"
                title={t("app_edit")}
                aria-label={t("app_edit")}
              >
                <FileText className="size-4.5" />
              </button>
              <button
                onClick={() => handleDelete(bookmark.id)}
                data-testid="delete-bookmark-button"
                className="text-[var(--text-muted)] hover:ds-text-danger dark:text-[var(--text-muted)] dark:hover:ds-text-danger transition-colors p-1.5 rounded-lg hover:bg-[var(--danger-soft)] dark:hover:bg-[var(--color-danger)]/10"
                title={t("app_delete")}
                aria-label={t("app_delete")}
              >
                <Trash2 className="size-4.5" />
              </button>
            </div>
          </div>
        </div>
        {isExpanded && (
          <div className="col-span-7 p-4 ds-bg-secondary ds-border-t">
            <div className="text-sm whitespace-pre-wrap ds-text-secondary mb-4">
              {SanitizationService.sanitizeText(
                bookmark.content || bookmark.summary || t("app_noContent"),
              )}
            </div>
            {(bookmark.content || bookmark.summary) && (
              <button
                onClick={() => _onGenerateFlashcards?.(bookmark)}
                disabled={_isGeneratingFlashcards}
                className="truncate text-xs font-medium flex items-center gap-1.5 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 bg-purple-50 dark:bg-purple-500/10 px-3 py-2 rounded-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                {_isGeneratingFlashcards ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {t("app_generateFlashcards")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };
