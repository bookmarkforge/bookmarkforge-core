import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

const mockInitDB = vi.hoisted(() => vi.fn());
const mockGenerateText = vi.hoisted(() => vi.fn());
const mockSuggestTags = vi.hoisted(() => vi.fn());
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockBatchGenerateOverviewsByIds = vi.hoisted(() => vi.fn());
const mockSanitizeHtml = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

// Use alias paths to match Vite's internal module resolution
vi.mock("../../../db/database", () => ({ initDB: mockInitDB }));
vi.mock("../../../services/ai/ProviderManager", () => ({
  aiManager: { generateText: mockGenerateText },
}));
vi.mock("../../../services/ai/TaggingService", () => ({
  taggingService: { suggestTags: mockSuggestTags },
}));
vi.mock("../../../services/ai/RAGEngine", () => ({
  ragEngine: { generateEmbedding: mockGenerateEmbedding },
}));
vi.mock("../../../services/BookmarkAIService", () => ({
  bookmarkAIService: {
    batchGenerateOverviewsByIds: mockBatchGenerateOverviewsByIds,
  },
}));
vi.mock("../../../services/SanitizationService", () => ({
  SanitizationService: { sanitizeHtml: mockSanitizeHtml },
}));
vi.mock("../../../utils/logger", () => ({ logger: mockLogger }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));
vi.mock("../../../services/EncryptionService", () => ({
  encryptionService: {},
}));
vi.mock("../../../i18n", () => ({}));

import { useBookmarkBulkActions } from "../../../components/bookmarks/useBookmarkBulkActions";

const bookmarks = [
  {
    id: "bm-1",
    title: "First",
    summary: "",
    content: "content1",
    tags: ["a"],
    url: "https://a.com",
    createdAt: "2025-01-01",
    embedding: [],
  },
  {
    id: "bm-2",
    title: "Second",
    summary: "exists",
    content: "content2",
    tags: ["b"],
    url: "https://b.com",
    createdAt: "2025-01-02",
    embedding: [1, 2, 3],
  },
];

const selectedIds = new Set(["bm-1"]);

const mockDb = {
  bookmarks: {
    findOne: vi.fn((id: string) => ({
      exec: vi
        .fn()
        .mockResolvedValue(
          id === "bm-1" ? { tags: ["a"], incrementalPatch: vi.fn() } : null,
        ),
    })),
  },
  templates: { find: vi.fn(), insert: vi.fn() },
};

describe("useBookmarkBulkActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitDB.mockResolvedValue(mockDb as any);
  });

  it("returns initial state", () => {
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    expect(result.current.isBulkTagging).toBe(false);
    expect(result.current.isCleaningContent).toBe(false);
    expect(result.current.bulkTagInput).toBe("");
  });

  it("handleBulkSummarize returns if there is no selection", async () => {
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds: new Set(),
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkSummarize());
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("handleBulkSummarize llama aiManager.generateText", async () => {
    mockGenerateText.mockResolvedValue({ text: "summary" });
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError,
      }),
    );
    await act(() => result.current.handleBulkSummarize());
    expect(mockGenerateText).toHaveBeenCalled();
    expect(result.current.isSummarizingCollection).toBe(false);
  });

  it("handleBulkSummarize handles error", async () => {
    mockGenerateText.mockRejectedValue(new Error("API error"));
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError,
      }),
    );
    await act(() => result.current.handleBulkSummarize());
    expect(setError).toHaveBeenCalledWith("API error");
  });

  it("handleBulkAutoTag returns if there is no selection", async () => {
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds: new Set(),
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkAutoTag());
    expect(mockSuggestTags).not.toHaveBeenCalled();
  });

  it("handleBulkAddTag returns without input", async () => {
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkAddTag());
    expect(mockInitDB).not.toHaveBeenCalled();
  });

  it("ignores a concurrent duplicate bulk add-tag request", async () => {
    let resolvePatch!: () => void;
    const patchStarted = new Promise<void>((resolve) => {
      resolvePatch = resolve;
    });
    const mockPatch = vi.fn(async () => {
      await patchStarted;
    });
    mockInitDB.mockResolvedValue({
      bookmarks: {
        findOne: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue({ tags: ["a"], incrementalPatch: mockPatch }),
        })),
      },
    } as any);
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    act(() => result.current.setBulkTagInput("newtag"));
    let first!: Promise<void>;
    act(() => {
      first = result.current.handleBulkAddTag();
      void result.current.handleBulkAddTag();
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(mockPatch).toHaveBeenCalledTimes(1);
    resolvePatch();
    await act(() => first);
  });

  it("handleBulkAddTag adds tag to selected bookmarks", async () => {
    const mockPatch = vi.fn();
    mockInitDB.mockResolvedValue({
      bookmarks: {
        findOne: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue({ tags: ["a"], incrementalPatch: mockPatch }),
        })),
      },
    } as any);
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    act(() => result.current.setBulkTagInput("newtag"));
    await act(() => result.current.handleBulkAddTag());
    expect(mockPatch).toHaveBeenCalledWith({ tags: ["a", "newtag"] });
    expect(result.current.bulkTagInput).toBe("");
  });

  it("handleBulkRemoveTag returns without input", async () => {
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkRemoveTag());
    expect(mockInitDB).not.toHaveBeenCalled();
  });

  it("handleBulkClearTags clears tags", async () => {
    const mockPatch = vi.fn();
    mockInitDB.mockResolvedValue({
      bookmarks: {
        findOne: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue({ tags: ["a"], incrementalPatch: mockPatch }),
        })),
      },
    } as any);
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkClearTags());
    expect(mockPatch).toHaveBeenCalledWith({ tags: [] });
  });

  it("handleBulkDelete marks as deleted", async () => {
    const mockPatch = vi.fn();
    mockInitDB.mockResolvedValue({
      bookmarks: {
        findOne: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue({ tags: ["a"], incrementalPatch: mockPatch }),
        })),
      },
    } as any);
    const setSelected = vi.fn();
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: setSelected,
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkDelete());
    expect(mockPatch).toHaveBeenCalled();
    expect(setSelected).toHaveBeenCalledWith(new Set());
  });

  it("handleBulkGenerateEmbeddings generates embeddings", async () => {
    mockGenerateEmbedding.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkGenerateEmbeddings());
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("content1");
  });

  it("handleBulkCleanContent cleans content", async () => {
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkCleanContent());
    expect(result.current.isCleaningContent).toBe(false);
  });

  // ── handleBulkGenerateOverviews ──

  it("handleBulkGenerateOverviews returns if there is no selection", async () => {
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds: new Set(),
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkGenerateOverviews());
    expect(mockBatchGenerateOverviewsByIds).not.toHaveBeenCalled();
  });

  it("handleBulkGenerateOverviews llama batchGenerateOverviewsByIds", async () => {
    mockBatchGenerateOverviewsByIds.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkGenerateOverviews());
    expect(mockBatchGenerateOverviewsByIds).toHaveBeenCalledWith(
      selectedIds,
      expect.any(Function),
      expect.anything(),
      expect.any(AbortSignal),
    );
    expect(result.current.isGeneratingAllOverviews).toBe(false);
  });

  it("handleBulkGenerateOverviews handles error and resets state", async () => {
    mockBatchGenerateOverviewsByIds.mockRejectedValue(new Error("batch fail"));
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkGenerateOverviews());
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Bulk generate overviews failed",
      { error: expect.any(Error) },
    );
    expect(result.current.isGeneratingAllOverviews).toBe(false);
  });

  // ── handleBulkRemoveTag success ──

  it("handleBulkRemoveTag removes tag from selected bookmarks", async () => {
    const mockPatch = vi.fn();
    mockInitDB.mockResolvedValue({
      bookmarks: {
        findOne: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue({ tags: ["a", "toremove"], incrementalPatch: mockPatch }),
        })),
      },
    } as any);
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    act(() => result.current.setBulkTagInput("toremove"));
    await act(() => result.current.handleBulkRemoveTag());
    expect(mockPatch).toHaveBeenCalledWith({ tags: ["a"] });
    expect(result.current.bulkTagInput).toBe("");
  });

  // ── handleBulkAutoTag success ──

  it("handleBulkAutoTag suggests and applies tags", async () => {
    mockSuggestTags.mockResolvedValue(["ai-tag", "auto"]);
    const mockPatch = vi.fn();
    mockInitDB.mockResolvedValue({
      bookmarks: {
        findOne: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue({ tags: ["a"], incrementalPatch: mockPatch }),
        })),
      },
    } as any);
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkAutoTag());
    expect(mockSuggestTags).toHaveBeenCalledWith("First  content1", "en", "First", ["a"], true);
    expect(mockPatch).toHaveBeenCalledWith({ tags: ["a", "ai-tag", "auto"] });
    expect(result.current.isBulkTagging).toBe(false);
  });

  it("handleBulkAutoTag does not apply if suggestTags returns empty", async () => {
    mockSuggestTags.mockResolvedValue([]);
    const mockPatch = vi.fn();
    mockInitDB.mockResolvedValue({
      bookmarks: {
        findOne: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue({ tags: ["a"], incrementalPatch: mockPatch }),
        })),
      },
    } as any);
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkAutoTag());
    expect(mockSuggestTags).toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  // ── handleBulkGenerateEmbeddings: skip existing ──

  it("handleBulkGenerateEmbeddings skips bookmarks with an existing embedding", async () => {
    mockGenerateEmbedding.mockResolvedValue(undefined);
    const bothSelected = new Set(["bm-1", "bm-2"]);
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds: bothSelected,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkGenerateEmbeddings());
    // bm-1: embedding = [] → should generate
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("content1");
    // bm-2: embedding = [1,2,3] → se saltea
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
  });

  // ── handleBulkCleanContent: skip doc without content ──

  it("handleBulkCleanContent skips docs without content", async () => {
    mockSanitizeHtml.mockReturnValue("<p>clean</p>");
    mockInitDB.mockResolvedValue({
      bookmarks: {
        findOne: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue({ content: null, incrementalPatch: vi.fn() }),
        })),
      },
    } as any);
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkCleanContent());
    expect(mockSanitizeHtml).not.toHaveBeenCalled();
    expect(result.current.isCleaningContent).toBe(false);
  });

  it("handleBulkCleanContent applies sanitization only if changed", async () => {
    const mockPatch = vi.fn();
    mockSanitizeHtml.mockReturnValue("<p>clean</p>");
    mockInitDB.mockResolvedValue({
      bookmarks: {
        findOne: vi.fn(() => ({
          exec: vi
            .fn()
            .mockResolvedValue({ content: "<p>dirty</p>", incrementalPatch: mockPatch }),
        })),
      },
    } as any);
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkCleanContent());
    expect(mockSanitizeHtml).toHaveBeenCalledWith("<p>dirty</p>");
    expect(mockPatch).toHaveBeenCalledWith({ content: "<p>clean</p>" });
  });

  it("handleBulkCleanContent does not apply a patch if the content is identical", async () => {
    const mockPatch = vi.fn();
    mockSanitizeHtml.mockReturnValue("<p>same</p>");
    mockInitDB.mockResolvedValue({
      bookmarks: {
        findOne: vi.fn(() => ({
          exec: vi
            .fn()
            .mockResolvedValue({ content: "<p>same</p>", incrementalPatch: mockPatch }),
        })),
      },
    } as any);
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkCleanContent());
    expect(mockSanitizeHtml).toHaveBeenCalledWith("<p>same</p>");
    expect(mockPatch).not.toHaveBeenCalled();
  });

  // ── Error paths ──

  it("handleBulkAddTag handles DB error", async () => {
    mockInitDB.mockRejectedValue(new Error("DB down"));
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    act(() => result.current.setBulkTagInput("tag"));
    await act(() => result.current.handleBulkAddTag());
    expect(mockLogger.error).toHaveBeenCalledWith("Bulk add tag failed", {
      error: expect.any(Error),
    });
  });

  it("handleBulkRemoveTag handles DB error", async () => {
    mockInitDB.mockRejectedValue(new Error("DB down"));
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    act(() => result.current.setBulkTagInput("tag"));
    await act(() => result.current.handleBulkRemoveTag());
    expect(mockLogger.error).toHaveBeenCalledWith("Bulk remove tag failed", {
      error: expect.any(Error),
    });
  });

  it("handleBulkClearTags handles DB error", async () => {
    mockInitDB.mockRejectedValue(new Error("DB down"));
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkClearTags());
    expect(mockLogger.error).toHaveBeenCalledWith("Bulk clear tags failed", {
      error: expect.any(Error),
    });
  });

  it("handleBulkDelete handles DB error", async () => {
    mockInitDB.mockRejectedValue(new Error("DB down"));
    const setSelected = vi.fn();
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: setSelected,
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkDelete());
    expect(mockLogger.error).toHaveBeenCalledWith("Bulk delete failed", {
      error: expect.any(Error),
    });
    expect(setSelected).not.toHaveBeenCalled();
  });

  it("handleBulkGenerateEmbeddings handles error", async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error("embed fail"));
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkGenerateEmbeddings());
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Bulk generate embeddings failed",
      { error: expect.any(Error) },
    );
    expect(result.current.isGeneratingEmbeddings).toBe(false);
  });

  it("handleBulkCleanContent handles DB error", async () => {
    mockInitDB.mockRejectedValue(new Error("DB down"));
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds,
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkCleanContent());
    expect(mockLogger.error).toHaveBeenCalledWith("Bulk clean content failed", {
      error: expect.any(Error),
    });
    expect(result.current.isCleaningContent).toBe(false);
  });

  // ── Early-return paths (no selection) ──

  it("handleBulkDelete returns if there is no selection", async () => {
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds: new Set(),
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkDelete());
    expect(mockInitDB).not.toHaveBeenCalled();
  });

  it("handleBulkClearTags returns if there is no selection", async () => {
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds: new Set(),
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkClearTags());
    expect(mockInitDB).not.toHaveBeenCalled();
  });

  it("handleBulkGenerateEmbeddings returns if there is no selection", async () => {
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds: new Set(),
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkGenerateEmbeddings());
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it("handleBulkCleanContent returns if there is no selection", async () => {
    mockSanitizeHtml.mockReturnValue("<p>clean</p>");
    const { result } = renderHook(() =>
      useBookmarkBulkActions({
        bookmarks: bookmarks as any,
        selectedIds: new Set(),
        setSelectedIds: vi.fn(),
        setError: vi.fn(),
      }),
    );
    await act(() => result.current.handleBulkCleanContent());
    expect(mockSanitizeHtml).not.toHaveBeenCalled();
  });

});
