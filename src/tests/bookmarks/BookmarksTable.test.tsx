import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
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
} from "../helpers/bookmarkTestMocks";
import { mockedPartial } from "../helpers/mocked";

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: { allowLocalModels: true },
  FeatureExtractionPipeline: {},
}));

vi.mock(import("react-i18next"), (() => ({
  useTranslation: () => ({ t: (s: string) => s, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
})) as any);
vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

// --- New hook mocks ---
const mockUseBookmarkData = vi.fn();
const mockUseBookmarkCRUD = vi.fn();
const mockUseBookmarkAI = vi.fn();
const mockUseBookmarkUI = vi.fn();
const mockUseBookmarkSort = vi.fn();

// --- Barrel hook mocks (still imported via barrel) ---
const mockUseBookmarkSearch = vi.fn();
const mockUseBookmarkSelection = vi.fn();
const mockUseBookmarkBulkActions = vi.fn();
const mockUseVirtualizer = vi.fn();

// --- Service mocks (imported at module level by the component) ---
const mockInitDB = vi.hoisted(() => vi.fn());
const mockGenerateAudio = vi.hoisted(() => vi.fn());
const mockFlashcardGenerate = vi.hoisted(() => vi.fn());
const mockFetchAndExtract = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock(import("../../db/database"), (() => ({ initDB: mockInitDB })) as any);
vi.mock(import("../../services/ai/ProviderManager"), (() => ({
  aiManager: {},
})) as any);
vi.mock(import("../../services/ai/RAGEngine"), (() => ({
  ragEngine: {},
})) as any);
vi.mock(import("../../services/ai/TTSService"), (() => mockedPartial({
  ttsService: { generateAudio: mockGenerateAudio },
})) as any);
vi.mock(import("../../services/pro-access"), (() => mockedPartial({
  loadFlashcardService: () =>
    Promise.resolve({
      generateFromBookmark: mockFlashcardGenerate,
    }),
  ProUnavailableError: class ProUnavailableError extends Error {},
})) as any);
vi.mock(import("../../services/ContentFetchService"), (() => mockedPartial({
  contentFetchService: { fetchAndExtract: mockFetchAndExtract },
})) as any);
vi.mock(import("sonner"), (() => mockedPartial({
  toast: mockToast,
})) as any);
vi.mock(import("../../utils/logger"), (() => mockedPartial({
  logger: mockLogger,
})) as any);

// --- New hook mocks ---
vi.mock(import("../../hooks/useBookmarkData"), (() => ({
  useBookmarkData: mockUseBookmarkData,
})) as any);
vi.mock(import("../../hooks/useBookmarkCRUD"), (() => ({
  useBookmarkCRUD: mockUseBookmarkCRUD,
})) as any);
vi.mock(import("../../hooks/useBookmarkAI"), (() => ({
  useBookmarkAI: mockUseBookmarkAI,
})) as any);
vi.mock(import("../../hooks/useBookmarkUI"), (() => ({
  useBookmarkUI: mockUseBookmarkUI,
})) as any);
vi.mock(import("../../components/bookmarks/useBookmarkSort"), (() => ({
  useBookmarkSort: mockUseBookmarkSort,
})) as any);

// --- Barrel mock ---
vi.mock(import("../../components/bookmarks/index"), (() => mockedPartial({
  BookmarkRow: ({
    bookmark,
    handleSelect,
    handleViewContent,
    handleAudioSummary,
    handleDelete,
    onGenerateFlashcards,
  }: any) => (
    <div data-testid="bookmark-row" onClick={() => handleSelect?.(bookmark.id)}>
      <span>{bookmark.title}</span>
      <button
        data-testid="view-content-btn"
        onClick={() => handleViewContent?.(bookmark)}
      >
        View
      </button>
      <button
        data-testid="audio-summary-btn"
        onClick={() => handleAudioSummary?.(bookmark)}
      >
        Audio
      </button>
      <button
        data-testid="flashcards-btn"
        onClick={() => onGenerateFlashcards?.(bookmark)}
      >
        Flashcards
      </button>
      <button
        data-testid="delete-btn"
        onClick={() => handleDelete?.(bookmark.id)}
      >
        Delete
      </button>
    </div>
  ),
  ExpandedBookmarkRow: () => <div data-testid="expanded-bookmark-row" />,
  BookmarkToolbar: () => <div data-testid="bookmark-toolbar" />,
  SearchBar: () => <div data-testid="search-bar" />,
  BulkActionsBar: () => <div data-testid="bulk-actions-bar" />,
  EmptyState: ({ onClearFilters }: any) => (
    <div data-testid="empty-state">
      <button
        data-testid="clear-filters-btn"
        onClick={() => onClearFilters?.()}
      >
        Clear
      </button>
    </div>
  ),
  SkeletonLoader: () => <div data-testid="skeleton-loader" />,
  TagFilterBar: () => <div data-testid="tag-filter-bar" />,
  ShareBookmarkModal: ({ handleShare }: any) => (
    <div data-testid="share-modal">
      <button data-testid="share-btn" onClick={(e) => handleShare?.(e)}>
        Share
      </button>
    </div>
  ),
  BookmarkReaderModal: ({
    handleExportPDF,
    handleExportMarkdown,
    handleCleanContent,
    handleFetchContent,
  }: any) => (
    <div data-testid="reader-modal">
      <button data-testid="export-pdf-btn" onClick={handleExportPDF}>
        PDF
      </button>
      <button data-testid="export-md-btn" onClick={handleExportMarkdown}>
        MD
      </button>
      <button data-testid="clean-content-btn" onClick={handleCleanContent}>
        Clean
      </button>
      <button data-testid="fetch-content-btn" onClick={handleFetchContent}>
        Fetch
      </button>
    </div>
  ),
  ApiSettingsModal: () => <div data-testid="api-settings-modal" />,
  useBookmarkSearch: mockUseBookmarkSearch,
  useBookmarkSelection: mockUseBookmarkSelection,
  useBookmarkBulkActions: mockUseBookmarkBulkActions,
  SortIcon: () => null,
  exportJSON: vi.fn(),
  exportCSV: vi.fn(),
  exportMarkdown: vi.fn(),
  exportPDF: vi.fn(),
})) as any);
vi.mock(import("@tanstack/react-virtual"), (() => ({
  useVirtualizer: mockUseVirtualizer,
})) as any);
vi.mock(import("lucide-react"), (() => mockedPartial({
  X: () => <span data-testid="x-icon" />,
  CheckSquare: () => null,
  Square: () => null,
  ArrowUpDown: () => null,
  ArrowUp: () => null,
  ArrowDown: () => null,
  AlertCircle: () => null,
})) as any);
vi.mock(import("html2pdf.js"), (() => mockedPartial({
  default: vi.fn(() => ({
    set: vi.fn(() => ({ from: vi.fn(() => ({ save: vi.fn() })) })),
  })),
})) as any);

const BookmarksTable = (
  await import("../../components/bookmarks/BookmarksTable")
).default;

function renderWithBookmarks(overrides?: Record<string, any>) {
  const bookmarks = overrides?.bookmarks ?? [
    { id: "1", title: "Test", ...baseBm },
  ];

  mockUseBookmarkData.mockReturnValue({
    ...defaultBookmarkData,
    bookmarks,
    isLoading: overrides?.isLoading ?? false,
    ...overrides?.data,
  });

  mockUseBookmarkCRUD.mockReturnValue({
    ...defaultBookmarkCRUD,
    ...overrides?.crud,
  });

  mockUseBookmarkAI.mockReturnValue({
    ...defaultBookmarkAI,
    error: overrides?.error ?? null,
    setError: overrides?.setError ?? vi.fn(),
    isCleaningContent: overrides?.isCleaningContent ?? null,
    setIsCleaningContent: overrides?.setIsCleaningContent ?? vi.fn(),
    ...overrides?.ai,
  });

  mockUseBookmarkUI.mockReturnValue({
    ...defaultBookmarkUI,
    viewingContent: overrides?.viewingContent ?? null,
    setViewingContent: overrides?.setViewingContent ?? vi.fn(),
    sharingBookmark: overrides?.sharingBookmark ?? null,
    setSharingBookmark: overrides?.setSharingBookmark ?? vi.fn(),
    shareEmail: overrides?.shareEmail ?? "",
    setShareEmail: overrides?.setShareEmail ?? vi.fn(),
    showApiSettings: overrides?.showApiSettings ?? false,
    ...overrides?.ui,
  });

  const sortedBookmarks =
    overrides?.sort?.sortedBookmarks ??
    overrides?.search?.filteredBookmarks ??
    bookmarks;

  mockUseBookmarkSort.mockReturnValue({
    ...defaultBookmarkSort,
    sortedBookmarks,
    handleSort: overrides?.handleSort ?? vi.fn(),
    sortField: overrides?.sortField ?? "createdAt",
    sortDirection: overrides?.sortDirection ?? "desc",
    ...overrides?.sort,
  });

  mockUseBookmarkSearch.mockReturnValue({
    ...defaultBookmarkSearch,
    ...overrides?.search,
    filteredBookmarks: overrides?.search?.filteredBookmarks ?? bookmarks,
  });

  mockUseBookmarkSelection.mockReturnValue({
    ...defaultBookmarkSelection,
    selectedIds: overrides?.selectedIds ?? new Set<string>(),
    expandedIds: overrides?.expandedIds ?? new Set<string>(),
    handleSelect: overrides?.handleSelect ?? vi.fn(),
    handleSelectAll: overrides?.handleSelectAll ?? vi.fn(),
    ...overrides?.selection,
  });

  mockUseBookmarkBulkActions.mockReturnValue({
    ...defaultBookmarkBulkActions,
    ...overrides?.bulk,
  });

  mockUseVirtualizer.mockReturnValue(
    overrides?.virtualizer ?? {
      getTotalSize: () => bookmarks.length * 80,
      getVirtualItems: () =>
        bookmarks.map((_: any, i: number) => ({
          index: i,
          start: i * 80,
          size: 80,
          key: i,
          lane: 0,
        })),
    },
  );

  return render(<BookmarksTable />);
}

describe("BookmarksTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateAudio.mockResolvedValue("blob:audio-url");
    mockFlashcardGenerate.mockResolvedValue(3);
    mockFetchAndExtract.mockResolvedValue({
      title: "Fetched Title",
      content: "Fetched Body",
    });
    mockInitDB.mockResolvedValue(undefined);
    mockUseBookmarkData.mockReturnValue(defaultBookmarkData);
    mockUseBookmarkCRUD.mockReturnValue(defaultBookmarkCRUD);
    mockUseBookmarkAI.mockReturnValue(defaultBookmarkAI);
    mockUseBookmarkUI.mockReturnValue(defaultBookmarkUI);
    mockUseBookmarkSort.mockReturnValue(defaultBookmarkSort);
    mockUseBookmarkSearch.mockReturnValue(defaultBookmarkSearch);
    mockUseBookmarkSelection.mockReturnValue(defaultBookmarkSelection);
    mockUseBookmarkBulkActions.mockReturnValue(defaultBookmarkBulkActions);
    mockUseVirtualizer.mockReturnValue({
      getTotalSize: () => 0,
      getVirtualItems: () => [],
    });
  });

  it("renders with loading skeleton initially", () => {
    mockUseBookmarkData.mockReturnValue({
      ...defaultBookmarkData,
      bookmarks: [],
      isLoading: true,
    });
    const { getByTestId } = render(<BookmarksTable />);
    expect(getByTestId("skeleton-loader")).toBeTruthy();
  });

  it("renders empty state when no bookmarks", () => {
    mockUseBookmarkSort.mockReturnValue({
      ...defaultBookmarkSort,
      sortedBookmarks: [],
    });
    const { getByTestId } = renderWithBookmarks({
      bookmarks: [],
      sort: { sortedBookmarks: [] },
    });
    expect(getByTestId("empty-state")).toBeTruthy();
  });

  it("renders bookmark toolbar and search bar", () => {
    const { getByTestId } = renderWithBookmarks();
    expect(getByTestId("bookmark-toolbar")).toBeTruthy();
    expect(getByTestId("search-bar")).toBeTruthy();
  });

  it("renders bookmark rows when bookmarks exist", () => {
    const { getByText } = renderWithBookmarks({
      bookmarks: [{ id: "1", title: "First", ...baseBm }],
      sort: { sortedBookmarks: [{ id: "1", title: "First", ...baseBm }] },
    });
    expect(getByText("First")).toBeTruthy();
  });

  it("renders error message when error is set", () => {
    const { getByText } = renderWithBookmarks({
      error: "Something went wrong",
    });
    expect(getByText("Something went wrong")).toBeTruthy();
  });

  it("dismisses error when X clicked", async () => {
    const setError = vi.fn();
    const { getByTestId } = renderWithBookmarks({
      error: "Test error",
      setError,
    });
    const dismissBtn = getByTestId("x-icon").closest("button");
    await userEvent.click(dismissBtn!);
    expect(setError).toHaveBeenCalledWith(null);
  });

  it("shows ShareBookmarkModal when sharingBookmark is set", () => {
    const { getByTestId } = renderWithBookmarks({
      sharingBookmark: { id: "1", title: "Test", url: "https://test.com" },
    });
    expect(getByTestId("share-modal")).toBeTruthy();
  });

  it("calls handleShare when share button clicked in modal", async () => {
    const setSharingBookmark = vi.fn();
    const setShareEmail = vi.fn();
    const { getByTestId } = renderWithBookmarks({
      sharingBookmark: { id: "1", title: "Test", url: "https://test.com" },
      setSharingBookmark,
      shareEmail: "test@example.com",
      setShareEmail,
    });
    expect(getByTestId("share-modal")).toBeTruthy();
    await userEvent.click(getByTestId("share-btn"));
    expect(setSharingBookmark).toHaveBeenCalledWith(null);
    expect(setShareEmail).toHaveBeenCalledWith("");
  });

  it("shows BookmarkReaderModal when viewingContent is set", () => {
    const { getByTestId } = renderWithBookmarks({
      viewingContent: {
        id: "1",
        title: "Test",
        url: "https://test.com",
        content: "Hello",
      },
      bookmarks: [
        { id: "1", title: "Test", ...baseBm, createdAt: "2020-01-01" },
      ],
      sort: {
        sortedBookmarks: [
          { id: "1", title: "Test", ...baseBm, createdAt: "2020-01-01" },
        ],
      },
    });
    expect(getByTestId("reader-modal")).toBeTruthy();
  });

  it("shows ApiSettingsModal when showApiSettings is true", () => {
    const { getByTestId } = renderWithBookmarks({ showApiSettings: true });
    expect(getByTestId("api-settings-modal")).toBeTruthy();
  });

  it("renders TagFilterBar with all tags", () => {
    const { getByTestId } = renderWithBookmarks({
      bookmarks: [
        { id: "1", title: "Test", ...baseBm, tags: ["tag1", "tag2"] },
      ],
    });
    expect(getByTestId("tag-filter-bar")).toBeTruthy();
  });

  it("renders BulkActionsBar when items selected", () => {
    mockUseBookmarkSelection.mockReturnValue({
      ...defaultBookmarkSelection,
      selectedIds: new Set(["1"]),
    });
    const { getByTestId } = render(<BookmarksTable />);
    expect(getByTestId("bulk-actions-bar")).toBeTruthy();
  });

  describe("sort interactions", () => {
    it("calls handleSort when title header clicked", async () => {
      const handleSort = vi.fn();
      const { getByText } = renderWithBookmarks({ handleSort });
      await userEvent.click(getByText("app_title"));
      expect(handleSort).toHaveBeenCalledWith("title");
    });

    it("calls handleSort when url header clicked", async () => {
      const handleSort = vi.fn();
      const { getByText } = renderWithBookmarks({ handleSort });
      await userEvent.click(getByText("app_url"));
      expect(handleSort).toHaveBeenCalledWith("url");
    });

    it("calls handleSort when createdAt header clicked", async () => {
      const handleSort = vi.fn();
      const { getByText } = renderWithBookmarks({
        sortField: "title",
        handleSort,
      });
      await userEvent.click(getByText("app_createdAt"));
      expect(handleSort).toHaveBeenCalledWith("createdAt");
    });

    it("calls handleSort when updatedAt header clicked", async () => {
      const handleSort = vi.fn();
      const { getByText } = renderWithBookmarks({ handleSort });
      await userEvent.click(getByText("app_updatedAt"));
      expect(handleSort).toHaveBeenCalledWith("updatedAt");
    });

    it("calls handleSort when same column clicked twice", async () => {
      const handleSort = vi.fn();
      const { getByText } = renderWithBookmarks({
        sortField: "title",
        sortDirection: "asc",
        handleSort,
      });
      await userEvent.click(getByText("app_title"));
      expect(handleSort).toHaveBeenCalledWith("title");
    });

    it("calls handleSort with new column when different column clicked", async () => {
      const handleSort = vi.fn();
      const { getByText } = renderWithBookmarks({
        sortField: "title",
        sortDirection: "asc",
        handleSort,
      });
      await userEvent.click(getByText("app_url"));
      expect(handleSort).toHaveBeenCalledWith("url");
    });

    it("pressing Enter on sort header triggers sort", async () => {
      const handleSort = vi.fn();
      const { getByText } = renderWithBookmarks({ handleSort });
      const header = getByText("app_title").closest("button")!;
      header.focus();
      await userEvent.keyboard("{Enter}");
      await userEvent.click(header);
      expect(handleSort).toHaveBeenCalledWith("title");
    });

    it("pressing Space on sort header triggers sort", async () => {
      const handleSort = vi.fn();
      const { getByText } = renderWithBookmarks({ handleSort });
      const header = getByText("app_title").closest("button")!;
      header.focus();
      await userEvent.keyboard(" ");
      await userEvent.click(header);
      expect(handleSort).toHaveBeenCalledWith("title");
    });

    it("pressing non-activation key on sort header does nothing", async () => {
      const handleSort = vi.fn();
      const { getByText } = renderWithBookmarks({ handleSort });
      const header = getByText("app_title").closest("button")!;
      header.focus();
      await userEvent.keyboard("{Tab}");
      expect(handleSort).not.toHaveBeenCalled();
    });
  });

  describe("empty state interactions", () => {
    it("renders empty state when search query has no results", () => {
      const { getByTestId } = renderWithBookmarks({
        bookmarks: [],
        search: { searchQuery: "nonexistent", filteredBookmarks: [] },
        sort: { sortedBookmarks: [] },
      });
      expect(getByTestId("empty-state")).toBeTruthy();
    });

    it("renders empty state when tags selected with no match", () => {
      const { getByTestId } = renderWithBookmarks({
        bookmarks: [],
        search: { selectedTags: ["tag1"], filteredBookmarks: [] },
        sort: { sortedBookmarks: [] },
      });
      expect(getByTestId("empty-state")).toBeTruthy();
    });

    it("renders empty state with both search and tag filters", () => {
      const { getByTestId } = renderWithBookmarks({
        bookmarks: [],
        search: {
          searchQuery: "test",
          selectedTags: ["tag1"],
          filteredBookmarks: [],
        },
        sort: { sortedBookmarks: [] },
      });
      expect(getByTestId("empty-state")).toBeTruthy();
    });

    it("calls onClearFilters when clear button clicked in empty state", async () => {
      const setSelectedTags = vi.fn();
      const { getByTestId } = renderWithBookmarks({
        bookmarks: [],
        search: {
          selectedTags: ["tag1"],
          filteredBookmarks: [],
          setSelectedTags,
        },
        sort: { sortedBookmarks: [] },
      });
      await userEvent.click(getByTestId("clear-filters-btn"));
      expect(setSelectedTags).toHaveBeenCalledWith([]);
    });
  });

  describe("row interactions", () => {
    it("renders expanded bookmark row when expanded", () => {
      const bookmarks = [
        { id: "1", title: "Expanded", ...baseBm, tags: ["tag1"] },
      ];
      mockUseBookmarkSelection.mockReturnValue({
        ...defaultBookmarkSelection,
        expandedIds: new Set(["1"]),
      });
      const { getByTestId } = renderWithBookmarks({
        bookmarks,
        expandedIds: new Set(["1"]),
        selection: { expandedIds: new Set(["1"]) },
        sort: { sortedBookmarks: bookmarks },
        virtualizer: {
          getTotalSize: () => 200,
          getVirtualItems: () => [
            { index: 0, start: 0, size: 200, key: 0, lane: 0 },
          ],
        },
      });
      expect(getByTestId("bookmark-row")).toBeTruthy();
      expect(getByTestId("expanded-bookmark-row")).toBeTruthy();
    });

    it("calls handleSelect when bookmark row clicked", async () => {
      const handleSelect = vi.fn();
      const { getByTestId } = renderWithBookmarks({
        selection: { handleSelect },
      });
      await userEvent.click(getByTestId("bookmark-row"));
      expect(handleSelect).toHaveBeenCalledWith("1");
    });

    it("calls handleViewContent when view button clicked", async () => {
      const setViewingContent = vi.fn();
      const { getByTestId } = renderWithBookmarks({ setViewingContent });
      await userEvent.click(getByTestId("view-content-btn"));
      const callArg = setViewingContent.mock.calls[0]![0];
      expect(callArg).toHaveProperty("id", "1");
      expect(callArg).toHaveProperty("title", "Test");
    });

    it("calls handleAudioSummary without crashing", async () => {
      const { getByTestId } = renderWithBookmarks({});
      await userEvent.click(getByTestId("audio-summary-btn"));
      await vi.waitFor(() => {
        expect(getByTestId("audio-summary-btn")).toBeTruthy();
      });
    });

    it("calls handleDelete when delete button clicked", async () => {
      const handleDelete = vi.fn();
      const { getByTestId } = renderWithBookmarks({
        crud: { handleDelete },
      });
      await userEvent.click(getByTestId("delete-btn"));
      expect(handleDelete).toHaveBeenCalledWith("1");
    });
  });

  describe("bookmark reader modal interactions", () => {
    it("calls handleExportPDF when export PDF button clicked", async () => {
      const { getByTestId } = renderWithBookmarks({
        viewingContent: {
          id: "1",
          title: "Test Doc",
          url: "https://doc.com",
          content: "Body",
        },
        bookmarks: [
          { id: "1", title: "Test Doc", ...baseBm, createdAt: "2020-01-01" },
        ],
        sort: {
          sortedBookmarks: [
            { id: "1", title: "Test Doc", ...baseBm, createdAt: "2020-01-01" },
          ],
        },
      });
      const el = document.createElement("div");
      el.id = "reading-content";
      document.body.appendChild(el);
      expect(getByTestId("reader-modal")).toBeTruthy();
      await userEvent.click(getByTestId("export-pdf-btn"));
    });

    it("calls handleExportMarkdown when export MD button clicked", async () => {
      const { getByTestId } = renderWithBookmarks({
        viewingContent: {
          id: "1",
          title: "Test Doc",
          url: "https://doc.com",
          content: "Body",
        },
        bookmarks: [
          { id: "1", title: "Test Doc", ...baseBm, createdAt: "2020-01-01" },
        ],
        sort: {
          sortedBookmarks: [
            { id: "1", title: "Test Doc", ...baseBm, createdAt: "2020-01-01" },
          ],
        },
      });
      await userEvent.click(getByTestId("export-md-btn"));
    });

    it("calls handleCleanContent when clean button clicked", async () => {
      const setIsCleaningContent = vi.fn();
      const { getByTestId } = renderWithBookmarks({
        viewingContent: {
          id: "1",
          title: "Test Doc",
          url: "https://doc.com",
          content: "Body",
        },
        bookmarks: [
          { id: "1", title: "Test Doc", ...baseBm, createdAt: "2020-01-01" },
        ],
        sort: {
          sortedBookmarks: [
            { id: "1", title: "Test Doc", ...baseBm, createdAt: "2020-01-01" },
          ],
        },
        setIsCleaningContent,
      });
      await userEvent.click(getByTestId("clean-content-btn"));
      expect(setIsCleaningContent).toHaveBeenCalled();
    });
  });

  describe("bulk selection", () => {
    it("calls handleSelectAll when select-all button clicked", async () => {
      const handleSelectAll = vi.fn();
      const bookmarks = [{ id: "1", title: "A", ...baseBm }];
      mockUseBookmarkSelection.mockReturnValue({
        ...defaultBookmarkSelection,
        handleSelectAll,
      });
      mockUseBookmarkData.mockReturnValue({
        ...defaultBookmarkData,
        bookmarks,
      });
      mockUseBookmarkSearch.mockReturnValue({
        ...defaultBookmarkSearch,
        filteredBookmarks: bookmarks,
      });
      mockUseBookmarkSort.mockReturnValue({
        ...defaultBookmarkSort,
        sortedBookmarks: bookmarks,
      });
      mockUseVirtualizer.mockReturnValue({
        getTotalSize: () => 80,
        getVirtualItems: () => [
          { index: 0, start: 0, size: 80, key: 0, lane: 0 },
        ],
      });
      const { getByRole } = render(<BookmarksTable />);
      await userEvent.click(getByRole("button", { name: "app_selectAll" }));
      expect(handleSelectAll).toHaveBeenCalled();
    });

    it("renders deselect-all aria-label when all items selected", async () => {
      const handleSelectAll = vi.fn();
      const bookmarks = [{ id: "1", title: "A", ...baseBm }];
      mockUseBookmarkSelection.mockReturnValue({
        ...defaultBookmarkSelection,
        selectedIds: new Set(["1"]),
        handleSelectAll,
      });
      mockUseBookmarkData.mockReturnValue({
        ...defaultBookmarkData,
        bookmarks,
      });
      mockUseBookmarkSearch.mockReturnValue({
        ...defaultBookmarkSearch,
        filteredBookmarks: bookmarks,
      });
      mockUseBookmarkSort.mockReturnValue({
        ...defaultBookmarkSort,
        sortedBookmarks: bookmarks,
      });
      mockUseVirtualizer.mockReturnValue({
        getTotalSize: () => 80,
        getVirtualItems: () => [
          { index: 0, start: 0, size: 80, key: 0, lane: 0 },
        ],
      });
      const { getByRole } = render(<BookmarksTable />);
      await userEvent.click(getByRole("button", { name: "app_deselectAll" }));
      expect(handleSelectAll).toHaveBeenCalled();
    });
  });

  describe("audio summary", () => {
    it("does not play audio when generateAudio returns a non-string URL", async () => {
      mockGenerateAudio.mockResolvedValueOnce(null);
      const { getByTestId } = renderWithBookmarks();
      await userEvent.click(getByTestId("audio-summary-btn"));
      await vi.waitFor(() => {
        expect(mockGenerateAudio).toHaveBeenCalled();
      });
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("logs an error when audio generation fails", async () => {
      mockGenerateAudio.mockRejectedValueOnce(new Error("tts down"));
      const { getByTestId } = renderWithBookmarks();
      await userEvent.click(getByTestId("audio-summary-btn"));
      await vi.waitFor(() => {
        expect(mockLogger.error).toHaveBeenCalled();
      });
    });
  });

  describe("flashcard generation", () => {
    it("shows a success toast when flashcards are generated", async () => {
      const { getByTestId } = renderWithBookmarks();
      await userEvent.click(getByTestId("flashcards-btn"));
      await vi.waitFor(() => {
        expect(mockFlashcardGenerate).toHaveBeenCalledWith(
          "1",
          "Test",
          "",
          "en",
          true,
          expect.any(AbortSignal),
        );
      });
      const signal = mockFlashcardGenerate.mock.calls[0]![5] as AbortSignal;
      expect(signal.aborted).toBe(false);
      expect(mockToast.success).toHaveBeenCalled();
    });

    it("aborts a pending flashcard generation when the row collapses", async () => {
      let resolveGenerate!: (value: number) => void;
      mockFlashcardGenerate.mockImplementation(
        () =>
          new Promise<number>((resolve) => {
            resolveGenerate = resolve;
          }),
      );
      const expandedIds = new Set<string>(["1"]);
      mockUseBookmarkSelection.mockReturnValue({
        ...defaultBookmarkSelection,
        expandedIds,
      });

      const { rerender, getByTestId } = renderWithBookmarks({
        expandedIds,
        bookmarks: [{ id: "1", title: "Test", ...baseBm }],
      });
      await userEvent.click(getByTestId("flashcards-btn"));
      await vi.waitFor(() => {
        expect(mockFlashcardGenerate).toHaveBeenCalled();
      });

      expandedIds.delete("1");
      mockUseBookmarkSelection.mockReturnValue({
        ...defaultBookmarkSelection,
        expandedIds: new Set(),
      });
      rerender(<BookmarksTable />);

      await vi.waitFor(() => {
        const signal = mockFlashcardGenerate.mock.calls[0]![5] as AbortSignal;
        expect(signal.aborted).toBe(true);
      });
      resolveGenerate(3);
    });

    it("does not toast when zero flashcards are generated", async () => {
      mockFlashcardGenerate.mockResolvedValueOnce(0);
      const { getByTestId } = renderWithBookmarks();
      await userEvent.click(getByTestId("flashcards-btn"));
      await vi.waitFor(() => {
        expect(mockFlashcardGenerate).toHaveBeenCalled();
      });
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    it("logs an error when flashcard generation fails", async () => {
      mockFlashcardGenerate.mockRejectedValueOnce(new Error("gen failed"));
      const { getByTestId } = renderWithBookmarks();
      await userEvent.click(getByTestId("flashcards-btn"));
      await vi.waitFor(() => {
        expect(mockLogger.error).toHaveBeenCalled();
      });
    });
  });

  describe("content fetch", () => {
    it("updates viewing content with fetched result", async () => {
      const setViewingContent = vi.fn();
      const { getByTestId } = renderWithBookmarks({
        viewingContent: {
          id: "1",
          title: "Test",
          url: "https://test.com",
          content: "Old",
        },
        setViewingContent,
        bookmarks: [{ id: "1", title: "Test", ...baseBm }],
        sort: { sortedBookmarks: [{ id: "1", title: "Test", ...baseBm }] },
      });
      await userEvent.click(getByTestId("fetch-content-btn"));
      await vi.waitFor(() => {
        expect(mockFetchAndExtract).toHaveBeenCalled();
      });
      expect(setViewingContent).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Fetched Title", content: "Fetched Body" }),
      );
    });

    it("logs an error when content fetch fails", async () => {
      mockFetchAndExtract.mockRejectedValueOnce(new Error("network"));
      const { getByTestId } = renderWithBookmarks({
        viewingContent: {
          id: "1",
          title: "Test",
          url: "https://test.com",
          content: "Old",
        },
        bookmarks: [{ id: "1", title: "Test", ...baseBm }],
        sort: { sortedBookmarks: [{ id: "1", title: "Test", ...baseBm }] },
      });
      await userEvent.click(getByTestId("fetch-content-btn"));
      await vi.waitFor(() => {
        expect(mockLogger.error).toHaveBeenCalled();
      });
    });
  });

  describe("content cleaning", () => {
    it("patches the document when cleaning succeeds", async () => {
      const patch = vi.fn().mockResolvedValue(undefined);
      mockInitDB.mockResolvedValueOnce({
        bookmarks: {
          findOne: () => ({
            exec: async () => ({ content: "  Hello\n\n\nWorld  ", incrementalPatch: patch }),
          }),
        },
      });
      const { getByTestId } = renderWithBookmarks({
        viewingContent: {
          id: "1",
          title: "Test",
          url: "https://test.com",
          content: "Old",
        },
        bookmarks: [{ id: "1", title: "Test", ...baseBm }],
        sort: { sortedBookmarks: [{ id: "1", title: "Test", ...baseBm }] },
      });
      await userEvent.click(getByTestId("clean-content-btn"));
      await vi.waitFor(() => {
        expect(patch).toHaveBeenCalled();
      });
      expect(patch.mock.calls[0]![0]).toEqual(
        expect.objectContaining({
          content: "Hello World",
          updatedAt: expect.any(String),
        }),
      );
    });

    it("logs an error when initDB fails during cleaning", async () => {
      mockInitDB.mockRejectedValueOnce(new Error("db down"));
      const { getByTestId } = renderWithBookmarks({
        viewingContent: {
          id: "1",
          title: "Test",
          url: "https://test.com",
          content: "Old",
        },
        bookmarks: [{ id: "1", title: "Test", ...baseBm }],
        sort: { sortedBookmarks: [{ id: "1", title: "Test", ...baseBm }] },
      });
      await userEvent.click(getByTestId("clean-content-btn"));
      await vi.waitFor(() => {
        expect(mockLogger.error).toHaveBeenCalled();
      });
    });
  });

  describe("share guard", () => {
    it("does not navigate when email is empty", async () => {
      const setSharingBookmark = vi.fn();
      const setShareEmail = vi.fn();
      const { getByTestId } = renderWithBookmarks({
        sharingBookmark: { id: "1", title: "Test", url: "https://test.com" },
        setSharingBookmark,
        shareEmail: "",
        setShareEmail,
      });
      await userEvent.click(getByTestId("share-btn"));
      expect(setSharingBookmark).not.toHaveBeenCalled();
      expect(setShareEmail).not.toHaveBeenCalled();
    });
  });

  describe("virtualized rows", () => {
    it("renders multiple bookmark rows via virtualizer", () => {
      const bookmarks = [
        { id: "1", title: "First", ...baseBm },
        {
          id: "2",
          title: "Second",
          ...baseBm,
          createdAt: "2024-02-01",
          updatedAt: "2024-02-01",
          tags: ["tag1"],
        },
      ];
      const { getAllByTestId, getByText } = renderWithBookmarks({
        bookmarks,
        search: { filteredBookmarks: bookmarks },
        sort: { sortedBookmarks: bookmarks },
        selection: { selectedIds: new Set(), expandedIds: new Set() },
        virtualizer: {
          getTotalSize: () => 160,
          getVirtualItems: () => [
            { index: 0, start: 0, size: 80, key: 0, lane: 0 },
            { index: 1, start: 80, size: 80, key: 1, lane: 0 },
          ],
        },
      });
      expect(getAllByTestId("bookmark-row")).toHaveLength(2);
      expect(getByText("First")).toBeTruthy();
      expect(getByText("Second")).toBeTruthy();
    });

    it("handles virtual item pointing to missing bookmark gracefully", () => {
      const bookmarks = [{ id: "1", title: "Only", ...baseBm }];
      const { container } = renderWithBookmarks({
        bookmarks,
        search: { filteredBookmarks: bookmarks },
        sort: { sortedBookmarks: bookmarks },
        virtualizer: {
          getTotalSize: () => 80,
          getVirtualItems: () => [
            { index: 5, start: 0, size: 80, key: 5, lane: 0 },
          ],
        },
      });
      expect(
        container.querySelector('[data-testid="bookmark-row"]'),
      ).toBeNull();
    });

    it("sets correct virtual container height from getTotalSize", () => {
      const { container } = renderWithBookmarks({
        virtualizer: {
          getTotalSize: () => 400,
          getVirtualItems: () => [
            { index: 0, start: 0, size: 80, key: 0, lane: 0 },
          ],
        },
      });
      expect(container.querySelector('[style*="height: 400px"]')).toBeTruthy();
    });
  });
});
