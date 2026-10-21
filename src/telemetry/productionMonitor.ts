/**
 * Production Monitor — 3-alert strategy implementation
 *
 * 1. Integrity spike (bundleIntegrity)
 * 2. CSP violation spike
 * 3. Web Vitals poor rating
 *
 * All local-first, no remote sink. Events are dispatched so external
 * collectors (if configured) can forward, but core logic stays local.
 */

import { logger } from "../utils/logger";
import { errorReporter } from "./errorReporter";

let started = false;
let integrityFailCount = 0;
let integrityWindowStart = 0;
let cspViolationCount = 0;
let cspWindowStart = 0;
let errorSpikeCount = 0;
let errorWindowStart = 0;
const listeners: Array<{
  target: Window | Document;
  type: string;
  handler: (event: Event) => void;
}> = [];

function addListener(target: Window | Document, type: string, handler: (event: Event) => void): void {
  target.addEventListener(type, handler);
  listeners.push({ target, type, handler });
}

const INTEGRITY_SPIKE_THRESHOLD = 3;
const CSP_SPIKE_THRESHOLD = 10;
const ERROR_SPIKE_THRESHOLD = 3;
const ERROR_SPIKE_WINDOW_MS = 60_000; // 3 global errors in 60s
const WINDOW_MS = 5 * 60 * 1000;

function recordIntegritySpike(detail: unknown): void {
  const now = Date.now();
  if (now - integrityWindowStart > WINDOW_MS) {
    integrityFailCount = 0;
    integrityWindowStart = now;
  }
  integrityFailCount++;
  logger.error("[ProductionMonitor] integrity fail", { count: integrityFailCount, detail });
  if (integrityFailCount >= INTEGRITY_SPIKE_THRESHOLD) {
    logger.error("[ProductionMonitor] INTEGRITY SPIKE — rollback candidate", { count: integrityFailCount });
    try {
      window.dispatchEvent(
        new CustomEvent("bundle-integrity-spike", {
          detail: { count: integrityFailCount, at: new Date().toISOString(), reason: "spike" },
        }),
      );
    } catch { /* INTENTIONAL SILENCE: a throwing monitor listener must not abort integrity handling. */ }
    try {
      void errorReporter.reportError(new Error("Integrity spike detected"), {
        source: "productionMonitor",
        count: String(integrityFailCount),
      });
    } catch { /* INTENTIONAL SILENCE: the monitoring signal already fired; reporting failure is non-fatal. */ }
  }
}

function recordCspViolation(): void {
  const now = Date.now();
  if (now - cspWindowStart > WINDOW_MS) {
    cspViolationCount = 0;
    cspWindowStart = now;
  }
  cspViolationCount++;
  if (cspViolationCount >= CSP_SPIKE_THRESHOLD) {
    logger.error("[ProductionMonitor] CSP VIOLATION SPIKE", { count: cspViolationCount });
    try {
      window.dispatchEvent(
        new CustomEvent("csp-violation-spike", {
          detail: { count: cspViolationCount, at: new Date().toISOString() },
        }),
      );
    } catch { /* INTENTIONAL SILENCE: a throwing monitor listener must not abort CSP spike handling. */ }
  }
}

/**
 * Global error spike — 3 errors (or unhandled rejections) in 60s.
 * Global errors are already stored locally by errorReporter (when opt-in is
 * on); this counter is the MONITORING signal, not a second local store. The
 * window event is forwarded by clientEventReporter to /api/client-events so
 * the server can alert when several clients degrade at once.
 */
function recordGlobalError(): void {
  const now = Date.now();
  if (now - errorWindowStart > ERROR_SPIKE_WINDOW_MS) {
    errorSpikeCount = 0;
    errorWindowStart = now;
  }
  errorSpikeCount++;
  logger.debug("[ProductionMonitor] global error", { count: errorSpikeCount });
  if (errorSpikeCount >= ERROR_SPIKE_THRESHOLD) {
    logger.error("[ProductionMonitor] ERROR SPIKE — app degrading", { count: errorSpikeCount });
    try {
      window.dispatchEvent(
        new CustomEvent("error-spike", {
          detail: { count: errorSpikeCount, at: new Date().toISOString(), reason: "spike" },
        }),
      );
    } catch { /* INTENTIONAL SILENCE: a throwing monitor listener must not abort global error spike handling. */ }
  }
}

export function initProductionMonitor(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  // 1. Integrity spike
  addListener(window, "bundle-integrity-failed", (e) => {
    const detail = (e as CustomEvent).detail;
    recordIntegritySpike(detail);
  });

  // 2. CSP violations — listen for SecurityPolicyViolationEvent
  // In production CSP is enforced via nginx header; violations fire here.
  addListener(document, "securitypolicyviolation", (e) => {
    const ev = e as SecurityPolicyViolationEvent;
    // Redact sensitive query parameters from blockedURI to prevent PII
    // (session tokens, JWTs, OAuth codes) from leaking into error stores
    // or Sentry. Only log the directive and truncated, sanitized URI.
    const rawURI = ev.blockedURI ?? "";
    const sanitized = rawURI
      .slice(0, 200)
      .replace(/[?&](?:session|sid|jwt|code|token|key|auth|access_token|refresh_token)=[^&]*/gi, "=[REDACTED]");
    logger.warn("[ProductionMonitor] CSP violation", {
      directive: ev.violatedDirective,
      blockedURI: sanitized,
    });
    recordCspViolation();
  });

  // 3. Storage pressure (from storageMonitor)
  addListener(window, "storage-pressure", (e) => {
    const detail = (e as CustomEvent).detail as { level: string; pct: number };
    if (detail.level === "critical") {
      logger.error("[ProductionMonitor] STORAGE CRITICAL", detail);
    }
  });

  // 4. Global error spike (3 errors in 60s) — counts non-React window
  //    errors AND unhandled rejections (React errors are counted by
  //    ErrorBoundary; this closes the gap for everything else).
  addListener(window, "error", () => {
    recordGlobalError();
  });
  addListener(window, "unhandledrejection", () => {
    recordGlobalError();
  });

  logger.info("[ProductionMonitor] Started — integrity/CSP/storage guards active");
}

export function stopProductionMonitor(): void {
  started = false;
  // Remove the registered listeners: stop() must actually stop, otherwise a
  // restart (or a test suite) would stack duplicate handlers.
  for (const { target, type, handler } of listeners) {
    target.removeEventListener(type, handler);
  }
  listeners.length = 0;
}

export function isProductionMonitorActive(): boolean {
  return started;
}

// For tests
export function __resetForTests(): void {
  integrityFailCount = 0;
  cspViolationCount = 0;
  integrityWindowStart = 0;
  cspWindowStart = 0;
  errorSpikeCount = 0;
  errorWindowStart = 0;
  started = false;
  for (const { target, type, handler } of listeners) {
    target.removeEventListener(type, handler);
  }
  listeners.length = 0;
}
