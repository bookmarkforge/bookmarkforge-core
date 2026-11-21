import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startSpan,
  endSpan,
  runWithTrace,
  getTraceTree,
  getActiveSpans,
  getRecentSpans,
  clearSpans,
  type TraceSpan,
} from "../../observability/TraceContext";
import { logger } from "../../utils/logger";

describe("TraceContext", () => {
  beforeEach(() => {
    clearSpans();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("startSpan", () => {
    it("creates a pending span with a generated trace and span id", () => {
      const span = startSpan("operation");
      expect(span.operation).toBe("operation");
      expect(span.status).toBe("pending");
      expect(span.endTime).toBeNull();
      expect(span.parentSpanId).toBeNull();
      expect(span.spanId).toMatch(/^[0-9a-f]+$/);
      expect(span.traceId).toMatch(/^[0-9a-f]+$/);
    });

    it("inherits the trace id and parent span id from the parent", () => {
      const parent = startSpan("parent");
      const child = startSpan("child", parent);
      expect(child.traceId).toBe(parent.traceId);
      expect(child.parentSpanId).toBe(parent.spanId);
    });

    it("registers the span as active", () => {
      const span = startSpan("active-test");
      expect(getActiveSpans().some((s) => s.spanId === span.spanId)).toBe(true);
    });
  });

  describe("endSpan", () => {
    it("marks a span ok and removes it from active spans", () => {
      const span = startSpan("ok-op");
      const ended = endSpan(span);
      expect(ended.status).toBe("ok");
      expect(ended.endTime).not.toBeNull();
      expect(getActiveSpans().some((s) => s.spanId === span.spanId)).toBe(false);
    });

    it("records an error status and message", () => {
      const span = startSpan("err-op");
      endSpan(span, "error", "boom");
      expect(span.status).toBe("error");
      expect(span.error).toBe("boom");
      const recent = getRecentSpans();
      const stored = recent.find((s) => s.spanId === span.spanId);
      expect(stored?.status).toBe("error");
      expect(stored?.error).toBe("boom");
    });

    it("warns for slow operations longer than 1000ms", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const span = startSpan("slow-op");
      // Manipulate startTime to simulate a >1000ms duration
      span.startTime = performance.now() - 2000;
      endSpan(span);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("does not warn for fast operations", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const span = startSpan("fast-op");
      endSpan(span);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("runWithTrace", () => {
    it("resolves with the function result and ends the span ok", async () => {
      const result = await runWithTrace("rwt", async (span) => {
        expect(span.operation).toBe("rwt");
        return 42;
      });
      expect(result).toBe(42);
      const recent = getRecentSpans();
      expect(recent.some((s) => s.operation === "rwt" && s.status === "ok")).toBe(
        true,
      );
    });

    it("ends the span as error and rethrows when the function fails", async () => {
      await expect(
        runWithTrace("rwt-fail", async () => {
          throw new Error("failure");
        }),
      ).rejects.toThrow("failure");
      const recent = getRecentSpans();
      expect(
        recent.some((s) => s.operation === "rwt-fail" && s.status === "error"),
      ).toBe(true);
    });
  });

  describe("getTraceTree", () => {
    it("returns null when no spans match the trace id", () => {
      expect(getTraceTree("missing")).toBeNull();
    });

    it("builds a tree with root operation and duration", () => {
      const root = startSpan("root-op");
      const child = startSpan("child-op", root);
      endSpan(child);
      endSpan(root);
      const tree = getTraceTree(root.traceId);
      expect(tree).not.toBeNull();
      expect(tree!.rootOperation).toBe("root-op");
      expect(tree!.spans.length).toBe(2);
      expect(tree!.duration).toBeGreaterThanOrEqual(0);
    });

    it("falls back to the first span as root when no parentless span exists", () => {
      const orphan = startSpan("orphan");
      endSpan(orphan);
      const tree = getTraceTree(orphan.traceId);
      expect(tree?.rootOperation).toBe("orphan");
    });
  });

  describe("getRecentSpans & buffer cap", () => {
    it("returns recent spans limited to the given limit", () => {
      for (let i = 0; i < 10; i++) {
        const s = startSpan(`op-${i}`);
        endSpan(s);
      }
      expect(getRecentSpans(3).length).toBe(3);
    });

    it("caps the internal buffer and keeps the newest spans", () => {
      // 1000 is MAX_SPANS; push 1010 spans and verify only the newest survive.
      for (let i = 0; i < 1010; i++) {
        const s = startSpan(`bulk-${i}`);
        endSpan(s);
      }
      const recent = getRecentSpans();
      expect(recent.length).toBeLessThanOrEqual(1000);
      expect(recent[recent.length - 1]!.operation).toBe("bulk-1009");
    });
  });

  describe("clearSpans", () => {
    it("clears both the buffer and active spans", () => {
      const active = startSpan("will-clear");
      endSpan(startSpan("done"));
      expect(getActiveSpans().length).toBeGreaterThan(0);
      expect(getRecentSpans().length).toBeGreaterThan(0);
      clearSpans();
      expect(getActiveSpans().length).toBe(0);
      expect(getRecentSpans().length).toBe(0);
      expect(active).toBeDefined();
    });
  });
});
