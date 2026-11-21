import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/BookmarkAIService", () => ({
  bookmarkAIService: {
    summarize: vi.fn().mockResolvedValue(undefined),
    generateDetailedContent: vi.fn().mockResolvedValue(undefined),
    batchSummarize: vi.fn().mockResolvedValue(undefined),
    batchGenerateOverviews: vi.fn().mockResolvedValue(undefined),
    batchGenerateOverviewsByIds: vi.fn().mockResolvedValue(undefined),
    generateMissingEmbeddings: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn() },
}));

import { bookmarkAIService } from "../../services/BookmarkAIService";
import { logger } from "../../utils/logger";
import { useBookmarkAI } from "../../hooks/useBookmarkAI";

const t = ((key: string) => key) as any;
const aiManager = {} as any;

const bookmark = (id: string) =>
  ({
    id,
    title: "Test",
    url: "https://example.com",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
  }) as any;

describe("useBookmarkAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (bookmarkAIService.summarize as any).mockResolvedValue(undefined);
    (bookmarkAIService.generateDetailedContent as any).mockResolvedValue(undefined);
    (bookmarkAIService.batchSummarize as any).mockImplementation((_b: any, _t: any, _m: any, cb: any) => {
      cb?.("1");
      return Promise.resolve();
    });
    (bookmarkAIService.batchGenerateOverviews as any).mockImplementation((_b: any, _t: any, _m: any, cb: any) => {
      cb?.("1");
      return Promise.resolve();
    });
    (bookmarkAIService.batchGenerateOverviewsByIds as any).mockResolvedValue(undefined);
    (bookmarkAIService.generateMissingEmbeddings as any).mockResolvedValue(undefined);
  });

  it("summarizes a single bookmark", async () => {
    const bm = bookmark("1");
    const { result } = renderHook(() => useBookmarkAI(t, aiManager, [bm]));

    await act(async () => {
      await result.current.handleSummarize(bm);
    });

    expect(result.current.isSummarizing).toBeNull();
    expect(bookmarkAIService.summarize).toHaveBeenCalledWith(
      bm,
      t,
      aiManager,
      expect.any(AbortSignal),
    );
  });

  it("generates detailed content for a single bookmark", async () => {
    const bm = bookmark("2");
    const { result } = renderHook(() => useBookmarkAI(t, aiManager, [bm]));

    await act(async () => {
      await result.current.handleGenerateDetailedContent(bm);
    });

    expect(result.current.isGeneratingContent).toBeNull();
    expect(bookmarkAIService.generateDetailedContent).toHaveBeenCalledWith(
      bm,
      t,
      aiManager,
      expect.any(AbortSignal),
    );
  });

  it("summarizes all bookmarks", async () => {
    const bookmarks = [bookmark("3")];
    const { result } = renderHook(() =>
      useBookmarkAI(t, aiManager, bookmarks),
    );

    await act(async () => {
      await result.current.handleSummarizeAll();
    });

    expect(result.current.isSummarizingAll).toBe(false);
    expect(bookmarkAIService.batchSummarize).toHaveBeenCalledWith(
      bookmarks,
      t,
      aiManager,
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it("generates all overviews", async () => {
    const bookmarks = [bookmark("4")];
    const { result } = renderHook(() =>
      useBookmarkAI(t, aiManager, bookmarks),
    );

    await act(async () => {
      await result.current.handleGenerateAllOverviews();
    });

    expect(result.current.isGeneratingAllOverviews).toBe(false);
    expect(bookmarkAIService.batchGenerateOverviews).toHaveBeenCalledWith(
      bookmarks,
      t,
      aiManager,
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it("generates missing embeddings", async () => {
    const bookmarks = [bookmark("5")];
    const { result } = renderHook(() =>
      useBookmarkAI(t, aiManager, bookmarks),
    );

    await act(async () => {
      await result.current.handleGenerateMissingEmbeddings();
    });

    expect(result.current.isGeneratingEmbeddings).toBe(false);
    expect(bookmarkAIService.generateMissingEmbeddings).toHaveBeenCalledWith(
      bookmarks,
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it("bulk generates overviews by ids", async () => {
    const { result } = renderHook(() =>
      useBookmarkAI(t, aiManager, []),
    );

    await act(async () => {
      await result.current.handleBulkGenerateOverviews(new Set(["a", "b"]));
    });

    expect(result.current.isGeneratingAllOverviews).toBe(false);
    expect(bookmarkAIService.batchGenerateOverviewsByIds).toHaveBeenCalledWith(
      new Set(["a", "b"]),
      t,
      aiManager,
      expect.any(AbortSignal),
    );
  });

  it("sets error when summarize throws", async () => {
    (bookmarkAIService.summarize as any).mockRejectedValue("failed");
    const { result } = renderHook(() =>
      useBookmarkAI(t, aiManager, [bookmark("6")]),
    );

    await act(async () => {
      await result.current.handleSummarize(bookmark("6"));
    });

    expect(result.current.error).toBe("failed");
    expect(logger.error).toHaveBeenCalledWith("Error summarizing", { error: "failed" });
  });

  it("sets error when summarize throws a non-Error value", async () => {
    (bookmarkAIService.summarize as any).mockRejectedValue(42);
    const { result } = renderHook(() =>
      useBookmarkAI(t, aiManager, [bookmark("7")]),
    );

    await act(async () => {
      await result.current.handleSummarize(bookmark("7"));
    });

    // String(42) = "42"
    expect(result.current.error).toBe("42");
  });

  it("sets error when generateDetailedContent throws", async () => {
    (bookmarkAIService.generateDetailedContent as any).mockRejectedValue(
      new Error("content failed"),
    );
    const bm = bookmark("8");
    const { result } = renderHook(() => useBookmarkAI(t, aiManager, [bm]));

    await act(async () => {
      await result.current.handleGenerateDetailedContent(bm);
    });

    expect(result.current.error).toBe("content failed");
    expect(logger.error).toHaveBeenCalledWith(
      "Error generating detailed content",
      { error: expect.any(Error) },
    );
  });
});
