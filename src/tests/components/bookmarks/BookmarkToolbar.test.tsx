import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import {
  BookmarkToolbar,
  SearchBar,
  BulkActionsBar,
} from "../../../components/bookmarks/BookmarkToolbar";

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../../mocks/motion");
  return createMotionMock();
});

const mockT = vi.fn((key: string) => {
  const map: Record<string, string> = {
    app_bookmarks: "Bookmarks",
    app_bookmarksDesc: "Manage your bookmarks",
    app_generateEmbeddings: "Embeddings",
    app_generating: "Generating...",
    app_summarizeAll: "Summarize All",
    app_summarizing: "Summarizing...",
    app_generateAllOverviews: "Overviews",
    app_importHtml: "Import HTML",
    app_importing: "Importing...",
    app_exportCsv: "Export CSV",
    app_aiSettings: "AI Settings",
    app_semanticSearchPlaceholder: "Search by meaning...",
    app_searchPlaceholder: "Search bookmarks...",
    app_aiSearch: "AI Search",
    app_thinkingSemantically: "Semantic search active",
    app_selected: "selected",
    app_typeTag: "Type tag name",
    app_addTag: "Add",
    app_removeTag: "Remove",
    app_deleteSelected: "Delete",
    app_clearTags: "Clear",
    app_exportJson: "Export",
    app_generateOverviews: "Generate",
    app_synthesizing: "Synthesizing...",
    app_summarizeCollection: "Summarize",
    app_autoTagPrompt: "Auto Tag",
  };
  return map[key] || key;
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

describe("BookmarkToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders main buttons", () => {
    const { getByText } = render(
      <BookmarkToolbar
        bookmarks={[]}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={false}
        isSummarizingAll={false}
        isGeneratingAllOverviews={false}
        isImporting={false}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={vi.fn()}
        onSummarizeAll={vi.fn()}
        onGenerateAllOverviews={vi.fn()}
        onImportHTML={vi.fn()}
        onShowApiSettings={vi.fn()}
        onExportCSV={vi.fn()}
        fileInputRef={{ current: null } as any}
      />,
    );
    expect(getByText("Embeddings")).toBeTruthy();
    expect(getByText("Summarize All")).toBeTruthy();
    expect(getByText("Overviews")).toBeTruthy();
    expect(getByText("Import HTML")).toBeTruthy();
    expect(getByText("Export CSV")).toBeTruthy();
    expect(getByText("AI Settings")).toBeTruthy();
  });

  it("disables buttons while processing", () => {
    const { getAllByText } = render(
      <BookmarkToolbar
        bookmarks={[]}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={true}
        isSummarizingAll={true}
        isGeneratingAllOverviews={true}
        isImporting={true}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={vi.fn()}
        onSummarizeAll={vi.fn()}
        onGenerateAllOverviews={vi.fn()}
        onImportHTML={vi.fn()}
        onShowApiSettings={vi.fn()}
        onExportCSV={vi.fn()}
        fileInputRef={{ current: null } as any}
      />,
    );
    expect(getAllByText("Generating...").length).toBe(2);
  });

  it("enables actions when there are unprocessed bookmarks", async () => {
    const bookmarks = [
      {
        id: "b1",
        embedding: [] as number[],
        summary: "" as string,
        content: "" as string,
      },
    ] as any[];
    const onGenerate = vi.fn();
    const onSummarize = vi.fn();
    const onOverviews = vi.fn();
    const { getByText } = render(
      <BookmarkToolbar
        bookmarks={bookmarks}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={false}
        isSummarizingAll={false}
        isGeneratingAllOverviews={false}
        isImporting={false}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={onGenerate}
        onSummarizeAll={onSummarize}
        onGenerateAllOverviews={onOverviews}
        onImportHTML={vi.fn()}
        onShowApiSettings={vi.fn()}
        onExportCSV={vi.fn()}
        fileInputRef={{ current: null } as any}
      />,
    );
    await userEvent.click(getByText("Embeddings"));
    expect(onGenerate).toHaveBeenCalled();
    await userEvent.click(getByText("Summarize All"));
    expect(onSummarize).toHaveBeenCalled();
    await userEvent.click(getByText("Overviews"));
    expect(onOverviews).toHaveBeenCalled();
  });

  it("disables actions when all bookmarks are processed", () => {
    const bookmarks = [
      {
        id: "b1",
        embedding: [0.1] as number[],
        summary: "done" as string,
        content: "done" as string,
      },
    ] as any[];
    const onGenerate = vi.fn();
    const { getByText } = render(
      <BookmarkToolbar
        bookmarks={bookmarks}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={false}
        isSummarizingAll={false}
        isGeneratingAllOverviews={false}
        isImporting={false}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={onGenerate}
        onSummarizeAll={vi.fn()}
        onGenerateAllOverviews={vi.fn()}
        onImportHTML={vi.fn()}
        onShowApiSettings={vi.fn()}
        onExportCSV={vi.fn()}
        fileInputRef={{ current: null } as any}
      />,
    );
    const embedBtn = getByText("Embeddings").closest("button")!;
    expect(embedBtn.disabled).toBe(true);
  });

  it("llama onExportCSV y onShowApiSettings", async () => {
    const onExport = vi.fn();
    const onSettings = vi.fn();
    const { getByText } = render(
      <BookmarkToolbar
        bookmarks={[]}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={false}
        isSummarizingAll={false}
        isGeneratingAllOverviews={false}
        isImporting={false}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={vi.fn()}
        onSummarizeAll={vi.fn()}
        onGenerateAllOverviews={vi.fn()}
        onImportHTML={vi.fn()}
        onShowApiSettings={onSettings}
        onExportCSV={onExport}
        fileInputRef={{ current: null } as any}
      />,
    );
    await userEvent.click(getByText("Export CSV"));
    expect(onExport).toHaveBeenCalled();
    await userEvent.click(getByText("AI Settings"));
    expect(onSettings).toHaveBeenCalled();
  });

  it("fires onImportHTML with the selected file", () => {
    const onImport = vi.fn();
    const { container } = render(
      <BookmarkToolbar
        bookmarks={[]}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={false}
        isSummarizingAll={false}
        isGeneratingAllOverviews={false}
        isImporting={false}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={vi.fn()}
        onSummarizeAll={vi.fn()}
        onGenerateAllOverviews={vi.fn()}
        onImportHTML={onImport}
        onShowApiSettings={vi.fn()}
        onExportCSV={vi.fn()}
        fileInputRef={{ current: null } as any}
      />,
    );
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["<html></html>"], "bookmarks.html", {
      type: "text/html",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(onImport).toHaveBeenCalledWith(file);
  });

  it("opens the file picker when clicking Import HTML", async () => {
    const ref = React.createRef<HTMLInputElement>();
    const { getByRole, container } = render(
      <BookmarkToolbar
        bookmarks={[]}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={false}
        isSummarizingAll={false}
        isGeneratingAllOverviews={false}
        isImporting={false}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={vi.fn()}
        onSummarizeAll={vi.fn()}
        onGenerateAllOverviews={vi.fn()}
        onImportHTML={vi.fn()}
        onShowApiSettings={vi.fn()}
        onExportCSV={vi.fn()}
        fileInputRef={ref}
      />,
    );
    // The component uses fileInputRef as the ref attribute of the real input:
    // React overwrites `current` with the DOM element. The click on the button
    // must invoke the native .click() method of THAT input (opens the picker).
    const fileInput = ref.current ??
      container.querySelector('input[type="file"]')!;
    const clickSpy = vi.spyOn(fileInput, "click");
    await userEvent.click(getByRole("button", { name: "Import HTML" }));
    expect(clickSpy).toHaveBeenCalled();
  });

  // ── Keyboard interactions on buttons with onKeyDown ──

  it("triggers onGenerateAllOverviews with Enter on the Overviews button", () => {
    const onOverviews = vi.fn();
    const { getByText } = render(
      <BookmarkToolbar
        bookmarks={[{ id: "b1", embedding: [], summary: "", content: "" } as any]}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={false}
        isSummarizingAll={false}
        isGeneratingAllOverviews={false}
        isImporting={false}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={vi.fn()}
        onSummarizeAll={vi.fn()}
        onGenerateAllOverviews={onOverviews}
        onImportHTML={vi.fn()}
        onShowApiSettings={vi.fn()}
        onExportCSV={vi.fn()}
        fileInputRef={{ current: null } as any}
      />,
    );
    const btn = getByText("Overviews").closest("button")!;
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(onOverviews).toHaveBeenCalled();
  });

  it("triggers onGenerateAllOverviews with Space on the Overviews button", () => {
    const onOverviews = vi.fn();
    const { getByText } = render(
      <BookmarkToolbar
        bookmarks={[{ id: "b1", embedding: [], summary: "", content: "" } as any]}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={false}
        isSummarizingAll={false}
        isGeneratingAllOverviews={false}
        isImporting={false}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={vi.fn()}
        onSummarizeAll={vi.fn()}
        onGenerateAllOverviews={onOverviews}
        onImportHTML={vi.fn()}
        onShowApiSettings={vi.fn()}
        onExportCSV={vi.fn()}
        fileInputRef={{ current: null } as any}
      />,
    );
    const btn = getByText("Overviews").closest("button")!;
    fireEvent.keyDown(btn, { key: " " });
    expect(onOverviews).toHaveBeenCalled();
  });

  it("triggers onExportCSV with Enter on the Export CSV button", () => {
    const onExport = vi.fn();
    const { getByText } = render(
      <BookmarkToolbar
        bookmarks={[]}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={false}
        isSummarizingAll={false}
        isGeneratingAllOverviews={false}
        isImporting={false}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={vi.fn()}
        onSummarizeAll={vi.fn()}
        onGenerateAllOverviews={vi.fn()}
        onImportHTML={vi.fn()}
        onShowApiSettings={vi.fn()}
        onExportCSV={onExport}
        fileInputRef={{ current: null } as any}
      />,
    );
    const btn = getByText("Export CSV").closest("button")!;
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(onExport).toHaveBeenCalled();
  });

  it("triggers onShowApiSettings with Space on the AI Settings button", () => {
    const onSettings = vi.fn();
    const { getByText } = render(
      <BookmarkToolbar
        bookmarks={[]}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={false}
        isSummarizingAll={false}
        isGeneratingAllOverviews={false}
        isImporting={false}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={vi.fn()}
        onSummarizeAll={vi.fn()}
        onGenerateAllOverviews={vi.fn()}
        onImportHTML={vi.fn()}
        onShowApiSettings={onSettings}
        onExportCSV={vi.fn()}
        fileInputRef={{ current: null } as any}
      />,
    );
    const btn = getByText("AI Settings").closest("button")!;
    fireEvent.keyDown(btn, { key: " " });
    expect(onSettings).toHaveBeenCalled();
  });

  it("disables GenerateEmbeddings when there are no bookmarks without embeddings", () => {
    const bookmarks = [{ id: "b1", embedding: [1, 2, 3], summary: "", content: "" } as any];
    const { getByText } = render(
      <BookmarkToolbar
        bookmarks={bookmarks}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={false}
        isSummarizingAll={false}
        isGeneratingAllOverviews={false}
        isImporting={false}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={vi.fn()}
        onSummarizeAll={vi.fn()}
        onGenerateAllOverviews={vi.fn()}
        onImportHTML={vi.fn()}
        onShowApiSettings={vi.fn()}
        onExportCSV={vi.fn()}
        fileInputRef={{ current: null } as any}
      />,
    );
    expect(getByText("Embeddings").closest("button")!.disabled).toBe(true);
  });

  it("enables GenerateEmbeddings when some bookmarks have no embeddings", () => {
    const bookmarks = [
      { id: "b1", embedding: [1, 2, 3], summary: "", content: "" },
      { id: "b2", embedding: [], summary: "", content: "" },
    ] as any[];
    const { getByText } = render(
      <BookmarkToolbar
        bookmarks={bookmarks}
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        isGeneratingEmbeddings={false}
        isSummarizingAll={false}
        isGeneratingAllOverviews={false}
        isImporting={false}
        isBulkTagging={false}
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        onSelectAll={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        onGenerateEmbeddings={vi.fn()}
        onSummarizeAll={vi.fn()}
        onGenerateAllOverviews={vi.fn()}
        onImportHTML={vi.fn()}
        onShowApiSettings={vi.fn()}
        onExportCSV={vi.fn()}
        fileInputRef={{ current: null } as any}
      />,
    );
    expect(getByText("Embeddings").closest("button")!.disabled).toBe(false);
  });
});

describe("SearchBar", () => {
  it("renders search input", () => {
    const { getByLabelText } = render(
      <SearchBar
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
      />,
    );
    expect(getByLabelText("Search bookmarks...")).toBeTruthy();
  });

  it("toggle semantic search exposes its pressed state", async () => {
    const setIsSemantic = vi.fn();
    const { getByText } = render(
      <SearchBar
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={setIsSemantic}
        isSearching={false}
      />,
    );
    const button = getByText("AI Search").closest("button")!;
    expect(button).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button);
    expect(setIsSemantic).toHaveBeenCalledWith(true);
  });

  it("shows semantic placeholder when isSemanticSearch", () => {
    const { getByLabelText } = render(
      <SearchBar
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={true}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
      />,
    );
    expect(getByLabelText("Search by meaning...")).toBeTruthy();
  });

  it("clears query with X button", async () => {
    const setQuery = vi.fn();
    const { container } = render(
      <SearchBar
        searchQuery="test"
        setSearchQuery={setQuery}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
      />,
    );
    const buttons = container.querySelectorAll("button");
    const clearBtn = Array.from(buttons).find(
      (b) => !b.textContent?.includes("AI Search"),
    );
    if (clearBtn) await userEvent.click(clearBtn);
    expect(setQuery).toHaveBeenCalledWith("");
  });

  it("shows spinner when isSearching", () => {
    const { container } = render(
      <SearchBar
        searchQuery=""
        setSearchQuery={vi.fn()}
        isSemanticSearch={false}
        setIsSemanticSearch={vi.fn()}
        isSearching={true}
      />,
    );
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows the fallback status after a semantic search error", () => {
    const { getByTestId, queryByText } = render(
      <SearchBar
        searchQuery="network"
        setSearchQuery={vi.fn()}
        isSemanticSearch={true}
        setIsSemanticSearch={vi.fn()}
        isSearching={false}
        semanticSearchError={true}
      />,
    );
    expect(getByTestId("semantic-search-fallback")).toBeTruthy();
    expect(queryByText("Semantic search active")).toBeNull();
  });
});

describe("BulkActionsBar", () => {
  it("returns null when there is no selection", () => {
    const { container } = render(
      <BulkActionsBar
        selectedIds={new Set()}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        isBulkTagging={false}
        isGeneratingAllOverviews={false}
        isSummarizingCollection={false}
      />,
    );
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("renders when there is a selection", () => {
    const { getByText } = render(
      <BulkActionsBar
        selectedIds={new Set(["bm-1"])}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        isBulkTagging={false}
        isGeneratingAllOverviews={false}
        isSummarizingCollection={false}
      />,
    );
    expect(getByText((_, el) => el?.textContent === "1 selected")).toBeTruthy();
  });

  it("llama onBulkDelete", async () => {
    const onDelete = vi.fn();
    const { getByText } = render(
      <BulkActionsBar
        selectedIds={new Set(["bm-1"])}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={onDelete}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        isBulkTagging={false}
        isGeneratingAllOverviews={false}
        isSummarizingCollection={false}
      />,
    );
    await userEvent.click(getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
  });

  it("disables add/remove tag without input", () => {
    const { getByText } = render(
      <BulkActionsBar
        selectedIds={new Set(["bm-1"])}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        isBulkTagging={false}
        isGeneratingAllOverviews={false}
        isSummarizingCollection={false}
      />,
    );
    expect(getByText("Add")).toBeTruthy();
  });

  it("calls onBulkAddTag and onBulkRemoveTag with the input tag", async () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const { getByText } = render(
      <BulkActionsBar
        selectedIds={new Set(["bm-1"])}
        bulkTagInput="work"
        setBulkTagInput={vi.fn()}
        onBulkAddTag={onAdd}
        onBulkRemoveTag={onRemove}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        isBulkTagging={false}
        isGeneratingAllOverviews={false}
        isSummarizingCollection={false}
      />,
    );
    // The input is controlled by the parent (bulkTagInput prop):
    // with a non-empty value the Add/Remove buttons stay enabled
    await userEvent.click(getByText("Add"));
    expect(onAdd).toHaveBeenCalled();
    await userEvent.click(getByText("Remove"));
    expect(onRemove).toHaveBeenCalled();
  });

  it("llama los handlers restantes de acciones masivas", async () => {
    const onClear = vi.fn();
    const onExport = vi.fn();
    const onOverviews = vi.fn();
    const onSummarize = vi.fn();
    const onAutoTag = vi.fn();
    const { getByText } = render(
      <BulkActionsBar
        selectedIds={new Set(["bm-1"])}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={onClear}
        onBulkDelete={vi.fn()}
        onBulkExport={onExport}
        onBulkSummarize={onSummarize}
        onBulkAutoTag={onAutoTag}
        onBulkGenerateOverviews={onOverviews}
        isBulkTagging={false}
        isGeneratingAllOverviews={false}
        isSummarizingCollection={false}
      />,
    );
    await userEvent.click(getByText("Clear"));
    expect(onClear).toHaveBeenCalled();
    await userEvent.click(getByText("Export"));
    expect(onExport).toHaveBeenCalled();
    await userEvent.click(getByText("Generate"));
    expect(onOverviews).toHaveBeenCalled();
    await userEvent.click(getByText("Summarize"));
    expect(onSummarize).toHaveBeenCalled();
    await userEvent.click(getByText("Auto Tag"));
    expect(onAutoTag).toHaveBeenCalled();
  });

  it("disables bulk actions during processing", () => {
    const { getByText } = render(
      <BulkActionsBar
        selectedIds={new Set(["bm-1"])}
        bulkTagInput=""
        setBulkTagInput={vi.fn()}
        onBulkAddTag={vi.fn()}
        onBulkRemoveTag={vi.fn()}
        onBulkClearTags={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkExport={vi.fn()}
        onBulkSummarize={vi.fn()}
        onBulkAutoTag={vi.fn()}
        onBulkGenerateOverviews={vi.fn()}
        isBulkTagging={true}
        isGeneratingAllOverviews={true}
        isSummarizingCollection={true}
      />,
    );
    // Con flags de procesamiento activos, los labels cambian a
    // "Generating..." / "Synthesizing..." (isGeneratingAllOverviews /
    // isSummarizingCollection) and the button stays disabled
    const autoTagBtn = getByText("Auto Tag").closest("button")!;
    const overviewsBtn = getByText("Generating...").closest("button")!;
    const summarizeBtn = getByText("Synthesizing...").closest("button")!;
    expect(autoTagBtn.disabled).toBe(true);
    expect(overviewsBtn.disabled).toBe(true);
    expect(summarizeBtn.disabled).toBe(true);
  });
});
