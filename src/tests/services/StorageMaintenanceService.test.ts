import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { clearAICache } from "../../services/StorageMaintenanceService";

describe("StorageMaintenanceService", () => {
  const originalCaches = globalThis.caches;
  const originalIndexedDB = globalThis.indexedDB;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: originalCaches,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: originalIndexedDB,
    });
  });

  it("deletes only AI-related caches and reports their byte totals", async () => {
    const matchingCache = {
      keys: vi.fn().mockResolvedValue([new Request("https://local/model")]),
      match: vi.fn().mockResolvedValue(new Response(new Blob(["12345"]))),
    };
    const unrelatedCache = {
      keys: vi.fn().mockResolvedValue([]),
      match: vi.fn(),
    };
    const cacheMap = new Map([
      ["webllm-cache", matchingCache],
      ["application-cache", unrelatedCache],
    ]);
    const cachesMock = {
      keys: vi.fn().mockResolvedValue([...cacheMap.keys()]),
      open: vi.fn((name: string) => Promise.resolve(cacheMap.get(name))),
      delete: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: cachesMock,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {},
    });

    await expect(clearAICache()).resolves.toEqual({
      bytesFreed: 13,
      cacheEntriesDeleted: 1,
      idbDatabasesDeleted: 0,
    });
    expect(cachesMock.delete).toHaveBeenCalledWith("webllm-cache");
    expect(cachesMock.delete).not.toHaveBeenCalledWith("application-cache");
  });

  it("deletes WebLLM databases when the databases API is available", async () => {
    const deleteDatabase = vi.fn();
    const cachesMock = {
      keys: vi.fn().mockResolvedValue([]),
      open: vi.fn(),
      delete: vi.fn(),
    };
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: cachesMock,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        databases: vi.fn().mockResolvedValue([
          { name: "webllm-model-cache" },
          { name: "bookmarkforge" },
          { name: undefined },
        ]),
        deleteDatabase,
      },
    });

    await expect(clearAICache()).resolves.toEqual({
      bytesFreed: 0,
      cacheEntriesDeleted: 0,
      idbDatabasesDeleted: 1,
    });
    expect(deleteDatabase).toHaveBeenCalledWith("webllm-model-cache");
  });

  it("propagates cache enumeration failures instead of reporting success", async () => {
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: {
        keys: vi.fn().mockRejectedValue(new Error("cache unavailable")),
      },
    });
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {},
    });

    await expect(clearAICache()).rejects.toThrow("cache unavailable");
  });
});
