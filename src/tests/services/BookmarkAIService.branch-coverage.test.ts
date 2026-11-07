import { describe, it, expect, vi, beforeEach } from "vitest";
import { bookmarkAIService } from "../../services/BookmarkAIService";
import type { AIManager, TranslationFunction, Bookmark } from "../../types";

// The real RAGEngine worker pool times out (60s) inside unit tests; mock it
// at MODULE scope so every path resolves instantly. The previous in-test
// vi.doMock calls could never apply — the module was already imported —
// which is exactly what produced the two 60s hangs in this suite.
const { mockGenerateEmbedding } = vi.hoisted(() => ({
  mockGenerateEmbedding: vi.fn(),
}));
vi.mock("../../services/ai/RAGEngine", () => ({
  ragEngine: { generateEmbedding: mockGenerateEmbedding },
}));

describe("BookmarkAIService - Branch Coverage", () => {
  let mockAIManager: AIManager;
  let mockT: TranslationFunction;

  beforeEach(() => {
    mockGenerateEmbedding.mockReset().mockResolvedValue([0.1, 0.2, 0.3]);
    mockAIManager = {
      generateText: vi.fn(),
      getProviderInfo: vi.fn(() => ({ provider: "gemini", model: "gemini-pro" })),
    } as unknown as AIManager;

    // Default mock for generateText
    vi.mocked(mockAIManager.generateText).mockResolvedValue({
      text: "Test response",
      provider: "gemini",
    });
    
    mockT = vi.fn((key: string, params?: Record<string, unknown>) => {
      if (key === "summarizePrompt") {
        return `Summary for ${params?.title} - ${params?.url}`;
      }
      if (key === "summarizeSystemPrompt") {
        return "Summarize this content";
      }
      if (key === "detailedOverviewPrompt") {
        return `Detailed overview for ${params?.title} - ${params?.url}`;
      }
      if (key === "detailedOverviewSystemPrompt") {
        return "Generate detailed overview";
      }
      if (key === "couldNotGenerateContent") {
        return "Could not generate content";
      }
      if (key === "app.untitledDocument") {
        return "Untitled Document";
      }
      return key;
    }) as TranslationFunction;
  });

  describe("summarize", () => {
    it("should handle embedding generation failure gracefully", async () => {
      const bookmark: Bookmark = {
        id: "test-1",
        url: "https://example.com",
        urlHash: "abc123",
        title: "Test Bookmark",
        content: "",
        summary: "",
        tags: [],
        relatedLinks: [],
        embedding: [],
        processed: false,
        isPrivate: false,
        isDeleted: false,
        visitCount: 0,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      vi.mocked(mockAIManager.generateText).mockResolvedValue({
        text: "Test summary",
        provider: "gemini",
      });

      // Embedding generation fails for this bookmark.
      mockGenerateEmbedding.mockRejectedValueOnce(new Error("Embedding failed"));

      await bookmarkAIService.summarize(bookmark, mockT, mockAIManager);

      // Should complete successfully despite embedding failure
      expect(mockAIManager.generateText).toHaveBeenCalled();
    });

    it("should handle successful embedding generation", async () => {
      const bookmark: Bookmark = {
        id: "test-2",
        url: "https://example.com",
        urlHash: "abc124",
        title: "Test Bookmark",
        content: "",
        summary: "",
        tags: [],
        relatedLinks: [],
        embedding: [],
        processed: false,
        isPrivate: false,
        isDeleted: false,
        visitCount: 0,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      vi.mocked(mockAIManager.generateText).mockResolvedValue({
        text: "Test summary",
        provider: "gemini",
      });

      // Embedding generation succeeds via the beforeEach default.

      await bookmarkAIService.summarize(bookmark, mockT, mockAIManager);

      expect(mockAIManager.generateText).toHaveBeenCalled();
    });
  });

  describe("generateDetailedContent", () => {
    it("should handle Gemini provider with tools", async () => {
      const bookmark: Bookmark = {
        id: "test-3",
        url: "https://example.com",
        urlHash: "abc125",
        title: "Test Bookmark",
        content: "",
        summary: "",
        tags: [],
        relatedLinks: [],
        embedding: [],
        processed: false,
        isPrivate: false,
        isDeleted: false,
        visitCount: 0,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      vi.mocked(mockAIManager.generateText).mockResolvedValue({
        text: "Detailed content",
        provider: "gemini",
      });

      await bookmarkAIService.generateDetailedContent(bookmark, mockT, mockAIManager);

      expect(mockAIManager.generateText).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          tools: [{ urlContext: {} }],
        }),
      );
    });

    it("should handle non-Gemini provider without tools", async () => {
      const bookmark: Bookmark = {
        id: "test-4",
        url: "https://example.com",
        urlHash: "abc126",
        title: "Test Bookmark",
        content: "",
        summary: "",
        tags: [],
        relatedLinks: [],
        embedding: [],
        processed: false,
        isPrivate: false,
        isDeleted: false,
        visitCount: 0,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      mockAIManager.getProviderInfo = vi.fn(() => ({ provider: "openai", model: "gpt-4" }));
      vi.mocked(mockAIManager.generateText).mockResolvedValue({
        text: "Detailed content",
        provider: "gemini",
      });

      await bookmarkAIService.generateDetailedContent(bookmark, mockT, mockAIManager);

      // Non-Gemini providers get NO tools key at all (not even undefined).
      const callOpts = vi.mocked(mockAIManager.generateText).mock.calls[0]![2] as
        | Record<string, unknown>
        | undefined;
      expect(callOpts).not.toHaveProperty("tools");
      expect(callOpts?.isPrivate).toBe(false);
    });

    it("should handle AI generation failure", async () => {
      const bookmark: Bookmark = {
        id: "test-5",
        url: "https://example.com",
        urlHash: "abc127",
        title: "Test Bookmark",
        content: "",
        summary: "",
        tags: [],
        relatedLinks: [],
        embedding: [],
        processed: false,
        isPrivate: false,
        isDeleted: false,
        visitCount: 0,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      vi.mocked(mockAIManager.generateText).mockRejectedValue(new Error("AI failed"));

      await expect(
        bookmarkAIService.generateDetailedContent(bookmark, mockT, mockAIManager)
      ).rejects.toThrow("AI failed");
    });
  });

  describe("batchSummarize", () => {
    it("should handle empty bookmark list", async () => {
      const reportProgress = vi.fn();

      await bookmarkAIService.batchSummarize([], mockT, mockAIManager, reportProgress);

      expect(reportProgress).not.toHaveBeenCalled();
    });

    it("should handle already summarized bookmarks", async () => {
      const bookmarks: Bookmark[] = [
        {
          id: "test-6",
          url: "https://example.com",
          urlHash: "abc128",
          title: "Test Bookmark",
          content: "",
          summary: "Existing summary",
          tags: [],
          relatedLinks: [],
          embedding: [],
          processed: false,
          isPrivate: false,
          isDeleted: false,
          visitCount: 0,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      const reportProgress = vi.fn();

      await bookmarkAIService.batchSummarize(bookmarks, mockT, mockAIManager, reportProgress);

      expect(reportProgress).not.toHaveBeenCalled();
    });

    it("should handle partial failures in batch", async () => {
      const bookmarks: Bookmark[] = [
        {
          id: "test-7",
          url: "https://example.com",
          urlHash: "abc129",
          title: "Test Bookmark 1",
          content: "",
          summary: "",
          tags: [],
          relatedLinks: [],
          embedding: [],
          processed: false,
          isPrivate: false,
          isDeleted: false,
          visitCount: 0,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "test-8",
          url: "https://example.com",
          urlHash: "abc130",
          title: "Test Bookmark 2",
          content: "",
          summary: "",
          tags: [],
          relatedLinks: [],
          embedding: [],
          processed: false,
          isPrivate: false,
          isDeleted: false,
          visitCount: 0,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      vi.mocked(mockAIManager.generateText)
        .mockResolvedValueOnce({ text: "Summary 1", provider: "gemini" })
        .mockRejectedValueOnce(new Error("AI failed"));

      const reportProgress = vi.fn();

      await bookmarkAIService.batchSummarize(bookmarks, mockT, mockAIManager, reportProgress);

      // Should complete despite one failure
      expect(reportProgress).toHaveBeenCalled();
    });
  });

  describe("generateMissingEmbeddings", () => {
    it("should handle bookmarks with existing embeddings", async () => {
      const bookmarks: Bookmark[] = [
        {
          id: "test-9",
          url: "https://example.com",
          urlHash: "abc131",
          title: "Test Bookmark",
          content: "",
          summary: "",
          tags: [],
          relatedLinks: [],
          embedding: [0.1, 0.2, 0.3],
          processed: false,
          isPrivate: false,
          isDeleted: false,
          visitCount: 0,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      const reportProgress = vi.fn();

      await bookmarkAIService.generateMissingEmbeddings(bookmarks, reportProgress);

      expect(reportProgress).not.toHaveBeenCalled();
    });

    it("should handle empty embedding arrays", async () => {
      const bookmarks: Bookmark[] = [
        {
          id: "test-10",
          url: "https://example.com",
          urlHash: "abc132",
          title: "Test Bookmark",
          content: "",
          summary: "",
          tags: [],
          relatedLinks: [],
          embedding: [],
          processed: false,
          isPrivate: false,
          isDeleted: false,
          visitCount: 0,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      const reportProgress = vi.fn();

      await bookmarkAIService.generateMissingEmbeddings(bookmarks, reportProgress);

      expect(reportProgress).toHaveBeenCalled();
    });
  });
});