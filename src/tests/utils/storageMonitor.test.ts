import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getStoragePressureLevel,
  checkStoragePressure,
  startStorageMonitor,
  stopStorageMonitor,
  isStorageMonitorActive,
} from "../../utils/storageMonitor";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

type EstimateResult = { usage?: number; quota?: number };

function stubStorageEstimate(result: EstimateResult | null) {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value:
      result === null
        ? {}
        : {
            estimate: vi.fn().mockResolvedValue(result),
            persisted: vi.fn().mockResolvedValue(true),
          },
  });
}

describe("storageMonitor.getStoragePressureLevel", () => {
  it("classifies ok / pressure / critical by threshold", () => {
    expect(getStoragePressureLevel(0)).toBe("ok");
    expect(getStoragePressureLevel(79.9)).toBe("ok");
    expect(getStoragePressureLevel(80)).toBe("pressure");
    expect(getStoragePressureLevel(89.9)).toBe("pressure");
    expect(getStoragePressureLevel(90)).toBe("critical");
    expect(getStoragePressureLevel(100)).toBe("critical");
  });
});

describe("storageMonitor.checkStoragePressure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopStorageMonitor();
  });

  it("returns null when navigator.storage.estimate is unavailable", async () => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {},
    });
    await expect(checkStoragePressure()).resolves.toBeNull();
  });

  it("returns ok detail for low usage without dispatching the event", async () => {
    stubStorageEstimate({ usage: 100, quota: 1000 });
    const spy = vi.spyOn(window, "dispatchEvent");

    const detail = await checkStoragePressure();

    expect(detail).toMatchObject({
      pct: 10,
      usage: 100,
      quota: 1000,
      persisted: true,
      level: "ok",
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("warns and dispatches storage-pressure on pressure level", async () => {
    stubStorageEstimate({ usage: 850, quota: 1000 });
    const events: CustomEvent<{ pct: number }>[] = [];
    const listener = (e: Event) =>
      events.push(e as CustomEvent<{ pct: number }>);
    window.addEventListener("storage-pressure", listener);

    const detail = await checkStoragePressure();

    expect(detail?.level).toBe("pressure");
    expect(events).toHaveLength(1);
    expect(events[0]!.detail.pct).toBeCloseTo(85);
    window.removeEventListener("storage-pressure", listener);
  });

  it("warns on critical level and on denied persistence", async () => {
    stubStorageEstimate({ usage: 950, quota: 1000 });
    (
      navigator.storage as unknown as { persisted: () => Promise<boolean> }
    ).persisted = vi.fn().mockResolvedValue(false);
    const events: Event[] = [];
    const listener = (e: Event) => events.push(e);
    window.addEventListener("storage-pressure", listener);

    const detail = await checkStoragePressure();

    expect(detail?.level).toBe("critical");
    expect(detail?.persisted).toBe(false);
    expect(events).toHaveLength(1);
    window.removeEventListener("storage-pressure", listener);
  });

  it("returns null when estimate() rejects (contained failure)", async () => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate: vi.fn().mockRejectedValue(new Error("idb gone")) },
    });
    await expect(checkStoragePressure()).resolves.toBeNull();
  });

  it("still returns the detail when persisted() rejects (best-effort status)", async () => {
    stubStorageEstimate({ usage: 10, quota: 1000 });
    (
      navigator.storage as unknown as { persisted: () => Promise<boolean> }
    ).persisted = vi.fn().mockRejectedValue(new Error("persist probe failed"));

    const detail = await checkStoragePressure();
    expect(detail).toMatchObject({ level: "ok", persisted: null });
  });

  it("treats a zero quota as 0% pressure instead of dividing by zero", async () => {
    stubStorageEstimate({ usage: 500, quota: 0 });
    const detail = await checkStoragePressure();
    expect(detail?.pct).toBe(0);
    expect(detail?.level).toBe("ok");
  });

  it("keeps working when dispatching storage-pressure throws", async () => {
    stubStorageEstimate({ usage: 950, quota: 1000 });
    // jsdom does not propagate listener exceptions synchronously to
    // dispatchEvent (it routes them to the virtual console as unhandled
    // errors), so simulate a throwing dispatcher to exercise the module's
    // containment try/catch deterministically.
    const dispatchSpy = vi
      .spyOn(window, "dispatchEvent")
      .mockImplementation(() => {
        throw new Error("listener bug");
      });

    try {
      await expect(checkStoragePressure()).resolves.toMatchObject({
        level: "critical",
      });
    } finally {
      dispatchSpy.mockRestore();
    }
  });
});

describe("storageMonitor lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopStorageMonitor();
    stubStorageEstimate({ usage: 10, quota: 1000 });
  });

  afterEach(() => {
    stopStorageMonitor();
    vi.useRealTimers();
  });

  it("starts once, checks after 4s and then every 5 minutes", async () => {
    const estimate = (
      navigator.storage as unknown as { estimate: ReturnType<typeof vi.fn> }
    ).estimate;

    startStorageMonitor();
    expect(isStorageMonitorActive()).toBe(true);

    // Second start must be a no-op (idempotent boot guard).
    startStorageMonitor();

    expect(estimate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    expect(estimate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(estimate).toHaveBeenCalledTimes(2);

    stopStorageMonitor();
    expect(isStorageMonitorActive()).toBe(false);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(estimate).toHaveBeenCalledTimes(2); // no more checks after stop
  });

  it("does not start outside a window context", () => {
    // jsdom always has window; simulate the guard by hiding the global.
    const originalWindow = globalThis.window;
    // @ts-expect-error test-only deletion of a global the guard checks
    delete globalThis.window;
    try {
      startStorageMonitor();
      expect(isStorageMonitorActive()).toBe(false);
    } finally {
      globalThis.window = originalWindow;
    }
  });
});
