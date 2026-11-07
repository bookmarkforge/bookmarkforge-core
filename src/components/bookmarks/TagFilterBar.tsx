import React from "react";
import { useTranslation } from "react-i18next";

interface TagFilterBarProps {
  allTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
}

export const TagFilterBar: React.FC<TagFilterBarProps> = ({
  allTags,
  selectedTags,
  onToggleTag,
  onClearTags,
}) => {
  const { t } = useTranslation();

  if (allTags.length === 0) {return null;}

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 px-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] me-1">
        {t("app_tags")}:
      </span>
      {allTags.map((tag) => {
        const isActive = selectedTags.includes(tag);
        return (
          <button
            key={tag}
            onClick={() => onToggleTag(tag)}
            // Deterministic handle for the text-fit stress spec, which
            // toggles a Unicode tag to audit the filtered table.
            data-testid={`tag-filter-${tag}`}
            className={`truncate px-3 py-1 text-xs font-semibold transition-all ds-radius-toggle ${isActive ? "ds-bg-accent ds-text-on-accent" : "ds-bg-secondary ds-text-secondary"}`}
          >
            {tag}
          </button>
        );
      })}
      {selectedTags.length > 0 && (
        <button
          onClick={onClearTags}
          className="truncate text-[10px] font-bold uppercase tracking-widest ds-text-danger hover:ds-text-danger ms-1"
        >
          {t("app_clear")}
        </button>
      )}
    </div>
  );
};
