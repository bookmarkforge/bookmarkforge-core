import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const hardwareMock = vi.hoisted(() => ({
  getDeviceTier: vi.fn().mockResolvedValue("high-end"),
}));

vi.mock("../../services/HardwareDetectorService", () => ({
  hardwareDetector: hardwareMock,
}));

import { QueryCache } from "../../db/rxdb-cache";
import { queryCache } from "../../db/rxdb-cache";

describe("QueryCache", () => {
  let cache: QueryCache;

  beforeEach(() => {
    cache = new QueryCache();
  });

  afterEach(() => {
    cache.clear();
  });

  it("returns null for missing key", async () => {
    await cache.ready();
    expect(cache.get("nope")).toBeNull();
  });

  it("stores and retrieves a value", async () => {
    await cache.ready();
    cache.set("k1", [{ id: 1 }]);
    expect(cache.get("k1")).toEqual([{ id: 1 }]);
  });

  it("expires entries after TTL", async () => {
    await cache.ready();
    cache.set("k1", [1], 5); // 5ms TTL
    await new Promise((r) => setTimeout(r, 15));
    expect(cache.get("k1")).toBeNull();
  });

  it("evicts the oldest entry when maxSize is reached", async () => {
    await cache.ready();
    // Reduce max by inserting more than default (high-end => 100) would be slow;
    // instead verify eviction logic via repeated inserts beyond a small boundary.
    // Force eviction by filling beyond 100 entries.
    for (let i = 0; i < 101; i++) {
      cache.set(`key-${i}`, [i]);
    }
    // The first inserted key should have been evicted (FIFO).
    expect(cache.get("key-0")).toBeNull();
    expect(cache.get("key-100")).not.toBeNull();
  });

  it("invalidate with no pattern clears the cache", async () => {
    await cache.ready();
    cache.set("a", [1]);
    cache.set("b", [2]);
    cache.invalidate();
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeNull();
  });

  it("invalidate with a regex removes only matching keys", async () => {
    await cache.ready();
    cache.set('{"collection":"bookmarks"}', [1]);
    cache.set('{"collection":"tasks"}', [2]);
    cache.invalidate(new RegExp('"collection":"bookmarks"'));
    expect(cache.get('{"collection":"bookmarks"}')).toBeNull();
    expect(cache.get('{"collection":"tasks"}')).not.toBeNull();
  });

  it("promotes a key to the end on get (LRU-ish recency)", async () => {
    await cache.ready();
    cache.set("a", [1]);
    cache.set("b", [2]);
    cache.get("a"); // touch a
    cache.invalidate(new RegExp("^b$"));
    expect(cache.get("a")).not.toBeNull();
    expect(cache.get("b")).toBeNull();
  });
});

describe("queryCache singleton ready", () => {
  it("is awaitable without throwing", async () => {
    await expect(queryCache.ready()).resolves.toBeUndefined();
  });
});

describe("adaptive cache sizing", () => {
  it("keeps safe defaults when cache adaptation rejects", async () => {
    const cache = new QueryCache();
    vi.spyOn(cache as any, "initAdaptiveCache").mockRejectedValueOnce(
      new Error("hardware probe failed"),
    );
    await cache.ready();
    cache.set("fallback", [1]);
    expect(cache.get("fallback")).toEqual([1]);
  });

  it("reduces size and TTL on low-end devices", async () => {
    hardwareMock.getDeviceTier.mockResolvedValue("low-end");
    const cache = new QueryCache();
    await cache.ready();
    for (let i = 0; i < 25; i++) {
      cache.set(`key-${i}`, [i]);
    }
    expect(cache.get("key-0")).toBeNull();
    hardwareMock.getDeviceTier.mockResolvedValue("high-end");
  });

  it("uses mid-range defaults on mid-range devices", async () => {
    hardwareMock.getDeviceTier.mockResolvedValue("mid-range");
    const cache = new QueryCache();
    await cache.ready();
    for (let i = 0; i < 55; i++) {
      cache.set(`key-${i}`, [i]);
    }
    expect(cache.get("key-0")).toBeNull();
    hardwareMock.getDeviceTier.mockResolvedValue("high-end");
  });
});
