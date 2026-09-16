import React, { useState, useRef, useEffect } from "react";
import {
  HardDrive,
  Trash2,
  Loader2,
  Database,
  Download,
  Upload,
  FolderOpen,
} from "lucide-react";
import { loadBackupService, loadDiskBackupService } from "../../services/pro-access";
import { clearAICache } from "../../services/StorageMaintenanceService";
import type { BackupFolderInfo } from "../../services/DiskBackupService";
import { useTranslation } from "react-i18next";
import { initDB } from "../../container/database";
import { garbageCollectionService } from "../../services/GarbageCollectionService";
import { toast } from "sonner";
import { logger } from "../../utils/logger";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";

interface CollectionDB {
  documents: {
    find: (filter?: { limit?: number }) => { exec: () => Promise<unknown[]> };
  };
  bookmarks: {
    find: (filter?: { limit?: number }) => { exec: () => Promise<unknown[]> };
  };
  chunks: {
    find: (filter?: { limit?: number }) => { exec: () => Promise<unknown[]> };
  };
}

async function measureCacheResponseBytes(
  response: Response,
  signal?: AbortSignal,
): Promise<number> {
  if (signal?.aborted) {return 0;}

  const contentLength = response.headers?.get("content-length");
  const headerSize = contentLength ? Number(contentLength) : NaN;
  if (Number.isFinite(headerSize) && headerSize >= 0) {return headerSize;}

  const body = response.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    let total = 0;
    let abortListener: (() => void) | undefined;
    try {
      if (signal) {
        abortListener = () => {
          const cancel = (reader as typeof reader & {
            cancel?: () => Promise<void>;
          }).cancel;
          if (typeof cancel === "function") {
            void cancel.call(reader).catch(() => undefined);
          }
        };
        signal.addEventListener("abort", abortListener, { once: true });
      }
      while (true) {
        if (signal?.aborted) {return 0;}
        const { done, value } = await reader.read();
        if (done) {break;}
        total += value?.byteLength || 0;
      }
      return signal?.aborted ? 0 : total;
    } finally {
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
      reader.releaseLock();
    }
  }

  // Keep compatibility with Cache API mocks and older browsers without a
  // readable body. This fallback is only used when streaming is unavailable.
  const blob = await response.blob();
  return signal?.aborted ? 0 : blob.size;
}

export const StorageSection: React.FC = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState({
    documentsBytes: 0,
    vectorsBytes: 0,
    aiCacheBytes: 0,
    totalBytes: 0,
    quotaBytes: 0,
  });

  // The AbortController + generation + mountedRef triple collapses into the
  // guard: each load() supersedes the previous measurement (begin aborts the
  // prior signal, dropping its late stats) and unmount auto-cancels. The
  // loader re-checks signal.aborted at every await boundary exactly like the
  // hand-written controller gates did.
  const { load: calculateStorage, loading: isCalculating } =
    useGuardedDataLoad(
      async (signal): Promise<typeof stats> => {
        let documentsBytes = 0;
        let vectorsBytes = 0;
        let aiCacheBytes = 0;

        // Calculate IndexedDB sizes (approximate)
        const db = (await initDB()) as unknown as CollectionDB;
        if (signal.aborted) {throw new DOMException("Aborted", "AbortError");}
        const STORAGE_EST_LIMIT = 2_000;
        const docs = await db.documents
          .find({ limit: STORAGE_EST_LIMIT })
          .exec();
        if (signal.aborted) {throw new DOMException("Aborted", "AbortError");}
        const bookmarks = await db.bookmarks
          .find({ limit: STORAGE_EST_LIMIT })
          .exec();
        if (signal.aborted) {throw new DOMException("Aborted", "AbortError");}
        const chunks = await db.chunks
          .find({ limit: STORAGE_EST_LIMIT })
          .exec();
        if (signal.aborted) {throw new DOMException("Aborted", "AbortError");}

        documentsBytes += JSON.stringify(docs).length;
        documentsBytes += JSON.stringify(bookmarks).length;
        vectorsBytes += JSON.stringify(chunks).length;

        // Calculate Cache Storage size (AI models)
        if ("caches" in window) {
          const cacheKeys = await caches.keys();
          if (signal.aborted) {throw new DOMException("Aborted", "AbortError");}
          for (const key of cacheKeys) {
            if (signal.aborted) {throw new DOMException("Aborted", "AbortError");}
            if (
              key.includes("webllm") ||
              key.includes("transformers") ||
              key.includes("models")
            ) {
              const cache = await caches.open(key);
              if (signal.aborted) {throw new DOMException("Aborted", "AbortError");}
              const requests = await cache.keys();
              if (signal.aborted) {throw new DOMException("Aborted", "AbortError");}
              for (const request of requests) {
                if (signal.aborted) {throw new DOMException("Aborted", "AbortError");}
                const response = await cache.match(request);
                if (response) {
                  aiCacheBytes += await measureCacheResponseBytes(
                    response,
                    signal,
                  );
                }
              }
            }
          }
        }

        // Get quota
        let quotaBytes = 0;
        if (navigator.storage && navigator.storage.estimate) {
          const estimate = await navigator.storage.estimate();
          if (signal.aborted) {throw new DOMException("Aborted", "AbortError");}
          quotaBytes = estimate.quota || 0;
        }

        return {
          documentsBytes,
          vectorsBytes,
          aiCacheBytes,
          totalBytes: documentsBytes + vectorsBytes + aiCacheBytes,
          quotaBytes,
        };
      },
      {
        onSuccess: (computed) => setStats(computed),
        onError: (e: unknown) => {
          logger.error(
            "Error calculating storage:",
            e instanceof Error ? e.message : String(e),
          );
        },
      },
    );

  const { run: runCompact, isRunning: isCompacting } =
    useGuardedAction<{ totalDeleted: number }>({
      onSuccess: (result) => {
        toast.success(
          t(
            "app_dbCompacted",
            "Database compacted successfully. Removed {{count}} deleted items.",
            { count: result.totalDeleted },
          ),
        );
        void calculateStorage();
      },
      onError: () => {
        toast.error(t("app_dbCompactError", "Failed to compact database."));
      },
    });

  const { run: runClearCache, isRunning: isClearingAICache } =
    useGuardedAction<unknown>({
      onSuccess: () => {
        toast.success(t("app_aiCacheCleared", "AI cache cleared successfully."));
        void calculateStorage();
      },
      onError: () => {
        toast.error(t("app_aiCacheClearError", "Failed to clear AI cache."));
      },
    });

  const formatBytes = (bytes: number) => {
    if (bytes === 0) {return "0 B";}
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleClearAICache = () => {
    if (
      !confirm(
        t(
          "app_confirmClearAICache",
          "Are you sure you want to clear downloaded AI models? They will need to be re-downloaded to work offline.",
        ),
      )
    ) {
      return;
    }

    void runClearCache(() => clearAICache());
  };

  const handleCompactDB = () => {
    // Pass the operation directly (no async wrapper): the guard's runWithSignal
    // awaits it, so an extra arrow-function microtask would delay onSuccess by
    // a tick and let a concurrently started refresh (Clear AI Models) abort
    // this measurement before it reaches the first find().exec — the original
    // inline `await calculateStorage()` resumed in the same tick.
    void runCompact(() => garbageCollectionService.triggerManualCleanup(0));
  };

  const { run: runExport, isRunning: isExporting } =
    useGuardedAction<void>({
      onSuccess: () => {
        toast.success(t("app_backupExported", "Backup exported successfully."));
      },
      onError: () => {
        toast.error(t("app_backupExportError", "Failed to export backup."));
      },
    });

  const { run: runImport, isRunning: isImporting } = useGuardedAction<void>({
    onSuccess: () => {
      toast.success(t("app_backupImported", "Backup imported successfully."));
      void calculateStorage();
    },
    onError: () => {
      toast.error(
        t(
          "app_backupImportError",
          "Failed to import backup. Please check your password or file integrity.",
        ),
      );
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportBackup = () => {
    const encrypt = confirm(
      t(
        "app_encryptBackupPrompt",
        "Do you want to encrypt the backup with a password? (If yes, you will need the password to restore it. If no, the backup will be saved in plaintext JSON.)",
      ),
    );
    let password: string | undefined;
    if (encrypt) {
      password =
        prompt(
          t(
            "app_enterBackupPassword",
            "Enter a password to encrypt this backup:",
          ),
        ) ?? undefined;
      if (!password) {
        toast.error(
          t(
            "app_passwordRequired",
            "Password is required to create an encrypted backup.",
          ),
        );
        return;
      }
    }
    // BackupService is Pro: resolved behind the hasProAccess gate.
    void runExport(async () => (await loadBackupService()).exportBackup(password));
  };

  const handleImportBackup = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {return;}

    let password: string | undefined;
    if (file.name.endsWith(".bmf")) {
      password =
        prompt(
          t(
            "app_enterDecryptPassword",
            "This backup is encrypted. Please enter the password to decrypt it:",
          ),
        ) ?? undefined;
      if (!password) {
        toast.error(
          t(
            "app_decryptPasswordRequired",
            "Password is required to restore an encrypted backup.",
          ),
        );
        if (fileInputRef.current) {fileInputRef.current.value = "";}
        return;
      }
    }
    void runImport(async () => (await loadBackupService()).importBackup(file, password)).finally(
      () => {
        if (fileInputRef.current) {fileInputRef.current.value = "";}
      },
    );
  };

  // Disk Backup (F0-1): folder configuration for the real-filesystem copy
  // of the daily encrypted auto-backup (Chrome/Edge picker; Firefox/Safari
  // fall back to Downloads automatically).
  const [folderInfo, setFolderInfo] = useState<BackupFolderInfo | null>(null);
  const { load: loadFolderInfo } = useGuardedDataLoad(
    async () => (await loadDiskBackupService()).getBackupFolderInfo(),
    {
      onSuccess: setFolderInfo,
      onError: () => {
        logger.warn("[Storage] Failed to load disk backup folder info");
      },
    },
  );

  useEffect(() => {
    void loadFolderInfo();
  }, [loadFolderInfo]);

  const { run: runPickFolder, isRunning: isPickingFolder } =
    useGuardedAction<{ name: string } | null>({
      onSuccess: (result) => {
        if (result) {
          toast.success(
            t(
              "app_diskBackupFolderPicked",
              "Backup folder selected: {{name}}",
              { name: result.name },
            ),
          );
        }
        void loadFolderInfo();
      },
      onError: () => {
        toast.error(
          t("app_diskBackupFolderError", "Could not set the backup folder."),
        );
      },
    });

  const { run: runClearFolder, isRunning: isClearingFolder } =
    useGuardedAction<void>({
      onSuccess: () => {
        toast.success(
          t("app_diskBackupFolderCleared", "Disk backups disabled."),
        );
        void loadFolderInfo();
      },
      onError: () => {
        toast.error(
          t(
            "app_diskBackupFolderClearError",
            "Could not disable disk backups.",
          ),
        );
      },
    });

  const handlePickBackupFolder = () => {
    void runPickFolder(async () => (await loadDiskBackupService()).pickBackupFolder());
  };
  const handleClearBackupFolder = () => {
    void runClearFolder(async () => (await loadDiskBackupService()).clearBackupFolder());
  };

  const docsPercentage = stats.totalBytes
    ? (stats.documentsBytes / stats.totalBytes) * 100
    : 0;
  const vectorsPercentage = stats.totalBytes
    ? (stats.vectorsBytes / stats.totalBytes) * 100
    : 0;
  const aiPercentage = stats.totalBytes
    ? (stats.aiCacheBytes / stats.totalBytes) * 100
    : 0;

  return (
    <section data-testid="settings-storage" className="space-y-4">
      <h3 className="ds-label-section flex items-center gap-2">
        <HardDrive className="size-4" />{" "}
        {t("app_storageManager", "Storage Manager")}
      </h3>

      <div className="space-y-5 p-5 rounded-2xl shadow-sm ds-card">
        {isCalculating ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="size-8 animate-spin ds-text-accent" />
            <p className="ds-body-secondary text-sm ds-text-muted">
              {t("app_calculatingStorage", "Calculating storage usage...")}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between mb-2">
              <div>
                <span className="ds-display-numeric">
                  {formatBytes(stats.totalBytes)}
                </span>
                <span className="ds-body-secondary ms-2">
                  {t("app_usedOf", "used of")} {formatBytes(stats.quotaBytes)}
                </span>
              </div>
            </div>

            {/* Storage Bar — categorical palette for data slices (documents/vectors/AI). */}
            <div className="w-full h-4 rounded-full flex overflow-hidden shadow-inner mb-6 ds-bg-muted">
              <div
                style={{
                  width: `${Math.max(docsPercentage, 2)}%`,
                  background: "var(--accent-primary)",
                }}
                title={t("app_storageDocuments", "Documents: {{size}}", {
                  size: formatBytes(stats.documentsBytes),
                })}
              />
              <div
                style={{
                  width: `${Math.max(vectorsPercentage, 2)}%`,
                  background: "var(--color-success)",
                }}
                title={t("app_storageVectors", "Vectors: {{size}}", {
                  size: formatBytes(stats.vectorsBytes),
                })}
              />
              <div
                style={{
                  width: `${Math.max(aiPercentage, 2)}%`,
                  background: "var(--quota-fill)",
                }}
                title={t("app_storageAiModels", "AI Models: {{size}}", {
                  size: formatBytes(stats.aiCacheBytes),
                })}
              />{" "}
              {/* AI slice color sourced from --quota-fill (categorical). */}
            </div>

            {/* Legend */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="size-3 rounded-full shadow-sm ds-bg-accent-primary" />
                <div>
                  <p className="text-xs font-bold ds-text-primary">
                    {t("app_storageDocs", "Documents & Data")}
                  </p>
                  <p className="ds-body-secondary text-xs">
                    {formatBytes(stats.documentsBytes)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="size-3 rounded-full shadow-sm ds-bg-success" />
                <div>
                  <p className="text-xs font-bold ds-text-primary">
                    {t("app_storageVectorsLabel", "Vector Embeddings")}
                  </p>
                  <p className="ds-body-secondary text-xs">
                    {formatBytes(stats.vectorsBytes)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="size-3 rounded-full shadow-sm"
                  style={{ background: "var(--quota-fill)" }}
                />{" "}
                {/* AI slice color sourced from --quota-fill (categorical). */}
                <div>
                  <p className="text-xs font-bold ds-text-primary">
                    {t("app_storageAi", "AI Models")}
                  </p>
                  <p className="ds-body-secondary text-xs">
                    {formatBytes(stats.aiCacheBytes)}
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-[var(--divider)] dark:border-[var(--divider)]/50">
              <button
                onClick={handleCompactDB}
                disabled={isCompacting}
                className="truncate flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-sm ds-bg-secondary ds-border ds-text-primary"
              >
                {isCompacting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Database className="size-4" />
                )}
                {t("app_compactDatabase", "Compact Database")}
              </button>

              <button
                onClick={handleClearAICache}
                disabled={isClearingAICache || stats.aiCacheBytes === 0}
                className="truncate flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm ds-badge-danger"
              >
                {isClearingAICache ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                {t("app_clearAiModels", "Clear AI Models")}
              </button>
            </div>

            {/* Backup & Restore */}
            <div className="space-y-3 pt-4 ds-divider-t">
              <h4 className="text-xs font-bold uppercase tracking-wider ds-text-primary truncate">
                {t("app_backupRestore", "Backup & Restore")}
              </h4>
              <p className="ds-body-secondary text-xs">
                {t(
                  "app_backupNotice",
                  "Create a local backup file (.json or encrypted .bmf) to secure your bookmarks and documents against browser storage evictions.",
                )}
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleExportBackup}
                  disabled={isExporting}
                  className="truncate flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-sm ds-bg-secondary ds-border ds-text-primary"
                >
                  {isExporting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {t("app_exportBackup", "Export Backup")}
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                  className="truncate flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-sm ds-bg-secondary ds-border ds-text-primary"
                >
                  {isImporting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  {t("app_importBackup", "Import Backup")}
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  aria-label={t("app_importBackup", "Import Backup")}
                  onChange={handleImportBackup}
                  accept=".json,.bmf"
                  className="hidden"
                />
              </div>

              {/* Disk Backup — real-filesystem copy (F0-1) */}
              <div className="space-y-2 pt-3 ds-divider-t">
                <h4 className="text-xs font-bold uppercase tracking-wider ds-text-primary truncate">
                  {t("app_diskBackup", "Disk Backup")}
                </h4>
                <p className="ds-body-secondary text-xs">
                  {t(
                    "app_diskBackupDesc",
                    "Automatically save an encrypted daily backup to a folder on your device — clearing browser data can never destroy your vault.",
                  )}
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handlePickBackupFolder}
                    disabled={isPickingFolder || !folderInfo?.supported}
                    className="truncate flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-sm ds-bg-secondary ds-border ds-text-primary disabled:opacity-50"
                  >
                    {isPickingFolder ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <FolderOpen className="size-4" />
                    )}
                    {folderInfo?.configured
                      ? t(
                          "app_diskBackupChangeFolder",
                          "Change backup folder",
                        )
                      : t(
                          "app_diskBackupChooseFolder",
                          "Choose backup folder",
                        )}
                  </button>
                  {folderInfo?.configured && folderInfo.supported && (
                    <button
                      onClick={handleClearBackupFolder}
                      disabled={isClearingFolder}
                      className="truncate flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-sm ds-badge-danger"
                    >
                      <Trash2 className="size-4" />
                      {t("app_diskBackupDisable", "Stop disk backups")}
                    </button>
                  )}
                </div>
                {folderInfo?.supported === false && (
                  <p className="ds-body-secondary text-xs ds-text-muted">
                    {t(
                      "app_diskBackupNotSupported",
                      "This browser can't choose a folder — daily backups are saved to your Downloads folder instead.",
                    )}
                  </p>
                )}
                {folderInfo?.supported && folderInfo.configured && (
                  <p className="ds-body-secondary text-xs ds-text-muted">
                    {t(
                      "app_diskBackupFolderStatus",
                      "Backup folder: {{name}}",
                      { name: folderInfo.name ?? "" },
                    )}
                    {folderInfo.permission === "denied" &&
                      ` — ${t(
                        "app_diskBackupPermissionDenied",
                        "permission lost — backups will be saved to Downloads",
                      )}`}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
