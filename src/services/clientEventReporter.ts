/**
 * Client Event Reporter — forwards operational events to the companion server.
 *
 * Listens for the window events dispatched by the app's monitors and
 * POSTs them to the self-hosted companion server (same-origin, /api/client-events):
 *
 *   - "storage-pressure"       from storageMonitor.ts   (level/pct/usage/quota/persisted)
 *   - "bundle-integrity-spike" from productionMonitor.ts (count/reason)
 *   - "error-spike"            from productionMonitor.ts (count/reason)
 *   - "csp-violation-spike"    from productionMonitor.ts (count/reason)
 *
 * The server aggregates them and alerts when >= 3 distinct clients report a
 * critical condition within 10 minutes (see server/src/client-events.ts).
 *
 * Privacy: gated behind the same opt-in the local error reporter uses
 * (bmf_local_error_storage / legacy bmf_telemetry_optin) — nothing is sent by
 * default. The payload carries only storage percentages and integrity counters:
 * never vault content, never credentials, never an IP (the server hashes it).
 * The destination is the user's OWN self-hosted server, same as /csp-report.
 *
 * Same-origin POSTs always pass the network firewall, and the endpoint exists
 * whenever the deployment runs the companion server (the default prod
 * topology). Failures are contained: a dead server must never break the app.
 *
 * Bounded retry with backoff: a transient server outage (network failure or
 * 5xx) does NOT drop the event — the reporter retries with exponential
 * backoff up to CLIENT_EVENT_RETRY_MAX_ATTEMPTS total attempts, then gives
 * up silently. Retries are coalesced per event type (only the LATEST payload
 * of each type is kept pending — a storage-pressure snapshot is state, not a
 * log line), so the pending queue stays bounded to one entry per type and
 * payloads never grow unbounded. 4xx responses are treated as permanent
 * (bad payload / rate-limited) and never retried.
 */

import { logger } from "../utils/logger";
import { safeGet } from "../store/safeStorage";
import type { StoragePressureDetail } from "../utils/storageMonitor";

const EVENT_ENDPOINT = "/api/client-events";
const RETRY_STATS_ENDPOINT = "/api/client-events/retry-stats";
const TELEMETRY_KEY = "bmf_local_error_storage";
const LEGACY_TELEMETRY_KEY = "bmf_telemetry_optin";
const PENDING_EVENT_STORAGE_KEY = "bmf_pending_client_event";

/** Total send attempts per event (1 initial + retries). Bounded — never retries forever. */
export const CLIENT_EVENT_RETRY_MAX_ATTEMPTS = 3;
/** Backoff base (ms), before bounded jitter and exponential growth. */
export const CLIENT_EVENT_RETRY_BASE_DELAY_MS = 300;
/** Maximum proportional jitter: delay varies by ±25% per client. */
export const CLIENT_EVENT_RETRY_JITTER_RATIO = 0.25;

interface PendingRetry {
  type: string;
  payload: Record<string, unknown>;
  attemptsUsed: number;
  timer: ReturnType<typeof setTimeout>;
}

let started = false;
let retryAttempts = 0;
let coalescedEvents = 0;
let droppedEvents = 0;
const listeners: Array<{
  target: Window;
  type: string;
  handler: (event: Event) => void;
}> = [];
/** Pending retries, one entry per event type (coalesced — latest wins). */
const pendingRetries = new Map<string, PendingRetry>();

/** Same consent signal as errorReporter: local diagnostics opt-in. */
function isReportingEnabled(): boolean {
  try {
    const current = safeGet(TELEMETRY_KEY);
    if (current !== null) return current === "true";
    return safeGet(LEGACY_TELEMETRY_KEY) === "true";
  } catch (_err) {
    return false;
  }
}

function reportRetryStats(): void {
  if (!started || !isReportingEnabled()) return;
  try {
    void fetch(RETRY_STATS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-event-retry-stats", ...getClientEventRetryStats() }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Diagnostics are best-effort and never affect event delivery.
  }
}

function persistPendingEvent(type: string, payload: Record<string, unknown>): void {
  try {
    localStorage.setItem(PENDING_EVENT_STORAGE_KEY, JSON.stringify({ type, payload }));
  } catch {
    // Storage may itself be unavailable during quota pressure; containment is required.
  }
}

function clearPersistedEvent(type: string): void {
  try {
    const raw = localStorage.getItem(PENDING_EVENT_STORAGE_KEY);
    if (!raw || (JSON.parse(raw) as { type?: string }).type === type) {
      localStorage.removeItem(PENDING_EVENT_STORAGE_KEY);
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function postEvent(payload: Record<string, unknown>): void {
  if (!isReportingEnabled()) return;
  const type = typeof payload.type === "string" ? payload.type : "event";
  // Coalesce per type: a new payload of the same type supersedes any pending
  // retry (latest state wins — no stale intermediate snapshots).
  const existing = pendingRetries.get(type);
  if (existing) {
    clearTimeout(existing.timer);
    pendingRetries.delete(type);
    coalescedEvents += 1;
    reportRetryStats();
  }
  persistPendingEvent(type, payload);
  attemptSend(type, payload, 1);
}

/**
 * Sends one attempt. On transient failure (network rejection or 5xx) schedules
 * a bounded retry with exponential backoff; on 4xx (permanent) gives up.
 * Every path is contained — a dead server must never surface as an error.
 */
function attemptSend(type: string, payload: Record<string, unknown>, attempt: number): void {
  // Guard: after stop()/reset, an in-flight fetch rejection must not schedule
  // a new retry (cleanup already ran). started is the single source of truth.
  if (!started) return;
  if (!isReportingEnabled()) return;
  if (attempt > 1) retryAttempts += 1;
  try {
    void fetch(EVENT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).then(
      (response) => {
        // 204/2xx: delivered. 4xx: permanent (bad payload / rate-limited) —
        // retrying would just hammer the server. Only 5xx is transient.
        if (response.ok) {
          clearPersistedEvent(type);
        } else if (response.status >= 500) {
          scheduleRetry(type, payload, attempt);
        }
      },
      () => {
        // Network failure (server down, offline) — transient, retry.
        scheduleRetry(type, payload, attempt);
      },
    );
  } catch (_err) {
    // Synchronous throw (sandboxed context) — contained, treated as transient.
    scheduleRetry(type, payload, attempt);
  }
}

function replayPersistedEvent(): void {
  if (!isReportingEnabled()) return;
  try {
    const raw = localStorage.getItem(PENDING_EVENT_STORAGE_KEY);
    if (!raw) return;
    const pending = JSON.parse(raw) as { type?: string; payload?: Record<string, unknown> };
    if (!pending.type || !pending.payload || typeof pending.payload !== "object") {
      localStorage.removeItem(PENDING_EVENT_STORAGE_KEY);
      return;
    }
    attemptSend(pending.type, pending.payload, 1);
  } catch {
    // Corrupt or unavailable local storage must not block app startup.
  }
}

function scheduleRetry(type: string, payload: Record<string, unknown>, attemptsUsed: number): void {
  if (!started) return; // cleanup already ran — never schedule after stop()
  if (attemptsUsed >= CLIENT_EVENT_RETRY_MAX_ATTEMPTS) {
    droppedEvents += 1;
    reportRetryStats();
    return;
  } // bounded: give up silently
  // Replace any pending retry for the same type (latest payload wins) and
  // cancel its timer so the queue stays bounded to one entry per type.
  const existing = pendingRetries.get(type);
  if (existing) clearTimeout(existing.timer);
  const exponentialDelay = CLIENT_EVENT_RETRY_BASE_DELAY_MS * 2 ** (attemptsUsed - 1);
  // Full bounded multiplicative jitter prevents clients that observed the
  // same outage at once from retrying in synchronized waves. Math.random is
  // only used for scheduling; the payload and retry bound remain unchanged.
  const jitter = (Math.random() * 2 - 1) * CLIENT_EVENT_RETRY_JITTER_RATIO;
  const delay = Math.max(0, Math.round(exponentialDelay * (1 + jitter)));
  const timer = setTimeout(() => {
    pendingRetries.delete(type);
    attemptSend(type, payload, attemptsUsed + 1);
  }, delay);
  pendingRetries.set(type, { type, payload, attemptsUsed, timer });
}

/** Cancels every pending retry timer (cleanup / reset). */
function clearPendingRetries(): void {
  for (const pending of pendingRetries.values()) {
    clearTimeout(pending.timer);
  }
  pendingRetries.clear();
}

function onStoragePressure(event: Event): void {
  const detail = (event as CustomEvent<StoragePressureDetail>).detail;
  if (!detail || typeof detail !== "object") return;
  postEvent({
    type: "storage-pressure",
    level: detail.level,
    pct: Math.round(detail.pct * 100) / 100,
    usage: detail.usage,
    quota: detail.quota,
    persisted: detail.persisted,
  });
}

function onIntegritySpike(event: Event): void {
  const detail = (event as CustomEvent<{ count?: number; reason?: string }>).detail;
  if (!detail || typeof detail !== "object") return;
  postEvent({
    type: "bundle-integrity-spike",
    count: typeof detail.count === "number" ? detail.count : undefined,
    reason: typeof detail.reason === "string" ? detail.reason.slice(0, 64) : undefined,
  });
}

function onErrorSpike(event: Event): void {
  const detail = (event as CustomEvent<{ count?: number; reason?: string }>).detail;
  if (!detail || typeof detail !== "object") return;
  postEvent({
    type: "error-spike",
    count: typeof detail.count === "number" ? detail.count : undefined,
    reason: typeof detail.reason === "string" ? detail.reason.slice(0, 64) : undefined,
  });
}

function onCspViolationSpike(event: Event): void {
  const detail = (event as CustomEvent<{ count?: number; reason?: string }>).detail;
  if (!detail || typeof detail !== "object") return;
  postEvent({
    type: "csp-violation-spike",
    count: typeof detail.count === "number" ? detail.count : undefined,
    reason: typeof detail.reason === "string" ? detail.reason.slice(0, 64) : undefined,
  });
}

function addListener(type: string, handler: (event: Event) => void): void {
  window.addEventListener(type, handler);
  listeners.push({ target: window, type, handler });
}

/**
 * Starts forwarding operational events to the companion server.
 * Returns a cleanup function (no-op if not started).
 */
export function startClientEventReporter(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  addListener("storage-pressure", onStoragePressure);
  addListener("bundle-integrity-spike", onIntegritySpike);
  addListener("error-spike", onErrorSpike);
  addListener("csp-violation-spike", onCspViolationSpike);
  replayPersistedEvent();

  logger.info(
    "[ClientEventReporter] Active — forwarding storage-pressure / bundle-integrity-spike / error-spike / csp-violation-spike to companion server (opt-in gated)",
  );

  return () => {
    if (!started) return;
    started = false;
    for (const { target, type, handler } of listeners) {
      target.removeEventListener(type, handler);
    }
    listeners.length = 0;
    clearPendingRetries();
  };
}

export function isClientEventReporterActive(): boolean {
  return started;
}

/** Snapshot retry telemetry for the server diagnostics bridge. */
export function getClientEventRetryStats(): {
  attempts: number;
  coalesced: number;
  dropped: number;
} {
  return { attempts: retryAttempts, coalesced: coalescedEvents, dropped: droppedEvents };
}

// For tests
export function __resetForTests(): void {
  started = false;
  listeners.length = 0;
  clearPendingRetries();
  retryAttempts = 0;
  coalescedEvents = 0;
  droppedEvents = 0;
  try {
    localStorage.removeItem(PENDING_EVENT_STORAGE_KEY);
  } catch {
    // Best-effort test/lifecycle cleanup.
  }
}
