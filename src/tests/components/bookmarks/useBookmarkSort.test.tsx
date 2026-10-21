import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, render } from "@testing-library/react";

const mockBookmarks = [
  {
    id: "bm-1",
    title: "Gamma",
    url: "https://c.com",
    createdAt: "2025-01-03",
    updatedAt: "2025-03-01",
  },
  {
    id: "bm-2",
    title: "Alpha",
    url: "https://a.com",
    createdAt: "2025-01-01",
    updatedAt: "2025-01-15",
  },
  {
    id: "bm-3",
    title: "Beta",
    url: "https://b.com",
    createdAt: "2025-01-02",
    updatedAt: "2025-02-01",
  },
];

describe("useBookmarkSort", () => {
  let useBookmarkSort: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../../components/bookmarks/useBookmarkSort");
    useBookmarkSort = mod.useBookmarkSort;
  });

  it("should initialize with createdAt desc by default", () => {
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: mockBookmarks }),
    );
    expect(result.current.sortField).toBe("createdAt");
    expect(result.current.sortDirection).toBe("desc");
  });

  it("should return bookmarks sorted by createdAt desc by default", () => {
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: mockBookmarks }),
    );
    expect(result.current.sortedBookmarks[0].id).toBe("bm-1");
    expect(result.current.sortedBookmarks[1].id).toBe("bm-3");
    expect(result.current.sortedBookmarks[2].id).toBe("bm-2");
  });

  it("handleSort should toggle direction when same field", () => {
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.handleSort("createdAt"));
    expect(result.current.sortDirection).toBe("asc");
    expect(result.current.sortedBookmarks[0].id).toBe("bm-2");
    expect(result.current.sortedBookmarks[1].id).toBe("bm-3");
    expect(result.current.sortedBookmarks[2].id).toBe("bm-1");
  });

  it("handleSort should change field and set asc when new field", () => {
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.handleSort("title"));
    expect(result.current.sortField).toBe("title");
    expect(result.current.sortDirection).toBe("asc");
    expect(result.current.sortedBookmarks[0].id).toBe("bm-2");
    expect(result.current.sortedBookmarks[1].id).toBe("bm-3");
    expect(result.current.sortedBookmarks[2].id).toBe("bm-1");
  });

  it("should sort by title asc case-insensitive", () => {
    const mixedCase = [
      {
        id: "bm-1",
        title: "alpha",
        url: "https://a.com",
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
      },
      {
        id: "bm-2",
        title: "BETA",
        url: "https://b.com",
        createdAt: "2025-01-02",
        updatedAt: "2025-01-02",
      },
      {
        id: "bm-3",
        title: "Gamma",
        url: "https://c.com",
        createdAt: "2025-01-03",
        updatedAt: "2025-01-03",
      },
    ];
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: mixedCase }),
    );
    act(() => result.current.handleSort("title"));
    expect(result.current.sortedBookmarks[0].id).toBe("bm-1");
    expect(result.current.sortedBookmarks[1].id).toBe("bm-2");
    expect(result.current.sortedBookmarks[2].id).toBe("bm-3");
  });

  it("should sort by updatedAt", () => {
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.handleSort("updatedAt"));
    expect(result.current.sortDirection).toBe("asc");
    expect(result.current.sortedBookmarks[0].id).toBe("bm-2");
    expect(result.current.sortedBookmarks[1].id).toBe("bm-3");
    expect(result.current.sortedBookmarks[2].id).toBe("bm-1");
  });

  it("should sort by url", () => {
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.handleSort("url"));
    expect(result.current.sortedBookmarks[0].id).toBe("bm-2");
    expect(result.current.sortedBookmarks[1].id).toBe("bm-3");
    expect(result.current.sortedBookmarks[2].id).toBe("bm-1");
  });

  it("should handle empty bookmarks", () => {
    const { result } = renderHook(() => useBookmarkSort({ bookmarks: [] }));
    expect(result.current.sortedBookmarks).toEqual([]);
  });

  it("should return the same reference when createdAt desc is already sorted", () => {
    // RxDB entrega los bookmarks ordenados por createdAt desc; el fast path
    // must return the array as-is (same identity → downstream memos
    // y el virtualizador no re-trabajan).
    const preSorted = [
      {
        id: "bm-1",
        title: "Gamma",
        url: "https://c.com",
        createdAt: "2025-01-03",
        updatedAt: "2025-03-01",
      },
      {
        id: "bm-2",
        title: "Beta",
        url: "https://b.com",
        createdAt: "2025-01-02",
        updatedAt: "2025-02-01",
      },
      {
        id: "bm-3",
        title: "Alpha",
        url: "https://a.com",
        createdAt: "2025-01-01",
        updatedAt: "2025-01-15",
      },
    ];
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: preSorted }),
    );
    expect(result.current.sortedBookmarks).toBe(preSorted);
    expect(result.current.sortedBookmarks[0].id).toBe("bm-1");
    expect(result.current.sortedBookmarks[2].id).toBe("bm-3");
  });

  it("should fall back to a real sort when createdAt desc input is not sorted", () => {
    // A single inversion (bm-3 first) must invalidate the fast path and
    // produce the correct order.
    const almostSorted = [
      {
        id: "bm-3",
        title: "Alpha",
        url: "https://a.com",
        createdAt: "2025-01-01",
        updatedAt: "2025-01-15",
      },
      {
        id: "bm-1",
        title: "Gamma",
        url: "https://c.com",
        createdAt: "2025-01-03",
        updatedAt: "2025-03-01",
      },
      {
        id: "bm-2",
        title: "Beta",
        url: "https://b.com",
        createdAt: "2025-01-02",
        updatedAt: "2025-02-01",
      },
    ];
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: almostSorted }),
    );
    expect(result.current.sortedBookmarks).not.toBe(almostSorted);
    expect(result.current.sortedBookmarks[0].id).toBe("bm-1");
    expect(result.current.sortedBookmarks[1].id).toBe("bm-2");
    expect(result.current.sortedBookmarks[2].id).toBe("bm-3");
  });

  it("should handle undefined values gracefully", () => {
    const withNulls = [
      { id: "bm-1", title: "", url: "", createdAt: "", updatedAt: "" },
      {
        id: "bm-2",
        title: "Alpha",
        url: "https://a.com",
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
      },
    ];
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: withNulls }),
    );
    act(() => result.current.handleSort("title"));
    expect(result.current.sortedBookmarks.length).toBe(2);
  });

  it("SortIcon should render ArrowUpDown for non-active field", () => {
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: mockBookmarks }),
    );
    const { container } = render(<result.current.SortIcon field="title" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("SortIcon should render ArrowUp for active asc field", () => {
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: mockBookmarks }),
    );
    act(() => result.current.handleSort("title"));
    const { container } = render(<result.current.SortIcon field="title" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("SortIcon should render ArrowDown for active desc field", () => {
    const { result } = renderHook(() =>
      useBookmarkSort({ bookmarks: mockBookmarks }),
    );
    const { container } = render(<result.current.SortIcon field="createdAt" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });
});
