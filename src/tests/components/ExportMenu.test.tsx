import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockHtml2pdfInstance = {
  from: vi.fn(() => ({ save: vi.fn(() => Promise.resolve()) })),
};
vi.mock("html2pdf.js", () => ({ default: vi.fn(() => mockHtml2pdfInstance) }));

const { ExportMenu } = await import("../../components/ExportMenu");
const html2pdfMod = await import("html2pdf.js");

function flushPromises() {
  return new Promise(process.nextTick);
}

describe("ExportMenu", () => {
  let editor: any;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    editor = {
      blocksToMarkdownLossy: vi.fn(() => "# Test\nContent"),
      document: [],
    };
  });

  it("renders export buttons", () => {
    const { getByText } = render(
      <ExportMenu editor={editor} title="TestDoc" />,
    );
    expect(getByText("PDF")).toBeTruthy();
    expect(getByText("MD")).toBeTruthy();
    expect(getByText("DOC")).toBeTruthy();
    expect(getByText("EPUB")).toBeTruthy();
  });

  it("does not download the content of a stale export after unmount", async () => {
    let resolveContent: ((value: string) => void) | undefined;
    editor.blocksToMarkdownLossy.mockImplementation(
      () => new Promise<string>((resolve) => {
        resolveContent = resolve;
      }),
    );
    const { unmount } = render(
      <ExportMenu editor={editor} title="TestDoc" />,
    );
    const buttons = document.querySelectorAll("button");
    await userEvent.click(buttons[1]!);

    unmount();
    await act(async () => {
      resolveContent?.("stale markdown");
    });

    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("exports Markdown creating blob and anchor", async () => {
    render(<ExportMenu editor={editor} title="TestDoc" />);
    const buttons = document.querySelectorAll("button");
    await userEvent.click(buttons[1]!);
    await flushPromises();
    expect(editor.blocksToMarkdownLossy).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("exports DOCX", async () => {
    render(<ExportMenu editor={editor} title="TestDoc" />);
    const buttons = document.querySelectorAll("button");
    await userEvent.click(buttons[2]!);
    await flushPromises();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("exports EPUB", async () => {
    render(<ExportMenu editor={editor} title="TestDoc" />);
    const buttons = document.querySelectorAll("button");
    await userEvent.click(buttons[3]!);
    await flushPromises();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("uses document fallback when blocksToMarkdownLossy is missing", async () => {
    const editorNoBlocks = {
      document: [
        { type: "heading", content: [{ text: "Title" }] },
        { type: "paragraph", content: [{ text: "Body" }] },
        { type: "bulletListItem", content: [{ text: "Item" }] },
      ],
    };
    render(<ExportMenu editor={editorNoBlocks as any} title="TestDoc" />);
    const buttons = document.querySelectorAll("button");
    await userEvent.click(buttons[1]!);
    await flushPromises();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("handles fallback when block text is empty", async () => {
    const editorEmptyText = {
      document: [
        { type: "heading", content: [{ text: "" }] },
        { type: "paragraph", content: [] },
      ],
    };
    render(<ExportMenu editor={editorEmptyText as any} title="TestDoc" />);
    const buttons = document.querySelectorAll("button");
    await userEvent.click(buttons[1]!);
    await flushPromises();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("handles fallback when content is null", async () => {
    const editorNullContent = {
      document: [{ type: "paragraph", content: null }],
    };
    const { container } = render(
      <ExportMenu editor={editorNullContent as any} title="TestDoc" />,
    );
    const buttons = container.querySelectorAll("button");
    await userEvent.click(buttons[1]!);
    await flushPromises();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("handles null document with blocksToMarkdownLossy", async () => {
    const editorNullDoc = {
      blocksToMarkdownLossy: vi.fn(() => "# Markdown"),
      document: null,
    };
    render(<ExportMenu editor={editorNullDoc as any} title="TestDoc" />);
    const buttons = document.querySelectorAll("button");
    await userEvent.click(buttons[1]!);
    await flushPromises();
    expect(editorNullDoc.blocksToMarkdownLossy).toHaveBeenCalledWith([]);
  });

  it("handles document being null/undefined", async () => {
    const editorUndefinedDoc = {};
    render(<ExportMenu editor={editorUndefinedDoc as any} title="TestDoc" />);
    const buttons = document.querySelectorAll("button");
    await userEvent.click(buttons[1]!);
    await flushPromises();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("exports PDF if the element exists", async () => {
    const el = document.createElement("div");
    el.className = "blocknote-theme-wrapper";
    document.body.appendChild(el);

    render(<ExportMenu editor={editor} title="TestDoc" />);
    const buttons = document.querySelectorAll("button");
    await userEvent.click(buttons[0]!);

    expect(html2pdfMod.default).toHaveBeenCalled();
    expect(mockHtml2pdfInstance.from).toHaveBeenCalledWith(el);
    document.body.removeChild(el);
  });

  it("does not export PDF if the element does not exist", async () => {
    render(<ExportMenu editor={editor} title="TestDoc" />);
    const buttons = document.querySelectorAll("button");
    await userEvent.click(buttons[0]!);

    expect(html2pdfMod.default).not.toHaveBeenCalled();
  });

  it("handles unknown block type in fallback", async () => {
    const editorUnknown = {
      document: [{ type: "unknownType", content: [{ text: "Unknown" }] }],
    };
    render(<ExportMenu editor={editorUnknown as any} title="TestDoc" />);
    const buttons = document.querySelectorAll("button");
    await userEvent.click(buttons[1]!);
    await flushPromises();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
