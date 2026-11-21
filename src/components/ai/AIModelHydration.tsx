import React, { useEffect } from "react";
import { useWebLLMStore } from "../../store/webllmStore";
import { loadWebLLMService } from "../../services/pro-access";
import { motion, AnimatePresence } from "motion/react";
import { EASE_OUT, DURATION_MENU } from "../../constants/motion";
import { Brain, CheckCircle, AlertCircle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";

export const AIModelHydration: React.FC = () => {
  const { isDownloading, isWarmingUp, progressValue, progressText, error } =
    useWebLLMStore();
  const { t } = useTranslation();

  // Bridge WebLLMService's progress events into the store. Without this, the
  // store had no producers and this global hydration card never rendered
  // (only Chat.tsx subscribed, so the 1.5-4.5 GB download was invisible
  // outside the chat panel). Same subscription pattern as Chat.tsx.
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    // Pro resolution through the loader: the hydration card stays hidden
    // for Free users and Open Core exports alike — the load rejection is
    // the "unavailable" case this effect already tolerated.
    loadWebLLMService()
      .then((webLLMService) => {
        if (!active) {return;}
        unsubscribe = webLLMService.onProgress((progress) => {
          if (!active) {return;}
          const store = useWebLLMStore.getState();
          if (progress.progress < 1) {
            store.setProgress(progress.text, progress.progress);
          } else {
            store.setIsDownloading(false);
            store.setProgress("", 1);
          }
        });
      })
      .catch(() => {
        /* INTENTIONAL SILENCE: WebLLM is optional; the hydration card stays hidden when unavailable. */
      });
    return () => {
      active = false;
      unsubscribe?.();
      unsubscribe = null;
    };
  }, []);

  if (!isDownloading && !isWarmingUp && !error) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-6 end-6 z-50 w-[calc(100vw-3rem)] sm:w-auto sm:min-w-[20rem] sm:max-w-sm bg-white dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl shadow-2xl p-4 overflow-hidden"
      >
        <div className="flex items-start gap-3">
          <div className="p-2 ds-bg-hover ds-radius-item">
            {error ? (
              <AlertCircle className="size-5 ds-text-danger" />
            ) : progressValue >= 1 ? (
              <CheckCircle className="size-5 ds-text-success" />
            ) : isWarmingUp ? (
              <Brain className="size-5 animate-pulse ds-text-accent" />
            ) : (
              <Brain className="size-5 animate-pulse ds-text-accent" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] dark:text-[var(--text-accent)] flex items-center gap-2">
              {error
                ? t("app_somethingWentWrong")
                : isWarmingUp
                  ? t("app_aiWarmingUp", { defaultValue: "AI Warming Up" })
                  : t("app_localFirstAi")}
              {!error && progressValue < 1 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold ds-bg-accent-soft ds-text-accent">
                  {isWarmingUp ? "PREDICTIVE" : "WASM"}
                </span>
              )}
            </h4>

            <p className="text-xs text-[var(--text-muted)] dark:text-[var(--text-muted)] mt-1 truncate">
              {error ||
                progressText ||
                (isWarmingUp
                  ? t("app_preparingLocalAi", {
                      defaultValue: "Preparing local AI for faster response...",
                    })
                  : t("app_downloadingModel"))}
            </p>

            {!error && !isWarmingUp && (
              <div className="mt-3 space-y-3">
                <div className="flex justify-between text-[10px] font-medium text-[var(--text-muted)] mb-1">
                  <span>{t("app_webLlmProgress")}</span>
                  <span>{Math.round(progressValue * 100)}%</span>
                </div>
                <div className="h-1.5 w-full bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full w-full origin-left ds-bg-accent-primary"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: progressValue }}
                    transition={{ duration: DURATION_MENU, ease: EASE_OUT }}
                  />
                </div>
                {progressValue < 1 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-2.5 rounded-lg text-[10px] leading-relaxed flex items-start gap-2 ds-accent-hover-card"
                  >
                    <Info className="size-3.5 shrink-0 mt-0.5 ds-text-accent" />
                    <span>
                      {t(
                        "ai_modelDownloadWarning",
                        "This initial download is between 1.5 GB and 4.5 GB depending on your device. It will take a few minutes, but it's the price to pay for a 100% private AI forever. Your data never leaves your device!",
                      )}
                    </span>
                  </motion.div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Decorative background element */}
        <div className="absolute -end-4 -bottom-4 opacity-[0.03] dark:opacity-[0.05] pointer-events-none">
          <Brain className="size-24" />
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
