import { useState, useRef } from "react";
import React from "react";
import { Bookmark } from "../../types";
import { sanitizeUserInput } from "../../services/SanitizationService";
import { useTranslation } from "react-i18next";

export const EditableTitle = ({
  bookmark,
  onSave,
}: {
  bookmark: Bookmark;
  onSave: (_id: string, _newTitle: string) => void;
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(bookmark.title);

  // Reset local title when bookmark title changes externally
  const prevBookmarkIdRef = useRef(bookmark.id);
  if (bookmark.id !== prevBookmarkIdRef.current) {
    prevBookmarkIdRef.current = bookmark.id;
    setTitle(bookmark.title);
  }

  const handleBlur = () => {
    setIsEditing(false);
    const sanitized = sanitizeUserInput(title, 500); // Max 500 chars for title
    if (sanitized !== bookmark.title && sanitized.trim()) {
      onSave(bookmark.id, sanitized.trim());
    } else {
      setTitle(bookmark.title); // Revert if empty or unchanged
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleBlur();
    } else if (e.key === "Escape") {
      setTitle(bookmark.title);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent border-b-2 outline-none font-medium text-[var(--text-primary)] dark:text-[var(--text-accent)] py-0.5 ds-border-accent-primary"
          aria-label={t("app_editTitle")}
        />
      </>
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setIsEditing(true);
        }
      }}
      role="button"
      tabIndex={0}
      className="cursor-text hover:bg-[var(--state-hover-bg)]/50 px-2 py-1 -ms-2 rounded transition-colors truncate"
      title={t("app_clickToEdit", "Click to edit")}
    >
      {bookmark.title}
    </div>
  );
};
