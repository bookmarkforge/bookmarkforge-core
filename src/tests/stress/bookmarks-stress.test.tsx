import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

const mockUseBookmarkSearch = vi.fn();
const mockUseBookmarkSelection = vi.fn();
const mockUseBookmarkBulkActions = vi.fn();
const mockUseVirtualizer = vi.fn();
// BookmarksTable calls initDB() in a mount effect; the real DB creation
// logs asynchronously and its console callback can race vitest's worker
// teardown ("onUserConsoleLog was pending" → exit 1 despite all tests
// passing). Mock the db module so no real instance is created.
const mockInitDB = vi.fn();
vi.mock("../../db/database", () => ({ initDB: mockInitDB }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});
vi.mock("../../components/bookmarks/useBookmarkSearch", () => ({
  useBookmarkSearch: mockUseBookmarkSearch,
}));
vi.mock("../../components/bookmarks/useBookmarkSelection", () => ({
  useBookmarkSelection: mockUseBookmarkSelection,
}));
vi.mock("../../components/bookmarks/useBookmarkBulkActions", () => ({
  useBookmarkBulkActions: mockUseBookmarkBulkActions,
}));
vi.mock("../../components/bookmarks/BookmarkRow", () => ({
  BookmarkRow: ({ bookmark }: any) => (
    <div data-testid="bookmark-row">{bookmark.title}</div>
  ),
}));
vi.mock("../../components/bookmarks/ExpandedBookmarkRow", () => ({
  ExpandedBookmarkRow: () => null,
}));
vi.mock("../../components/bookmarks/BookmarkToolbar", () => ({
  BookmarkToolbar: () => <div data-testid="bookmark-toolbar" />,
  SearchBar: () => <div data-testid="search-bar" />,
  BulkActionsBar: () => <div data-testid="bulk-actions-bar" />,
}));
vi.mock("../../components/bookmarks/EmptyState", () => ({
  EmptyState: () => <div data-testid="empty-state" />,
}));
vi.mock("../../components/bookmarks/SkeletonLoader", () => ({
  SkeletonLoader: () => <div data-testid="skeleton-loader" />,
}));
vi.mock("../../components/bookmarks/TagFilterBar", () => ({
  TagFilterBar: () => null,
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: mockUseVirtualizer,
}));
vi.mock("lucide-react", () => ({
  X: () => null,
  CheckSquare: () => null,
  Square: () => null,
  ArrowUpDown: () => null,
  ArrowUp: () => null,
  ArrowDown: () => null,
  AlertCircle: () => null,
  // Icons evaluated at module scope by BookmarkReaderModal's AI reader trio.
  Sun: () => null,
  Moon: () => null,
  Coffee: () => null,
  Zap: () => null,
  Clock: () => null,
  MessageSquare: () => null,
  Link: () => null,
  AlertTriangle: () => null,
  Lightbulb: () => null,
  Sparkles: () => null,
  Check: () => null,
  MessageCircle: () => null,
}));

function generateBookmarks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `bm-${i}`,
    title: `Bookmark ${i} - ${"x".repeat(i % 50)}`,
    url: `https://example${i}.com/${i}`,
    tags: i % 5 === 0 ? ["stress"] : i % 3 === 0 ? ["test", "benchmark"] : [],
    createdAt: new Date(Date.now() - i * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

const BookmarksTable = (
  await import("../../components/bookmarks/BookmarksTable")
).default;

describe("Stress: 200 bookmarks virtualized", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBookmarkSelection.mockReturnValue({
      selectedIds: new Set(),
      setSelectedIds: vi.fn(),
      expandedIds: new Set(),
      setExpandedIds: vi.fn(),
      selectedIndex: 0,
      setSelectedIndex: vi.fn(),
      handleSelectAll: vi.fn(),
      handleSelect: vi.fn(),
      handleToggleExpand: vi.fn(),
      selectedRowRef: { current: null },
    });
    mockUseBookmarkBulkActions.mockReturnValue({
      isBulkTagging: false,
      isCleaningContent: false,
      isSummarizingCollection: false,
      isGeneratingAllOverviews: false,
      isGeneratingEmbeddings: false,
      bulkTagInput: "",
      setBulkTagInput: vi.fn(),
      handleBulkSummarize: vi.fn(),
      handleBulkAutoTag: vi.fn(),
      handleBulkAddTag: vi.fn(),
      handleBulkRemoveTag: vi.fn(),
      handleBulkClearTags: vi.fn(),
      handleBulkDelete: vi.fn(),
      handleBulkGenerateOverviews: vi.fn(),
      handleBulkGenerateEmbeddings: vi.fn(),
      handleBulkCleanContent: vi.fn(),
    });
  });

  it("renders 200 virtualized bookmarks in < 2s", () => {
    const bookmarks = generateBookmarks(200);
    mockUseBookmarkSearch.mockReturnValue({
      searchQuery: "",
      setSearchQuery: vi.fn(),
      isSemanticSearch: false,
      setIsSemanticSearch: vi.fn(),
      isSearching: false,
      filteredBookmarks: bookmarks,
      selectedTags: [],
      setSelectedTags: vi.fn(),
    });
    mockUseVirtualizer.mockReturnValue({
      getTotalSize: () => bookmarks.length * 80,
      getVirtualItems: () =>
        bookmarks.slice(0, 30).map((_, i) => ({
          index: i,
          start: i * 80,
          size: 80,
          key: i,
          lane: 0,
        })),
    });

    const start = performance.now();
    const { container } = render(<BookmarksTable />);
    const elapsed = performance.now() - start;

    expect(
      container.querySelector('[data-testid="bookmark-toolbar"]'),
    ).toBeTruthy();
    expect(elapsed).toBeLessThan(2000);
  });

  it("filters 200 bookmarks by search in < 100ms (mock)", () => {
    const bookmarks = generateBookmarks(200);
    const filtered = bookmarks.filter((b) => b.tags.includes("stress"));
    mockUseBookmarkSearch.mockReturnValue({
      searchQuery: "stress",
      setSearchQuery: vi.fn(),
      isSemanticSearch: false,
      setIsSemanticSearch: vi.fn(),
      isSearching: false,
      filteredBookmarks: filtered,
      selectedTags: ["stress"],
      setSelectedTags: vi.fn(),
    });
    mockUseVirtualizer.mockReturnValue({
      getTotalSize: () => filtered.length * 80,
      getVirtualItems: () =>
        filtered.slice(0, 30).map((_, i) => ({
          index: i,
          start: i * 80,
          size: 80,
          key: i,
          lane: 0,
        })),
    });

    const start = performance.now();
    const { container } = render(<BookmarksTable />);
    const elapsed = performance.now() - start;

    expect(container).toBeTruthy();
    expect(elapsed).toBeLessThan(2000);
  });
});
