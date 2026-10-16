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
 * Privacy: gated behind its own explicit opt-in
 * (forge_consent_client_events, with the pre-banner broad telemetry key as a
 * migration fallback) — nothing is sent by default. The legacy local-error
 * storage flag never authorizes this remote channel. The payload carries only
 * storage percentages and integrity counters:
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
import { STORAGE_KEYS } from "../constants/storage-keys";
import type { StoragePressureDetail } from "../utils/storageMonitor";

const EVENT_ENDPOINT = "/api/client-events";
const RETRY_STATS_ENDPOINT = "/api/client-events/retry-stats";
// Audit 2026-08-30: previously read bmf_local_error_storage (the error
// storage key) instead of the client-events consent key from ConsentBanner.
// The user's client-events choice in the banner therefore had no effect.
// ADR-030: client-event forwarding is an independent remote purpose; the
// legacy local-error-storage key must never authorize it.
const CONSENT_KEY = STORAGE_KEYS.CONSENT_CLIENT_EVENTS;
const LEGACY_CONSENT_KEY = "bmf_telemetry_optin";
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

/** Consent gate: client-events forwarding opt-in from ConsentBanner. */
function isReportingEnabled(): boolean {
  try {
    const current = safeGet(CONSENT_KEY);
    if (current !== null) return current === "true";
    return safeGet(LEGACY_CONSENT_KEY) === "true";
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

function readPersistedEvents(): Record<string, Record<string, unknown>> {
  try {
    const raw = localStorage.getItem(PENDING_EVENT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    // Read the pre-v2 single-event shape written by older builds.
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { type?: unknown }).type === "string" &&
      (parsed as { payload?: unknown }).payload &&
      typeof (parsed as { payload?: unknown }).payload === "object"
    ) {
      const legacy = parsed as { type: string; payload: Record<string, unknown> };
      return { [legacy.type]: legacy.payload };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([type, payload]) =>
          typeof type === "string" &&
          payload !== null &&
          typeof payload === "object" &&
          !Array.isArray(payload),
      ),
    ) as Record<string, Record<string, unknown>>;
  } catch {
    // Corrupt or unavailable local storage must not block app startup.
    return {};
  }
}

function persistPendingEvent(type: string, payload: Record<string, unknown>): void {
  try {
    const pending = readPersistedEvents();
    pending[type] = payload;
    localStorage.setItem(PENDING_EVENT_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Storage may itself be unavailable during quota pressure; containment is required.
  }
}

function clearPersistedEvent(type: string, payload?: Record<string, unknown>): void {
  try {
    const pending = readPersistedEvents();
    const current = pending[type];
    // An older request must not clear a newer payload of the same event type.
    if (
      payload &&
      current &&
      JSON.stringify(current) !== JSON.stringify(payload)
    ) {
      return;
    }
    delete pending[type];
    if (Object.keys(pending).length === 0) {
      localStorage.removeItem(PENDING_EVENT_STORAGE_KEY);
    } else {
      localStorage.setItem(PENDING_EVENT_STORAGE_KEY, JSON.stringify(pending));
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
          clearPersistedEvent(type, payload);
        } else if (response.status >= 500) {
          scheduleRetry(type, payload, attempt);
        } else {
          // 4xx responses are permanent; do not replay a rejected payload on
          // every future startup.
          clearPersistedEvent(type, payload);
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
  const pending = readPersistedEvents();
  for (const [type, payload] of Object.entries(pending)) {
    if (!type || !payload || typeof payload !== "object") {
      clearPersistedEvent(type);
      continue;
    }
    attemptSend(type, payload, 1);
  }
}

function scheduleRetry(type: string, payload: Record<string, unknown>, attemptsUsed: number): void {
  if (!started) return; // cleanup already ran — never schedule after stop()
  if (attemptsUsed >= CLIENT_EVENT_RETRY_MAX_ATTEMPTS) {
    droppedEvents += 1;
    logger.warn("[ClientEventReporter] Event dropped after max retries", {
      type,
      attemptsUsed,
    });
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

/** Remove queued operational events when this purpose is revoked. */
export function clearPendingClientEvents(): void {
  clearPendingRetries();
  try {
    localStorage.removeItem(PENDING_EVENT_STORAGE_KEY);
  } catch {
    // INTENTIONAL SILENCE: local storage may be unavailable during quota pressure.
  }
}

function onConsentStorageChange(event: Event): void {
  const storageEvent = event as StorageEvent;
  if (storageEvent.key === CONSENT_KEY && storageEvent.newValue !== "true") {
    clearPendingClientEvents();
  }
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

  // A pending payload is itself a future remote disclosure. Do not retain it
  // when the current browser state has no consent for this purpose.
  if (!isReportingEnabled()) {
    clearPendingClientEvents();
  }
  addListener("storage-pressure", onStoragePressure);
  addListener("bundle-integrity-spike", onIntegritySpike);
  addListener("error-spike", onErrorSpike);
  addListener("csp-violation-spike", onCspViolationSpike);
  addListener("storage", onConsentStorageChange);
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
function getClientEventRetryStats(): {
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
    // INTENTIONAL SILENCE: test/lifecycle cleanup is best-effort.
  }
}
