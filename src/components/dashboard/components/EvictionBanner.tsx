import React from "react";
import { motion } from "motion/react";
import { AlertTriangle, CloudOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DURATION_COLLAPSE } from "../../../constants/motion";
import { CollapsibleSurface } from "./CollapsibleSurface";

interface EvictionBannerProps {
  show: boolean;
  onDismiss: () => void;
  onConfigureSync: () => void;
}

export const EvictionBanner: React.FC<EvictionBannerProps> = ({
  show,
  onDismiss,
  onConfigureSync,
}) => {
  const { t } = useTranslation();

  return (
    <CollapsibleSurface show={show} className="mb-6" testId="eviction-surface">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: show ? 1 : 0, y: show ? 0 : -10 }}
        transition={{ duration: DURATION_COLLAPSE }}
        style={{ pointerEvents: show ? 'auto' : 'none' }}
      >
          <div className="relative overflow-hidden rounded-2xl border border-[var(--warning-soft-border)]/20 ds-bg-warning-soft">
            <div className="relative p-5 md:p-6 flex items-start gap-4">
              <div className="shrink-0 size-12 rounded-xl bg-[var(--color-warning)]/20 flex items-center justify-center border border-[var(--warning-soft-border)]/30">
                <AlertTriangle className="size-6 ds-text-warning dark:ds-text-warning" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold ds-text-warning dark:ds-text-warning mb-1 flex items-center gap-2">
                  <CloudOff className="size-4" />
                  {t("app_evictionRiskTitle", "Data loss risk on Safari/iOS")}
                </h3>
                <p className="text-sm ds-text-warning/80 dark:ds-text-warning/80 leading-relaxed mb-3">
                  {t(
                    "app_evictionRiskDesc",
                    "Safari automatically deletes IndexedDB data after 7 days of inactivity. Set up cloud sync to protect your knowledge vault.",
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={onConfigureSync}
                    className="truncate inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-warning)] hover:bg-[var(--color-warning)] text-white text-sm font-bold shadow-md shadow-amber-600/20 transition-all hover:scale-105 active:scale-95"
                  >
                    <CloudOff className="size-4" />
                    {t("app_configureCloudSync", "Configure Cloud Sync")}
                  </button>
                  <button
                    onClick={onDismiss}
                    className="truncate inline-flex items-center gap-1.5 px-3 py-2 rounded-xl ds-text-warning dark:ds-text-warning text-sm font-medium hover:bg-[var(--color-warning)]/10 transition-colors"
                  >
                    <X className="size-4" />
                    {t("app_dismissEviction", "Got it, I'll do it later")}
                  </button>
                </div>
              </div>
            </div>
          </div>
      </motion.div>
    </CollapsibleSurface>
  );
};
