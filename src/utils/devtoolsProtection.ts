import { logger } from "./logger";

/**
 * DevTools DETECTION — environment telemetry, NOT anti-debugging.
 *
 * Scope: this module detects an open DevTools window (outer/inner dimension
 * delta) and logs it; `isDevToolsOpen()` feeds environment snapshots and
 * diagnostics (e.g. the `suspicious_environment_detected` audit signal). It
 * does NOT hide, destroy, block or obfuscate anything.
 *
 * Why no "protection": client-side anti-debugging (debugger traps,
 * breakpoint fighting, rendering sabotage) is ineffective against a
 * determined user with full control of the browser process, and it actively
 * harms legitimate debugging of a local-first product where the user owns
 * the device and the data. The `Protection` name is kept for import
 * compatibility; treat this module as a signal source, not a security
 * control.
 */
let devtoolsOpen = false;
const threshold = 160;

function detectDevTools(): boolean {
  const w = window.outerWidth - window.innerWidth > threshold;
  const h = window.outerHeight - window.innerHeight > threshold;
  return w || h;
}

let detectionIntervalId: ReturnType<typeof setInterval> | null = null;

export function initDevToolsDetection(): void {
  if (detectionIntervalId !== null) {return;}
  detectionIntervalId = setInterval(() => {
    const isOpen = detectDevTools();
    if (isOpen && !devtoolsOpen) {
      devtoolsOpen = true;
      logger.warn("DevTools detected", { isOpen });
    } else if (!isOpen && devtoolsOpen) {
      devtoolsOpen = false;
    }
  }, 500);
  window.addEventListener("pagehide", () =>
    clearInterval(detectionIntervalId!),
  );
}

export function stopDevToolsDetection(): void {
  if (detectionIntervalId !== null) {
    clearInterval(detectionIntervalId);
    detectionIntervalId = null;
  }
}

export function initDevToolsProtection(): void {
  if (!import.meta.env.PROD) {return;}
  initDevToolsDetection();
}

/**
 * Checks if DevTools is currently open
 */
export function isDevToolsOpen(): boolean {
  return devtoolsOpen;
}
