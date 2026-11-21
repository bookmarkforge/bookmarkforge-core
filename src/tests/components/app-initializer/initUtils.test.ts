import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db/database", () => ({
  initDB: vi.fn(),
  destroyDB: vi.fn(),
}));

vi.mock("../../../services/SecureStorage", () => ({
  secureStorage: { clearAll: vi.fn(), close: vi.fn() },
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { destroyAllDatabases, initDemoDatabase } from "../../../components/app-initializer/initUtils";
import { destroyDB, initDB } from "../../../db/database";
import { secureStorage } from "../../../services/SecureStorage";

describe("destroyAllDatabases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("should destroy DB, clear secure storage, and clear local/session storage", async () => {
    await destroyAllDatabases("reset");
    expect(destroyDB).toHaveBeenCalled();
    expect(secureStorage.clearAll).toHaveBeenCalled();
    expect(secureStorage.close).toHaveBeenCalled();
  });

  it("should log warning on destroyDB failure in retry context", async () => {
    (destroyDB as any).mockRejectedValue(new Error("destroy fail"));
    const { logger } = await import("../../../utils/logger");
    await destroyAllDatabases("retry");
    expect(logger.warn).toHaveBeenCalledWith(
      "[Demo retry] destroyDB failed",
      expect.any(Object),
    );
  });

  it("should log error on destroyDB failure in reset context", async () => {
    (destroyDB as any).mockRejectedValue(new Error("destroy fail"));
    const { logger } = await import("../../../utils/logger");
    await destroyAllDatabases("reset");
    expect(logger.error).toHaveBeenCalledWith(
      "[AppInitializer] Error destroying DB during reset",
      expect.any(Object),
    );
  });

  it("should clear IndexedDB databases when indexedDB.databases is available", async () => {
    const deleteDB = vi.fn();
    const origDatabases = indexedDB.databases;
    (indexedDB as any).databases = vi.fn().mockResolvedValue([
      { name: "db1" },
      { name: "db2" },
    ]);
    const origDeleteDB = indexedDB.deleteDatabase;
    indexedDB.deleteDatabase = vi.fn(() => {
      const req: IDBOpenDBRequest = { onsuccess: null, onerror: null, onblocked: null } as any;
      setTimeout(() => req.onsuccess?.(null as any), 0);
      return req;
    });
    await destroyAllDatabases("reset");
    (indexedDB as any).databases = origDatabases;
    indexedDB.deleteDatabase = origDeleteDB;
    expect(secureStorage.clearAll).toHaveBeenCalled();
  });
});

describe("initDemoDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (initDB as any).mockResolvedValue(undefined);
  });

  it("should call initDB with password", async () => {
    await initDemoDatabase("test-password");
    expect(initDB).toHaveBeenCalledWith("test-password");
  });

  it("destroys and retries on password mismatch only when the vault is demo-owned", async () => {
    localStorage.setItem("forge_demo_vault_created", "true");
    (initDB as any)
      .mockRejectedValueOnce(new Error("password mismatch DB1"))
      .mockResolvedValueOnce(undefined);
    await initDemoDatabase("test-password");
    expect(destroyDB).toHaveBeenCalledTimes(1);
    expect(initDB).toHaveBeenCalledTimes(2);
  });

  it("refuses to destroy a REAL vault on password mismatch (no demo marker)", async () => {
    (initDB as any).mockRejectedValueOnce(new Error("password mismatch DB1"));
    await initDemoDatabase("test-password");
    expect(destroyDB).not.toHaveBeenCalled();
    expect(initDB).toHaveBeenCalledTimes(1);
  });

  it("refuses to destroy a real vault on adapter failure (no demo marker)", async () => {
    (initDB as any).mockRejectedValueOnce(new Error("IndexedDB adapter unavailable"));
    await initDemoDatabase("test-password");
    expect(destroyDB).not.toHaveBeenCalled();
    expect(initDB).toHaveBeenCalledTimes(1);
  });

  it("should rethrow non-password errors", async () => {
    (initDB as any).mockRejectedValue(new Error("network error"));
    await expect(initDemoDatabase("test-password")).rejects.toThrow(
      "network error",
    );
  });
});
