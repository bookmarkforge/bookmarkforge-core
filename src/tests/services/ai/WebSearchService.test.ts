import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAiManager = { generateText: vi.fn() };
const mockRateLimitService = {
  checkLimit: vi.fn(),
  getUsage: vi.fn(),
  recordRequest: vi.fn(),
};

vi.mock("../../\.\./services/ai/ProviderManager", () => ({
  aiManager: mockAiManager,
}));
vi.mock("../../../services/RateLimitService", () => ({
  rateLimitService: mockRateLimitService,
}));
vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { WebSearchService } =
  await import("../../\.\./services/ai/WebSearchService");

describe("WebSearchService", () => {
  let service: ReturnType<typeof WebSearchService.getInstance>;

  beforeEach(() => {
    vi.clearAllMocks();
    (WebSearchService as any).instance = undefined;
    service = WebSearchService.getInstance();
  });

  describe("setConfig / getConfig", () => {
    it("uses default values", () => {
      const config = service.getConfig();
      expect(config.maxResults).toBe(5);
      expect(config.maxTokens).toBe(2000);
      expect(config.rateLimitMs).toBe(1000);
    });

    it("updates configuration", () => {
      service.setConfig({ maxResults: 10, provider: "openai" });
      expect(service.getConfig().maxResults).toBe(10);
      expect(service.getConfig().provider).toBe("openai");
    });

    it("normalizes invalid limits to avoid unbounded results or waits", () => {
      service.setConfig({
        maxResults: 0,
        maxTokens: -10,
        cacheTtlMs: -1,
        rateLimitMs: -5,
      });
      expect(service.getConfig()).toMatchObject({
        maxResults: 1,
        maxTokens: 1,
        cacheTtlMs: 0,
        rateLimitMs: 0,
      });
    });
  });

  describe("parseResults", () => {
    const parseResults = (text: string) =>
      (WebSearchService.prototype as any).parseResults.call(service, text);

    it("parses results with title + url format", () => {
      const text = `* * "A"\nhttps://example.com/ai\nThis is a snippet about AI.`;
      const results = parseResults(text);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("A");
      expect(results[0].url).toBe("https://example.com/ai");
      expect(results[0].source).toBe("example.com");
      expect(results[0].snippet).toBe("This is a snippet about AI.");
    });

    it("returns empty array for text without matches", () => {
      const results = parseResults("random text without any pattern");
      expect(results).toHaveLength(0);
    });

    it("parses multiple results", () => {
      const text = `* * "A"\nhttps://url1.com\nSnippet 1\n* * "B"\nhttps://url2.com\nSnippet 2`;
      const results = parseResults(text);
      expect(results).toHaveLength(2);
    });

    it("ignores empty lines", () => {
      const text = `\n\n* * "T"\nhttps://test.com\n\n`;
      const results = parseResults(text);
      expect(results).toHaveLength(1);
    });

    it("extracts hostname from www. URLs without a scheme (audit #4)", () => {
      const text = `* * "A"\nwww.ejemplo.com/guia\nSnippet`;
      const results = parseResults(text);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("A");
      // The original text is kept; the hostname is extracted by normalizing.
      expect(results[0].url).toBe("www.ejemplo.com/guia");
      expect(results[0].source).toBe("www.ejemplo.com");
    });

    it("does not throw when the captured URL is invalid (audit #4)", () => {
      // "http://[invalid" is an unclosed IPv6 host: new URL() throws; the
      // parse must not break. The hardened implementation DISCARDS the
      // value rather than keeping raw text as a URL — a malformed URL
      // could be dangerous if rendered as a link.
      const text = `* * "A"\nhttp://[invalid\nSnippet`;
      const results = parseResults(text);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("A");
      expect(results[0].url).toBeUndefined();
      expect(results[0].source).toBeUndefined();
    });

    it("drops non-http(s) URLs instead of propagating them to url/sources", () => {
      // The URL regex can capture a javascript/data/file: token in the URL
      // position ("javascript:alert(1)" parses fine as a URL). Such values
      // must never leave the parser as a link/source for consumers.
      const text = `* * "A"\njavascript:alert(1)\nSnippet`;
      const results = parseResults(text);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("A");
      expect(results[0].url).toBeUndefined();
      expect(results[0].source).toBeUndefined();

      const dataText = `* * "B"\ndata:text/html;base64,PHNjcmlwdD4=\nSnippet`;
      const dataResults = parseResults(dataText);
      expect(dataResults).toHaveLength(1);
      expect(dataResults[0].url).toBeUndefined();
    });
  });

  describe("search", () => {
    it("throws error if quota is exhausted", async () => {
      mockRateLimitService.checkLimit.mockReturnValue({ exhausted: true });
      mockRateLimitService.getUsage.mockReturnValue({ requestsToday: 5 });
      await expect(service.search("test query")).rejects.toThrow(
        "Quota exhausted",
      );
      expect(mockAiManager.generateText).not.toHaveBeenCalled();
    });

    it("returns cached results if they exist", async () => {
      mockRateLimitService.checkLimit.mockReturnValue({ exhausted: false });
      mockAiManager.generateText.mockResolvedValue({
        text: '* * "Result 1"\nhttps://url1.com\nSnippet 1',
      });

      const first = await service.search("hello");
      expect(first.cached).toBe(false);

      mockRateLimitService.checkLimit.mockReturnValue({ exhausted: false });
      const cached = await service.search("hello");
      expect(cached.cached).toBe(true);
    });

    it("limits results and sources to the configured maximum", async () => {
      service.setConfig({ maxResults: 1, rateLimitMs: 0 });
      mockRateLimitService.checkLimit.mockReturnValue({ exhausted: false });
      mockRateLimitService.recordRequest.mockResolvedValue(undefined);
      mockAiManager.generateText.mockResolvedValue({
        text: '* * "A"\nhttps://ai.example.com\nA guide.\n* * "B"\nhttps://ml.example.com\nAnother guide.',
      });

      const result = await service.search("artificial intelligence");

      expect(result.results).toHaveLength(1);
      expect(result.sources).toEqual(["https://ai.example.com"]);
    });

    it("performs search and parses results", async () => {
      mockRateLimitService.checkLimit.mockReturnValue({ exhausted: false });
      mockRateLimitService.recordRequest.mockResolvedValue(undefined);
      mockAiManager.generateText.mockResolvedValue({
        text: '* * "A"\nhttps://ai.example.com\nA comprehensive guide to AI.\n* * "M"\nhttps://ml.example.com\nMachine learning fundamentals.',
      });

      const result = await service.search("artificial intelligence");

      expect(result.query).toBe("artificial intelligence");
      expect(result.results).toHaveLength(2);
      expect(result.results[0]!.title).toBe("A");
      expect(result.sources).toContain("https://ml.example.com");
      expect(result.sources).toContain("https://ml.example.com");
      expect(result.cached).toBe(false);
      expect(result.timestamp).toBeGreaterThan(0);
      expect(mockAiManager.generateText).toHaveBeenCalled();
      expect(mockRateLimitService.recordRequest).toHaveBeenCalled();
    });

    it("uses cache with different keys for a different lang", async () => {
      mockRateLimitService.checkLimit.mockReturnValue({ exhausted: false });
      mockAiManager.generateText.mockResolvedValue({
        text: '* * "Result"\nhttps://r.com\nSnippet',
      });

      const en = await service.search("test", "en");
      mockAiManager.generateText.mockResolvedValue({
        text: '* * "Result"\nhttps://r.com\nSnippet',
      });
      const es = await service.search("test", "es");
      expect(en.cached).toBe(false);
      expect(es.cached).toBe(false);
    });

    it("rejects search over private content (isPrivate)", async () => {
      mockRateLimitService.checkLimit.mockReturnValue({ exhausted: false });
      await expect(
        service.search("secret query", "en", { isPrivate: true }),
      ).rejects.toThrow("not available for Private");
      expect(mockAiManager.generateText).not.toHaveBeenCalled();
      expect(mockRateLimitService.recordRequest).not.toHaveBeenCalled();
    });

    it("the privacy guard runs before the quota check", async () => {
      // Even with the quota exhausted, the isPrivate guard must throw first:
      // private content is never allowed to reach the cloud provider.
      mockRateLimitService.checkLimit.mockReturnValue({ exhausted: true });
      await expect(
        service.search("secret query", "en", { isPrivate: true }),
      ).rejects.toThrow("not available for Private");
      expect(mockAiManager.generateText).not.toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    it("returns initial stats", () => {
      const stats = service.getStats();
      expect(stats.requestCount).toBe(0);
      expect(stats.requestTokens).toBe(0);
      expect(stats.cacheSize).toBe(0);
    });

    it("updates stats after search", async () => {
      mockRateLimitService.checkLimit.mockReturnValue({ exhausted: false });
      mockRateLimitService.recordRequest.mockResolvedValue(undefined);
      mockAiManager.generateText.mockResolvedValue({
        text: '* * "A"\nhttps://a.com\nSnippet',
      });

      await service.search("query");
      const stats = service.getStats();
      expect(stats.requestCount).toBe(1);
      expect(stats.cacheSize).toBe(1);
    });
  });

  describe("clearCache / resetStats", () => {
    it("clears the cache and resets stats", async () => {
      mockRateLimitService.checkLimit.mockReturnValue({ exhausted: false });
      mockRateLimitService.recordRequest.mockResolvedValue(undefined);
      mockAiManager.generateText.mockResolvedValue({
        text: '* * "A"\nhttps://a.com\nSnippet',
      });
      await service.search("test");

      service.clearCache();
      expect(service.getStats().cacheSize).toBe(0);

      service.resetStats();
      expect(service.getStats().requestCount).toBe(0);
    });
  });
});
