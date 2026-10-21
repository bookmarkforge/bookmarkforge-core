import { describe, it, expect, beforeEach, vi } from "vitest";
import { RateLimitService } from "../RateLimitService";
import { logger } from "../../utils/logger";

describe("RateLimitService", () => {
  let service: RateLimitService;

  beforeEach(async () => {
    service = RateLimitService.getInstance();
    await service.resetAll();
    // Clear internal request tracking by creating a fresh instance
    (service as any).requests = new Map();
  });

  describe("checkLimit", () => {
    it("should allow requests within limit", () => {
      const status = service.checkLimit("google");
      expect(status.exhausted).toBe(false);
      expect(status.remaining).toBeGreaterThan(0);
    });

    it("should track used requests", async () => {
      await service.recordRequest("google", 100);
      const status = service.checkLimit("google");
      expect(status.used).toBe(1);
    });

    it("should exhaust after max requests", async () => {
      const config = service.getConfig("local");
      for (let i = 0; i < config.maxRequests + 10; i++) {
        await service.recordRequest("local");
      }
      const status = service.checkLimit("local");
      expect(status.exhausted).toBe(true);
      expect(status.remaining).toBe(0);
    });
  });

  describe("recordRequest", () => {
    it("should track token usage", async () => {
      await service.recordRequest("openai", 5000);
      const usage = service.getUsage("openai");
      expect(usage.tokensToday).toBe(5000);
      expect(usage.requestsToday).toBe(1);
    });

    it("should estimate cost", async () => {
      await service.recordRequest("openai", 100000);
      const cost = service.getCostEstimate("openai");
      expect(cost).toBeGreaterThan(0);
    });

    it("should warn near limit", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const config = service.getConfig("google");
      const nearLimit = Math.floor(config.maxRequests * 0.9);
      for (let i = 0; i < nearLimit; i++) {
        await service.recordRequest("google");
      }
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("isNearLimit", () => {
    it("should return false when usage is low", () => {
      expect(service.isNearLimit("google")).toBe(false);
    });

    it("should return true when near threshold", async () => {
      const config = service.getConfig("google");
      const threshold = Math.floor(config.maxRequests * 0.9);
      for (let i = 0; i < threshold; i++) {
        await service.recordRequest("google");
      }
      expect(service.isNearLimit("google")).toBe(true);
    });
  });

  describe("local operations", () => {
    it("should allow local operations within limit", () => {
      expect(service.isLocalOperationAllowed("local-db")).toBe(true);
    });

    it("should execute function when allowed", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      const result = await service.executeWithLocalLimit("local", fn);
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalled();
    });

    it("should throw when rate limited", async () => {
      const config = service.getConfig("local");
      for (let i = 0; i < config.maxRequests + 10; i++) {
        service.recordLocalOperation("local");
      }
      await expect(
        service.executeWithLocalLimit("local", async () => "ok"),
      ).rejects.toThrow("Rate limit exceeded");
    });

    it("should return local stats", () => {
      const stats = service.getLocalStats();
      expect(stats.local).toBeDefined();
      expect(stats["local-db"]).toBeDefined();
      expect(stats["local-sync"]).toBeDefined();
    });
  });

  describe("getAllUsage", () => {
    it("should return usage for all providers", async () => {
      await service.recordRequest("google", 100);
      await service.recordRequest("openai", 200);
      const all = service.getAllUsage();
      expect(all.google).toBeDefined();
      expect(all.openai).toBeDefined();
    });
  });

  describe("resetUsage", () => {
    it("should reset provider usage", async () => {
      await service.recordRequest("google", 100);
      service.resetUsage("google");
      const usage = service.getUsage("google");
      expect(usage.requestsToday).toBe(0);
    });
  });

  describe("setConfig", () => {
    it("should allow custom config", () => {
      service.setConfig("custom", {
        maxRequests: 50,
        windowMs: 30000,
        provider: "google",
      });
      const config = service.getConfig("custom");
      expect(config.maxRequests).toBe(50);
    });
  });
});
