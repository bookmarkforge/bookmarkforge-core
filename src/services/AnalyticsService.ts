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
 *   - Opt-in gated: independent analytics consent (`forge_consent_analytics`)
 *
 * Architecture:
 *   - Events are appended to an in-memory buffer and flushed to IndexedDB
 *     periodically (every 30s) and on page unload
 *   - KPI computation reads from IndexedDB (lazy, on demand)
 *   - Export produces a JSON snapshot for the Settings → Diagnostics view
 */
import { logger } from "../utils/logger";
import { safeRemove } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import {
  CONSENT_CHANGED_EVENT,
  isPurposeConsented,
  type ConsentToggles,
} from "./ConsentService";
import { forwardAnalytics, forwardAnalyticsBeacon } from "./analyticsForwarder";

// ── Constants ─────────────────────────────────────────────────────

const DB_NAME = "bookmarkforge-analytics";
const DB_VERSION = 1;
const STORE_NAME = "events";
const MAX_EVENTS = 10_000;
/** Runtime cap: a blocked IndexedDB write must not grow memory without bound. */
const MAX_BUFFER_EVENTS = 512;
const MAX_META_KEYS = 16;
const MAX_META_KEY_LENGTH = 32;
const MAX_META_STRING_LENGTH = 128;
const MAX_META_ABS_NUMBER = 1_000_000_000;
const FLUSH_INTERVAL_MS = 30_000;
// const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (reserved for future idle detection)

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

const ANALYTICS_EVENT_TYPES = new Set<AnalyticsEventType>([
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
  "graph_viewed",
  "kanban_viewed",
  "calendar_viewed",
  "gallery_viewed",
  "timeline_viewed",
  "canvas_viewed",
  "flashcard_reviewed",
  "voice_command_used",
  "ai_chat_used",
  "ai_summary_generated",
  "p2p_sync_started",
  "p2p_sync_completed",
  "extension_captured",
  "theme_changed",
  "language_changed",
  "auto_lock_toggled",
  "network_permission_added",
]);

function sanitizeMeta(
  meta: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [rawKey, rawValue] of Object.entries(meta).slice(0, MAX_META_KEYS)) {
    const key = rawKey.slice(0, MAX_META_KEY_LENGTH);
    if (!key) continue;
    if (typeof rawValue === "string") {
      sanitized[key] = rawValue.slice(0, MAX_META_STRING_LENGTH);
    } else if (
      typeof rawValue === "number" &&
      Number.isFinite(rawValue) &&
      Math.abs(rawValue) <= MAX_META_ABS_NUMBER
    ) {
      sanitized[key] = rawValue;
    } else if (typeof rawValue === "boolean") {
      sanitized[key] = rawValue;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
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
    // ConsentService centralizes the explicit-purpose decision and its legacy
    // migration rule. This prevents a stale broad opt-in from resurrecting
    // analytics after a complete modern decision denied it.
    return isPurposeConsented("analytics");
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
  /** A locally failed write keeps its batch id so a later retry cannot
   * double-count a batch that the server already accepted. */
  private pendingBatch: {
    events: AnalyticsEvent[];
    batchId: string;
  } | null = null;
  private consentListener: (() => void) | null = null;
  private lifecycleGeneration = 0;
  private flushInFlight: Promise<void> | null = null;
  private flushRequested = false;
  private forceFlushRequested = false;

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

    this.installConsentListener();

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
    const consentStillGranted = isAnalyticsEnabled();
    this.started = false;
    this.removeConsentListener();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.unloadHandler) {
      window.removeEventListener("pagehide", this.unloadHandler);
      this.unloadHandler = null;
    }
    // Withdrawal must discard unsent events and any retryable batch before
    // the consent-gated forwarder can observe the new state. A normal stop
    // preserves the historical contract by flushing what is already queued.
    if (!consentStillGranted) {
      this.lifecycleGeneration += 1;
      this.buffer = [];
      this.pendingBatch = null;
      return;
    }
    void this.flush(true);
  }

  /**
   * Permanently revoke analytics for this browser profile. Unsent events,
   * retryable batches, the local analytics database, and the install
   * pseudonym are removed; already transmitted server data is not claimed to
   * be deleted by this client operation.
   */
  async revoke(): Promise<void> {
    this.started = false;
    this.lifecycleGeneration += 1;
    this.removeConsentListener();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.unloadHandler && typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.unloadHandler);
      this.unloadHandler = null;
    }
    this.buffer = [];
    this.pendingBatch = null;
    // An in-flight IndexedDB transaction may otherwise write after clear and
    // resurrect revoked local events. Wait for the serialized flush loop first.
    const inFlight = this.flushInFlight;
    if (inFlight) {
      try {
        await inFlight;
      } catch {
        /* INTENTIONAL SILENCE: the revocation path is fail-closed; cleanup continues. */
      }
    }
    this.buffer = [];
    this.pendingBatch = null;
    safeRemove(STORAGE_KEYS.ANALYTICS_INSTALL_ID);
    await this.clearStoredEvents();
  }

  private installConsentListener(): void {
    if (typeof window === "undefined" || this.consentListener) return;
    const listener = (event: Event) => {
      const consent = (event as CustomEvent<ConsentToggles | null>).detail;
      if (consent && !consent.analytics) {
        void this.revoke();
      }
    };
    window.addEventListener(CONSENT_CHANGED_EVENT, listener);
    this.consentListener = () => window.removeEventListener(CONSENT_CHANGED_EVENT, listener);
  }

  private removeConsentListener(): void {
    this.consentListener?.();
    this.consentListener = null;
  }

  /** Append an event while keeping memory bounded if storage is blocked. */
  private appendEvent(event: AnalyticsEvent): void {
    if (this.buffer.length >= MAX_BUFFER_EVENTS) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_EVENTS + 1);
    }
    this.buffer.push(event);
  }

  /** Track an event (async, fire-and-forget). */
  track(type: AnalyticsEventType, meta?: Record<string, string | number | boolean>): void {
    if (!this.started || !isAnalyticsEnabled() || !ANALYTICS_EVENT_TYPES.has(type)) return;
    this.appendEvent({
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      meta: sanitizeMeta(meta),
    });
    this.lastActivity = Date.now();

    // Auto-flush when buffer is large
    if (this.buffer.length >= 100) {
      void this.flush();
    }
  }

  /** Track an event synchronously (for pagehide where async is unsafe). */
  private trackSync(type: AnalyticsEventType, meta?: Record<string, string | number | boolean>): void {
    if (!isAnalyticsEnabled() || !ANALYTICS_EVENT_TYPES.has(type)) return;
    this.appendEvent({
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      meta: sanitizeMeta(meta),
    });
  }

  /** Serialize flushes so failed batches cannot overwrite one another. */
  private flush(force = false): Promise<void> {
    if (this.flushInFlight) {
      this.flushRequested = true;
      this.forceFlushRequested ||= force;
      return this.flushInFlight;
    }
    this.flushRequested = false;
    this.forceFlushRequested = force;
    const run = this.runFlushLoop();
    this.flushInFlight = run;
    void run.then(
      () => {
        if (this.flushInFlight === run) this.flushInFlight = null;
      },
      () => {
        if (this.flushInFlight === run) this.flushInFlight = null;
      },
    );
    return run;
  }

  private async runFlushLoop(): Promise<void> {
    do {
      const force = this.forceFlushRequested;
      this.forceFlushRequested = false;
      this.flushRequested = false;
      await this.flushOnce(force);
    } while (this.flushRequested);
  }

  /** Flush buffered events to IndexedDB (+ opt-in server bucket). */
  private async flushOnce(force: boolean): Promise<void> {
    if ((!this.started && !force) || !isAnalyticsEnabled()) return;
    const generation = this.lifecycleGeneration;
    const pending = this.pendingBatch;
    this.pendingBatch = null;
    const events = pending?.events ?? this.buffer.splice(0);
    if (events.length === 0) return;
    // Reusing the id after a local write failure prevents a remote success
    // followed by a local retry from double-counting the same batch.
    const batchId = pending?.batchId ?? crypto.randomUUID();
    let persisted = false;
    try {
      const db = await openDB();
      try {
        // Revoke/re-enable can happen while openDB is pending. The old
        // generation must not write back into a freshly cleared database.
        if (generation !== this.lifecycleGeneration || !isAnalyticsEnabled()) return;
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
        persisted = true;
      } finally {
        db.close();
      }
    } catch (err) {
      logger.warn("[AnalyticsService] Flush failed", {
        error: err instanceof Error ? err.message : String(err),
        eventCount: events.length,
      });
      // Keep the same id for the next attempt only while this lifecycle is
      // still active and consent remains granted. A revoke wins any race with
      // an in-flight IndexedDB operation.
      if (generation === this.lifecycleGeneration && isAnalyticsEnabled()) {
        this.pendingBatch = { events, batchId };
      }
    }

    // Send only after the asynchronous boundary has re-checked consent. A
    // revocation that wins while IndexedDB is opening cannot start a new
    // disclosure; an already-started request cannot be recalled by a client.
    if ((persisted || generation === this.lifecycleGeneration) &&
        generation === this.lifecycleGeneration &&
        isAnalyticsEnabled()) {
      void forwardAnalytics(events, batchId);
    }
  }

  /** Synchronous flush for page unload (best-effort). */
  private flushToStorage(): void {
    if (!this.started || !isAnalyticsEnabled() || this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    // sendBeacon keeps the daily bucket even while navigating away. The
    // explicit id makes this unload batch deduplicable by the server.
    forwardAnalyticsBeacon(events, crypto.randomUUID());
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

  private async clearStoredEvents(): Promise<void> {
    try {
      const db = await openDB();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error("Analytics clear aborted"));
        });
      } finally {
        db.close();
      }
    } catch (error) {
      logger.warn("[AnalyticsService] Failed to clear local events", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

    // Current streak: count backwards from today, or yesterday when there
    // was no activity today. A user who was active yesterday still has a
    // current streak of one; it is not a broken streak until two days pass.
    currentStreak = 0;
    let checkDay = activeDaysSet.has(today) ? today : today - 86_400_000;
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
