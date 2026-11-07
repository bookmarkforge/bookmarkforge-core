import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

vi.mock("@blocknote/core", () => ({ BlockNoteEditor: class {} }));

const { SuggestionsPanel } =
  await import("../../components/BlockEditorParts/SuggestionsPanel");

describe("SuggestionsPanel", () => {
  const mockEditor = {
    document: [{ type: "paragraph" }],
    insertBlocks: vi.fn(),
  };

  it("returns null when isOpen is false", () => {
    const { container } = render(
      <SuggestionsPanel
        isOpen={false}
        onClose={vi.fn()}
        suggestions={[]}
        onInsertSuggestion={vi.fn()}
        editor={mockEditor as any}
      />,
    );
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("shows empty message when there are no suggestions", () => {
    const { getByText } = render(
      <SuggestionsPanel
        isOpen={true}
        onClose={vi.fn()}
        suggestions={[]}
        onInsertSuggestion={vi.fn()}
        editor={mockEditor as any}
      />,
    );
    expect(getByText("app_writingReferences")).toBeTruthy();
  });

  it("renders the suggestions list", () => {
    const suggestions = [
      { id: "1", title: "Sugerencia A", summary: "Resumen A" },
      { id: "2", title: "Sugerencia B", summary: "Resumen B" },
    ];
    const { getByText } = render(
      <SuggestionsPanel
        isOpen={true}
        onClose={vi.fn()}
        suggestions={suggestions}
        onInsertSuggestion={vi.fn()}
        editor={mockEditor as any}
      />,
    );
    expect(getByText("Sugerencia A")).toBeTruthy();
    expect(getByText("Sugerencia B")).toBeTruthy();
  });

  it("calls onInsertSuggestion when clicked", async () => {
    const onInsert = vi.fn();
    const suggestions = [{ id: "1", title: "Sugerencia A" }];
    const { getByText } = render(
      <SuggestionsPanel
        isOpen={true}
        onClose={vi.fn()}
        suggestions={suggestions}
        onInsertSuggestion={onInsert}
        editor={mockEditor as any}
      />,
    );
    await userEvent.click(getByText("Sugerencia A"));
    expect(onInsert).toHaveBeenCalledWith(suggestions[0]);
  });

  it("inserts a block into the editor when clicked", async () => {
    const suggestions = [
      { id: "1", title: "Test Doc", url: "https://example.com" },
    ];
    const { getByText } = render(
      <SuggestionsPanel
        isOpen={true}
        onClose={vi.fn()}
        suggestions={suggestions}
        onInsertSuggestion={vi.fn()}
        editor={mockEditor as any}
      />,
    );
    await userEvent.click(getByText("Test Doc"));
    expect(mockEditor.insertBlocks).toHaveBeenCalledWith(
      [
        {
          type: "paragraph",
          content: "Reference: [Test Doc](https://example.com)",
        },
      ],
      mockEditor.document[0],
      "after",
    );
  });

  it("inserts with # when there is no url", async () => {
    const onInsert = vi.fn();
    const suggestions = [{ id: "1", title: "No URL" }];
    const { getByText } = render(
      <SuggestionsPanel
        isOpen={true}
        onClose={vi.fn()}
        suggestions={suggestions}
        onInsertSuggestion={onInsert}
        editor={mockEditor as any}
      />,
    );
    await userEvent.click(getByText("No URL"));
    expect(mockEditor.insertBlocks).toHaveBeenCalledWith(
      [{ type: "paragraph", content: "Reference: [No URL](#)" }],
      mockEditor.document[0],
      "after",
    );
  });

  it("llama onInsertSuggestion con Enter", async () => {
    const onInsert = vi.fn();
    const suggestions = [{ id: "1", title: "Tecla Enter" }];
    const { getByText } = render(
      <SuggestionsPanel
        isOpen={true}
        onClose={vi.fn()}
        suggestions={suggestions}
        onInsertSuggestion={onInsert}
        editor={mockEditor as any}
      />,
    );
    (getByText("Tecla Enter").closest('[role="button"]') as HTMLElement)!.focus();
    await userEvent.keyboard("{Enter}");
    expect(onInsert).toHaveBeenCalledWith(suggestions[0]);
  });

  it("closes with the close button", async () => {
    const onClose = vi.fn();
    render(
      <SuggestionsPanel
        isOpen={true}
        onClose={onClose}
        suggestions={[]}
        onInsertSuggestion={vi.fn()}
        editor={mockEditor as any}
      />,
    );
    const closeBtn = document.querySelector("button");
    if (closeBtn) await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows textContent when there is no summary", () => {
    const suggestions = [
      { id: "1", title: "Titulo", textContent: "Contenido crudo" },
    ];
    const { getByText } = render(
      <SuggestionsPanel
        isOpen={true}
        onClose={vi.fn()}
        suggestions={suggestions}
        onInsertSuggestion={vi.fn()}
        editor={mockEditor as any}
      />,
    );
    expect(getByText("Contenido crudo")).toBeTruthy();
  });

  it("does not insert a block if the editor has no document", async () => {
    const onInsert = vi.fn();
    const emptyEditor = { document: [], insertBlocks: vi.fn() };
    const suggestions = [{ id: "1", title: "Doc" }];
    const { getByText } = render(
      <SuggestionsPanel
        isOpen={true}
        onClose={vi.fn()}
        suggestions={suggestions}
        onInsertSuggestion={onInsert}
        editor={emptyEditor as any}
      />,
    );
    await userEvent.click(getByText("Doc"));
    expect(emptyEditor.insertBlocks).not.toHaveBeenCalled();
    expect(onInsert).toHaveBeenCalledWith(suggestions[0]);
  });

  it("a key other than Enter does not insert", async () => {
    const onInsert = vi.fn();
    const suggestions = [{ id: "1", title: "Tecla" }];
    const { getByText } = render(
      <SuggestionsPanel
        isOpen={true}
        onClose={vi.fn()}
        suggestions={suggestions}
        onInsertSuggestion={onInsert}
        editor={mockEditor as any}
      />,
    );
    (getByText("Tecla").closest('[role="button"]') as HTMLElement)!.focus();
    await userEvent.keyboard("a");
    expect(onInsert).not.toHaveBeenCalled();
  });
});
