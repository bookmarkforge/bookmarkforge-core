/**
 * PWA hooks.
 *
 * Scope (audit): the combined `usePWA()` barrel and its unused sub-hooks
 * (useAppBadge, useWebShare, useShareTarget, useWindowControlsOverlay,
 * useBackgroundSync) had zero production consumers — the real share-target
 * flow lives in `src/utils/shareRewrite.ts` (driven from App.tsx), and the
 * install prompt is consumed through `usePWAInstall` (Header). They were
 * removed so there is exactly one share-target model and one install-prompt
 * state machine. What remains:
 *   - `useInstallPrompt` — the single `beforeinstallprompt` implementation
 *     (Header consumes it via `usePWAInstall`).
 *   - re-exports of `useFileSystem` / `useDragAndDrop` (their own modules).
 */

import { useCallback, useSyncExternalStore } from "react";
import { logger } from "../utils/logger";
import { getNavigatorStandalone } from "../utils/browser-types";
export { useFileSystem } from "./useFileSystem";
export { useDragAndDrop } from "./useDragAndDrop";

// ==================== INSTALL PROMPT ====================

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallSnapshot = {
  isInstallable: boolean;
  isInstalled: boolean;
};

const initialInstallSnapshot: InstallSnapshot = {
  isInstallable: false,
  isInstalled: false,
};

let installSnapshot = initialInstallSnapshot;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installListenersReady = false;
let removeInstallListeners: (() => void) | null = null;
const installSubscribers = new Set<() => void>();

function emitInstallSnapshot(next: InstallSnapshot): void {
  installSnapshot = next;
  for (const subscriber of installSubscribers) subscriber();
}

function detectInstalledState(): boolean {
  if (typeof window === "undefined") return false;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
  return isStandalone || !!getNavigatorStandalone().standalone;
}

/** Install prompt is a process-wide browser event, so all hook consumers share one listener/state. */
function ensureInstallListeners(): void {
  if (installListenersReady || typeof window === "undefined") return;
  installListenersReady = true;
  emitInstallSnapshot({
    ...installSnapshot,
    isInstalled: detectInstalledState(),
  });

  const handleBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    emitInstallSnapshot({ ...installSnapshot, isInstallable: true });
  };
  const handleAppInstalled = () => {
    deferredInstallPrompt = null;
    emitInstallSnapshot({ isInstallable: false, isInstalled: true });
    logger.info("[PWA] App installed");
  };

  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", handleAppInstalled);
  removeInstallListeners = () => {
    window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.removeEventListener("appinstalled", handleAppInstalled);
    deferredInstallPrompt = null;
    installSnapshot = { ...installSnapshot, isInstallable: false };
    installListenersReady = false;
    removeInstallListeners = null;
  };
}

function subscribeInstall(listener: () => void): () => void {
  ensureInstallListeners();
  installSubscribers.add(listener);
  return () => {
    installSubscribers.delete(listener);
    // The browser event is process-wide, but it only needs to be attached
    // while at least one React consumer is mounted. This keeps the singleton
    // state shared across consumers without leaking listeners after the last
    // consumer unmounts.
    if (installSubscribers.size === 0) {
      removeInstallListeners?.();
    }
  };
}

function getInstallSnapshot(): InstallSnapshot {
  ensureInstallListeners();
  return installSnapshot;
}

/**
 * Hook for PWA install prompt. The singleton store prevents duplicate
 * beforeinstallprompt listeners when Header and another PWA consumer mount.
 */
export function useInstallPrompt(): {
  promptInstall: () => Promise<boolean>;
  isInstallable: boolean;
  isInstalled: boolean;
} {
  const snapshot = useSyncExternalStore(
    subscribeInstall,
    getInstallSnapshot,
    () => initialInstallSnapshot,
  );

  const promptInstall = useCallback(async (): Promise<boolean> => {
    const prompt = deferredInstallPrompt;
    if (!prompt) return false;

    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      logger.info(
        outcome === "accepted"
          ? "User accepted the PWA install"
          : "User dismissed the PWA install",
      );
      return outcome === "accepted";
    } catch (error) {
      logger.warn("[PWA] Install prompt failed", { error });
      return false;
    } finally {
      deferredInstallPrompt = null;
      emitInstallSnapshot({ ...installSnapshot, isInstallable: false });
    }
  }, []);

  return {
    promptInstall,
    isInstallable: snapshot.isInstallable,
    isInstalled: snapshot.isInstalled,
  };
}
