import React, { useEffect, useState, useMemo } from "react";
import {
  X,
  Activity,
  Database,
  Cpu,
  Battery,
  Globe,
  Clock,
  ShieldCheck,
  Zap,
  RefreshCw,
  Wrench,
} from "lucide-react";
import {
  diagnosticService,
  SystemDiagnostics,
} from "../../services/DiagnosticService";
import { logger } from "../../utils/logger";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { intelligentMaintenanceService } from "../../services/ai/IntelligentMaintenanceService";
import { AnalyticsDiagnostics } from "../settings/AnalyticsDiagnostics";

interface DiagnosticsModalProps {
  show: boolean;
  onClose: () => void;
  t: (key: string, options?: unknown) => string;
  isDark?: boolean;
}

interface MetricCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number | boolean | null;
  color: string;
  title?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ icon: Icon, label, value, color, title }) => (
    <div
      className="flex items-center justify-between p-3 ds-radius-button ds-bg-secondary ds-border"
      title={title}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="size-4" />
        </div>
        <span className="text-sm font-medium ds-text-secondary">{label}</span>
      </div>
      <span className="text-sm font-mono ds-text-primary">{String(value)}</span>
    </div>
  );

MetricCard.displayName = "MetricCard";

/**
 * Generates a report correlation token (48 random bits, 12 hex chars).
 * @internal exported for tests
 * L-01: Math.random() produced ~4.7e6 predictable combinations; the token
 * correlates a support report, so it must not be guessable by another reader
 * of the same report thread.
 */
export function generateReportToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({
  show,
  onClose,
  t,
  isDark = true,
}) => {
  const [data, setData] = useState<SystemDiagnostics | null>(null);
  const [reportToken, setReportToken] = useState<string>("");
  const [maintenanceStatus, setMaintenanceStatus] = useState(() => intelligentMaintenanceService.getStatus());

  const { load, loading, cancel } = useGuardedDataLoad(
    async () => diagnosticService.getDiagnostics(),
    {
      autoLoad: false,
      onSuccess: (res) => {
        setData(res);
        setReportToken(generateReportToken());
      },
      onError: (err) => {
        logger.error("[DiagnosticsModal] Failed to fetch diagnostics", {
          error: err,
        });
      },
    },
    );

  // Fetch only while the modal is open; closing invalidates any in-flight
  // request so a late response cannot repopulate a closed or newer instance
  // (DiagnosticService has no AbortSignal API — the guard supersedes it).
  useEffect(() => {
    if (show) {
      void load();
    } else {
      cancel();
    }
  }, [show, load, cancel]);

  useEffect(() => intelligentMaintenanceService.subscribe(() => {
    setMaintenanceStatus(intelligentMaintenanceService.getStatus());
  }), []);

  const dbMetrics = useMemo(
    () =>
      data
        ? [
            {
              icon: ShieldCheck,
              label: t("app_initialized", "Initialized"),
              value: data.db.initialized,
              color: "ds-bg-success/10 ds-text-success",
            },
            {
              icon: Clock,
              label: t("app_dbInitDuration", "DB init"),
              value:
                data.db.initDurationMs == null
                  ? t("app_notAvailable", "n/a")
                  : `${data.db.initDurationMs}ms`,
              color: "bg-violet-500/10 text-violet-500",
              title:
                data.db.initAttempts == null
                  ? undefined
                  : `${data.db.initAttempts} ${t("app_dbInitAttempts", "attempt(s)")}`,
            },
            {
              icon: Activity,
              label: t("app_dbQueryLatency", "RxDB queries"),
              value:
                data.db.queryLatency?.sampleReadMs == null
                  ? t("app_notAvailable", "n/a")
                  : `${data.db.queryLatency?.sampleReadMs}ms`,
              color: "bg-indigo-500/10 text-indigo-500",
              title: [
                data.db.queryLatency?.bookmarkCountMs == null
                  ? null
                  : `${t("app_bookmarksTitle", "Bookmarks")} count: ${data.db.queryLatency?.bookmarkCountMs}ms`,
                data.db.queryLatency?.vectorCountMs == null
                  ? null
                  : `${t("app_vectorVectors", "Vector Data")} count: ${data.db.queryLatency?.vectorCountMs}ms`,
                "sample: 10 bookmarks",
              ]
                .filter((value): value is string => Boolean(value))
                .join(" · "),
            },
            {
              icon: Zap,
              label: t("app_bookmarksTitle", "Bookmarks"),
              value: data.db.bookmarkCount,
              color: "bg-blue-500/10 text-blue-500",
            },
            {
              icon: Zap,
              label: t("app_vectorVectors", "Vector Data"),
              value: data.db.vectorCount,
              color: "bg-cyan-500/10 text-cyan-500",
              title: [
                data.db.vectorIndexStatus,
                data.db.vectorIndexLoadDurationMs == null
                  ? null
                  : `${data.db.vectorIndexLoadDurationMs}ms`,
              ]
                .filter((value): value is string => Boolean(value))
                .join(" · "),
            },
          ]
        : [],
    [data, t],
  );

  const aiMetrics = useMemo(
    () =>
      data
        ? [
            {
              icon: Cpu,
              label: t("app_aiProviderSelect", "Provider"),
              value: data.ai.provider,
              color: "bg-orange-500/10 text-orange-500",
            },
            {
              icon: Activity,
              label: t("app_cacheSize", "Cache Size"),
              value: data.ai.cacheStats.size,
              color: "ds-bg-success/10 ds-text-success",
            },
            {
              icon: Activity,
              label: t("app_cacheMaxSize", "Cache Max Size"),
              value: data.ai.cacheStats.maxSize,
              color: "bg-rose-500/10 text-rose-500",
            },
            {
              icon: Zap,
              label: t("app_ollamaAvailable", "Ollama Available"),
              value: data.ai.ollamaAvailable,
              color: "bg-blue-500/10 text-blue-500",
            },
          ]
        : [],
    [data, t],
  );

  const envMetrics = useMemo(
    () =>
      data
        ? [
            {
              icon: Globe,
              label: t("app_onlineStatus", "Online Status"),
              value: data.environment.onLine
                ? t("app_connected", "Connected")
                : t("app_offline", "Offline"),
              color: "bg-blue-500/10 text-blue-500",
            },
            {
              icon: Battery,
              label: t("app_battery", "Battery"),
              value: data.environment.batteryLevel
                ? `${Math.round(data.environment.batteryLevel * 100)}%`
                : "N/A",
              color: "ds-bg-success/10 ds-text-success",
            },
            {
              icon: Cpu,
              label: t("app_cpuCores", "CPU Cores"),
              value: data.environment.cores,
              color: "bg-[var(--bg-secondary)]0/10 text-[var(--text-muted)]",
            },
            {
              icon: Clock,
              label: t("app_uptime", "Uptime"),
              value: `${data.performance.upTime}s`,
              color: "bg-[var(--bg-secondary)]0/10 text-[var(--text-muted)]",
            },
          ]
        : [],
    [data, t],
  );

  const syncMetrics = useMemo(() => {
    type SyncProvider = {
      successCount?: number;
      attempts?: number;
      retryCount?: number;
      lastDurationMs?: number | null;
    };
    const providers = (data?.sync?.providers || {}) as Record<
      string,
      SyncProvider
    >;
    const keys = Object.keys(providers);
    if (keys.length === 0) {return [];}
    return keys.slice(0, 6).map((k) => {
      const m = providers[k] || {};
      return {
        provider: k,
        ok: (m.successCount ?? 0) > 0,
        attempts: m.attempts ?? 0,
        retries: m.retryCount ?? 0,
        lastMs: m.lastDurationMs ?? null,
      };
    });
  }, [data]);

  if (!show) {return null;}

  return (
    <div className="ds-modal-overlay z-[100] p-4">
      <div
        className="w-full max-w-2xl overflow-hidden shadow-2xl border ds-radius-card ds-bg-card ds-border"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagnostics-title"
      >
        <div className="flex items-center justify-between p-6 ds-border-b ds-bg-topbar">
          <div className="flex items-center gap-3">
            <Activity className="size-6 ds-text-accent" />
            <div>
              <h3
                id="diagnostics-title"
                className="text-lg font-semibold ds-text-primary line-clamp-2"
              >
                {t("app_systemHealth", "System Health")}
              </h3>
              <p className="text-xs ds-text-muted">
                {t("app_version", "BookmarkForge v1.0.0 Stable")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="transition-colors ds-text-muted"
            aria-label={t("app_close", "Close")}
          >
            <X className="size-6" aria-hidden="true" />
          </button>
        </div>

        <div className="p-8 max-h-[70vh] overflow-y-auto space-y-8 scrollbar-hide">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Activity className="size-8 text-[var(--text-secondary)] animate-spin" />
            </div>
          ) : (
            data && (
              <>
                <section className="space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2 ds-text-muted line-clamp-2">
                    <Wrench className="size-4" />{" "}
                    {t("app_intelligentMaintenance", "Intelligent vault maintenance")}
                  </h4>
                  <div className="p-3 ds-bg-secondary ds-border rounded-xl text-xs ds-text-muted">
                    <div className="flex items-center justify-between gap-3">
                      <span>{maintenanceStatus.enabled ? t("app_maintenanceEnabled", "Enabled") : t("app_maintenancePaused", "Paused")}</span>
                      <span>{maintenanceStatus.isRunning ? t("app_maintenanceRunning", "Running") : t("app_maintenanceIdle", "Idle")}</span>
                    </div>
                    {maintenanceStatus.lastResult && (
                      <p className="mt-1">{t("app_maintenanceLastResult", {
                        defaultValue: "Last run: {{repaired}} repaired · {{remaining}} remaining",
                        repaired: maintenanceStatus.lastResult.repaired,
                        remaining: maintenanceStatus.lastResult.report?.issues.reduce((sum, issue) => sum + issue.count, 0) ?? 0,
                      })}</p>
                    )}
                  </div>
                </section>

                <section className="space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2 ds-text-muted line-clamp-2">
                    <Database className="size-4" />{" "}
                    {t("app_databaseTitle", "Database (RxDB)")}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {dbMetrics.map((m, i) => (
                      <MetricCard
                        key={i}
                        icon={m.icon}
                        label={m.label}
                        value={m.value}
                        color={m.color}
                        title={
                          "title" in m && typeof m.title === "string"
                            ? m.title
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </section>

                <section className="space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2 ds-text-muted line-clamp-2">
                    <Cpu className="size-4" /> {t("app_aiEngine", "AI Engine")}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {aiMetrics.map((m, i) => (
                      <MetricCard
                        key={i}
                        icon={m.icon}
                        label={m.label}
                        value={m.value}
                        color={m.color}
                        title={
                          "title" in m && typeof m.title === "string"
                            ? m.title
                            : undefined
                        }
                      />
                    ))}
                    <MetricCard
                      icon={Cpu}
                      label="WebGPU Support"
                      value={data.ai.webGpuSupported ? "YES" : "NO"}
                      color={
                        data.ai.webGpuSupported
                          ? "ds-bg-success/10 ds-text-success"
                          : "bg-[var(--color-danger)]/10 ds-text-danger"
                      }
                    />
                    {data.ai.webGpuAdapter && (
                      <div className="col-span-1 md:col-span-2 p-3 bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]/50 rounded-xl border border-[var(--divider)] dark:border-[var(--divider)]">
                        <p className="text-[10px] uppercase font-semibold tracking-wider mb-1 ds-text-muted">
                          {t("app_gpuAdapter", "GPU Adapter")}
                        </p>
                        <p className="text-xs font-mono truncate ds-text-primary">
                          {data.ai.webGpuAdapter}
                        </p>
                      </div>
                    )}
                  </div>
                </section>

                <section className="space-y-4">
                  <h4 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2 ds-text-muted line-clamp-2">
                    <Globe className="size-4" />{" "}
                    {t("app_environment", "Environment")}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {envMetrics.map((m, i) => (
                      <MetricCard
                        key={i}
                        icon={m.icon}
                        label={m.label}
                        value={m.value}
                        color={m.color}
                        title={
                          "title" in m && typeof m.title === "string"
                            ? m.title
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </section>

                {syncMetrics.length > 0 && (
                  <section className="space-y-4">
                    <h4 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2 ds-text-muted line-clamp-2">
                      <RefreshCw className="size-4" />{" "}
                      {t("app_cloudSync", "Cloud Sync")}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {syncMetrics.map((m) => (
                        <div
                          key={m.provider}
                          className="flex items-center justify-between p-3 bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]/50 rounded-xl border border-[var(--divider)] dark:border-[var(--divider)]"
                        >
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
                              {m.provider}
                            </span>
                            <span className="text-[10px] text-[var(--text-muted)]">
                              {t(
                                "app_syncAttempts",
                                `attempts: ${m.attempts} · retries: ${m.retries}`,
                              )}
                            </span>
                          </div>
                          <span
                            className={`text-xs font-mono ${m.ok ? "ds-text-success" : "text-rose-500"}`}
                          >
                            {m.lastMs !== null
                              ? `${m.lastMs}ms`
                              : t("app_notAvailable", "n/a")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* ADR-052 Phase 1: residual legacy-v5 corpus, local-only.
                    Rendered only when the report is present (newer service
                    payloads keep the modal resilient to older mocks). */}
                {data.vaultCrypto && (
                  <section className="space-y-4">
                    <h4 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2 ds-text-muted line-clamp-2">
                      <ShieldCheck className="size-4" />{" "}
                      {t("app_vaultCrypto", "Vault Crypto")}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <MetricCard
                        icon={ShieldCheck}
                        label="Legacy v5 secrets"
                        value={
                          data.vaultCrypto.status === "ok"
                            ? String(data.vaultCrypto.legacyV5)
                            : t("app_notAvailable", "n/a")
                        }
                        color={
                          data.vaultCrypto.status === "ok" &&
                          data.vaultCrypto.legacyV5 === 0
                            ? "ds-bg-success/10 ds-text-success"
                            : "bg-[var(--color-danger)]/10 ds-text-danger"
                        }
                      />
                      <MetricCard
                        icon={ShieldCheck}
                        label="Salted v6 secrets"
                        value={
                          data.vaultCrypto.status === "ok"
                            ? String(data.vaultCrypto.saltedV6)
                            : t("app_notAvailable", "n/a")
                        }
                        color={
                          data.vaultCrypto.status === "ok"
                            ? "ds-bg-success/10 ds-text-success"
                            : "bg-[var(--bg-secondary)] ds-text-muted"
                        }
                      />
                    </div>
                    {data.salts && data.salts.length > 0 && (
                      <div className="mt-2 grid grid-cols-1 gap-1">
                        {data.salts.map((salt) => (
                          <div
                            key={salt.purpose}
                            className="flex items-center justify-between gap-2 text-[10px] font-mono"
                          >
                            <span className="truncate ds-text-secondary">
                              {salt.purpose} · {salt.governance} ·{" "}
                              {salt.rotatesWithPassword ? "rotates" : "static"}
                            </span>
                            <span
                              className={`shrink-0 ${
                                salt.provisioned
                                  ? "ds-text-success"
                                  : "ds-text-warning"
                              }`}
                            >
                              {salt.provisioned ? "provisioned" : "missing"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {/* Analytics KPIs */}
                <AnalyticsDiagnostics t={t} />
              </>
            )
          )}
        </div>

        <div
          className={`p-6 border-t ${isDark ? "border-[var(--divider)] bg-[var(--bg-primary)]/50" : "border-[var(--divider)] bg-white"} flex justify-between items-center`}
        >
          <span className="text-[10px] font-mono uppercase tracking-tighter ds-text-muted">
            {t(
              "app_diagnosticReportToken",
              `Diagnostic Report Token: ${reportToken}`,
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="truncate px-6 py-2 text-sm font-semibold transition-all transform active:scale-95 ds-radius-button ds-bg-accent-primary ds-text-white"
          >
            {t("app_closeDiagnostics", "Close Diagnostics")}
          </button>
        </div>
      </div>
    </div>
  );
};
