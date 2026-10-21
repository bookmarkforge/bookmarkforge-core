/// <reference types="vite/client" />

import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { securityVault } from "../services/SecurityVault";
import { encryptionService } from "../services/EncryptionService";
import { useSecurityStore } from "../hooks/useSecurityStore";
import { useRxCollection, useRxQuery } from "../hooks/useRxDB";
import type { RxQuery as AnyRxQuery } from "rxdb";
import { logger } from "../utils/logger";
import {
  IconCheck,
  IconAlertCircle,
  IconRefreshCw,
  IconKey,
} from "./icons/InlineSecurityIcons";
import { X, Shield, ShieldCheck } from "lucide-react";
import { getLatestBackupAgeMs } from "./StorageStatus";
import { useRateLimitStore } from "../store/rateLimitStore";

interface SecurityDashboardProps {
  /**
   * Invoked by the "Security Settings" action. Omitted when the dashboard is
   * rendered inside the Settings security area, where the action scrolls to
   * the vault controls on the same page instead.
   */
  onOpenSettings?: () => void;
}

export const SecurityDashboard: React.FC<SecurityDashboardProps> = ({
  onOpenSettings,
}) => {
  const { t } = useTranslation();
  const { isLocked: _isLocked } = useSecurityStore();
  const [vaultState, setVaultState] = useState<{
    hasMasterPassword: boolean;
    kdfSaltHex: string | null;
    isUnlocked: boolean;
    sessionActive: boolean;
    encryptionFormat: string;
    deviceKeyWrapped: boolean;
  } | null>(null);
  const [backupAgeMs, setBackupAgeMs] = useState<number | null>(null);
  const [rateLimitState, setRateLimitState] = useState<{
    unlockAttempts: number;
    lockoutUntil: number;
  } | null>(null);
  const [lastAuditTime, setLastAuditTime] = useState<number | null>(null);

  const docsCollection = useRxCollection("documents");
  const bookmarksCollection = useRxCollection("bookmarks");
  // A count() query resolves to a NUMBER, not a document array — `result` is
  // only typed as an array because the hook is shared with find() queries
  // (same shape StorageStatus reads). Narrow before adding, otherwise
  // `result.length` is undefined and the total becomes NaN.
  const { result: docsCount = 0 } = useRxQuery(
    docsCollection?.count() as unknown as AnyRxQuery<unknown>,
  );
  const { result: bookmarksCount = 0 } = useRxQuery(
    bookmarksCollection?.count() as unknown as AnyRxQuery<unknown>,
  );
  const totalItems =
    (typeof docsCount === "number" ? docsCount : 0) +
    (typeof bookmarksCount === "number" ? bookmarksCount : 0);
  const refreshSecurityData = useCallback(async () => {
    try {
      const hasMP = await securityVault.hasMasterPassword();
      const kdfSalt = encryptionService.getVaultKdfSaltHex();
      const locked = securityVault.isLocked();
      const sessionToken = securityVault.getSessionToken();

      // Check if device key is wrapped (best-effort)
      let deviceKeyWrapped = false;
      try {
        const { secureStorage } = await import("../services/SecureStorage");
        deviceKeyWrapped = await secureStorage.isDeviceKeyWrapped();
      } catch {
        // Best-effort
      }

      // Get backup age
      const age = await getLatestBackupAgeMs();

      // Get rate limit state
      const rl = useRateLimitStore.getState();
      const rlState = {
        unlockAttempts: rl.unlockAttempts,
        lockoutUntil: rl.lockoutUntil,
      };

      setVaultState({
        hasMasterPassword: hasMP,
        kdfSaltHex: kdfSalt,
        isUnlocked: !locked,
        sessionActive: sessionToken !== null,
        encryptionFormat: "AES-256-GCM",
        deviceKeyWrapped,
      });
      setBackupAgeMs(age);
      setRateLimitState(rlState);
      setLastAuditTime(Date.now());
    } catch (error) {
      logger.warn("[SecurityDashboard] Failed to refresh security data", {
        error,
      });
    }
  }, []);

  useEffect(() => {
    void refreshSecurityData();
    const interval = setInterval(() => void refreshSecurityData(), 30_000);
    return () => {
      clearInterval(interval);
    };
  }, [refreshSecurityData]);

  const isRateLimited =
    rateLimitState !== null && Date.now() < rateLimitState.lockoutUntil;

  const lockoutRemaining = isRateLimited
    ? Math.ceil((rateLimitState!.lockoutUntil - Date.now()) / 1000)
    : null;

  const kdfStatus =
    vaultState?.kdfSaltHex !== null
      ? "v6"
      : "v5 (legacy)";

  const healthChecks = [
    {
      id: "encryption",
      label: t("app_secEncryption", "Encryption"),
      status: vaultState?.encryptionFormat === "AES-256-GCM" ? "pass" : "fail",
      detail: vaultState?.encryptionFormat ?? "–",
    },
    {
      id: "kdf-salt",
      label: t("app_secKdfSalt", "KDF Salt"),
      status: vaultState?.kdfSaltHex !== null ? "pass" : "warn",
      detail: kdfStatus,
    },
    {
      id: "device-key",
      label: t("app_secDeviceKey", "Device Key"),
      status: vaultState?.deviceKeyWrapped ? "pass" : "warn",
      detail: vaultState?.deviceKeyWrapped
        ? t("app_secWrapped", "Wrapped")
        : t("app_secNotWrapped", "Not wrapped"),
    },
    {
      id: "session",
      label: t("app_secSession", "Session"),
      status: vaultState?.sessionActive ? "pass" : "warn",
      detail: vaultState?.sessionActive
        ? t("app_secActive", "Active")
        : t("app_secInactive", "Inactive"),
    },
    {
      id: "rate-limit",
      label: t("app_secRateLimit", "Rate Limit"),
      status: isRateLimited ? "fail" : "pass",
      detail: isRateLimited
        ? `${lockoutRemaining}s remaining`
        : t("app_secUnlocked", "Unlocked"),
    },
    {
      id: "backup",
      label: t("app_secBackup", "Backup"),
      status: backupAgeMs !== null && backupAgeMs < 48 * 60 * 60 * 1000 ? "pass" : "warn",
      detail: backupAgeMs !== null
        ? `${Math.floor(backupAgeMs / 3_600_000)}h ago`
        : t("app_secNoBackup", "Never"),
    },
    {
      id: "vault",
      label: t("app_secVault", "Vault"),
      status: vaultState?.hasMasterPassword ? "pass" : "warn",
      detail: vaultState?.hasMasterPassword
        ? t("app_secConfigured", "Configured")
        : t("app_secNotConfigured", "Not configured"),
    },
  ];

  const passCount = healthChecks.filter((h) => h.status === "pass").length;
  const overallHealth = passCount === healthChecks.length
    ? "optimal"
    : passCount >= healthChecks.length / 2
      ? "degraded"
      : "critical";

  return (
    <section className="space-y-4" data-testid="security-dashboard">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="size-10 flex items-center justify-center ds-radius-widget" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-glow)" }}>
          <ShieldCheck className="size-5 text-emerald-600 shrink-0" />
        </div>
        <div>
          <h2 className="text-lg font-semibold ds-text-primary">
            {t("app_securityDashboard", "Security Dashboard")}
          </h2>
          <p className="text-xs ds-text-secondary">
            {t(`app_secHealthSummary`, { count: passCount, total: healthChecks.length })}
          </p>
        </div>
      </div>

      {/* Overall Health Banner */}
      <div
        className={`flex items-center gap-3 p-4 rounded-xl border ${
          overallHealth === "optimal"
            ? "ds-bg-success/10 border-[var(--success-soft-border)]/20"
            : overallHealth === "degraded"
              ? "ds-bg-warning/10 border-[var(--color-warning)]/20"
              : "ds-bg-danger/10 border-[var(--danger-soft-border)]/20"
        }`}
      >
        {overallHealth === "optimal" ? (
          <ShieldCheck className="size-6 text-emerald-600 shrink-0" />
        ) : overallHealth === "degraded" ? (
          <IconAlertCircle className="size-6 ds-text-warning shrink-0" />
        ) : (
          <IconAlertCircle className="size-6 ds-text-danger shrink-0" />
        )}
        <div>
          <p className={`text-sm font-semibold ${
            overallHealth === "optimal" ? "ds-text-success" : overallHealth === "degraded" ? "ds-text-warning" : "ds-text-danger"
          }`}>
            {overallHealth === "optimal"
              ? t("app_secAllGood", "All systems secure")
              : overallHealth === "degraded"
                ? t("app_secNeedsAttention", "Some items need attention")
                : t("app_secCritical", "Security requires immediate action")}
          </p>
          <p className="text-xs ds-text-secondary">
            {t("app_secRefreshInfo", "Data refreshes automatically every 30 seconds")}
          </p>
        </div>
      </div>

      {/* Health Checks Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {healthChecks.map((check) => (
          <div
            key={check.id}
            className="flex items-start gap-3 p-4 ds-radius-card ds-bg-card ds-border"
          >
            <div className={`size-8 flex items-center justify-center rounded-lg shrink-0 ${
              check.status === "pass" ? "ds-bg-success/10" : check.status === "warn" ? "ds-bg-warning/10" : "ds-bg-danger/10"
            }`}>
              {check.status === "pass" ? (
                <IconCheck className={`size-4 ${check.status === "pass" ? "ds-text-success" : "ds-text-warning"}`} />
              ) : check.status === "warn" ? (
                <IconAlertCircle className="size-4 ds-text-warning" />
              ) : (
                <X className="size-4 text-red-600" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium ds-text-primary">{check.label}</p>
              <p className="text-xs ds-text-secondary truncate">{check.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Detailed Info */}
      <div className="p-4 ds-radius-card ds-bg-secondary ds-border">
        <h3 className="text-sm font-semibold ds-text-primary mb-3 flex items-center gap-2 truncate">
          <IconKey className="size-4 ds-text-accent" />
          {t("app_secTechnicalDetails", "Technical Details")}
        </h3>
        <dl className="space-y-2 text-xs">
          <div className="flex justify-between">
            <dt className="ds-text-secondary">{t("app_secAlgorithm", "Algorithm")}</dt>
            <dd className="ds-text-primary font-mono">AES-256-GCM</dd>
          </div>
          <div className="flex justify-between">
            <dt className="ds-text-secondary">{t("app_secKdf", "KDF")}</dt>
            <dd className="ds-text-primary font-mono">Argon2id (v4/v5)</dd>
          </div>
          <div className="flex justify-between">
            <dt className="ds-text-secondary">{t("app_secSaltVersion", "Salt Format")}</dt>
            <dd className={`font-mono ${vaultState?.kdfSaltHex ? "ds-text-success" : "ds-text-warning"}`}>
              {kdfStatus}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="ds-text-secondary">{t("app_secVaultSalt", "Vault KDF Salt")}</dt>
            <dd className="ds-text-primary font-mono">
              {vaultState?.kdfSaltHex
                ? `${vaultState.kdfSaltHex.slice(0, 8)}...${vaultState.kdfSaltHex.slice(-8)}`
                : "– (legacy)"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="ds-text-secondary">{t("app_secItems", "Indexed Items")}</dt>
            <dd className="ds-text-primary font-mono">{totalItems}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="ds-text-secondary">{t("app_secLastCheck", "Last Check")}</dt>
            <dd className="ds-text-primary font-mono">
              {lastAuditTime
                ? `${Math.floor((Date.now() - lastAuditTime) / 1000)}s ago`
                : "–"}
            </dd>
          </div>
        </dl>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          onClick={() => void refreshSecurityData()}
          className="truncate flex items-center justify-center gap-2 px-4 py-3 ds-radius-card ds-bg-card ds-border ds-text-secondary hover:ds-bg-secondary transition-colors"
        >
          <IconRefreshCw className="size-4" />
          {t("app_secRefresh", "Refresh")}
        </button>
        {/* The old `#settings/security` href was dead (the app routes with
            BrowserRouter, so a hash is not a route). On the standalone
            /security route `onOpenSettings` navigates to Settings; when the
            dashboard is rendered INSIDE the Settings security area there is
            nothing to navigate to, so the action scrolls to the vault
            controls below (no router dependency: Settings is also mounted
            from tests without a Router). */}
        <button
          type="button"
          onClick={() => {
            if (onOpenSettings) {
              onOpenSettings();
              return;
            }
            document
              .querySelector('[data-testid="settings-security"]')
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className="truncate flex items-center justify-center gap-2 px-4 py-3 ds-radius-card ds-bg-accent-primary text-[var(--text-on-accent)] hover:opacity-90 transition-colors"
        >
          <Shield className="size-4 text-cyan-500" />
          {t("app_secSettings", "Security Settings")}
        </button>
      </div>
    </section>
  );
};
