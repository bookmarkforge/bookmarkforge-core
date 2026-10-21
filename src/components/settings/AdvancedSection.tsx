import React, { useState } from "react";
import { RefreshCw, Copy, Check, LifeBuoy } from "lucide-react";
import type { TFunction } from "i18next";
import { autoProcessorService } from "../../services/ai/AutoProcessorService";
import { toast } from "sonner";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { copyRedactedDiagnostic } from "../../utils/supportDiagnostics";

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

  const [copied, setCopied] = useState(false);
  const { run: runCopy, isRunning: isCopying } = useGuardedAction<string>({
    onSuccess: () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t("app_diagCopyReportCopied", "Copied!"));
    },
    onError: () => toast.error(t("app_diagCopyFailed", "Could not copy diagnostic. See Help."))
  });

  const handleCopyDiagnostic = () => {
    void runCopy(() => copyRedactedDiagnostic(null));
  };

  return (
  <section data-testid="settings-advanced" className="pt-6 border-t border-[var(--divider)] dark:border-[var(--divider)]/50">
    {" "}
    <h3 className="ds-label-section flex items-center gap-2 mb-4 ds-text-warning">
      <RefreshCw className="size-4" />
      {t("app_advancedSettings")}
    </h3>
    <div className="space-y-3">
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
    <div className="p-4 rounded-xl border ds-card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold truncate"><LifeBuoy className="inline size-4 ds-text-accent align-[-2px] mr-1.5" />{t("app_helpDiagnostics", "Help & diagnostics")}</h4>
        <p className="text-xs ds-text-muted mt-1">{t("app_helpDiagnosticsDesc", "Copy a redacted diagnostic (counts & versions only — no vault content) to paste in support. Includes BF-E code if present.")} <a href="/help" className="underline" target="_blank" rel="noopener">/help</a></p>
      </div>
      <button onClick={handleCopyDiagnostic} disabled={isCopying} className="min-w-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold ds-bg-secondary ds-border shadow-sm disabled:opacity-50 truncate">
        {copied ? <Check className="size-4 ds-text-success" /> : <Copy className="size-4" />}
        {copied ? t("app_diagCopyReportCopied", "Copied!") : t("app_diagCopyReport", "Copy diagnostic")}
      </button>
    </div>
    </div>
  </section>
  );
};
