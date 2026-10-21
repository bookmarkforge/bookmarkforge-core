import { useInstallPrompt } from "./usePWA";

/**
 * Backwards-compatible Header-facing adapter.
 *
 * The install prompt has one implementation in usePWA.ts. Keeping this small
 * adapter preserves the existing public hook name for consumers while
 * preventing multiple beforeinstallprompt listeners and divergent state
 * machines.
 */
export function usePWAInstall() {
  const { isInstallable, promptInstall } = useInstallPrompt();

  return {
    isInstallable,
    installPWA: promptInstall,
  };
}
