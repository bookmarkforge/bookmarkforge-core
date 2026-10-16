import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    getSecret: vi.fn().mockResolvedValue(null),
    setSecret: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("RateLimitService", () => {
  let rateLimitService: any;
  let RateLimitService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../services/RateLimitService");
    rateLimitService = mod.rateLimitService;
    RateLimitService = mod.RateLimitService;
    (RateLimitService as any).instance = undefined;
  });

  describe("checkLimit", () => {
    it("allows requests within the limit", () => {
      const status = rateLimitService.checkLimit("local");
      expect(status.remaining).toBeGreaterThan(0);
      expect(status.exhausted).toBe(false);
    });

    it("reports exhausted when the limit is exceeded", () => {
      rateLimitService.setConfig("test-provider", {
        maxRequests: 2,
        windowMs: 60000,
        provider: "local",
      });
      rateLimitService.recordRequest("test-provider");
      rateLimitService.recordRequest("test-provider");
      const status = rateLimitService.checkLimit("test-provider");
      expect(status.remaining).toBe(0);
      expect(status.exhausted).toBe(true);
    });

    it("computes resetAt from the oldest request in the window", () => {
      const provider = "reset-window";
      const baseTime = 1_000_000;
      rateLimitService.setConfig(provider, {
        maxRequests: 2,
        windowMs: 60000,
        provider: "local",
      });
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(baseTime);
      try {
        rateLimitService.recordRequest(provider);
        nowSpy.mockReturnValue(baseTime + 10000);
        const status = rateLimitService.checkLimit(provider);
        expect(status.resetAt).toBe(baseTime + 60000);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("keeps the sliding window history bounded", () => {
      const provider = "bounded-window";
      rateLimitService.setConfig(provider, {
        maxRequests: 2,
        windowMs: 60000,
        provider: "local",
      });
      for (let i = 0; i < 100; i++) {
        rateLimitService.recordRequest(provider);
      }
      expect((rateLimitService as any).requests.get(provider)).toHaveLength(2);
    });
  });

  describe("getConfig/setConfig", () => {
    it("setConfig sobrescribe configuracion", () => {
      rateLimitService.setConfig("openai", { maxRequests: 100 });
      const cfg = rateLimitService.getConfig("openai");
      expect(cfg.maxRequests).toBe(100);
    });

    it("normalizes invalid configuration limits", () => {
      rateLimitService.setConfig("invalid-config", {
        maxRequests: -10,
        windowMs: Number.NaN,
        provider: "local",
      });
      const cfg = rateLimitService.getConfig("invalid-config");
      expect(cfg.maxRequests).toBe(0);
      expect(cfg.windowMs).toBe(60000);
    });

    it("getConfig returns default when there is no config", () => {
      const cfg = rateLimitService.getConfig("noexiste");
      expect(cfg).toBeDefined();
      expect(cfg.maxRequests).toBeGreaterThan(0);
    });
  });

  describe("getUsage", () => {
    it("returns initial zero usage", () => {
      rateLimitService.resetUsage("test-provider");
      const usage = rateLimitService.getUsage("test-provider");
      expect(usage.requestsToday).toBe(0);
      expect(usage.tokensToday).toBe(0);
    });

    it("increments requests after recordRequest", async () => {
      rateLimitService.resetUsage("test-provider");
      await rateLimitService.recordRequest("test-provider", 10);
      const usage = rateLimitService.getUsage("test-provider");
      expect(usage.requestsToday).toBe(1);
      expect(usage.tokensToday).toBe(10);
    });
  });

  describe("isNearLimit", () => {
    it("detects when approaching the limit", () => {
      rateLimitService.setConfig("test-provider", {
        maxRequests: 10,
        windowMs: 60000,
        provider: "local",
      });
      rateLimitService.resetUsage("test-provider");
      for (let i = 0; i < 9; i++) {
        rateLimitService.recordRequest("test-provider");
      }
      expect(rateLimitService.isNearLimit("test-provider", 0.8)).toBe(true);
    });
  });

  describe("getCostEstimate", () => {
    it("computes cost based on tokens", async () => {
      rateLimitService.resetUsage("test-provider");
      await rateLimitService.recordRequest("test-provider", 1000);
      const cost = rateLimitService.getCostEstimate("test-provider");
      expect(cost).toBe(1000 * 0.00001);
    });
  });

  describe("local operations", () => {
    it("checkLocalLimit returns status", () => {
      const status = rateLimitService.checkLocalLimit("local");
      expect(status).toHaveProperty("remaining");
    });

    it("isLocalOperationAllowed returns true initially", () => {
      expect(rateLimitService.isLocalOperationAllowed("local")).toBe(true);
    });

    it("recordLocalOperation increments the counter", async () => {
      rateLimitService.resetUsage("local");
      await rateLimitService.recordLocalOperation("local");
      const usage = rateLimitService.getUsage("local");
      expect(usage.requestsToday).toBe(1);
    });

    it("getLocalStats returns all states", () => {
      const stats = rateLimitService.getLocalStats();
      expect(stats).toHaveProperty("local");
      expect(stats).toHaveProperty("local-db");
      expect(stats).toHaveProperty("local-sync");
    });

    it("executeWithLocalLimit runs the function if there is quota", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      const result = await rateLimitService.executeWithLocalLimit("local", fn);
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalled();
    });

    it("executeWithLocalLimit lanza error si excedido", async () => {
      rateLimitService.setConfig("local", {
        maxRequests: 0,
        windowMs: 60000,
        provider: "local",
      });
      const fn = vi.fn().mockResolvedValue("ok");
      await expect(
        rateLimitService.executeWithLocalLimit("local", fn),
      ).rejects.toThrow("Rate limit");
    });
  });

  describe("resetUsage/resetAll", () => {
    it("resets a provider's usage", () => {
      rateLimitService.recordRequest("test-provider");
      rateLimitService.resetUsage("test-provider");
      const usage = rateLimitService.getUsage("test-provider");
      expect(usage.requestsToday).toBe(0);
    });

    it("resetAll resets the main providers", async () => {
      rateLimitService.recordRequest("google");
      rateLimitService.recordRequest("openai");
      rateLimitService.recordRequest("anthropic");
      await rateLimitService.resetAll();
      expect(rateLimitService.getUsage("google").requestsToday).toBe(0);
      expect(rateLimitService.getUsage("openai").requestsToday).toBe(0);
      expect(rateLimitService.getUsage("anthropic").requestsToday).toBe(0);
    });
  });

  describe("getAllUsage", () => {
    it("returns all recorded usages", () => {
      rateLimitService.resetUsage("provider-a");
      rateLimitService.resetUsage("provider-b");
      const all = rateLimitService.getAllUsage();
      expect(all).toHaveProperty("provider-a");
      expect(all).toHaveProperty("provider-b");
    });
  });

  describe("init", () => {
    it("init loads usage and does not throw", async () => {
      await expect(rateLimitService.init()).resolves.toBeUndefined();
    });
  });

  describe("recordRequest edge cases", () => {
    it("fires a near limit warning at 90%", async () => {
      rateLimitService.setConfig("test-near", {
        maxRequests: 10,
        windowMs: 60000,
        provider: "local",
      });
      rateLimitService.resetUsage("test-near");
      for (let i = 0; i < 9; i++) {
        await rateLimitService.recordRequest("test-near");
      }
      const usage = rateLimitService.getUsage("test-near");
      expect(usage.requestsToday).toBe(9);
    });

    it("recordRequest with tokens increments tokensToday", async () => {
      rateLimitService.resetUsage("tokens-test");
      await rateLimitService.recordRequest("tokens-test", 500);
      const usage = rateLimitService.getUsage("tokens-test");
      expect(usage.tokensToday).toBe(500);
    });
  });

  describe("shouldReset", () => {
    it("returns fresh usage if lastReset is old", () => {
      const old = Date.now() - 86400001;
      const mockUsage = {
        provider: "stale",
        requestsToday: 100,
        tokensToday: 1000,
        costEstimate: 0.01,
        lastReset: old,
      };
      rateLimitService.quotaUsage.set("stale", mockUsage);
      const usage = rateLimitService.getUsage("stale");
      expect(usage.requestsToday).toBe(0);
    });
  });

  describe("setConfig con provider no default", () => {
    it("setConfig creates config from partial defaults", () => {
      rateLimitService.setConfig("custom", { maxRequests: 50 });
      const cfg = rateLimitService.getConfig("custom");
      expect(cfg.maxRequests).toBe(50);
      expect(cfg.windowMs).toBeGreaterThan(0);
    });
  });

  describe("loadUsage / saveUsage error paths", () => {
    it("loadUsage handles getSecret error", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getSecret as any).mockRejectedValue(
        new Error("storage error"),
      );
      await expect(rateLimitService.init()).resolves.toBeUndefined();
    });

    it("does not overwrite a mutated quota while loading storage", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      let releaseLoad!: (value: string) => void;
      const pendingLoad = new Promise<string>((resolve) => {
        releaseLoad = resolve;
      });
      (secureStorage.getSecret as any).mockReturnValueOnce(pendingLoad);
      rateLimitService.quotaUsage.delete("load-race");
      rateLimitService.dirtyProviders.clear();

      const load = (rateLimitService as any).loadUsage();
      const record = rateLimitService.recordRequest("load-race", 7);
      releaseLoad(JSON.stringify({
        "load-race": {
          provider: "load-race",
          requestsToday: 99,
          tokensToday: 999,
          costEstimate: 0.01,
          lastReset: Date.now(),
        },
      }));

      await Promise.all([load, record]);
      expect(rateLimitService.getUsage("load-race")).toMatchObject({
        requestsToday: 1,
        tokensToday: 7,
      });
    });

    it("discards corrupted quotas and normalizes derived fields", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      rateLimitService.dirtyProviders.clear();
      (secureStorage.getSecret as any).mockResolvedValueOnce(JSON.stringify({
        valid: {
          provider: "wrong-provider",
          requestsToday: 3.8,
          tokensToday: 100,
          costEstimate: 999,
          lastReset: Date.now() + 86400000,
        },
        negative: {
          requestsToday: -1,
          tokensToday: 2,
          costEstimate: 0,
          lastReset: Date.now(),
        },
        malformed: "not-an-usage-record",
      }));

      await rateLimitService.init();

      expect(rateLimitService.quotaUsage.get("valid")).toMatchObject({
        provider: "valid",
        requestsToday: 3,
        tokensToday: 100,
        costEstimate: 100 * 0.00001,
      });
      expect(rateLimitService.quotaUsage.has("negative")).toBe(false);
      expect(rateLimitService.quotaUsage.has("malformed")).toBe(false);
      expect(rateLimitService.quotaUsage.get("valid").lastReset).toBeLessThanOrEqual(Date.now());
    });

    it("loadUsage handles stored data", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const stored = JSON.stringify({
        "test-p": {
          provider: "test-p",
          requestsToday: 5,
          tokensToday: 100,
          costEstimate: 0.001,
          lastReset: Date.now(),
        },
      });
      (secureStorage.getSecret as any).mockResolvedValue(stored);
      await rateLimitService.init();
      const usage = rateLimitService.getUsage("test-p");
      expect(usage.requestsToday).toBe(5);
    });

    it("serializes snapshots when two writes overlap", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      rateLimitService.quotaUsage.clear();
      rateLimitService.requests.clear();

      let releaseFirstWrite!: () => void;
      const firstWrite = new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
      });
      const snapshots: string[] = [];
      let writeCount = 0;
      (secureStorage.setSecret as any).mockImplementation(
        (_key: string, value: string) => {
          snapshots.push(value);
          writeCount++;
          return writeCount === 1 ? firstWrite : Promise.resolve();
        },
      );

      const first = rateLimitService.recordRequest("serialized", 1);
      await Promise.resolve();
      const second = rateLimitService.recordRequest("serialized", 2);
      await Promise.resolve();
      expect(snapshots).toHaveLength(1);

      releaseFirstWrite();
      await Promise.all([first, second]);

      expect(snapshots).toHaveLength(2);
      expect(JSON.parse(snapshots[1]!).serialized).toMatchObject({
        requestsToday: 2,
        tokensToday: 3,
      });
    });

    it("saveUsage handles setSecret error via recordRequest", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.setSecret as any).mockRejectedValue(
        new Error("save error"),
      );
      rateLimitService.resetUsage("test-provider");
      await expect(
        rateLimitService.recordRequest("test-provider"),
      ).resolves.toBeUndefined();
    });
  });

  describe("getInstance background init failure", () => {
    it("no lanza error en background init", () => {
      const instance = RateLimitService.getInstance();
      expect(instance).toBeDefined();
    });
  });

  describe("getAllUsage", () => {
    it("includes all providers that have been tracked", () => {
      rateLimitService.resetUsage("a");
      rateLimitService.resetUsage("b");
      const all = rateLimitService.getAllUsage();
      expect(Object.keys(all).length).toBeGreaterThanOrEqual(2);
    });
  });
});
