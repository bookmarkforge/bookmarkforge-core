/**
 * Tests for BookmarkAIService
 * Mocks initDB, ragEngine and logger
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockInitDB = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    bookmarks: {
      findOne: vi.fn(),
      find: vi.fn(),
    },
  }),
);
vi.mock("../../db/database", () => ({
  initDB: vi.fn(() => mockInitDB()),
}));

const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
vi.mock("../../services/ai/RAGEngine", () => ({
  ragEngine: {
    generateEmbedding: mockGenerateEmbedding,
  },
}));

let mockDb: any;

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { bookmarkAIService } from "../../services/BookmarkAIService";

describe("BookmarkAIService", () => {
  const mockBookmark = {
    id: "bm-1",
    url: "https://example.com",
    title: "Test Page",
    summary: "",
    content: "",
    embedding: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockAiManager = {
    generateText: vi.fn(),
    getProviderInfo: vi.fn(),
  };

  const mockT = vi.fn((key: string, _opts?: any) => {
    const map: Record<string, string> = {
      summarizePrompt: "Summarize this: {title} {url}",
      summarizeSystemPrompt: "You are a summarizer.",
      detailedOverviewPrompt: "Detail: {title} {url}",
      detailedOverviewSystemPrompt: "You are a detailed writer.",
      couldNotGenerateContent: "Could not generate content.",
    };
    return map[key] || key;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockInitDB.mockResolvedValue({
      bookmarks: {
        findOne: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue(null),
        })),
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([]),
        })),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("summarize", () => {
    it("should generate summary and embedding", async () => {
      const doc = {
        incrementalPatch: vi.fn().mockResolvedValue(undefined),
      };
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue(doc),
          })),
        },
      });
      mockAiManager.generateText.mockResolvedValue({ text: "Summary text" });
      mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);

      await bookmarkAIService.summarize(
        mockBookmark as any,
        mockT as any,
        mockAiManager as any,
      );

      expect(mockAiManager.generateText).toHaveBeenCalled();
      expect(mockGenerateEmbedding).toHaveBeenCalled();
      expect(doc.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: "Summary text",
          embedding: [0.1, 0.2, 0.3],
        }),
      );
    });

    it("should handle embedding error without failing", async () => {
      const doc = { incrementalPatch: vi.fn() };
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(doc) })),
        },
      });
      mockAiManager.generateText.mockResolvedValue({ text: "Summary" });
      mockGenerateEmbedding.mockRejectedValue(new Error("Embedding failed"));

      await bookmarkAIService.summarize(
        mockBookmark as any,
        mockT as any,
        mockAiManager as any,
      );
      expect(doc.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({ summary: "Summary" }),
      );
    });

    it("should not patch if doc does not exist", async () => {
      mockAiManager.generateText.mockResolvedValue({ text: "Summary" });
      await bookmarkAIService.summarize(
        mockBookmark as any,
        mockT as any,
        mockAiManager as any,
      );
    });

    it("should abort without calling AI or persisting if already cancelled", async () => {
      const controller = new AbortController();
      controller.abort();
      mockAiManager.generateText.mockResolvedValue({ text: "Summary" });

      await expect(
        bookmarkAIService.summarize(
          mockBookmark as any,
          mockT as any,
          mockAiManager as any,
          controller.signal,
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(mockAiManager.generateText).not.toHaveBeenCalled();
      expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    });

    it("should handle generateText throwing an error", async () => {
      mockAiManager.generateText.mockRejectedValue(new Error("AI error"));
      await expect(
        bookmarkAIService.summarize(
          mockBookmark as any,
          mockT as any,
          mockAiManager as any,
        ),
      ).rejects.toThrow("AI error");
    });
  });

  describe("generateDetailedContent", () => {
    it("should generate detailed content with gemini", async () => {
      const doc = { incrementalPatch: vi.fn() };
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(doc) })),
        },
      });
      mockAiManager.getProviderInfo.mockReturnValue({ provider: "gemini" });
      mockAiManager.generateText.mockResolvedValue({
        text: "Detailed content",
      });

      await bookmarkAIService.generateDetailedContent(
        mockBookmark as any,
        mockT as any,
        mockAiManager as any,
      );
      expect(mockAiManager.generateText).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ tools: [{ urlContext: {} }] }),
      );
      expect(doc.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Detailed content" }),
      );
    });

    it("should generate content with other providers", async () => {
      const doc = { incrementalPatch: vi.fn() };
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(doc) })),
        },
      });
      mockAiManager.getProviderInfo.mockReturnValue({ provider: "openai" });
      mockAiManager.generateText.mockResolvedValue({ text: "OpenAI content" });

      await bookmarkAIService.generateDetailedContent(
        mockBookmark as any,
        mockT as any,
        mockAiManager as any,
      );
      expect(doc.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({ content: "OpenAI content" }),
      );
    });

    it("should use fallback when generateText returns empty text", async () => {
      const doc = { incrementalPatch: vi.fn() };
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(doc) })),
        },
      });
      mockAiManager.getProviderInfo.mockReturnValue({ provider: "openai" });
      mockAiManager.generateText.mockResolvedValue({ text: "" });

      await bookmarkAIService.generateDetailedContent(
        mockBookmark as any,
        mockT as any,
        mockAiManager as any,
      );
      expect(doc.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Could not generate content." }),
      );
    });
  });

  describe("batchSummarize", () => {
    it("should process bookmarks in batches of 3", async () => {
      const bookmarks = Array.from({ length: 5 }, (_, i) => ({
        id: `bm-${i}`,
        title: `Bookmark ${i}`,
        url: `https://example.com/${i}`,
        summary: i === 0 ? "exists" : null,
        embedding: [],
        content: "",
      }));
      const reportProgress = vi.fn();
      mockAiManager.generateText.mockResolvedValue({ text: "Batch summary" });
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
        },
      });

      await bookmarkAIService.batchSummarize(
        bookmarks as any,
        mockT as any,
        mockAiManager as any,
        reportProgress,
      );
      expect(reportProgress).toHaveBeenCalledTimes(4);
    });

    it("should continue when an individual bookmark fails", async () => {
      const bookmarks = Array.from({ length: 2 }, (_, i) => ({
        id: `bm-${i}`,
        title: `Bookmark ${i}`,
        url: `https://example.com/${i}`,
        summary: null,
        embedding: [],
        content: "",
      }));
      const reportProgress = vi.fn();
      mockAiManager.generateText
        .mockRejectedValueOnce(new Error("First fails"))
        .mockResolvedValueOnce({ text: "Second succeeds" });
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
        },
      });

      await bookmarkAIService.batchSummarize(
        bookmarks as any,
        mockT as any,
        mockAiManager as any,
        reportProgress,
      );
      expect(reportProgress).toHaveBeenCalledTimes(2);
    });

    it("should stop the batch if the signal aborts between batches", async () => {
      const bookmarks = Array.from({ length: 6 }, (_, i) => ({
        id: `bm-${i}`,
        title: `Bookmark ${i}`,
        url: `https://example.com/${i}`,
        summary: null,
        embedding: [],
        content: "",
      }));
      const reportProgress = vi.fn();
      let signal!: AbortSignal;
      const controller = new AbortController();
      signal = controller.signal;
      let callCount = 0;
      mockAiManager.generateText.mockImplementation(async () => {
        callCount += 1;
        if (callCount === 3) {
          controller.abort();
        }
        return { text: "Batch summary" };
      });
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
        },
      });

      await expect(
        bookmarkAIService.batchSummarize(
          bookmarks as any,
          mockT as any,
          mockAiManager as any,
          reportProgress,
          signal,
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
      // The third item aborts; batch 2 (items 4-6) must never start.
      expect(callCount).toBeLessThanOrEqual(3);
      expect(reportProgress).toHaveBeenCalledTimes(3);
    });

    it("should do nothing if all already have a summary", async () => {
      const bookmarks = [
        { id: "b1", summary: "exists" },
      ];
      const reportProgress = vi.fn();
      await bookmarkAIService.batchSummarize(
        bookmarks as any,
        mockT as any,
        mockAiManager as any,
        reportProgress,
      );
      expect(reportProgress).not.toHaveBeenCalled();
    });
  });

  describe("batchGenerateOverviews", () => {
    it("should generate overviews for bookmarks without content", async () => {
      const bookmarks = [
        {
          id: "b1",
          title: "B1",
          url: "https://b1.com",
          content: "has content",
        },
        { id: "b2", title: "B2", url: "https://b2.com", content: "" },
        { id: "b3", title: "B3", url: "https://b3.com", content: null },
      ];
      const reportProgress = vi.fn();
      mockAiManager.getProviderInfo.mockReturnValue({ provider: "openai" });
      mockAiManager.generateText.mockResolvedValue({ text: "Overview" });
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
        },
      });

      await bookmarkAIService.batchGenerateOverviews(
        bookmarks as any,
        mockT as any,
        mockAiManager as any,
        reportProgress,
      );
      expect(reportProgress).toHaveBeenCalledTimes(2);
    });

    it("should continue when an individual overview fails", async () => {
      const bookmarks = [
        { id: "b1", title: "B1", url: "https://b1.com", content: "" },
      ];
      const reportProgress = vi.fn();
      mockAiManager.getProviderInfo.mockReturnValue({ provider: "openai" });
      mockAiManager.generateText.mockRejectedValue(new Error("Overview AI fail"));
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
        },
      });

      await bookmarkAIService.batchGenerateOverviews(
        bookmarks as any,
        mockT as any,
        mockAiManager as any,
        reportProgress,
      );
      expect(reportProgress).toHaveBeenCalledTimes(1);
    });
  });

  describe("batchGenerateOverviewsByIds", () => {
    it("should generate overviews for IDs without content", async () => {
      const doc = {
        id: "b1", title: "B1", url: "https://b1.com",
        content: "", tags: [], embedding: [], summary: "",
        toJSON: () => ({ id: "b1", title: "B1", url: "https://b1.com", content: "", tags: [], embedding: [], summary: "" }),
        incrementalPatch: vi.fn(),
      };
      const docs = [doc];
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue(doc),
          })),
          find: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue(docs),
          })),
        },
      });
      mockAiManager.getProviderInfo.mockReturnValue({ provider: "openai" });
      mockAiManager.generateText.mockResolvedValue({ text: "Overview by id" });

      await bookmarkAIService.batchGenerateOverviewsByIds(
        new Set(["b1"]),
        mockT as any,
        mockAiManager as any,
      );
      expect(docs[0]!.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Overview by id" }),
      );
    });

    it("should do nothing for empty IDs", async () => {
      await bookmarkAIService.batchGenerateOverviewsByIds(
        new Set(),
        mockT as any,
        mockAiManager as any,
      );
      // no error, no patches
    });
  });

  describe("generateMissingEmbeddings", () => {
    it("should generate embeddings for bookmarks missing them", async () => {
      const bookmarks = [
        {
          id: "b1",
          title: "B1",
          url: "https://b1.com",
          embedding: [1, 2],
          summary: "sum",
          content: "con",
        },
        {
          id: "b2",
          title: "B2",
          url: "https://b2.com",
          embedding: [],
          summary: "",
          content: "",
        },
        { id: "b3", title: "B3", url: "https://b3.com", embedding: null },
      ];
      const reportProgress = vi.fn();
      mockGenerateEmbedding.mockResolvedValue([0.5, 0.6]);
      const doc = { incrementalPatch: vi.fn() };
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(doc) })),
        },
      });

      await bookmarkAIService.generateMissingEmbeddings(
        bookmarks as any,
        reportProgress,
      );
      expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2);
      expect(reportProgress).toHaveBeenCalledTimes(2);
    });

    it("should not generate if all already have embeddings", async () => {
      const reportProgress = vi.fn();
      await bookmarkAIService.generateMissingEmbeddings(
        [{ id: "b1", embedding: [1] }] as any,
        reportProgress,
      );
      expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    });

    it("should continue when an individual embedding fails", async () => {
      const bookmarks = [
        { id: "b1", title: "B1", url: "https://b1.com", embedding: [], summary: "", content: "" },
        { id: "b2", title: "B2", url: "https://b2.com", embedding: [], summary: "", content: "" },
      ];
      const reportProgress = vi.fn();
      mockGenerateEmbedding
        .mockRejectedValueOnce(new Error("Embed fail"))
        .mockResolvedValueOnce([0.5]);
      const doc = { incrementalPatch: vi.fn() };
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(doc) })),
        },
      });

      await bookmarkAIService.generateMissingEmbeddings(
        bookmarks as any,
        reportProgress,
      );
      expect(reportProgress).toHaveBeenCalledTimes(2);
    });
  });

  describe("log redaction of provider errors (anti-leak)", () => {
    it("projects provider errors through safeErrorForLog (bounded leak surface)", async () => {
      // Regression: when a provider's underlying HTTP / fetch error
      // embeds a fragment of the request body, the diagnostic log must
      // (a) include only the bounded { name, message } shape and
      // (b) cap the message length. The helper cannot redact content it
      // cannot detect, but it bounds the blast radius and never includes
      // the stack trace.
      const { logger } = await import("../../utils/logger");
      const { bookmarkAIService: svc } = await import(
        "../../services/BookmarkAIService"
      );
      const bookmarks = [
        {
          id: "b1",
          title: "Title",
          url: "https://b1.com",
          content: "Body",
          summary: "",
          tags: [],
        },
      ];
      const reportProgress = vi.fn();
      const hostile = new Error(
        `Provider 4xx echoing prompt: "${"x".repeat(300)}" full payload`,
      );
      mockGenerateEmbedding.mockRejectedValueOnce(hostile);
      const doc = { incrementalPatch: vi.fn() };
      mockInitDB.mockResolvedValue({
        bookmarks: {
          findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(doc) })),
        },
      });

      await svc.generateMissingEmbeddings(bookmarks as any, reportProgress);

      const errorCalls = (logger.error as any).mock.calls as unknown[][];
      expect(errorCalls.length).toBeGreaterThan(0);
      const last = errorCalls[errorCalls.length - 1]!;
      const meta = last[1] as {
        bookmarkId?: unknown;
        error?: { name?: unknown; message?: unknown };
      };
      expect(meta.bookmarkId).toBe("b1");
      expect(typeof meta.error?.name).toBe("string");
      expect(typeof meta.error?.message).toBe("string");
      // The leak surface is bounded: no stack, message ≤ 220 chars with
      // truncation marker.
      expect((meta.error?.message as string).length).toBeLessThanOrEqual(220);
      expect(meta.error?.message as string).toMatch(/\u2026\[\+\d+\]/);
      expect(meta.error).not.toHaveProperty("stack");
      expect("message" in meta.error!).toBe(true);
    });
  });
});
