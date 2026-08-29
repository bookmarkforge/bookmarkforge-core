import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { AIRequestCache } =
  await import("../../\.\./services/ai/AIRequestCache");
const { logger } = await import("../../../utils/logger");

describe("AIRequestCache", () => {
  let cache: InstanceType<typeof AIRequestCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    cache = new AIRequestCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("get y set", () => {
    it("returns null for an uncached prompt", () => {
      const result = cache.get("nonexistent prompt");
      expect(result).toBeNull();
    });

    it("returns cached response if within TTL", () => {
      const response = { text: "hello", provider: "gemini" as const };
      cache.set("test prompt", response);
      const result = cache.get("test prompt");
      expect(result).toEqual(response);
    });

    it("does not expose prompts or system prompts in diagnostic logs", () => {
      cache.set("secret vault prompt", { text: "answer", provider: "gemini" }, "private system prompt");
      cache.get("secret vault prompt", "private system prompt");

      const debugCalls = vi.mocked(logger.debug).mock.calls;
      expect(JSON.stringify(debugCalls)).not.toContain("secret vault prompt");
      expect(JSON.stringify(debugCalls)).not.toContain("private system prompt");
    });

    it("returns null if the cache expired (5 min)", () => {
      cache.set("test", { text: "cached", provider: "gemini" });
      vi.advanceTimersByTime(300_001); // 5 min + 1ms
      const result = cache.get("test");
      expect(result).toBeNull();
    });

    it("prunes expired entries before inserting a new response", () => {
      cache.set("expired", { text: "old", provider: "gemini" });
      vi.advanceTimersByTime(300_000);

      cache.set("fresh", { text: "new", provider: "gemini" });

      expect(cache.get("expired")).toBeNull();
      expect(cache.getStats().size).toBe(1);
    });

    it("distinguishes between different system prompts", () => {
      cache.set("prompt", { text: "r1", provider: "gemini" }, "sys1");
      cache.set("prompt", { text: "r2", provider: "gemini" }, "sys2");
      const r1 = cache.get("prompt", "sys1");
      const r2 = cache.get("prompt", "sys2");
      expect(r1?.text).toBe("r1");
      expect(r2?.text).toBe("r2");
    });

    it("distinguishes between different models", () => {
      cache.set("prompt", { text: "r1", provider: "gemini" }, undefined, {
        model: "model-a",
      });
      cache.set("prompt", { text: "r2", provider: "gemini" }, undefined, {
        model: "model-b",
      });
      const r1 = cache.get("prompt", undefined, { model: "model-a" });
      const r2 = cache.get("prompt", undefined, { model: "model-b" });
      expect(r1?.text).toBe("r1");
      expect(r2?.text).toBe("r2");
    });
  });

  describe("clear", () => {
    it("clears all entries", () => {
      cache.set("a", { text: "1", provider: "gemini" });
      cache.set("b", { text: "2", provider: "gemini" });
      cache.clear();
      expect(cache.get("a")).toBeNull();
      expect(cache.get("b")).toBeNull();
    });

    it("stats reflect empty cache after clear", () => {
      cache.set("a", { text: "1", provider: "gemini" });
      cache.clear();
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("evictOldest", () => {
    it("evicts oldest entry when MAX_CACHE_SIZE is exceeded", () => {
      for (let i = 0; i < 101; i++) {
        cache.set(`prompt-${i}`, { text: `res-${i}`, provider: "gemini" });
      }
      const stats = cache.getStats();
      expect(stats.size).toBeLessThanOrEqual(100);
      // The first element should have been removed
      expect(cache.get("prompt-0")).toBeNull();
    });

    it("updating an existing key does not evict another response", () => {
      for (let i = 0; i < 100; i++) {
        cache.set(`prompt-${i}`, { text: `res-${i}`, provider: "gemini" });
      }
      vi.advanceTimersByTime(1);
      cache.set("prompt-0", { text: "updated", provider: "gemini" });
      cache.set("prompt-new", { text: "new", provider: "gemini" });

      expect(cache.get("prompt-0")?.text).toBe("updated");
      expect(cache.get("prompt-1")).toBeNull();
      expect(cache.getStats().size).toBe(100);
    });
  });

  describe("getStats", () => {
    it("returns correct stats", () => {
      const stats = cache.getStats();
      expect(stats.maxSize).toBe(100);
      expect(stats.ttl).toBe(300000);
      expect(stats.size).toBe(0);
    });

    it("reflects the current size", () => {
      cache.set("a", { text: "1", provider: "gemini" });
      expect(cache.getStats().size).toBe(1);
    });
  });

  describe("key generation", () => {
    it("produces the same key for the same parameters", () => {
      cache.set("hello", { text: "world", provider: "gemini" }, "sys", {
        model: "m",
      });
      const result = cache.get("hello", "sys", { model: "m" });
      expect(result?.text).toBe("world");
    });

    it("case-sensitive en prompt", () => {
      cache.set("Hello", { text: "world", provider: "gemini" });
      expect(cache.get("hello")).toBeNull();
    });

    it("distinguishes between providers in the key (audit #4)", () => {
      cache.set(
        "prompt",
        { text: "gemini answer", provider: "gemini" },
        undefined,
        { provider: "gemini" },
      );
      cache.set(
        "prompt",
        { text: "ollama answer", provider: "ollama" },
        undefined,
        { provider: "ollama" },
      );

      const gem = cache.get("prompt", undefined, { provider: "gemini" });
      const oll = cache.get("prompt", undefined, { provider: "ollama" });
      expect(gem?.text).toBe("gemini answer");
      expect(oll?.text).toBe("ollama answer");
    });

    it("refuses to cache private content (audit #4)", () => {
      cache.set(
        "prompt",
        { text: "public", provider: "gemini" },
        undefined,
        { provider: "gemini", isPrivate: false },
      );
      cache.set(
        "prompt",
        { text: "private", provider: "gemini" },
        undefined,
        { provider: "gemini", isPrivate: true },
      );

      expect(
        cache.get("prompt", undefined, { provider: "gemini", isPrivate: false })
          ?.text,
      ).toBe("public");
      expect(
        cache.get("prompt", undefined, { provider: "gemini", isPrivate: true }),
      ).toBeNull();
    });
  });
});
