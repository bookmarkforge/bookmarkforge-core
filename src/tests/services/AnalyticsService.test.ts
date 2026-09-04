import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { STORAGE_KEYS } from "../../constants/storage-keys";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  redactSecrets: vi.fn((s: string) => s),
}));

// In-memory mock for safeStorage
const store = new Map<string, string>();
vi.mock("../../store/safeStorage", () => ({
  safeGet: (key: string) => store.get(key) ?? null,
  safeSet: (key: string, value: string) => { store.set(key, value); },
}));

// Minimal IndexedDB mock for analytics events
function createMockIDB() {
  const data = new Map<string, Record<string, unknown>>();
  return {
    open: vi.fn().mockImplementation((_name: string, _version: number) => {
      const result = {
        result: {
          objectStoreNames: { contains: () => false },
          createObjectStore: vi.fn().mockReturnValue({
            createIndex: vi.fn(),
            put: vi.fn().mockImplementation((item: Record<string, unknown>) => {
              data.set(String(item.id), item);
              return { onsuccess: null, onerror: null };
            }),
            count: vi.fn().mockImplementation(() => {
              const req = { result: data.size, onsuccess: null as (() => void) | null };
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            }),
            openCursor: vi.fn().mockImplementation(() => {
              const entries = [...data.entries()];
              let idx = 0;
              const req = {
                result: null as unknown,
                onsuccess: null as (() => void) | null,
                continue: vi.fn().mockImplementation(() => {
                  idx++;
                  if (idx < entries.length) {
                    req.result = {
                      delete: vi.fn(),
                      continue: vi.fn(),
                    };
                    setTimeout(() => req.onsuccess?.(), 0);
                  } else {
                    req.result = null;
                    setTimeout(() => req.onsuccess?.(), 0);
                  }
                }),
              };
              if (entries.length > 0) {
                req.result = { delete: vi.fn(), continue: vi.fn() };
                setTimeout(() => req.onsuccess?.(), 0);
              } else {
                setTimeout(() => req.onsuccess?.(), 0);
              }
              return req;
            }),
          }),
          transaction: vi.fn().mockImplementation((_name: string, _mode: string) => {
            const txStore = {
              put: vi.fn().mockImplementation((item: Record<string, unknown>) => {
                data.set(String(item.id), item);
              }),
              count: vi.fn().mockImplementation(() => {
                const req = { result: data.size, onsuccess: null as (() => void) | null };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              }),
              index: vi.fn().mockReturnValue({
                openCursor: vi.fn().mockImplementation(() => {
                  const entries = [...data.entries()];
                  let idx = 0;
                  const req = {
                    result: null as unknown,
                    onsuccess: null as (() => void) | null,
                    continue: vi.fn().mockImplementation(() => {
                      idx++;
                      if (idx < entries.length) {
                        req.result = { delete: vi.fn(), continue: vi.fn() };
                        setTimeout(() => req.onsuccess?.(), 0);
                      } else {
                        req.result = null;
                        setTimeout(() => req.onsuccess?.(), 0);
                      }
                    }),
                  };
                  if (entries.length > 0) {
                    req.result = { delete: vi.fn(), continue: vi.fn() };
                    setTimeout(() => req.onsuccess?.(), 0);
                  } else {
                    setTimeout(() => req.onsuccess?.(), 0);
                  }
                  return req;
                }),
              }),
              getAll: vi.fn().mockImplementation(() => {
                const req = { result: [...data.values()], onsuccess: null as (() => void) | null };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              }),
            };
            return {
              objectStore: vi.fn().mockReturnValue(txStore),
              oncomplete: null as (() => void) | null,
              onerror: null as (() => void) | null,
              onabort: null as (() => void) | null,
              error: null,
            };
          }),
          close: vi.fn(),
          onversionchange: null,
        },
        onsuccess: null as (() => void) | null,
        onerror: null,
        onblocked: null,
      };
      setTimeout(() => result.onsuccess?.(), 0);
      return result;
    }),
  };
}

// ── Test suite ─────────────────────────────────────────────────────

describe("AnalyticsService", () => {
  let originalIndexedDB: typeof globalThis.indexedDB;
  let mockIDB: ReturnType<typeof createMockIDB>;

  beforeEach(() => {
    store.clear();
    store.set(STORAGE_KEYS.CONSENT_ANALYTICS, "true"); // explicit analytics opt-in
    mockIDB = createMockIDB();
    originalIndexedDB = globalThis.indexedDB;
    (globalThis as unknown as Record<string, unknown>).indexedDB = mockIDB;
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as unknown as Record<string, unknown>).indexedDB = originalIndexedDB;
    vi.restoreAllMocks();
  });

  it("exports the singleton instance", async () => {
    const { analyticsService } = await import("../../services/AnalyticsService");
    expect(analyticsService).toBeDefined();
    expect(typeof analyticsService.start).toBe("function");
    expect(typeof analyticsService.track).toBe("function");
    expect(typeof analyticsService.stop).toBe("function");
    expect(typeof analyticsService.getSnapshot).toBe("function");
    expect(typeof analyticsService.getRetention).toBe("function");
    expect(typeof analyticsService.getEngagement).toBe("function");
  });

  it("track() is a no-op when analytics is disabled", async () => {
    store.set(STORAGE_KEYS.CONSENT_ANALYTICS, "false");
    const { analyticsService } = await import("../../services/AnalyticsService");
    analyticsService.start();
    // Should not throw
    analyticsService.track("bookmark_created");
    analyticsService.stop();
  });

  it("track() buffers events when analytics is enabled", async () => {
    const { analyticsService } = await import("../../services/AnalyticsService");
    analyticsService.start();
    // track multiple events — should not throw
    analyticsService.track("bookmark_created");
    analyticsService.track("document_created");
    analyticsService.track("search_used");
    analyticsService.track("graph_viewed");
    analyticsService.stop();
  });

  // The mock IndexedDB uses real zero-delay callbacks, so KPI reads can be
  // awaited directly without fake timers competing with the service interval.
  async function withKpiRead<T>(read: () => Promise<T>): Promise<T> {
    return read();
  }

  it("getRetention() returns empty KPIs when no events exist", async () => {
    const { analyticsService } = await import("../../services/AnalyticsService");
    analyticsService.start();
    const retention = await withKpiRead(() => analyticsService.getRetention());
    expect(retention.activeDays).toBe(0);
    expect(retention.accountAge).toBe(0);
    expect(retention.activeD1).toBe(false);
    expect(retention.activeD7).toBe(false);
    expect(retention.activeD30).toBe(false);
    expect(retention.currentStreak).toBe(0);
    expect(retention.longestStreak).toBe(0);
    analyticsService.stop();
  });

  it("getEngagement() returns empty KPIs when no events exist", async () => {
    const { analyticsService } = await import("../../services/AnalyticsService");
    analyticsService.start();
    const engagement = await withKpiRead(() => analyticsService.getEngagement());
    expect(engagement.totalSessions).toBe(0);
    expect(engagement.totalBookmarks).toBe(0);
    expect(engagement.totalDocuments).toBe(0);
    expect(engagement.totalSearches).toBe(0);
    expect(engagement.featuresUsed).toEqual([]);
    expect(engagement.funnel.vaultCreated).toBe(false);
    expect(engagement.funnel.firstCapture).toBe(false);
    expect(engagement.funnel.setupCompleted).toBe(false);
    analyticsService.stop();
  });

  it("getSnapshot() returns both retention and engagement", async () => {
    const { analyticsService } = await import("../../services/AnalyticsService");
    analyticsService.start();
    const snapshot = await withKpiRead(() => analyticsService.getSnapshot());
    expect(snapshot.retention).toBeDefined();
    expect(snapshot.engagement).toBeDefined();
    expect(snapshot.generatedAt).toBeDefined();
    expect(typeof snapshot.eventCount).toBe("number");
    analyticsService.stop();
  });

  it("start() can be called multiple times safely", async () => {
    const { analyticsService } = await import("../../services/AnalyticsService");
    analyticsService.start();
    analyticsService.start(); // second call should be a no-op
    analyticsService.stop();
  });

  it("stop() can be called without start()", async () => {
    const { analyticsService } = await import("../../services/AnalyticsService");
    // Should not throw
    analyticsService.stop();
  });

  it("does not start when consent is not granted", async () => {
    store.set(STORAGE_KEYS.CONSENT_ANALYTICS, "false");
    const { analyticsService } = await import("../../services/AnalyticsService");
    analyticsService.start();
    // track should be a no-op
    analyticsService.track("bookmark_created");
    analyticsService.stop();
  });
});
