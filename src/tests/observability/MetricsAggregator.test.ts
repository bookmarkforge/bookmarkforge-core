import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  metricsAggregator,
} from "../../observability/MetricsAggregator";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from "../../utils/logger";

describe("MetricsAggregator", () => {
  beforeEach(() => {
    metricsAggregator.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    metricsAggregator.stopAutoSnapshot();
    metricsAggregator.clear();
    vi.useRealTimers();
  });

  it("increments counters and computes rates within a window", () => {
    metricsAggregator.incrementCounter("page_view");
    metricsAggregator.incrementCounter("page_view");
    metricsAggregator.incrementCounter("page_view");

    expect(metricsAggregator.getCounterRate("page_view")).toBe(3);

    // Window excludes entries older than the window
    metricsAggregator.incrementCounter("page_view");
    expect(metricsAggregator.getCounterRate("page_view", {}, 0)).toBe(0);
    expect(metricsAggregator.getCounterRate("page_view", {}, 60000)).toBe(4);
  });

  it("keeps counters separate per label set", () => {
    metricsAggregator.incrementCounter("click", { source: "sidebar" });
    metricsAggregator.incrementCounter("click", { source: "header" });

    expect(metricsAggregator.getCounterRate("click", { source: "sidebar" })).toBe(1);
    expect(metricsAggregator.getCounterRate("click", { source: "header" })).toBe(1);
    // Aggregated by name in the snapshot
    const snap = metricsAggregator.getSnapshot();
    expect(snap.counters["click"]?.value).toBe(2);
  });

  it("caps counter entry count", () => {
    for (let i = 0; i < 12000; i++) {
      metricsAggregator.incrementCounter("burst");
    }
    const snap = metricsAggregator.getSnapshot();
    expect(snap.counters["burst"]?.value).toBe(10000);
  });

  it("drops new keys beyond the counter key limit", () => {
    for (let i = 0; i < 501; i++) {
      metricsAggregator.incrementCounter("key_" + i);
    }
    // 500 keys stored, the 501st is dropped with a warning
    const snap = metricsAggregator.getSnapshot();
    expect(Object.keys(snap.counters).length).toBe(500);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("records histograms and computes percentiles", () => {
    for (let i = 1; i <= 100; i++) {
      metricsAggregator.recordHistogram("latency", i);
    }
    const pct = metricsAggregator.getHistogramPercentiles("latency");
    expect(pct.count).toBe(100);
    expect(pct.p50).toBe(50);
    expect(pct.p95).toBe(95);
    expect(pct.p99).toBe(99);
  });

  it("returns zero percentiles for an empty histogram", () => {
    expect(metricsAggregator.getHistogramPercentiles("missing")).toEqual({
      p50: 0,
      p95: 0,
      p99: 0,
      count: 0,
    });
  });

  it("caps histogram values per key", () => {
    for (let i = 0; i < 12000; i++) {
      metricsAggregator.recordHistogram("big", i);
    }
    const snap = metricsAggregator.getSnapshot();
    // Snapshot only exposes the last 100 sorted values
    expect(snap.histograms["big"]?.values.length).toBe(100);
  });

  it("builds histogram buckets from the fixed bucket list", () => {
    metricsAggregator.recordHistogram("resp", 10);
    metricsAggregator.recordHistogram("resp", 2000);
    const snap = metricsAggregator.getSnapshot();
    const buckets = snap.histograms["resp"]?.buckets ?? [];
    expect(buckets.length).toBe(7); // HISTOGRAM_BUCKETS
    const le10 = buckets.find((b) => b.le === 10);
    const le1000 = buckets.find((b) => b.le === 1000);
    expect(le10?.count).toBe(1);
    expect(le1000?.count).toBe(1);
  });

  it("setGauge tracks min/max across updates", () => {
    metricsAggregator.setGauge("memory", 512);
    metricsAggregator.setGauge("memory", 1024);
    metricsAggregator.setGauge("memory", 256);

    const g = metricsAggregator.getGauge("memory");
    expect(g).toEqual({ value: 256, min: 256, max: 1024 });
  });

  it("returns null for a missing gauge", () => {
    expect(metricsAggregator.getGauge("nope")).toBeNull();
  });

  it("does not invent labels when a name has multiple series", () => {
    metricsAggregator.incrementCounter("req", { region: "eu" });
    metricsAggregator.incrementCounter("req", { region: "us" });
    const snapshot = metricsAggregator.getSnapshot();
    expect(snapshot.counters["req"]?.labels).toEqual({});

    metricsAggregator.recordHistogram("latency", 10, { region: "eu" });
    metricsAggregator.recordHistogram("latency", 20, { region: "us" });
    expect(metricsAggregator.getSnapshot().histograms["latency"]?.labels).toEqual({});

    metricsAggregator.setGauge("memory", 1, { tab: "a" });
    metricsAggregator.setGauge("memory", 2, { tab: "b" });
    expect(metricsAggregator.getSnapshot().gauges["memory"]?.labels).toEqual({});
  });

  it("getSnapshot aggregates counters, histograms and gauges by name", () => {
    metricsAggregator.incrementCounter("req", { region: "eu" });
    metricsAggregator.incrementCounter("req", { region: "us" });
    metricsAggregator.recordHistogram("duration", 42);
    metricsAggregator.setGauge("active", 3);

    const snap = metricsAggregator.getSnapshot();
    expect(snap.counters["req"]?.value).toBe(2);
    expect(snap.histograms["duration"]?.values).toContain(42);
    expect(snap.gauges["active"]).toEqual({
      value: 3,
      min: 3,
      max: 3,
      labels: {},
    });
    expect(typeof snap.timestamp).toBe("string");
  });

  it("startAutoSnapshot logs only when counters/histograms exist", () => {
    vi.useFakeTimers();
    metricsAggregator.startAutoSnapshot();
    vi.advanceTimersByTime(60000);
    expect(logger.info).not.toHaveBeenCalled();

    metricsAggregator.incrementCounter("x");
    vi.advanceTimersByTime(60000);
    expect(logger.info).toHaveBeenCalled();
  });

  it("startAutoSnapshot is idempotent", () => {
    vi.useFakeTimers();
    metricsAggregator.startAutoSnapshot();
    metricsAggregator.startAutoSnapshot();
    metricsAggregator.incrementCounter("x");
    vi.advanceTimersByTime(120000);
    // Only one snapshot log per 60s tick even with double-start
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it("stopAutoSnapshot clears the timer", () => {
    vi.useFakeTimers();
    metricsAggregator.startAutoSnapshot();
    metricsAggregator.stopAutoSnapshot();
    metricsAggregator.incrementCounter("x");
    vi.advanceTimersByTime(120000);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("clear resets all aggregations", () => {
    metricsAggregator.incrementCounter("req");
    metricsAggregator.recordHistogram("latency", 10);
    metricsAggregator.setGauge("g", 1);
    metricsAggregator.clear();

    expect(metricsAggregator.getCounterRate("req")).toBe(0);
    expect(metricsAggregator.getHistogramPercentiles("latency")).toEqual({
      p50: 0,
      p95: 0,
      p99: 0,
      count: 0,
    });
    expect(metricsAggregator.getGauge("g")).toBeNull();
  });
});
