import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bookmarkAIServiceMock = vi.hoisted(() => ({
  summarize: vi.fn(),
  generateDetailedContent: vi.fn(),
  batchSummarize: vi.fn(),
  batchGenerateOverviews: vi.fn(),
  generateMissingEmbeddings: vi.fn(),
  batchGenerateOverviewsByIds: vi.fn(),
}));

vi.mock("../../services/BookmarkAIService", () => ({
  bookmarkAIService: bookmarkAIServiceMock,
}));

import { useBookmarkAI } from "../../hooks/useBookmarkAI";

const bookmark = { id: "bookmark-1", title: "Test" } as any;
const translate = vi.fn((key: string) => key) as any;
const aiManager = {} as any;

function renderAIHook() {
  return renderHook(() => useBookmarkAI(translate, aiManager, [bookmark]));
}

describe("useBookmarkAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of Object.values(bookmarkAIServiceMock)) {
      method.mockResolvedValue(undefined);
    }
  });

  it("completes every operation and clears its loading state", async () => {
    bookmarkAIServiceMock.batchSummarize.mockImplementation(
      async (_bookmarks, _t, _manager, onProgress) => onProgress("bookmark-1"),
    );
    bookmarkAIServiceMock.batchGenerateOverviews.mockImplementation(
      async (_bookmarks, _t, _manager, onProgress) => onProgress("bookmark-1"),
    );

    const { result } = renderAIHook();
    await act(async () => {
      await result.current.handleSummarize(bookmark);
      await result.current.handleGenerateDetailedContent(bookmark);
      await result.current.handleSummarizeAll();
      await result.current.handleGenerateAllOverviews();
      await result.current.handleGenerateMissingEmbeddings();
      await result.current.handleBulkGenerateOverviews(new Set([bookmark.id]));
    });

    expect(bookmarkAIServiceMock.summarize).toHaveBeenCalledWith(
      bookmark,
      translate,
      aiManager,
      expect.any(AbortSignal),
    );
    expect(bookmarkAIServiceMock.generateDetailedContent).toHaveBeenCalledWith(
      bookmark,
      translate,
      aiManager,
      expect.any(AbortSignal),
    );
    expect(bookmarkAIServiceMock.batchSummarize).toHaveBeenCalled();
    expect(bookmarkAIServiceMock.batchGenerateOverviews).toHaveBeenCalled();
    expect(bookmarkAIServiceMock.generateMissingEmbeddings).toHaveBeenCalledWith(
      [bookmark],
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(bookmarkAIServiceMock.batchGenerateOverviewsByIds).toHaveBeenCalledWith(
      new Set([bookmark.id]),
      translate,
      aiManager,
      expect.any(AbortSignal),
    );
    expect(result.current.isSummarizing).toBeNull();
    expect(result.current.isSummarizingAll).toBe(false);
    expect(result.current.isGeneratingAllOverviews).toBe(false);
    expect(result.current.isGeneratingContent).toBeNull();
    expect(result.current.isGeneratingEmbeddings).toBe(false);
  });

  it("converts Error and non-Error failures into user-facing state", async () => {
    bookmarkAIServiceMock.summarize.mockRejectedValueOnce(new Error("summary failed"));
    bookmarkAIServiceMock.generateDetailedContent.mockRejectedValueOnce("content failed");
    bookmarkAIServiceMock.batchSummarize.mockRejectedValueOnce(new Error("batch failed"));
    bookmarkAIServiceMock.batchGenerateOverviews.mockRejectedValueOnce("overview failed");
    bookmarkAIServiceMock.generateMissingEmbeddings.mockRejectedValueOnce(
      new Error("embedding failed"),
    );

    const { result } = renderAIHook();
    await act(async () => {
      await result.current.handleSummarize(bookmark);
    });
    expect(result.current.error).toBe("summary failed");
    await act(async () => {
      await result.current.handleGenerateDetailedContent(bookmark);
    });
    expect(result.current.error).toBe("content failed");
    await act(async () => {
      await result.current.handleSummarizeAll();
    });
    expect(result.current.error).toBe("batch failed");
    await act(async () => {
      await result.current.handleGenerateAllOverviews();
    });
    expect(result.current.error).toBe("overview failed");
    await act(async () => {
      await result.current.handleGenerateMissingEmbeddings();
    });
    expect(result.current.error).toBe("embedding failed");

    expect(result.current.isSummarizing).toBeNull();
    expect(result.current.isSummarizingAll).toBe(false);
    expect(result.current.isGeneratingAllOverviews).toBe(false);
    expect(result.current.isGeneratingContent).toBeNull();
    expect(result.current.isGeneratingEmbeddings).toBe(false);
  });

  it("discards a summary resolved after unmount without touching state", async () => {
    let resolveSummary!: (value: void) => void;
    bookmarkAIServiceMock.summarize.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSummary = resolve;
        }),
    );

    const { result, unmount } = renderAIHook();
    act(() => {
      void result.current.handleSummarize(bookmark);
    });
    expect(bookmarkAIServiceMock.summarize).toHaveBeenCalled();

    unmount();
    await act(async () => {
      resolveSummary();
    });
    expect(bookmarkAIServiceMock.summarize.mock.calls[0]![3].aborted).toBe(true);
  });

  it("always clears bulk overview state and propagates its failure", async () => {
    const failure = new Error("bulk failed");
    bookmarkAIServiceMock.batchGenerateOverviewsByIds.mockRejectedValueOnce(failure);
    const { result } = renderAIHook();

    await expect(
      act(async () => result.current.handleBulkGenerateOverviews(new Set(["x"]))),
    ).rejects.toThrow("bulk failed");
    expect(result.current.isGeneratingAllOverviews).toBe(false);
  });
});
