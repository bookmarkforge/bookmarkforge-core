import { aiManager } from "./ProviderManager";
import { rateLimitService } from "../RateLimitService";
import { logger } from "../../utils/logger";
import { securityVault } from "../SecurityVault";
import { hashCacheKey } from "../../utils/hash";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

export interface WebSearchConfig {
  maxResults?: number;
  maxTokens?: number;
  cacheTtlMs?: number;
  rateLimitMs?: number;
  provider?: "gemini" | "openai" | "anthropic" | "groq";
}

export interface GroundingChunk {
  uri?: unknown;
  title?: unknown;
}

export interface GroundingMetadata {
  groundingChunks?: unknown;
  webSearchQueries?: unknown;
  [key: string]: unknown;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  text: string;
  sources: string[];
  cached: boolean;
  timestamp: number;
  tokens?: number;
  groundingMetadata?: GroundingMetadata;
}

/** Validates untrusted grounding metadata from an external AI provider. */
function validateGroundingMetadata(
  input: unknown,
): GroundingMetadata | undefined {
  if (input === null || input === undefined || typeof input !== "object") {
    return undefined;
  }
  const obj = input as Record<string, unknown>;
  const out: GroundingMetadata = {};
  if (Array.isArray(obj.groundingChunks)) {
    out.groundingChunks = obj.groundingChunks
      .filter(
        (c): c is GroundingChunk =>
          (typeof c === "object" &&
            c !== null &&
            (c as GroundingChunk).uri === undefined) ||
          typeof (c as GroundingChunk).uri === "string",
      )
      .map((c) => ({
        uri:
          typeof (c as GroundingChunk).uri === "string"
            ? (c as GroundingChunk).uri
            : undefined,
        title:
          typeof (c as GroundingChunk).title === "string"
            ? (c as GroundingChunk).title
            : undefined,
      }));
  }
  if (Array.isArray(obj.webSearchQueries)) {
    out.webSearchQueries = obj.webSearchQueries.filter(
      (q) => typeof q === "string",
    );
  }
  return out;
}

const MAX_SEARCH_QUERY_LENGTH = 20_000;
const MAX_SEARCH_RESPONSE_LENGTH = 1_000_000;

function cloneSearchResponse(
  response: SearchResponse,
  cached: boolean,
): SearchResponse {
  return {
    ...response,
    cached,
    results: response.results.map((result) => ({ ...result })),
    sources: [...response.sources],
    groundingMetadata: response.groundingMetadata
      ? {
          ...response.groundingMetadata,
          groundingChunks: Array.isArray(
            response.groundingMetadata.groundingChunks,
          )
            ? response.groundingMetadata.groundingChunks.map((chunk) =>
                typeof chunk === "object" && chunk !== null
                  ? { ...(chunk as Record<string, unknown>) }
                  : chunk,
              )
            : response.groundingMetadata.groundingChunks,
          webSearchQueries: Array.isArray(
            response.groundingMetadata.webSearchQueries,
          )
            ? [...response.groundingMetadata.webSearchQueries]
            : response.groundingMetadata.webSearchQueries,
        }
      : undefined,
  };
}

const DEFAULT_CONFIG: Required<WebSearchConfig> = {
  maxResults: 5,
  maxTokens: 2000,
  cacheTtlMs: 300_000,
  rateLimitMs: 1000,
  provider: "gemini",
};

class SearchCache {
  private cache = new Map<
    string,
    { response: SearchResponse; expires: number }
  >();
  private ttl: number;
  private maxSize: number;

  constructor(ttlMs: number = DEFAULT_CONFIG.cacheTtlMs, maxSize: number = 200) {
    this.ttl = ttlMs;
    this.maxSize = maxSize;
  }

  get(key: string): SearchResponse | null {
    const entry = this.cache.get(key);
    if (!entry) {return null;}
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    return cloneSearchResponse(entry.response, true);
  }

  set(key: string, response: SearchResponse): void {
    // FIFO eviction (Map insertion order): if at capacity, delete the
    // oldest-inserted entry. TTL-based expiry on get() handles staleness;
    // a full LRU would promote on get() but adds complexity for minimal
    // gain with a 5-min TTL window.
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {this.cache.delete(oldest);}
    }
    // Keep an internal snapshot so callers cannot mutate the cached result or
    // toggle its cached marker for future consumers.
    this.cache.set(key, {
      response: cloneSearchResponse(response, false),
      expires: Date.now() + this.ttl,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

class RateLimiter {
  private lastRequest = 0;
  private delayMs: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(delayMs: number = DEFAULT_CONFIG.rateLimitMs) {
    this.delayMs = delayMs;
  }

  getLastRequestTime(): number {
    return this.lastRequest;
  }

  setLastRequestTime(ts: number): void {
    this.lastRequest = ts;
  }

  async wait(): Promise<void> {
    // Serialize concurrent callers. A timestamp check alone lets several
    // searches observe the same idle window and then fire together.
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.queue;
    this.queue = previous.then(() => turn);

    await previous;
    try {
      const elapsed = Date.now() - this.lastRequest;
      if (elapsed < this.delayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.delayMs - elapsed),
        );
      }
      this.lastRequest = Date.now();
    } finally {
      release();
    }
  }
}

export class WebSearchService {
  private static instance: WebSearchService;
  private config: Required<WebSearchConfig>;
  private cache: SearchCache;
  private limiter: RateLimiter;
  private requestCount = 0;
  private requestTokens = 0;
  private lifecycleGeneration = 0;

  private constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.cache = new SearchCache(DEFAULT_CONFIG.cacheTtlMs);
    this.limiter = new RateLimiter(DEFAULT_CONFIG.rateLimitMs);
  }

  static getInstance(): WebSearchService {
    if (!WebSearchService.instance) {
      WebSearchService.instance = new WebSearchService();
    }
    return WebSearchService.instance;
  }

  setConfig(config: Partial<WebSearchConfig>): void {
    // Invalidate searches already waiting on the previous limiter/config. They
    // must not repopulate the new cache with stale results.
    this.lifecycleGeneration++;
    const prevLastRequest = this.limiter.getLastRequestTime();
    const next = { ...DEFAULT_CONFIG, ...config };
    const maxResults = Number(next.maxResults);
    const maxTokens = Number(next.maxTokens);
    const cacheTtlMs = Number(next.cacheTtlMs);
    const rateLimitMs = Number(next.rateLimitMs);
    this.config = {
      ...next,
      maxResults: Number.isFinite(maxResults)
        ? Math.min(100, Math.max(1, Math.floor(maxResults)))
        : DEFAULT_CONFIG.maxResults,
      maxTokens: Number.isFinite(maxTokens)
        ? Math.min(100_000, Math.max(1, Math.floor(maxTokens)))
        : DEFAULT_CONFIG.maxTokens,
      cacheTtlMs: Number.isFinite(cacheTtlMs)
        ? Math.min(86_400_000, Math.max(0, cacheTtlMs))
        : DEFAULT_CONFIG.cacheTtlMs,
      rateLimitMs: Number.isFinite(rateLimitMs)
        ? Math.min(300_000, Math.max(0, rateLimitMs))
        : DEFAULT_CONFIG.rateLimitMs,
    };
    this.cache = new SearchCache(this.config.cacheTtlMs);
    this.limiter = new RateLimiter(this.config.rateLimitMs);
    this.limiter.setLastRequestTime(prevLastRequest);
    logger.info("WebSearchService.setConfig", {
      maxResults: this.config.maxResults,
      maxTokens: this.config.maxTokens,
      cacheTtlMs: this.config.cacheTtlMs,
      rateLimitMs: this.config.rateLimitMs,
      provider: this.config.provider,
    });
  }

  getConfig(): Readonly<Required<WebSearchConfig>> {
    return { ...this.config };
  }

  getStats() {
    return {
      requestCount: this.requestCount,
      requestTokens: this.requestTokens,
      cacheSize: this.cache.size(),
    };
  }

  async search(
    query: string,
    lang?: string,
    options?: { isPrivate?: boolean; signal?: AbortSignal },
  ): Promise<SearchResponse> {
    if (options?.signal?.aborted) {
      throw new DOMException("Web search aborted", "AbortError");
    }
    if (typeof query !== "string" || query.trim().length === 0) {
      throw new Error("Search query cannot be empty.");
    }
    if (query.length > MAX_SEARCH_QUERY_LENGTH) {
      throw new Error(
        `Search query too long (max ${MAX_SEARCH_QUERY_LENGTH} characters).`,
      );
    }
    const normalizedQuery = query.trim();
    // Web search always sends the query to the cloud provider (Gemini with
    // Google grounding). Private data must NEVER leave the device, so we
    // refuse to perform grounded web search on private content.
    if (options?.isPrivate) {
      throw new Error(
        "Web search is not available for Private documents (would exfiltrate data to the cloud).",
      );
    }
    const quotaStatus = rateLimitService.checkLimit(this.config.provider);
    if (quotaStatus.exhausted) {
      const usage = rateLimitService.getUsage(this.config.provider);
      throw new Error(
        `Quota exhausted. Used ${quotaStatus.used ?? usage.requestsToday} requests in the current rate window.`,
      );
    }

    // Search results are cleared at vault boundaries, but do not duplicate
    // the query itself in the cache key while the session is active.
    const cacheKey = `search:${hashCacheKey(normalizedQuery.toLowerCase())}:${lang || "en"}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (options?.signal?.aborted) {
        throw new DOMException("Web search aborted", "AbortError");
      }
      logger.info("WebSearchService.search", {
        queryLength: normalizedQuery.length,
        cached: true,
      });
      return cached;
    }

    const requestGeneration = this.lifecycleGeneration;
    await this.limiter.wait();
    if (options?.signal?.aborted) {
      throw new DOMException("Web search aborted", "AbortError");
    }
    if (requestGeneration !== this.lifecycleGeneration) {
      throw new DOMException("Web search request was invalidated", "AbortError");
    }

    const normalizedLang = lang || "en";
    const systemPrompt = `Eres un asistente de investigación experto. Busca información relevante y presenta los resultados de manera clara y precisa.
Responde en idioma: ${normalizedLang}.
Incluye fuentes cuando sea posible.`;

    try {
      const response = await aiManager.generateText(normalizedQuery, systemPrompt, {
        complexity: "complex",
        isPrivate: false,
        signal: options?.signal,
        tools: [{ googleSearch: {} }],
      }); // isPrivate already guarded at the top of search()

      if (options?.signal?.aborted) {
        throw new DOMException("Web search aborted", "AbortError");
      }
      if (
        typeof response.text !== "string" ||
        response.text.length > MAX_SEARCH_RESPONSE_LENGTH
      ) {
        throw new Error(
          `Search response too large (max ${MAX_SEARCH_RESPONSE_LENGTH} characters).`,
        );
      }
      if (requestGeneration !== this.lifecycleGeneration) {
        throw new DOMException("Web search request was invalidated", "AbortError");
      }

      const results = this.parseResults(response.text);
      const limitedResults = results.slice(0, this.config.maxResults);
      const searchResponse: SearchResponse = {
        query: normalizedQuery,
        results: limitedResults,
        text: response.text,
        sources: limitedResults.map((result) => result.url),
        cached: false,
        timestamp: Date.now(),
        tokens: response.text.length,
        groundingMetadata: validateGroundingMetadata(
          response.groundingMetadata,
        ),
      };

      this.cache.set(cacheKey, searchResponse);
      this.requestCount++;
      this.requestTokens += searchResponse.tokens || 0;

      await rateLimitService.recordRequest(
        this.config.provider,
        searchResponse.tokens || 0,
      );

      logger.info("WebSearchService.search", {
        queryLength: normalizedQuery.length,
        resultCount: limitedResults.length,
        tokens: searchResponse.tokens,
      });

      return searchResponse;
    } catch (error) {
      logger.error("WebSearchService.search", {
        queryLength: normalizedQuery.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private parseResults(text: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lines = text.split("\n").filter((l) => l.trim());
    let current: Partial<SearchResult> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {continue;}

      const titleMatch = trimmed.match(/^(?:[-*]|\d+\.)\s*[*📚]\s*"?(.+?)"?/iu);
      if (titleMatch) {
        if (current.title && current.url) {
          results.push(current as SearchResult);
        }
        current = { title: titleMatch[1], snippet: "" };
        continue;
      }

      const urlMatch = trimmed.match(/(?:https?:\/\/|www\.)[^\s]+/i);
      if (urlMatch && !current.url) {
        // Audit #4: the regex can capture malformed URLs (e.g. "www."
        // without scheme, or invalid characters). new URL() would throw and
        // kill the WHOLE search after the paid AI call — guard it.
        const raw = urlMatch[0];
        try {
          // Normalize only to extract the host; `url` keeps the
          // original result text (no trailing slash or scheme added).
          const parsed = new URL(raw.startsWith("www.") ? `https://${raw}` : raw);
          // Only http(s) results may enter the url/sources fields. The match
          // regex requires http(s):// or www., but a provider-grounded
          // output can still contain a `javascript:`/`data:`/`file:` token in
          // the URL position (the regex captures up to the first space).
          // Those are inert as plain text but must never propagate as a link
          // or source for downstream consumers — skip them entirely.
          if (
            parsed.protocol !== "http:" &&
            parsed.protocol !== "https:"
          ) {
            continue;
          }
          current.url = raw;
          current.source = parsed.hostname;
        } catch {
          // Malformed URL: discard it rather than keeping raw text as a URL.
          // A malformed URL could be dangerous if rendered as a link.
          current.url = undefined;
        }
        continue;
      }

      if (current.title && !current.snippet) {
        current.snippet = trimmed;
      }
    }

    if (current.title) {
      results.push(current as SearchResult);
    }

    return results;
  }

  clearCache(): void {
    // A response already in flight must not be written back after an explicit
    // cache clear; invalidate that continuation before clearing the snapshot.
    this.lifecycleGeneration++;
    this.cache.clear();
    logger.info("WebSearchService.clearCache", {});
  }

  resetStats(): void {
    this.requestCount = 0;
    this.requestTokens = 0;
    logger.info("WebSearchService.resetStats", {});
  }
}

export const webSearchService = WebSearchService.getInstance();

// Queries/results are cloud-derived and may still be sensitive when a caller
// fails to classify context perfectly. A vault transition is a hard boundary:
// invalidate cache entries and in-flight writes in either direction.
securityVault.onLock(() => webSearchService.clearCache());
securityVault.onUnlock(() => webSearchService.clearCache());
