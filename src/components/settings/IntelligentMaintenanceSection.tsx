import React, { useEffect, useState } from "react";
import { BrainCircuit, Loader2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeGet } from "../../store/safeStorage";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import { intelligentMaintenanceService } from "../../services/ai/IntelligentMaintenanceService";
import { toast } from "sonner";

export const IntelligentMaintenanceSection: React.FC = () => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(() => {
    const stored = safeGet(STORAGE_KEYS.INTELLIGENT_MAINTENANCE_ENABLED);
    return stored === null ? true : stored === "true";
  });
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState(() => intelligentMaintenanceService.getStatus());

  useEffect(() => {
    intelligentMaintenanceService.setEnabled(enabled);
    setStatus(intelligentMaintenanceService.getStatus());
    return intelligentMaintenanceService.subscribe(() => {
      setStatus(intelligentMaintenanceService.getStatus());
    });
  }, [enabled]);

  const handleToggle = () => {
    const next = !enabled;
    setEnabled(next);
    toast.success(
      next
        ? t("app_maintenanceEnabled", "Intelligent maintenance enabled")
        : t("app_maintenanceDisabled", "Intelligent maintenance paused"),
    );
  };

  const runNow = async () => {
    if (running) return;
    setRunning(true);
    try {
      const result = await intelligentMaintenanceService.runNow();
      if (result.status === "completed") {
        toast.success(t("app_maintenanceFinished", "Maintenance complete: {{count}} repaired", { count: result.repaired }));
      } else if (result.status === "skipped") {
        toast.info(t("app_maintenanceSkipped", "Maintenance is temporarily paused"));
      } else {
        toast.warning(t("app_maintenancePartial", "Maintenance finished with {{count}} issue(s)", { count: result.failed }));
      }
    } catch {
      toast.error(t("app_maintenanceError", "Maintenance could not be completed"));
    } finally {
      setRunning(false);
    }
  };

  const lastResult = status.lastResult;
  const pending = lastResult?.report?.issues.reduce((sum, issue) => sum + issue.count, 0) ?? 0;
  const history = intelligentMaintenanceService.getHistory();

  return (
    <section data-testid="settings-intelligent-maintenance" className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2">
        <BrainCircuit className="size-4" />
        {t("app_intelligentMaintenance", "Intelligent vault maintenance")}
      </h3>
      <div className="space-y-4 p-4 bg-[var(--bg-card)]/50 rounded-xl border border-[var(--divider)]/50">
        <div className="flex items-start gap-3">
          <ShieldCheck className="size-5 mt-0.5 ds-text-success shrink-0" />
          <p className="text-xs ds-text-muted">
            {t("app_intelligentMaintenanceDesc", "BookmarkForge checks your vault in the background and repairs only safe, regenerable data such as pending processing and search indexes. Your original content is not changed.")}
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 p-3 bg-[var(--bg-secondary)]/30 rounded-lg border border-[var(--divider)]/50">
          <div>
            <h4 className="text-sm font-semibold ds-text-primary truncate">
              {t("app_automaticMaintenance", "Automatic maintenance")}
            </h4>
            <p className="text-[11px] ds-text-muted">
              {enabled
                ? t("app_maintenanceRunsWhenIdle", "Runs locally when you are inactive")
                : t("app_maintenancePaused", "Paused until you enable it again")}
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            role="switch"
            aria-checked={enabled}
            aria-label={t("app_automaticMaintenance", "Automatic maintenance")}
            className={`relative w-12 h-6 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] focus-visible:outline-offset-2 ${enabled ? "bg-cyan-500" : "bg-[var(--state-inactive-border)]"}`}
          >
            <span className={`absolute top-[2px] left-[2px] size-5 bg-white rounded-full shadow-md transition-transform ${enabled ? "translate-x-6" : "translate-x-0"}`} />
          </button>
        </div>
        {history.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-widest ds-text-muted truncate">
              {t("app_maintenanceHistory", "Recent maintenance")}
            </h4>
            {history.slice(0, 3).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between text-[11px] ds-text-muted">
                <span>{new Date(entry.completedAt).toLocaleString()}</span>
                <span>{entry.status} · {entry.repaired} {t("app_repaired", "repaired")}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-[11px] ds-text-muted">
            {lastResult
              ? t("app_maintenanceLastResult", "Last run: {{repaired}} repaired · {{remaining}} remaining", { repaired: lastResult.repaired, remaining: pending })
              : t("app_maintenanceNotRun", "No maintenance run recorded yet")}
            {status.lastSkippedReason && ` · ${t(`app_maintenanceReason_${status.lastSkippedReason}`, { defaultValue: status.lastSkippedReason })}`}
          </div>
          <button
            type="button"
            onClick={() => void runNow()}
            disabled={running || status.isRunning}
            className="truncate px-4 py-2 text-xs font-bold ds-accent-filled rounded-lg disabled:opacity-50"
          >
            {running && <Loader2 className="size-3 animate-spin inline me-2" />}
            {t("app_runMaintenanceNow", "Check and repair now")}
          </button>
        </div>
      </div>
    </section>
  );
};
