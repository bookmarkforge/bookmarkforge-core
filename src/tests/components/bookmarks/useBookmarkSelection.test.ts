import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockBookmarks = [
  { id: "bm-1", title: "Alpha", url: "https://a.com", tags: ["dev"] },
  { id: "bm-2", title: "Beta", url: "https://b.com", tags: ["design"] },
  { id: "bm-3", title: "Gamma", url: "https://c.com", tags: ["dev", "design"] },
];

describe("useBookmarkSelection", () => {
  let useBookmarkSelection: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod =
      await import("../../../components/bookmarks/useBookmarkSelection");
    useBookmarkSelection = mod.useBookmarkSelection;
  });

  it("should initialize with empty selection", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.expandedIds.size).toBe(0);
    expect(result.current.selectedIndex).toBe(0);
    expect(result.current.selectedRowRef.current).toBeNull();
  });

  it("handleSelectAll should select all when none selected", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );
    act(() => result.current.handleSelectAll());
    expect(result.current.selectedIds.size).toBe(3);
    expect(result.current.selectedIds.has("bm-1")).toBe(true);
    expect(result.current.selectedIds.has("bm-2")).toBe(true);
    expect(result.current.selectedIds.has("bm-3")).toBe(true);
  });

  it("handleSelectAll should deselect all when all selected", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );
    act(() => result.current.handleSelectAll());
    act(() => result.current.handleSelectAll());
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("selects only the filtered bookmarks while preserving hidden selections", () => {
    const { result, rerender } = renderHook(
      ({ filteredBookmarks }: { filteredBookmarks: typeof mockBookmarks }) =>
        useBookmarkSelection({ filteredBookmarks }),
      { initialProps: { filteredBookmarks: mockBookmarks } },
    );

    act(() => result.current.handleSelect("bm-3"));
    rerender({ filteredBookmarks: mockBookmarks.slice(0, 2) });
    act(() => result.current.handleSelectAll());

    expect([...result.current.selectedIds].sort()).toEqual(["bm-1", "bm-2", "bm-3"]);

    act(() => result.current.handleSelectAll());
    expect([...result.current.selectedIds]).toEqual(["bm-3"]);
  });

  it("handleSelectAll should do nothing when no bookmarks", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: [] }),
    );
    act(() => result.current.handleSelectAll());
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("uses current selected ids when the selection changes with the same size", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );

    act(() => result.current.setSelectedIds(new Set(["bm-1"])));
    act(() => result.current.setSelectedIds(new Set(["bm-2"])));
    act(() => result.current.handleSelectAll());

    expect([...result.current.selectedIds].sort()).toEqual([
      "bm-1",
      "bm-2",
      "bm-3",
    ]);
  });

  it("handleSelect should toggle a single bookmark", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );
    act(() => result.current.handleSelect("bm-1"));
    expect(result.current.selectedIds.size).toBe(1);
    expect(result.current.selectedIds.has("bm-1")).toBe(true);
  });

  it("handleSelect should deselect when already selected", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );
    act(() => result.current.handleSelect("bm-1"));
    act(() => result.current.handleSelect("bm-1"));
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("handleSelect should support multiple selected", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );
    act(() => result.current.handleSelect("bm-1"));
    act(() => result.current.handleSelect("bm-2"));
    expect(result.current.selectedIds.size).toBe(2);
  });

  it("handleSelect should preserve rapid toggles in one batch", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );

    act(() => {
      result.current.handleSelect("bm-1");
      result.current.handleSelect("bm-2");
    });

    expect([...result.current.selectedIds].sort()).toEqual(["bm-1", "bm-2"]);
  });

  it("handleToggleExpand should toggle expand for an id", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );
    act(() => result.current.handleToggleExpand("bm-1"));
    expect(result.current.expandedIds.has("bm-1")).toBe(true);
  });

  it("handleToggleExpand should collapse when already expanded", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );
    act(() => result.current.handleToggleExpand("bm-1"));
    act(() => result.current.handleToggleExpand("bm-1"));
    expect(result.current.expandedIds.has("bm-1")).toBe(false);
  });

  it("handleToggleExpand should support multiple expanded", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );
    act(() => result.current.handleToggleExpand("bm-1"));
    act(() => result.current.handleToggleExpand("bm-2"));
    expect(result.current.expandedIds.size).toBe(2);
  });

  it("handleToggleExpand should preserve rapid toggles in one batch", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );

    act(() => {
      result.current.handleToggleExpand("bm-1");
      result.current.handleToggleExpand("bm-2");
    });

    expect([...result.current.expandedIds].sort()).toEqual(["bm-1", "bm-2"]);
  });

  it("setSelectedIds should update selected ids", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );
    act(() => result.current.setSelectedIds(new Set(["bm-2"])));
    expect(result.current.selectedIds.size).toBe(1);
    expect(result.current.selectedIds.has("bm-2")).toBe(true);
  });

  it("setExpandedIds should update expanded ids", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );
    act(() => result.current.setExpandedIds(new Set(["bm-3"])));
    expect(result.current.expandedIds.has("bm-3")).toBe(true);
  });

  it("setSelectedIndex should update the index", () => {
    const { result } = renderHook(() =>
      useBookmarkSelection({ filteredBookmarks: mockBookmarks }),
    );
    act(() => result.current.setSelectedIndex(2));
    expect(result.current.selectedIndex).toBe(2);
  });
});
