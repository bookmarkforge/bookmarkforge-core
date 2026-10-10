import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Upload,
  FileJson,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  universalImporter,
  type PocketImportPreview,
} from "../services/UniversalImporter";
import { initDB } from "../container/database";
import { logger } from "../utils/logger";
import { useTranslation } from "react-i18next";
import { useGuardedAction } from "../hooks/useGuardedAction";

interface ImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ImportOutcome = {
  success: boolean;
  imported: number;
  skipped: number;
  message?: string;
  rollbackIncomplete?: boolean;
};

export default function ImportDialog({ isOpen, onClose }: ImportDialogProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<ImportOutcome | null>(null);
  const [pocketFile, setPocketFile] = useState<File | null>(null);
  const [pocketPreview, setPocketPreview] =
    useState<PocketImportPreview | null>(null);
  const [isPreviewingPocket, setIsPreviewingPocket] = useState(false);

  const {
    runWithSignal: runImport,
    isRunning: isImporting,
    cancel: cancelImport,
  } = useGuardedAction<ImportOutcome>({
    onStart: () => {
      setImportProgress(0);
      setImportResult(null);
    },
    onSuccess: (outcome) => {
      setImportResult(outcome);
      setImportProgress(100);
    },
    onError: (err) => {
      logger.error("[ImportDialog] Import failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setImportResult({
        success: false,
        imported: 0,
        skipped: 0,
        message: t("app_importFileError", "Error processing file"),
      });
    },
  });

  const { run: runRollbackRetry, isRunning: isRetryingRollback } =
    useGuardedAction<boolean>({
      onSuccess: (completed) => {
        if (completed) {
          setImportResult(null);
        } else {
          setImportResult((previous) =>
            previous
              ? {
                  ...previous,
                  message: t(
                    "app_importRollbackRetryFailed",
                    "Cleanup is still incomplete. Please retry.",
                  ),
                  rollbackIncomplete: true,
                }
              : previous,
          );
        }
      },
      onError: (error) => {
        logger.error("[ImportDialog] Rollback retry failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        setImportResult((previous) =>
          previous
            ? {
                ...previous,
                message: t(
                  "app_importRollbackRetryFailed",
                  "Cleanup is still incomplete. Please retry.",
                ),
                rollbackIncomplete: true,
              }
            : previous,
        );
      },
    });

  // Closing the dialog is a user cancellation, not an import failure: the
  // guard's cancel aborts the signal (UniversalImporter stops mid-batch) and
  // drops the late result silently (generation no longer current). Unmount
  // auto-cancels the same way — no mountedRef needed.
  useEffect(() => {
    if (!isOpen) {cancelImport();}
  }, [isOpen, cancelImport]);

  const handleClose = () => {
    cancelImport();
    onClose();
  };

  const processFile = (file: File) => {
    void runImport(async (signal) => {
      const db = await initDB();
      // Pass the original File through so UniversalImporter can enforce its
      // size limit before reading it. Rebuilding it from file.text() doubled
      // peak memory for large imports and bypassed that early guard in the UI.
      const result = await universalImporter.importData(db, file, {
        signal,
        onProgress: (progress) => {
          if (!signal.aborted) {setImportProgress(progress);}
        },
      });
      return {
        success: result.success,
        imported: result.importedCount,
        skipped: result.skippedCount,
        message: result.error,
        rollbackIncomplete: result.rollbackIncomplete,
      };
    });
  };

  const handleRetryRollback = () => {
    void runRollbackRetry(async () => {
      const db = await initDB();
      return universalImporter.retryPendingRollback(db);
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {return;}
    setIsPreviewingPocket(true);
    void universalImporter.previewPocketFile(file)
      .then((preview) => {
        if (preview) {
          setPocketFile(file);
          setPocketPreview(preview);
          setImportResult(null);
          return;
        }
        processFile(file);
      })
      .catch((error) => {
        logger.warn("[ImportDialog] Pocket preview unavailable; importing normally", {
          error: error instanceof Error ? error.message : String(error),
        });
        processFile(file);
      })
      .finally(() => setIsPreviewingPocket(false));
  };

  const commitPocketImport = () => {
    if (!pocketFile) {return;}
    setPocketPreview(null);
    processFile(pocketFile);
  };

  const chooseAnotherFile = () => {
    setPocketFile(null);
    setPocketPreview(null);
    if (fileInputRef.current) {fileInputRef.current.value = "";}
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="ds-modal-overlay z-50 p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white dark:bg-[var(--bg-card)] rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-[var(--divider)] dark:border-[var(--divider)]">
              <h2
                id="import-dialog-title"
                className="text-xl font-semibold text-[var(--text-primary)] dark:text-[var(--text-accent)] flex items-center gap-2 min-w-0 line-clamp-2"
              >
                <Upload className="size-5 ds-text-accent" />
                {t("app_importData", "Import Data")}
              </h2>
              <button
                type="button"
                onClick={handleClose}
                aria-label={t("app_close", "Close")}
                className="truncate text-[var(--text-muted)] hover:text-[var(--text-secondary)] dark:text-[var(--text-muted)] dark:hover:text-[var(--text-secondary)]"
              >
                {t("close", "×")}
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {isPreviewingPocket && !importResult && !isImporting && (
                <div className="py-8 text-center" role="status" aria-live="polite">
                  <Loader2 className="size-8 animate-spin mx-auto mb-4 ds-text-accent" />
                  <p className="text-sm text-[var(--text-secondary)]">
                    {t("app_importPreviewing", "Checking your export...")}
                  </p>
                </div>
              )}

              {pocketPreview && !importResult && !isImporting && !isPreviewingPocket && (
                <div className="space-y-4" data-testid="pocket-import-preview">
                  <div className="p-4 rounded-xl border border-cyan-500/30 bg-cyan-500/5">
                    <p className="text-xs font-bold uppercase tracking-widest ds-text-accent mb-1">
                      {t("app_pocketImportLabel", "Coming from Pocket")}
                    </p>
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] line-clamp-2">
                      {t("app_pocketImportTitle", "Here’s what will transfer")}
                    </h3>
                    <p className="text-sm text-[var(--text-secondary)] mt-1 break-all">
                      {pocketPreview.filename}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2" aria-label={t("app_pocketImportPreviewSummary", "Pocket import preview")}>
                    <div className="p-3 rounded-lg bg-[var(--bg-secondary)]">
                      <div className="text-xl font-bold">{pocketPreview.linkCount}</div>
                      <div className="text-xs text-[var(--text-muted)]">{t("app_pocketLinks", "Links")}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-[var(--bg-secondary)]">
                      <div className="text-xl font-bold">{pocketPreview.datedCount}</div>
                      <div className="text-xs text-[var(--text-muted)]">{t("app_pocketDates", "Dates")}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-[var(--bg-secondary)]">
                      <div className="text-xl font-bold">{pocketPreview.uniqueTagCount}</div>
                      <div className="text-xs text-[var(--text-muted)]">{t("app_pocketTags", "Tags")}</div>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {t("app_pocketImportStatusSummary", "Read status and Archive labels will be kept where Pocket provides them.")}
                  </p>
                  {pocketPreview.sampleTitles.length > 0 && (
                    <ul className="text-sm text-[var(--text-secondary)] list-disc ps-5 space-y-1">
                      {pocketPreview.sampleTitles.map((title) => <li key={title} className="truncate">{title}</li>)}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={commitPocketImport} className="truncate flex-1 py-2 bg-[var(--accent-primary)] text-white rounded-lg text-sm font-bold">
                      {t("app_pocketImportConfirm", "Import these links")}
                    </button>
                    <button type="button" onClick={chooseAnotherFile} className="truncate px-3 py-2 border border-[var(--divider)] rounded-lg text-sm">
                      {t("app_pocketImportChooseAnother", "Choose another")}
                    </button>
                  </div>
                </div>
              )}

              {!pocketPreview && !isPreviewingPocket && !importResult && !isImporting && (
                <div className="border-2 border-dashed border-[var(--divider)] dark:border-[var(--divider)] rounded-xl p-8 text-center transition-all">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) =>
                      e.key === "Enter" && fileInputRef.current?.click()
                    }
                    className="hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all cursor-pointer group"
                  >
                    <div className="size-12 bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                      <FileJson className="size-6 text-[var(--text-muted)] dark:text-[var(--text-muted)]" />
                    </div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] dark:text-[var(--text-accent)] mb-1 line-clamp-2">
                      {t("app_importClick", "Click to upload file")}
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] dark:text-[var(--text-muted)]">
                      {}
                      JSON · CSV · HTML (Pocket · Raindrop · Omnivore) ·
                      Markdown/Obsidian (ZIP)
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    aria-label={t("app_importClick", "Click to upload file")}
                    accept=".json,.csv,.html,.htm,.md,.zip"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>
              )}

              {isImporting && (
                <div className="py-8 text-center" role="status" aria-live="polite">
                  <Loader2 className="size-10 animate-spin mx-auto mb-4 ds-text-accent" />
                  <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
                    {t("app_importing", "Importing data...")}
                  </p>
                  <div
                    className="w-full mt-4 bg-[var(--bg-secondary)] rounded-full h-2"
                    role="progressbar"
                    aria-label={t("app_importProgress", "Import progress")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={importProgress}
                  >
                    <div
                      className="bg-[var(--accent-primary)] h-2 rounded-full transition-all duration-300"
                      style={{ width: `${importProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {importResult && (
                <div
                  className={`p-4 rounded-xl border ${
                    importResult.success
                      ? "ds-bg-success/5 border-[var(--success-soft-border)]/20"
                      : "bg-[var(--color-danger)]/5 border-[var(--danger-soft-border)]/20"
                  }`}
                >
                  <div className="flex items-center gap-3 mb-4">
                    {importResult.success ? (
                      <CheckCircle2 className="size-6 ds-text-success" />
                    ) : (
                      <AlertCircle className="size-6 ds-text-danger" />
                    )}
                    <h3
                      className={`text-sm font-semibold line-clamp-2 ${importResult.success ? "ds-text-success" : "ds-text-danger"}`}
                    >
                      {importResult.success
                        ? t("app_importComplete", "Import Complete")
                        : t("app_importError", "Import Error")}
                    </h3>
                  </div>

                  {importResult.success && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-white dark:bg-[var(--bg-primary)]/50 rounded-lg">
                        <div className="text-xs text-[var(--text-muted)] mb-1">
                          {t("app_imported", "Imported")}
                        </div>
                        <div className="text-xl font-bold text-[var(--text-primary)] dark:text-[var(--text-accent)]">
                          {importResult.imported}
                        </div>
                      </div>
                      <div className="p-3 bg-white dark:bg-[var(--bg-primary)]/50 rounded-lg">
                        <div className="text-xs text-[var(--text-muted)] mb-1">
                          {t("app_skipped", "Skipped")}
                        </div>
                        <div className="text-xl font-bold text-[var(--text-muted)]">
                          {importResult.skipped}
                        </div>
                      </div>
                    </div>
                  )}

                  {importResult.message && (
                    <p className="text-xs ds-text-danger mt-4 px-2">
                      {importResult.message}
                    </p>
                  )}

                  {importResult.rollbackIncomplete && (
                    <button
                      type="button"
                      onClick={handleRetryRollback}
                      disabled={isRetryingRollback}
                      className="truncate w-full mt-4 py-2 border border-[var(--danger-soft-border)] ds-text-danger rounded-lg text-sm font-bold hover:opacity-80 disabled:opacity-50 transition-opacity"
                    >
                      {isRetryingRollback
                        ? t("app_importRollbackRetrying", "Cleaning up...")
                        : t("app_importRetryCleanup", "Retry cleanup")}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setImportResult(null)}
                    disabled={importResult.rollbackIncomplete || isRetryingRollback}
                    className="truncate w-full mt-6 py-2 bg-[var(--bg-primary)] dark:bg-[var(--bg-secondary)] text-white dark:text-[var(--text-primary)] rounded-lg text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {t("app_importAnother", "Import another file")}
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]/50 rounded-b-lg border-t border-[var(--divider)] dark:border-[var(--divider)]">
              <p className="text-[10px] text-[var(--text-muted)] text-center uppercase tracking-widest font-bold">
                {t(
                  "app_privacyNotice",
                  "Total Privacy: Processing is 100% local",
                )}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
