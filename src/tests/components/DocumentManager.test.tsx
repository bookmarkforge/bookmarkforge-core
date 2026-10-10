import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("../../i18n", () => ({
  default: { language: "en", t: (k: string) => k },
}));
vi.mock("react-i18next", () => {
  const t = (key: string, opts?: any) => {
    if (typeof opts === "string") return opts;
    if (opts && typeof opts === "object" && opts.defaultValue) return opts.defaultValue;
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: "en" } }),
    initReactI18next: { type: "3rdParty", init: vi.fn() },
  };
});

// RxDB-hooks useRxQuery / useRxCollection mocks return `{ result: [...] }` where
// production code destructures with the toJSON shape. The literal `[]` widens to
// `never[]` and TS rejects the assignment. Cast through `any[]` keeps runtime
// unchanged (vi.fn ignores the annotation) while satisfying structural typing.
const mockFindExec = vi.fn().mockResolvedValue([] as any[]);
const mockUseRxQuery = vi.fn(() => ({ result: [] as any[] }));
vi.mock("../../hooks/useRxDB", () => ({
  useRxCollection: vi.fn(() => ({
    find: vi.fn(() => ({ exec: mockFindExec })),
  })),
  useRxQuery: mockUseRxQuery,
}));

const mockDocumentsUpsert = vi.fn().mockResolvedValue({});
const mockDocumentsFindOneExec = vi.fn().mockResolvedValue(null);
const mockFoldersUpsert = vi.fn().mockResolvedValue({});
vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue({
    documents: {
      upsert: mockDocumentsUpsert,
      findOne: vi.fn(() => ({ exec: mockDocumentsFindOneExec })),
    },
    folders: {
      upsert: mockFoldersUpsert,
    },
  }),
}));

const mockToast = { success: vi.fn(), error: vi.fn(), loading: vi.fn() };
vi.mock("sonner", () => ({ toast: mockToast }));

const mockLoggerError = vi.hoisted(() => vi.fn());
vi.mock("../../utils/logger", () => ({ logger: { error: mockLoggerError } }));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Search: mock("Search"),
    FileText: mock("FileText"),
    Plus: mock("Plus"),
    Trash2: mock("Trash2"),
    Folder: mock("Folder"),
    Sparkles: mock("Sparkles"),
    ChevronRight: mock("ChevronRight"),
    LayoutGrid: mock("LayoutGrid"),
    List: mock("List"),
    Loader2: mock("Loader2"),
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

// DocumentManager statically imports SemanticSearchService (→ ProviderManager →
// WebLLM/transformers) and RAGEngine (→ ResourceManager). Loading those heavy
// AI modules inside the vitest worker exhausts the heap and kills the process
// with a JS OOM. Stub them here (same pattern as BlockEditor.test.tsx); the
// component only calls expandQuery / searchSimilar in search flows that these
// tests never trigger.
const mockSearchSimilar = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockExpandQuery = vi.hoisted(() => vi.fn().mockResolvedValue(""));
const mockPrefetch = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../services/ai/RAGEngine", () => ({
  ragEngine: {
    searchSimilar: mockSearchSimilar,
    generateEmbedding: vi.fn().mockResolvedValue([]),
    prefetch: mockPrefetch,
  },
  onEmbeddingProgress: vi.fn(() => () => {}),
}));

vi.mock("../../services/ai/SemanticSearchService", () => ({
  semanticSearchService: {
    expandQuery: mockExpandQuery,
  },
  runWithTimeout: (
    operation: (signal: AbortSignal) => Promise<unknown>,
    _timeoutMs: number,
    signal?: AbortSignal,
  ) => operation(signal ?? new AbortController().signal),
}));

vi.mock("../../components/EmbeddingProgressIndicator", () => ({
  EmbeddingProgressIndicator: () => <div data-testid="embedding-progress" />,
}));

describe("DocumentManager", () => {
  let DocumentManager: React.FC<any>;
  const onSelectDocument = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../components/DocumentManager");
    DocumentManager = mod.default;
  });

  it("renders without errors", () => {
    const { container } = render(
      <DocumentManager onSelectDocument={onSelectDocument} />,
    );
    expect(container).toBeTruthy();
  });

  it("renders section title", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("app_myDocuments")).toBeTruthy();
  });

  it("shows empty state when there are no documents", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("app_noDocumentsYet")).toBeTruthy();
  });

  it("renders new document button", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("app_newDocument")).toBeTruthy();
  });

  it("renders sidebar with workspace and folders", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("app_workspace")).toBeTruthy();
    expect(screen.getByText("app_allDocuments")).toBeTruthy();
  });

  it("renders search input", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByLabelText("app_searchPlaceholder")).toBeTruthy();
  });

  it("renders view switching buttons", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(
      screen.getAllByTestId("icon-LayoutGrid").length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("icon-List")).toBeTruthy();
  });

  it("shows empty document text when there are no results", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("app_createFirstDocument")).toBeTruthy();
  });

  it("updates searchTerm when typing in the search input", async () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const input = screen.getByLabelText("app_searchPlaceholder");
    await userEvent.type(input, "test query");
    expect(input).toHaveValue("test query");
  });

  it("shows app_noResultsFound when typing a search term", async () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const input = screen.getByLabelText("app_searchPlaceholder");
    await userEvent.type(input, "xyz123");
    expect(screen.getByText("app_noResultsFound")).toBeTruthy();
  });

  it("switches to list mode when clicking the list button", async () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const listButtons = screen.getAllByTestId("icon-List");
    await userEvent.click(listButtons[0]!);
    expect(listButtons[0]!.closest("button")).toHaveClass(/bg-white/);
  });

  it("calls createNewFolder when clicking the sidebar plus button", async () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const plusButtons = screen.getAllByTestId("icon-Plus");
    await userEvent.click(plusButtons[0]!);
    await waitFor(() => {
      expect(mockFoldersUpsert).toHaveBeenCalled();
    });
  });

  it("calls createNew when clicking the new document button", async () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    await userEvent.click(screen.getByText("app_newDocument"));
    await waitFor(() => {
      expect(mockDocumentsUpsert).toHaveBeenCalled();
    });
  });

  it("shows success toast when creating a document", async () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    await userEvent.click(screen.getByText("app_newDocument"));
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith("app_documentCreated");
    });
  });

  it("discards a pending creation after unmount", async () => {
    let resolveInit!: (value: unknown) => void;
    const pendingInit = new Promise((resolve) => {
      resolveInit = resolve;
    });
    const { initDB } = await import("../../db/database");
    (initDB as any).mockReturnValueOnce(pendingInit);

    const { unmount } = render(
      <DocumentManager onSelectDocument={onSelectDocument} />,
    );
    await userEvent.click(screen.getByText("app_newDocument"));
    await waitFor(() => expect(initDB).toHaveBeenCalled());

    unmount();
    resolveInit!({
      documents: { upsert: vi.fn().mockResolvedValue({}) },
      folders: { upsert: vi.fn().mockResolvedValue({}) },
    });
    await act(async () => { await Promise.resolve(); });

    expect(mockToast.success).not.toHaveBeenCalledWith("app_documentCreated");
    expect(onSelectDocument).not.toHaveBeenCalled();
  });

  it("calls onSelectDocument when creating a new document", async () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    await userEvent.click(screen.getByText("app_newDocument"));
    await waitFor(() => {
      expect(onSelectDocument).toHaveBeenCalled();
    });
  });

  it("shows error toast when document creation fails", async () => {
    const { initDB } = await import("../../db/database");
    (initDB as any).mockRejectedValueOnce(new Error("DB error"));
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    await userEvent.click(screen.getByText("app_newDocument"));
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("app_createDocError");
    });
  });

  it("shows success toast when creating a folder", async () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const plusButtons = screen.getAllByTestId("icon-Plus");
    await userEvent.click(plusButtons[0]!);
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith("app_folderCreated");
    });
  });

  it("shows error toast when folder creation fails", async () => {
    const { initDB } = await import("../../db/database");
    (initDB as any).mockRejectedValueOnce(new Error("DB error"));
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const plusButtons = screen.getAllByTestId("icon-Plus");
    await userEvent.click(plusButtons[0]!);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("app_createFolderError");
    });
  });

  it("renders Documents breadcrumb section", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("app_documents")).toBeTruthy();
  });

  it("renders all documents button", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("app_allDocuments")).toBeTruthy();
  });

  it("renders folders label in sidebar", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("app_folders")).toBeTruthy();
  });

  it("renders title with app_myDocuments when no folder is selected", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("app_myDocuments")).toBeTruthy();
  });

  it("renders FileText icon in empty state", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByTestId("icon-FileText")).toBeTruthy();
  });

  it("renders Search icon in the search input", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByTestId("icon-Search")).toBeTruthy();
  });

  it("allows searching by tag", async () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const input = screen.getByLabelText("app_searchPlaceholder");
    await userEvent.type(input, "important");
    expect(screen.getByText("app_noResultsFound")).toBeTruthy();
  });

  it("switches between grid and list views", async () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const listBtns = screen.getAllByTestId("icon-List");
    await userEvent.click(listBtns[0]!);
    expect(listBtns[0]!.closest("button")).toHaveClass(/bg-white/);
  });

  it("shows all LayoutGrid icons", () => {
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const gridIcons = screen.getAllByTestId("icon-LayoutGrid");
    expect(gridIcons.length).toBeGreaterThanOrEqual(1);
  });
});

function makeDoc(overrides: Record<string, any> = {}) {
  return {
    id: "doc-1",
    folderId: "root",
    title: "Test Doc",
    blocks: [],
    textContent: "Some content here",
    summary: "",
    tags: ["important", "work"],
    links: [],
    embedding: [],
    processed: true,
    isPrivate: false,
    isDeleted: false,
    createdAt: "2025-01-15T10:00:00.000Z",
    updatedAt: "2025-03-20T14:30:00.000Z",
    ...overrides,
  };
}

function makeFolder(overrides: Record<string, any> = {}) {
  return {
    id: "folder-1",
    title: "My Folder",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function wrapToJSON(obj: Record<string, any>) {
  return { toJSON: () => obj };
}

describe("DocumentManager - Branch coverage maximization", () => {
  let DocumentManager: React.FC<any>;
  const onSelectDocument = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../components/DocumentManager");
    DocumentManager = mod.default;
  });

  it("does nothing when delete target document is not found (doc null)", async () => {
    const mockPatch = vi.fn();
    const mockFindOneExec = vi.fn().mockResolvedValue(null);
    const { initDB } = await import("../../db/database");
    (initDB as any).mockResolvedValue({
      documents: {
        upsert: vi.fn().mockResolvedValue({}),
        findOne: vi.fn(() => ({ exec: mockFindOneExec })),
      },
      folders: { upsert: vi.fn().mockResolvedValue({}) },
    });

    const doc = makeDoc({ id: "doc-notfound", title: "Not Found Doc" });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const trashIcons = screen.getAllByTestId("icon-Trash2");
    await userEvent.click(trashIcons[0]!.closest("button")!);
    await waitFor(() => {
      expect(mockFindOneExec).toHaveBeenCalled();
    });
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalledWith("app_documentDeleted");
  });

  it("does not render tag spans in grid when tags is undefined", () => {
    const doc = makeDoc({ tags: undefined });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.queryAllByText(/^#\w+$/).length).toBe(0);
  });

  it("does not render tag spans in grid when tags is empty array", () => {
    const doc = makeDoc({ tags: [] });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.queryAllByText(/^#\w+$/).length).toBe(0);
  });

  it("renders only one tag span when tags has single element", () => {
    const doc = makeDoc({ tags: ["solo"] });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("#solo")).toBeTruthy();
    expect(screen.queryAllByText(/^#\w+$/).length).toBe(1);
  });

  it("does not show Sparkles when processed is undefined (not false)", () => {
    const doc = makeDoc({ processed: undefined });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    // The AI-search toggle button always renders a Sparkles icon, so the
    // query can never be null. The doc-level Sparkles badge (rendered only
    // when processed === false) must be absent, leaving exactly the button's
    // single Sparkles instance.
    expect(screen.getAllByTestId("icon-Sparkles").length).toBe(1);
  });

  it("falls back to createdAt in grid when updatedAt is undefined", () => {
    const doc = makeDoc({
      updatedAt: undefined,
      createdAt: "2024-08-10T08:00:00.000Z",
    });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(
      screen.getByText(/8\/10\/2024|10\/8\/2024|08\/10\/2024/),
    ).toBeTruthy();
  });

  it("falls back to emptyDocument in grid when textContent is null", () => {
    const doc = makeDoc({ textContent: null });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("app_emptyDocument")).toBeTruthy();
  });

  it("renders no tag spans in list view when tags is undefined", async () => {
    const doc = makeDoc({ tags: undefined });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    await userEvent.click(screen.getAllByTestId("icon-List")[0]!);
    expect(screen.queryAllByText(/^#\w+$/).length).toBe(0);
  });

  it("renders no tag spans in list view when tags is empty", async () => {
    const doc = makeDoc({ tags: [] });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    await userEvent.click(screen.getAllByTestId("icon-List")[0]!);
    expect(screen.queryAllByText(/^#\w+$/).length).toBe(0);
  });

  it("falls back to createdAt in list view when updatedAt is undefined", async () => {
    const doc = makeDoc({
      updatedAt: undefined,
      createdAt: "2023-12-25T00:00:00.000Z",
    });
    mockUseRxQuery.mockReturnValue({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    await userEvent.click(screen.getAllByTestId("icon-List")[0]!);
    expect(screen.getByText(/12\/25\/2023|25\/12\/2023/)).toBeTruthy();
  });

  it("handles undefined result from useRxQuery gracefully", () => {
    // The mock is typed to return `{ result: any[] }` but this test exercises
    // the production code's defensive path for `result: undefined`. Cast to
    // `any` to keep the runtime semantics intact without retyping the mock.
    mockUseRxQuery.mockReturnValueOnce({ result: undefined } as any);
    mockUseRxQuery.mockReturnValueOnce({ result: undefined } as any);
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("app_noDocumentsYet")).toBeTruthy();
  });

  it("shows document count next to folder in sidebar", () => {
    const folder = makeFolder({ id: "f-count", title: "Counted Folder" });
    const doc1 = makeDoc({ id: "dc1", folderId: "f-count", title: "Doc A" });
    const doc2 = makeDoc({ id: "dc2", folderId: "f-count", title: "Doc B" });
    mockUseRxQuery.mockReturnValueOnce({
      result: [wrapToJSON(doc1), wrapToJSON(doc2)],
    });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(folder)] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("applies active styling to All Documents button when selected", () => {
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const allBtn = screen.getByText("app_allDocuments").closest("button")!;
    expect(allBtn).toHaveClass(/bg-[var(--bg-secondary)]/);
  });

  it("applies active styling to folder button when that folder is selected", async () => {
    const folder = makeFolder({ id: "f-active", title: "Active Folder" });
    let rxqCalls = 0;
    mockUseRxQuery.mockImplementation(() => {
      rxqCalls++;
      if (rxqCalls % 2 === 1) return { result: [] };
      return { result: [wrapToJSON(folder)] };
    });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const sidebarBtn = screen
      .getAllByText("Active Folder")[0]!
      .closest("button")!;
    await userEvent.click(sidebarBtn);
    expect(sidebarBtn).toHaveClass(/bg-[var(--bg-secondary)]/);
  });

  it("does not filter out document when isDeleted is undefined", () => {
    const doc = makeDoc({ isDeleted: undefined, title: "No Delete Flag" });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    expect(screen.getByText("No Delete Flag")).toBeTruthy();
  });

  it("calls patch with isDeleted=true from list view delete", async () => {
    const mockPatch = vi.fn().mockResolvedValue({});
    const mockFindOneExec = vi.fn().mockResolvedValue({ incrementalPatch: mockPatch });
    const { initDB } = await import("../../db/database");
    (initDB as any).mockResolvedValue({
      documents: {
        upsert: vi.fn().mockResolvedValue({}),
        findOne: vi.fn(() => ({ exec: mockFindOneExec })),
      },
      folders: { upsert: vi.fn().mockResolvedValue({}) },
    });
    const doc = makeDoc({ id: "doc-list-del", title: "List Delete" });
    mockUseRxQuery.mockReturnValue({ result: [wrapToJSON(doc)] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    await userEvent.click(screen.getAllByTestId("icon-List")[0]!);
    const trashIcons = screen.getAllByTestId("icon-Trash2");
    await userEvent.click(trashIcons[0]!.closest("button")!);
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        expect.objectContaining({ isDeleted: true }),
      );
    });
    expect(onSelectDocument).not.toHaveBeenCalled();
  });

  it("shows error toast when delete fails in list view", async () => {
    const mockFindOneExec = vi
      .fn()
      .mockRejectedValueOnce(new Error("List delete fail"));
    const { initDB } = await import("../../db/database");
    (initDB as any).mockResolvedValue({
      documents: {
        upsert: vi.fn().mockResolvedValue({}),
        findOne: vi.fn(() => ({ exec: mockFindOneExec })),
      },
      folders: { upsert: vi.fn().mockResolvedValue({}) },
    });
    const doc = makeDoc({ id: "doc-list-err", title: "List Error" });
    mockUseRxQuery.mockReturnValue({ result: [wrapToJSON(doc)] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    await userEvent.click(screen.getAllByTestId("icon-List")[0]!);
    const trashIcons = screen.getAllByTestId("icon-Trash2");
    await userEvent.click(trashIcons[0]!.closest("button")!);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("app_deleteError");
    });
  });

  it("renders h2 with folder title when folder is selected", async () => {
    const folder = makeFolder({ id: "f-h2", title: "My Special Folder" });
    let rxqCalls = 0;
    mockUseRxQuery.mockImplementation(() => {
      rxqCalls++;
      if (rxqCalls % 2 === 1) return { result: [] };
      return { result: [wrapToJSON(folder)] };
    });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    await userEvent.click(screen.getByText("My Special Folder"));
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("My Special Folder");
  });

  it("renders h1 with app_myDocuments when all documents selected", () => {
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("app_myDocuments");
  });

  // ── AI Search toggle ──

  it("toggles semantic search when AI Search button is clicked", async () => {
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    // Find the AI Search button by its Sparkles icon (text is hidden on mobile in jsdom)
    const sparkleIcons = screen.getAllByTestId("icon-Sparkles");
    const aiBtn = sparkleIcons[0]!.closest("button")!;
    await userEvent.click(aiBtn);
    // After toggle, the AI Search button should have the active class
    expect(aiBtn).toHaveClass(/bg-blue-500/);
    expect(mockPrefetch).toHaveBeenCalledTimes(1);
  });

  // ── Breadcrumb with selected folder ──

  it("shows breadcrumb with folder name when a folder is selected", async () => {
    const folder = makeFolder({ id: "f-bc", title: "Breadcrumb Folder" });
    let rxqCalls = 0;
    mockUseRxQuery.mockImplementation(() => {
      rxqCalls++;
      if (rxqCalls % 2 === 1) return { result: [] };
      return { result: [wrapToJSON(folder)] };
    });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    await userEvent.click(screen.getByText("Breadcrumb Folder"));
    // Breadcrumb text appears; use getAllByText since folder name appears twice (sidebar + breadcrumb)
    expect(screen.getAllByText("Breadcrumb Folder").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("icon-ChevronRight")).toBeTruthy();
  });

  // ── Processed=false sparkles badge ──

  it("shows Sparkles badge when processed is false", () => {
    const doc = makeDoc({ id: "unprocessed", title: "Unprocessed Doc", processed: false });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    // Should have 2 Sparkles: one in AI search button, one as badge on the card
    expect(screen.getAllByTestId("icon-Sparkles").length).toBe(2);
  });

  // ── Keyboard Enter on grid card ──

  it("calls onSelectDocument with Enter on a grid card", async () => {
    const doc = makeDoc({ id: "enter-doc", title: "Keyboard Doc" });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    const onSelect = vi.fn();
    render(<DocumentManager onSelectDocument={onSelect} />);
    // Cards are now native <button> elements: keyboard activation (Enter) is
    // the browser's built-in behavior, so we focus and press Enter via userEvent.
    const card = screen.getByText("Keyboard Doc").closest("button")!;
    card.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("enter-doc");
  });

  // ── Delete from grid view ──

  it("deletes document from the grid view", async () => {
    const mockPatch = vi.fn().mockResolvedValue({});
    const mockFindOneExec = vi.fn().mockResolvedValue({ incrementalPatch: mockPatch });
    const { initDB } = await import("../../db/database");
    (initDB as any).mockResolvedValue({
      documents: {
        upsert: vi.fn().mockResolvedValue({}),
        findOne: vi.fn(() => ({ exec: mockFindOneExec })),
      },
      folders: { upsert: vi.fn().mockResolvedValue({}) },
    });
    const doc = makeDoc({ id: "grid-del", title: "Grid Delete" });
    mockUseRxQuery.mockReturnValue({ result: [wrapToJSON(doc)] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const trashIcons = screen.getAllByTestId("icon-Trash2");
    await userEvent.click(trashIcons[0]!.closest("button")!);
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        expect.objectContaining({ isDeleted: true }),
      );
    });
    expect(onSelectDocument).not.toHaveBeenCalled();
  });

  // ── Keyboard Space on grid card ──

  it("calls onSelectDocument with Space on a grid card", async () => {
    const doc = makeDoc({ id: "space-doc", title: "Space Doc" });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    const onSelect = vi.fn();
    render(<DocumentManager onSelectDocument={onSelect} />);
    const card = screen.getByText("Space Doc").closest("button")!;
    card.focus();
    await userEvent.keyboard("{ }");
    expect(onSelect).toHaveBeenCalledWith("space-doc");
  });

  // ── Click on document card calls onSelectDocument ──

  it("calls onSelectDocument when clicking a grid card", async () => {
    const doc = makeDoc({ id: "click-doc", title: "Clickable Doc" });
    mockUseRxQuery.mockReturnValueOnce({ result: [wrapToJSON(doc)] });
    mockUseRxQuery.mockReturnValueOnce({ result: [] });
    const onSelect = vi.fn();
    render(<DocumentManager onSelectDocument={onSelect} />);
    await userEvent.click(screen.getByText("Clickable Doc"));
    expect(onSelect).toHaveBeenCalledWith("click-doc");
  });

  // ── Breadcrumb "Documents" returns to "all" via Enter key ──

  it("vuelve a 'all documents' con Enter en el breadcrumb", () => {
    const folder = makeFolder({ id: "f-bc2", title: "BC Folder" });
    let rxqCalls = 0;
    mockUseRxQuery.mockImplementation(() => {
      rxqCalls++;
      if (rxqCalls % 2 === 1) return { result: [] };
      return { result: [wrapToJSON(folder)] };
    });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    // Click the folder in sidebar first
    const folderBtn = screen.getByText("BC Folder").closest("button")!;
    fireEvent.click(folderBtn);
    // Now the breadcrumb shows "Documents > BC Folder" — fire Enter on "Documents"
    const docBreadcrumb = screen.getByText("app_documents");
    fireEvent.keyDown(docBreadcrumb, { key: "Enter" });
    // Should go back to "all" — h1 should show app_myDocuments
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "app_myDocuments",
    );
  });

  // ── Semantic search: placeholder changes when toggled ──

  it("changes the placeholder when enabling semantic search", async () => {
    mockUseRxQuery.mockReturnValue({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const sparkleIcons = screen.getAllByTestId("icon-Sparkles");
    await userEvent.click(sparkleIcons[0]!.closest("button")!);
    const input = screen.getByLabelText("app_searchPlaceholder");
    // Placeholder should change (t() returns the key; ?? fallback not triggered)
    expect(input.getAttribute("placeholder")).toBe(
      "app_semanticSearchPlaceholder",
    );
  });

  // ── Semantic search: full flow (expandQuery + searchSimilar) ──

  it("runs semantic search when the term exceeds 2 chars", async () => {
    const semDoc = makeDoc({ id: "sem-1", title: "Semantic Match" });
    mockExpandQuery.mockResolvedValue("expanded query");
    mockSearchSimilar.mockResolvedValue([semDoc]);
    mockUseRxQuery.mockReturnValue({ result: [wrapToJSON(semDoc)] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const sparkleIcons = screen.getAllByTestId("icon-Sparkles");
    await userEvent.click(sparkleIcons[0]!.closest("button")!);
    const input = screen.getByLabelText("app_searchPlaceholder");
    await userEvent.type(input, "meaning");
    await waitFor(() => {
      expect(mockExpandQuery).toHaveBeenCalledWith(
        "meaning",
        expect.any(AbortSignal),
      );
    });
    expect(mockSearchSimilar).toHaveBeenCalledWith(
      "expanded query",
      expect.any(Array),
      10,
      expect.any(AbortSignal),
    );
    expect((mockExpandQuery.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(
      false,
    );
  });

  it("logs error if semantic search fails", async () => {
    mockExpandQuery.mockResolvedValue("expanded");
    mockSearchSimilar.mockRejectedValue(new Error("semantic down"));
    mockUseRxQuery.mockReturnValue({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const sparkleIcons = screen.getAllByTestId("icon-Sparkles");
    await userEvent.click(sparkleIcons[0]!.closest("button")!);
    const input = screen.getByLabelText("app_searchPlaceholder");
    await userEvent.type(input, "meaning");
    await waitFor(() => {
      expect(mockLoggerError).toHaveBeenCalledWith(
        "[DocumentManager] Semantic search failed",
        expect.any(Object),
      );
    });
  });

  it("does not run semantic search with term <= 2 chars", async () => {
    mockExpandQuery.mockResolvedValue("");
    mockSearchSimilar.mockResolvedValue([]);
    mockUseRxQuery.mockReturnValue({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const sparkleIcons = screen.getAllByTestId("icon-Sparkles");
    await userEvent.click(sparkleIcons[0]!.closest("button")!);
    const input = screen.getByLabelText("app_searchPlaceholder");
    await userEvent.type(input, "hi");
    // Debounce fires but term is too short → no semantic call
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(mockExpandQuery).not.toHaveBeenCalled();
    expect(mockSearchSimilar).not.toHaveBeenCalled();
  });

  it("merges hybrid results (text + semantic) without duplicates", async () => {
    const textDoc = makeDoc({ id: "t1", title: "Alpha Doc", tags: ["alpha"] });
    const semDoc = makeDoc({ id: "s1", title: "Semantic Only", tags: [] });
    mockExpandQuery.mockResolvedValue("alpha");
    mockSearchSimilar.mockResolvedValue([semDoc]);
    // Alternation: the first query (documents) returns the docs; the second
    // (folders) returns [] so the sidebar does not duplicate titles.
    let rxqCalls = 0;
    mockUseRxQuery.mockImplementation(() => {
      rxqCalls++;
      if (rxqCalls % 2 === 1) {
        return { result: [wrapToJSON(textDoc), wrapToJSON(semDoc)] };
      }
      return { result: [] };
    });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const sparkleIcons = screen.getAllByTestId("icon-Sparkles");
    await userEvent.click(sparkleIcons[0]!.closest("button")!);
    const input = screen.getByLabelText("app_searchPlaceholder");
    await userEvent.type(input, "alpha");
    // Text match (alpha) + semantic-only result both visible
    await waitFor(() => {
      expect(screen.getByText("Alpha Doc")).toBeTruthy();
    });
    expect(screen.getByText("Semantic Only")).toBeTruthy();
  });

  it("shows Loader2 while semantic search is in progress", async () => {
    let resolveSearch!: (v: unknown) => void;
    mockExpandQuery.mockResolvedValue("expanded");
    mockSearchSimilar.mockImplementation(
      () => new Promise((res) => (resolveSearch = res)),
    );
    mockUseRxQuery.mockReturnValue({ result: [] });
    render(<DocumentManager onSelectDocument={onSelectDocument} />);
    const sparkleIcons = screen.getAllByTestId("icon-Sparkles");
    await userEvent.click(sparkleIcons[0]!.closest("button")!);
    const input = screen.getByLabelText("app_searchPlaceholder");
    await userEvent.type(input, "meaning");
    await waitFor(() => {
      expect(screen.getByTestId("icon-Loader2")).toBeTruthy();
    });
    resolveSearch([]);
    await waitFor(() => {
      expect(screen.queryByTestId("icon-Loader2")).toBeNull();
    });
  });
});
