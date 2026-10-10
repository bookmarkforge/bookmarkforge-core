import React from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import type { TFunction } from "i18next";

interface FocusModeSectionProps {
  isDistractionFree: boolean;
  setIsDistractionFree: (v: boolean) => void;
  t: TFunction;
}

export const FocusModeSection: React.FC<FocusModeSectionProps> = ({
  isDistractionFree,
  setIsDistractionFree,
  t,
}) => (
  <section data-testid="settings-focus-mode" className="space-y-4">
    <h3 className="text-xs font-semibold text-[var(--text-muted)] dark:text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2">
      <Maximize2 className="size-4" /> {t("app_focusMode")}
    </h3>
    <div className="space-y-5 p-5 bg-white dark:bg-[var(--bg-primary)] rounded-2xl border border-[var(--divider)] dark:border-[var(--divider)] shadow-sm">
      <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-muted)] font-medium">
        {t(
          "app_focusModeDesc",
          "Hide the top menu to focus 100% on your content.",
        )}
      </p>
      <button
        onClick={() => setIsDistractionFree(!isDistractionFree)}
        className={`truncate w-full px-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors shadow-sm ${
          isDistractionFree
            ? "bg-[var(--danger-soft)] dark:bg-[var(--color-danger)]/10 ds-text-danger dark:ds-text-danger border border-[var(--danger-soft-border)] dark:border-[var(--danger-soft-border)]/20"
            : "bg-[var(--bg-primary)] dark:bg-[var(--bg-secondary)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] text-[var(--text-primary)] dark:text-[var(--text-primary)]"
        }`}
      >
        {isDistractionFree ? (
          <Minimize2 className="size-4" />
        ) : (
          <Maximize2 className="size-4" />
        )}
        {isDistractionFree
          ? t("app_disableFocusMode", "Disable Focus Mode")
          : t("app_enableFocusMode", "Enable Focus Mode")}
      </button>
    </div>
  </section>
);
