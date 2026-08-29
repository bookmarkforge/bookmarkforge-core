import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGenerateText = vi.fn();

vi.mock("../../\.\./services/ai/ProviderManager", () => ({
  aiManager: {
    get generateText() {
      return mockGenerateText;
    },
    getApiKey: vi.fn(),
    getProviderInfo: vi
      .fn()
      .mockReturnValue({ provider: "gemini", model: "gemini-2.0-flash-exp" }),
  },
}));

vi.mock("../../../i18n", () => ({
  default: {
    t: vi.fn((key: string, opts?: Record<string, unknown>) => {
      const defaults: Record<string, string> = {
        "ai_prompts.existing_tags_context": `Existing tags: ${(opts?.tags as string) || ""}`,
        "ai_prompts.folder_list": `Existing folders: ${(opts?.folders as string) || ""}`,
        general_folder: "General",
      };
      return defaults[key] || key;
    }),
  },
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();
Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage });

const { TaggingService } =
  await import("../../\.\./services/ai/TaggingService");

/** Generates unique text to avoid cache collisions */
function uniqueText(base: string, seed: number): string {
  return `${seed}_${base}_${"x".repeat(seed)}_`.repeat(20);
}

describe("TaggingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockReset();
    mockLocalStorage.clear();
  });

  describe("suggestTags", () => {
    it("returns fallback keywords if text is too short (< 30 chars)", async () => {
      const service = new TaggingService();
      const tags = await service.suggestTags("corto");
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBeLessThanOrEqual(6);
    });

    it("returns tags from AI in JSON format", async () => {
      mockGenerateText.mockResolvedValue({
        text: '["ia","machine-learning","python"]',
        provider: "gemini",
      });
      const service = new TaggingService();
      const tags = await service.suggestTags(uniqueText("AI ML", 1));
      expect(tags).toEqual(["ia", "machine-learning", "python"]);
    });

    it("rejects provider error words instead of persisting them as tags", async () => {
      mockGenerateText.mockResolvedValue({
        text: '["sorry","cannot","process","valid-tag"]',
        provider: "ollama",
      });
      const service = new TaggingService();
      const tags = await service.suggestTags(uniqueText("provider error tags", 222));
      expect(tags).toEqual(["valid-tag"]);
    });

    it("filters non-string tags from JSON", async () => {
      mockGenerateText.mockResolvedValue({
        text: '["valid",123,null,"also-valid"]',
        provider: "gemini",
      });
      const service = new TaggingService();
      const tags = await service.suggestTags(uniqueText("filter test", 2));
      expect(tags).toEqual(["valid", "also-valid"]);
    });

    it("converts tags to lowercase and truncates to 50 chars", async () => {
      mockGenerateText.mockResolvedValue({
        text: '["UPPERCASE","  spaced  "]',
        provider: "gemini",
      });
      const service = new TaggingService();
      const tags = await service.suggestTags(uniqueText("case test", 3));
      expect(tags).toEqual(["uppercase", "spaced"]);
    });

    it("filters 1-character tags", async () => {
      mockGenerateText.mockResolvedValue({
        text: '["a","valid-tag"]',
        provider: "gemini",
      });
      const service = new TaggingService();
      const tags = await service.suggestTags(uniqueText("short tag", 4));
      expect(tags).toEqual(["valid-tag"]);
    });

    it("limits to 10 tags max", async () => {
      const manyTags = Array.from({ length: 15 }, (_, i) => `tag${i}`);
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify(manyTags),
        provider: "gemini",
      });
      const service = new TaggingService();
      const tags = await service.suggestTags(uniqueText("limit test", 5));
      expect(tags.length).toBeLessThanOrEqual(10);
    });

    it("uses Spanish prompt if lang=es", async () => {
      mockGenerateText.mockResolvedValue({
        text: '["etiqueta"]',
        provider: "gemini",
      });
      const service = new TaggingService();
      const tags = await service.suggestTags(
        uniqueText("spanish prompt", 6),
        "es",
      );
      expect(mockGenerateText).toHaveBeenCalled();
      expect(mockGenerateText.mock.calls[0]![0]).toContain("Genera etiquetas");
      expect(tags).toEqual(["etiqueta"]);
    });

    it("uses custom prompts if they exist in localStorage", async () => {
      mockLocalStorage.setItem(
        "custom_prompts",
        JSON.stringify({ tagging: "Custom tagging prompt" }),
      );
      mockGenerateText.mockResolvedValue({
        text: '["custom"]',
        provider: "gemini",
      });
      const service = new TaggingService();
      await service.suggestTags(uniqueText("custom prompt", 7));
      expect(mockGenerateText).toHaveBeenCalled();
    });

    it("strips markdown ```json from the response", async () => {
      mockGenerateText.mockResolvedValue({
        text: '```json\n["tag-a","tag-b"]\n```',
        provider: "gemini",
      });
      const service = new TaggingService();
      const tags = await service.suggestTags(uniqueText("markdown clean", 8));
      expect(tags).toEqual(["tag-a", "tag-b"]);
    });

    it("falls back to keyword extraction if AI fails", async () => {
      mockGenerateText.mockRejectedValue(new Error("API error"));
      const service = new TaggingService();
      const tags = await service.suggestTags(
        "Artificial Intelligence machine learning data science technology innovation ".repeat(
          5,
        ),
      );
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBeGreaterThan(0);
    });

    it("uses in-memory cache for same text", async () => {
      mockGenerateText.mockResolvedValue({
        text: '["tag1","tag2"]',
        provider: "gemini",
      });
      const service = new TaggingService();
      const txt = uniqueText("cache test", 99);
      await service.suggestTags(txt, "en", "", [], false);
      await service.suggestTags(txt, "en", "", [], false);
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });

    it("does not persist tags to localStorage when isPrivate=true", async () => {
      mockGenerateText.mockResolvedValue({
        text: '["secret-tag"]',
        provider: "gemini",
      });
      const service = new TaggingService();
      await service.suggestTags(
        uniqueText("private content", 31),
        "en",
        "Secret title",
        [],
        true,
      );
      // The persistent tag cache must NOT contain private data
      expect(mockLocalStorage.getItem("bmf_ai_cache_v1")).toBeNull();
    });

    it("does not persist tags to localStorage even when NOT private", async () => {
      mockGenerateText.mockResolvedValue({
        text: '["public-tag"]',
        provider: "gemini",
      });
      const service = new TaggingService();
      await service.suggestTags(
        uniqueText("public content", 32),
        "en",
        "Public title",
        [],
        false,
      );
      // Generated content is session-only; plaintext localStorage persistence
      // is deliberately disabled (fail-closed).
      expect(mockLocalStorage.getItem("bmf_ai_cache_v1")).toBeNull();
    });

    it("does not reuse a private result in a later public request", async () => {
      mockGenerateText
        .mockResolvedValueOnce({ text: '["private-tag"]', provider: "gemini" })
        .mockResolvedValueOnce({ text: '["public-tag"]', provider: "gemini" });
      const service = new TaggingService();
      const text = uniqueText("privacy boundary", 321);

      await service.suggestTags(text, "en", "Secret", [], true);
      const publicTags = await service.suggestTags(text, "en", "Public", [], false);

      expect(publicTags).toEqual(["public-tag"]);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
      expect(mockLocalStorage.getItem("bmf_ai_cache_v1")).toBeNull();
    });

    it("does NOT collide cache keys with the same 200-char prefix (Phase 3)", async () => {
      // Two texts sharing the first 200+ characters but differing
      // at the end must produce different tags (no cache collision).
      const prefix = "A".repeat(250);
      const text1 = prefix + " UNIQUE_SUFFIX_ALPHA";
      const text2 = prefix + " UNIQUE_SUFFIX_BETA";

      mockGenerateText.mockResolvedValueOnce({
        text: '["alpha-tag"]',
        provider: "gemini",
      });
      mockGenerateText.mockResolvedValueOnce({
        text: '["beta-tag"]',
        provider: "gemini",
      });

      const service = new TaggingService();
      const tags1 = await service.suggestTags(text1, "en", "", [], false);
      const tags2 = await service.suggestTags(text2, "en", "", [], false);

      expect(tags1).toEqual(["alpha-tag"]);
      expect(tags2).toEqual(["beta-tag"]);
      // Both calls must have gone to the provider (no cache hit).
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });

    it("strips ```json fences without a language label (Phase 3)", async () => {
      mockGenerateText.mockResolvedValue({
        text: '```\n["bare-fence"]\n```',
        provider: "gemini",
      });
      const service = new TaggingService();
      const tags = await service.suggestTags(uniqueText("bare fence", 99));
      expect(tags).toEqual(["bare-fence"]);
    });

    it("strips ``` json fences with whitespace after backticks", async () => {
      mockGenerateText.mockResolvedValue({
        text: '``` json\n["space-tag"]\n```',
        provider: "gemini",
      });
      const service = new TaggingService();
      const tags = await service.suggestTags(uniqueText("space fence", 100));
      expect(tags).toEqual(["space-tag"]);
    });
  });

  describe("generateSummary", () => {
    it("returns truncated text if < 100 chars", async () => {
      const service = new TaggingService();
      const summary = await service.generateSummary("Texto corto.", "Title");
      expect(summary).toBe("Texto corto.");
    });

    it("returns summary from AI", async () => {
      mockGenerateText.mockResolvedValue({
        text: "This is a concise summary.",
        provider: "gemini",
      });
      const service = new TaggingService();
      const summary = await service.generateSummary(
        uniqueText("summary test", 10),
        "Title",
      );
      expect(summary).toBe("This is a concise summary.");
    });

    it("uses Spanish prompt if lang=es", async () => {
      mockGenerateText.mockResolvedValue({
        text: "Resumen en español.",
        provider: "gemini",
      });
      const service = new TaggingService();
      await service.generateSummary(
        uniqueText("summary es", 11),
        "Title",
        "es",
      );
      expect(mockGenerateText).toHaveBeenCalled();
      expect(mockGenerateText.mock.calls[0]![0]).toContain("Resumen del");
    });

    it("returns truncated fallback if AI fails", async () => {
      mockGenerateText.mockRejectedValue(new Error("API error"));
      const service = new TaggingService();
      const summary = await service.generateSummary(
        "Test content. ".repeat(30),
        "Title",
      );
      expect(summary).toContain("...");
    });
  });

  describe("suggestFolder", () => {
    it('returns "General" when there is no text or title', async () => {
      const service = new TaggingService();
      const folder = await service.suggestFolder("", "");
      expect(folder).toBe("General");
    });

    it("returns folder from AI", async () => {
      mockGenerateText.mockResolvedValue({
        text: "Technology",
        provider: "gemini",
      });
      const service = new TaggingService();
      const folder = await service.suggestFolder(
        "Texto sobre tecnología.",
        "Tech Article",
      );
      expect(folder).toBe("Technology");
    });

    it('returns "General" if AI fails', async () => {
      mockGenerateText.mockRejectedValue(new Error("error"));
      const service = new TaggingService();
      const folder = await service.suggestFolder(
        "Texto sobre tecnología.",
        "Article",
      );
      expect(folder).toBe("General");
    });
  });

  describe("suggestHierarchy", () => {
    it("returns empty string if there is no text or title", async () => {
      const service = new TaggingService();
      const hierarchy = await service.suggestHierarchy("", "");
      expect(hierarchy).toBe("");
    });

    it("returns hierarchical path from AI", async () => {
      mockGenerateText.mockResolvedValue({
        text: "Projects > AI > Research",
        provider: "gemini",
      });
      const service = new TaggingService();
      const hierarchy = await service.suggestHierarchy(
        "Texto sobre AI research.",
        "Paper",
      );
      expect(hierarchy).toBe("Projects > AI > Research");
    });

    it("returns empty string if AI fails", async () => {
      mockGenerateText.mockRejectedValue(new Error("error"));
      const service = new TaggingService();
      const hierarchy = await service.suggestHierarchy("Texto.");
      expect(hierarchy).toBe("");
    });
  });

  describe("_extractKeywords", () => {
    it("extracts keywords by frequency > stopwords", () => {
      const service = new TaggingService();
      const text =
        "artificial intelligence machine learning and deep learning are important topics in artificial intelligence";
      const tags = (
        service as unknown as { _extractKeywords: (t: string) => string[] }
      )._extractKeywords(text);
      expect(tags).toContain("artificial");
      expect(tags).toContain("intelligence");
      expect(tags.length).toBeLessThanOrEqual(6);
    });

    it("filters English and Spanish stopwords", () => {
      const service = new TaggingService();
      const text = "the el la de un technology science";
      const tags = (
        service as unknown as { _extractKeywords: (t: string) => string[] }
      )._extractKeywords(text);
      expect(tags).not.toContain("the");
      expect(tags).toContain("technology");
    });

    it("returns empty array if there are no words > 3 chars", () => {
      const service = new TaggingService();
      const tags = (
        service as unknown as { _extractKeywords: (t: string) => string[] }
      )._extractKeywords("a an of in it");
      expect(tags).toEqual([]);
    });
  });

  describe("log projection (safeErrorForLog)", () => {
    it("projects the failure path of suggestTags through the bounded shape", async () => {
      const { logger } = await import("../../../utils/logger");
      const { TaggingService } =
        await import("../../../services/ai/TaggingService");
      // 300-char hostile message to exercise the truncation guarantee.
      mockGenerateText.mockRejectedValueOnce(
        new Error(`Provider 4xx payload: ${"x".repeat(300)}`),
      );
      await new TaggingService().suggestTags(
        uniqueText("log-projection-tags", 1),
        "en",
        "any title",
      );
      const calls = (logger.warn as any).mock.calls as unknown[][];
      expect(calls.length).toBeGreaterThan(0);
      const failureEntry = calls.find(
        ([label]: unknown[]) =>
          typeof label === "string" &&
          (label as string).includes("AI tags failed"),
      );
      expect(failureEntry).toBeDefined();
      const meta = failureEntry![1] as {
        error?: { name?: unknown; message?: unknown };
      };
      expect(typeof meta.error?.name).toBe("string");
      expect(typeof meta.error?.message).toBe("string");
      expect((meta.error?.message as string).length).toBeLessThanOrEqual(220);
      expect(meta.error?.message as string).toMatch(/\u2026\[\+\d+\]/);
      expect(meta.error).not.toHaveProperty("stack");
    });

    it("projects the failure path of generateSummary through the bounded shape", async () => {
      const { logger } = await import("../../../utils/logger");
      const { TaggingService } =
        await import("../../../services/ai/TaggingService");
      mockGenerateText.mockRejectedValueOnce(
        new Error(`Upstream timeout: ${"y".repeat(280)} ending`),
      );
      await new TaggingService().generateSummary(
        uniqueText("log-projection-summary", 2),
        "any title",
      );
      const calls = (logger.warn as any).mock.calls as unknown[][];
      const failureEntry = calls.find(
        ([label]: unknown[]) =>
          typeof label === "string" &&
          (label as string).includes("Summary generation failed"),
      );
      expect(failureEntry).toBeDefined();
      const meta = failureEntry![1] as {
        error?: { name?: unknown; message?: unknown };
      };
      expect((meta.error?.message as string).length).toBeLessThanOrEqual(220);
      expect(meta.error?.message as string).toMatch(/\u2026\[\+\d+\]/);
      expect(meta.error).not.toHaveProperty("stack");
    });
  });
});
