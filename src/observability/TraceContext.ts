import { logger, redactSecrets } from "../utils/logger";

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operation: string;
  startTime: number;
  endTime: number | null;
  status: "ok" | "error" | "pending";
  error?: string;
  metadata?: Record<string, string>;
}

interface TraceTree {
  traceId: string;
  spans: TraceSpan[];
  duration: number;
  rootOperation: string;
}

const MAX_SPANS = 1000;
const SPAN_BUFFER: TraceSpan[] = [];
const ACTIVE_SPANS = new Map<string, TraceSpan>();

function generateId(bytes: number = 8): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateTraceId(): string {
  return generateId(16);
}

function generateSpanId(): string {
  return generateId(8);
}

export function startSpan(
  operation: string,
  parentSpan?: TraceSpan,
): TraceSpan {
  const span: TraceSpan = {
    traceId: parentSpan?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: parentSpan?.spanId ?? null,
    operation: redactSecrets(operation).slice(0, 256),
    startTime: performance.now(),
    endTime: null,
    status: "pending",
  };
  ACTIVE_SPANS.set(span.spanId, span);
  return span;
}

export function endSpan(
  span: TraceSpan,
  status: "ok" | "error" = "ok",
  error?: string,
): TraceSpan {
  span.endTime = performance.now();
  span.status = status;
  if (error) {span.error = redactSecrets(error).slice(0, 4_096);}
  ACTIVE_SPANS.delete(span.spanId);

  SPAN_BUFFER.push({ ...span });
  if (SPAN_BUFFER.length > MAX_SPANS) {
    SPAN_BUFFER.splice(0, SPAN_BUFFER.length - MAX_SPANS);
  }

  const duration = span.endTime - span.startTime;
  if (duration > 1000) {
    logger.warn(
      `[Trace] Slow operation: ${span.operation} took ${duration.toFixed(0)}ms`,
      {
        traceId: span.traceId,
        spanId: span.spanId,
      },
    );
  }

  return span;
}

export async function runWithTrace<T>(
  operation: string,
  fn: (span: TraceSpan) => Promise<T>,
): Promise<T> {
  const span = startSpan(operation);
  try {
    const result = await fn(span);
    endSpan(span, "ok");
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    endSpan(span, "error", msg);
    throw err;
  }
}

export function getTraceTree(traceId: string): TraceTree | null {
  const spans = SPAN_BUFFER.filter((s) => s.traceId === traceId);
  if (spans.length === 0) {return null;}

  const root = spans.find((s) => s.parentSpanId === null) ?? spans[0];
  const completed = spans.filter((s) => s.endTime !== null);
  const duration =
    completed.length > 0
      ? Math.max(
          ...completed.map((s) => (s.endTime ?? s.startTime) - s.startTime),
        )
      : 0;

  return { traceId, spans, duration, rootOperation: root!.operation };
}

export function getActiveSpans(): TraceSpan[] {
  return Array.from(ACTIVE_SPANS.values());
}

export function getRecentSpans(limit: number = 50): TraceSpan[] {
  return SPAN_BUFFER.slice(-limit);
}

export function clearSpans(): void {
  SPAN_BUFFER.length = 0;
  ACTIVE_SPANS.clear();
}
