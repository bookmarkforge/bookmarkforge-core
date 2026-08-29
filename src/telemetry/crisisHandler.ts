/**
 * Crisis Handler — global error capture and containment.
 *
 * Policy: everything remains local-first. No remote sinks, Sentry, or IP tracking.
 * If the app must fail, it should fail in a controlled and locally logged way.
 */

import { setupGlobalErrorHandler, errorReporter } from "./errorReporter";
import { initProductionMonitor, stopProductionMonitor } from "./productionMonitor";
import { startClientEventReporter } from "../services/clientEventReporter";

let crisisDisposed = false;

/**
 * Initializes all crisis handlers.
 * Returns a cleanup function for unsubscribing during React unmount.
 */
export function initCrisisHandler(): () => void {
  if (crisisDisposed) return () => {};

  // 1. Global errors (ErrorEvent), outside React.
  const errorHandler = setupGlobalErrorHandler();

  // 2. Integrity, CSP, and storage-pressure monitoring.
  initProductionMonitor();

  // 3. Forward operational events (storage-pressure / bundle-integrity-spike)
  //    to the self-hosted companion server for threshold alerting. Gated by
  //    the local diagnostics opt-in; same-origin only.
  const stopEventReporter = startClientEventReporter();

  // 4. Initial crisis report (local IndexedDB only).
  void errorReporter.reportError(
    new Error("Crisis handler initialized — local monitoring active"),
    { source: "crisisHandler", critical: "true" }
  );

  crisisDisposed = false;

  return () => {
    if (crisisDisposed) return;
    crisisDisposed = true;
    errorHandler();
    stopProductionMonitor();
    stopEventReporter();
    errorReporter.dispose();
  };
}

export default initCrisisHandler;