import {
  X,
  Sparkles,
  Loader2,
  CheckCircle2,
  ChevronRight,
  Wand2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface AICopilotPanelProps {
  isOpen: boolean;
  onClose: () => void;
  isThinking: boolean;
  onAction: (
    action:
      "summarize" | "improve" | "continue" | "fix" | "translate" | "rewrite",
  ) => void;
}

function AICopilotPanel({
  isOpen,
  onClose,
  isThinking,
  onAction,
}: AICopilotPanelProps) {
  const { t } = useTranslation();

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 md:relative w-full md:w-80 lg:w-96 p-4 md:p-6 bg-white dark:bg-[var(--bg-primary)] border-l border-[var(--divider)] dark:border-[var(--divider)] animate-in slide-in-from-right duration-300 shadow-xl z-50">
      <button
        onClick={onClose}
        className="md:hidden absolute top-4 right-4 p-2 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-full z-[60]"
      >
        <X className="size-4" />
      </button>
      <div className="flex items-center gap-2 mb-6 text-cyan-600 dark:text-cyan-400">
        <Sparkles className="size-4" />
        <h3 className="text-sm font-semibold uppercase tracking-wider ds-text-accent">
          {t("app_aiCopilot")}
        </h3>
      </div>
      <div className="space-y-3">
        <button
          onClick={() => onAction("summarize")}
          disabled={isThinking}
          className="truncate w-full flex items-center justify-between p-4 ds-ghost-btn bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/40 border border-[var(--divider)] dark:border-[var(--divider)]/50 rounded-xl hover:border-cyan-500/50 transition-all group hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <Sparkles className="size-4 text-[var(--text-muted)] group-hover:text-cyan-500 dark:group-hover:text-cyan-400" />
            <span className="text-sm font-medium text-[var(--text-primary)] dark:text-[var(--text-muted)]">
              {t("app_summarizeAll")}
            </span>
          </div>
          <ChevronRight className="rtl-flip size-3 text-[var(--text-muted)]" />
        </button>
        <button
          onClick={() => onAction("improve")}
          disabled={isThinking}
          className="truncate w-full flex items-center justify-between p-4 ds-ghost-btn bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/40 border border-[var(--divider)] dark:border-[var(--divider)]/50 rounded-xl hover:border-cyan-500/50 transition-all group hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <Wand2 className="size-4 text-[var(--text-muted)] group-hover:text-cyan-500 dark:group-hover:text-cyan-400" />
            <span className="text-sm font-medium text-[var(--text-primary)] dark:text-[var(--text-muted)]">
              {t("app_improveWriting")}
            </span>
          </div>
          <ChevronRight className="rtl-flip size-3 text-[var(--text-muted)]" />
        </button>
        <button
          onClick={() => onAction("continue")}
          disabled={isThinking}
          className="truncate w-full flex items-center justify-between p-4 ds-ghost-btn bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/40 border border-[var(--divider)] dark:border-[var(--divider)]/50 rounded-xl hover:border-cyan-500/50 transition-all group hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <Sparkles className="size-4 text-[var(--text-muted)] group-hover:text-cyan-500 dark:group-hover:text-cyan-400" />
            <span className="text-sm font-medium text-[var(--text-primary)] dark:text-[var(--text-muted)]">
              {t("app_continueWriting")}
            </span>
          </div>
          <ChevronRight className="rtl-flip size-3 text-[var(--text-muted)]" />
        </button>
        <button
          onClick={() => onAction("translate")}
          disabled={isThinking}
          className="truncate w-full flex items-center justify-between p-4 ds-ghost-btn bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/40 border border-[var(--divider)] dark:border-[var(--divider)]/50 rounded-xl hover:border-cyan-500/50 transition-all group hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <Sparkles className="size-4 text-[var(--text-muted)] group-hover:text-cyan-500 dark:group-hover:text-cyan-400" />
            <span className="text-sm font-medium text-[var(--text-primary)] dark:text-[var(--text-muted)]">
              {t("app_translate")}
            </span>
          </div>
          <ChevronRight className="rtl-flip size-3 text-[var(--text-muted)]" />
        </button>
        <button
          onClick={() => onAction("fix")}
          disabled={isThinking}
          className="truncate w-full flex items-center justify-between p-4 ds-ghost-btn bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/40 border border-[var(--divider)] dark:border-[var(--divider)]/50 rounded-xl hover:border-cyan-500/50 transition-all group hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-4 text-[var(--text-muted)] group-hover:text-cyan-500 dark:group-hover:text-cyan-400" />
            <span className="text-sm font-medium text-[var(--text-primary)] dark:text-[var(--text-muted)]">
              {t("app_fixGrammar")}
            </span>
          </div>
          <ChevronRight className="rtl-flip size-3 text-[var(--text-muted)]" />
        </button>
      </div>
      {isThinking && (
        <div className="mt-8 flex flex-col items-center gap-3 text-[var(--text-muted)]">
          <Loader2 className="size-6 animate-spin ds-text-accent" />
          <p className="text-[10px] font-bold uppercase tracking-widest animate-pulse">
            {t("app_processing")}...
          </p>
        </div>
      )}
    </div>
  );
}

export default AICopilotPanel;
