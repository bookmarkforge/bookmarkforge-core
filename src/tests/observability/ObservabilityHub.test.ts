import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../utils/logger";
import { observabilityHub } from "../../observability/ObservabilityHub";
import { metricsAggregator } from "../../observability/MetricsAggregator";

describe("ObservabilityHub lifecycle", () => {
  beforeEach(() => {
    observabilityHub.dispose();
    metricsAggregator.clear();
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    observabilityHub.dispose();
    metricsAggregator.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("tracks logger errors without replacing the global logger method", () => {
    const originalError = logger.error;

    observabilityHub.init();
    observabilityHub.init();
    logger.error("observability lifecycle error");

    expect(logger.error).toBe(originalError);
    expect(
      observabilityHub.metrics.getSnapshot().counters["logger.errors"]?.value,
    ).toBe(1);
  });

  it("removes the logger sink and stops the snapshot timer on dispose", () => {
    observabilityHub.init();
    expect(vi.getTimerCount()).toBe(1);

    observabilityHub.dispose();
    logger.error("after dispose");

    expect(vi.getTimerCount()).toBe(0);
    expect(
      observabilityHub.metrics.getSnapshot().counters["logger.errors"],
    ).toBeUndefined();
  });

  it("bounds metric labels and aggregated histogram snapshot work", () => {
    const longLabel = "x".repeat(10_000);
    const secondLongLabel = `${longLabel}-second`;
    for (let index = 0; index < 10_000; index++) {
      metricsAggregator.recordHistogram("latency", index, { source: longLabel });
      metricsAggregator.recordHistogram("latency", index, {
        source: secondLongLabel,
      });
    }

    const snapshot = metricsAggregator.getSnapshot();
    const histogram = snapshot.histograms.latency;

    expect(histogram).toBeDefined();
    expect(histogram!.values.length).toBeLessThanOrEqual(100);
    expect(histogram!.buckets.every((bucket) => bucket.count <= 10_000)).toBe(
      true,
    );
    expect(Object.values(histogram!.labels).every((value) => value.length <= 128)).toBe(
      true,
    );
  });
});
