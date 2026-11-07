import React, { useEffect, useRef, useState } from "react";
import {
  X,
  BookOpen,
  Shield,
  Sparkles,
  Database,
  ArrowRight,
  Check,
  Loader2,
  HardDriveDownload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeGet, safeRemove, safeSet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { toast } from "sonner";
import { loadBackupService } from "../services/pro-access";
import { compactAge } from "./StorageStatus";
import { logger } from "../utils/logger";

const RESTORE_SUCCESS_PENDING_KEY = STORAGE_KEYS.RESTORE_SUCCESS_PENDING;

interface OnboardingProps {
  onComplete: () => void;
  /**
   * True when the vault contains no bookmarks/documents (e.g. a fresh
   * install or a browser site-data clear). When set, the wizard opens on a
   * restore-first screen so a returning user can recover their data before
   * anything new is created (roadmap F0-2).
   */
  vaultIsEmpty?: boolean;
}

const STEPS = [
  {
    id: "welcome",
    icon: BookOpen,
    titleKey: "app_onboardingWelcome",
    titleDefault: "Welcome to BookmarkForge",
    descriptionKey: "app_onboardingWelcomeDesc",
    descriptionDefault:
      "Smart search is included free — Raindrop charges yearly for it. Free works on any device with no device cap, while your private vault stays local and encrypted.",
  },
  {
    id: "privacy",
    icon: Shield,
    titleKey: "app_onboardingPrivacy",
    titleDefault: "100% Private by Default",
    descriptionKey: "app_onboardingPrivacyDesc",
    descriptionDefault:
      "Your bookmarks, notes, and AI conversations are encrypted and stored locally. No cloud, no tracking, no data collection.",
  },
  {
    id: "ai",
    icon: Sparkles,
    titleKey: "app_onboardingAI",
    titleDefault: "AI That Runs on Your Device",
    descriptionKey: "app_onboardingAIDesc",
    descriptionDefault:
      "BookmarkForge can run AI models directly in your browser using your GPU. No API keys needed. You can also connect cloud providers like Gemini, OpenAI, or Claude.",
  },
  {
    id: "backup",
    icon: Database,
    titleKey: "app_onboardingBackup",
    titleDefault: "Your Data, Your Control",
    descriptionKey: "app_onboardingBackupDesc",
    descriptionDefault:
      "Export your data anytime as an encrypted backup. Auto-backups run every 24 hours to protect against data loss.",
  },
];

export const Onboarding: React.FC<OnboardingProps> = ({
  onComplete,
  vaultIsEmpty = false,
}) => {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [showRecovery, setShowRecovery] = useState(vaultIsEmpty);
  const [importing, setImporting] = useState<"file" | "auto" | null>(null);
  const [autoBackupAvailable, setAutoBackupAvailable] = useState(false);
  const [autoBackupAge, setAutoBackupAge] = useState<number | null>(null);
  const [manualExportAge, setManualExportAge] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const step = STEPS[currentStep]!;
  const Icon = step.icon;
  const isLast = currentStep === STEPS.length - 1;

  // Modal dialog semantics — WCAG 4.1.2 Name/Role/Value + 2.1.2 No Keyboard
  // Trap. Focus moves into the dialog on mount so keyboard users land on the
  // first interactive control instead of tabbing through the overlay backdrop.
  // Escape closes the wizard (equivalent to the visible skip button) so
  // keyboard users are never trapped.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // F0-2: `vaultIsEmpty` arrives asynchronously — AppContent counts the
  // collections after the db is ready, which can land AFTER this wizard
  // first mounts. Sync INTO recovery mode when the vault turns out empty so
  // a returning user whose browser data was cleared sees the restore screen
  // before the welcome steps. Deliberately one-way: a restore or a later
  // data addition must not flip the wizard back (mirrors AppContent's
  // "computed once per db instance" contract).
  useEffect(() => {
    if (vaultIsEmpty) {
      setShowRecovery(true);
    }
  }, [vaultIsEmpty]);

  // The restore-first screen checks whether an in-browser automatic backup
  // exists so the "restore from automatic backup" action is only offered when
  // it can actually succeed.
  // F0-3 recovery sources: probe both auto-backup and manual export dates
  // so the user sees what's available and how old it is before choosing.
  useEffect(() => {
    if (safeGet(RESTORE_SUCCESS_PENDING_KEY) === "true") {
      safeRemove(RESTORE_SUCCESS_PENDING_KEY);
      toast.success(t("onboarding_restoreSuccess", "Vault restored successfully."));
    }
  }, [t]);

  useEffect(() => {
    if (!showRecovery) {return;}
    let cancelled = false;
    loadBackupService()
      .then((BackupService) => BackupService.getAutoBackupInfo())
      .then((info) => {
        if (!cancelled) {
          setAutoBackupAvailable(info.available);
          setAutoBackupAge(info.age ?? null);
        }
      })
      .catch((error: unknown) => {
        logger.warn("[Onboarding] Auto-backup availability check failed", {
          error,
        });
        if (!cancelled) {
          setAutoBackupAvailable(false);
          setAutoBackupAge(null);
        }
      });
    // Manual export date
    try {
      const raw = safeGet("forge_last_manual_backup_date");
      const ts = raw ? parseInt(raw, 10) : NaN;
      if (!cancelled && Number.isFinite(ts)) {
        setManualExportAge(Date.now() - ts);
      }
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
  }, [showRecovery]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      finish();
    }
  };

  /** Completes onboarding: persists the flag and closes the wizard. */
  const finish = () => {
    safeSet(STORAGE_KEYS.ONBOARDING_COMPLETE, "true");
    onComplete();
  };

  const handleNext = () => {
    if (isLast) {
      finish();
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
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
        return;
      }
    }

    setImporting("file");
    try {
      await (await loadBackupService()).importBackup(file, password);
      logger.info("[Onboarding] Restore import completed", {
        fileName: file.name,
        fileSize: file.size,
      });
      safeSet(RESTORE_SUCCESS_PENDING_KEY, "true");
      // Remove any stale toast from the pre-restore screen before the reload;
      // otherwise Sonner can briefly preserve an old error node while the
      // restored app is booting, making a successful restore look failed to
      // assistive tech and end-to-end observers.
      //
      // COSMETIC, so it must never be able to abort the reboot: by this point
      // the import has committed (records in the DB, pending-restore flag
      // written). A throw here used to fall into the catch below and report
      // "Could not restore the backup" about a restore that had SUCCEEDED,
      // skipping the reload while leaving the flag armed — so the next boot
      // claimed success. Guarded on purpose; the regression test is
      // "reboots after a successful restore even if the toast cleanup fails".
      try {
        toast.dismiss();
      } catch (error) {
        logger.warn("[Onboarding] Toast cleanup before restore reload failed", {
          error,
        });
      }
      // importBackup writes through a fresh RxDB instance. Reboot the app so
      // the live database/query subscriptions are recreated and display the
      // restored records instead of retaining the pre-restore empty snapshot.
      window.location.reload();
    } catch (error) {
      logger.warn("[Onboarding] Restore from file failed", {
        error,
        fileName: file.name,
        fileSize: file.size,
      });
      toast.error(
        t(
          "onboarding_restoreError",
          "Could not restore the backup. Check the file and password.",
        ),
      );
    } finally {
      setImporting(null);
    }
  };

  const handleRestoreAuto = async () => {
    setImporting("auto");
    try {
      const restored = await (await loadBackupService()).restoreFromAutoBackup();
      if (restored) {
        toast.success(t("onboarding_restoreSuccess", "Vault restored successfully."));
        finish();
      } else {
        toast.error(t("onboarding_noAutoBackup", "No automatic backup was found."));
      }
    } catch (error) {
      logger.warn("[Onboarding] Restore from auto-backup failed", { error });
      toast.error(
        t(
          "onboarding_restoreError",
          "Could not restore the backup. Check the file and password.",
        ),
      );
    } finally {
      setImporting(null);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[1000] flex items-center justify-center ds-bg-black-80 ${
        prefersReducedMotion ? "" : "animate-in fade-in duration-300"
      }`}
    >
      {/* intentional — extra-dark overlay vs standard var(--modal-overlay) */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-dialog-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`w-full max-w-lg mx-4 shadow-2xl overflow-hidden ds-card outline-none ${
          prefersReducedMotion ? "" : "animate-in zoom-in-95 duration-300"
        }`}
      >
        <div className="p-8">
          <div className="flex items-center justify-between mb-6">
            {/* Decorative step indicator — hidden from assistive tech. The
                aria-hidden lives on the dots wrapper ONLY so the skip button
                next to it stays in the accessibility tree (WCAG 4.1.2). */}
            <div aria-hidden="true" className="flex items-center gap-2">
              {showRecovery ? (
                <Database className="size-4 ds-text-accent" />
              ) : (
                STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === currentStep
                        ? "w-8 bg-accent"
                        : i < currentStep
                          ? "w-4 bg-accent/50"
                          : "w-4 bg-[var(--state-inactive-border)]"
                    }`}
                  />
                ))
              )}
            </div>
            <button
              onClick={finish}
              className="p-2 transition-colors rounded-full"
              aria-label={t("onboarding_skip", "Skip onboarding")}
            >
              <X className="size-4 ds-text-muted" />
            </button>
          </div>

          {showRecovery ? (
            /* Restore-first screen (F0-2): an empty vault may mean browser
               site data was cleared — offer restore before anything new. */
            <div className="flex flex-col items-center text-center">
              <div className="size-16 flex items-center justify-center mb-6 ds-icon-tint-cyan ds-radius-widget">
                <Database className="size-8 ds-text-accent" />
              </div>

              <h2
                id="onboarding-dialog-title"
                className="text-2xl font-bold mb-3 ds-text-primary line-clamp-2"
              >
                {t("onboarding_recoveryTitle", "Your vault is empty")}
              </h2>
              <p className="text-sm leading-relaxed mb-6 max-w-sm ds-text-secondary">
                {t(
                  "onboarding_recoveryDesc",
                  "If you've used BookmarkForge before — for example after clearing your browser data — restore your data from a backup file. Otherwise, continue to set up your new vault.",
                )}
              </p>

              {/* Backup source cards — show available sources with age */}
              {(autoBackupAvailable || manualExportAge !== null) && (
                <div className="w-full space-y-2 mb-6">
                  {autoBackupAvailable && (
                    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 text-left">
                      <Check className="size-4 text-cyan-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                          {t("onboarding_autoBackupLabel", "Auto-backup")}
                        </span>
                        <span className="text-xs text-cyan-600/70 dark:text-cyan-400/70 ml-2">
                          {autoBackupAge !== null
                            ? t(
                                "onboarding_autoBackupAge",
                                "{{age}} old",
                                { age: compactAge(autoBackupAge) },
                              )
                            : t("onboarding_autoBackupAvailable", "Available")}
                        </span>
                      </div>
                    </div>
                  )}
                  {manualExportAge !== null && (
                    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-left">
                      <HardDriveDownload className="size-4 text-emerald-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          {t("onboarding_manualExportLabel", "Manual export")}
                        </span>
                        <span className="text-xs text-emerald-600/70 dark:text-emerald-400/70 ml-2">
                          {t(
                            "onboarding_manualExportAge",
                            "{{age}} old",
                            { age: compactAge(manualExportAge) },
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="w-full space-y-3 mb-6">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing !== null}
                  className="truncate w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all shadow-sm ds-bg-secondary ds-border ds-text-primary disabled:opacity-50"
                >
                  {importing === "file" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Database className="size-4" />
                  )}
                  {importing === "file"
                    ? t("onboarding_restoring", "Restoring...")
                    : t(
                        "onboarding_restoreFromFile",
                        "Restore from backup file",
                      )}
                </button>
                {autoBackupAvailable && (
                  <button
                    onClick={() => void handleRestoreAuto()}
                    disabled={importing !== null}
                    className="truncate w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all shadow-sm ds-bg-secondary ds-border ds-text-primary disabled:opacity-50"
                  >
                    {importing === "auto" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    {importing === "auto"
                      ? t("onboarding_restoring", "Restoring...")
                      : t(
                          "onboarding_restoreFromAuto",
                          "Restore from automatic backup",
                        )}
                  </button>
                )}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".json,.bmf"
                  className="hidden"
                  onChange={(e) => void handleFileSelected(e)}
                  aria-label={t(
                    "onboarding_restoreFromFile",
                    "Restore from backup file",
                  )}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center">
              <div className="size-16 flex items-center justify-center mb-6 ds-icon-tint-cyan ds-radius-widget">
                <Icon className="size-8 ds-text-accent" />
              </div>

              <h2
                id="onboarding-dialog-title"
                className="text-2xl font-bold mb-3 ds-text-primary line-clamp-2"
              >
                {t(step.titleKey, step.titleDefault)}
              </h2>
              <p className="text-sm leading-relaxed mb-8 max-w-sm ds-text-secondary">
                {t(step.descriptionKey, step.descriptionDefault)}
              </p>

              {step.id === "privacy" && (
                <div className="w-full space-y-3 mb-6">
                  {[
                    t("onboarding_featureEncryption", "AES-GCM-256 encryption"),
                    t(
                      "onboarding_featureKeyDerivation",
                      "Argon2id key derivation (memory-hard KDF)",
                    ),
                    t("onboarding_featureAutoLock", "Auto-lock after inactivity"),
                    t(
                      "onboarding_featureNoCloud",
                      "No cloud storage of your data",
                    ),
                  ].map((feature) => (
                    <div
                      key={feature}
                      className="flex items-center gap-3 p-3 ds-bg-secondary border border-[var(--divider)] rounded-md"
                    >
                      <Check className="size-4 flex-shrink-0 ds-text-accent" />
                      <span className="text-sm ds-text-secondary">{feature}</span>
                    </div>
                  ))}
                </div>
              )}

              {step.id === "ai" && (
                <div className="w-full p-4 mb-6 ds-bg-secondary border border-[var(--divider)] rounded-md">
                  <p className="text-xs mb-3 ds-text-secondary">
                    {t(
                      "onboarding_supportedProviders",
                      "Supported AI providers:",
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {[
                      t("onboarding_providerWebLLM", "WebLLM (Local)"),
                      t("onboarding_providerGemini", "Google Gemini"),
                      t("onboarding_providerOpenAI", "OpenAI"),
                      t("onboarding_providerClaude", "Anthropic Claude"),
                      t("onboarding_providerGroq", "Groq"),
                      t("onboarding_providerOllama", "Ollama"),
                    ].map((p) => (
                      <span
                        key={p}
                        className="px-3 py-1 text-xs rounded-full ds-bg-card-plain ds-text-secondary"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 flex items-center justify-between ds-divider-t">
          {showRecovery ? (
            <>
              <span />
              <button
                onClick={() => setShowRecovery(false)}
                className="truncate flex items-center gap-2 px-6 py-3 text-white text-sm font-semibold transition-colors shadow-lg ds-accent-filled ds-shadow-accent"
              >
                {t(
                  "onboarding_continueFresh",
                  "Continue without restoring",
                )}
                <ArrowRight className="rtl-flip size-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                disabled={currentStep === 0}
                aria-disabled={currentStep === 0}
                className="truncate px-4 py-2 text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-colors ds-text-muted"
              >
                {t("onboarding_back", "Back")}
              </button>
              <button
                onClick={handleNext}
                className="truncate flex items-center gap-2 px-6 py-3 text-white text-sm font-semibold transition-colors shadow-lg ds-accent-filled ds-shadow-accent"
              >
                {isLast
                  ? t("onboarding_getStarted", "Get Started")
                  : t("onboarding_continue", "Continue")}
                <ArrowRight className="rtl-flip size-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
