/**
 * Crisis Handler — global error capture and containment.
 *
 * Policy: everything remains local-first. Remote error reporting and
 * remote telemetry have been removed per user request.
 * If the app must fail, it should fail in a controlled and locally logged way.
 */

import { setupGlobalErrorHandler, errorReporter } from "./errorReporter";
import { initProductionMonitor, stopProductionMonitor } from "./productionMonitor";

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

  // 3. Initial crisis report (local IndexedDB only).
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
    errorReporter.dispose();
  };
}

