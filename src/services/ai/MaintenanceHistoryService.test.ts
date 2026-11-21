import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock("../../../src/store/safeStorage", () => ({
  safeGet: (key: string) => storage.get(key) ?? null,
  safeSet: (key: string, value: string) => storage.set(key, value),
}));
vi.mock("../../../src/services/SecurityVault", () => ({
  securityVault: {
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

describe("MaintenanceHistoryService", () => {
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
  });

  it("keeps at most 25 metadata entries", async () => {
    const { maintenanceHistoryService } = await import("../../../src/services/ai/MaintenanceHistoryService");
    for (let i = 0; i < 30; i += 1) {
      maintenanceHistoryService.add({
        completedAt: new Date(2026, 0, i + 1).toISOString(),
        status: "completed",
        repaired: i,
        failed: 0,
        skipped: 0,
        operations: ["index-rebuild"],
      });
    }
    expect(maintenanceHistoryService.list()).toHaveLength(25);
  });

  it("rejects malformed and content-bearing entries", async () => {
    storage.set("forge_intelligent_maintenance_history", JSON.stringify([
      { id: "ok", completedAt: "2026-01-01", status: "completed", repaired: 1, failed: 0, skipped: 0, operations: ["pending-processing"] },
      { id: "bad", completedAt: "2026-01-01", status: "bad", repaired: 1, failed: 0, skipped: 0, operations: [], title: "secret" },
    ]));
    const { maintenanceHistoryService } = await import("../../../src/services/ai/MaintenanceHistoryService");
    expect(maintenanceHistoryService.list()).toHaveLength(1);
    expect(JSON.stringify(maintenanceHistoryService.list())).not.toContain("secret");
  });
});
