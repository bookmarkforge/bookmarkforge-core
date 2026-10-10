import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initSwIntegrityBridge } from "../../utils/swIntegrityBridge";

/**
 * ADR-039: the SW-side integrity runtime notifies windows with
 * postMessage({ type: "bundle-integrity-failed", … }). The bridge must
 * replay ONLY those messages onto the window event the app already handles
 * (AppInitializer + telemetry/productionMonitor react to
 * "bundle-integrity-failed"), and stay silent for everything else.
 */

type MessageListener = (event: MessageEvent) => void;

function stubServiceWorker() {
  const listeners = new Map<string, Set<MessageListener>>();
  const swStub = {
    addEventListener: vi.fn((type: string, fn: MessageListener) => {
      if (!listeners.has(type)) {listeners.set(type, new Set());}
      listeners.get(type)!.add(fn);
    }),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    value: swStub,
    configurable: true,
  });
  return {
    swStub,
    dispatchMessage: (data: unknown) => {
      for (const fn of listeners.get("message") ?? []) {
        fn({ data } as MessageEvent);
      }
    },
  };
}

function restoreServiceWorker() {
  Reflect.deleteProperty(navigator, "serviceWorker");
}

describe("swIntegrityBridge (ADR-039)", () => {
  let dispatched: CustomEvent[] = [];
  let handler: (e: Event) => void;

  beforeEach(() => {
    dispatched = [];
    handler = (e: Event) => dispatched.push(e as CustomEvent);
    window.addEventListener("bundle-integrity-failed", handler);
  });

  afterEach(() => {
    window.removeEventListener("bundle-integrity-failed", handler);
    restoreServiceWorker();
  });

  it("is a no-op (no throw) when serviceWorker is unsupported", () => {
    restoreServiceWorker();
    expect(() => initSwIntegrityBridge()).not.toThrow();
  });

  it("registers exactly one message listener", () => {
    const { swStub } = stubServiceWorker();
    initSwIntegrityBridge();
    expect(swStub.addEventListener).toHaveBeenCalledTimes(1);
    expect(swStub.addEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
  });

  it("replays an integrity failure message onto the window contract", () => {
    const { dispatchMessage } = stubServiceWorker();
    initSwIntegrityBridge();

    dispatchMessage({
      type: "bundle-integrity-failed",
      mismatchedFiles: ["/assets/chunk-abc.js"],
      reason: "sw-cache-handler",
      checkedAt: "2026-09-02T00:00:00.000Z",
    });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.detail).toMatchObject({
      type: "bundle-integrity-failed",
      mismatchedFiles: ["/assets/chunk-abc.js"],
      reason: "sw-cache-handler",
    });
  });

  it("ignores non-integrity service-worker messages", () => {
    const { dispatchMessage } = stubServiceWorker();
    initSwIntegrityBridge();

    dispatchMessage({ type: "SW_UPDATE_READY" });
    dispatchMessage({ type: "bundle-integrity-failed-but-not-really" });
    dispatchMessage("string payload");
    dispatchMessage(null);
    dispatchMessage(undefined);

    expect(dispatched).toHaveLength(0);
  });
});
