import React from "react";
import { BookmarkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

interface EmptyStateProps {
  searchQuery: string;
  selectedTags: string[];
  onClearFilters: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  searchQuery,
  selectedTags,
  onClearFilters,
}) => {
  const { t } = useTranslation();

  return (
    <div className="h-[400px] flex flex-col items-center justify-center gap-4 ds-text-muted">
      <div className="p-5 ds-radius-toggle ds-bg-secondary">
        <BookmarkIcon className="size-10 ds-text-muted" />
      </div>
      <p className="text-sm font-semibold">
        {searchQuery ? t("app_noResultsFound") : t("app_noBookmarksYet")}
      </p>
      {!searchQuery && (
        <p className="text-xs text-[var(--text-muted)] dark:text-[var(--text-muted)] max-w-xs text-center leading-relaxed">
          {t("app_addFirstBookmarkHint")}
        </p>
      )}
      {searchQuery && selectedTags.length > 0 && (
        <button
          onClick={onClearFilters}
          className="truncate text-xs font-bold mt-2 ds-text-accent"
        >
          {t("app_clearFilters")}
        </button>
      )}
    </div>
  );
};
