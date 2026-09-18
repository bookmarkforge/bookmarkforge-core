import React from "react";
import { motion } from "motion/react";
import { ShieldCheck, HardDriveDownload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  loadBackupService,
  ProUnavailableError,
  announceProUnavailable,
} from "../../../services/pro-access";
import { securityVault } from "../../../services/SecurityVault";
import { toast } from "sonner";
import { logger } from "../../../utils/logger";
import { safeSet } from "../../../store/safeStorage";
import { STORAGE_KEYS } from "../../../constants/storage-keys";
import { useGuardedAction } from "../../../hooks/useGuardedAction";
import { DURATION_COLLAPSE } from "../../../constants/motion";
import { CollapsibleSurface } from "./CollapsibleSurface";

const backupBannerCaller = {};
securityVault.registerCaller(backupBannerCaller);

interface BackupReminderBannerProps {
  show: boolean;
  /**
   * The show decision is pending (ADR-055 hold): the surface reserves its
   * measured height behind a shimmer; content stays hidden until `show`.
   */
  pending?: boolean;
  /** null = never backed up; number = age in ms of the latest backup */
  backupAgeMs: number | null;
  onDismiss: () => void;
}

export const BackupReminderBanner: React.FC<BackupReminderBannerProps> = ({
  show,
  pending = false,
  backupAgeMs,
  onDismiss,
}) => {
  const { t } = useTranslation();
  // blockReentry (default true) replaces exportInFlightRef; onStart creates
  // the toast.loading. The banner can unmount while the backup is
  // generated: onSuccess/onError only run if the guard is still current.
  const { run: runExport } = useGuardedAction({
    onStart: () => {
      toast.loading(
        t(
          "backup_generating",
          "Generating secure encrypted physical backup...",
        ),
      );
    },
    onSuccess: () => {
      toast.dismiss();
      toast.success(
        t(
          "backup_success",
          "Backup exported. Store a copy outside this device — cloud, USB or email — before you need it.",
        ),
        { duration: 8000 },
      );
      safeSet(STORAGE_KEYS.LAST_MANUAL_BACKUP_DATE, Date.now().toString());
      onDismiss();
    },
    onError: (error) => {
      toast.dismiss();
      logger.error("Failed to export backup via banner:", error);
      if (error instanceof ProUnavailableError) {
        // Encrypted backups are Pro: explain instead of a bare "failed"
        // — the shared panel names the feature and links to the license.
        announceProUnavailable(error);
        return;
      }
      toast.error(t("backup_error", "Failed to export backup."));
    },
  });

  const handleExportBackup = () => {
    void runExport(() =>
      // withMasterPasswordBytes scopes the password reference to this call.
      securityVault.withMasterPasswordBytes(
        backupBannerCaller,
        async (masterPasswordBytes) => {
          // BackupService is Pro: resolved behind the hasProAccess gate.
          const backup = await loadBackupService();
          await backup.exportBackup(masterPasswordBytes ?? undefined);
        },
      ),
    );
  };

  return (
    <CollapsibleSurface
      show={show}
      pending={pending}
      className="mb-6"
      testId="backup-reminder-surface"
    >
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: show ? 1 : 0, y: show ? 0 : -10 }}
        transition={{ duration: DURATION_COLLAPSE }}
        style={{ pointerEvents: show ? 'auto' : 'none' }}
      >
          <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 ds-bg-hover">
            <div className="relative p-5 md:p-6 flex items-start gap-4">
              <div className="shrink-0 size-12 rounded-xl bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
                <ShieldCheck className="size-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-cyan-800 dark:text-cyan-200 mb-1 flex items-center gap-2">
                  {backupAgeMs !== null
                    ? t(
                        "backup_bannerStaleTitle",
                        "Your backup is overdue \u23F0",
                      )
                    : t(
                        "backup_bannerTitle",
                        "Protect Your Knowledge Vault: Everything is Local \uD83D\uDD12",
                      )}
                </h3>
                <p className="text-sm text-cyan-900 dark:text-cyan-200 leading-relaxed mb-2">
                  {backupAgeMs !== null
                    ? t(
                        "backup_bannerStaleDesc",
                        "Your last backup is over 48 hours old. Your vault may have changed since then \u2014 export a fresh copy to stay protected.",
                      )
                    : t(
                        "backup_bannerDesc",
                        "BookmarkForge prioritizes your privacy by keeping all bookmarks, summaries, and documents exclusively on this device. However, if you clear your browser history, run out of disk space, or your browser clears IndexedDB data, you could lose your vault. We highly recommend exporting a physical backup file periodically.",
                      )}
                </p>
                <p className="text-xs text-cyan-800/90 dark:text-cyan-300/90 leading-relaxed mb-4 font-medium">
                  {t(
                    "backup_offsiteRule",
                    "Golden rule: a backup on the same device is not a backup. Keep copies in at least two places — e.g. cloud storage (Google Drive, Dropbox, OneDrive) and a USB drive, or email the file to yourself.",
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleExportBackup}
                    className="truncate inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-700 hover:bg-cyan-800 text-white text-sm font-bold shadow-md shadow-cyan-700/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    <HardDriveDownload className="size-4" />
                    {t("backup_exportBtn", "Export Physical Backup File")}
                  </button>
                  <button
                    onClick={onDismiss}
                    className="truncate inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-cyan-700 dark:text-cyan-400 text-sm font-medium hover:bg-cyan-500/10 transition-colors cursor-pointer"
                  >
                    <X className="size-4" />
                    {t("backup_dismissBtn", "Got it, remind me later")}
                  </button>
                </div>
              </div>
            </div>
          </div>
      </motion.div>
    </CollapsibleSurface>
  );
};
