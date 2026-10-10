import { AIResponse } from "./types";
import { logger } from "../../utils/logger";
import { hashCacheKey } from "../../utils/hash";

/**
 * AIRequestCache - Manages caching of AI responses
 * Reduces redundant API calls and improves response times
 *
 * Provider-level caching strategy:
 * - Anthropic and OpenAI both offer prompt caching for long system prompts
 * - When the same prefix appears in many requests, the provider caches the KV state
 * - Structure prompts so the static system content comes first for maximum cache hits
 * - Cached portion charged at ~10% of base input cost
 */
export class AIRequestCache {
  private cache = new Map<
    string,
    { response: AIResponse; timestamp: number }
  >();
  private readonly REQUEST_CACHE_TTL = 300_000; // 5 minutes
  private readonly MAX_CACHE_SIZE = 100;

  /**
   * Generate cache key from request parameters with normalization
   * Trim whitespace to ensure consistent cache keys regardless of input formatting
   * Include provider in key to prevent cross-provider cache collisions
   */
  private generateKey(
    prompt: string,
    systemPrompt?: string,
    options?: { model?: string; provider?: string; isPrivate?: boolean },
  ): string {
    return JSON.stringify({
      // Audit #4: provider and privacy MUST be part of the key. Without the
      // provider, a response cached from Gemini would be served to a request
      // that routes to OpenAI/Ollama — different models, costs and privacy
      // guarantees. isPrivate keeps private results from colliding with
      // public ones of the same text.
      provider: options?.provider ?? "unknown",
      isPrivate: options?.isPrivate ?? false,
      // Never retain user prompts in Map keys. The cache is session-only, but
      // its keys live as long as the response and would otherwise duplicate
      // sensitive content in memory and diagnostics.
      promptHash: hashCacheKey(prompt.trim()),
      systemPromptHash: systemPrompt
        ? hashCacheKey(systemPrompt.trim())
        : undefined,
      model: options?.model,
    });
  }

  /**
   * Get provider-level caching advisory for prompt structuring
   * Returns guidance on how to structure prompts for maximum provider caching benefit
   * @param model - Optional model identifier for provider-specific caching rules
   */
  getProviderCachingAdvisory(systemPrompt?: string, _model?: string): {
    hasStaticPrefix: boolean;
    staticPrefixLength: number;
    recommendedStructure: "system-first" | "prompt-first";
    cachePotential: "high" | "medium" | "low";
} {

    if (!systemPrompt) {
      return { hasStaticPrefix: false, staticPrefixLength: 0, recommendedStructure: "prompt-first", cachePotential: "low" };
    }

    // Count tokens roughly (1 token ≈ 4 chars)
    const charsPerToken = 4;
    const staticPrefix = systemPrompt.split("\n")[0] || ""; // First line is typically system instructions
    const staticPrefixTokens = Math.ceil(staticPrefix.length / charsPerToken);
    // Provider-level caching gives ~90% discount on cached portion
    // If system prompt > 1K tokens, caching provides significant savings
    const hasStaticPrefix = staticPrefixTokens > 500;
    const cachePotential = hasStaticPrefix && staticPrefixTokens > 1000 ? "high" : "medium";

    return {
      hasStaticPrefix,
      staticPrefixLength: staticPrefix.length,
      recommendedStructure: hasStaticPrefix ? "system-first" : "prompt-first",
      cachePotential,
    };
  }

  /**
   * Get cached response if available and not expired
   */
  get(
    prompt: string,
    systemPrompt?: string,
    options?: { model?: string; provider?: string; isPrivate?: boolean },
  ): AIResponse | null {
    // Private prompts/responses are never eligible for this cache. The
    // ProviderManager already avoids populating it for private requests, but
    // keeping the boundary here prevents direct callers from creating a
    // cross-request in-memory disclosure.
    if (options?.isPrivate === true) {return null;}
    const now = Date.now();
    this.pruneExpired(now);
    const key = this.generateKey(prompt, systemPrompt, options);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Never log the cache key: it contains the full prompt and system prompt,
    // which may include vault content or secrets. Keep diagnostics aggregate.
    logger.debug("[AIRequestCache] Cache hit", {
      cacheSize: this.cache.size,
    });
    return cached.response;
  }

  /**
   * Cache a response
   */
  set(
    prompt: string,
    response: AIResponse,
    systemPrompt?: string,
    options?: { model?: string; provider?: string; isPrivate?: boolean },
  ): void {
    // Private prompts/responses must not be retained even for the current
    // session. Do not rely exclusively on callers to enforce this policy.
    if (options?.isPrivate === true) {return;}
    const now = Date.now();
    this.pruneExpired(now);
    const key = this.generateKey(prompt, systemPrompt, options);

    // Updating an existing key must not evict an unrelated response when the
    // cache is full. Expired entries are removed first so they do not consume
    // capacity until the next size-bound eviction.
    if (!this.cache.has(key) && this.cache.size >= this.MAX_CACHE_SIZE) {
      this.evictOldest();
    }

    this.cache.set(key, {
      response,
      timestamp: now,
    });

    // Do not expose prompts in logs; cache diagnostics must remain metadata-only.
    logger.debug("[AIRequestCache] Cached response", {
      cacheSize: this.cache.size,
    });
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp >= this.REQUEST_CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached responses
   */
  clear(): void {
    this.cache.clear();
    logger.info("[AIRequestCache] Cache cleared");
  }

  /**
   * Evict oldest entry when cache is full
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    this.cache.forEach((value, key) => {
      if (value.timestamp < oldestTimestamp) {
        oldestTimestamp = value.timestamp;
        oldestKey = key;
      }
    });

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; ttl: number } {
    this.pruneExpired(Date.now());
    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
      ttl: this.REQUEST_CACHE_TTL,
    };
  }
}
