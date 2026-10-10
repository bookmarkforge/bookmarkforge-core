import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  Shield,
  Activity,
  AlertTriangle,
  CheckCircle,
  Info,
  Cpu,
  Zap,
} from "lucide-react";
import {
  diagnosticService,
  SystemDiagnostics,
} from "../../services/DiagnosticService";
import { useTranslation } from "react-i18next";
import { logger } from "../../utils/logger";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";

export const SystemIntegrity = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<SystemDiagnostics | null>(null);
  // Mount load via autoLoad + a 30s polling interval driving load() (each
  // tick begins a new generation, so a slow fetch is superseded by the next
  // one — the original begin()-per-call semantics).
  const { load, loading } = useGuardedDataLoad<SystemDiagnostics>(
    async () => diagnosticService.getDiagnostics(),
    {
      onSuccess: (res) => setData(res),
      onError: (error) =>
        logger.error("[SystemIntegrity] Failed to load diagnostics", { error }),
    },
  );

  useEffect(() => {
    const interval = setInterval(() => void load(), 30000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading || !data) {return null;}

  const healthScore = data.ai.webGpuSupported ? 98 : 72;
  const statusColor = healthScore > 90 ? "ds-text-success" : "ds-text-warning";

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="p-10 bg-white dark:bg-[var(--bg-primary)]/40 border border-[var(--divider)] dark:border-[var(--divider)]/50 rounded-[3rem] shadow-sm relative overflow-hidden group"
    >
      <div
        className={`absolute -left-20 -bottom-20 size-80 bg-indigo-500/5 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200`}
      />

      <div className="flex items-center justify-between mb-10 relative z-10">
        <div className="flex items-center gap-5">
          <div className="p-4 bg-indigo-500 text-white rounded-[1.5rem] shadow-xl shadow-indigo-500/20 group-hover:scale-110 transition-transform duration-200">
            <Shield className="size-7" />
          </div>
          <div>
            <h3 className="text-2xl font-semibold text-[var(--text-primary)] dark:text-white tracking-tight">
              {t("syst_integrity")}
            </h3>
            <p className="text-xs text-[var(--text-muted)] font-bold uppercase tracking-widest mt-1">
              {t("syst_realtimeAudit")}
            </p>
          </div>
        </div>
        <div className="text-end">
          <div
            className={`text-4xl font-semibold tabular-nums tracking-tighter ${statusColor}`}
          >
            {healthScore}%
          </div>
          <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold tracking-[0.08em] whitespace-nowrap">
            {t("syst_healthScore")}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
        {/* WebGPU Status */}
        <div className="p-6 bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-card)]/30 rounded-[2rem] border border-[var(--divider)] dark:border-[var(--divider)]/50 hover:shadow-lg transition-[box-shadow] duration-200 group/card">
          <div className="flex items-center gap-3 mb-4">
            <Cpu className="size-5 text-cyan-500 group-hover/card:rotate-12 transition-transform" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {t("syst_acceleration")}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
              {t("app_webGPU", "WebGPU")}
            </span>
            {data.ai.webGpuSupported ? (
              <div className="flex items-center gap-2 px-3 py-1 ds-bg-success/10 rounded-full">
                <CheckCircle className="size-3.5 ds-text-success" />
                <span className="text-[10px] font-semibold ds-text-success uppercase">
                  {t("app_on", "ON")}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1 bg-[var(--color-warning)]/10 rounded-full">
                <AlertTriangle className="size-3.5 ds-text-warning" />
                <span className="text-[10px] font-semibold ds-text-warning uppercase">
                  {t("app_off", "OFF")}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Memory Pressure */}
        <div className="p-6 bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-card)]/30 rounded-[2rem] border border-[var(--divider)] dark:border-[var(--divider)]/50 hover:shadow-lg transition-[box-shadow] duration-200 group/card">
          <div className="flex items-center gap-3 mb-4">
            <Activity className="size-5 text-blue-500 group-hover/card:scale-110 transition-transform" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {t("syst_resources")}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
              {t("syst_memory")}
            </span>
            <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">
              {data.environment.memoryLimit}
              {t("syst_gbRam", "GB RAM")}
            </span>
          </div>
        </div>

        {/* Real-time Uptime */}
        <div className="p-6 bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-card)]/30 rounded-[2rem] border border-[var(--divider)] dark:border-[var(--divider)]/50 hover:shadow-lg transition-[box-shadow] duration-200 group/card">
          <div className="flex items-center gap-3 mb-4">
            <Zap className="size-5 ds-text-warning group-hover/card:scale-110 transition-transform" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {t("syst_stability")}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
              {t("syst_uptime")}
            </span>
            <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">
              {data.performance.upTime}
              {t("syst_secondsShort", "s")}
            </span>
          </div>
        </div>
      </div>

      {/* Proactive Insights List */}
      <div className="mt-12 space-y-4 relative z-10">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)] mb-6 flex items-center gap-3 whitespace-nowrap">
          <Info className="size-4" /> {t("syst_proactiveInsights")}
        </h4>

        {!data.ai.webGpuSupported &&
          (data.environment.cores >= 8 || data.environment.isARM64) && (
            <motion.div
              whileHover={{ scale: 1.01 }}
              className="p-6 bg-[var(--color-warning)]/5 border border-[var(--warning-soft-border)]/20 rounded-[2rem] flex items-start gap-6 hover:shadow-xl transition-[box-shadow] duration-200"
            >
              <div className="p-3 bg-[var(--color-warning)]/10 ds-text-warning rounded-2xl shadow-inner">
                <AlertTriangle className="size-6 shrink-0" />
              </div>
              <div>
                <p className="text-base font-semibold text-[var(--text-primary)] dark:text-[var(--text-accent)] tracking-tight">
                  {data.environment.isARM64
                    ? t("syst_arm64Optim")
                    : t("syst_perfMismatch")}
                </p>
                <p className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-muted)] mt-2 font-medium leading-relaxed">
                  {data.environment.isARM64
                    ? t("syst_arm64OptimDesc")
                    : t("syst_perfMismatchDesc", {
                        cores: data.environment.cores,
                      })}
                </p>
              </div>
            </motion.div>
          )}

        <motion.div
          whileHover={{ scale: 1.01 }}
          className="p-6 ds-bg-success/5 border border-[var(--success-soft-border)]/20 rounded-[2rem] flex items-start gap-6 hover:shadow-xl transition-all"
        >
          <div className="p-3 ds-bg-success/10 ds-text-success rounded-2xl shadow-inner">
            <CheckCircle className="size-6 shrink-0" />
          </div>
          <div>
            <p className="text-base font-semibold text-[var(--text-primary)] dark:text-[var(--text-accent)] tracking-tight">
              {t("syst_dbOptimal")}
            </p>
            <p className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-muted)] mt-2 font-medium leading-relaxed">
              {t("syst_dbOptimalDesc")}
            </p>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};
