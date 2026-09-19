import { logger, redactSecrets } from "../utils/logger";
import { errorReporter } from "../telemetry/errorReporter";
import {
  startSpan,
  endSpan,
  runWithTrace,
  getRecentSpans,
  getActiveSpans,
  getTraceTree,
  clearSpans,
} from "./TraceContext";
import { metricsAggregator } from "./MetricsAggregator";

interface DashboardSnapshot {
  metrics: ReturnType<typeof metricsAggregator.getSnapshot>;
  activeSpans: ReturnType<typeof getActiveSpans>;
  slowSpans: ReturnType<typeof getRecentSpans>;
}

class ObservabilityHub {
  private initialized = false;
  private errorSink: Parameters<typeof logger.addSink>[0] | null = null;

  private static normalizeLabel(value: string): string {
    // Reduce label cardinality: dynamic values (URLs, full messages) would
    // otherwise create unbounded distinct counter keys. Hash to a short,
    // stable token instead.
    if (value.length <= 48) {return value;}
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = (hash * 31 + value.charCodeAt(i)) | 0;
    }
    return `${value.slice(0, 32)}#${(hash >>> 0).toString(36)}`;
  }

  init(): void {
    if (this.initialized) {return;}
    metricsAggregator.startAutoSnapshot();
    const errorSink: Parameters<typeof logger.addSink>[0] = (entry) => {
      if (entry.level !== "error") {return;}
      const operation = ObservabilityHub.normalizeLabel(
        entry.message.split(" ", 1)[0] || "unknown",
      );
      try {
        this.metrics.incrementCounter("logger.errors", { operation });
      } catch (_err) {
        // Metrics unavailable — skip counting
      }
    };
    this.errorSink = errorSink;
    logger.addSink(errorSink);
    this.initialized = true;
    logger.info("[ObservabilityHub] Initialized");
  }

  dispose(): void {
    if (!this.initialized) {return;}
    if (this.errorSink) {
      logger.removeSink(this.errorSink);
      this.errorSink = null;
    }
    metricsAggregator.stopAutoSnapshot();
    this.initialized = false;
  }

  trace = {
    startSpan: startSpan,
    endSpan: endSpan,
    runWithTrace: runWithTrace,
    getTraceTree: getTraceTree,
    getActiveSpans: getActiveSpans,
    getRecentSpans: getRecentSpans,
    clear: clearSpans,
  };

  metrics = {
    incrementCounter:
      metricsAggregator.incrementCounter.bind(metricsAggregator),
    getCounterRate: metricsAggregator.getCounterRate.bind(metricsAggregator),
    recordHistogram: metricsAggregator.recordHistogram.bind(metricsAggregator),
    getHistogramPercentiles:
      metricsAggregator.getHistogramPercentiles.bind(metricsAggregator),
    setGauge: metricsAggregator.setGauge.bind(metricsAggregator),
    getGauge: metricsAggregator.getGauge.bind(metricsAggregator),
    getSnapshot: metricsAggregator.getSnapshot.bind(metricsAggregator),
  };

  reportError(
    operation: string,
    error: unknown,
    context?: Record<string, string>,
  ): void {
    const msg = redactSecrets(
      error instanceof Error ? error.message : String(error),
    ).slice(0, 4_096);
    const span = startSpan(operation + ".error");
    endSpan(span, "error", msg);
    metricsAggregator.incrementCounter("errors", {
      operation: ObservabilityHub.normalizeLabel(operation),
    });
    errorReporter
      .reportError(error instanceof Error ? error : new Error(msg), context)
      .catch((err) =>
        logger.warn("[Hub] Error reporter failed", { error: err }),
      );
    logger.error(`[Hub] Error in ${operation}:`, msg);
  }

  recordAICall(
    provider: string,
    model: string,
    durationMs: number,
    tokensIn: number,
    tokensOut: number,
  ): void {
    const labels = {
      provider: ObservabilityHub.normalizeLabel(provider),
      model: ObservabilityHub.normalizeLabel(model),
    };
    metricsAggregator.incrementCounter("ai.calls", labels);
    metricsAggregator.recordHistogram("ai.duration_ms", durationMs, labels);
    metricsAggregator.recordHistogram(
      "ai.tokens_total",
      tokensIn + tokensOut,
      labels,
    );
    metricsAggregator.setGauge(
      "ai.active_models",
      parseFloat(model.replace(/[^0-9.]/g, "") || "0"),
      labels,
    );
  }

  recordSync(operation: string, durationMs: number, success: boolean): void {
    const normalizedOperation = ObservabilityHub.normalizeLabel(operation);
    metricsAggregator.incrementCounter("sync.operations", {
      operation: normalizedOperation,
      status: success ? "ok" : "error",
    });
    metricsAggregator.recordHistogram("sync.duration_ms", durationMs, {
      operation: normalizedOperation,
    });
  }

  recordCacheHit(cacheName: string): void {
    metricsAggregator.incrementCounter("cache.hits", {
      cache: ObservabilityHub.normalizeLabel(cacheName),
    });
  }

  recordCacheMiss(cacheName: string): void {
    metricsAggregator.incrementCounter("cache.misses", {
      cache: ObservabilityHub.normalizeLabel(cacheName),
    });
  }

  getDashboard(): DashboardSnapshot {
    return {
      metrics: metricsAggregator.getSnapshot(),
      activeSpans: getActiveSpans(),
      slowSpans: getRecentSpans(20).filter(
        (s) => s.endTime !== null && s.endTime! - s.startTime > 500,
      ),
    };
  }
}

export const observabilityHub = new ObservabilityHub();
