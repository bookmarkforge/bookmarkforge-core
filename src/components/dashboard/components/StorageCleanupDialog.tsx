import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Download, Trash2, Loader2, HardDrive, Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import { loadBackupService } from "../../../services/pro-access";
import { securityVault } from "../../../services/SecurityVault";
import { clearAICache, type ClearAICacheResult } from "../../../services/StorageMaintenanceService";
import { garbageCollectionService } from "../../../services/GarbageCollectionService";
import { toast } from "sonner";
import { logger } from "../../../utils/logger";
import { useGuardedAction } from "../../../hooks/useGuardedAction";

const cleanupDialogCaller = {};
securityVault.registerCaller(cleanupDialogCaller);

interface StorageCleanupDialogProps {
  open: boolean;
  onClose: () => void;
  /** Quota usage as a percentage (0-100), or null when unknown. */
  percent?: number | null;
  /** Human-readable "used" size (e.g. "96 GB"). */
  usageLabel?: string;
  /** Human-readable "total" size (e.g. "100 GB"). */
  quotaLabel?: string;
}

/**
 * F0-3 follow-up: the 95 % quota warning's direct action. Opens in-place from
 * the StorageStatus pill so the user can protect their data (encrypted export
 * with the master password) and reclaim space (AI model cache) without leaving
 * the dashboard.
 */
export const StorageCleanupDialog: React.FC<StorageCleanupDialogProps> = ({
  open,
  onClose,
  percent,
  usageLabel,
  quotaLabel,
}) => {
  const { t } = useTranslation();

  const { run: runExport, isRunning: isExporting } = useGuardedAction({
    onStart: () =>
      toast.loading(
        t(
          "backup_generating",
          "Generating secure encrypted physical backup...",
        ),
      ),
    onSuccess: () => {
      toast.dismiss();
      toast.success(
        t(
          "backup_success",
          "Backup exported successfully. Keep it in a safe place!",
        ),
      );
    },
    onError: (error) => {
      toast.dismiss();
      logger.error("[StorageCleanup] Export failed:", error);
      toast.error(t("backup_error", "Failed to export backup."));
    },
  });

  const { run: runClearCache, isRunning: isClearing } = useGuardedAction<ClearAICacheResult>({
    onSuccess: (result) => {
      const mb = result.bytesFreed / (1024 * 1024);
      const sizeStr = mb >= 1
        ? `${mb.toFixed(1)} MB`
        : `${(result.bytesFreed / 1024).toFixed(0)} KB`;
      toast.success(
        t(
          "app_aiCacheClearedSize",
          "AI cache cleared — {{size}} freed.",
          { size: sizeStr },
        ),
      );
    },
    onError: (error) => {
      logger.error("[StorageCleanup] AI cache clear failed:", error);
      toast.error(t("app_aiCacheClearError", "Failed to clear AI cache."));
    },
  });

  const { run: runCompact, isRunning: isCompacting } = useGuardedAction({
    onSuccess: (result: unknown) => {
      const removed = typeof result === "number" ? result : 0;
      toast.success(
        t(
          "app_dbCompacted",
          "Database compacted successfully. Removed {{count}} deleted items.",
          { count: removed },
        ),
      );
    },
    onError: (error) => {
      logger.error("[StorageCleanup] Compact failed:", error);
      toast.error(t("app_dbCompactError", "Failed to compact database."));
    },
  });

  const handleExport = () => {
    void runExport(() =>
      securityVault.withMasterPasswordBytes(
        cleanupDialogCaller,
        async (masterPasswordBytes) => {
          // BackupService is Pro: resolved behind the hasProAccess gate.
          const backup = await loadBackupService();
          await backup.exportBackup(masterPasswordBytes ?? undefined);
        },
      ),
    );
  };

  const handleClearCache = () => {
    void runClearCache(() => clearAICache());
  };

  const handleCompact = () => {
    void runCompact(() => garbageCollectionService.triggerManualCleanup(0));
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-[var(--bg-primary)]/60 z-[500] flex items-center justify-center p-4 font-sans"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={t("app_freeUpSpaceTitle", "Storage is almost full")}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="bg-white dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-[32px] shadow-2xl max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 md:p-8">
              <div className="flex items-start justify-between mb-5">
                <div className="size-12 rounded-xl bg-amber-500/15 flex items-center justify-center border border-amber-500/30 text-amber-600 dark:text-amber-400">
                  <HardDrive className="size-6" />
                </div>
                <button
                  onClick={onClose}
                  className="p-2.5 hover:bg-[var(--state-hover-bg)] bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]/50 text-[var(--text-muted)] rounded-full transition-colors shadow-sm"
                  aria-label={t("app_close", "Close")}
                >
                  <X className="size-5" />
                </button>
              </div>

              <h2 className="text-2xl font-semibold text-[var(--text-primary)] dark:text-white tracking-tight mb-2">
                {t("app_freeUpSpaceTitle", "Storage is almost full")}
              </h2>

              {typeof percent === "number" && (
                <p className="text-4xl font-bold text-amber-600 dark:text-amber-400 mb-1">
                  {Math.round(percent)}%
                </p>
              )}

              {usageLabel !== undefined && quotaLabel !== undefined && (
                <p className="text-sm text-[var(--text-muted)] dark:text-[var(--text-muted)] mb-3">
                  {t("app_freeUpSpaceUsage", "{{used}} used of {{total}}", {
                    used: usageLabel,
                    total: quotaLabel,
                  })}
                </p>
              )}

              <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-muted)] leading-relaxed mb-6">
                {t(
                  "app_freeUpSpaceDesc",
                  "Export a backup first so your data is safe, then clear the downloaded AI models to reclaim space.",
                )}
              </p>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleExport}
                  disabled={isExporting}
                  className="truncate w-full px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 bg-cyan-700 hover:bg-cyan-800 text-white shadow-md shadow-cyan-700/20 cursor-pointer"
                >
                  {isExporting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {t("app_freeUpSpaceExport", "Export backup first")}
                </button>
                <button
                  onClick={handleClearCache}
                  disabled={isClearing}
                  className="truncate w-full px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 ds-badge-danger cursor-pointer"
                >
                  {isClearing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  {t("app_freeUpSpaceClearCache", "Clear AI models")}
                </button>
                <button
                  onClick={handleCompact}
                  disabled={isCompacting}
                  className="truncate w-full px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-600 cursor-pointer"
                >
                  {isCompacting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Database className="size-4" />
                  )}
                  {t("app_compactDatabase", "Compact Database")}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
