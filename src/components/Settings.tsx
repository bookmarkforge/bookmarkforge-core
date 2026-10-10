import React, { useRef, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";
import {
  Settings as SettingsIcon,
  X,
  RotateCcw,
  Database,
  Upload,
  Download,
  Settings as ConfigIcon,
} from "lucide-react";
import ExportDialog from "./ExportDialog";
import { useSecurityStore } from "../hooks/useSecurityStore";
import { useRxDB } from "../hooks/useRxDB";
import { loadBackupService } from "../services/pro-access";
import { logger } from "../utils/logger";
import { toast } from "sonner";
import { settingsService } from "../services/SettingsService";
import { useSettings } from "../hooks/useSettings";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useGuardedActions } from "../hooks/useGuardedActions";
import {
  AppearanceSection,
  FocusModeSection,
  CustomPromptsSection,
  AIConfigSection,
  AdvancedSection,
  IntelligentMaintenanceSection,
  ModelManagerSection,
  StorageSection,
  APIUsageDashboard,
  CloudSyncSection,
  NetworkPermissionsSection,
  ProSection,
} from "./settings/components";
import { SecuritySection } from "./settings/SecuritySection";
import { SecurityDashboard } from "./SecurityDashboard";
import { DiagnosticsModal } from "./bookmarks/DiagnosticsModal";
import { RouteErrorBoundary } from "./errors/RouteErrorBoundary";


interface SettingsProps {
  onClose: () => void;
}

export const Settings = ({ onClose }: SettingsProps) => {
  const { isDark } = useTheme();

  // Modal dialog Escape-to-close — WCAG 2.1.2 No Keyboard Trap. The dialog
  // declares role="dialog" + aria-modal, so keyboard users must be able to
  // dismiss it without reaching for a mouse. Escape is the universal close
  // convention for modal dialogs.
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);
  const {
    t,
    globalFont,
    setGlobalFont,
    globalFontSize,
    setGlobalFontSize,
    lang,
    setLang,
    apiKey,
    setApiKey,
    vaultKey,
    setVaultKey,
    masterPassword: _masterPassword,
    isUpdatingPassword,
    handleUpdateVaultKey,
    provider: _provider,
    canRunWebLLM,
    webLlmProgress,
    handleProviderChange: _handleProviderChange,
    handleApiKeySave: _handleApiKeySave,
    isDistractionFree,
    setIsDistractionFree,
    autoLockEnabled,
    setAutoLockEnabled,
    customPrompts,
    setCustomPrompts,
    handleSavePrompts,
  } = useSettings();
  const { isLocked: _isLocked } = useSecurityStore();

  const [showDiagnostics, setShowDiagnostics] = React.useState(false);

  const [showExportDialog, setShowExportDialog] = React.useState(false);
  const [importPassFile, setImportPassFile] = React.useState<File | null>(null);
  const [importPassValue, setImportPassValue] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const importTriggerRef = React.useRef<HTMLButtonElement>(null);
  const settingsFileInputRef = React.useRef<HTMLInputElement>(null);
  const {
    importBackup: { run: runImportBackup },
    importSettings: { run: runImportSettings },
  } = useGuardedActions({
    importBackup: {
      onSuccess: () => {
        toast.success(t("app_backupImportSuccess"));
        reloadTimerRef.current = setTimeout(
          () => window.location.reload(),
          1500,
        );
      },
      onError: (error) => {
        logger.error(error);
        toast.error(t("app_backupImportError"));
      },
    },
    importSettings: {
      onSuccess: () => {
        toast.success(t("app_settingsImported"));
      },
      onError: (error) => {
        logger.error(error);
        toast.error(t("app_settingsImportError"));
      },
    },
  });
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const _db = useRxDB();
  // Keep the parent dialog trap mounted while the password dialog is open.
  // The nested trap owns keyboard cycling, while the parent trap remains
  // dormant for focus already inside the child and avoids restoring focus to
  // the hidden file input during the transition.
  const mainDialogRef = useFocusTrap(true);
  const passwordDialogRef = useFocusTrap(Boolean(importPassFile), false);

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) {clearTimeout(reloadTimerRef.current);}
    };
  }, []);

  const handleExport = async () => {
    setShowExportDialog(true);
  };

  const processImport = (file: File, password?: string) => {
    // The import itself always runs (it is the requested operation); only
    // the UI effects (toast + reload) are discarded if Settings unmounts
    // while the backup is being decrypted/imported (onSuccess/onError only
    // run if the invocation is still current).
    void runImportBackup(async () => {
      // BackupService is Pro: resolved behind the hasProAccess gate.
      const backup = await loadBackupService();
      await backup.importBackup(file, password);
      if (fileInputRef.current) {fileInputRef.current.value = "";}
    });
  };

  const handleImportFileSelection = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.name.endsWith(".bmf")) {
        setImportPassFile(file);
        setImportPassValue("");
      } else {
        processImport(file);
      }
    }
  };

  const handleImportPasswordSubmit = () => {
    if (!importPassValue.trim()) {
      toast.error(t("app_passwordEmpty"));
      return;
    }
    if (importPassFile) {
      processImport(importPassFile, importPassValue);
    }
    setImportPassFile(null);
    setImportPassValue("");
    if (fileInputRef.current) {fileInputRef.current.value = "";}
    restoreImportTriggerFocus();
  };

  const restoreImportTriggerFocus = () => {
    // Wait until the nested dialog has been removed before restoring focus.
    // This keeps keyboard users on the visible Settings control rather than
    // on the hidden file input that opened the dialog.
    requestAnimationFrame(() => importTriggerRef.current?.focus());
  };

  const handleImportPasswordCancel = () => {
    setImportPassFile(null);
    setImportPassValue("");
    if (fileInputRef.current) {fileInputRef.current.value = "";}
    restoreImportTriggerFocus();
  };

  const handleExportSettings = () => {
    settingsService.downloadSettings();
    toast.success(t("app_settingsExported"));
  };

  const handleImportSettings = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) {return;}
    const file = e.target.files[0];
    void runImportSettings(async () => {
      const settings = await settingsService.uploadSettings(file);
      settingsService.importSettings(settings);
      e.target.value = "";
    });
  };

  const handleResetSettings = () => {
    if (!confirm(t("app_confirmResetSettings"))) {return;}

    try {
      // The service clears both local and secure provider settings before
      // reloading. Keep the promise observed so an unexpected failure cannot
      // become an unhandled rejection during this destructive UI action.
      void Promise.resolve(settingsService.resetSettings()).catch((error) => {
        logger.error("[Settings] Failed to reset settings", error);
      });
    } catch (error) {
      logger.error("[Settings] Failed to start settings reset", error);
    }
  };

  return (
    <>
      <RouteErrorBoundary
        fallback={
          <div className="ds-modal-overlay z-[500] p-4">
            <div className="w-full max-w-2xl p-6 ds-card text-center">
              <p className="text-sm ds-text-danger mb-4">{t("app_errorOccurred", "Settings encountered an error.")}</p>
              <button type="button" onClick={onClose} className="truncate px-4 py-2 text-sm ds-accent-filled">{t("app_close", "Close")}</button>
            </div>
          </div>
        }
      >
      <div className="ds-modal-overlay z-[500] p-4 animate-in fade-in duration-200 font-sans">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-dialog-title"
          ref={mainDialogRef}
          className="w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 max-h-[90vh] ds-card"
        >
          <div className="flex items-center justify-between p-6 ds-topbar">
            <div className="flex items-center gap-3">
              <div className="size-10 flex items-center justify-center ds-icon-tint-cyan">
                <SettingsIcon className="size-5 ds-text-accent" aria-hidden="true" />
              </div>
              <h2
                id="settings-dialog-title"
                className="text-xl font-semibold tracking-tight ds-text-primary truncate"
              >
                {t("app_settings")}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 transition-colors shadow-sm rounded-full ds-bg-secondary ds-text-secondary"
              aria-label={t("app_close", "Close")}
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-10 custom-scrollbar bg-app-bg">
            {/* General & UI */}
            <AppearanceSection
              globalFont={globalFont}
              setGlobalFont={setGlobalFont}
              globalFontSize={globalFontSize}
              setGlobalFontSize={setGlobalFontSize}
              lang={lang}
              setLang={setLang}
            />

            {/* Settings Export/Import */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2 ds-text-muted ds-text-tiny truncate">
                <ConfigIcon className="size-4" /> {t("app_settingsBackup")}
              </h3>
              <div className="space-y-5 p-5 shadow-sm ds-card">
                <p className="text-sm font-medium ds-text-secondary">
                  {t("app_settingsBackupDesc")}
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleExportSettings}
                    className="truncate flex-1 px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm ds-bg-secondary ds-text-primary border border-[var(--state-inactive-border)]"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor =
                        "var(--accent-primary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor =
                        "var(--state-inactive-border)";
                    }}
                  >
                    <Download className="size-4" /> {t("app_exportSettings")}
                  </button>
                  <button
                    onClick={() => settingsFileInputRef.current?.click()}
                    className="truncate flex-1 px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm ds-bg-secondary ds-text-primary border border-[var(--state-inactive-border)]"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor =
                        "var(--accent-primary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor =
                        "var(--state-inactive-border)";
                    }}
                  >
                    <Upload className="size-4" /> {t("app_importSettings")}
                  </button>
                  <input
                    type="file"
                    ref={settingsFileInputRef}
                    onChange={handleImportSettings}
                    accept=".json"
                    aria-label={t("app_importSettings", "Import settings")}
                    className="hidden"
                  />
                </div>
              </div>
            </section>

            <FocusModeSection
              isDistractionFree={isDistractionFree}
              setIsDistractionFree={setIsDistractionFree}
              t={t}
            />

            {/* Security health overview (read-only). Rendered ahead of the
                actionable vault controls below so the dashboard's "Security
                Settings" action scrolls down to them. */}
            <SecurityDashboard />

            {/* Security & Vault — master password + auto-lock + danger zone
                (Nuclear Forget GDPR wipe, E2E-tested) + telemetry opt-in. */}
            <SecuritySection
              vaultKey={vaultKey}
              setVaultKey={setVaultKey}
              isUpdatingPassword={isUpdatingPassword}
              onUpdatePassword={handleUpdateVaultKey}
              autoLockEnabled={autoLockEnabled}
              setAutoLockEnabled={setAutoLockEnabled}
            />

            {/* Cloud Sync (Zero-Knowledge) */}
            <CloudSyncSection />

            {/* Backup & Restore */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2 ds-text-muted ds-text-tiny truncate">
                <Database className="size-4" /> {t("app_backupRestore")}
              </h3>
              <div className="p-5 shadow-sm flex flex-col sm:flex-row gap-3 ds-card">
                <button
                  onClick={handleExport}
                  className="truncate flex-1 px-4 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors shadow-sm ds-bg-secondary ds-text-primary border border-[var(--state-inactive-border)]"
                >
                  <Download className="size-4" /> {t("app_exportData")}
                </button>
                <button
                  ref={importTriggerRef}
                  type="button"
                  onClick={() => {
                    importTriggerRef.current?.focus();
                    fileInputRef.current?.click();
                  }}
                  className="truncate flex-1 px-4 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors shadow-sm ds-bg-secondary ds-text-primary border border-[var(--state-inactive-border)]"
                >
                  <Upload className="size-4" /> {t("app_importData")}
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImportFileSelection}
                  accept=".json,.bmf,application/json,application/octet-stream"
                  aria-label={t("app_importData", "Import data")}
                  className="hidden"
                />
              </div>
            </section>

            {/* Pro / license */}
            <ProSection />

            {/* Storage Management */}
            <StorageSection />

            {/* API Usage Dashboard */}
            <APIUsageDashboard />

            {/* Network Permissions */}
            <NetworkPermissionsSection />

            {/* Model Management */}
            <ModelManagerSection />

            <AIConfigSection
              apiKey={apiKey}
              setApiKey={setApiKey}
              canRunWebLLM={canRunWebLLM}
              webLlmProgress={webLlmProgress}
              onShowDiagnostics={() => setShowDiagnostics(true)}
              t={t}
            />

            <CustomPromptsSection
              customPrompts={customPrompts}
              setCustomPrompts={setCustomPrompts}
              handleSavePrompts={handleSavePrompts}
              t={t}
            />
            <IntelligentMaintenanceSection />
            <AdvancedSection t={t} />

                </div>

          <div className="p-6 flex justify-between items-center ds-topbar">
            <button
              onClick={handleResetSettings}
              className="truncate text-sm flex items-center gap-2 font-bold px-3 py-2 transition-colors ds-text-danger"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--danger-soft)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <RotateCcw className="size-4" /> {t("app_resetSettings")}
            </button>
            <button
              onClick={onClose}
              className="truncate px-8 py-3 text-sm font-bold transition-transform hover:scale-105 active:scale-95 shadow-md ds-accent-filled"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--accent-secondary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--accent-primary)";
              }}
            >
              {t("app_close")}
            </button>
          </div>
        </div>
      </div>
      </RouteErrorBoundary>
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
      />
      {importPassFile && (
        <div className="ds-modal-overlay z-[600] p-4 animate-in fade-in duration-150">
          <div
            ref={passwordDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-password-dialog-title"
            className="w-full max-w-sm shadow-2xl p-6 animate-in zoom-in-95 duration-150 ds-card"
          >
            <h3 id="backup-password-dialog-title" className="text-lg font-semibold mb-2 ds-text-primary truncate">
              {t("app_backupImportPasswordPrompt") ||
                t("app_enterPasswordDecrypt")}
            </h3>
            <p className="text-sm mb-4 ds-text-secondary">
              {importPassFile.name}
            </p>
            <input
              type="password"
              autoFocus
              value={importPassValue}
              onChange={(e) => setImportPassValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {handleImportPasswordSubmit();}
              }}
              placeholder={t("app_masterPasswordPlaceholder")}
              aria-label={t(
                "app_enterPasswordDecrypt",
                "Enter decryption password",
              )}
              className="w-full px-4 py-3 text-sm outline-none transition-all font-mono shadow-inner mb-4 ds-input"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleImportPasswordCancel}
                className="truncate px-4 py-2 text-sm font-semibold transition-colors ds-bg-secondary ds-text-secondary border border-[var(--state-inactive-border)]"
              >
                {t("app_cancel", "Cancel")}
              </button>
              <button
                onClick={handleImportPasswordSubmit}
                className="truncate px-4 py-2 text-sm font-bold transition-colors ds-accent-filled"
              >
                {t("app_unlock", "Unlock")}
              </button>
            </div>
          </div>
        </div>
      )}
      <DiagnosticsModal
        show={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        t={t as (key: string, options?: unknown) => string}
        isDark={isDark}
      />
    </>
  );
};
