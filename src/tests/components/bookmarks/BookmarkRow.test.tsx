import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("../../../components/bookmarks/EditableTitle", () => ({
  EditableTitle: ({ bookmark }: any) => (
    <span data-testid="title">{bookmark.title}</span>
  ),
}));
vi.mock("../../../components/bookmarks/TagManager", () => ({
  TagManager: () => <div data-testid="tags" />,
}));

const { BookmarkRow } =
  await import("../../../components/bookmarks/BookmarkRow");

const baseBookmark = {
  id: "bm-1",
  title: "Test Bookmark",
  url: "https://test.com",
  tags: ["tag1"],
  summary: "",
  content: "",
  createdAt: "2025-01-01T00:00:00Z",
};

const mockT = vi.fn((key: string) => {
  const map: Record<string, string> = {
    app_select: "Select",
    app_deselect: "Deselect",
    app_expand: "Expand",
    app_collapse: "Collapse",
    app_autoSummarize: "Summarize",
    app_generating: "Generating...",
    app_read: "Read",
    app_visit: "Visit",
    app_summarize: "Summarize",
    app_generateOverview: "Generate",
    app_listen: "Listen",
    app_share: "Share",
    app_shareNative: "Share",
    app_delete: "Delete",
    app_noContent: "No content",
  };
  return map[key] || key;
});

const defaultProps = {
  bookmark: baseBookmark as any,
  isSelected: false,
  isExpanded: false,
  isFocused: false,
  isAutoTagging: null,
  isSummarizing: null,
  isGeneratingContent: null,
  isSpeaking: false,
  allTags: ["tag1"],
  t: mockT,
  aiManager: {} as any,
  handleSelect: vi.fn(),
  handleToggleExpand: vi.fn(),
  handleUpdateTitle: vi.fn(),
  handleSummarize: vi.fn(),
  handleAddTag: vi.fn(),
  handleRemoveTag: vi.fn(),
  handleViewContent: vi.fn(),
  handleGenerateDetailedContent: vi.fn(),
  handleAudioSummary: vi.fn(),
  setSharingBookmark: vi.fn(),
  handleDelete: vi.fn(),
  setViewingContent: vi.fn(),
};

describe("BookmarkRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with basic props", () => {
    const { getByText, getByTestId } = render(
      <BookmarkRow {...defaultProps} />,
    );
    expect(getByText("Test Bookmark")).toBeTruthy();
    expect(getByTestId("title")).toBeTruthy();
    expect(getByTestId("tags")).toBeTruthy();
  });

  it("shows selected checkbox when isSelected", () => {
    const { container } = render(
      <BookmarkRow {...defaultProps} isSelected={true} />,
    );
    expect(container.querySelector('[aria-label="Deselect"]')).toBeTruthy();
  });

  it("shows unselected checkbox", () => {
    const { container } = render(
      <BookmarkRow {...defaultProps} isSelected={false} />,
    );
    expect(container.querySelector('[aria-label="Select"]')).toBeTruthy();
  });

  it("shows ChevronDown when isExpanded", () => {
    const { container } = render(
      <BookmarkRow {...defaultProps} isExpanded={true} />,
    );
    expect(container.querySelector('[aria-label="Collapse"]')).toBeTruthy();
  });

  it("shows ChevronRight when not isExpanded", () => {
    const { container } = render(
      <BookmarkRow {...defaultProps} isExpanded={false} />,
    );
    expect(container.querySelector('[aria-label="Expand"]')).toBeTruthy();
  });

  it("calls handleSelect when clicked", async () => {
    const handleSelect = vi.fn();
    const { container } = render(
      <BookmarkRow {...defaultProps} handleSelect={handleSelect} />,
    );
    const row = container.querySelector('[role="button"]')!;
    await userEvent.click(row);
    expect(handleSelect).toHaveBeenCalledWith("bm-1");
  });

  it("calls handleSelect exactly once when clicking the Select checkbox", async () => {
    // Regression: the row wrapper is a selectable role=button with its own
    // onClick, so without stopPropagation the checkbox click bubbled up and
    // toggled the selection twice (on, then immediately off) — making the
    // checkbox a no-op in the real app.
    const handleSelect = vi.fn();
    const { container } = render(
      <BookmarkRow {...defaultProps} handleSelect={handleSelect} />,
    );
    const checkbox = container.querySelector('[aria-label="Select"]')!;
    await userEvent.click(checkbox);
    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith("bm-1");
  });

  it("llama handleSelect con Enter", async () => {
    const handleSelect = vi.fn();
    const { container } = render(
      <BookmarkRow {...defaultProps} handleSelect={handleSelect} />,
    );
    const row = container.querySelector('[role="button"]')!;
    (row as any).focus();
    await userEvent.keyboard("{Enter}");
    expect(handleSelect).toHaveBeenCalledWith("bm-1");
  });

  it("llama handleSelect con Space", async () => {
    const handleSelect = vi.fn();
    const { container } = render(
      <BookmarkRow {...defaultProps} handleSelect={handleSelect} />,
    );
    const row = container.querySelector('[role="button"]')!;
    (row as any).focus();
    await userEvent.keyboard(" ");
    expect(handleSelect).toHaveBeenCalledWith("bm-1");
  });

  it("calls handleToggleExpand when clicking expand", async () => {
    const handleToggle = vi.fn();
    const { container } = render(
      <BookmarkRow {...defaultProps} handleToggleExpand={handleToggle} />,
    );
    await userEvent.click(container.querySelector('[aria-label="Expand"]')!);
    expect(handleToggle).toHaveBeenCalledWith("bm-1");
  });

  it("shows auto-tagging spinner", () => {
    const { container } = render(
      <BookmarkRow {...defaultProps} isAutoTagging="bm-1" />,
    );
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("calls handleSummarize when clicking Summarize", async () => {
    const handleSummarize = vi.fn();
    const { getAllByText } = render(
      <BookmarkRow {...defaultProps} handleSummarize={handleSummarize} />,
    );
    await userEvent.click(getAllByText("Summarize")[0]!);
    expect(handleSummarize).toHaveBeenCalled();
  });

  it("calls handleDelete when clicking Delete", async () => {
    const handleDelete = vi.fn();
    const { getByLabelText } = render(
      <BookmarkRow {...defaultProps} handleDelete={handleDelete} />,
    );
    await userEvent.click(getByLabelText("Delete"));
    expect(handleDelete).toHaveBeenCalledWith("bm-1");
  });

  it("llama handleViewContent", async () => {
    const handleView = vi.fn();
    const { getByText } = render(
      <BookmarkRow {...defaultProps} handleViewContent={handleView} />,
    );
    await userEvent.click(getByText("Read"));
    expect(handleView).toHaveBeenCalledWith(baseBookmark);
  });

  it("llama setSharingBookmark con navigator.share no disponible", async () => {
    const setSharing = vi.fn();
    const { getByText } = render(
      <BookmarkRow {...defaultProps} setSharingBookmark={setSharing} />,
    );
    await userEvent.click(getByText("Share"));
    expect(setSharing).toHaveBeenCalledWith(baseBookmark);
  });

  it("uses navigator.share when available", async () => {
    const mockShare = vi.fn().mockResolvedValue(undefined);
    const origShare = navigator.share;
    (navigator as any).share = mockShare;
    const setSharing = vi.fn();
    const { getByText } = render(
      <BookmarkRow {...defaultProps} setSharingBookmark={setSharing} />,
    );
    await userEvent.click(getByText("Share"));
    expect(mockShare).toHaveBeenCalledWith({
      title: "Test Bookmark",
      text: "Test Bookmark",
      url: "https://test.com",
    });
    (navigator as any).share = origShare;
  });

  it("expanded shows content", () => {
    const { getByText } = render(
      <BookmarkRow {...defaultProps} isExpanded={true} />,
    );
    expect(getByText("No content")).toBeTruthy();
  });

  // ── navigator.share error handling ──

  it("navigator.share AbortError no llama setSharingBookmark", async () => {
    const mockShare = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    const origShare = navigator.share;
    (navigator as any).share = mockShare;
    const setSharing = vi.fn();
    const { getByText } = render(
      <BookmarkRow {...defaultProps} setSharingBookmark={setSharing} />,
    );
    await userEvent.click(getByText("Share"));
    expect(setSharing).not.toHaveBeenCalled();
    (navigator as any).share = origShare;
  });

  it("navigator.share another error calls setSharingBookmark", async () => {
    const mockShare = vi
      .fn()
      .mockRejectedValue(new Error("network error"));
    const origShare = navigator.share;
    (navigator as any).share = mockShare;
    const setSharing = vi.fn();
    const { getByText } = render(
      <BookmarkRow {...defaultProps} setSharingBookmark={setSharing} />,
    );
    await userEvent.click(getByText("Share"));
    expect(setSharing).toHaveBeenCalledWith(baseBookmark);
    (navigator as any).share = origShare;
  });

  // ── bookmark.summary presente ──

  it("shows summary if the bookmark has a summary", () => {
    const { getByText } = render(
      <BookmarkRow
        {...defaultProps}
        bookmark={{ ...baseBookmark, summary: "A great summary" } as any}
      />,
    );
    expect(getByText("A great summary")).toBeTruthy();
  });

  // ── bookmark.broken badge ──

  it("shows 404 badge if bookmark.broken === true", () => {
    const { getByText } = render(
      <BookmarkRow
        {...defaultProps}
        bookmark={{ ...baseBookmark, broken: true } as any}
      />,
    );
    expect(getByText("404")).toBeTruthy();
  });

  // ── Processing states ──

  it("shows Generating... and disables Summarize when isSummarizing matches", () => {
    const { queryByText } = render(
      <BookmarkRow {...defaultProps} isSummarizing="bm-1" />,
    );
    // The Summarize button shows "Generating..." instead of "Summarize"
    expect(queryByText("Generating...")).toBeTruthy();
  });

  it("shows Generating... and disables Generate when isGeneratingContent matches", () => {
    const { queryByText } = render(
      <BookmarkRow {...defaultProps} isGeneratingContent="bm-1" />,
    );
    expect(queryByText("Generating...")).toBeTruthy();
  });

  it("shows spinner on Audio when isSpeaking", () => {
    const { container } = render(
      <BookmarkRow {...defaultProps} isSpeaking={true} />,
    );
    // The Listen button shows Loader2 (animate-spin) instead of Volume2
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  // ── Keyboard: non-Enter/Space key ──

  it("no llama handleSelect con tecla Tab", async () => {
    const handleSelect = vi.fn();
    const { container } = render(
      <BookmarkRow {...defaultProps} handleSelect={handleSelect} />,
    );
    const row = container.querySelector('[role="button"]')!;
    (row as any).focus();
    await userEvent.keyboard("{Tab}");
    expect(handleSelect).not.toHaveBeenCalled();
  });

  // ── Expanded con content + flashcards ──

  it("expanded shows content and flashcards button when there is content", () => {
    const { getByText } = render(
      <BookmarkRow
        {...defaultProps}
        isExpanded={true}
        bookmark={{ ...baseBookmark, content: "Full article content here" } as any}
      />,
    );
    expect(getByText("Full article content here")).toBeTruthy();
  });

  it("expanded calls onGenerateFlashcards when clicked", async () => {
    const onFlashcards = vi.fn();
    const { getByText } = render(
      <BookmarkRow
        {...defaultProps}
        isExpanded={true}
        bookmark={{ ...baseBookmark, content: "content" } as any}
        isGeneratingFlashcards={false}
        onGenerateFlashcards={onFlashcards}
      />,
    );
    await userEvent.click(getByText("app_generateFlashcards"));
    expect(onFlashcards).toHaveBeenCalled();
  });

  it("expanded disables flashcards button when isGeneratingFlashcards", () => {
    const onFlashcards = vi.fn();
    const { getByText } = render(
      <BookmarkRow
        {...defaultProps}
        isExpanded={true}
        bookmark={{ ...baseBookmark, content: "content" } as any}
        isGeneratingFlashcards={true}
        onGenerateFlashcards={onFlashcards}
      />,
    );
    const btn = getByText("app_generateFlashcards").closest("button")!;
    expect(btn.disabled).toBe(true);
  });
});
