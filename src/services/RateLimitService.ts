import { logger } from "../utils/logger";
import { formatDate } from "../utils/localization";
import { secureStorage } from "./SecureStorage";
import { safeParseJsonObject } from "../utils/safeJsonArray";
import i18n from "../i18n";

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  provider: "google" | "openai" | "anthropic" | "local";
}

interface RateLimitStatus {
  remaining: number;
  used: number;
  resetAt: number;
  exhausted: boolean;
}

export interface QuotaUsage {
  provider: string;
  requestsToday: number;
  tokensToday: number;
  costEstimate: number;
  lastReset: number;
}

const DEFAULT_CONFIG: Record<string, RateLimitConfig> = {
  google: { maxRequests: 1500, windowMs: 86400000, provider: "google" },
  openai: { maxRequests: 500, windowMs: 86400000, provider: "openai" },
  anthropic: { maxRequests: 1000, windowMs: 86400000, provider: "anthropic" },
  // Local API rate limiting - prevent abuse of local operations
  local: { maxRequests: 1000, windowMs: 60000, provider: "local" }, // 1000 requests per minute
  "local-db": { maxRequests: 500, windowMs: 60000, provider: "local" }, // 500 DB ops per minute
  "local-sync": { maxRequests: 100, windowMs: 60000, provider: "local" }, // 100 sync ops per minute
};

const QUOTA_STORAGE_KEY = "bmf_quota_usage";
const COST_PER_TOKEN = 0.00001;
// Keep sliding-window accounting bounded even if a caller records requests
// without checking the limit first (or many callers race concurrently).
const MAX_TRACKED_REQUESTS = 10_000;

function getTrackingLimit(maxRequests: number): number {
  if (!Number.isFinite(maxRequests)) {return MAX_TRACKED_REQUESTS;}
  return Math.min(Math.max(1, Math.floor(maxRequests)), MAX_TRACKED_REQUESTS);
}

function normalizeRateLimitConfig(
  provider: string,
  fallback: RateLimitConfig,
  config: Partial<RateLimitConfig>,
): RateLimitConfig {
  const maxRequests = config.maxRequests;
  const windowMs = config.windowMs;
  return {
    provider:
      config.provider ?? fallback.provider ?? (provider as RateLimitConfig["provider"]),
    maxRequests:
      typeof maxRequests === "number" && Number.isFinite(maxRequests)
        ? Math.max(0, Math.floor(maxRequests))
        : fallback.maxRequests,
    windowMs:
      typeof windowMs === "number" && Number.isFinite(windowMs) && windowMs > 0
        ? Math.floor(windowMs)
        : fallback.windowMs,
  };
}

class RateLimitService {
  private static instance: RateLimitService;
  private config: Record<string, RateLimitConfig>;
  private requests: Map<string, number[]>;
  private quotaUsage: Map<string, QuotaUsage>;
  // Providers mutated before the asynchronous bootstrap load completes must
  // not be overwritten by an older persisted snapshot.
  private readonly dirtyProviders = new Set<string>();
  // Serialize persistence so concurrent recordRequest/resetUsage calls cannot
  // finish out of order and leave secure storage with an older snapshot.
  private saveChain: Promise<void> = Promise.resolve();

  private constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.requests = new Map();
    this.quotaUsage = new Map();
  }

  /** Async initialization — call once after construction. */
  async init(): Promise<void> {
    await this.loadUsage();
    logger.info("[RateLimitService] Initialized");
  }

  static getInstance(): RateLimitService {
    if (!RateLimitService.instance) {
      RateLimitService.instance = new RateLimitService();
      // Fire-and-forget: load persisted usage in background
      RateLimitService.instance.init().catch((e: unknown) =>
        logger.error("[RateLimitService] Background init failed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
    return RateLimitService.instance;
  }

  setConfig(provider: string, config: Partial<RateLimitConfig>): void {
    const defaultCfg = DEFAULT_CONFIG[provider] ?? {
      maxRequests: 100,
      windowMs: 60000,
      provider: provider as "google" | "openai" | "anthropic",
    };
    this.config[provider] = normalizeRateLimitConfig(
      provider,
      defaultCfg,
      config,
    );
    logger.info("RateLimitService.setConfig", {
      provider,
      config: this.config[provider],
    });
  }

  getConfig(provider: string): RateLimitConfig {
    return (
      this.config[provider] ??
      DEFAULT_CONFIG[provider] ?? {
        maxRequests: 100,
        windowMs: 60000,
        provider: provider as "google" | "openai" | "anthropic",
      }
    );
  }

  checkLimit(provider: string): RateLimitStatus {
    const cfg = this.getConfig(provider);
    const now = Date.now();
    const windowStart = now - cfg.windowMs;

    let times = this.requests.get(provider) || [];
    times = times.filter((t) => t > windowStart);
    const trackingLimit = getTrackingLimit(cfg.maxRequests);
    if (times.length > trackingLimit) {
      times = times.slice(-trackingLimit);
    }
    this.requests.set(provider, times);

    const remaining = Math.max(0, cfg.maxRequests - times.length);

    return {
      remaining,
      used: times.length,
      // The next reset is when the oldest request leaves the sliding window,
      // not one full window from the instant the status was queried.
      resetAt: times[0] !== undefined ? times[0] + cfg.windowMs : now + cfg.windowMs,
      exhausted: remaining <= 0,
    };
  }

  async recordRequest(provider: string, tokens = 0): Promise<void> {
    const cfg = this.getConfig(provider);
    const now = Date.now();
    this.dirtyProviders.add(provider);

    // Prune entries outside the sliding window here as well, so the per-
    // provider array stays bounded even if a caller records without a
    // preceding checkLimit() (self-contained memory bound).
    const windowStart = now - cfg.windowMs;
    const times = (this.requests.get(provider) || []).filter(
      (t) => t > windowStart,
    );
    times.push(now);
    const trackingLimit = getTrackingLimit(cfg.maxRequests);
    if (times.length > trackingLimit) {
      times.splice(0, times.length - trackingLimit);
    }
    this.requests.set(provider, times);

    const usage = this.getUsage(provider);
    usage.requestsToday += 1;
    usage.tokensToday += tokens;
    usage.costEstimate = usage.tokensToday * COST_PER_TOKEN;
    await this.saveUsage();

    logger.info("RateLimitService.recordRequest", {
      provider,
      requests: usage.requestsToday,
      tokens: usage.tokensToday,
    });

    if (usage.requestsToday >= cfg.maxRequests * 0.9) {
      logger.warn("RateLimitService", {
        provider,
        warning: "Near quota limit",
        remaining: cfg.maxRequests - usage.requestsToday,
      });
    }
  }

  getUsage(provider: string): QuotaUsage {
    const now = Date.now();
    const usage = this.quotaUsage.get(provider);

    if (!usage || this.shouldReset(usage.lastReset)) {
      const fresh: QuotaUsage = {
        provider,
        requestsToday: 0,
        tokensToday: 0,
        costEstimate: 0,
        lastReset: now,
      };
      this.quotaUsage.set(provider, fresh);
      return fresh;
    }

    return usage;
  }

  private shouldReset(lastReset: number): boolean {
    const now = Date.now();
    const dayMs = 86400000;
    return now - lastReset >= dayMs;
  }

  private async loadUsage(): Promise<void> {
    try {
      const { value: data, parseFailed } = await secureStorage
        .getSecret(QUOTA_STORAGE_KEY)
        .then((raw) => safeParseJsonObject(raw));
      if (parseFailed) {
        logger.warn(
          "RateLimitService.loadUsage: stored blob is not a valid object",
        );
        return;
      }
      if (!data) {return;}
      const now = Date.now();
      Object.entries(data).forEach(([provider, usage]) => {
        if (this.dirtyProviders.has(provider)) {return;}
        const normalized = this.normalizeStoredUsage(provider, usage, now);
        if (normalized) {
          this.quotaUsage.set(provider, normalized);
        }
      });
    } catch (error) {
      logger.error("RateLimitService.loadUsage", {
        error: (error as Error).message,
      });
    }
  }

  private normalizeStoredUsage(
    provider: string,
    value: unknown,
    now: number,
  ): QuotaUsage | null {
    if (!value || typeof value !== "object") {return null;}
    const record = value as Record<string, unknown>;
    const requestsToday = record.requestsToday;
    const tokensToday = record.tokensToday;
    const lastReset = record.lastReset;
    if (
      typeof requestsToday !== "number" ||
      !Number.isFinite(requestsToday) ||
      requestsToday < 0 ||
      typeof tokensToday !== "number" ||
      !Number.isFinite(tokensToday) ||
      tokensToday < 0 ||
      typeof lastReset !== "number" ||
      !Number.isFinite(lastReset) ||
      lastReset < 0
    ) {
      return null;
    }

    return {
      provider,
      requestsToday: Math.floor(requestsToday),
      tokensToday,
      // Recompute derived data instead of trusting a stale or tampered value.
      costEstimate: tokensToday * COST_PER_TOKEN,
      // A future timestamp could suppress daily reset indefinitely.
      lastReset: Math.min(lastReset, now),
    };
  }

  private async saveUsage(): Promise<void> {
    const data: Record<string, QuotaUsage> = {};
    this.quotaUsage.forEach((usage, provider) => {
      data[provider] = { ...usage };
    });
    const write = async () => {
      try {
        await secureStorage.setSecret(QUOTA_STORAGE_KEY, JSON.stringify(data));
      } catch (error) {
        logger.error("RateLimitService.saveUsage", {
          error: (error as Error).message,
        });
      }
    };

    const next = this.saveChain.then(write, write);
    this.saveChain = next.catch(() => undefined);
    await next;
  }

  getAllUsage(): Record<string, QuotaUsage> {
    const result: Record<string, QuotaUsage> = {};
    this.quotaUsage.forEach((_usage, provider) => {
      result[provider] = this.getUsage(provider);
    });
    return result;
  }

  async resetUsage(provider: string): Promise<void> {
    this.dirtyProviders.add(provider);
    this.quotaUsage.set(provider, {
      provider,
      requestsToday: 0,
      tokensToday: 0,
      costEstimate: 0,
      lastReset: Date.now(),
    });
    await this.saveUsage();
    logger.info("RateLimitService.resetUsage", { provider });
  }

  async resetAll(): Promise<void> {
    for (const provider of ["google", "openai", "anthropic"]) {
      await this.resetUsage(provider);
    }
  }

  getCostEstimate(provider: string): number {
    const usage = this.getUsage(provider);
    return usage.costEstimate;
  }

  isNearLimit(provider: string, threshold = 0.9): boolean {
    const cfg = this.getConfig(provider);
    const usage = this.getUsage(provider);
    return usage.requestsToday >= cfg.maxRequests * threshold;
  }

  /**
   * Check rate limit for local operations (DB, sync, etc.)
   * @param operation - Type of operation (e.g., 'local-db', 'local-sync', 'local')
   * @returns Rate limit status
   */
  checkLocalLimit(
    operation: "local" | "local-db" | "local-sync" = "local",
  ): RateLimitStatus {
    return this.checkLimit(operation);
  }

  /**
   * Record a local operation for rate limiting
   * @param operation - Type of operation (e.g., 'local-db', 'local-sync', 'local')
   */
  recordLocalOperation(
    operation: "local" | "local-db" | "local-sync" = "local",
  ): void {
    this.recordRequest(operation);
  }

  /**
   * Check if a local operation is allowed (convenience method)
   * @param operation - Type of operation
   * @returns true if allowed, false if rate limited
   */
  isLocalOperationAllowed(
    operation: "local" | "local-db" | "local-sync" = "local",
  ): boolean {
    const status = this.checkLocalLimit(operation);
    return !status.exhausted;
  }

  /**
   * Execute a local operation with rate limiting check
   * @param operation - Type of operation
   * @param fn - Function to execute if rate limit allows
   * @returns Result of the function or throws rate limit error
   */
  async executeWithLocalLimit<T>(
    operation: "local" | "local-db" | "local-sync" = "local",
    fn: () => Promise<T>,
  ): Promise<T> {
    const status = this.checkLocalLimit(operation);

    if (status.exhausted) {
      const error = new Error(
        `Rate limit exceeded for ${operation}. Resets at ${formatDate(status.resetAt, { hour: "numeric", minute: "numeric", second: "numeric" }, i18n.language)}`,
      );
      logger.warn("[RateLimitService] Local operation rate limited", {
        operation,
        status,
      });
      throw error;
    }

    this.recordLocalOperation(operation);
    return await fn();
  }

  /**
   * Get local operation statistics
   */
  getLocalStats(): {
    local: RateLimitStatus;
    "local-db": RateLimitStatus;
    "local-sync": RateLimitStatus;
  } {
    return {
      local: this.checkLimit("local"),
      "local-db": this.checkLimit("local-db"),
      "local-sync": this.checkLimit("local-sync"),
    };
  }
}

export const rateLimitService = RateLimitService.getInstance();
export { RateLimitService };
