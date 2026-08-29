import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSecurityStore } from "./useSecurityStore";
import { useSettings } from "./useSettings";
import { toast } from "sonner";

export const AutoLockManager = () => {
  const { t } = useTranslation();
  const { isLocked, setForceSetup } = useSecurityStore();
  const { autoLockEnabled, autoLockTimeout } = useSettings();
  const autoLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(0);

  useEffect(() => {
    const ACTIVITY_COOLDOWN_MS = 2000;

    const startTimer = () => {
      if (autoLockTimerRef.current) {
        clearTimeout(autoLockTimerRef.current);
        autoLockTimerRef.current = null;
      }
      if (autoLockEnabled && !isLocked) {
        const timeoutMs = autoLockTimeout || 5 * 60 * 1000; // configurable, fallback 5 min
        autoLockTimerRef.current = setTimeout(() => {
          if (!isLocked) {
            setForceSetup(true);
            toast.info(t("app_vaultLocked", "Vault locked"));
          }
        }, timeoutMs);
      }
    };

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivityRef.current < ACTIVITY_COOLDOWN_MS) {return;}
      lastActivityRef.current = now;
      startTimer();
    };

    window.addEventListener("mousemove", handleActivity, { passive: true });
    window.addEventListener("keydown", handleActivity, { passive: true });
    window.addEventListener("click", handleActivity, { passive: true });
    window.addEventListener("scroll", handleActivity, { passive: true });

    startTimer();

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("scroll", handleActivity);
      if (autoLockTimerRef.current) {
        clearTimeout(autoLockTimerRef.current);
      }
    };
  }, [autoLockEnabled, autoLockTimeout, isLocked, setForceSetup, t]);

  return null;
};
