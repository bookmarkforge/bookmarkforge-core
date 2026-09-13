import React, { useState } from "react";
import {
  Lock,
  Key,
  Save,
  Loader2,
  Unlock,
  Shield,
  Eye,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeGet, safeRemove, safeSet } from "../../store/safeStorage";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import { toast } from "sonner";
import { SECURITY_CONFIG } from "../../constants/config";
import { useGuardedAction } from "../../hooks/useGuardedAction";

// ADR-030: this legacy settings control changes only the error-reporting
// purpose; it must never grant analytics or client-event consent implicitly.

interface SecuritySectionProps {
  vaultKey: string;
  setVaultKey: (key: string) => void;
  isUpdatingPassword: boolean;
  onUpdatePassword: () => void;
  autoLockEnabled: boolean;
  setAutoLockEnabled: (enabled: boolean) => void;
}

export const SecuritySection: React.FC<SecuritySectionProps> = ({
  vaultKey,
  setVaultKey,
  isUpdatingPassword,
  onUpdatePassword,
  autoLockEnabled,
  setAutoLockEnabled,
}) => {
  const { t } = useTranslation();
  const [telemetryOptIn, setTelemetryOptIn] = useState(() => {
    // Audit 2026-08-30: read the consent keys that ConsentBanner writes
    // (forge_consent_*). The legacy bmf_local_error_storage and
    // bmf_telemetry_optin keys are read-only migration fallbacks.
    const errorConsent = safeGet(STORAGE_KEYS.CONSENT_ERROR_REPORTING);
    if (errorConsent !== null) return errorConsent === "true";
    const legacy = safeGet(STORAGE_KEYS.LOCAL_ERROR_STORAGE);
    if (legacy !== null) return legacy === "true";
    return safeGet("bmf_telemetry_optin") === "true";
  });

  const handleTelemetryToggle = () => {
    const nextVal = !telemetryOptIn;
    setTelemetryOptIn(nextVal);
    // Keep the settings shortcut scoped to error reporting. Analytics and
    // operational client events require their own explicit banner choices.
    const val = String(nextVal);
    safeSet(STORAGE_KEYS.CONSENT_DECISION_MADE, "true");
    safeSet(STORAGE_KEYS.CONSENT_ERROR_REPORTING, val);
    // Clear legacy keys so a stale broad opt-in cannot resurface after the
    // user changes this setting. The current scoped key remains authoritative.
    safeRemove(STORAGE_KEYS.LOCAL_ERROR_STORAGE);
    safeRemove("bmf_telemetry_optin");
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // H-01 (audit): NEVER sanitize a password. DOMPurify-based sanitizers
    // rewrite `<`, `>`, `&` and HTML sequences, silently corrupting the
    // master password — the vault then rejects it on unlock and becomes
    // permanently unreachable. Length is already capped by maxLength={100}.
    setVaultKey(e.target.value);
  };

  // ── Nuclear Forget (GDPR Art. 17 "Right to be Forgotten") ────────────
  // NuclearForgetService is fully implemented + E2E-tested
  // (vault-nuclear-forget-s9-guard.spec.ts) but previously had NO UI entry
  // point — users could never actually erase their data from the app. This
  // danger zone wires it: explicit confirm + master password verification.
  const [showForgetConfirm, setShowForgetConfirm] = useState(false);
  const [forgetPassword, setForgetPassword] = useState("");

  // Single irreversible action — useGuardedAction: isForgetting comes from
  // isRunning; the reload happens in onSuccess (current-gated), and the
  // error toast keeps the raw technical detail.
  const forget = useGuardedAction<void>({
    onSuccess: () => {
      // Reset state before reload so the UI can never hang in the spinning
      // state if the reload is deferred/blocked.
      setShowForgetConfirm(false);
      // Everything is wiped: reload shows the fresh-install UI.
      window.location.reload();
    },
    onError: (err) => {
      const raw = err instanceof Error ? err.message : "";
      // Keep the technical detail (wrong password vs failed wipe) but
      // localize the toast shell.
      toast.error(
        t("app_nuclearForgetFailed", {
          error: raw || t("app_nuclearForgetFailedGeneric"),
        }),
      );
    },
  });
  const isForgetting = forget.isRunning;

  const handleForgetRequest = () => {
    // First-line confirm: this wipes EVERYTHING and cannot be undone.
    // The master password (verified by NuclearForgetService) is the
    // second gate — belt and suspenders for an irreversible GDPR wipe.
    if (!window.confirm(t("app_nuclearForgetConfirmFirst"))) {return;}
    setForgetPassword("");
    setShowForgetConfirm(true);
  };

  const handleNuclearForget = async () => {
    if (!forgetPassword.trim()) {return;}
    await forget.run(async () => {
      const { nuclearForgetService } = await import(
        "../../services/NuclearForgetService"
      );
      await nuclearForgetService.nuclearForget({
        password: forgetPassword,
        confirm: true,
      });
    });
  };

  return (
    <section data-testid="settings-security" className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2">
        <Lock className="size-4" /> {t("app_masterPassword")}
      </h3>
      <div className="space-y-4 p-4 bg-[var(--bg-card)]/50 rounded-xl border border-[var(--divider)]/50">
        <p className="text-xs text-[var(--text-muted)]">
          {t("app_masterPasswordHelp")}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Key className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--text-muted)]" />
            <input
              type="password"
              aria-label={t("app_masterPasswordPlaceholder")}
              data-testid="vault-password-input"
              value={vaultKey}
              onChange={handlePasswordChange}
              placeholder={t("app_masterPasswordPlaceholder")}
              className="w-full bg-[var(--bg-primary)] border border-[var(--divider)] rounded-lg ps-10 pe-4 py-2 text-sm text-white outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              maxLength={100}
            />
          </div>
          <button
            onClick={onUpdatePassword}
            // Aligned with the vault's own minimum (rotateMasterPassword
            // rejects < MIN_PASSWORD_LENGTH) so the button never enables
            // for a password the vault will silently refuse.
            disabled={
              isUpdatingPassword ||
              vaultKey.length < SECURITY_CONFIG.MIN_PASSWORD_LENGTH
            }
            className="truncate bg-[var(--bg-card)] hover:bg-[var(--state-hover-bg)] text-white px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {isUpdatingPassword ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {t("app_updatePassword")}
          </button>
        </div>
      </div>

      {/* Auto-lock Option */}
      <div className="border-t border-[var(--divider)]/50 pt-4 mt-4">
        <h4 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2 mb-3">
          <Unlock className="size-4" /> {t("app_autoLock")}
        </h4>
        <div className="flex items-center justify-between p-3 bg-[var(--bg-secondary)]/30 rounded-lg border border-[var(--divider)]/50">
          <div className="flex items-center gap-3">
            <div className="p-2 ds-bg-warning-soft rounded-md">
              <Lock className="size-4 ds-text-warning" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-muted)]">
                {t("app_disableAutoLockLabel")}
              </h4>
              <p className="text-[11px] text-[var(--text-muted)]">
                {t("app_autoLockDesc")}
              </p>
            </div>
          </div>
          <button
            onClick={() => setAutoLockEnabled(!autoLockEnabled)}
            className={`relative w-12 h-6 rounded-full transition-colors duration-200 ease-in-out focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] focus-visible:outline-offset-2 ${
              autoLockEnabled
                ? "bg-cyan-500"
                : "bg-[var(--state-inactive-border)]"
            }`}
            role="switch"
            aria-checked={autoLockEnabled}
            aria-label={t("app_disableAutoLockLabel")}
          >
            <span
              className={`absolute top-[2px] left-[2px] size-5 bg-white rounded-full shadow-md transition-transform duration-200 ease-in-out ${
                autoLockEnabled ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Danger Zone — Nuclear Forget */}
      <div className="border-t border-[var(--divider)]/50 pt-4 mt-4">
        <h4 className="text-sm font-semibold text-[var(--text-danger)] uppercase tracking-widest flex items-center gap-2 mb-3">
          <AlertTriangle className="size-4" />{" "}
          {t("app_dangerZone", "Danger Zone")}
        </h4>
        <div className="p-3 bg-[var(--danger-soft)]/40 rounded-lg border border-[var(--danger-soft-border)]/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-[var(--color-danger)]/10 rounded-md shrink-0">
                <Trash2 className="size-4 ds-text-danger" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-[var(--text-danger)]">
                  {t("app_nuclearForgetTitle", "Delete all data")}
                </h4>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {t(
                    "app_nuclearForgetDesc",
                    "Permanently erases your vault, bookmarks, documents, AI keys and caches. This cannot be undone.",
                  )}
                </p>
              </div>
            </div>
            {!showForgetConfirm ? (
              <button
                onClick={handleForgetRequest}
                className="truncate shrink-0 text-xs font-bold px-3 py-2 rounded-lg bg-[var(--color-danger)] text-white hover:opacity-90 transition-opacity"
              >
                {t("app_nuclearForgetAction", "Erase everything")}
              </button>
            ) : (
              <div className="flex flex-col gap-2 w-full sm:w-auto sm:min-w-[260px]">
                <input
                  type="password"
                  aria-label={t(
                    "app_nuclearForgetPassword",
                    "Master password to confirm",
                  )}
                  value={forgetPassword}
                  onChange={(e) => setForgetPassword(e.target.value)}
                  placeholder={t(
                    "app_nuclearForgetPasswordPlaceholder",
                    "Master password",
                  )}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--divider)] rounded-lg px-3 py-1.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleNuclearForget}
                    disabled={isForgetting || !forgetPassword.trim()}
                    className="truncate flex-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-[var(--color-danger)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {isForgetting ? (
                      <Loader2 className="size-3 animate-spin inline me-1" />
                    ) : null}
                    {t("app_nuclearForgetConfirm", "Confirm erase")}
                  </button>
                  <button
                    onClick={() => {
                      setShowForgetConfirm(false);
                      setForgetPassword("");
                    }}
                    className="truncate text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--state-hover-bg)] transition-colors"
                  >
                    {t("app_cancel", "Cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Telemetry / Privacy Option */}
      <div className="border-t border-[var(--divider)]/50 pt-4 mt-4">
        <h4 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2 mb-3">
          <Shield className="size-4" />{" "}
          {t("app_privacyTelemetry", "Privacy & Diagnostics")}
        </h4>
        <div className="flex items-center justify-between p-3 bg-[var(--bg-secondary)]/30 rounded-lg border border-[var(--divider)]/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-md">
              <Eye className="size-4 text-cyan-500" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-muted)]">
                {t("app_telemetryOptInLabel", "Share anonymous error reports")}
              </h4>
              <p className="text-[11px] text-[var(--text-muted)]">
                {t(
                  "app_telemetryOptInDesc",
                  "Help us improve BookmarkForge by sharing diagnostic reports. No bookmarks or document contents are ever sent.",
                )}
              </p>
            </div>
          </div>
          <button
            onClick={handleTelemetryToggle}
            className={`relative w-12 h-6 rounded-full transition-colors duration-200 ease-in-out focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] focus-visible:outline-offset-2 ${
              telemetryOptIn
                ? "bg-cyan-500"
                : "bg-[var(--state-inactive-border)]"
            }`}
            role="switch"
            aria-checked={telemetryOptIn}
            aria-label={t(
              "app_telemetryOptInLabel",
              "Share anonymous error reports",
            )}
          >
            <span
              className={`absolute top-[2px] left-[2px] size-5 bg-white rounded-full shadow-md transition-transform duration-200 ease-in-out ${
                telemetryOptIn ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>
    </section>
  );
};
