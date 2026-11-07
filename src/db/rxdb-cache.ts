import { logger } from "../utils/logger";
import { hardwareDetector } from "../services/HardwareDetectorService";

interface QueryCacheEntry {
  query: string;
  result: unknown[];
  timestamp: number;
  expiresAt: number;
}

export class QueryCache {
  private cache = new Map<string, QueryCacheEntry>();
  private maxSize = 100;
  private defaultTTL = 5 * 60 * 1000;
  private initPromise: Promise<void> | null = null;

  private ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initAdaptiveCache().catch((error: unknown) => {
        // INTENTIONAL FALLBACK: cache tuning is optional; initAdaptiveCache
        // already logs probe failures and the safe defaults remain usable.
        logger.debug("[RxDB] Cache adaptation unavailable; using defaults", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return this.initPromise;
  }

  private async initAdaptiveCache() {
    try {
      const tier = await hardwareDetector.getDeviceTier();
      if (tier === "low-end") {
        this.maxSize = 20;
        this.defaultTTL = 60 * 1000;
        logger.info("[RxDB] Cache adapted to low-end device: 20 max, 1min TTL");
      } else if (tier === "mid-range") {
        this.maxSize = 50;
        this.defaultTTL = 3 * 60 * 1000;
        logger.info(
          "[RxDB] Cache adapted to mid-range device: 50 max, 3min TTL",
        );
      } else {
        logger.info(
          "[RxDB] Cache adapted to high-end device: 100 max, 5min TTL",
        );
      }
    } catch (e) {
      logger.warn("[RxDB] Failed to adapt cache, using defaults", { error: e });
    }
  }

  get(key: string): unknown[] | null {
    this.ensureInit();
    const entry = this.cache.get(key);
    if (!entry) {return null;}

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.result;
  }

  set(key: string, result: unknown[], ttl?: number): void {
    this.ensureInit();
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      query: key,
      result,
      timestamp: Date.now(),
      expiresAt: Date.now() + (ttl || this.defaultTTL),
    });
  }

  async ready(): Promise<void> {
    await this.ensureInit();
  }

  clear(): void {
    this.cache.clear();
  }

  invalidate(pattern?: RegExp): void {
    if (!pattern) {
      this.clear();
      return;
    }

    for (const [key] of this.cache) {
      if (pattern.test(key)) {
        this.cache.delete(key);
      }
    }
  }
}

const globalQueryCache = new QueryCache();

export { globalQueryCache as queryCache };
