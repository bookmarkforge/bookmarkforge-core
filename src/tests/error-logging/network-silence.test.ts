/**
 * Network-silence regression (P-17): a session that has NOT granted any
 * consent purpose must produce zero outbound network traffic from the
 * telemetry/observability surface.
 *
 * BookmarkForge telemetry is local-only by design (see
 * src/telemetry/errorReporter.ts header — "Remote telemetry has been
 * removed"). This test pins that invariant: with every consent key absent
 * (the default for a fresh install), exercising the error reporter,
 * production monitor listeners and the observability hub must not call
 * fetch, sendBeacon, XMLHttpRequest or WebSocket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();

  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      calls.push("fetch");
      return Promise.resolve(new Response("{}", { status: 200 }));
    }),
  );
  vi.stubGlobal(
    "WebSocket",
    vi.fn(() => {
      calls.push("WebSocket");
      return {};
    }),
  );
  const sendBeacon = vi.fn(() => {
    calls.push("sendBeacon");
    return true;
  });
  Object.defineProperty(navigator, "sendBeacon", {
    value: sendBeacon,
    configurable: true,
    writable: true,
  });
  vi.stubGlobal(
    "XMLHttpRequest",
    vi.fn(() => {
      calls.push("XMLHttpRequest");
      return { open: vi.fn(), send: vi.fn() };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("network silence without consent", () => {
  it("errorReporter stores locally and emits no network calls", async () => {
    const { errorReporter } = await import("../../telemetry/errorReporter");
    await errorReporter.reportError(new Error("boom-no-consent"));
    await errorReporter.flush?.();
    expect(calls).toEqual([]);
  });

  it("production monitor listeners emit no network calls", async () => {
    const { initProductionMonitor, stopProductionMonitor } = await import(
      "../../telemetry/productionMonitor"
    );
    initProductionMonitor();
    window.dispatchEvent(
      new CustomEvent("bundle-integrity-failed", {
        detail: { reason: "test" },
      }),
    );
    document.dispatchEvent(
      new Event("securitypolicyviolation") as Event,
    );
    stopProductionMonitor();
    expect(calls).toEqual([]);
  });

  it("observability hub error path emits no network calls", async () => {
    const { observabilityHub } = await import(
      "../../observability/ObservabilityHub"
    );
    observabilityHub.reportError(
      "network-silence-test",
      new Error("hub-no-consent"),
      { source: "network-silence-test" },
    );
    // Flush any queued microtasks before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
  });
});
