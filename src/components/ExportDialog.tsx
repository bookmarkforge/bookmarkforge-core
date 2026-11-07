import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Download,
  FileText,
  Database,
  Calendar,
  Tag,
  Filter,
  Settings,
} from "lucide-react";
import { universalExporter } from "../services/UniversalExporter";
import { initDB } from "../container/database";
import { logger } from "../utils/logger";
import { downloadBlob } from "../utils/download";
import { useTranslation } from "react-i18next";
import type { ExportResult } from "../services/exporter.types";
import { useGuardedAction } from "../hooks/useGuardedAction";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ExportDialog({ isOpen, onClose }: ExportDialogProps) {
  const { t } = useTranslation();
  // mountedRef is redundant with the guard: unmount auto-cancels it, and the
  // helper drops every late result/error/progress update (progress gates on
  // the signal, which the guard aborts on unmount/cancel/newer export).
  const {
    runWithSignal,
    isRunning: isExporting,
    cancel,
  } = useGuardedAction<ExportResult>({
    onStart: () => {
      setExportProgress(0);
      setExportResult(null);
    },
    onSuccess: (result) => {
      if (result.success) {
        downloadBlob(result.blob, result.filename);
        setExportProgress(100);
        setExportResult({
          success: true,
          message: t("app_exportSuccess"),
          filename: result.filename,
        });
      } else {
        // Aborts surface as success:false (UniversalExporter never throws
        // for AbortError); the guard already dropped them via the generation
        // check, so a stale cancel is never shown as a failure here.
        setExportProgress(100);
        setExportResult({
          success: false,
          message: result.error || t("app_exportError"),
        });
      }
    },
    onError: (err) => {
      logger.error("[ExportDialog] Export failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setExportProgress(100);
      setExportResult({ success: false, message: t("app_exportError") });
    },
  });
  const [exportProgress, setExportProgress] = useState(0);
  const [exportResult, setExportResult] = useState<{
    success: boolean;
    message: string;
    filename?: string;
  } | null>(null);

  const [exportOptions, setExportOptions] = useState<{
    format:
      | "notion"
      | "obsidian"
      | "json"
      | "jsonl"
      | "csv"
      | "markdown"
      | "html";
    includeEmbeddings: boolean;
    includeFolders: boolean;
    dateRange: { start: Date; end: Date } | undefined;
    tags: string[];
    searchQuery: string;
  }>({
    format: "json",
    includeEmbeddings: false,
    includeFolders: false,
    dateRange: undefined,
    tags: [],
    searchQuery: "",
  });

  useEffect(() => {
    if (!isOpen) {
      cancel();
      setExportProgress(0);
    }
  }, [cancel, isOpen]);

  const handleClose = () => {
    cancel();
    setExportProgress(0);
    onClose();
  };

  const handleExport = async () => {
    if (isExporting) {return;}
    await runWithSignal(async (signal) => {
      const db = await initDB();
      return universalExporter.exportData(db, {
        ...exportOptions,
        signal,
        onProgress: (progress) => {
          if (!signal.aborted) {
            setExportProgress(progress);
          }
        },
      });
    });
  };

  const formats = [
    {
      value: "json" as const,
      label: "JSON",
      icon: Database,
      description: "app_exportJsonDesc",
    },
    {
      value: "jsonl" as const,
      label: "JSONL",
      icon: Database,
      description: "app_exportJsonlDesc",
    },
    {
      value: "csv" as const,
      label: "CSV",
      icon: FileText,
      description: "app_exportCSVDesc",
    },
    {
      value: "markdown" as const,
      label: "Markdown",
      icon: FileText,
      description: "app_exportMarkdownDesc",
    },
    {
      value: "html" as const,
      label: "HTML",
      icon: FileText,
      description: "app_exportHTMLDesc",
    },
    {
      value: "notion" as const,
      label: "Notion",
      icon: Database,
      description: "app_exportNotionDesc",
    },
    {
      value: "obsidian" as const,
      label: "Obsidian",
      icon: FileText,
      description: "app_exportObsidianDesc",
    },
  ];

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
            className="bg-white dark:bg-[var(--bg-card)] rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-[var(--divider)] dark:border-[var(--divider)]">
              <h2
                id="export-dialog-title"
                className="text-xl font-semibold text-[var(--text-primary)] dark:text-[var(--text-accent)] flex items-center gap-2 min-w-0 line-clamp-2"
              >
                <Download className="size-5 text-blue-500" />
                {t("app_exportData")}
              </h2>
              <button
                type="button"
                onClick={handleClose}
                aria-label={t("app_close", "Close")}
                className="truncate text-[var(--text-muted)] hover:text-[var(--text-secondary)] dark:text-[var(--text-muted)] dark:hover:text-[var(--text-secondary)]"
              >
                {t("app_close", "×")}
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {/* Format Selection */}
              <div className="mb-6">
                <span className="block text-sm font-medium text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-2">
                  {t("app_exportFormat")}
                </span>
                <div
                  className="grid grid-cols-2 md:grid-cols-3 gap-3"
                  role="radiogroup"
                  aria-label={t("app_exportFormat")}
                >
                  {formats.map((format) => (
                    <button
                      key={format.value}
                      type="button"
                      role="radio"
                      aria-checked={exportOptions.format === format.value}
                      onClick={() =>
                        setExportOptions({
                          ...exportOptions,
                          format: format.value,
                        })
                      }
                      className={`truncate p-3 rounded-lg border-2 transition-colors ${
                        exportOptions.format === format.value
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                          : "border-[var(--divider)] dark:border-[var(--divider)] hover:border-[var(--divider)] dark:hover:border-[var(--divider)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]"
                      }`}
                    >
                      <format.icon className="size-4 mb-2 mx-auto" />
                      <div className="text-sm font-medium">{format.label}</div>
                      <div className="text-xs text-[var(--text-muted)] dark:text-[var(--text-muted)] mt-1">
                        {t(format.description)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Advanced Options */}
              <div className="space-y-4 mb-6">
                <h3 className="text-sm font-medium text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-3 flex items-center gap-2 line-clamp-2">
                  <Settings className="size-4" />
                  {t("app_exportAdvanced")}
                </h3>

                {/* Date Range */}
                <div className="flex items-center gap-4">
                  <Calendar className="size-4 text-[var(--text-muted)]" />
                  <div className="flex-1">
                    <span className="block text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">
                      {t("app_exportDateRange")}
                    </span>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        aria-label={t("app_exportStartDate", "Start date")}
                        className="flex-1 px-3 py-2 border border-[var(--divider)] dark:border-[var(--divider)] rounded-md text-sm"
                        placeholder={t("app_exportStartDate")}
                        onChange={(e) =>
                          setExportOptions({
                            ...exportOptions,
                            dateRange: exportOptions.dateRange
                              ? {
                                  ...exportOptions.dateRange,
                                  start: new Date(e.target.value),
                                }
                              : {
                                  start: new Date(e.target.value),
                                  end: new Date(),
                                },
                          })
                        }
                      />
                      <input
                        type="date"
                        aria-label={t("app_exportEndDate", "End date")}
                        className="flex-1 px-3 py-2 border border-[var(--divider)] dark:border-[var(--divider)] rounded-md text-sm"
                        placeholder={t("app_exportEndDate")}
                        onChange={(e) =>
                          setExportOptions({
                            ...exportOptions,
                            dateRange: exportOptions.dateRange
                              ? {
                                  ...exportOptions.dateRange,
                                  end: new Date(e.target.value),
                                }
                              : {
                                  start: new Date(),
                                  end: new Date(e.target.value),
                                },
                          })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Tags Filter */}
                <div className="flex items-center gap-4">
                  <Tag className="size-4 text-[var(--text-muted)]" />
                  <div className="flex-1">
                    <span className="block text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">
                      {t("app_exportTags")}
                    </span>
                    <input
                      type="text"
                      aria-label={t("app_exportTags", "Filter by tags")}
                      className="w-full px-3 py-2 border border-[var(--divider)] dark:border-[var(--divider)] rounded-md text-sm"
                      placeholder={t("app_exportTagsPlaceholder")}
                      value={exportOptions.tags.join(", ")}
                      onChange={(e) =>
                        setExportOptions({
                          ...exportOptions,
                          tags: e.target.value
                            .split(",")
                            .map((tag) => tag.trim())
                            .filter((tag) => tag.length > 0),
                        })
                      }
                    />
                  </div>
                </div>

                {/* Search Filter */}
                <div className="flex items-center gap-4">
                  <Filter className="size-4 text-[var(--text-muted)]" />
                  <div className="flex-1">
                    <span className="block text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1">
                      {t("app_exportSearch")}
                    </span>
                    <input
                      type="text"
                      aria-label={t("app_exportSearch", "Search query")}
                      className="w-full px-3 py-2 border border-[var(--divider)] dark:border-[var(--divider)] rounded-md text-sm"
                      placeholder={t("app_exportSearchPlaceholder")}
                      value={exportOptions.searchQuery}
                      onChange={(e) =>
                        setExportOptions({
                          ...exportOptions,
                          searchQuery: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>

                {/* Include Options */}
                <div className="space-y-3">
                  <label
                    className="flex items-center gap-2"
                    htmlFor="includeEmbeddings"
                  >
                    <input
                      id="includeEmbeddings"
                      type="checkbox"
                      aria-label={t("app_exportIncludeEmbeddings")}
                      className="rounded border-[var(--divider)] dark:border-[var(--divider)] text-blue-600 focus:ring-blue-500"
                      checked={exportOptions.includeEmbeddings}
                      onChange={(e) =>
                        setExportOptions({
                          ...exportOptions,
                          includeEmbeddings: e.target.checked,
                        })
                      }
                    />
                    <span className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      {t("app_exportIncludeEmbeddings")}
                    </span>
                  </label>

                  <label
                    className="flex items-center gap-2"
                    htmlFor="includeFolders"
                  >
                    <input
                      id="includeFolders"
                      type="checkbox"
                      aria-label={t("app_exportIncludeFolders")}
                      className="rounded border-[var(--divider)] dark:border-[var(--divider)] text-blue-600 focus:ring-blue-500"
                      checked={exportOptions.includeFolders}
                      onChange={(e) =>
                        setExportOptions({
                          ...exportOptions,
                          includeFolders: e.target.checked,
                        })
                      }
                    />
                    <span className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      {t("app_exportIncludeFolders")}
                    </span>
                  </label>
                </div>
              </div>

              {/* Export Progress */}
              <AnimatePresence>
                {isExporting && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mb-4"
                  >
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="size-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm text-blue-700 dark:text-blue-300">
                          {t("app_exporting")}
                        </span>
                      </div>
                      <div
                        className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2"
                        role="progressbar"
                        aria-label={t("app_exportProgress", "Export progress")}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={exportProgress}
                      >
                        <div
                          className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${exportProgress}%` }}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Export Result */}
              <AnimatePresence>
                {exportResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={`p-4 rounded-lg ${
                      exportResult.success
                        ? "ds-bg-success-soft dark:ds-bg-success/20 border border-[var(--success-soft-border)] dark:border-[var(--success-soft-border)]"
                        : "bg-[var(--danger-soft)] dark:bg-[var(--color-danger)]/20 border border-[var(--danger-soft-border)] dark:border-[var(--danger-soft-border)]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {exportResult.success ? (
                        <>
                          <div className="size-8 ds-bg-success-soft dark:ds-bg-success rounded-full flex items-center justify-center">
                            <Download className="size-4 ds-text-success dark:ds-text-success" />
                          </div>
                          <div>
                            <p className="font-medium ds-text-success dark:ds-text-success">
                              {t("app_exportSuccess")}
                            </p>
                            <p className="text-sm ds-text-success dark:ds-text-success mt-1">
                              {exportResult.filename}
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="size-8 bg-[var(--danger-soft)] dark:bg-[var(--color-danger)] rounded-full flex items-center justify-center">
                            <FileText className="size-4 ds-text-danger dark:ds-text-danger" />
                          </div>
                          <div>
                            <p className="font-medium ds-text-danger dark:ds-text-danger">
                              {t("app_exportError")}
                            </p>
                            <p className="text-sm ds-text-danger dark:ds-text-danger mt-1">
                              {exportResult.message}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 p-6 border-t border-[var(--divider)] dark:border-[var(--divider)]">
              <button
                onClick={handleClose}
                className="truncate px-4 py-2 text-[var(--text-secondary)] dark:text-[var(--text-secondary)] bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] rounded-md text-sm font-medium transition-colors"
              >
                {t("app_cancel")}
              </button>
              <button
                onClick={handleExport}
                disabled={isExporting || !exportOptions.format}
                className="truncate px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isExporting ? t("app_exporting") : t("app_export")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
