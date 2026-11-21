import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagFilterBar } from "../../../components/bookmarks/TagFilterBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

describe("TagFilterBar", () => {
  it("renders null when there are no tags", () => {
    const { container } = render(
      <TagFilterBar
        allTags={[]}
        selectedTags={[]}
        onToggleTag={vi.fn()}
        onClearTags={vi.fn()}
      />,
    );
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("renders all tags", () => {
    const { getByText } = render(
      <TagFilterBar
        allTags={["dev", "design", "react"]}
        selectedTags={[]}
        onToggleTag={vi.fn()}
        onClearTags={vi.fn()}
      />,
    );
    expect(getByText("dev")).toBeTruthy();
    expect(getByText("design")).toBeTruthy();
    expect(getByText("react")).toBeTruthy();
  });

  it("marks tag as active when selected", () => {
    const { getByText } = render(
      <TagFilterBar
        allTags={["dev", "design"]}
        selectedTags={["dev"]}
        onToggleTag={vi.fn()}
        onClearTags={vi.fn()}
      />,
    );
    const devBtn = getByText("dev");
    expect(devBtn.className).toContain("ds-bg-accent");
  });

  it("calls onToggleTag when clicking a tag", async () => {
    const onToggle = vi.fn();
    const { getByText } = render(
      <TagFilterBar
        allTags={["dev"]}
        selectedTags={[]}
        onToggleTag={onToggle}
        onClearTags={vi.fn()}
      />,
    );
    await userEvent.click(getByText("dev"));
    expect(onToggle).toHaveBeenCalledWith("dev");
  });

  it("shows clear button when there are selected tags", async () => {
    const onClear = vi.fn();
    const { getByText } = render(
      <TagFilterBar
        allTags={["dev"]}
        selectedTags={["dev"]}
        onToggleTag={vi.fn()}
        onClearTags={onClear}
      />,
    );
    const clearBtn = getByText("app_clear");
    expect(clearBtn).toBeTruthy();
    await userEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalled();
  });

  it("does not show clear button when there are no selected tags", () => {
    const { queryByText } = render(
      <TagFilterBar
        allTags={["dev"]}
        selectedTags={[]}
        onToggleTag={vi.fn()}
        onClearTags={vi.fn()}
      />,
    );
    expect(queryByText("app_clear")).toBeNull();
  });
});
