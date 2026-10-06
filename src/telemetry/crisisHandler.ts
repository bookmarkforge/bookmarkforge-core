/**
 * Crisis Handler — global error capture and containment.
 *
 * Policy: everything remains local-first by default. Remote error reporting
 * (Sentry) is opt-in and only activates when BOTH hold:
 *   1. The operator configured VITE_SENTRY_DSN at build time, AND
 *   2. the user consented via the consent banner (forge_consent_error_reporting).
 * If the app must fail, it should fail in a controlled and locally logged way.
 */

import { setupGlobalErrorHandler, errorReporter } from "./errorReporter";
import { startClientEventReporter } from "../services/clientEventReporter";

// Production monitor removed for Core export
const initProductionMonitor = () => {
  // Intentional silence: production monitor removed for Core export
};
const stopProductionMonitor = () => {
  // Intentional silence: production monitor removed for Core export
};

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
  //    the consent opt-in; same-origin only.
  const stopEventReporter = startClientEventReporter();

  // 4. The global error setup owns the optional Sentry initialization. Keep
  //    one initialization path so accepting consent cannot create duplicate
  //    SDK clients or duplicate envelopes.

  // 5. Initial crisis report (local IndexedDB only).
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