import { logger } from "../utils/logger";

const HISTOGRAM_BUCKETS = [10, 50, 100, 500, 1000, 5000, 10000];
const MAX_COUNTER_ENTRIES = 10000;
const MAX_COUNTER_KEYS = 500;
const MAX_HISTOGRAM_KEYS = 500;
const MAX_GAUGE_KEYS = 500;
const MAX_HISTOGRAM_VALUES = 10000;
const MAX_HISTOGRAM_SNAPSHOT_VALUES = 10000;
const MAX_METRIC_LABEL_LENGTH = 128;
const MAX_METRIC_LABELS = 16;

interface Counter {
  value: number;
  labels: Record<string, string>;
}

interface HistogramBucket {
  le: number;
  count: number;
}

interface Histogram {
  values: number[];
  labels: Record<string, string>;
  buckets: HistogramBucket[];
}

interface Gauge {
  value: number;
  min: number;
  max: number;
  labels: Record<string, string>;
}

interface MetricsSnapshot {
  counters: Record<string, Counter>;
  histograms: Record<string, Histogram>;
  gauges: Record<string, Gauge>;
  timestamp: string;
}
const SNAPSHOT_INTERVAL_MS = 60000;

function mergeSnapshotLabels(
  current: Record<string, string> | undefined,
  next: Record<string, string>,
): Record<string, string> {
  if (!current) {return { ...next };}
  return Object.keys(current).length === Object.keys(next).length &&
    Object.entries(current).every(([key, value]) => next[key] === value)
    ? current
    : {};
}

class MetricsAggregator {
  private counters = new Map<string, number[]>();
  private counterLabels = new Map<string, Record<string, string>>();
  private histograms = new Map<string, number[]>();
  private histogramLabels = new Map<string, Record<string, string>>();
  private gauges = new Map<
    string,
    { value: number; min: number; max: number }
  >();
  private gaugeLabels = new Map<string, Record<string, string>>();
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;

  startAutoSnapshot(): void {
    if (this.snapshotTimer) {return;}
    this.snapshotTimer = setInterval(() => {
      const snapshot = this.getSnapshot();
      if (
        Object.keys(snapshot.counters).length > 0 ||
        Object.keys(snapshot.histograms).length > 0
      ) {
        logger.info("[Metrics] Auto-snapshot", snapshot);
      }
    }, SNAPSHOT_INTERVAL_MS);
  }

  stopAutoSnapshot(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  incrementCounter(name: string, labels: Record<string, string> = {}): void {
    const normalizedLabels = this.normalizeLabels(labels);
    const key = this.makeKey(name, normalizedLabels);
    if (!this.counters.has(key) && this.counters.size >= MAX_COUNTER_KEYS) {
      // Bound the number of distinct counter keys to avoid unbounded
      // memory growth when labels contain high-cardinality values
      // (e.g. dynamic URLs passed as operation labels).
      logger.warn("[Metrics] Counter key limit reached; dropping new key", {
        key,
      });
      return;
    }
    const existing = this.counters.get(key) ?? [];
    existing.push(Date.now());
    if (existing.length > MAX_COUNTER_ENTRIES) {
      existing.splice(0, existing.length - MAX_COUNTER_ENTRIES);
    }
    this.counters.set(key, existing);
    this.counterLabels.set(key, normalizedLabels);
  }

  getCounterRate(
    name: string,
    labels: Record<string, string> = {},
    windowMs: number = 60000,
  ): number {
    const key = this.makeKey(name, labels);
    const timestamps = this.counters.get(key) ?? [];
    const cutoff = Date.now() - windowMs;
    return timestamps.filter((t) => t > cutoff).length;
  }

  recordHistogram(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    if (!Number.isFinite(value)) {return;}
    const normalizedLabels = this.normalizeLabels(labels);
    const key = this.makeKey(name, normalizedLabels);
    if (!this.histograms.has(key) && this.histograms.size >= MAX_HISTOGRAM_KEYS) {
      logger.warn("[Metrics] Histogram key limit reached; dropping new key", {
        key,
      });
      return;
    }
    const existing = this.histograms.get(key) ?? [];
    existing.push(value);
    if (existing.length > MAX_HISTOGRAM_VALUES) {
      existing.splice(0, existing.length - MAX_HISTOGRAM_VALUES);
    }
    this.histograms.set(key, existing);
    this.histogramLabels.set(key, normalizedLabels);
  }

  getHistogramPercentiles(
    name: string,
    labels: Record<string, string> = {},
  ): { p50: number; p95: number; p99: number; count: number } {
    const key = this.makeKey(name, labels);
    const values = (this.histograms.get(key) ?? [])
      .slice()
      .sort((a, b) => a - b);
    if (values.length === 0) {return { p50: 0, p95: 0, p99: 0, count: 0 };}

    const p = (n: number): number => {
      const idx = Math.floor((n / 100) * (values.length - 1));
      return values[Math.min(idx, values.length - 1)] ?? 0;
    };
    return { p50: p(50), p95: p(95), p99: p(99), count: values.length };
  }

  setGauge(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    if (!Number.isFinite(value)) {return;}
    const normalizedLabels = this.normalizeLabels(labels);
    const key = this.makeKey(name, normalizedLabels);
    if (!this.gauges.has(key) && this.gauges.size >= MAX_GAUGE_KEYS) {
      logger.warn("[Metrics] Gauge key limit reached; dropping new key", {
        key,
      });
      return;
    }
    const existing = this.gauges.get(key) ?? {
      value: 0,
      min: Infinity,
      max: -Infinity,
    };
    existing.value = value;
    existing.min = Math.min(existing.min, value);
    existing.max = Math.max(existing.max, value);
    this.gauges.set(key, existing);
    this.gaugeLabels.set(key, normalizedLabels);
  }

  getGauge(
    name: string,
    labels: Record<string, string> = {},
  ): { value: number; min: number; max: number } | null {
    const key = this.makeKey(name, labels);
    return this.gauges.get(key) ?? null;
  }

  getSnapshot(): MetricsSnapshot {
    const counters: Record<string, Counter> = {};
    const histograms: Record<string, Histogram> = {};
    const gauges: Record<string, Gauge> = {};

    for (const [key, timestamps] of this.counters) {
      const name = key.split("|")[0];
      if (!name) {continue;}
      const existing = counters[name];
      if (existing) {
        existing.value += timestamps.length;
        existing.labels = mergeSnapshotLabels(
          existing.labels,
          this.counterLabels.get(key) ?? {},
        );
      } else {
        counters[name] = {
          value: timestamps.length,
          labels: { ...(this.counterLabels.get(key) ?? {}) },
        };
      }
    }

    const histogramValues = new Map<string, number[]>();
    for (const [key, values] of this.histograms) {
      const name = key.split("|")[0];
      if (!name) {continue;}
      const previous = histogramValues.get(name) ?? [];
      const incoming =
        values.length > MAX_HISTOGRAM_SNAPSHOT_VALUES
          ? values.slice(-MAX_HISTOGRAM_SNAPSHOT_VALUES)
          : values;
      const previousToKeep = Math.max(
        0,
        MAX_HISTOGRAM_SNAPSHOT_VALUES - incoming.length,
      );
      histogramValues.set(name, [
        ...(previousToKeep > 0 ? previous.slice(-previousToKeep) : []),
        ...incoming,
      ]);
      const labels = this.histogramLabels.get(key) ?? {};
      const existing = histograms[name];
      if (existing) {
        existing.labels = mergeSnapshotLabels(existing.labels, labels);
      } else {
        histograms[name] = {
          values: [],
          labels: { ...labels },
          buckets: [],
        };
      }
    }
    for (const [name, values] of histogramValues) {
      const sorted = values.sort((a, b) => a - b);
      const histogram = histograms[name];
      if (!histogram) {continue;}
      histogram.values = sorted.slice(-100);
      histogram.buckets = HISTOGRAM_BUCKETS.map((le) => ({
        le,
        count: sorted.filter((v) => v <= le).length,
      }));
    }

    for (const [key, g] of this.gauges) {
      const name = key.split("|")[0];
      if (!name) {continue;}
      const labels = this.gaugeLabels.get(key) ?? {};
      const existing = gauges[name];
      if (existing) {
        existing.labels = mergeSnapshotLabels(existing.labels, labels);
      } else {
        gauges[name] = {
          value: g.value,
          min: g.min,
          max: g.max,
          labels: { ...labels },
        };
      }
    }

    return {
      counters,
      histograms,
      gauges,
      timestamp: new Date().toISOString(),
    };
  }

  clear(): void {
    this.counters.clear();
    this.counterLabels.clear();
    this.histograms.clear();
    this.histogramLabels.clear();
    this.gauges.clear();
    this.gaugeLabels.clear();
  }

  private normalizeLabels(
    labels: Record<string, string>,
  ): Record<string, string> {
    return Object.entries(labels)
      .slice(0, MAX_METRIC_LABELS)
      .map(([key, value]) => [
        this.capMetricText(key),
        this.capMetricText(value),
      ] as const)
      .reduce<Record<string, string>>((result, [key, value]) => {
        result[key] = value;
        return result;
      }, {});
  }

  private capMetricText(value: string): string {
    if (value.length <= MAX_METRIC_LABEL_LENGTH) {return value;}
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
      hash = (hash * 31 + value.charCodeAt(index)) | 0;
    }
    return `${value.slice(0, MAX_METRIC_LABEL_LENGTH - 10)}#${(
      hash >>> 0
    ).toString(36)}`;
  }

  private makeKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(this.normalizeLabels(labels))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `${this.capMetricText(name)}|${labelStr}`;
  }
}

export const metricsAggregator = new MetricsAggregator();
