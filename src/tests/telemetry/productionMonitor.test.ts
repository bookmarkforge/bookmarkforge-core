import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetForTests, initProductionMonitor, isProductionMonitorActive, stopProductionMonitor } from "../../telemetry/productionMonitor";
import { errorReporter } from "../../telemetry/errorReporter";

vi.mock("../../telemetry/errorReporter", () => ({ errorReporter: { reportError: vi.fn().mockResolvedValue(undefined) } }));

describe("production monitor", () => {
  beforeEach(() => {
    __resetForTests();
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { stopProductionMonitor(); __resetForTests(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("starts idempotently and can be stopped", () => {
    initProductionMonitor();
    initProductionMonitor();
    expect(isProductionMonitorActive()).toBe(true);
    stopProductionMonitor();
    expect(isProductionMonitorActive()).toBe(false);
  });

  it("reports an integrity spike after three failures", () => {
    const listener = vi.fn();
    window.addEventListener("bundle-integrity-spike", listener);
    initProductionMonitor();
    for (let i = 0; i < 3; i++) window.dispatchEvent(new CustomEvent("bundle-integrity-failed", { detail: { chunk: `chunk-${i}` } }));
    expect(listener).toHaveBeenCalled();
    expect(errorReporter.reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "productionMonitor" }));
    window.removeEventListener("bundle-integrity-spike", listener);
  });

  it("emits a CSP spike at the threshold and logs storage pressure", () => {
    const listener = vi.fn();
    window.addEventListener("csp-violation-spike", listener);
    initProductionMonitor();
    for (let i = 0; i < 10; i++) document.dispatchEvent(new Event("securitypolicyviolation"));
    window.dispatchEvent(new CustomEvent("storage-pressure", { detail: { level: "critical", pct: 95 } }));
    expect(listener).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
    window.removeEventListener("csp-violation-spike", listener);
  });

  it("emits an error-spike after three global errors within 60s", () => {
    const listener = vi.fn();
    window.addEventListener("error-spike", listener);
    initProductionMonitor();
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new ErrorEvent("error", { error: new Error(`boom-${i}`) }));
    }
    expect(listener).toHaveBeenCalled();
    const detail = (listener.mock.calls[0]![0] as CustomEvent).detail as { count: number; reason: string; at?: string };
    expect(detail.count).toBe(3);
    expect(detail.reason).toBe("spike");
    expect(detail.at).toBeDefined();
    window.removeEventListener("error-spike", listener);
  });

  it("counts unhandled rejections toward the error spike", () => {
    const listener = vi.fn();
    window.addEventListener("error-spike", listener);
    initProductionMonitor();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("a") }));
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: new Promise(() => {}),
        reason: new Error("b"),
      }),
    );
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("c") }));
    expect(listener).toHaveBeenCalled();
    window.removeEventListener("error-spike", listener);
  });

  it("does not emit an error-spike below the threshold", () => {
    const listener = vi.fn();
    window.addEventListener("error-spike", listener);
    initProductionMonitor();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("single") }));
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: new Promise(() => {}),
        reason: new Error("second"),
      }),
    );
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("error-spike", listener);
  });

  it("resets the error counter when the 60s window expires", () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    window.addEventListener("error-spike", listener);
    initProductionMonitor();

    // Two errors in the first window (below threshold), then the window
    // expires: two more errors must NOT reach the threshold (counter reset).
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("1") }));
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("2") }));
    vi.advanceTimersByTime(61_000);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("3") }));
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("4") }));
    expect(listener).not.toHaveBeenCalled();

    // Third error in the new window crosses the threshold with count 3.
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("5") }));
    expect(listener).toHaveBeenCalled();
    const detail = (listener.mock.calls[0]![0] as CustomEvent).detail as { count: number };
    expect(detail.count).toBe(3);
    window.removeEventListener("error-spike", listener);
  });
});
