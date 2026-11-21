import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { EASE_OUT, DURATION_MENU } from "../../constants/motion";
import { useAutoProcessor } from "../../hooks/useAutoProcessor";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export const BackgroundProgress: React.FC = () => {
  const { isProcessing, totalItems, processedItems, currentItem } =
    useAutoProcessor();
  const { t } = useTranslation();

  if (!isProcessing) {
    return null;
  }

  const progress = totalItems > 0 ? (processedItems / totalItems) * 100 : 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        className="fixed bottom-6 end-6 z-50 w-[calc(100vw-3rem)] sm:w-auto sm:min-w-[20rem] sm:max-w-sm bg-white dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Loader2 className="size-5 animate-spin ds-text-accent" />
                <Sparkles className="size-3 ds-text-warning absolute -top-1 -end-1 animate-pulse" />
              </div>
              <span className="text-sm font-bold text-[var(--text-primary)] dark:text-white">
                {t("ai_processing_background", {
                  defaultValue: "AI Processing...",
                })}
              </span>
            </div>
            <span className="text-xs font-semibold text-cyan-500 bg-cyan-50 dark:bg-cyan-500/10 px-2 py-1 rounded-full">
              {Math.round(progress)}%
            </span>
          </div>

          <div className="w-full h-1.5 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-full mb-3 overflow-hidden">
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: progress }}
              transition={{ duration: DURATION_MENU, ease: EASE_OUT }}
              className="h-full w-full origin-left ds-bg-accent-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)]">
              <span>
                {processedItems} / {totalItems}{" "}
                {t("items", { defaultValue: "items" })}
              </span>
              {currentItem && (
                <span className="truncate max-w-[150px] text-[var(--text-muted)] italic">
                  {currentItem}
                </span>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
