import React from "react";
import { RefreshCw } from "lucide-react";
import type { TFunction } from "i18next";
import { autoProcessorService } from "../../services/ai/AutoProcessorService";
import { toast } from "sonner";
import { useGuardedAction } from "../../hooks/useGuardedAction";

interface AdvancedSectionProps {
  t: TFunction;
}

export const AdvancedSection: React.FC<AdvancedSectionProps> = ({ t }) => {
  // blockReentry (default true): an in-flight reprocess ignores new clicks.
  const { run: runReprocess, isRunning: isReprocessing } =
    useGuardedAction<number>({
      onSuccess: () => toast.success(t("app_reprocessStarted")),
    });

  const handleForceReprocess = () => {
    void runReprocess(() => autoProcessorService.forceReprocessAll());
  };

  return (
  <section data-testid="settings-advanced" className="pt-6 border-t border-[var(--divider)] dark:border-[var(--divider)]/50">
    {" "}
    <h3 className="ds-label-section flex items-center gap-2 mb-4 ds-text-warning">
      <RefreshCw className="size-4" />
      {t("app_advancedSettings")}
    </h3>
    <div className="p-5 ds-bg-warning-soft dark:bg-[var(--color-warning)]/10 border border-[var(--warning-soft-border)] dark:border-[var(--warning-soft-border)]/20 rounded-2xl shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] dark:text-[var(--text-accent)] tracking-tight">
            {t("app_forceReprocess")}
          </h4>
          <p className="text-xs ds-text-warning dark:ds-text-warning/80 font-medium">
            {t("app_forceReprocessDesc")}
          </p>
        </div>
        <button
          onClick={handleForceReprocess}
          disabled={isReprocessing}
          className="truncate px-5 py-2.5 ds-bg-warning-soft hover:ds-bg-warning-soft dark:bg-[var(--color-warning)]/20 dark:hover:bg-[var(--color-warning)]/30 ds-text-warning dark:ds-text-warning rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-sm whitespace-nowrap disabled:opacity-50"
        >
          {t("app_start", "Iniciar")}
        </button>
      </div>
    </div>
  </section>
  );
};
