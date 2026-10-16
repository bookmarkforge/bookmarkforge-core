import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => opts?.defaultValue || key,
  }),
}));

const mockSanitize = vi.hoisted(() =>
  vi.fn((input: string, _max: number) => input),
);

vi.mock("../../services/SanitizationService", () => ({
  sanitizeUserInput: mockSanitize,
}));

describe("EditableTitle", () => {
  let EditableTitle: any;

  const baseBookmark = { id: "1", title: "Original Title" };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../components/bookmarks/EditableTitle");
    EditableTitle = mod.EditableTitle;
  });

  it("shows the title in display mode", () => {
    render(
      <EditableTitle bookmark={baseBookmark} onSave={vi.fn()} />,
    );
    expect(screen.getByText("Original Title")).toBeTruthy();
  });

  it("enters edit mode on click", async () => {
    render(
      <EditableTitle bookmark={baseBookmark} onSave={vi.fn()} />,
    );
    await userEvent.click(screen.getByText("Original Title"));
    const input = screen.getByLabelText("app_editTitle") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("Original Title");
  });

  it("saves when pressing Enter", async () => {
    const onSave = vi.fn();
    render(
      <EditableTitle bookmark={baseBookmark} onSave={onSave} />,
    );
    await userEvent.click(screen.getByText("Original Title"));
    const input = screen.getByLabelText("app_editTitle");
    await userEvent.clear(input);
    await userEvent.type(input, "New Title");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("1", "New Title");
  });

  it("cancels editing when pressing Escape", async () => {
    const onSave = vi.fn();
    render(
      <EditableTitle bookmark={baseBookmark} onSave={onSave} />,
    );
    await userEvent.click(screen.getByText("Original Title"));
    const input = screen.getByLabelText("app_editTitle");
    await userEvent.clear(input);
    await userEvent.type(input, "Changed");
    fireEvent.keyDown(input, { key: "Escape" });
    // Should revert to original title and exit edit mode
    expect(screen.getByText("Original Title")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves on blur", async () => {
    const onSave = vi.fn();
    render(
      <EditableTitle bookmark={baseBookmark} onSave={onSave} />,
    );
    await userEvent.click(screen.getByText("Original Title"));
    const input = screen.getByLabelText("app_editTitle");
    await userEvent.clear(input);
    await userEvent.type(input, "Blurred Title");
    await userEvent.tab(); // blur
    expect(onSave).toHaveBeenCalledWith("1", "Blurred Title");
  });

  it("reverts to the original title if the input becomes empty", async () => {
    const onSave = vi.fn();
    render(
      <EditableTitle bookmark={baseBookmark} onSave={onSave} />,
    );
    await userEvent.click(screen.getByText("Original Title"));
    const input = screen.getByLabelText("app_editTitle");
    await userEvent.clear(input);
    await userEvent.tab(); // blur with empty value
    expect(screen.getByText("Original Title")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not save if the title did not change", async () => {
    const onSave = vi.fn();
    render(
      <EditableTitle bookmark={baseBookmark} onSave={onSave} />,
    );
    await userEvent.click(screen.getByText("Original Title"));
    const input = screen.getByLabelText("app_editTitle");
    // Type same title and Enter (or blur)
    await userEvent.clear(input);
    await userEvent.type(input, "Original Title");
    await userEvent.tab();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("enters edit mode with Enter key on the display", () => {
    const onSave = vi.fn();
    render(
      <EditableTitle bookmark={baseBookmark} onSave={onSave} />,
    );
    const display = screen.getByText("Original Title");
    fireEvent.keyDown(display, { key: "Enter" });
    expect(screen.getByLabelText("app_editTitle")).toBeTruthy();
  });

  it("enters edit mode with Space key on the display", () => {
    const onSave = vi.fn();
    render(
      <EditableTitle bookmark={baseBookmark} onSave={onSave} />,
    );
    const display = screen.getByText("Original Title");
    fireEvent.keyDown(display, { key: " " });
    expect(screen.getByLabelText("app_editTitle")).toBeTruthy();
  });

  it("resets title when bookmark.id changes", async () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <EditableTitle
        bookmark={{ id: "1", title: "Title A" }}
        onSave={onSave}
      />,
    );
    expect(screen.getByText("Title A")).toBeTruthy();

    // Re-render with different bookmark id
    rerender(
      <EditableTitle
        bookmark={{ id: "2", title: "Title B" }}
        onSave={onSave}
      />,
    );
    expect(screen.getByText("Title B")).toBeTruthy();
  });

  it("does not call onSave if the sanitized title is empty", async () => {
    mockSanitize.mockReturnValue("");
    const onSave = vi.fn();
    render(<EditableTitle bookmark={baseBookmark} onSave={onSave} />);
    await userEvent.click(screen.getByText("Original Title"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    await userEvent.type(input, "   ");
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
  });
});
