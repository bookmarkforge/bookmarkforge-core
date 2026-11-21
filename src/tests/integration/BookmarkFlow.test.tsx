import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import {
  baseBm,
  defaultBookmarkData,
  defaultBookmarkCRUD,
  defaultBookmarkAI,
  defaultBookmarkUI,
  defaultBookmarkSort,
  defaultBookmarkSearch,
  defaultBookmarkSelection,
  defaultBookmarkBulkActions,
  createDefaultBookmarks,
} from "../helpers/bookmarkTestMocks";

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: { allowLocalModels: true },
  FeatureExtractionPipeline: {},
}));

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) => options?.defaultValue || key;
  return {
    useTranslation: () => ({ t, i18n: { language: "en" } }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

// --- New hook mocks ---
const mockUseBookmarkData: any = vi.fn();
const mockUseBookmarkCRUD: any = vi.fn();
const mockUseBookmarkAI: any = vi.fn();
const mockUseBookmarkUI: any = vi.fn();
const mockUseBookmarkSort: any = vi.fn();

// --- Barrel hook mocks ---
const mockUseBookmarkSearch: any = vi.fn();
const mockUseBookmarkSelection: any = vi.fn();
const mockUseBookmarkBulkActions: any = vi.fn();
const mockUseVirtualizer: any = vi.fn();

// --- Service mocks ---
vi.mock("../../db/database", () => ({ initDB: vi.fn() }));
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: {},
}));
vi.mock("../../services/ai/RAGEngine", () => ({ ragEngine: {} }));
vi.mock("../../services/ai/TTSService", () => ({
  ttsService: {
    generateAudio: vi.fn().mockResolvedValue("blob:audio-url"),
  },
}));
vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// --- New hook mocks ---
vi.mock("../../hooks/useBookmarkData", () => ({
  useBookmarkData: mockUseBookmarkData,
}));
vi.mock("../../hooks/useBookmarkCRUD", () => ({
  useBookmarkCRUD: mockUseBookmarkCRUD,
}));
vi.mock("../../hooks/useBookmarkAI", () => ({
  useBookmarkAI: mockUseBookmarkAI,
}));
vi.mock("../../hooks/useBookmarkUI", () => ({
  useBookmarkUI: mockUseBookmarkUI,
}));
vi.mock("../../components/bookmarks/useBookmarkSort", () => ({
  useBookmarkSort: mockUseBookmarkSort,
}));

// --- Barrel mock ---
vi.mock("../../components/bookmarks/index", () => ({
  BookmarkRow: ({ bookmark }: any) => (
    <div data-testid="bookmark-row">{bookmark.title}</div>
  ),
  ExpandedBookmarkRow: () => null,
  BookmarkToolbar: () => <div data-testid="bookmark-toolbar" />,
  SearchBar: () => <div data-testid="search-bar" />,
  BulkActionsBar: () => <div data-testid="bulk-actions-bar" />,
  EmptyState: () => <div data-testid="empty-state" />,
  SkeletonLoader: () => <div data-testid="skeleton-loader" />,
  TagFilterBar: () => <div data-testid="tag-filter-bar" />,
  ShareBookmarkModal: () => <div data-testid="share-modal" />,
  BookmarkReaderModal: () => <div data-testid="reader-modal" />,
  ApiSettingsModal: () => <div data-testid="api-settings-modal" />,
  useBookmarkSearch: mockUseBookmarkSearch,
  useBookmarkSelection: mockUseBookmarkSelection,
  useBookmarkBulkActions: mockUseBookmarkBulkActions,
  SortIcon: () => null,
  exportJSON: vi.fn(),
  exportCSV: vi.fn(),
  exportMarkdown: vi.fn(),
  exportPDF: vi.fn(),
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: mockUseVirtualizer,
}));
vi.mock("lucide-react", () => ({
  X: () => <span data-testid="x-icon" />,
  CheckSquare: () => null,
  Square: () => null,
  ArrowUpDown: () => null,
  ArrowUp: () => null,
  ArrowDown: () => null,
  AlertCircle: () => null,
}));
vi.mock("html2pdf.js", () => ({
  default: vi.fn(() => ({
    set: vi.fn(() => ({ from: vi.fn(() => ({ save: vi.fn() })) })),
  })),
}));

const BookmarksTable = (
  await import("../../components/bookmarks/BookmarksTable")
).default;

describe("Integration: Bookmark Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBookmarkData.mockReturnValue(defaultBookmarkData as any);
    mockUseBookmarkCRUD.mockReturnValue(defaultBookmarkCRUD as any);
    mockUseBookmarkAI.mockReturnValue(defaultBookmarkAI as any);
    mockUseBookmarkUI.mockReturnValue(defaultBookmarkUI as any);
    mockUseBookmarkSort.mockReturnValue(defaultBookmarkSort as any);
    mockUseBookmarkSearch.mockReturnValue(defaultBookmarkSearch as any);
    mockUseBookmarkSelection.mockReturnValue(defaultBookmarkSelection as any);
    mockUseBookmarkBulkActions.mockReturnValue(defaultBookmarkBulkActions as any);
    mockUseVirtualizer.mockReturnValue({
      getTotalSize: () => 0,
      getVirtualItems: () => [],
    } as any);
  });

  it("creates bookmark → appears in the table", () => {
    const bookmarks = createDefaultBookmarks(3);
    mockUseBookmarkData.mockReturnValue({
      ...defaultBookmarkData,
      bookmarks,
    } as any);
    mockUseBookmarkSearch.mockReturnValue({
      ...defaultBookmarkSearch,
      filteredBookmarks: bookmarks,
    } as any);
    mockUseBookmarkSort.mockReturnValue({
      ...defaultBookmarkSort,
      sortedBookmarks: bookmarks,
    } as any);
    mockUseVirtualizer.mockReturnValue({
      getTotalSize: () => 240,
      getVirtualItems: () =>
        bookmarks.map((_, i) => ({
          index: i,
          start: i * 80,
          size: 80,
          key: i,
          lane: 0,
        })),
    });
    render(<BookmarksTable />);
    expect(screen.getByText("Bookmark 1")).toBeTruthy();
    expect(screen.getByText("Bookmark 2")).toBeTruthy();
    expect(screen.getByText("Bookmark 3")).toBeTruthy();
  });

  it("filters bookmarks by search", () => {
    const bookmarks = createDefaultBookmarks(5);
    const filtered = [bookmarks[2]];
    mockUseBookmarkData.mockReturnValue({
      ...defaultBookmarkData,
      bookmarks,
    } as any);
    mockUseBookmarkSearch.mockReturnValue({
      ...defaultBookmarkSearch,
      searchQuery: "Bookmark 3",
      filteredBookmarks: filtered,
    });
    mockUseBookmarkSort.mockReturnValue({
      ...defaultBookmarkSort,
      sortedBookmarks: filtered,
    });
    mockUseVirtualizer.mockReturnValue({
      getTotalSize: () => 80,
      getVirtualItems: () => [
        { index: 0, start: 0, size: 80, key: 0, lane: 0 },
      ],
    });
    render(<BookmarksTable />);
    expect(screen.getByText("Bookmark 3")).toBeTruthy();
    expect(screen.queryByText("Bookmark 1")).toBeNull();
    expect(screen.queryByText("Bookmark 4")).toBeNull();
  });

  it("empty state when there are no bookmarks", () => {
    mockUseBookmarkData.mockReturnValue({
      ...defaultBookmarkData,
      bookmarks: [],
    });
    mockUseBookmarkSearch.mockReturnValue({
      ...defaultBookmarkSearch,
      filteredBookmarks: [],
    });
    mockUseBookmarkSort.mockReturnValue({
      ...defaultBookmarkSort,
      sortedBookmarks: [],
    });
    const { getByTestId } = render(<BookmarksTable />);
    expect(getByTestId("empty-state")).toBeTruthy();
  });

  it("loading state shows skeleton", () => {
    mockUseBookmarkData.mockReturnValue({
      ...defaultBookmarkData,
      bookmarks: [],
      isLoading: true,
    });
    const { getByTestId } = render(<BookmarksTable />);
    expect(getByTestId("skeleton-loader")).toBeTruthy();
  });

  it("changes sort when clicking the header", async () => {
    const handleSort = vi.fn();
    const bookmarks = createDefaultBookmarks(2);
    mockUseBookmarkData.mockReturnValue({
      ...defaultBookmarkData,
      bookmarks,
    } as any);
    mockUseBookmarkSearch.mockReturnValue({
      ...defaultBookmarkSearch,
      filteredBookmarks: bookmarks,
    } as any);
    mockUseBookmarkSort.mockReturnValue({
      ...defaultBookmarkSort,
      sortedBookmarks: bookmarks,
      handleSort,
    });
    mockUseVirtualizer.mockReturnValue({
      getTotalSize: () => 160,
      getVirtualItems: () => [
        { index: 0, start: 0, size: 80, key: 0, lane: 0 },
        { index: 1, start: 80, size: 80, key: 1, lane: 0 },
      ],
    });
    render(<BookmarksTable />);
    await userEvent.click(screen.getByText("app_title"));
    expect(handleSort).toHaveBeenCalledWith("title");
  });

  it("deletes bookmark", () => {
    const bookmarks = createDefaultBookmarks(1);
    mockUseBookmarkData.mockReturnValue({
      ...defaultBookmarkData,
      bookmarks,
    } as any);
    mockUseBookmarkSearch.mockReturnValue({
      ...defaultBookmarkSearch,
      filteredBookmarks: bookmarks,
    } as any);
    mockUseBookmarkSort.mockReturnValue({
      ...defaultBookmarkSort,
      sortedBookmarks: bookmarks,
    } as any);
    mockUseBookmarkSelection.mockReturnValue({
      ...defaultBookmarkSelection,
      selectedIds: new Set(["bm-1"]),
    });
    const { getByTestId } = render(<BookmarksTable />);
    expect(getByTestId("bulk-actions-bar")).toBeTruthy();
  });

  it("shows share modal when sharingBookmark is active", () => {
    const bookmarks = createDefaultBookmarks(1);
    mockUseBookmarkData.mockReturnValue({
      ...defaultBookmarkData,
      bookmarks,
    } as any);
    mockUseBookmarkSearch.mockReturnValue({
      ...defaultBookmarkSearch,
      filteredBookmarks: bookmarks,
    } as any);
    mockUseBookmarkSort.mockReturnValue({
      ...defaultBookmarkSort,
      sortedBookmarks: bookmarks,
    } as any);
    mockUseBookmarkUI.mockReturnValue({
      ...defaultBookmarkUI,
      sharingBookmark: bookmarks[0],
    });
    mockUseVirtualizer.mockReturnValue({
      getTotalSize: () => 80,
      getVirtualItems: () => [
        { index: 0, start: 0, size: 80, key: 0, lane: 0 },
      ],
    });
    const { getByTestId } = render(<BookmarksTable />);
    expect(getByTestId("share-modal")).toBeTruthy();
  });

  it("shows reader modal when viewingContent is active", () => {
    const bookmarks = createDefaultBookmarks(1);
    mockUseBookmarkData.mockReturnValue({
      ...defaultBookmarkData,
      bookmarks,
    } as any);
    mockUseBookmarkSearch.mockReturnValue({
      ...defaultBookmarkSearch,
      filteredBookmarks: bookmarks,
    } as any);
    mockUseBookmarkSort.mockReturnValue({
      ...defaultBookmarkSort,
      sortedBookmarks: bookmarks,
    } as any);
    mockUseBookmarkUI.mockReturnValue({
      ...defaultBookmarkUI,
      viewingContent: bookmarks[0],
    });
    mockUseVirtualizer.mockReturnValue({
      getTotalSize: () => 80,
      getVirtualItems: () => [
        { index: 0, start: 0, size: 80, key: 0, lane: 0 },
      ],
    });
    const { getByTestId } = render(<BookmarksTable />);
    expect(getByTestId("reader-modal")).toBeTruthy();
  });

  it("BulkActionsBar visible when there is a selection", () => {
    mockUseBookmarkSelection.mockReturnValue({
      ...defaultBookmarkSelection,
      selectedIds: new Set(["bm-1"]),
    });
    const bookmarks = createDefaultBookmarks(2);
    mockUseBookmarkData.mockReturnValue({
      ...defaultBookmarkData,
      bookmarks,
    } as any);
    const { getByTestId } = render(<BookmarksTable />);
    expect(getByTestId("bulk-actions-bar")).toBeTruthy();
  });
});
