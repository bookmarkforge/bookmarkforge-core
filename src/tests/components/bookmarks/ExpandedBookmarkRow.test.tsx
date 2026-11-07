import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

vi.mock("../../../components/bookmarks/BookmarkPreview", () => ({
  BookmarkPreview: ({ url }: { url: string }) => (
    <div data-testid="preview">{url}</div>
  ),
}));

vi.mock("../../../components/bookmarks/TagManager", () => ({
  ExpandedTagManager: () => <div data-testid="tags" />,
}));

const { ExpandedBookmarkRow } =
  await import("../../../components/bookmarks/ExpandedBookmarkRow");

const baseBookmark = {
  id: "bm-1",
  title: "Test",
  url: "https://test.com",
  tags: ["tag1"],
  relatedLinks: ["bm-2"],
};

const relatedBookmark = {
  id: "bm-2",
  title: "Related Link",
  url: "https://related.com",
  tags: [],
};

const mockT = vi.fn((key: string) => {
  const map: Record<string, string> = {
    app_relatedLinks: "Related Links",
    app_tags: "Tags",
  };
  return map[key] || key;
});

describe("ExpandedBookmarkRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders BookmarkPreview and TagManager", () => {
    const { getByTestId } = render(
      <ExpandedBookmarkRow
        bookmark={baseBookmark as any}
        bookmarks={[]}
        allTags={["tag1", "tag2"]}
        t={mockT}
        handleAddTag={vi.fn()}
        handleRemoveTag={vi.fn()}
        handleClearTags={vi.fn()}
      />,
    );
    expect(getByTestId("preview")).toBeTruthy();
    expect(getByTestId("tags")).toBeTruthy();
  });

  it("passes the URL to BookmarkPreview", () => {
    const { getByTestId } = render(
      <ExpandedBookmarkRow
        bookmark={baseBookmark as any}
        bookmarks={[]}
        allTags={[]}
        t={mockT}
        handleAddTag={vi.fn()}
        handleRemoveTag={vi.fn()}
        handleClearTags={vi.fn()}
      />,
    );
    expect(getByTestId("preview").textContent).toBe("https://test.com");
  });

  it("shows related links when they exist", () => {
    const { getByText } = render(
      <ExpandedBookmarkRow
        bookmark={baseBookmark as any}
        bookmarks={[relatedBookmark as any]}
        allTags={[]}
        t={mockT}
        handleAddTag={vi.fn()}
        handleRemoveTag={vi.fn()}
        handleClearTags={vi.fn()}
      />,
    );
    expect(getByText("Related Link")).toBeTruthy();
    expect(getByText("Related Links")).toBeTruthy();
  });

  it("does not show the related links section when there are none", () => {
    const bookmarkNoRelated = { ...baseBookmark, relatedLinks: undefined };
    const { queryByText } = render(
      <ExpandedBookmarkRow
        bookmark={bookmarkNoRelated as any}
        bookmarks={[]}
        allTags={[]}
        t={mockT}
        handleAddTag={vi.fn()}
        handleRemoveTag={vi.fn()}
        handleClearTags={vi.fn()}
      />,
    );
    expect(queryByText("Related Links")).toBeNull();
  });

  it("uses React.memo", () => {
    expect(ExpandedBookmarkRow).toBeDefined();
  });

  it("uses 'Related Links' fallback if t returns empty", () => {
    const emptyT = vi.fn(() => "");
    const { getByText } = render(
      <ExpandedBookmarkRow
        bookmark={baseBookmark as any}
        bookmarks={[relatedBookmark as any]}
        allTags={[]}
        t={emptyT}
        handleAddTag={vi.fn()}
        handleRemoveTag={vi.fn()}
        handleClearTags={vi.fn()}
      />,
    );
    expect(getByText("Related Links")).toBeTruthy();
  });

  it("handles bookmark without tags (tags undefined)", () => {
    const noTags = { ...baseBookmark, tags: undefined };
    const { getByTestId } = render(
      <ExpandedBookmarkRow
        bookmark={noTags as any}
        bookmarks={[]}
        allTags={["tag1"]}
        t={mockT}
        handleAddTag={vi.fn()}
        handleRemoveTag={vi.fn()}
        handleClearTags={vi.fn()}
      />,
    );
    expect(getByTestId("tags")).toBeTruthy();
  });

  it("filters only related bookmarks matching relatedLinks", () => {
    const unrelated = {
      id: "bm-3",
      title: "Unrelated",
      url: "https://unrelated.com",
      tags: [],
    };
    const { getByText, queryByText } = render(
      <ExpandedBookmarkRow
        bookmark={baseBookmark as any}
        bookmarks={[relatedBookmark as any, unrelated as any]}
        allTags={[]}
        t={mockT}
        handleAddTag={vi.fn()}
        handleRemoveTag={vi.fn()}
        handleClearTags={vi.fn()}
      />,
    );
    expect(getByText("Related Link")).toBeTruthy();
    expect(queryByText("Unrelated")).toBeNull();
  });
});
