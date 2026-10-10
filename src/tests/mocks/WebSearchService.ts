import { vi } from "vitest";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

export interface SearchResponse {
  query?: string;
  results: SearchResult[];
  text?: string;
  sources?: string[];
  cached?: boolean;
  timestamp?: number;
  tokens?: number;
  totalResults: number;
}

export interface WebSearchConfig {
  apiKey?: string;
  engine?: string;
}

export const mockSearchResults: SearchResult[] = [
  {
    title: "Test Result 1",
    url: "https://example.com/1",
    snippet: "This is test result 1",
    source: "test",
  },
  {
    title: "Test Result 2",
    url: "https://example.com/2",
    snippet: "This is test result 2",
    source: "test",
  },
];

export const mockSearchResponse: SearchResponse = {
  query: "test query",
  results: mockSearchResults,
  text: "Test result 1... Test result 2...",
  sources: ["https://example.com/1", "https://example.com/2"],
  cached: false,
  timestamp: Date.now(),
  tokens: 100,
  totalResults: 2,
};

export const createWebSearchMocks = () => {
  vi.mock("../../services/ai/WebSearchService", async () => {
    const { vi } = await import("vitest");

    return {
      WebSearchService: vi.fn().mockImplementation(() => ({
        config: {
          maxResults: 5,
          maxTokens: 2000,
          cacheTtlMs: 300000,
          rateLimitMs: 1000,
          provider: "gemini",
        },

        search: vi.fn().mockResolvedValue(mockSearchResponse),
        searchAsync: vi.fn().mockResolvedValue(mockSearchResponse),

        setFilter: vi.fn(),
        clearFilters: vi.fn(),

        getRateLimit: vi
          .fn()
          .mockReturnValue({ remaining: 100, reset: Date.now() + 60000 }),
        setRateLimit: vi.fn(),

        clearCache: vi.fn(),

        setApiKey: vi.fn(),
        setBaseUrl: vi.fn(),

        getCacheStats: vi.fn().mockReturnValue({ size: 0, hits: 0, misses: 0 }),
        getRateLimitStats: vi
          .fn()
          .mockReturnValue({ requests: 0, remaining: 100 }),
      })),

      SearchResult: vi.fn().mockImplementation((result) => result),
      SearchResponse: vi.fn().mockImplementation((response) => response),

      defaultSearchConfig: {
        maxResults: 5,
        maxTokens: 2000,
        cacheTtlMs: 300000,
        rateLimitMs: 1000,
        provider: "gemini",
      },

      __esModule: true,
    };
  });

  vi.mock("../../services/ai/ProviderManager", () => ({
    aiManager: {
      chat: vi.fn().mockResolvedValue({ text: "Mock response" }),
      generate: vi.fn().mockResolvedValue({ text: "Mock response" }),
      isConfigured: vi.fn().mockReturnValue(true),
    },
  }));

  vi.mock("../services/RateLimitService", () => ({
    rateLimitService: {
      checkLimit: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 100,
        reset: Date.now() + 60000,
      }),
    },
  }));

  vi.mock("../utils/logger", () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }));
};

export const setupWebSearchMocks = () => {
  createWebSearchMocks();
};
