import { useState, useEffect } from "react";
import { Zap, Cpu, RefreshCw, HardDrive } from "lucide-react";
import { vectorIndexService } from "../services/ai/VectorIndexService";
import type { QuantizationMode } from "../services/ai/QuantizationService";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useGuardedAction } from "../hooks/useGuardedAction";
import { useGuardedDataLoad } from "../hooks/useGuardedDataLoad";
import { useVisibilityPolling } from "../hooks/useVisibilityPolling";

export const QuantizationPanel = () => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<QuantizationMode>("polar8");
  const [stats, setStats] = useState<{
    count: number;
    mode: string;
    memoryUsageBytes: number;
  } | null>(null);
  // Deliberately independent guards: stats polling does not invalidate an
  // in-progress rebuild, and commit does not share a guard with rebuild (if
  // they did, a click on "Save to Disk" during a long rebuild would leave
  // isRebuilding stuck). Each useGuardedAction/useGuardedDataLoad creates
  // its own internal guard, so independence is preserved.
  const { load: loadStats } = useGuardedDataLoad<
    { count: number; mode: string; memoryUsageBytes: number } | null
  >(
    async () => {
      const s = await vectorIndexService.getStats();
      return s && typeof s === "object" && "mode" in s
        ? (s as { count: number; mode: string; memoryUsageBytes: number })
        : null;
    },
    {
      onSuccess: (s) => {
        if (!s) {return;}
        setStats(s);
        setMode(s.mode as QuantizationMode);
      },
      onError: () => {
        // Polling failure is silent: the last known stats stay visible.
      },
    },
  );
  const {
    run: runRebuild,
    isRunning: isRebuilding,
  } = useGuardedAction<void>({
    onSuccess: () => {
      toast.success(t("app_indexRebuilt", { mode }));
    },
    onError: () => {
      toast.error(t("app_failedRebuild"));
    },
  });
  const { run: runCommit } = useGuardedAction<void>({
    blockReentry: false,
    onSuccess: () => {
      toast.success(t("app_indexSaved"));
    },
    onError: () => {
      toast.error(t("app_failedSaveIndex"));
    },
  });

  useEffect(() => {
    // Fetch initial stats in next tick to avoid synchronous setState in effect
    Promise.resolve().then(() => {
      void loadStats();
    });
  }, [loadStats]);
  // 5 s polling, paused while the tab is hidden, refreshed on resume so
  // the user sees current stats without waiting for the next tick.
  useVisibilityPolling(
    () => {
      Promise.resolve().then(() => {
        void loadStats();
      });
    },
    { intervalMs: 5000 },
  );

  const handleModeChange = async (newMode: QuantizationMode) => {
    if (isRebuilding) {
      return;
    }
    setMode(newMode);
    vectorIndexService.setQuantizationMode(newMode);
    await runRebuild(async () => {
      await vectorIndexService.rebuild();
      // loadStats begins its own (independent) stats guard generation —
      // deliberately NOT the rebuild guard, see the independence comment.
      await loadStats();
    });
  };

  const handleCommit = () => {
    runCommit(async () => {
      await vectorIndexService.commit();
    });
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) {
      return "0 B";
    }
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleAutoTune = async () => {
    // Determine mode based on device memory
    const memory =
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4;
    let recommendedMode: QuantizationMode = "polar8";

    if (memory <= 2) {
      recommendedMode = "qjl";
    } else if (memory <= 4) {
      recommendedMode = "polar4";
    } else {
      recommendedMode = "polar8";
    }

    if (mode === recommendedMode) {
      toast.info(t("app_alreadyOptimal", { mode: recommendedMode, memory }));
      return;
    }

    toast.info(t("app_autoTuningTo", { mode: recommendedMode, memory }));
    await handleModeChange(recommendedMode);
  };

  return (
    <div className="bg-white dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center text-cyan-600 dark:text-cyan-400">
            <Cpu className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] dark:text-white">
              {t("app_turboQuantEngine")}
            </h3>
            <p className="text-xs text-[var(--text-muted)]">
              {t("app_vectorCompressionDesc")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleAutoTune}
            className="truncate text-xs flex items-center gap-1 text-cyan-500 bg-cyan-50 dark:bg-cyan-500/10 px-2 py-1 rounded hover:bg-cyan-100 dark:hover:bg-cyan-500/20 transition-colors"
            title={t("app_autoTune")}
          >
            <Zap className="size-3.5" /> {t("app_autoTune")}
          </button>
          <button
            onClick={handleCommit}
            className="truncate text-xs flex items-center gap-1 text-[var(--text-muted)] hover:text-cyan-500 transition-colors"
            title={t("app_saveToDisk")}
          >
            <HardDrive className="size-3.5" /> {t("app_saveToDisk")}
          </button>
          {stats && (
            <div className="text-end">
              <div className="text-xs font-medium text-[var(--text-primary)] dark:text-white">
                {stats.count} {t("app_vectors")}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                {formatBytes(stats.memoryUsageBytes)} {t("app_ram")}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <button
          onClick={() => handleModeChange("none")}
          disabled={isRebuilding}
          className={`truncate p-3 rounded-lg border text-start transition-all ${
            mode === "none"
              ? "border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10 ring-1 ring-cyan-500/20"
              : "border-[var(--divider)] dark:border-[var(--divider)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]/50"
          }`}
        >
          <div className="font-medium text-sm text-[var(--text-primary)] dark:text-white mb-1">
            {t("app_float32")}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {t("app_noCompressionDesc")}
          </div>
        </button>

        <button
          onClick={() => handleModeChange("polar8")}
          disabled={isRebuilding}
          className={`truncate p-3 rounded-lg border text-start transition-all ${
            mode === "polar8"
              ? "border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10 ring-1 ring-cyan-500/20"
              : "border-[var(--divider)] dark:border-[var(--divider)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]/50"
          }`}
        >
          <div className="font-medium text-sm text-[var(--text-primary)] dark:text-white mb-1 flex items-center gap-1">
            {t("app_polar8")}{" "}
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold ds-bg-success-soft ds-text-success dark:ds-bg-success/30 dark:ds-text-success">
              {t("app_4x", "4x")}
            </span>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {t("app_recommendedDesc")}
          </div>
        </button>

        <button
          onClick={() => handleModeChange("polar4")}
          disabled={isRebuilding}
          className={`truncate p-3 rounded-lg border text-start transition-all ${
            mode === "polar4"
              ? "border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10 ring-1 ring-cyan-500/20"
              : "border-[var(--divider)] dark:border-[var(--divider)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]/50"
          }`}
        >
          <div className="font-medium text-sm text-[var(--text-primary)] dark:text-white mb-1 flex items-center gap-1">
            {t("app_polar4")}{" "}
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold ds-bg-warning-soft ds-text-warning dark:bg-[var(--color-warning)]/30 dark:ds-text-warning">
              {t("app_8x", "8x")}
            </span>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {t("app_largeVaultsDesc")}
          </div>
        </button>

        <button
          onClick={() => handleModeChange("qjl")}
          disabled={isRebuilding}
          className={`truncate p-3 rounded-lg border text-start transition-all ${
            mode === "qjl"
              ? "border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10 ring-1 ring-cyan-500/20"
              : "border-[var(--divider)] dark:border-[var(--divider)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]/50"
          }`}
        >
          <div className="font-medium text-sm text-[var(--text-primary)] dark:text-white mb-1 flex items-center gap-1">
            {t("app_qjl")}{" "}
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--danger-soft)] ds-text-danger dark:bg-[var(--color-danger)]/30 dark:ds-text-danger">
              {t("app_32x", "32x")}
            </span>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {t("app_extremeCompressionDesc")}
          </div>
        </button>
      </div>

      {isRebuilding && (
        <div className="flex items-center gap-2 text-xs text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20 p-2 rounded-lg">
          <RefreshCw className="size-3.5 animate-spin" />
          {t("app_rebuildingIndex")}
        </div>
      )}
    </div>
  );
};
