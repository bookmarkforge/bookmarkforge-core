import { memo, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Database } from "lucide-react";
import type { TranslationRowState } from "../../hooks/useTranslationSession";

interface TranslationRowProps {
  row: TranslationRowState;
  editable: boolean;
  onChange: (index: number, text: string) => void;
}

/**
 * One paragraph pair. Memoized on purpose: streaming updates one row at a time,
 * and a document with a hundred chunks must not re-render all of them per token.
 *
 * Code/table blocks are echoed (not editable): the pipeline never sends them to
 * a model, so an editable textarea would imply a translation that does not
 * exist.
 */
const TranslationRow = memo(function TranslationRow({
  row,
  editable,
  onChange,
}: TranslationRowProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow: rows are grid cells, so the paired source cell grows with the
  // translation and the two columns stay aligned without JS scroll coupling.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) {return;}
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [row.translation, editable]);

  const isCode = !row.translatable || row.kind === "code";

  return (
    <div
      className="grid grid-cols-2 border-b border-[var(--divider)] last:border-b-0"
      data-testid={`translation-row-${row.index}`}
      data-status={row.status}
    >
      <div
        dir="auto"
        className="min-w-0 px-3 py-3 md:px-5 text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-words"
      >
        {isCode ? (
          <pre className="text-xs bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/60 rounded-md p-3 overflow-x-auto">
            <code>{row.sourceText}</code>
          </pre>
        ) : (
          row.sourceText
        )}
      </div>

      <div className="min-w-0 px-3 py-3 md:px-5 border-l border-[var(--divider)]">
        {row.fromCache && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            <Database className="size-3" aria-hidden="true" />
            {t("translation_cached")}
          </span>
        )}
        {isCode ? (
          <pre className="text-xs bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/60 rounded-md p-3 overflow-x-auto opacity-70">
            <code>{row.translation || row.sourceText}</code>
          </pre>
        ) : (
          <textarea
            ref={textareaRef}
            dir="auto"
            readOnly={!editable}
            value={row.translation}
            onChange={(event) => onChange(row.index, event.target.value)}
            aria-label={`${t("translation_targetLanguage")} ${row.index + 1}`}
            rows={1}
            className="w-full resize-none bg-transparent text-sm leading-relaxed text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-cyan-500/40 rounded-sm"
            placeholder={row.status === "pending" ? "…" : ""}
          />
        )}
      </div>
    </div>
  );
});

export default TranslationRow;
