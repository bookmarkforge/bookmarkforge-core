import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockPrefetch = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../../services/ai/RAGEngine", () => ({
  ragEngine: { searchSimilar: vi.fn(), prefetch: mockPrefetch },
}));

vi.mock("../../../services/ai/SemanticSearchService", () => ({
  semanticSearchService: { expandQuery: vi.fn() },
  runWithTimeout: (
    operation: (signal: AbortSignal) => Promise<unknown>,
    _timeoutMs: number,
    signal?: AbortSignal,
  ) => operation(signal ?? new AbortController().signal),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

const mockBookmarks = [
  {
    id: "bm-1",
    title: "React Guide",
    url: "https://react.dev",
    summary: "React framework docs",
    content: "React is a UI library",
    tags: ["dev", "frontend"],
  },
  {
    id: "bm-2",
    title: "Design System",
    url: "https://design.com",
    summary: "UI design patterns",
    content: "Design tokens and components",
    tags: ["design"],
  },
  {
    id: "bm-3",
    title: "Node.js",
    url: "https://nodejs.org",
    summary: "Node runtime",
    content: "JavaScript runtime",
    tags: ["dev", "backend"],
  },
];

describe("useBookmarkSearch", () => {
  let useBookmarkSearch: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../../components/bookmarks/useBookmarkSearch");
    useBookmarkSearch = mod.useBookmarkSearch;
  });

  it("should initialize with default state", () => {
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    expect(result.current.searchQuery).toBe("");
    expect(result.current.isSemanticSearch).toBe(false);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.selectedTags).toEqual([]);
    expect(result.current.filteredBookmarks).toEqual(mockBookmarks);
  });

  it("should filter by title after debounce", async () => {
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setSearchQuery("React"));
    await waitFor(() =>
      expect(result.current.filteredBookmarks).toHaveLength(1),
    );
    expect(result.current.filteredBookmarks[0].id).toBe("bm-1");
  });

  it("should filter by url after debounce", async () => {
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setSearchQuery("nodejs"));
    await waitFor(() =>
      expect(result.current.filteredBookmarks).toHaveLength(1),
    );
    expect(result.current.filteredBookmarks[0].id).toBe("bm-3");
  });

  it("should filter by summary after debounce", async () => {
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setSearchQuery("patterns"));
    await waitFor(() =>
      expect(result.current.filteredBookmarks).toHaveLength(1),
    );
    expect(result.current.filteredBookmarks[0].id).toBe("bm-2");
  });

  it("should filter by content after debounce", async () => {
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setSearchQuery("UI library"));
    await waitFor(() =>
      expect(result.current.filteredBookmarks).toHaveLength(1),
    );
    expect(result.current.filteredBookmarks[0].id).toBe("bm-1");
  });

  it("should filter by tags after debounce", async () => {
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setSearchQuery("frontend"));
    await waitFor(() =>
      expect(result.current.filteredBookmarks).toHaveLength(1),
    );
    expect(result.current.filteredBookmarks[0].id).toBe("bm-1");
  });

  it("should return all bookmarks when query is empty", () => {
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    expect(result.current.filteredBookmarks).toEqual(mockBookmarks);
  });

  it("should return all bookmarks when query has only whitespace after debounce", async () => {
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setSearchQuery("   "));
    await waitFor(() =>
      expect(result.current.filteredBookmarks).toEqual(mockBookmarks),
    );
  });

  it("should return no bookmarks when query matches nothing after debounce", async () => {
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setSearchQuery("xyznonexistent"));
    await waitFor(() =>
      expect(result.current.filteredBookmarks).toHaveLength(0),
    );
  });

  it("should filter by selected tags", () => {
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setSelectedTags(["design"]));
    expect(result.current.filteredBookmarks).toHaveLength(1);
    expect(result.current.filteredBookmarks[0].id).toBe("bm-2");
  });

  it("should filter by multiple tags (AND logic)", () => {
    const bookmarksWithTags = [
      {
        id: "bm-1",
        title: "A",
        url: "https://a.com",
        summary: "",
        content: "",
        tags: ["dev", "frontend"],
      },
      {
        id: "bm-2",
        title: "B",
        url: "https://b.com",
        summary: "",
        content: "",
        tags: ["dev", "backend"],
      },
      {
        id: "bm-3",
        title: "C",
        url: "https://c.com",
        summary: "",
        content: "",
        tags: ["frontend"],
      },
    ];
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: bookmarksWithTags }),
    );
    act(() => result.current.setSelectedTags(["dev", "frontend"]));
    expect(result.current.filteredBookmarks).toHaveLength(1);
    expect(result.current.filteredBookmarks[0].id).toBe("bm-1");
  });

  it("should combine text and tag filter after debounce", async () => {
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setSelectedTags(["dev"]));
    act(() => result.current.setSearchQuery("React"));
    await waitFor(() => {
      expect(result.current.filteredBookmarks).toHaveLength(1);
      expect(result.current.filteredBookmarks[0].id).toBe("bm-1");
    });
  });

  it("should do semantic search when enabled and query > 2 chars", async () => {
    const { ragEngine } = await import("../../../services/ai/RAGEngine");
    const { semanticSearchService } =
      await import("../../../services/ai/SemanticSearchService");
    (semanticSearchService.expandQuery as any).mockResolvedValue(
      "expanded react",
    );
    (ragEngine.searchSimilar as any).mockResolvedValue([
      { id: "bm-1", title: "React Guide", similarity: 0.95 },
    ]);

    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setIsSemanticSearch(true));
    act(() => result.current.setSearchQuery("React"));
    await waitFor(
      () =>
        expect(semanticSearchService.expandQuery).toHaveBeenCalledWith(
          "React",
          expect.any(AbortSignal),
        ),
      { timeout: 1000 },
    );
    expect(ragEngine.searchSimilar).toHaveBeenCalled();
    expect(mockPrefetch).toHaveBeenCalledTimes(1);
  });

  it("should ignore an older semantic search after a newer query starts", async () => {
    const { ragEngine } = await import("../../../services/ai/RAGEngine");
    const { semanticSearchService } =
      await import("../../../services/ai/SemanticSearchService");
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;
    const firstExpansion = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const secondExpansion = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });
    (semanticSearchService.expandQuery as any).mockImplementation((query: string) =>
      query === "first" ? firstExpansion : secondExpansion,
    );
    (ragEngine.searchSimilar as any).mockResolvedValue([
      { id: "bm-2", title: "Design System", similarity: 0.9 },
    ]);

    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setIsSemanticSearch(true));
    act(() => result.current.setSearchQuery("first"));
    await waitFor(() =>
      expect(semanticSearchService.expandQuery).toHaveBeenCalledWith(
        "first",
        expect.any(AbortSignal),
      ),
    );

    act(() => result.current.setSearchQuery("second"));
    await waitFor(() =>
      expect(semanticSearchService.expandQuery).toHaveBeenCalledWith(
        "second",
        expect.any(AbortSignal),
      ),
      { timeout: 1500 },
    );
    expect(
      ((semanticSearchService.expandQuery as any).mock.calls[0]?.[1] as AbortSignal).aborted,
    ).toBe(true);

    await act(async () => {
      resolveFirst("old expansion");
      await Promise.resolve();
    });
    expect(ragEngine.searchSimilar).not.toHaveBeenCalled();

    await act(async () => {
      resolveSecond("new expansion");
    });
    await waitFor(() => expect(ragEngine.searchSimilar).toHaveBeenCalledTimes(1));
    expect(result.current.filteredBookmarks[0].id).toBe("bm-2");
  });

  it("should prefetch when semantic mode opens but defer search for short queries", async () => {
    const { semanticSearchService } =
      await import("../../../services/ai/SemanticSearchService");
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setIsSemanticSearch(true));
    act(() => result.current.setSearchQuery("Re"));
    await waitFor(() => expect(result.current.searchQuery).toBe("Re"));
    await waitFor(() =>
      expect(semanticSearchService.expandQuery).not.toHaveBeenCalled(),
    );
    expect(mockPrefetch).toHaveBeenCalledTimes(1);
  });

  it("should not do semantic search when disabled", async () => {
    const { semanticSearchService } =
      await import("../../../services/ai/SemanticSearchService");
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setSearchQuery("React"));
    await waitFor(() =>
      expect(semanticSearchService.expandQuery).not.toHaveBeenCalled(),
    );
    expect(mockPrefetch).not.toHaveBeenCalled();
  });

  it("filters semantic results by selected tags", async () => {
    const { ragEngine } = await import("../../../services/ai/RAGEngine");
    const { semanticSearchService } =
      await import("../../../services/ai/SemanticSearchService");
    (semanticSearchService.expandQuery as any).mockResolvedValue("expanded");
    (ragEngine.searchSimilar as any).mockResolvedValue([
      { ...mockBookmarks[1], similarity: 0.99 },
      { ...mockBookmarks[0], similarity: 0.8 },
    ]);
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setSelectedTags(["dev"]));
    act(() => result.current.setIsSemanticSearch(true));
    act(() => result.current.setSearchQuery("framework"));
    await waitFor(() => expect(ragEngine.searchSimilar).toHaveBeenCalled());
    expect(result.current.filteredBookmarks.map((b: { id: string }) => b.id)).toEqual(["bm-1"]);
  });

  it("falls back to text results when semantic search fails", async () => {
    const { semanticSearchService } =
      await import("../../../services/ai/SemanticSearchService");
    (semanticSearchService.expandQuery as any).mockRejectedValue(
      new Error("API error"),
    );
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setIsSemanticSearch(true));
    act(() => result.current.setSearchQuery("React"));
    await waitFor(() => expect(result.current.filteredBookmarks.map((b: { id: string }) => b.id)).toEqual(["bm-1"]));
  });

  it("should handle semantic search error gracefully", async () => {
    const { semanticSearchService } =
      await import("../../../services/ai/SemanticSearchService");
    const { logger } = await import("../../../utils/logger");
    (semanticSearchService.expandQuery as any).mockRejectedValue(
      new Error("API error"),
    );

    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setIsSemanticSearch(true));
    act(() => result.current.setSearchQuery("React"));
    await waitFor(() => expect(logger.error).toHaveBeenCalled(), {
      timeout: 1000,
    });
  });

  it("should clear semantic results when disabling semantic search after debounce", async () => {
    const { result } = renderHook(() =>
      useBookmarkSearch({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.setIsSemanticSearch(true));
    act(() => result.current.setIsSemanticSearch(false));
    act(() => result.current.setSearchQuery("React"));
    await waitFor(() => {
      expect(result.current.filteredBookmarks).toHaveLength(1);
    });
  });

  it("invalidates the lowered-text cache when bookmarks change", async () => {
    const { result, rerender } = renderHook(
      ({ bookmarks }: { bookmarks: typeof mockBookmarks }) =>
        useBookmarkSearch({ bookmarks }),
      { initialProps: { bookmarks: mockBookmarks } },
    );
    // First search: builds the lowercase cache.
    act(() => result.current.setSearchQuery("React"));
    await waitFor(() => {
      expect(result.current.filteredBookmarks).toHaveLength(1);
    });
    expect(result.current.filteredBookmarks[0].id).toBe("bm-1");

    // New data reference: bm-1 loses "React" and "React Native" appears.
    // If the cache were stale (keyed by the old reference), the search
    // would keep returning bm-1.
    // bm-1 loses "react" in ALL fields (url and summary included);
    // if the cache were stale, the search would keep returning bm-1.
    const updated = [
      {
        // mockBookmarks is a non-empty fixture; `!` narrows the index.
        ...mockBookmarks[0]!,
        title: "Vue Guide",
        url: "https://vue.dev",
        summary: "Vue docs",
        content: "Vue is a framework",
      },
      ...mockBookmarks.slice(1),
      {
        id: "bm-4",
        title: "React Native",
        url: "https://reactnative.dev",
        summary: "",
        content: "",
        tags: [],
      },
    ];
    rerender({ bookmarks: updated });
    await waitFor(() => {
      expect(
        result.current.filteredBookmarks.map(
          (b: { id: string }) => b.id,
        ),
      ).toEqual(["bm-4"]);
    });
  });
});
