import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "../../../components/bookmarks/EmptyState";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

describe("EmptyState", () => {
  it("shows the no-bookmarks message when there is no query", () => {
    const { getByText } = render(
      <EmptyState searchQuery="" selectedTags={[]} onClearFilters={vi.fn()} />,
    );
    expect(getByText("app_noBookmarksYet")).toBeTruthy();
  });

  it("shows add-first-bookmark hint when there is no query", () => {
    const { getByText } = render(
      <EmptyState searchQuery="" selectedTags={[]} onClearFilters={vi.fn()} />,
    );
    expect(getByText("app_addFirstBookmarkHint")).toBeTruthy();
  });

  it("shows no results when there is a query", () => {
    const { getByText, queryByText } = render(
      <EmptyState
        searchQuery="react"
        selectedTags={[]}
        onClearFilters={vi.fn()}
      />,
    );
    expect(getByText("app_noResultsFound")).toBeTruthy();
    expect(queryByText("app_addFirstBookmarkHint")).toBeNull();
  });

  it("shows clear filters button when there is a query and tags", async () => {
    const onClear = vi.fn();
    const { getByText } = render(
      <EmptyState
        searchQuery="react"
        selectedTags={["dev"]}
        onClearFilters={onClear}
      />,
    );
    const btn = getByText("app_clearFilters");
    expect(btn).toBeTruthy();
    await userEvent.click(btn);
    expect(onClear).toHaveBeenCalled();
  });

  it("does not show clear filters button when there is a query but no tags", () => {
    const { queryByText } = render(
      <EmptyState
        searchQuery="react"
        selectedTags={[]}
        onClearFilters={vi.fn()}
      />,
    );
    expect(queryByText("app_clearFilters")).toBeNull();
  });
});
