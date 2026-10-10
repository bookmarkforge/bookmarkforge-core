import React, { useState, useEffect } from "react";
import { Cloud, Loader2, Shield, Upload, FolderSync } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  cloudSyncService,
  registerLocalBackupProvider,
  CloudProvider,
  CloudSyncConfig,
} from "../../services/integrations/cloudSync";
import { securityVault } from "../../services/SecurityVault";
import { loadBackupService } from "../../services/pro-access";
import { AuthTokenFields } from "./ProviderForm/AuthTokenFields";
import { WebDAVFields } from "./ProviderForm/WebDAVFields";
import { RestoreList } from "./ProviderForm/RestoreList";
import { logger } from "../../utils/logger";
import { safeGet, safeSet } from "../../store/safeStorage";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { useGuardedActions } from "../../hooks/useGuardedActions";
import {
  DefensiveBase64Error,
  decodeDefensiveBase64,
} from "../../utils/defensive-base64";

const cloudSyncCaller = {};
securityVault.registerCaller(cloudSyncCaller);

const REMOTE_RETENTION_OPTIONS = [3, 7, 10, 30, 100] as const;
const DEFAULT_REMOTE_RETENTION = 10;
const MAX_REMOTE_BACKUP_BYTES = 100 * 1024 * 1024;

function normalizeRemoteRetention(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    REMOTE_RETENTION_OPTIONS.includes(value as (typeof REMOTE_RETENTION_OPTIONS)[number])
    ? value
    : DEFAULT_REMOTE_RETENTION;
}

/**
 * Decodes a remote backup envelope through the shared defensive decoder so
 * malformed Base64 or an oversized allocation can never reach the browser's
 * memory unchecked. Kept as a thin adapter so the UI keeps its localized
 * error mapping while validation lives in one place.
 */
export function decodeRemoteBackupBase64(data: string): Uint8Array {
  try {
    return decodeDefensiveBase64(data, MAX_REMOTE_BACKUP_BYTES, 4 * 1024 * 1024);
  } catch (error) {
    if (error instanceof DefensiveBase64Error && error.reason === "too-large") {
      throw new Error("Remote backup exceeds the 100 MB limit");
    }
    throw new Error("Invalid remote backup encoding");
  }
}

export const CloudSyncSection: React.FC = () => {
  const { t } = useTranslation();
  // Separate guard: remote-file listings can run concurrently with (and
  // after) connection/sync/restore flows without invalidating them — the
  // deliberate split the actions map below preserves by running on its own
  // useGuardedAction instance. It is imperative (takes a config, called
  // from mount + flow success paths), not a mount data-load.
  const {
    run: runFetchFiles,
    isRunning: isFetchingFiles,
  } = useGuardedAction<Array<{ id: string; name: string; modifiedTime?: string }>>({
    blockReentry: false,
    onSuccess: (files) => {
      // Filter only JSON backup files, newest first.
      const syncFiles = files
        .filter(
          (f) =>
            f.name.startsWith("bookmarkforge_sync_") &&
            f.name.endsWith(".json"),
        )
        .sort((a, b) => {
          const aTime = a.modifiedTime
            ? new Date(a.modifiedTime).getTime()
            : 0;
          const bTime = b.modifiedTime
            ? new Date(b.modifiedTime).getTime()
            : 0;
          return bTime - aTime;
        });
      setRemoteFiles(syncFiles);
    },
    onError: (err) => {
      logger.warn("[CloudSyncUI] Could not fetch remote backups list", {
        error: err,
      });
    },
  });
  const {
    test: { run: runTest, isRunning: isTesting },
    sync: { run: runSync, isRunning: isSyncing },
    restore: { run: runRestore },
  } = useGuardedActions({
    test: {
      blockReentry: false,
      onSuccess: () => {
        toast.success(
          t(
            "app_cloudTestSuccess",
            "Connection verified successfully. Provider is ready.",
          ),
        );
      },
      onError: (error) => {
        logger.error(error);
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        toast.error(t("app_cloudTestError", `Connection error: ${msg}`));
      },
    },
    sync: {
      blockReentry: false,
      onSuccess: (result) => {
        const res = result as { success: boolean; errors?: string[] };
        toast.success(
          t("app_cloudConfigSaved", "Sync settings saved securely."),
        );
        if (res.success) {
          toast.success(
            t(
              "app_cloudSyncSuccess",
              "Encrypted backup synced successfully to the cloud.",
            ),
          );
        }
      },
      onError: (error) => {
        logger.error(error);
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        toast.error(t("app_cloudSyncError", `Sync error: ${msg}`));
      },
    },
    restore: {
      blockReentry: false,
      onStart: () => {
        setIsRestoring(true);
        toast.loading(
          t(
            "app_restoringFromCloud",
            "Downloading and decrypting backup...",
          ),
        );
      },
      onSuccess: () => {
        toast.dismiss();
        toast.success(
          t(
            "app_restoreCloudSuccess",
            "Data restored successfully from the cloud!",
          ),
        );
        // Reload page to apply restored database state. Deliberately kept
        // even after unmount: the restore is a full data overwrite that must
        // complete, and the reload applies the restored database.
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      },
      onError: (error) => {
        toast.dismiss();
        setIsRestoring(false);
        logger.error(error);
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        toast.error(t("app_restoreCloudError", `Restore error: ${msg}`));
      },
    },
  });
  const [provider, setProvider] = useState<CloudProvider>("webdav");

  // Credentials state
  const [authToken, setAuthToken] = useState("");

  // WebDAV Config state
  const [webdavUrl, setWebdavUrl] = useState("");
  const [webdavUsername, setWebdavUsername] = useState("");
  const [webdavPassword, setWebdavPassword] = useState("");

  // General states
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [remoteRetentionCount, setRemoteRetentionCount] = useState(
    DEFAULT_REMOTE_RETENTION,
  );
  const [isLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [remoteFiles, setRemoteFiles] = useState<
    Array<{ id: string; name: string; modifiedTime?: string }>
  >([]);
  const [configError, setConfigError] = useState<string | null>(null);

  const getConfigValidationError = (config: CloudSyncConfig): string | null => {
    if (config.provider === "webdav") {
      const url = config.webdavConfig?.url.trim() ?? "";
      if (!url) {
        return t(
          "app_cloudConfigRequired",
          "Enter a WebDAV server URL before continuing.",
        );
      }
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return t(
            "app_cloudConfigInvalidUrl",
            "Use an HTTP or HTTPS WebDAV server URL.",
          );
        }
      } catch {
        return t(
          "app_cloudConfigInvalidUrl",
          "Enter a valid HTTP or HTTPS WebDAV server URL.",
        );
      }
    }

    if (
      ["drive", "dropbox", "onedrive", "box", "pcloud"].includes(
        config.provider,
      ) &&
      !config.authToken?.trim()
    ) {
      return t(
        "app_cloudTokenRequired",
        "Enter an access token before continuing.",
      );
    }

    return null;
  };

  const rejectInvalidConfig = (config: CloudSyncConfig): boolean => {
    const error = getConfigValidationError(config);
    if (!error) {
      setConfigError(null);
      return false;
    }
    setConfigError(error);
    toast.error(error);
    return true;
  };

  // Load configured cloud settings on mount
  useEffect(() => {
    // hasSecret/decryptSecret are async: if they resolve after unmount, the
    // late code must not set state on a component that is gone.
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const hasConfig = await securityVault.hasSecret("cloud_sync_config");
        if (cancelled) {return;}
        if (hasConfig) {
          const configStr =
            await securityVault.decryptSecret("cloud_sync_config");
          if (cancelled) {return;}
          const config = JSON.parse(configStr) as CloudSyncConfig;
          const savedConfigError = getConfigValidationError(config);
          if (savedConfigError) {
            setConfigError(savedConfigError);
            return;
          }

          setProvider(config.provider);
          setAuthToken(config.authToken || "");
          setRemoteRetentionCount(
            normalizeRemoteRetention(config.remoteRetentionCount),
          );

          if (config.webdavConfig) {
            setWebdavUrl(config.webdavConfig.url);
            setWebdavUsername(config.webdavConfig.username || "");
            setWebdavPassword(config.webdavConfig.password || "");
          }

          // Initialize cloud service instance
          cloudSyncService.init(config);

          // Load automatic sync flag
          const autoSync = safeGet(STORAGE_KEYS.AUTO_SYNC_CLOUD) === "true";
          setAutoSyncEnabled(autoSync);

          // Retrieve remote files if sync is verified
          void fetchRemoteFiles(config);
        }
      } catch (err) {
        if (cancelled) {return;}
        logger.error("[CloudSyncUI] Failed to load config", err);
      }
    };
    loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchRemoteFiles = (config?: CloudSyncConfig) => {
    // isFetchingFiles doubles as the loading indicator: it stays true on
    // supersede until the newer listing settles, exactly like the old
    // isFetchCurrent-gated setIsLoadingFiles.
    void runFetchFiles(async () => {
      if (config) {
        cloudSyncService.init(config);
      }
      return cloudSyncService.listFiles();
    });
  };

  const getFormConfig = (): CloudSyncConfig => {
    const config: CloudSyncConfig = {
      provider,
      remoteRetentionCount: normalizeRemoteRetention(remoteRetentionCount),
    };

    if (["drive", "dropbox", "onedrive", "box", "pcloud"].includes(provider)) {
      config.authToken = authToken.trim();
    } else if (provider === "webdav") {
      config.webdavConfig = {
        url: webdavUrl.trim(),
        username: webdavUsername || undefined,
        password: webdavPassword || undefined,
      };
    }

    return config;
  };

  const handleTestConnection = () => {
    const config = getFormConfig();
    if (rejectInvalidConfig(config)) {return;}

    void runTest(async () => {
      cloudSyncService.init(config);
      await cloudSyncService.authenticate();

      // Successfully authenticated, let's try a simple file listing to confirm
      await cloudSyncService.listFiles();

      // Save configuration securely
      await securityVault.encryptSecret(
        JSON.stringify(config),
        "cloud_sync_config",
      );

      void fetchRemoteFiles(config);
    });
  };

  const handleSaveAndSync = () => {
    const config = getFormConfig();
    if (rejectInvalidConfig(config)) {return;}

    void runSync(async () => {
      // 1. Initialize and Save Config Securely
      cloudSyncService.init(config);
      await securityVault.encryptSecret(
        JSON.stringify(config),
        "cloud_sync_config",
      );

      // 2. Register the shared encrypted local provider used by startup sync.
      registerLocalBackupProvider(cloudSyncService);

      // 3. Trigger Sync
      const result = await cloudSyncService.sync();
      if (result.success) {
        void fetchRemoteFiles(config);
      } else {
        throw new Error(
          result.errors?.join(", ") || t("cloud_syncError", "Synchronization failed."),
        );
      }
      return result;
    });
  };

  const handleToggleAutoSync = (enabled: boolean) => {
    setAutoSyncEnabled(enabled);
    safeSet(STORAGE_KEYS.AUTO_SYNC_CLOUD, enabled ? "true" : "false");
    toast.success(
      enabled
        ? t("app_autoSyncEnabled", "Auto-sync enabled on startup.")
        : t("app_autoSyncDisabled", "Auto-sync disabled."),
    );
  };

  const handleRestoreFromCloud = async (fileId: string, fileName: string) => {
    if (
      !confirm(
        t(
          "app_confirmRestoreCloud",
          "Are you sure you want to restore this backup? Current local data will be overwritten.",
        ),
      )
    ) {
      return;
    }

    void runRestore(async () => {
      // 1. Download buffer
      const buffer = await cloudSyncService.downloadFile(fileId);

      // 2. Convert buffer to string and validate the remote envelope.
      // The downloaded file is untrusted: require a plain object with a
      // string `data` field so malformed JSON or a non-string payload fails
      // with a friendly message instead of leaking a raw SyntaxError or
      // reaching atob() with a non-string value.
      const textDecoder = new TextDecoder();
      const rawText = textDecoder.decode(buffer);

      let parsedRemote: unknown;
      try {
        parsedRemote = JSON.parse(rawText);
      } catch {
        parsedRemote = null;
      }

      const syncObj =
        parsedRemote &&
        typeof parsedRemote === "object" &&
        !Array.isArray(parsedRemote)
          ? (parsedRemote as Record<string, unknown>)
          : null;

      if (
        !syncObj ||
        !syncObj.encrypted ||
        typeof syncObj.data !== "string" ||
        !syncObj.data
      ) {
        throw new Error(
          t(
            "cloud_restoreInvalidFormat",
            "The remote backup does not have a valid encrypted format.",
          ),
        );
      }

      // 3. Verify the remote version's HMAC sidecar BEFORE decoding or
      // decrypting: truncation/tampering is detected on the raw downloaded
      // bytes at the cheapest possible point. Legacy backups without a
      // sidecar proceed (status "missing"); a present-but-invalid tag aborts
      // the restore before any database access.
      const integrity = await cloudSyncService.verifyRemoteBackup(
        buffer,
        fileName,
      );
      if (integrity.status === "mismatch") {
        throw new Error(
          t(
            "cloud_restoreIntegrityFailed",
            "Integrity check failed: this remote backup was truncated or modified. Restore aborted.",
          ),
        );
      }

      // 4. Validate and decode Base64 before allocating the temporary file.
      let bytes: Uint8Array;
      try {
        bytes = decodeRemoteBackupBase64(syncObj.data);
      } catch {
        throw new Error(
          t(
            "cloud_restoreInvalidFormat",
            "The remote backup does not have a valid encrypted format.",
          ),
        );
      }

      // 5. Create local temporary File for import
      const tempFile = new File([bytes.buffer as ArrayBuffer], "temp_backup.bmf", {
        type: "application/octet-stream",
      });

      // 6. Get current master password to decrypt (scoped to this call only)
      await securityVault.withMasterPasswordBytes(
        cloudSyncCaller,
        async (passwordBytes) => {
          if (!passwordBytes) {
            throw new Error("Vault is locked. Enter your password first.");
          }
          // 7. Import Backup (Pro service, resolved behind the gate)
          const backup = await loadBackupService();
          await backup.importBackup(tempFile, passwordBytes);
        },
      );
    });
  };

  return (
    <section data-testid="settings-cloud-sync" className="space-y-4">
      <h3 className="text-xs font-semibold text-[var(--text-muted)] dark:text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2">
        <Cloud className="size-4 text-cyan-500" />{" "}
        {t("cloudSyncTitle", "Cloud Sync (Zero-Knowledge)")}
      </h3>

      <div className="space-y-5 p-5 bg-white dark:bg-[var(--bg-primary)] rounded-2xl border border-[var(--divider)] dark:border-[var(--divider)] shadow-sm transition-all duration-200">
        <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-muted)] font-medium leading-relaxed">
          {t(
            "cloudSyncDescription",
            "Protect your local data by syncing military-grade end-to-end encrypted backups to your own cloud storage.",
          )}{" "}
          <span className="text-cyan-600 dark:text-cyan-400 font-semibold">
            {t(
              "privacyGuarantee",
              "Your passwords and tokens never leave your device and are stored encrypted locally.",
            )}
          </span>
        </p>

        {/* Provider Selector */}
        <div className="space-y-2">
          <span className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            {t("cloudProvider", "Proveedor de la Nube")}
          </span>
          <select
            aria-label={t("cloudProviderLabel", "Proveedor de Nube")}
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as CloudProvider);
              setConfigError(null);
            }}
            className="w-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] dark:text-white outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-semibold shadow-inner"
          >
            <option value="webdav">
              {t("webdavOption", "WebDAV")}
            </option>
            <option value="drive">
              {t("googleDriveOption", "Google Drive")}
            </option>
            <option value="dropbox">{t("dropboxOption", "Dropbox")}</option>
            <option value="onedrive">
              {t("onedriveOption", "Microsoft OneDrive")}
            </option>
            <option value="box">{t("boxOption", "Box")}</option>
            <option value="pcloud">{t("pcloudOption", "pCloud")}</option>
          </select>
        </div>

        {/* Dynamic Credentials Form */}
        <div className="pt-4 border-t border-[var(--divider)] dark:border-[var(--divider)] space-y-4">
          {["drive", "dropbox", "onedrive", "box", "pcloud"].includes(
            provider,
          ) && (
            <AuthTokenFields
              authToken={authToken}
              onChange={(value) => {
                setAuthToken(value);
                setConfigError(null);
              }}
              t={t}
            />
          )}
          {provider === "webdav" && (
            <WebDAVFields
              url={webdavUrl}
              username={webdavUsername}
              password={webdavPassword}
              onUrlChange={(value) => {
                setWebdavUrl(value);
                setConfigError(null);
              }}
              onUsernameChange={setWebdavUsername}
              onPasswordChange={setWebdavPassword}
              t={t}
            />
          )}
        </div>

        {configError && (
          <p
            role="alert"
            data-testid="cloud-sync-config-error"
            className="text-xs font-semibold text-red-600 dark:text-red-400"
          >
            {configError}
          </p>
        )}

        {/* Remote retention */}
        <div className="space-y-2 pt-2">
          <label
            htmlFor="cloud-remote-retention"
            className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]"
          >
            {t("cloudRemoteRetention", "Remote backup retention")}
          </label>
          <select
            id="cloud-remote-retention"
            aria-label={t(
              "cloudRemoteRetentionLabel",
              "Remote backup retention",
            )}
            value={remoteRetentionCount}
            onChange={(e) =>
              setRemoteRetentionCount(normalizeRemoteRetention(Number(e.target.value)))
            }
            className="w-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] dark:text-white outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-semibold shadow-inner"
          >
            {REMOTE_RETENTION_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count === 100
                  ? t("cloudRemoteRetentionMany", "100 backups (maximum)")
                  : t("cloudRemoteRetentionCount", {
                      count,
                      defaultValue: `${count} backups`,
                    })}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-[var(--text-muted)]">
            {t(
              "cloudRemoteRetentionDescription",
              "Older timestamped backups are removed when the provider supports safe deletion.",
            )}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={handleTestConnection}
            disabled={isTesting || isLoading || isSyncing}
            className="truncate flex-1 bg-[var(--bg-secondary)] hover:bg-[var(--state-hover-bg)] dark:bg-[var(--bg-card)] dark:hover:bg-[var(--state-hover-bg)] text-[var(--text-secondary)] dark:text-[var(--text-accent)] px-4 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.98] disabled:opacity-50"
          >
            {isTesting ? (
              <Loader2 className="size-4 animate-spin text-cyan-500" />
            ) : (
              <Shield className="size-4" />
            )}
            {isTesting
              ? t("verifying", "Verifying...")
              : t("testConnection", "Test Connection")}
          </button>

          <button
            onClick={handleSaveAndSync}
            disabled={isSyncing || isLoading || isTesting}
            className="truncate flex-1 bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-cyan-500/10 active:scale-[0.98] disabled:opacity-50"
          >
            {isSyncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {isSyncing
              ? t("syncing", "Syncing...")
              : t("saveAndSync", "Save and Sync")}
          </button>
        </div>

        {/* Auto Sync Toggle */}
        <div className="flex items-center justify-between p-3.5 bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-primary)]/40 rounded-xl border border-[var(--divider)] dark:border-[var(--divider)]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 dark:bg-cyan-500/20 rounded-lg">
              <FolderSync className="size-4 text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)] dark:text-[var(--text-muted)]">
                {t("autoSyncTitle", "Auto Sync")}
              </h4>
              <p className="text-[11px] text-[var(--text-muted)]">
                {t(
                  "autoSyncDescription",
                  "Quietly syncs and backs up your data when you open and unlock the app.",
                )}
              </p>
            </div>
          </div>
          <button
            onClick={() => handleToggleAutoSync(!autoSyncEnabled)}
            className={`relative w-12 h-6 rounded-full transition-colors duration-300 ease-in-out focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] focus-visible:outline-offset-2 shadow-inner ${
              autoSyncEnabled
                ? "bg-cyan-500"
                : "bg-[var(--bg-card)] dark:bg-[var(--bg-secondary)]"
            }`}
            role="switch"
            aria-checked={autoSyncEnabled}
            aria-label={t("autoSyncLabel", "Auto Sync")}
          >
            <span
              className={`absolute top-[2px] left-[2px] size-5 bg-white rounded-full shadow-md transition-transform duration-300 ease-in-out ${
                autoSyncEnabled ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      <RestoreList
        files={remoteFiles}
        isLoading={isFetchingFiles}
        isRestoring={isRestoring}
        onRestore={handleRestoreFromCloud}
        t={t}
      />
    </section>
  );
};
