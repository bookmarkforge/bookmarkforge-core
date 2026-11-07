import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  locked: vi.fn(() => false),
  run: vi.fn(),
  add: vi.fn(),
  list: vi.fn(() => []),
  safeGet: vi.fn(() => "false"),
  safeSet: vi.fn(),
}));

vi.mock("../../../src/services/SecurityVault", () => ({
  securityVault: {
    isLocked: mocks.locked,
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));
vi.mock("../../../src/services/ai/SafeRepairCoordinator", () => ({
  safeRepairCoordinator: {
    run: mocks.run,
    getStatus: vi.fn(() => ({ isRunning: false, lastRunAt: null, lastResult: null, consecutiveFailures: 0, pausedUntil: null })),
  },
}));
vi.mock("../../../src/services/ai/MaintenanceHistoryService", () => ({
  maintenanceHistoryService: { add: mocks.add, list: mocks.list, clear: vi.fn() },
}));
vi.mock("../../../src/store/safeStorage", () => ({ safeGet: mocks.safeGet, safeSet: mocks.safeSet }));

describe("IntelligentMaintenanceService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.safeGet.mockReturnValue("false");
    mocks.locked.mockReturnValue(false);
    mocks.run.mockResolvedValue({ status: "completed", repaired: 0, failed: 0, skipped: 0, operations: [], report: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not start automatically when disabled", async () => {
    const { intelligentMaintenanceService } = await import("../../../src/services/ai/IntelligentMaintenanceService");
    intelligentMaintenanceService.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("runs one bounded cycle after enabling and the startup delay", async () => {
    const { intelligentMaintenanceService } = await import("../../../src/services/ai/IntelligentMaintenanceService");
    intelligentMaintenanceService.setEnabled(true);
    await vi.advanceTimersByTimeAsync(26_000);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ maxItems: 5 }));
    expect(mocks.add).toHaveBeenCalledTimes(1);
  });

  it("does not run while the vault is locked", async () => {
    mocks.locked.mockReturnValue(true);
    const { intelligentMaintenanceService } = await import("../../../src/services/ai/IntelligentMaintenanceService");
    intelligentMaintenanceService.setEnabled(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
