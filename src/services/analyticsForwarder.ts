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
 *     trusted and a retried day REPLACES the previous bucket (idempotent).
 *   - Fire-and-forget: a dead/absent companion server must never surface as
 *     an error or retry storm. No queue — analytics is best-effort.
 *   - Same-origin POSTs pass the network firewall; the endpoint only exists
 *     when the deployment runs the companion server.
 */
import { logger } from "../utils/logger";
import { safeGet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import type { AnalyticsEvent, AnalyticsEventType } from "./AnalyticsService";

const EVENTS_ENDPOINT = "/api/analytics/events";
const INSTALL_ID_KEY = "bmf_analytics_install_id";
const LEGACY_CONSENT_KEY = "bmf_telemetry_optin";

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

/** Consent gate: same key and legacy fallback as AnalyticsService. */
export function isAnalyticsForwardingEnabled(): boolean {
  try {
    const current = safeGet(STORAGE_KEYS.CONSENT_ANALYTICS);
    if (current !== null) return current === "true";
    return safeGet(LEGACY_CONSENT_KEY) === "true";
  } catch {
    return false;
  }
}

/** Read (or create) the per-install random id, persisted locally. */
export function getOrCreateInstallId(): string {
  try {
    const existing = localStorage.getItem(INSTALL_ID_KEY);
    if (existing) return existing;
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
  for (const event of events) {
    if (!FORWARDED_TYPES.has(event.type)) continue;
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
}

/** Build the wire payload for a batch of local events. */
export async function buildAnalyticsPayload(
  events: Array<Pick<AnalyticsEvent, "type">>,
): Promise<{ iid: string; counts: Record<string, number> } | null> {
  if (!isAnalyticsForwardingEnabled()) return null;
  const counts = buildDailyCounts(events);
  if (Object.keys(counts).length === 0) return null;
  const iid = await hashInstallId(getOrCreateInstallId());
  return { iid, counts };
}

/**
 * Forward a batch of local events as one aggregated daily bucket.
 * Fire-and-forget, consent-gated, silent on failure. Returns true when a
 * request was attempted.
 */
export async function forwardAnalytics(
  events: Array<Pick<AnalyticsEvent, "type">>,
): Promise<boolean> {
  const payload = await buildAnalyticsPayload(events);
  if (!payload) return false;
  try {
    await fetch(EVENTS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    return true;
  } catch {
    // Contained: analytics must never break the app or surface errors.
    return false;
  }
}

/** Page-unload path: sendBeacon keeps the bucket even on navigation. */
export function forwardAnalyticsBeacon(
  events: Array<Pick<AnalyticsEvent, "type">>,
): void {
  if (!isAnalyticsForwardingEnabled()) return;
  const counts = buildDailyCounts(events);
  if (Object.keys(counts).length === 0) return;
  void hashInstallId(getOrCreateInstallId())
    .then((iid) => {
      const blob = new Blob([JSON.stringify({ iid, counts })], {
        type: "application/json",
      });
      navigator.sendBeacon(EVENTS_ENDPOINT, blob);
    })
    .catch(() => {
      logger.debug("[AnalyticsForwarder] sendBeacon failed (contained)");
    });
}
