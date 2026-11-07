import type { BlockNoteEditor } from "@blocknote/core";
import { X, Sparkles, Link as LinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SuggestionItem {
  id: string;
  title: string;
  url?: string;
  summary?: string;
  textContent?: string;
}

interface SuggestionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  suggestions: SuggestionItem[];
  onInsertSuggestion: (suggestion: SuggestionItem) => void;
  editor: BlockNoteEditor;
}

export function SuggestionsPanel({
  isOpen,
  onClose,
  suggestions,
  onInsertSuggestion,
  editor,
}: SuggestionsPanelProps) {
  const { t } = useTranslation();

  if (!isOpen) {
    return null;
  }

  const handleInsert = (suggestion: SuggestionItem) => {
    if (editor?.document[0]) {
      editor?.insertBlocks(
        [
          {
            type: "paragraph",
            content: `Reference: [${suggestion.title}](${suggestion.url || "#"})`,
          },
        ],
        editor.document[0],
        "after",
      );
    }
    onInsertSuggestion(suggestion);
  };

  return (
    <div className="fixed inset-0 md:relative w-full md:w-80 lg:w-96 p-4 md:p-6 bg-white dark:bg-[var(--bg-primary)] border-l border-[var(--divider)] dark:border-[var(--divider)] animate-in slide-in-from-right duration-300 shadow-xl z-50">
      <button
        onClick={onClose}
        className="md:hidden absolute top-4 right-4 p-2 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-full z-[60]"
        aria-label={t("app_close")}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      <div className="flex items-center gap-2 mb-6 ds-text-accent">
        <Sparkles className="size-4" />
        <h3 className="text-sm font-semibold uppercase tracking-wider">
          {t("app_smartLinks")}
        </h3>
      </div>
      <div className="space-y-4 overflow-y-auto max-h-[80vh]">
        {suggestions.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] italic">
            {t("app_writingReferences")}
          </p>
        ) : (
          suggestions.map((s, i) => (
            <div
              key={i}
              className="group p-4 ds-ghost-btn bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/40 border border-[var(--divider)] dark:border-[var(--divider)]/50 rounded-xl hover:border-cyan-500/50 transition-all cursor-pointer hover:shadow-md"
              onClick={() => handleInsert(s)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleInsert(s);
                }
              }}
            >
              <p className="text-xs font-bold text-[var(--text-primary)] dark:text-[var(--text-muted)] truncate mb-1.5">
                {s.title}
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                {s.summary || s.textContent}
              </p>
              <div className="mt-3 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[10px] text-cyan-600 dark:text-cyan-400 font-medium uppercase tracking-wider">
                  {t("app_insertLink")}
                </span>
                <LinkIcon className="size-3 text-cyan-600 dark:text-cyan-400" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
