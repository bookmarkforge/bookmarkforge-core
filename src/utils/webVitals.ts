import { logger } from "./logger";

type MetricName = "LCP" | "FID" | "INP" | "CLS" | "FCP" | "TTFB";

type MetricRating = "good" | "needs-improvement" | "poor";

interface WebVitalMetric {
  name: MetricName;
  value: number;
  unit: string;
  rating: MetricRating;
  delta?: number;
  id?: string;
}

type ReportHandler = (metric: WebVitalMetric) => void;

const thresholds: Record<MetricName, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  FID: { good: 100, poor: 300 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

const units: Record<MetricName, string> = {
  LCP: "ms",
  FID: "ms",
  INP: "ms",
  CLS: "score",
  FCP: "ms",
  TTFB: "ms",
};

function getRating(name: MetricName, value: number): MetricRating {
  const t = thresholds[name];
  if (value <= t.good) {return "good";}
  if (value > t.poor) {return "poor";}
  return "needs-improvement";
}

function createMetric(
  name: MetricName,
  value: number,
  id?: string,
  delta?: number,
): WebVitalMetric {
  const metric: WebVitalMetric = {
    name,
    value,
    unit: units[name],
    rating: getRating(name, value),
  };
  if (id !== undefined) {metric.id = id;}
  if (delta !== undefined) {metric.delta = delta;}
  return metric;
}

let registered = false;
let activeObservers: PerformanceObserver[] = [];

/**
 * Stop all observers created by reportWebVitals(). This matters for HMR,
 * embedded previews, and tests: PerformanceObserver instances otherwise keep
 * their callbacks alive for the lifetime of the document.
 */
export function stopWebVitals(): void {
  for (const observer of activeObservers) {
    try {
      observer.disconnect();
    } catch (_err) {
      // A partially implemented observer must not prevent the rest from closing.
    }
  }
  activeObservers = [];
  registered = false;
}

/**
 * Test-only helper: resets the module-level `registered` flag so tests can
 * re-invoke `reportWebVitals()` in isolation. Not used in production code paths.
 */
export function __resetWebVitalsForTests(): void {
  stopWebVitals();
}

function registerObserver(observer: PerformanceObserver): PerformanceObserver {
  activeObservers.push(observer);
  return observer;
}

export function reportWebVitals(onReport?: ReportHandler): void {
  if (registered) {return;}
  registered = true;

  const report: ReportHandler =
    onReport ||
    ((metric) => {
      if (import.meta.env.DEV) {
        logger.info(
          `[WebVital] ${metric.name}: ${metric.value}${metric.unit} (${metric.rating})`,
        );
      }
    });

  try {
    observeLCP(report);
    observeFID(report);
    observeINP(report);
    observeCLS(report);
    observeFCP(report);
    observeTTFB(report);
  } catch (err) {
    logger.error("[WebVitals] Failed to observe metrics:", err);
  }
}

function observeLCP(onReport: ReportHandler): void {
  try {
    const po = registerObserver(new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) {onReport(createMetric("LCP", last.startTime));}
    }));
    po.observe({ type: "largest-contentful-paint", buffered: true });
  } catch (_err) {
    logger.warn("[WebVitals] LCP not supported");
  }
}

function observeFID(onReport: ReportHandler): void {
  try {
    const po = registerObserver(new PerformanceObserver((list) => {
      const entry = list.getEntries()[0] as PerformanceEventTiming;
      if (entry)
        {onReport(createMetric("FID", entry.processingStart - entry.startTime));}
    }));
    po.observe({ type: "first-input", buffered: true });
  } catch (_err) {
    logger.warn("[WebVitals] FID not supported");
  }
}

function observeINP(onReport: ReportHandler): void {
  try {
    let maxVal = 0;
    const po = registerObserver(new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const dur = (entry as PerformanceEventTiming).duration;
        if (dur > maxVal) {maxVal = dur;}
      }
      onReport(createMetric("INP", maxVal));
    }));
    po.observe({
      type: "event",
      buffered: true,
      durationThreshold: 0,
    } as unknown as PerformanceObserverInit);
  } catch (_err) {
    logger.warn("[WebVitals] INP not supported");
  }
}

function observeCLS(onReport: ReportHandler): void {
  try {
    let clsVal = 0;
    const po = registerObserver(new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as unknown as {
          hadRecentInput: boolean;
          value: number;
        };
        if (!shift.hadRecentInput) {clsVal += shift.value;}
      }
      onReport(createMetric("CLS", clsVal));
    }));
    po.observe({ type: "layout-shift", buffered: true });
  } catch (_err) {
    logger.warn("[WebVitals] CLS not supported");
  }
}

function observeFCP(onReport: ReportHandler): void {
  try {
    const po = registerObserver(new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          onReport(createMetric("FCP", entry.startTime));
        }
      }
    }));
    po.observe({ type: "paint", buffered: true });
  } catch (_err) {
    logger.warn("[WebVitals] FCP not supported");
  }
}

function observeTTFB(onReport: ReportHandler): void {
  try {
    const nav = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    if (nav) {onReport(createMetric("TTFB", nav.responseStart));}
  } catch (_err) {
    logger.warn("[WebVitals] TTFB not supported");
  }
}
