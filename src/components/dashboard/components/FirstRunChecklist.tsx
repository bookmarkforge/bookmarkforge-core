import { ArrowRight, Bookmark, Check, FileText, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { EASE_OUT, DURATION_MENU } from "../../../constants/motion";

interface FirstRunChecklistProps {
  /** Non-deleted bookmarks; undefined while the count is still loading. */
  bookmarkCount: number | undefined;
  /** Non-deleted documents; undefined while the count is still loading. */
  documentCount: number | undefined;
  /** True once search has been opened at least once. */
  searchTried: boolean;
  /** Opens the bookmark capture surface. */
  onCaptureBookmark: () => void;
  /** Opens the documents surface. */
  onCreateDocument: () => void;
  /** Opens the global search (Omnibar). */
  onTrySearch: () => void;
  /** Hides the checklist for good. */
  onDismiss: () => void;
}

interface ChecklistStep {
  key: string;
  icon: typeof Bookmark;
  title: string;
  description: string;
  done: boolean;
  onAction: () => void;
}

/**
 * First-run path: capture → write → find it again, in three steps.
 *
 * Deliberately a *replacement* for the feature grid, not another card layered
 * on top of it: it renders while the user has produced nothing yet and
 * disappears on its own once all three steps are complete (or the moment the
 * user dismisses it). The steps are the value loop, not a feature tour —
 * every one of them ends with the user owning something they can find again.
 */
export function FirstRunChecklist({
  bookmarkCount,
  documentCount,
  searchTried,
  onCaptureBookmark,
  onCreateDocument,
  onTrySearch,
  onDismiss,
}: FirstRunChecklistProps) {
  const { t } = useTranslation();

  const steps: ChecklistStep[] = [
    {
      key: "capture",
      icon: Bookmark,
      title: t("app_firstRunStep1Title", "Save your first bookmark"),
      description: t(
        "app_firstRunStep1Desc",
        "Capture any link. It stays on this device.",
      ),
      done: (bookmarkCount ?? 0) > 0,
      onAction: onCaptureBookmark,
    },
    {
      key: "write",
      icon: FileText,
      title: t("app_firstRunStep2Title", "Write or import a note"),
      description: t(
        "app_firstRunStep2Desc",
        "Documents are where your thinking lives.",
      ),
      done: (documentCount ?? 0) > 0,
      onAction: onCreateDocument,
    },
    {
      key: "find",
      icon: Search,
      title: t("app_firstRunStep3Title", "Find it again"),
      description: t(
        "app_firstRunStep3Desc",
        "Search everything locally — nothing leaves your device.",
      ),
      done: searchTried,
      onAction: onTrySearch,
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;

  return (
    <motion.section
      aria-labelledby="first-run-checklist-title"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION_MENU, ease: EASE_OUT }}
      className="rounded-2xl border border-[var(--divider)] ds-bg-secondary p-5 md:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest ds-text-muted">
            {t("app_firstRunEyebrow", "Getting started")}
          </p>
          <h2
            id="first-run-checklist-title"
            className="text-lg font-semibold tracking-tight ds-text-primary"
          >
            {t("app_firstRunTitle", "Your first two minutes")}
          </h2>
          <p className="text-sm ds-text-secondary">
            {t(
              "app_firstRunSubtitle",
              "Three steps, and the workspace starts working for you.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold tabular-nums ds-text-muted">
            {t("app_firstRunProgress", "{{done}} of {{total}} done", {
              done: doneCount,
              total: steps.length,
            })}
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("app_firstRunDismiss", "Hide this checklist")}
            className="p-1 rounded-full transition-colors hover:bg-[var(--state-hover-bg)]"
          >
            <X className="size-4 ds-text-muted" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Ordered list: the sequence is the point — capture first, then write,
          then prove you can get it back. */}
      <ol className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
        {steps.map((step) => {
          const StepIcon = step.icon;
          return (
            <li key={step.key}>
              <button
                type="button"
                onClick={step.onAction}
                className={`group w-full max-w-full h-full text-start flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                  step.done
                    ? "border-[var(--state-inactive-border)] ds-bg-primary"
                    : "border-[var(--divider)] hover:border-[var(--accent-primary)] ds-bg-primary"
                }`}
              >
                <span
                  className={`mt-0.5 size-6 shrink-0 rounded-full flex items-center justify-center ${
                    step.done
                      ? "ds-accent-filled"
                      : "ds-ghost-bg ds-text-muted"
                  }`}
                >
                  {step.done ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    <StepIcon className="size-3.5" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm font-semibold ${
                      step.done ? "ds-text-muted line-through" : "ds-text-primary"
                    }`}
                  >
                    {step.title}
                  </span>
                  <span className="block text-xs ds-text-secondary">
                    {step.description}
                  </span>
                  {step.done && (
                    <span className="sr-only">
                      {t("app_firstRunStepDone", "Done")}
                    </span>
                  )}
                </span>
                {!step.done && (
                  <ArrowRight
                    className="rtl-flip size-3.5 mt-1 shrink-0 ds-text-muted group-hover:translate-x-1 transition-transform"
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </motion.section>
  );
}
