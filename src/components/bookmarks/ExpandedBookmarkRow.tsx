import React from "react";
import { Tags, Link } from "lucide-react";
import { BookmarkPreview } from "./BookmarkPreview";
import { ExpandedTagManager } from "./TagManager";
import { sanitizeUrl } from "../../services/SanitizationService";

import { Bookmark } from "../../types";

interface ExpandedBookmarkRowProps {
  bookmark: Bookmark;
  bookmarks: Bookmark[];
  allTags: string[];
  t: (key: string) => string;
  handleAddTag: (bookmark: Bookmark, tag: string) => void;
  handleRemoveTag: (bookmark: Bookmark, tag: string) => void;
  handleClearTags: (bookmark: Bookmark) => void;
}

export const ExpandedBookmarkRow = ({
    bookmark,
    bookmarks,
    allTags,
    t,
    handleAddTag,
    handleRemoveTag,
    handleClearTags,
  }: ExpandedBookmarkRowProps) => {
    const relatedBookmarks = React.useMemo(() => {
      const links = bookmark.relatedLinks;
      if (!links || links.length === 0) {
        return [];
      }
      // Set for the lookup: `relatedLinks.includes(b.id)` inside the filter
      // was O(n×links) when expanding a row with 100k bookmarks.
      const linkSet = new Set(links);
      return bookmarks.filter((b) => linkSet.has(b.id));
    }, [bookmarks, bookmark.relatedLinks]);
    // Stable handlers for ExpandedTagManager (same reason as in
    // BookmarkRow: the inline arrows invalidated the manager's React.memo).
    const handleRowAddTag = React.useCallback(
      (tag: string) => handleAddTag(bookmark, tag),
      [bookmark, handleAddTag],
    );
    const handleRowRemoveTag = React.useCallback(
      (tag: string) => handleRemoveTag(bookmark, tag),
      [bookmark, handleRemoveTag],
    );
    const handleRowClearTags = React.useCallback(
      () => handleClearTags(bookmark),
      [bookmark, handleClearTags],
    );
    const relatedLinksLabel = t("app_relatedLinks") || "Related Links";

    return (
      <div className="bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-primary)]/60 border-b border-[var(--divider)] dark:border-[var(--divider)]/50 shadow-inner w-full">
        <div className="p-0">
          <div className="p-6 ps-16 animate-in slide-in-from-top-2 fade-in duration-200 flex flex-col md:flex-row gap-8">
            <div className="flex-1 max-w-md">
              <BookmarkPreview url={bookmark.url} />
            </div>
            <div className="flex-1 flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <h4 className="text-sm font-semibold text-[var(--text-primary)] dark:text-[var(--text-secondary)] flex items-center gap-2">
                  <Tags className="size-4.5 text-blue-500" /> {t("app_tags")}
                </h4>
                <div className="bg-white dark:bg-[var(--bg-card)]/30 border border-[var(--divider)] dark:border-[var(--divider)]/50 rounded-xl p-5 shadow-sm">
                  <ExpandedTagManager
                    tags={bookmark.tags || []}
                    allTags={allTags}
                    onAddTag={handleRowAddTag}
                    onRemoveTag={handleRowRemoveTag}
                    onClearTags={handleRowClearTags}
                  />
                </div>
              </div>

              {relatedBookmarks.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h4 className="text-sm font-semibold text-[var(--text-primary)] dark:text-[var(--text-secondary)] flex items-center gap-2">
                    <Link className="size-4.5 ds-text-accent" />
                    {relatedLinksLabel}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {relatedBookmarks.map((b) => (
                      <a
                        key={b.id}
                        href={sanitizeUrl(b.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium ds-ghost-bg px-3.5 py-1.5 rounded-full transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5 border shadow-sm ds-border-inactive ds-text-secondary"
                      >
                        {b.title}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };
