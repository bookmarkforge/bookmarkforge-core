import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useTranslation } from "react-i18next";
import { logger } from "../../utils/logger";

interface PwaTestState {
  offlineReady: boolean;
  needRefresh: boolean;
}

const ReloadPromptContent = () => {
  const { t } = useTranslation();
  const [testState, setTestState] = useState<PwaTestState | null>(null);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      logger.info("SW Registered:", r);
    },
    onRegisterError(error) {
      logger.info("SW registration error", error);
    },
  });

  // The browser does not expose a portable way to synthesize a waiting
  // service worker in Playwright. In test mode only, provide a small event
  // bridge so E2E tests can exercise the real prompt UI without pretending
  // that a ServiceWorkerRegistration dispatches vite-plugin-pwa internals.
  useEffect(() => {
    if (import.meta.env.MODE !== "test") return;

    const handleTestState = (event: Event) => {
      const detail = (event as CustomEvent<Partial<PwaTestState>>).detail;
      if (!detail || typeof detail !== "object") return;
      setTestState({
        offlineReady: detail.offlineReady === true,
        needRefresh: detail.needRefresh === true,
      });
    };

    window.addEventListener("bookmarkforge:pwa-state", handleTestState);
    return () =>
      window.removeEventListener("bookmarkforge:pwa-state", handleTestState);
  }, []);

  const effectiveOfflineReady = testState?.offlineReady ?? offlineReady;
  const effectiveNeedRefresh = testState?.needRefresh ?? needRefresh;

  if (!effectiveOfflineReady && !effectiveNeedRefresh) {
    return null;
  }

  const close = () => {
    setTestState(null);
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  const updateSW = () => {
    updateServiceWorker(true);
  };

  return (
    <div
      data-testid="pwa-reload-prompt"
      className="fixed bottom-4 end-4 z-50 p-4 bg-white dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl shadow-lg"
    >
      <p
        data-testid="pwa-reload-message"
        className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-3"
      >
        {effectiveNeedRefresh
          ? t("app_updateAvailable", {
              defaultValue: "A new version is available.",
            })
          : t("app_offlineReady", {
              defaultValue: "App is ready for offline use.",
            })}
      </p>
      <div className="flex gap-2 justify-end">
        {effectiveNeedRefresh && (
          <button
            data-testid="pwa-reload-button"
            onClick={updateSW}
            className="truncate px-3 py-1.5 text-sm font-medium text-white bg-cyan-600 rounded-lg hover:bg-cyan-700"
          >
            {t("app_reload", { defaultValue: "Reload" })}
          </button>
        )}
        <button
          data-testid="pwa-dismiss-button"
          onClick={close}
          className="truncate px-3 py-1.5 text-sm text-[var(--text-secondary)] dark:text-[var(--text-muted)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] rounded-lg"
        >
          {t("app_dismiss", { defaultValue: "Dismiss" })}
        </button>
      </div>
    </div>
  );
};

export const ReloadPrompt = ReloadPromptContent;
