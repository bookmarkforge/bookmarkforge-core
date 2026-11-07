import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockImporter = vi.fn().mockResolvedValue({ default: "module" });

describe("dynamicImport", () => {
  let dynamicImport: typeof import("../../utils/dynamicImport").dynamicImport;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../../utils/dynamicImport");
    dynamicImport = mod.dynamicImport;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("imports a module and caches it", async () => {
    const result = await dynamicImport(mockImporter, "mod1");
    expect(result).toEqual({ default: "module" });
    expect(mockImporter).toHaveBeenCalledTimes(1);
  });

  it("returns cached module on subsequent calls", async () => {
    const a = await dynamicImport(mockImporter, "mod-cached");
    const b = await dynamicImport(mockImporter, "mod-cached");
    expect(a).toBe(b);
    expect(mockImporter).toHaveBeenCalledTimes(1);
  });

  it("retries when the import fails", async () => {
    // Use retries=0 to avoid timers
    const failOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail once"))
      .mockResolvedValueOnce({ default: "ok" });
    const result = await dynamicImport(failOnce, "retry-once", {
      retries: 1,
      retryDelay: 1,
    });
    expect(result).toEqual({ default: "ok" });
    expect(failOnce).toHaveBeenCalledTimes(2);
  });

  it("throws error after retries are exhausted", async () => {
    const alwaysFail = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(
      dynamicImport(alwaysFail, "fail-mod", { retries: 1, retryDelay: 1 }),
    ).rejects.toThrow("always fails");
  });

  it("respects the import timeout", async () => {
    const start = Date.now();
    const slowImporter = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ default: "slow" }), 1000),
          ),
      );
    await expect(
      dynamicImport(slowImporter, "timeout-mod", { timeout: 50, retries: 0 }),
    ).rejects.toThrow("Import timeout: timeout-mod");
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("clears the timer after a fast import", async () => {
    vi.useFakeTimers();
    try {
      await expect(
        dynamicImport(
          vi.fn().mockResolvedValue({ default: "fast" }),
          "fast-timer-cleanup",
          { timeout: 1000, retries: 0 },
        ),
      ).resolves.toEqual({ default: "fast" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses default options when none are provided", async () => {
    const result = await dynamicImport(mockImporter, "default-options");
    expect(result).toEqual({ default: "module" });
  });

  it("clears the cache if the import fails", async () => {
    const failOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce({ default: "retry" });

    await expect(
      dynamicImport(failOnce, "clean-mod", { retries: 0 }),
    ).rejects.toThrow();

    const result = await dynamicImport(failOnce, "clean-mod", { retries: 0 });
    expect(result).toEqual({ default: "retry" });
    expect(failOnce).toHaveBeenCalledTimes(2);
  });
});
