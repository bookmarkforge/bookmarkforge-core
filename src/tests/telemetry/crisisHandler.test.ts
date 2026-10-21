import { afterEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn().mockResolvedValue(undefined);
const setupGlobalErrorHandler = vi.fn(() => vi.fn());
const initProductionMonitor = vi.fn();
const stopProductionMonitor = vi.fn();
vi.mock("../../telemetry/errorReporter", () => ({
  setupGlobalErrorHandler,
  errorReporter: { reportError, dispose: vi.fn() },
}));
vi.mock("../../telemetry/productionMonitor", () => ({
  initProductionMonitor,
  stopProductionMonitor,
}));
describe("crisisHandler", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("initializes monitoring, reports locally, and disposes idempotently", async () => {
    vi.resetModules();
    const { initCrisisHandler } = await import("../../telemetry/crisisHandler");
    const cleanup = initCrisisHandler();

    expect(setupGlobalErrorHandler).toHaveBeenCalledOnce();
    expect(initProductionMonitor).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      { source: "crisisHandler", critical: "true" },
    );

    cleanup();
    cleanup();
    expect(stopProductionMonitor).toHaveBeenCalledOnce();
  });

  it("returns a no-op when initialized after disposal", async () => {
    vi.resetModules();
    const { initCrisisHandler } = await import("../../telemetry/crisisHandler");
    const cleanup = initCrisisHandler();
    cleanup();
    const secondCleanup = initCrisisHandler();
    expect(secondCleanup).toBeTypeOf("function");
    secondCleanup();
    expect(setupGlobalErrorHandler).toHaveBeenCalledOnce();
  });
});
