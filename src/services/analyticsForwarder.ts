/**
 * Analytics Forwarder — opt-in, aggregated, non-PII channel to the server.
 *
 * AnalyticsService keeps every product event LOCAL by default. When the user
 * opts in via the consent banner (`forge_consent_analytics`), this forwarder
 * sends ONE daily, aggregated bucket per install to the companion server
 * (same-origin `/api/analytics/events`):
 *
 *   { "iid": "<sha256 hex>", "counts": { "vault_created": 1, "bookmark_created": 3 } }
 *
 * Privacy contract:
 *   - No vault content, prompts, URLs, titles, timestamps or free-form fields.
 *   - The install id is a random UUID stored locally; only its SHA-256 hash
 *     leaves the device. The hash is pseudonymous and bounded (it enables
 *     cohort retention D1/D7/D30 without exposing the raw identifier).
 *   - The server stamps the UTC day at ingest, so client clocks are never
 *     trusted. New payloads carry a batchId: partial batches are additive and
 *     a retried batch is applied only once. Payloads without batchId keep the
 *     legacy replace semantics.
 *   - Fire-and-forget: a dead/absent companion server must never surface as
 *     an error or retry storm. No queue — analytics is best-effort.
 *   - Same-origin POSTs pass the network firewall; the endpoint only exists
 *     when the deployment runs the companion server.
 */
import { logger } from "../utils/logger";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { isPurposeConsented } from "./ConsentService";
import type { AnalyticsEvent, AnalyticsEventType } from "./AnalyticsService";

// ADR-030: explicit batch identity makes opt-in analytics additive and
// idempotent without sending raw event identifiers or content.

const EVENTS_ENDPOINT = "/api/analytics/events";
const INSTALL_ID_KEY = STORAGE_KEYS.ANALYTICS_INSTALL_ID;
const MAX_INSTALL_ID_LENGTH = 128;
const MAX_BATCH_ID_LENGTH = 128;
const BATCH_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
/** Hard cap for direct callers and unload paths; analytics is best-effort. */
export const MAX_FORWARDED_EVENTS = 512;
/** Prevent a forged local batch from overflowing aggregate counters. */
const MAX_FORWARDED_COUNT = 1_000_000;
/** Prevent a down companion from causing a request on every local flush. */
export const ANALYTICS_CIRCUIT_FAILURE_THRESHOLD = 3;
export const ANALYTICS_CIRCUIT_COOLDOWN_MS = 30_000;
let consecutiveNetworkFailures = 0;
let circuitOpenUntil = 0;

/** Allow-list mirrored on the server — only these types leave the device. */
const FORWARDED_TYPES = new Set<AnalyticsEventType>([
  "vault_created",
  "vault_unlocked",
  "first_capture",
  "first_document",
  "session_start",
  "session_end",
  "bookmark_created",
  "bookmark_deleted",
  "document_created",
  "document_deleted",
  "search_used",
  "import_used",
  "export_used",
  "ai_chat_used",
  "ai_summary_generated",
  "p2p_sync_started",
  "p2p_sync_completed",
  "extension_captured",
]);

/** Consent gate: analytics has its own independent purpose. */
export function isAnalyticsForwardingEnabled(): boolean {
  try {
    // ConsentService keeps the complete-decision rule and the legacy migration
    // in one place. In particular, a missing modern key is denied once a
    // complete purpose-specific decision exists.
    return isPurposeConsented("analytics");
  } catch {
    return false;
  }
}

/** Reset only the in-memory outage breaker; intended for deterministic unit tests. */
export function __resetAnalyticsForwarderForTests(): void {
  consecutiveNetworkFailures = 0;
  circuitOpenUntil = 0;
}

/** Read (or create) the per-install random id, persisted locally. */
export function getOrCreateInstallId(): string {
  try {
    const existing = localStorage.getItem(INSTALL_ID_KEY);
    // Keep legacy non-empty identifiers for compatibility, but never allow a
    // corrupted/attacker-controlled value to cause unbounded hashing.
    if (existing && existing.length <= MAX_INSTALL_ID_LENGTH) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(INSTALL_ID_KEY, created);
    return created;
  } catch {
    // Storage unavailable (quota / sandbox) — still forward with an ephemeral id.
    return crypto.randomUUID();
  }
}

/** SHA-256 hex of the install id — the only identifier that leaves the device. */
export async function hashInstallId(installId: string): Promise<string> {
  if (!installId || installId.length > MAX_INSTALL_ID_LENGTH) {
    throw new Error("Invalid analytics install id");
  }
  const bytes = new TextEncoder().encode(installId);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Aggregate a batch of local events into per-type counts (allow-list only). */
export function buildDailyCounts(
  events: Array<Pick<AnalyticsEvent, "type">>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  const limit = Math.min(events.length, MAX_FORWARDED_EVENTS);
  for (let index = 0; index < limit; index += 1) {
    const event = events[index];
    if (!event || !FORWARDED_TYPES.has(event.type)) continue;
    counts[event.type] = Math.min(
      MAX_FORWARDED_COUNT,
      (counts[event.type] ?? 0) + 1,
    );
  }
  return counts;
}

function isValidBatchId(batchId: string): boolean {
  return batchId.length <= MAX_BATCH_ID_LENGTH && BATCH_ID_RE.test(batchId);
}

/** Build the wire payload for a batch of local events. */
export async function buildAnalyticsPayload(
  events: Array<Pick<AnalyticsEvent, "type">>,
  batchId: string = crypto.randomUUID(),
): Promise<{ iid: string; batchId: string; counts: Record<string, number> } | null> {
  if (!isAnalyticsForwardingEnabled() || !isValidBatchId(batchId)) return null;
  const counts = buildDailyCounts(events);
  if (Object.keys(counts).length === 0) return null;
  try {
    const iid = await hashInstallId(getOrCreateInstallId());
    // Revocation may happen while WebCrypto is pending; never materialize a
    // payload into a request after the purpose has been withdrawn.
    if (!isAnalyticsForwardingEnabled()) return null;
    return { iid, batchId, counts };
  } catch {
    return null;
  }
}

/**
 * Forward a batch of local events as one aggregated daily bucket.
 * Fire-and-forget, consent-gated, silent on failure. Returns true when a
 * request was attempted.
 */
export async function forwardAnalytics(
  events: Array<Pick<AnalyticsEvent, "type">>,
  batchId: string = crypto.randomUUID(),
): Promise<boolean> {
  if (Date.now() < circuitOpenUntil) return false;
  const payload = await buildAnalyticsPayload(events, batchId);
  if (!payload || !isAnalyticsForwardingEnabled()) return false;
  try {
    const response = await fetch(EVENTS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    if (response.ok) {
      consecutiveNetworkFailures = 0;
      circuitOpenUntil = 0;
      return true;
    }
    // HTTP failures are also operational failures for this best-effort path;
    // open the circuit after repeated outages, while allowing a later probe.
    consecutiveNetworkFailures += 1;
    if (consecutiveNetworkFailures >= ANALYTICS_CIRCUIT_FAILURE_THRESHOLD) {
      circuitOpenUntil = Date.now() + ANALYTICS_CIRCUIT_COOLDOWN_MS;
    }
    return false;
  } catch {
    consecutiveNetworkFailures += 1;
    if (consecutiveNetworkFailures >= ANALYTICS_CIRCUIT_FAILURE_THRESHOLD) {
      circuitOpenUntil = Date.now() + ANALYTICS_CIRCUIT_COOLDOWN_MS;
    }
    // Contained: analytics must never break the app or surface errors.
    return false;
  }
}

/** Page-unload path: sendBeacon keeps the bucket even on navigation. */
export function forwardAnalyticsBeacon(
  events: Array<Pick<AnalyticsEvent, "type">>,
  batchId: string = crypto.randomUUID(),
): void {
  if (!isAnalyticsForwardingEnabled()) return;
  const counts = buildDailyCounts(events);
  if (Object.keys(counts).length === 0) return;
  if (!isValidBatchId(batchId)) return;
  void hashInstallId(getOrCreateInstallId())
    .then((iid) => {
      if (!isAnalyticsForwardingEnabled()) return;
      const blob = new Blob([JSON.stringify({ iid, batchId, counts })], {
        type: "application/json",
      });
      navigator.sendBeacon(EVENTS_ENDPOINT, blob);
    })
    .catch(() => {
      logger.debug("[AnalyticsForwarder] sendBeacon failed (contained)");
    });
}
