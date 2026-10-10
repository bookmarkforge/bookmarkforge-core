import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSecurityStore } from "./useSecurityStore";
import { useSettings } from "./useSettings";
import { toast } from "sonner";
import { securityVault } from "../services/SecurityVault";
import { encryptionService } from "../services/EncryptionService";
import { logger } from "../utils/logger";

/**
 * Arm the idle auto-lock on an **absolute deadline** instead of a countdown.
 *
 * A relative `setTimeout(timeoutMs)` is only a promise until the browser
 * decides otherwise: a hidden tab is throttled to roughly one timer per
 * minute, a frozen/bfcache-frozen tab stops running timers entirely, and a
 * suspended device (lid closed, mobile backgrounded) runs none of them at
 * all. When the page wakes up, the countdown has not moved, so the vault
 * would stay unlocked for another full timeout after a laptop slept for
 * hours — the exact opposite of what an idle lock is for.
 *
 * The deadline (`deadlineRef`) is a wall-clock instant, so every moment the
 * document gets control back is a chance to notice it has passed:
 *
 *   - `visibilitychange` — tab hidden or shown again (also fires when a
 *     frozen tab is restored on some platforms).
 *   - `pageshow` — bfcache restore: the page resumed without a reload.
 *   - `focus` — window regained focus without a visibility change.
 *   - `resume` — Page Lifecycle event fired by Chrome on Android when the
 *     page comes back from a frozen/suspended state.
 *   - the timer itself, for the visible case.
 *
 * The timer is never trusted: when it fires, the current time is compared
 * against the deadline. Firing early (browsers clamp large delays, and
 * `setTimeout` overflows above 2^31-1 ms) re-arms the remainder instead of
 * locking early and discarding the configured timeout. Firing late (the
 * throttled case) locks immediately, so the vault is never left open past
 * the deadline in a foreground tab either.
 *
 * Activity (`mousemove`/`keydown`/`click`/`scroll`) pushes the deadline
 * forward, rate-limited by a cooldown so a moving pointer does not re-arm on
 * every event.
 */
export const AutoLockManager = () => {
  const { t } = useTranslation();
  const { isLocked, lock } = useSecurityStore();
  const { autoLockEnabled, autoLockTimeout } = useSettings();
  const autoLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Absolute wall-clock instant the vault must lock; null = nothing armed. */
  const deadlineRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(0);

  useEffect(() => {
    const ACTIVITY_COOLDOWN_MS = 2000;
    const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // configurable, fallback 5 min
    // `setTimeout` delays above 2^31-1 ms overflow and fire on the next tick,
    // so chunk anything longer and let the deadline check re-arm.
    const MAX_TIMER_DELAY_MS = 2_147_483_647;

    const clearTimer = () => {
      if (autoLockTimerRef.current !== null) {
        clearTimeout(autoLockTimerRef.current);
        autoLockTimerRef.current = null;
      }
    };

    const lockNow = async () => {
      deadlineRef.current = null;
      clearTimer();
      if (!isLocked) {
        // SECURITY: First lock the crypto vault, then update UI state.
        // Auto-lock must clean sensitive material (master password, AI keys)
        // from memory, not just hide the UI behind a lock screen.
        try {
          if (!securityVault.isLocked()) {
            await securityVault.lock();
          }
          await encryptionService.destroy();
        } catch (err) {
          logger.warn("[AutoLockManager] Failed to lock vault on auto-lock", {
            error: err,
          });
        }
        // Use lock() instead of setForceSetup(true) to show unlock screen,
        // not first-time setup screen. Auto-lock should never force setup.
        lock();
        toast.info(t("app_vaultLocked", "Vault locked"));
      }
    };

    /** Compare now against the deadline and lock, re-arm, or stay idle. */
    const checkDeadline = () => {
      clearTimer();
      const deadline = deadlineRef.current;
      if (deadline === null) {
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        lockNow();
        return;
      }
      autoLockTimerRef.current = setTimeout(
        checkDeadline,
        Math.min(remaining, MAX_TIMER_DELAY_MS),
      );
    };

    const armDeadline = () => {
      if (!autoLockEnabled || isLocked) {
        deadlineRef.current = null;
        clearTimer();
        return;
      }
      deadlineRef.current = Date.now() + (autoLockTimeout || DEFAULT_TIMEOUT_MS);
      checkDeadline();
    };

    const handleActivity = () => {
      const now = Date.now();
      // Activity that lands after the deadline must not resurrect a session
      // whose timeout already elapsed (e.g. a stray pointer event on a tab
      // that was throttled past the deadline and never fired its timer):
      // the deadline wins over the activity that follows it.
      if (deadlineRef.current !== null && now >= deadlineRef.current) {
        lockNow();
        return;
      }
      if (now - lastActivityRef.current < ACTIVITY_COOLDOWN_MS) {
        return;
      }
      lastActivityRef.current = now;
      armDeadline();
    };

    // Every "we are running again" signal re-checks the deadline. The tab may
    // have been throttled, frozen, or suspended for longer than the timeout
    // without a single timer firing.
    const handleResume = () => {
      const deadline = deadlineRef.current;
      if (deadline === null) {
        return;
      }
      if (Date.now() >= deadline) {
        lockNow();
        return;
      }
      checkDeadline();
    };

    window.addEventListener("mousemove", handleActivity, { passive: true });
    window.addEventListener("keydown", handleActivity, { passive: true });
    window.addEventListener("click", handleActivity, { passive: true });
    window.addEventListener("scroll", handleActivity, { passive: true });
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);
    document.addEventListener("visibilitychange", handleResume);
    // Page Lifecycle (Chrome on Android): fired when the page is thawed after
    // being frozen, where no timer has run and no visibility event is
    // guaranteed. Not in every runtime, hence the plain addEventListener.
    document.addEventListener("resume", handleResume);

    armDeadline();

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("scroll", handleActivity);
      window.removeEventListener("focus", handleResume);
      window.removeEventListener("pageshow", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
      document.removeEventListener("resume", handleResume);
      clearTimer();
    };
  }, [autoLockEnabled, autoLockTimeout, isLocked, lock, t]);

  return null;
};
