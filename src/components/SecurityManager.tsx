/// <reference types="vite/client" />

import React, { useState, useEffect, useRef } from "react";
import { useSecurityStore } from "../hooks/useSecurityStore";
import { securityVault } from "../services/SecurityVault";
import {
  shouldShowV5ResidueNotice,
  sampleV5ResidueAfterUnlock,
} from "../services/security-vault/v5-residue-notice";
import { safeGet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { logger } from "../utils/logger";
import { SECURITY_CONFIG } from "../constants/config";
import { downloadBlob } from "../utils/download";
import { loadBackupService } from "../services/pro-access";
import { useTranslation } from "react-i18next";
import { formatDate } from "../utils/localization";
import {
  IconShield,
  IconLock,
  IconUnlock,
  IconKey,
  IconAlertCircle,
  IconCopy,
  IconCheck,
  IconDownload,
  IconRefreshCw,
} from "./icons/InlineSecurityIcons";

export const SecurityManager: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { t, i18n } = useTranslation();
  const { isLocked, unlock, setForceSetup } = useSecurityStore();
  const [passwordInput, setPasswordInput] = useState("");
  const [error, setError] = useState("");
  const [isFirstTimeInitial, setIsFirstTimeInitial] = useState(
    () => safeGet(STORAGE_KEYS.HAS_MASTER_PASSWORD) !== "true",
  );

  useEffect(() => {
    securityVault
      .hasMasterPassword()
      .then((has) => setIsFirstTimeInitial(!has))
      .catch((err) => {
        logger.debug("[SecurityManager] Vault not available yet", {
          error: err,
        });
      });
  }, []);
  const [setupComplete, setSetupComplete] = useState(false);
  const isFirstTime = isFirstTimeInitial && !setupComplete;
  const [isUnlocking, setIsUnlocking] = useState(false);
  const vaultOperationInFlightRef = useRef(false);
  // RecoveryService bundles the full bip39 stack (2048-word English
  // wordlist + @noble/hashes) — only first-time setup and the
  // forgot-password flow actually use it. A returning user staring at the
  // locked-vault screen never needs it, so it must NOT load in the
  // first-painted SecurityManager chunk. Generate the phrase lazily after
  // mount (setup-only path) and import the service on demand in handlers.
  const [recoveryPhrase, setRecoveryPhrase] = useState("");

  useEffect(() => {
    if (!isFirstTimeInitial) {return;}
    let cancelled = false;
    import("../services/RecoveryService")
      .then(({ recoveryService }) => {
        if (!cancelled) {
          setRecoveryPhrase(recoveryService.generateRecoveryPhrase());
        }
      })
      .catch((error: unknown) => {
        logger.warn("[SecurityManager] Recovery service unavailable", {
          error,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [isFirstTimeInitial]);
  const [confirmedRecovery, setConfirmedRecovery] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [hasDownloadedKit, setHasDownloadedKit] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // F0-4: optional .bmf recovery kit on the setup screen. Clicking "Save
  // recovery kit (.bmf)" marks a pending export; handleSetup performs it
  // AFTER the vault is fully created. Exporting earlier would persist the
  // encrypted DB key before the S1 verification and break first-run setup
  // (unlockVault rejects "verification token missing but vault state
  // exists").
  const pendingBmfKitRef = useRef(false);
  const [isExportingKit, setIsExportingKit] = useState(false);
  // ADR-052 Fase 2 — non-blocking v5 residue notice. The decision reads the
  // locally persisted streak (a bare integer) — never sensitive storage.
  const [showV5ResidueNotice] = useState(() => shouldShowV5ResidueNotice());
  const [v5ResidueDismissed, setV5ResidueDismissed] = useState(false);
  const regenerateInFlightRef = useRef(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clearClipboardTimerRef =
    useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(copyTimerRef.current);
      clearTimeout(clearClipboardTimerRef.current);
    };
  }, []);

  // Maps an error thrown by initDB (or any other step sharing a code) to a
  // localized message. Uses the type guards exported from db/database.ts,
  // which inspect the error's `.name` (set by walkErrorChain +
  // classifyDbError). Anything that isn't a classified DB error falls
  // back to the caller-provided `fallback` translation key, so this helper
  // is safe to call on errors from any step (encryption, vault, recovery)
  // — not just initDB.
  const resolveDbInitError = async (
    err: unknown,
    fallback: string,
  ): Promise<string> => {
    try {
      const {
        isInvalidDbPasswordError,
        isDbInaccessibleError,
        isVaultLockedError,
      } = await import("../container/database");
      if (isInvalidDbPasswordError(err)) {
        return t("app_invalid_password");
      }
      if (isVaultLockedError(err)) {
        return t("app_vault_locked");
      }
      if (isDbInaccessibleError(err)) {
        return t("app_db_inaccessible");
      }
    } catch (classificationError) {
      logger.warn("[SecurityManager] DB error classifier unavailable", {
        error: classificationError,
      });
    }
    return fallback;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(recoveryPhrase);
    setCopied(true);
    setHasDownloadedKit(true);
    clearTimeout(copyTimerRef.current);
    clearTimeout(clearClipboardTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    clearClipboardTimerRef.current = setTimeout(
      () => navigator.clipboard.writeText(""),
      30000,
    );
  };

  const handleRegeneratePhrase = async () => {
    if (regenerateInFlightRef.current) {return;}
    regenerateInFlightRef.current = true;
    setIsRegenerating(true);
    try {
      const { recoveryService } = await import("../services/RecoveryService");
      setRecoveryPhrase(recoveryService.generateRecoveryPhrase());
      setHasDownloadedKit(false);
    } catch (error) {
      logger.warn("[SecurityManager] Recovery service unavailable", {
        error,
      });
    } finally {
      regenerateInFlightRef.current = false;
      setIsRegenerating(false);
    }
  };

  /**
   * F0-4: request the optional .bmf recovery kit. Delegates to handleSetup
   * (the vault is created first, then the export runs inside it). The kit
   * stays optional: if it fails, the setup screen keeps the error and
   * "Create Vault" proceeds without it.
   */
  const handleSaveBmfKit = () => {
    if (passwordInput.length < SECURITY_CONFIG.MIN_PASSWORD_LENGTH) {
      setError(t("app_password_too_short"));
      return;
    }
    if (!confirmedRecovery) {
      setError(t("app_confirmRecovery"));
      return;
    }
    if (vaultOperationInFlightRef.current) {return;}
    pendingBmfKitRef.current = true;
    void handleSetup();
  };

  const downloadRecoveryKit = () => {
    const content = `
=========================================
BOOKMARKFORGE - RECOVERY KIT
=========================================
Keep this document in a safe, offline place (e.g. a USB drive or print it).
If you lose your master password, this is the ONLY way to recover your encrypted data.

Recovery Phrase:
${recoveryPhrase}

Date Generated: ${formatDate(new Date(), {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }, i18n.language)}
=========================================
    `.trim();

    const blob = new Blob([content], { type: "text/plain" });
    downloadBlob(blob, "bookmarkforge-recovery-kit.txt");

    setHasDownloadedKit(true);
  };

  const handleUnlock = async () => {
    if (!passwordInput || vaultOperationInFlightRef.current) {return;}
    vaultOperationInFlightRef.current = true;
    setIsUnlocking(true);
    setError("");

    try {
      const { aiManager } = await import("../services/ai/ProviderManager");
      // S0/R24: unlockVault() returns false (it does NOT throw) when the
      // password fails vault verification. Previously the boolean was
      // ignored and the flow fell through to initDB, which only rejects in
      // production-grade storage — under Memory storage (E2E smoke mode) a
      // WRONG password silently unlocked the app. Fail fast on the vault's
      // authoritative answer so the error path is identical on every storage
      // backend.
      const vaultUnlocked = await aiManager.unlockVault(passwordInput);
      if (!vaultUnlocked) {
        throw new Error("INVALID_VAULT_PASSWORD");
      }
      const { initDB } = await import("../container/database");
      await initDB(passwordInput);
      unlock();
      setError("");
      // ADR-052 Fase 2: post-unlock exposure sample. Fire-and-forget —
      // every failure mode is silent; never gates the unlocked state.
      void sampleV5ResidueAfterUnlock();
    } catch (err) {
      // Branch on classified DB error names so the user sees the right
      // message: wrong-password vs storage-inaccessible vs generic.
      // Falls back to app_vault_unlock_error for any non-DB error.
      setError(await resolveDbInitError(err, t("app_vault_unlock_error")));
    } finally {
      vaultOperationInFlightRef.current = false;
      setIsUnlocking(false);
    }
  };

  const handleSetup = async () => {
    if (passwordInput.length < SECURITY_CONFIG.MIN_PASSWORD_LENGTH) {
      setError(t("app_password_too_short"));
      return;
    }
    if (!confirmedRecovery) {
      setError(t("app_confirmRecovery"));
      return;
    }
    if (vaultOperationInFlightRef.current) {return;}

    vaultOperationInFlightRef.current = true;
    setIsUnlocking(true);
    try {
      const { recoveryService } = await import("../services/RecoveryService");
      const { aiManager } = await import("../services/ai/ProviderManager");
      const encryptedMasterPassword =
        await recoveryService.encryptMasterPasswordWithRecovery(
          passwordInput,
          recoveryPhrase,
        );

      // ORDER MATTERS — unlockVault MUST run before ANY vault state is
      // persisted. securityVault.unlock() → verifyPassword() accepts a
      // password on first run ONLY while no vault state exists: the S1
      // tampering check (hasAnyVaultState) rejects when the verification
      // token is missing but other artifacts are already present (including
      // the recovery record persisted by setRecoveryData below). If we
      // persisted the recovery data or the master-password flag first,
      // verifyPassword() returns false and the vault rejects the
      // just-created password, breaking the entire first-run setup
      // (regression caught by the E2E vault-init smoke test).
      const vaultUnlocked = await aiManager.unlockVault(passwordInput);
      if (!vaultUnlocked) {
        throw new Error("INVALID_VAULT_PASSWORD");
      }
      await securityVault.setMasterPasswordFlag();
      await securityVault.setRecoveryData(encryptedMasterPassword);
      const { destroyDB, initDB } = await import("../container/database");
      await destroyDB();
      const db = await initDB(passwordInput);

      // F0-4: export the optional .bmf recovery kit NOW — the vault is
      // fully created (verification token, flags, recovery data and DB key
      // all in place) and the password is in hand, so the backup can be
      // encrypted and downloaded. On failure, keep the setup screen with
      // the error: the kit is optional and "Create Vault" skips it (the
      // user can always export from Settings → Storage later).
      if (pendingBmfKitRef.current) {
        pendingBmfKitRef.current = false;
        setIsExportingKit(true);
        try {
          // BackupService is Pro: resolved behind the hasProAccess gate.
          const backup = await loadBackupService();
          await backup.exportBackup(passwordInput);
        } catch (kitError) {
          logger.error("[SecurityManager] Recovery kit export failed", {
            error: kitError,
          });
          setError(
            t(
              "app_bmfKitError",
              "Could not save the recovery kit. Retry, or create the vault to skip it (you can export anytime from Settings → Storage).",
            ),
          );
          return;
        } finally {
          setIsExportingKit(false);
        }
      }

      if (db) {
        logger.info("[SecurityManager] Vault created and database initialized", {
          collections: db.collections.length,
        });
      }
      unlock();
      // ADR-052 Fase 2: post-unlock exposure sample (fire-and-forget).
      void sampleV5ResidueAfterUnlock();
      // `forceSetup` is a separate store flag from `isLocked`. Clear it
      // after first-time setup so AppContent can mount the authenticated
      // shell instead of leaving the setup boundary in place.
      setForceSetup(false);
      setSetupComplete(true);
    } catch (err) {
      setError(await resolveDbInitError(err, t("app_vault_setup_error")));
    } finally {
      vaultOperationInFlightRef.current = false;
      setIsUnlocking(false);
    }
  };

  const handleRecovery = async () => {
    if (!recoveryInput || vaultOperationInFlightRef.current) {return;}
    vaultOperationInFlightRef.current = true;
    setIsUnlocking(true);
    setError("");

    try {
      const encryptedMasterPassword = await securityVault.getRecoveryData();
      if (!encryptedMasterPassword) {
        throw new Error("No recovery data found.");
      }

      const { recoveryService } = await import("../services/RecoveryService");
      const { aiManager } = await import("../services/ai/ProviderManager");
      const recoveredPassword =
        await recoveryService.decryptMasterPasswordWithRecovery(
          encryptedMasterPassword,
          recoveryInput.trim(),
        );

      // S0/R24: fail fast when the recovered password fails vault
      // verification instead of falling through to initDB (which silently
      // accepts under Memory storage).
      const vaultUnlocked = await aiManager.unlockVault(recoveredPassword);
      if (!vaultUnlocked) {
        throw new Error("INVALID_VAULT_PASSWORD");
      }
      const { initDB } = await import("../container/database");
      await initDB(recoveredPassword);

      unlock();
      // ADR-052 Fase 2: post-unlock exposure sample (fire-and-forget).
      void sampleV5ResidueAfterUnlock();
      setIsRecovering(false);
      setError("");
    } catch (err) {
      setError(await resolveDbInitError(err, t("app_invalidRecoveryPhrase")));
    } finally {
      vaultOperationInFlightRef.current = false;
      setIsUnlocking(false);
    }
  };

  if (!isLocked) {return <>{children}</>;}

  return (      <main
      className="fixed inset-0 z-[100] flex items-center justify-center ds-bg-primary p-4"
      data-testid="vault-locked-screen"
    >
      {/* CSS animation replaces the former motion.div entrance — keeping
          this first-painted screen free of the ui-runtime vendor chunk. */}
      <div
        className="security-card-in w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto p-8 shadow-2xl relative ds-radius-card ds-bg-card ds-border"
      >
        {/* REMOVED: Insecure DEV bypass mode for security */}
        {isFirstTime && import.meta.env.DEV && (
          <div
            className="absolute top-6 end-6 p-2 transition-all"
            title="DEV mode bypass is disabled for security"
          >
            <IconAlertCircle
              className="size-5 ds-text-warning"
              aria-label="DEV mode bypass removed"
            />
          </div>
        )}          <div className="flex flex-col items-center text-center mb-6">
          <div
            className="size-14 flex items-center justify-center mb-3 ds-radius-widget"
            style={{
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-glow)",
            }}
          >
            {isRecovering ? (
              <IconRefreshCw className="size-7 ds-text-accent" />
            ) : (
              <IconShield className="size-7 ds-text-accent" />
            )}
          </div>
          <h1 className="text-xl font-semibold mb-1 ds-text-primary line-clamp-2">
            {isFirstTime
              ? t("app_setup_vault")
              : isRecovering
                ? t("app_recoverVault")
                : t("app_vault_locked")}
          </h1>
          <p className="text-xs ds-text-secondary">
            {isFirstTime
              ? t("app_setup_vault_desc")
              : isRecovering
                ? t("app_enterRecoveryPhrase")
                : t("app_vault_locked_desc")}
          </p>
        </div>

        {isFirstTime ? (
          <div className="space-y-3">
            <div className="p-3 ds-radius-card ds-bg-secondary ds-border">
              <p className="text-xs mb-1 ds-text-secondary">
                {t("app_recoveryPhraseLabel")}
              </p>
              <p className="text-sm font-mono break-all mb-3 ds-text-primary">
                {recoveryPhrase}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleCopy}
                  disabled={!recoveryPhrase}
                  className="truncate flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-cyan-400"
                >
                  {copied ? (
                    <IconCheck className="size-3" />
                  ) : (
                    <IconCopy className="size-3" />
                  )}
                  {copied ? t("app_copied") : t("app_copy")}
                </button>
                <button
                  onClick={downloadRecoveryKit}
                  disabled={!recoveryPhrase}
                  className="truncate flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-blue-400"
                >
                  <IconDownload className="size-3" />
                  {t("app_downloadRecoveryKit")}
                </button>
                <button
                  onClick={handleRegeneratePhrase}
                  disabled={isRegenerating}
                  className="truncate flex items-center gap-1 text-xs ds-text-success hover:ds-text-success disabled:opacity-50"
                >
                  <IconRefreshCw className="size-3" />
                  {t("app_regeneratePhrase")}
                </button>
              </div>
            </div>
            {/* F0-4: optional .bmf recovery kit. Unlike the recovery phrase
                (which recovers a FORGOTTEN password), this encrypted
                backup restores the vault DATA on a new device or browser
                — and needs the master password to open. Optional and
                never blocking. */}
            <div className="p-3 ds-radius-card ds-bg-secondary ds-border">
              <p className="text-xs mb-2 ds-text-secondary">
                {t(
                  "app_bmfKitPasswordWarning",
                  "Optional: this file is encrypted with your master password — without the password, it is useless.",
                )}
              </p>
              <p className="text-xs mb-2 ds-text-warning font-medium">
                {t(
                  "app_bmfKitOffDeviceWarning",
                  "Important: do not keep the file only on this device. Copy it to a second place — cloud storage (Google Drive, Dropbox), a USB drive, or email it to yourself. If this device fails, a copy on it is lost too.",
                )}
              </p>
              <button
                onClick={handleSaveBmfKit}
                disabled={!passwordInput || isUnlocking || isExportingKit}
                className="truncate flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-cyan-400"
              >
                {isExportingKit ? (
                  <div className="size-3 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                ) : (
                  <IconDownload className="size-3" />
                )}
                {isExportingKit
                  ? t("app_bmfKitSaving", "Saving...")
                  : t("app_saveBmfKit", "Save recovery kit (.bmf)")}
              </button>
            </div>
            <span className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                aria-label={t("app_confirmRecovery")}
                checked={confirmedRecovery}
                onChange={(e) => setConfirmedRecovery(e.target.checked)}
                className="accent-cyan-600"
                disabled={!hasDownloadedKit}
              />
              {t("app_confirmRecovery")}{" "}
              {hasDownloadedKit
                ? ""
                : t("downloadKitFirst", "(Download or copy the kit first)")}
            </span>
            <input
              type="password"
              aria-label={t("app_master_password")}
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder={t("app_master_password")}
              autoComplete="new-password"
              minLength={SECURITY_CONFIG.MIN_PASSWORD_LENGTH}
              className="w-full px-3 py-3 transition-all outline-none ds-radius-card ds-bg-input ds-border-inactive ds-text-primary"
            />
          </div>        ) : isRecovering ? (
          <div className="space-y-3">
            <textarea
              aria-label={t("app_enterRecoveryPhrase")}
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
              placeholder={t("app_enterRecoveryPhrase")}
              className="w-full px-3 py-3 transition-all resize-none h-24 outline-none ds-radius-card ds-bg-input ds-border-inactive ds-text-primary"
              disabled={isUnlocking}
            />
          </div>
        ) : (
          <div className="relative">
            <IconLock className="absolute start-3 top-1/2 -translate-y-1/2 size-4 ds-text-muted" />
            <input
              type="password"
              aria-label={t("app_master_password")}
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder={t("app_master_password")}
              className="w-full ps-10 pe-3 py-3 transition-all outline-none ds-radius-card ds-bg-input ds-border-inactive ds-text-primary"
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              disabled={isUnlocking}
            />
          </div>
        )}

        {error && (
          <div className="security-error-in flex items-center gap-2 p-3 bg-[var(--color-danger)]/10 border border-[var(--danger-soft-border)]/20 rounded-2xl ds-text-danger text-xs mt-3">
            <IconAlertCircle className="size-3 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {showV5ResidueNotice && !v5ResidueDismissed && (
          <div
            data-testid="v5-residue-notice"
            className="security-error-in flex items-start gap-2 p-3 rounded-2xl text-xs mt-3"
            style={{
              backgroundColor: "rgba(245, 158, 11, 0.1)",
              border: "1px solid rgba(245, 158, 11, 0.35)",
            }}
          >
            <IconAlertCircle className="size-3 shrink-0 ds-text-warning" />
            <div className="min-w-0">
              <p className="ds-text-warning font-medium">
                {t(
                  "app_v5ResidueNoticeTitle",
                  "Some vault data still uses the legacy encryption format",
                )}
              </p>
              <p className="ds-text-secondary mt-1">
                {t(
                  "app_v5ResidueNoticeBody",
                  "A global dictionary attack still applies to these items. Unlock once more with your password to re-encrypt them, or restore them from a backup made with the current version.",
                )}
              </p>
              <button
                type="button"
                onClick={() => setV5ResidueDismissed(true)}
                className="mt-1 inline-block max-w-full truncate text-[10px] underline ds-text-muted"
              >
                {t("app_v5ResidueNoticeDismiss", "Dismiss")}
                </button>
            </div>
          </div>
        )}

        <button
          onClick={
            isFirstTime
              ? handleSetup
              : isRecovering
                ? handleRecovery
              : handleUnlock
          }
          disabled={
            isUnlocking ||
            (isFirstTime && (!passwordInput || !confirmedRecovery)) ||
            (isRecovering && !recoveryInput) ||
            (!isFirstTime && !isRecovering && !passwordInput)
          }
          className="truncate w-full py-3 disabled:opacity-50 font-semibold transition-all flex items-center justify-center gap-2 mt-3 ds-radius-card ds-bg-accent-primary ds-shadow-accent"
          style={{ color: "var(--bg-primary)" }}
        >
          {isUnlocking ? (
            <div className="size-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              {isFirstTime ? (
                <IconKey className="size-5" />
              ) : isRecovering ? (
                <IconRefreshCw className="size-5" />
              ) : (
                <IconUnlock className="size-5" />
              )}
              <span>
                {isFirstTime
                  ? t("app_create_vault")
                  : isRecovering
                    ? t("app_recoverVault")
                    : t("app_unlock")}
              </span>
            </>
          )}
        </button>

        {!isFirstTime && (
          <div className="mt-3 text-center">
            <button
              onClick={() => {
                setIsRecovering(!isRecovering);
                setError("");
                setPasswordInput("");
                setRecoveryInput("");
              }}
              className="truncate text-xs transition-colors ds-text-secondary"
            >
              {isRecovering ? t("app_backToLogin") : t("app_forgotPassword")}
            </button>
          </div>
        )}

        <div className="mt-6 pt-4 text-center ds-divider-t">
          <p className="text-[10px] leading-relaxed ds-text-muted">
            {t("app_vault_security_note_full")}
          </p>
          <p className="text-[10px] leading-relaxed ds-text-warning mt-2">
            {t(
              "app_vault_offsite_note",
              "Recommended: keep at least one backup copy outside this device (cloud, USB or email). Your vault lives only in this browser.",
            )}
          </p>
        </div>
      </div>
    </main>
  );
};
