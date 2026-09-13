/**
 * Unit tests for src/services/clientEventReporter.ts
 *
 * Covers the three contracts of the client-side event forwarder:
 *   1. Opt-in gating — nothing leaves the device unless the independent
 *      client-events opt-in (forge_consent_client_events) is on.
 *   2. Payload shape — the exact JSON posted to /api/client-events for both
 *      storage-pressure and bundle-integrity-spike.
 *   3. Error containment — a dead/blocked server must never surface an
 *      unhandled rejection or break the app.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startClientEventReporter,
  isClientEventReporterActive,
  __resetForTests,
  CLIENT_EVENT_RETRY_MAX_ATTEMPTS,
  CLIENT_EVENT_RETRY_BASE_DELAY_MS,
  CLIENT_EVENT_RETRY_JITTER_RATIO,
} from "../../services/clientEventReporter";
import type { StoragePressureDetail } from "../../utils/storageMonitor";

const TELEMETRY_KEY = "forge_consent_client_events";
const LEGACY_TELEMETRY_KEY = "bmf_telemetry_optin";

const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

// The reporter also POSTs bounded diagnostics to /api/client-events/retry-stats
// (on coalesce and on retry exhaustion). Event-delivery assertions must count
// ONLY the event endpoint calls; the diagnostics POST is out of scope here.
const EVENT_ENDPOINT = "/api/client-events";
function eventFetchCalls(): unknown[][] {
  return fetchMock().mock.calls.filter((call) => call[0] === EVENT_ENDPOINT);
}

function dispatchStoragePressure(detail: Partial<StoragePressureDetail> = {}): void {
  window.dispatchEvent(new CustomEvent("storage-pressure", { detail }));
}

function dispatchIntegritySpike(detail: Record<string, unknown> = {}): void {
  window.dispatchEvent(new CustomEvent("bundle-integrity-spike", { detail }));
}

/** Parses the body of the last fetch() call (must exist). */
function lastBody(): Record<string, unknown> {
  const calls = fetchMock().mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const init = calls[calls.length - 1]![1] as { body?: string };
  return JSON.parse(init.body ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetForTests();
});

describe("opt-in gating", () => {
  it("sends NOTHING without opt-in (local-first default)", () => {
    startClientEventReporter();
    dispatchStoragePressure({ level: "critical", pct: 95 });
    dispatchIntegritySpike({ count: 3, reason: "spike" });
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("sends NOTHING when opt-in is explicitly false", () => {
    localStorage.setItem(TELEMETRY_KEY, "false");
    startClientEventReporter();
    dispatchStoragePressure({ level: "critical", pct: 95 });
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("sends when opt-in is true", () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    dispatchStoragePressure({ level: "critical", pct: 95 });
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    stop();
  });

  it("honors the pre-banner bmf_telemetry_optin key as a migration fallback", () => {
    localStorage.setItem(LEGACY_TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    dispatchIntegritySpike({ count: 3, reason: "spike" });
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not use the legacy local-error key as remote consent", () => {
    localStorage.setItem("bmf_local_error_storage", "true");
    const stop = startClientEventReporter();
    dispatchStoragePressure({ level: "critical", pct: 95 });
    expect(fetchMock()).not.toHaveBeenCalled();
    stop();
  });

  it("new key 'false' wins over a legacy 'true'", () => {
    localStorage.setItem(TELEMETRY_KEY, "false");
    localStorage.setItem(LEGACY_TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    dispatchStoragePressure({ level: "critical", pct: 95 });
    expect(fetchMock()).not.toHaveBeenCalled();
    stop();
  });

  it("survives localStorage throwing (safeGet containment)", () => {
    const getItem = localStorage.getItem;
    localStorage.getItem = vi.fn(() => {
      throw new Error("storage blocked");
    }) as unknown as typeof localStorage.getItem;
    const stop = startClientEventReporter();
    dispatchStoragePressure({ level: "critical", pct: 95 });
    expect(fetchMock()).not.toHaveBeenCalled();
    stop();
    localStorage.getItem = getItem;
  });
});

describe("payload", () => {
  it("storage-pressure: posts to /api/client-events with exact body", () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    dispatchStoragePressure({
      level: "critical",
      pct: 95.326,
      usage: 1234,
      quota: 5678,
      persisted: true,
    });
    expect(fetchMock()).toHaveBeenCalledWith(
      "/api/client-events",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
      }),
    );
    expect(lastBody()).toEqual({
      type: "storage-pressure",
      level: "critical",
      pct: 95.33, // rounded to 2 decimals
      usage: 1234,
      quota: 5678,
      persisted: true,
    });
    stop();
  });

  it("bundle-integrity-spike: sends count and reason (drops at)", () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    dispatchIntegritySpike({ count: 3, at: "2026-08-27T00:00:00Z", reason: "spike" });
    expect(lastBody()).toEqual({ type: "bundle-integrity-spike", count: 3, reason: "spike" });
    stop();
  });

  it("error-spike: sends count and reason (drops at)", () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    window.dispatchEvent(
      new CustomEvent("error-spike", {
        detail: { count: 3, at: "2026-08-27T00:00:00Z", reason: "spike" },
      }),
    );
    expect(lastBody()).toEqual({ type: "error-spike", count: 3, reason: "spike" });
    stop();
  });

  it("csp-violation-spike: sends count and reason (drops at)", () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    window.dispatchEvent(
      new CustomEvent("csp-violation-spike", {
        detail: { count: 10, at: "2026-08-27T00:00:00Z", reason: "spike" },
      }),
    );
    expect(lastBody()).toEqual({ type: "csp-violation-spike", count: 10, reason: "spike" });
    stop();
  });

  it("truncates a long reason to 64 chars", () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    dispatchIntegritySpike({ count: 1, reason: "x".repeat(200) });
    expect((lastBody().reason as string).length).toBe(64);
    stop();
  });

  it("forwards non-critical pressure levels unchanged (server decides severity)", () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    dispatchStoragePressure({ level: "pressure", pct: 82.004, usage: 10, quota: 20, persisted: null });
    expect(lastBody()).toEqual({
      type: "storage-pressure",
      level: "pressure",
      pct: 82,
      usage: 10,
      quota: 20,
      persisted: null,
    });
    stop();
  });

  it("ignores malformed detail without sending or crashing", () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    window.dispatchEvent(new CustomEvent("storage-pressure", { detail: null }));
    window.dispatchEvent(new CustomEvent("bundle-integrity-spike", { detail: undefined }));
    window.dispatchEvent(new CustomEvent("bundle-integrity-spike", { detail: "not-an-object" }));
    window.dispatchEvent(new CustomEvent("error-spike", { detail: null }));
    window.dispatchEvent(new CustomEvent("csp-violation-spike", { detail: null }));
    expect(fetchMock()).not.toHaveBeenCalled();
    stop();
  });
});

describe("error containment (server down)", () => {
  it("contains the fetch rejection — no unhandled rejection, no throw", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    fetchMock().mockRejectedValue(new TypeError("Failed to fetch"));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    dispatchStoragePressure({ level: "critical", pct: 95 });
    await new Promise((r) => setTimeout(r, 20));

    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toHaveLength(0);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps forwarding after a server failure (reporter survives)", async () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    fetchMock().mockRejectedValueOnce(new TypeError("Failed to fetch"));

    dispatchIntegritySpike({ count: 1, reason: "first" });
    await new Promise((r) => setTimeout(r, 10));
    dispatchIntegritySpike({ count: 2, reason: "second" });

    expect(eventFetchCalls()).toHaveLength(2);
    expect(lastBody()).toEqual({ type: "bundle-integrity-spike", count: 2, reason: "second" });
    stop();
  });

  it("contains a synchronous fetch throw (offline/sandboxed context)", () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    fetchMock().mockImplementation(() => {
      throw new TypeError("blocked");
    });

    expect(() => dispatchStoragePressure({ level: "critical", pct: 95 })).not.toThrow();
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("bounded retry with backoff (server outage)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses bounded jitter around the exponential backoff", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    fetchMock().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    dispatchStoragePressure({ level: "critical", pct: 95 });
    await vi.advanceTimersByTimeAsync(
      CLIENT_EVENT_RETRY_BASE_DELAY_MS * (1 + CLIENT_EVENT_RETRY_JITTER_RATIO) - 1,
    );
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    random.mockRestore();
    stop();
  });

  it("persists a pending critical event and replays it after reporter restart", async () => {
    vi.useFakeTimers();
    localStorage.setItem(TELEMETRY_KEY, "true");
    fetchMock().mockRejectedValue(new TypeError("server down"));
    const stop = startClientEventReporter();
    dispatchStoragePressure({ level: "critical", pct: 95 });
    await vi.advanceTimersByTimeAsync(0);
    expect(localStorage.getItem("bmf_pending_client_event")).toContain("storage-pressure");
    stop();

    fetchMock().mockResolvedValue(new Response(null, { status: 204 }));
    startClientEventReporter();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("bmf_pending_client_event")).toBeNull();
  });

  it("retries a transient network failure and delivers the event", async () => {
    vi.useFakeTimers();
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    // First attempt fails (server down), retry succeeds.
    fetchMock().mockRejectedValueOnce(new TypeError("Failed to fetch"));

    dispatchStoragePressure({ level: "critical", pct: 95 });
    expect(fetchMock()).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(
      CLIENT_EVENT_RETRY_BASE_DELAY_MS * (1 + CLIENT_EVENT_RETRY_JITTER_RATIO),
    );
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    // The retried payload is the SAME event (not lost, not duplicated).
    expect(lastBody()).toEqual({ type: "storage-pressure", level: "critical", pct: 95, usage: undefined, quota: undefined, persisted: undefined });
    stop();
  });

  it("retries a 5xx response but gives up on 4xx (permanent)", async () => {
    vi.useFakeTimers();
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();

    // 503 (transient) → retried once, then 204 succeeds.
    fetchMock().mockResolvedValueOnce(new Response(null, { status: 503 }));
    dispatchStoragePressure({ level: "critical", pct: 90 });
    await vi.advanceTimersByTimeAsync(
      CLIENT_EVENT_RETRY_BASE_DELAY_MS * (1 + CLIENT_EVENT_RETRY_JITTER_RATIO),
    );
    expect(fetchMock()).toHaveBeenCalledTimes(2);

    // 400 (permanent) → exactly ONE attempt, no retry.
    fetchMock().mockReset();
    fetchMock().mockResolvedValue(new Response(null, { status: 400 }));
    dispatchStoragePressure({ level: "critical", pct: 91 });
    await vi.advanceTimersByTimeAsync(CLIENT_EVENT_RETRY_BASE_DELAY_MS * 10);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    stop();
  });

  it("is bounded: gives up silently after MAX_ATTEMPTS, no unhandled rejection", async () => {
    vi.useFakeTimers();
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    fetchMock().mockRejectedValue(new TypeError("server down")); // always fails

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    dispatchIntegritySpike({ count: 3, reason: "spike" });
    expect(fetchMock()).toHaveBeenCalledTimes(1);

    // Walk through all backoff delays; total attempts must not exceed MAX.
    await vi.advanceTimersByTimeAsync(CLIENT_EVENT_RETRY_BASE_DELAY_MS * 100);
    expect(eventFetchCalls()).toHaveLength(CLIENT_EVENT_RETRY_MAX_ATTEMPTS);

    // Nothing more fires even much later.
    await vi.advanceTimersByTimeAsync(CLIENT_EVENT_RETRY_BASE_DELAY_MS * 100);
    expect(eventFetchCalls()).toHaveLength(CLIENT_EVENT_RETRY_MAX_ATTEMPTS);

    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toHaveLength(0);
    stop();
  });

  it("coalesces per type: a newer event supersedes a pending retry of the same type", async () => {
    vi.useFakeTimers();
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    fetchMock().mockRejectedValue(new TypeError("server down"));

    // Two storage-pressure events while the server is down. Each one's INITIAL
    // attempt still fires (2 calls), but the pending retry of the first (pct
    // 90) is superseded by the newer event: only the LATEST payload is retried.
    dispatchStoragePressure({ level: "critical", pct: 90 });
    await vi.advanceTimersByTimeAsync(0); // flush rejection → schedules retry(90)
    dispatchStoragePressure({ level: "critical", pct: 95 });
    await vi.advanceTimersByTimeAsync(0);

    expect(eventFetchCalls()).toHaveLength(2);

    // Advance through all backoffs. The superseded event (pct 90) must have
    // been sent exactly ONCE (its initial attempt) and NEVER retried; every
    // retried payload must carry the latest pct (95).
    await vi.advanceTimersByTimeAsync(CLIENT_EVENT_RETRY_BASE_DELAY_MS * 100);
    const bodies = fetchMock().mock.calls.map((c) => (c[1] as { body?: string }).body ?? "");
    const storageBodies = bodies
      .filter((b) => b.includes("storage-pressure"))
      .map((b) => JSON.parse(b) as { pct?: number });
    const pct90Count = storageBodies.filter((b) => b.pct === 90).length;
    const pct95Count = storageBodies.filter((b) => b.pct === 95).length;
    expect(pct90Count).toBe(1); // initial attempt only — retry was superseded
    expect(pct95Count).toBe(CLIENT_EVENT_RETRY_MAX_ATTEMPTS); // 1 initial + 2 retries
    stop();
  });

  it("stop() cancels pending retries (no send after cleanup)", async () => {
    vi.useFakeTimers();
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    fetchMock().mockRejectedValue(new TypeError("server down"));

    dispatchIntegritySpike({ count: 3, reason: "spike" });
    expect(fetchMock()).toHaveBeenCalledTimes(1);

    stop(); // cancels the pending retry timer
    await vi.advanceTimersByTimeAsync(CLIENT_EVENT_RETRY_BASE_DELAY_MS * 100);
    expect(fetchMock()).toHaveBeenCalledTimes(1); // no retry fired after stop
  });
});

describe("lifecycle", () => {
  it("start is idempotent: double start registers listeners once", () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop1 = startClientEventReporter();
    const stop2 = startClientEventReporter();
    expect(isClientEventReporterActive()).toBe(true);

    dispatchStoragePressure({ level: "critical", pct: 95 });
    expect(fetchMock()).toHaveBeenCalledTimes(1);

    stop1();
    stop2();
  });

  it("cleanup removes listeners: no forwarding after stop", () => {
    localStorage.setItem(TELEMETRY_KEY, "true");
    const stop = startClientEventReporter();
    expect(isClientEventReporterActive()).toBe(true);

    stop();
    expect(isClientEventReporterActive()).toBe(false);

    dispatchStoragePressure({ level: "critical", pct: 95 });
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});
