import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Copy,
  Download,
  Loader2,
  Play,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { SUPPORTED_LANGUAGES } from "../../constants/locales";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useTranslationSession } from "../../hooks/useTranslationSession";
import type { TranslationEngineId } from "../../modules/translation";
import TranslationCostBanner from "./TranslationCostBanner";
import TranslationRow from "./TranslationRow";

export interface TranslationWorkspaceProps {
  /** Opens on mount; the editor mounts this lazily only while visible. */
  onClose: () => void;
  documentId: string;
  title: string;
  sourceText: string;
}

function formatModelSize(bytes: number, locale: string): string {
  if (bytes <= 0) {return "0 MB";}
  const gigabytes = bytes / 1_000_000_000;
  const value =
    gigabytes >= 1 ? gigabytes.toFixed(1) : (bytes / 1_000_000).toFixed(0);
  try {
    return gigabytes >= 1
      ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value))} GB`
      : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(value))} MB`;
  } catch {
    // INTENTIONAL SILENCE: an invalid locale only affects digit grouping.
    return gigabytes >= 1 ? `${value} GB` : `${value} MB`;
  }
}

/**
 * Bilingual reading view: source on the left, editable translation on the
 * right, streamed chunk by chunk.
 *
 * Scroll synchronization is structural rather than JS-coupled: both columns live
 * in ONE scroll container, and every paragraph pair is a two-cell grid row, so
 * the cells of a row always share a height. There is no scroll handler to
 * drift, no feedback loop between two panes, and nothing to throttle while
 * tokens arrive.
 */
export default function TranslationWorkspace({
  onClose,
  documentId,
  title,
  sourceText,
}: TranslationWorkspaceProps) {
  const { t, i18n } = useTranslation();
  const containerRef = useFocusTrap(true);
  const session = useTranslationSession({ documentId, title, sourceText });
  const isRunning = session.status === "running";

  /**
   * The header must state what this run actually does with the text. An
   * explicit local engine is safe to describe before it runs; an explicit
   * cloud engine is disclosed as such; `auto` stays neutral until the selector
   * resolves it, because a Free session with only a BYOK key will go to the
   * cloud — and "nothing is uploaded" would then be false. Anything unknown
   * (probes still running) also stays neutral rather than guessing.
   */
  const selectedEngine =
    session.engineChoice === "auto"
      ? null
      : session.engines.find((engine) => engine.id === session.engineChoice);
  const staysLocal =
    selectedEngine?.isLocal ??
    (session.engineChoice === "auto" ? session.resolvedIsLocal : null);
  const subtitleKey =
    staysLocal === true
      ? "translation_subtitle"
      : staysLocal === false
        ? "translation_subtitleCloud"
        : "translation_subtitleUnknown";
  const hasTranslation = session.assembledText.trim().length > 0;

  const close = () => {
    session.cancel();
    onClose();
  };

  const save = async () => {
    await session.saveAsDocument();
    toast.success(t("translation_saved"));
  };

  const progressPercent =
    session.total > 0
      ? Math.min(100, Math.round((session.completed / session.total) * 100))
      : 0;

  return (
    <div className="ds-modal-overlay z-50 p-2 md:p-4" role="presentation">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="translation-workspace-title"
        data-testid="translation-workspace"
        className="mx-auto flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[var(--divider)] bg-white shadow-2xl dark:bg-[var(--bg-card)]"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--divider)] p-3 md:p-4">
          <div className="min-w-0">
            <h2
              id="translation-workspace-title"
              className="flex max-w-full items-center gap-2 text-base font-semibold text-[var(--text-primary)] md:text-lg"
            >
              <Sparkles className="size-4 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
              {t("translation_title")}
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{title}</p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {t(subtitleKey)}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("app_close")}
            className="shrink-0 rounded-full p-2 text-[var(--text-muted)] hover:bg-[var(--state-hover-bg)]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Language + engine controls */}
        <div className="grid grid-cols-1 gap-2 border-b border-[var(--divider)] p-3 sm:grid-cols-3 md:p-4">
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {t("translation_sourceLanguage")}
            <select
              value={session.sourceLocale}
              onChange={(event) => session.setSourceLocale(event.target.value)}
              disabled={isRunning}
              className="rounded-md border border-[var(--divider)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm normal-case tracking-normal text-[var(--text-primary)] disabled:opacity-60"
            >
              {SUPPORTED_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {t("translation_targetLanguage")}
            <select
              value={session.targetLocale}
              onChange={(event) => session.setTargetLocale(event.target.value)}
              disabled={isRunning}
              className="rounded-md border border-[var(--divider)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm normal-case tracking-normal text-[var(--text-primary)] disabled:opacity-60"
            >
              {SUPPORTED_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {t("translation_engine")}
            <select
              value={session.engineChoice}
              onChange={(event) =>
                session.setEngineChoice(event.target.value as TranslationEngineId | "auto")
              }
              disabled={isRunning}
              className="rounded-md border border-[var(--divider)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm normal-case tracking-normal text-[var(--text-primary)] disabled:opacity-60"
            >
              <option value="auto">{t("translation_engineAuto")}</option>
              {session.engines.map((engine) => {
                const isProLocked = engine.unavailableReason === "pro-required";
                const isBlocked = Boolean(engine.unavailableReason) && !isProLocked;
                return (
                  <option key={engine.id} value={engine.id} disabled={isBlocked}>
                    {engine.label}
                    {isProLocked
                      ? ` · ${t("translation_proOnly")}`
                      : isBlocked
                        ? ` · ${t("translation_unavailable")}`
                        : ""}
                  </option>
                );
              })}
            </select>
          </label>
        </div>

        {session.engineLabel && (
          <div className="border-b border-[var(--divider)] px-4 py-1.5 text-[11px] text-[var(--text-muted)]">
            {session.engineLabel}
            {session.modelId ? ` · ${session.modelId}` : ""}
          </div>
        )}

        {/* Bilingual body: one scroll container, paired grid rows */}
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="translation-body">
          <div className="sticky top-0 z-10 grid grid-cols-2 border-b border-[var(--divider)] bg-white/95 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] backdrop-blur dark:bg-[var(--bg-card)]/95">
            <div className="px-3 py-2 md:px-5">{t("translation_sourceLanguage")}</div>
            <div className="border-l border-[var(--divider)] px-3 py-2 md:px-5">
              {t("translation_targetLanguage")}
            </div>
          </div>

          {session.rows.length === 0 ? (
            <div className="grid grid-cols-2">
              <div
                dir="auto"
                className="whitespace-pre-wrap break-words px-3 py-4 text-sm leading-relaxed text-[var(--text-primary)] md:px-5"
              >
                {sourceText.trim() ? sourceText : t("translation_empty")}
              </div>
              <div className="border-l border-[var(--divider)] px-3 py-4 text-sm text-[var(--text-muted)] md:px-5">
                {t("translation_editHint")}
              </div>
            </div>
          ) : (
            session.rows.map((row) => (
              <TranslationRow
                key={row.index}
                row={row}
                editable={row.status === "done"}
                onChange={session.updateRow}
              />
            ))
          )}
        </div>

        {session.errorKey && (
          <div
            role="alert"
            className="flex items-start gap-2 border-t border-[var(--divider)] bg-red-500/10 px-4 py-2 text-xs text-red-700 dark:text-red-300"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{t(session.errorKey)}</span>
          </div>
        )}

        {/* Download consent (on-demand models) */}
        {session.pendingConsent && (
          <div
            className="border-t border-[var(--divider)] bg-cyan-500/5 p-4"
            data-testid="translation-consent"
          >
            <h3 className="flex max-w-full items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Download className="size-4" aria-hidden="true" />
              {t("translation_downloadTitle")}
            </h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {t("translation_downloadBody", {
                model: session.pendingConsent.modelId,
                size: formatModelSize(
                  session.pendingConsent.downloadBytes,
                  i18n.language,
                ),
              })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void session.confirmDownload()}
                className="truncate rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700"
              >
                {t("translation_downloadConfirm")}
              </button>
              <button
                type="button"
                onClick={session.dismissConsent}
                className="truncate rounded-md bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]"
              >
                {t("app_cancel")}
              </button>
            </div>
          </div>
        )}

        <TranslationCostBanner
          totalUSD={session.cost.totalUSD}
          savedUSD={session.cost.savedUSD}
          isFreePlan={session.cost.isFreePlan}
        />

        {/* Status + actions */}
        <div className="flex flex-col gap-3 border-t border-[var(--divider)] p-3 md:flex-row md:items-center md:justify-between md:p-4">
          <div className="min-w-0 flex-1">
            {isRunning && (
              <>
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  <span aria-live="polite">
                    {session.modelProgress?.stage === "download"
                      ? t("translation_downloading", {
                          percent: Math.round(session.modelProgress.progress * 100),
                        })
                      : session.modelProgress?.stage === "init"
                        ? t("translation_loadingModel")
                        : t("translation_progress", {
                            done: session.completed,
                            total: session.total,
                          })}
                  </span>
                </div>
                <div
                  className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-secondary)]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent}
                >
                  <div
                    className="h-full bg-cyan-600 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </>
            )}
            {!isRunning && session.status === "done" && (
              <span className="text-xs text-[var(--text-muted)]">
                {t("translation_progress", {
                  done: session.completed,
                  total: session.total,
                })}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {isRunning ? (
              <button
                type="button"
                onClick={session.cancel}
                className="truncate rounded-md bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]"
              >
                {t("app_cancel")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void session.start()}
                disabled={!sourceText.trim()}
                className="truncate inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {session.status === "done" || session.status === "error" ? (
                  <Sparkles className="size-3.5" aria-hidden="true" />
                ) : (
                  <Play className="size-3.5" aria-hidden="true" />
                )}
                {session.status === "done" || session.status === "error"
                  ? t("app_retry")
                  : t("translation_start")}
              </button>
            )}

            {hasTranslation && (
              <>
                <button
                  type="button"
                  onClick={() => void session.copyTranslation()}
                  className="truncate inline-flex items-center gap-1.5 rounded-md bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]"
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  {t("app_copy")}
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={session.isSaving}
                  className="truncate inline-flex items-center gap-1.5 rounded-md bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] disabled:opacity-50"
                >
                  <Save className="size-3.5" aria-hidden="true" />
                  {t("translation_saveDocument")}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={close}
              className="truncate rounded-md bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]"
            >
              {t("app_close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
