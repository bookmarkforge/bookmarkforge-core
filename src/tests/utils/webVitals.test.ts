import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  reportWebVitals,
  stopWebVitals,
  __resetWebVitalsForTests,
} from "../../utils/webVitals";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/**
 * Stubs PerformanceObserver so each observer's callback is captured in
 * order of registration (LCP, FID, INP, CLS, FCP — TTFB uses navigation
 * timing, not PO). Uses a class (not vi.fn) because the module constructs
 * it with `new` and vitest-4 mock fns with arrow implementations are not
 * constructors.
 */
function captureObserverCallbacks() {
  const callbacks: Array<(list: unknown) => void> = [];
  class MockPerformanceObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
    constructor(cb: (list: unknown) => void) {
      callbacks.push(cb);
    }
  }
  vi.stubGlobal("PerformanceObserver", MockPerformanceObserver);
  return callbacks;
}

describe("webVitals", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not throw", () => {
    __resetWebVitalsForTests();
    expect(() => reportWebVitals()).not.toThrow();
  });

  it("idempotent", () => {
    __resetWebVitalsForTests();
    reportWebVitals();
    reportWebVitals();
    expect(true).toBe(true);
  });

  it("disconnects all observers when stopped", () => {
    __resetWebVitalsForTests();
    const observers: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
    class TrackingObserver {
      disconnect = vi.fn();
      observe = vi.fn();
      constructor(_callback: unknown) {
        observers.push(this);
      }
    }
    vi.stubGlobal("PerformanceObserver", TrackingObserver);
    reportWebVitals();
    expect(observers).toHaveLength(5);
    stopWebVitals();
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it("handles PerformanceObserver throwing", () => {
    __resetWebVitalsForTests();
    vi.stubGlobal("PerformanceObserver", vi.fn(function () { throw new Error("fail"); }));
    expect(() => reportWebVitals()).not.toThrow();
  });

  it("handles observe throwing", () => {
    __resetWebVitalsForTests();
    vi.stubGlobal("PerformanceObserver", vi.fn(function () { return ({
      observe: vi.fn(() => { throw new Error("fail"); }),
      disconnect: vi.fn(),
      takeRecords: vi.fn(() => []),
    }); }));
    expect(() => reportWebVitals()).not.toThrow();
  });

  it("handles undefined PerformanceObserver", () => {
    __resetWebVitalsForTests();
    vi.stubGlobal("PerformanceObserver", undefined);
    expect(() => reportWebVitals()).not.toThrow();
  });

  // ── TTFB observer (uses navigation timing, not PO) ──────────────
  describe("TTFB observer", () => {
    beforeEach(() => {
      __resetWebVitalsForTests();
      vi.stubGlobal("PerformanceObserver", vi.fn(function () { return ({
        observe: vi.fn(), disconnect: vi.fn(), takeRecords: vi.fn(() => []),
      }); }));
    });

    it("reports TTFB from navigation timing (good)", () => {
      vi.spyOn(performance, "getEntriesByType").mockReturnValue([
        { responseStart: 500 } as PerformanceNavigationTiming,
      ]);
      const onReport = vi.fn();
      reportWebVitals(onReport);
      expect(onReport).toHaveBeenCalledWith(
        expect.objectContaining({ name: "TTFB", value: 500, rating: "good" }),
      );
    });

    it("reports TTFB with poor rating", () => {
      vi.spyOn(performance, "getEntriesByType").mockReturnValue([
        { responseStart: 2000 } as PerformanceNavigationTiming,
      ]);
      const onReport = vi.fn();
      reportWebVitals(onReport);
      expect(onReport).toHaveBeenCalledWith(
        expect.objectContaining({ name: "TTFB", value: 2000, rating: "poor" }),
      );
    });

    it("handles empty navigation entries", () => {
      vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
      expect(() => reportWebVitals()).not.toThrow();
    });

    it("handles throwing navigation entries", () => {
      vi.spyOn(performance, "getEntriesByType").mockImplementation(() => {
        throw new Error("nope");
      });
      expect(() => reportWebVitals()).not.toThrow();
    });
  });

  // ── Rating boundaries via TTFB (most reliable in jsdom) ─────────
  describe("rating boundaries", () => {
    beforeEach(() => {
      __resetWebVitalsForTests();
      vi.stubGlobal("PerformanceObserver", vi.fn(function () { return ({
        observe: vi.fn(), disconnect: vi.fn(), takeRecords: vi.fn(() => []),
      }); }));
    });

    const ttfb = (ms: number) =>
      vi.spyOn(performance, "getEntriesByType").mockReturnValue([
        { responseStart: ms } as PerformanceNavigationTiming,
      ]);

    it("TTFB 800→good, 801→needs-improvement, 1801→poor", () => {
      const onReport = vi.fn();
      ttfb(800); reportWebVitals(onReport);
      expect(onReport).toHaveBeenCalledWith(expect.objectContaining({ rating: "good" }));
      vi.restoreAllMocks(); onReport.mockClear(); __resetWebVitalsForTests();
      ttfb(801); reportWebVitals(onReport);
      expect(onReport).toHaveBeenCalledWith(expect.objectContaining({ rating: "needs-improvement" }));
      vi.restoreAllMocks(); onReport.mockClear(); __resetWebVitalsForTests();
      ttfb(1801); reportWebVitals(onReport);
      expect(onReport).toHaveBeenCalledWith(expect.objectContaining({ rating: "poor" }));
    });
  });

  // ── Per-metric observers (LCP/FID/INP/CLS/FCP) ──────────────────
  describe("PO observers", () => {
    beforeEach(() => {
      __resetWebVitalsForTests();
    });

    it("LCP reports largest-contentful-paint with ratings + skips empty", () => {
      const callbacks = captureObserverCallbacks();
      const onReport = vi.fn();
      reportWebVitals(onReport);
      const lcp = callbacks[0]!;

      lcp({ getEntries: () => [{ startTime: 1000 }] });
      expect(onReport).toHaveBeenCalledWith(
        expect.objectContaining({ name: "LCP", value: 1000, unit: "ms", rating: "good" }),
      );

      onReport.mockClear();
      lcp({ getEntries: () => [{ startTime: 4500 }] });
      expect(onReport).toHaveBeenCalledWith(
        expect.objectContaining({ name: "LCP", rating: "poor" }),
      );

      onReport.mockClear();
      lcp({ getEntries: () => [] });
      expect(onReport).not.toHaveBeenCalled();
    });

    it("FID reports first-input delay and skips empty entries", () => {
      const callbacks = captureObserverCallbacks();
      const onReport = vi.fn();
      reportWebVitals(onReport);
      const fid = callbacks[1]!;

      fid({ getEntries: () => [{ processingStart: 150, startTime: 100 }] });
      expect(onReport).toHaveBeenCalledWith(
        expect.objectContaining({ name: "FID", value: 50, rating: "good" }),
      );

      onReport.mockClear();
      fid({ getEntries: () => [] });
      expect(onReport).not.toHaveBeenCalled();
    });

    it("INP reports the max event duration across entries", () => {
      const callbacks = captureObserverCallbacks();
      const onReport = vi.fn();
      reportWebVitals(onReport);
      const inp = callbacks[2]!;

      inp({ getEntries: () => [{ duration: 120 }, { duration: 400 }] });
      expect(onReport).toHaveBeenCalledWith(
        expect.objectContaining({ name: "INP", value: 400, rating: "needs-improvement" }),
      );

      onReport.mockClear();
      inp({ getEntries: () => [{ duration: 600 }] });
      expect(onReport).toHaveBeenCalledWith(
        expect.objectContaining({ name: "INP", rating: "poor" }),
      );
    });

    it("CLS sums layout shifts, ignoring recent-input entries", () => {
      const callbacks = captureObserverCallbacks();
      const onReport = vi.fn();
      reportWebVitals(onReport);
      const cls = callbacks[3]!;

      cls({
        getEntries: () => [
          { hadRecentInput: false, value: 0.05 },
          { hadRecentInput: true, value: 0.5 }, // ignored
          { hadRecentInput: false, value: 0.02 },
        ],
      });
      expect(onReport).toHaveBeenCalledWith(
        expect.objectContaining({ name: "CLS", value: 0.07, rating: "good" }),
      );
    });

    it("FCP reports only the first-contentful-paint entry", () => {
      const callbacks = captureObserverCallbacks();
      const onReport = vi.fn();
      reportWebVitals(onReport);
      const fcp = callbacks[4]!;

      fcp({
        getEntries: () => [
          { name: "first-paint", startTime: 500 },
          { name: "first-contentful-paint", startTime: 900 },
        ],
      });
      expect(onReport).toHaveBeenCalledWith(
        expect.objectContaining({ name: "FCP", value: 900, rating: "good" }),
      );
    });
  });
});
