/**
 * ADR-039: service-worker → app integrity bridge.
 *
 * The SW-side integrity runtime (scripts/sw-integrity-runtime.js, embedded
 * into dist/sw.js at build time) verifies every asset it serves against the
 * build manifest. A mismatch never reaches the page as executable code —
 * the SW answers 504 — but the app must still learn about the event so the
 * AppInitializer recovery screen and telemetry/productionMonitor fire on
 * the SAME contract the DOM-side check already uses:
 * window "bundle-integrity-failed".
 *
 * Extracted from main.tsx so the message→event mapping is unit-testable
 * without booting the whole app shell.
 */
export function initSwIntegrityBridge(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data: unknown = (event as MessageEvent).data;
    if (
      data &&
      typeof data === "object" &&
      (data as { type?: unknown }).type === "bundle-integrity-failed"
    ) {
      window.dispatchEvent(
        new CustomEvent("bundle-integrity-failed", {
          detail: data as Record<string, unknown>,
        }),
      );
    }
  });
}
