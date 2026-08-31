/**
 * AnalyticsService — Privacy-first, local-only product analytics.
 *
 * All data stays in the browser's IndexedDB. Nothing is sent to any remote
 * server unless the user explicitly opts in via the consent banner
 * (`forge_consent_analytics`, default OFF).
 *
 * Measures:
 *   - Retention: D1, D7, D30 (active days since first visit)
 *   - Engagement: session count, bookmarks created, documents created, searches
 *   - Feature usage: which views, which actions, time per session
 *   - Setup funnel: vault created → first capture → regular use
 *
 * Privacy:
 *   - No IP addresses, no user IDs, no vault content
 *   - All timestamps are local; no cross-device tracking
 *   - Events are stored in a bounded ring (max 10,000 events)
 *   - Retention is computed client-side from visit timestamps
 *   - Opt-in gated: same consent as errorReporter
 *
 * Architecture:
 *   - Events are appended to an in-memory buffer and flushed to IndexedDB
 *     periodically (every 30s) and on page unload
 *   - KPI computation reads from IndexedDB (lazy, on demand)
 *   - Export produces a JSON snapshot for the Settings → Diagnostics view
 */
import { logger } from "../utils/logger";
import { safeGet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { forwardAnalytics, forwardAnalyticsBeacon } from "./analyticsForwarder";

// ── Constants ─────────────────────────────────────────────────────

const DB_NAME = "bookmarkforge-analytics";
const DB_VERSION = 1;
const STORE_NAME = "events";
const MAX_EVENTS = 10_000;
const FLUSH_INTERVAL_MS = 30_000;
// const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (reserved for future idle detection)

// Consent key (audit 2026-08-30): AnalyticsService previously read the
// error-storage consent key (bmf_local_error_storage), meaning the user's
// analytics choice in ConsentBanner (forge_consent_analytics) had no effect.
// Now reads the correct analytics consent key; the legacy bmf_telemetry_optin
// key is honored as a read-only migration fallback.
const CONSENT_KEY = STORAGE_KEYS.CONSENT_ANALYTICS;
const LEGACY_CONSENT_KEY = "bmf_telemetry_optin";

// ── Types ─────────────────────────────────────────────────────────

export type AnalyticsEventType =
  // Setup funnel
  | "vault_created"
  | "vault_unlocked"
  | "first_capture"
  | "first_document"
  // Session lifecycle
  | "session_start"
  | "session_end"
  // Feature usage
  | "bookmark_created"
  | "bookmark_deleted"
  | "document_created"
  | "document_deleted"
  | "search_used"
  | "import_used"
  | "export_used"
  | "graph_viewed"
  | "kanban_viewed"
  | "calendar_viewed"
  | "gallery_viewed"
  | "timeline_viewed"
  | "canvas_viewed"
  | "flashcard_reviewed"
  | "voice_command_used"
  | "ai_chat_used"
  | "ai_summary_generated"
  | "p2p_sync_started"
  | "p2p_sync_completed"
  | "extension_captured"
  // Settings
  | "theme_changed"
  | "language_changed"
  | "auto_lock_toggled"
  | "network_permission_added";

export interface AnalyticsEvent {
  id: string;
  type: AnalyticsEventType;
  timestamp: number; // Date.now()
  /** Optional metadata (bounded, no PII). */
  meta?: Record<string, string | number | boolean>;
}

export interface RetentionKPIs {
  /** Total unique days with at least one event. */
  activeDays: number;
  /** Days since first event. */
  accountAge: number;
  /** Whether user was active in last 1 day. */
  activeD1: boolean;
  /** Whether user was active in last 7 days. */
  activeD7: boolean;
  /** Whether user was active in last 30 days. */
  activeD30: boolean;
  /** Streak: consecutive days with activity (ending today or yesterday). */
  currentStreak: number;
  /** Longest streak ever. */
  longestStreak: number;
}

export interface EngagementKPIs {
  totalSessions: number;
  totalBookmarks: number;
  totalDocuments: number;
  totalSearches: number;
  totalImports: number;
  totalExports: number;
  totalAICalls: number;
  totalP2PSyncs: number;
  totalCaptures: number;
  /** Average session duration in seconds. */
  avgSessionDurationSec: number;
  /** Median session duration in seconds. */
  medianSessionDurationSec: number;
  /** Features used (unique event types minus lifecycle events). */
  featuresUsed: string[];
  /** Setup funnel completion. */
  funnel: {
    vaultCreated: boolean;
    firstCapture: boolean;
    firstDocument: boolean;
    setupCompleted: boolean; // vault created + at least one capture or document
  };
}

export interface AnalyticsSnapshot {
  retention: RetentionKPIs;
  engagement: EngagementKPIs;
  generatedAt: string;
  eventCount: number;
}

// ── IndexedDB helpers ─────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("type", "type", { unique: false });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error("Analytics database open blocked"));
  });
}

// ── Consent ───────────────────────────────────────────────────────

function isAnalyticsEnabled(): boolean {
  try {
    const current = safeGet(CONSENT_KEY);
    if (current !== null) return current === "true";
    return safeGet(LEGACY_CONSENT_KEY) === "true";
  } catch {
    return false;
  }
}

// ── Service ───────────────────────────────────────────────────────

class AnalyticsService {
  private buffer: AnalyticsEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private unloadHandler: (() => void) | null = null;
  private sessionId: string = "";
  private sessionStart: number = 0;
  private lastActivity: number = 0;
  private started = false;

  /** Start tracking. Call once after consent is established. */
  start(): void {
    if (this.started || typeof window === "undefined") return;
    if (!isAnalyticsEnabled()) {
      logger.debug("[AnalyticsService] Disabled — user has not opted in");
      return;
    }
    this.started = true;
    this.sessionId = crypto.randomUUID();
    this.sessionStart = Date.now();
    this.lastActivity = Date.now();

    // Flush periodically
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);

    // Flush on page unload
    this.unloadHandler = () => {
      this.trackSync("session_end", {
        durationSec: Math.round((Date.now() - this.sessionStart) / 1000),
      });
      // Synchronous flush via sendBeacon fallback
      this.flushToStorage();
    };
    window.addEventListener("pagehide", this.unloadHandler, { once: true });

    // Record session start
    this.trackSync("session_start", {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      theme: document.documentElement.getAttribute("data-theme") ?? "unknown",
    });

    logger.info("[AnalyticsService] Started (local-only, opt-in)");
  }

  /** Stop tracking and flush remaining events. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.unloadHandler) {
      window.removeEventListener("pagehide", this.unloadHandler);
      this.unloadHandler = null;
    }
    void this.flush();
  }

  /** Track an event (async, fire-and-forget). */
  track(type: AnalyticsEventType, meta?: Record<string, string | number | boolean>): void {
    if (!this.started || !isAnalyticsEnabled()) return;
    const event: AnalyticsEvent = {
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      meta,
    };
    this.buffer.push(event);
    this.lastActivity = Date.now();

    // Auto-flush when buffer is large
    if (this.buffer.length >= 100) {
      void this.flush();
    }
  }

  /** Track an event synchronously (for pagehide where async is unsafe). */
  private trackSync(type: AnalyticsEventType, meta?: Record<string, string | number | boolean>): void {
    if (!isAnalyticsEnabled()) return;
    const event: AnalyticsEvent = {
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      meta,
    };
    this.buffer.push(event);
  }

  /** Flush buffered events to IndexedDB (+ opt-in server bucket). */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    // Opt-in, aggregated, non-PII server bucket (consent-gated inside).
    // Fire-and-forget: never awaited, failures contained by the forwarder.
    void forwardAnalytics(events);
    try {
      const db = await openDB();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);

          // Write new events
          for (const event of events) {
            store.put(event);
          }

          // Prune old events if over capacity
          const countReq = store.count();
          countReq.onsuccess = () => {
            const count = countReq.result;
            if (count > MAX_EVENTS) {
              // Delete oldest by timestamp
              const index = store.index("timestamp");
              const cursor = index.openCursor();
              let toDelete = count - MAX_EVENTS;
              cursor.onsuccess = () => {
                if (cursor.result && toDelete > 0) {
                  cursor.result.delete();
                  toDelete--;
                  cursor.result.continue();
                }
              };
            }
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error("Analytics transaction aborted"));
        });
      } finally {
        db.close();
      }
    } catch (err) {
      logger.warn("[AnalyticsService] Flush failed", {
        error: err instanceof Error ? err.message : String(err),
        eventCount: events.length,
      });
      // Re-add events to buffer for retry on next flush
      this.buffer.unshift(...events);
    }
  }

  /** Synchronous flush for page unload (best-effort). */
  private flushToStorage(): void {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    // sendBeacon keeps the daily bucket even while navigating away.
    forwardAnalyticsBeacon(events);
    // Best-effort: open DB and write synchronously via put
    void openDB()
      .then((db) => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          for (const event of events) {
            store.put(event);
          }
          tx.oncomplete = () => db.close();
          tx.onerror = () => {
            db.close();
          };
        } catch {
          db.close();
        }
      })
      .catch(() => {
        // Silently fail — analytics is best-effort
      });
  }

  // ── KPI Computation ─────────────────────────────────────────────

  /** Get a full analytics snapshot. Reads from IndexedDB. */
  async getSnapshot(): Promise<AnalyticsSnapshot> {
    const events = await this.getAllEvents();
    return {
      retention: this.computeRetention(events),
      engagement: this.computeEngagement(events),
      generatedAt: new Date().toISOString(),
      eventCount: events.length,
    };
  }

  /** Get retention KPIs only. */
  async getRetention(): Promise<RetentionKPIs> {
    const events = await this.getAllEvents();
    return this.computeRetention(events);
  }

  /** Get engagement KPIs only. */
  async getEngagement(): Promise<EngagementKPIs> {
    const events = await this.getAllEvents();
    return this.computeEngagement(events);
  }

  // ── Private: KPI computation ────────────────────────────────────

  private async getAllEvents(): Promise<AnalyticsEvent[]> {
    if (!isAnalyticsEnabled()) return [];
    try {
      const db = await openDB();
      try {
        return await new Promise<AnalyticsEvent[]>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result as AnalyticsEvent[]);
          req.onerror = () => reject(req.error);
          tx.onabort = () => reject(tx.error || new Error("Analytics read aborted"));
        });
      } finally {
        db.close();
      }
    } catch {
      return [];
    }
  }

  private computeRetention(events: AnalyticsEvent[]): RetentionKPIs {
    if (events.length === 0) {
      return {
        activeDays: 0,
        accountAge: 0,
        activeD1: false,
        activeD7: false,
        activeD30: false,
        currentStreak: 0,
        longestStreak: 0,
      };
    }

    // Unique active days (date-only, no time)
    const activeDaysSet = new Set<number>();
    let firstTimestamp = Infinity;
    for (const event of events) {
      const dayStart = this.dayStart(event.timestamp);
      activeDaysSet.add(dayStart);
      if (event.timestamp < firstTimestamp) firstTimestamp = event.timestamp;
    }

    const now = Date.now();
    const today = this.dayStart(now);
    const activeDaysArray = [...activeDaysSet].sort((a, b) => a - b);
    const activeDays = activeDaysArray.length;
    const accountAge = Math.floor((now - firstTimestamp) / (24 * 60 * 60 * 1000));

    // D1/D7/D30: was there activity in the last N days?
    const activeD1 = activeDaysSet.has(today) || activeDaysSet.has(today - 86_400_000);
    const activeD7 = activeDaysSet.has(today) ||
      activeDaysArray.some((d) => today - d < 7 * 86_400_000);
    const activeD30 = activeDaysSet.has(today) ||
      activeDaysArray.some((d) => today - d < 30 * 86_400_000);

    // Streaks
    let currentStreak = 0;
    let longestStreak = 0;
    let streak = 0;
    let prevDay = 0;
    for (const day of activeDaysArray) {
      if (prevDay === 0) {
        streak = 1;
      } else if (day - prevDay === 86_400_000) {
        streak++;
      } else {
        longestStreak = Math.max(longestStreak, streak);
        streak = 1;
      }
      prevDay = day;
    }
    longestStreak = Math.max(longestStreak, streak);

    // Current streak: count backwards from today
    currentStreak = 0;
    let checkDay = today;
    for (let i = 0; i < activeDaysArray.length; i++) {
      if (activeDaysSet.has(checkDay)) {
        currentStreak++;
        checkDay -= 86_400_000;
      } else {
        break;
      }
    }

    return {
      activeDays,
      accountAge,
      activeD1,
      activeD7,
      activeD30,
      currentStreak,
      longestStreak,
    };
  }

  private computeEngagement(events: AnalyticsEvent[]): EngagementKPIs {
    const count = (type: AnalyticsEventType) =>
      events.filter((e) => e.type === type).length;

    // Session durations
    const sessions: AnalyticsEvent[] = [];
    const sessionEnds = events.filter((e) => e.type === "session_end");
    const sessionStarts = events.filter((e) => e.type === "session_start");
    sessions.push(...sessionStarts);

    const durations: number[] = [];
    for (const end of sessionEnds) {
      const meta = end.meta as Record<string, unknown> | undefined;
      if (meta && typeof meta.durationSec === "number") {
        durations.push(meta.durationSec);
      }
    }

    const avgSessionDurationSec = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    const sortedDurations = [...durations].sort((a, b) => a - b);
    const medianSessionDurationSec = sortedDurations.length > 0
      ? (sortedDurations[Math.floor(sortedDurations.length / 2)] ?? 0)
      : 0;

    // Features used (unique types minus lifecycle events)
    const lifecycleTypes = new Set<AnalyticsEventType>([
      "session_start",
      "session_end",
      "vault_created",
      "vault_unlocked",
    ]);
    const featuresUsed = [...new Set(
      events
        .map((e) => e.type)
        .filter((t) => !lifecycleTypes.has(t)),
    )].sort();

    // Setup funnel
    const vaultCreated = events.some((e) => e.type === "vault_created");
    const firstCapture = events.some((e) => e.type === "first_capture");
    const firstDocument = events.some((e) => e.type === "first_document");

    return {
      totalSessions: sessions.length,
      totalBookmarks: count("bookmark_created"),
      totalDocuments: count("document_created"),
      totalSearches: count("search_used"),
      totalImports: count("import_used"),
      totalExports: count("export_used"),
      totalAICalls: count("ai_chat_used") + count("ai_summary_generated"),
      totalP2PSyncs: count("p2p_sync_started") + count("p2p_sync_completed"),
      totalCaptures: count("first_capture") + count("extension_captured"),
      avgSessionDurationSec,
      medianSessionDurationSec,
      featuresUsed,
      funnel: {
        vaultCreated,
        firstCapture,
        firstDocument,
        setupCompleted: vaultCreated && (firstCapture || firstDocument),
      },
    };
  }

  private dayStart(timestamp: number): number {
    const d = new Date(timestamp);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
}

export const analyticsService = new AnalyticsService();
