import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: vi.fn((key: string, fb?: string) => fb || key) }),
}));

const mockExec = vi.fn();
const mockFind = vi.fn(() => ({ exec: mockExec }));
const mockDb = { documents: { find: mockFind } };

vi.mock("../../db/database", () => ({
  initDB: vi.fn(() => Promise.resolve(mockDb)),
}));

const { Backlinks } = await import("../../components/Backlinks");

const flushBacklinksLoad = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("Backlinks", () => {
  it("returns null when there are no backlinks", async () => {
    mockExec.mockResolvedValue([]);
    const { container, unmount } = render(
      <Backlinks documentId="doc-1" onSelect={vi.fn()} />,
    );
    await flushBacklinksLoad();
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
    unmount();
  });

  it("clears the visible backlinks when changing documents", async () => {
    let resolveSecond!: (value: unknown[]) => void;
    mockExec
      .mockReset()
      .mockResolvedValueOnce([
        { id: "old-link", title: "Old result", textContent: "Old" },
      ])
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve; }),
      );

    const { container, rerender, unmount } = render(
      <Backlinks documentId="doc-1" onSelect={vi.fn()} />,
    );
    await flushBacklinksLoad();
    expect(container.textContent).toContain("Old result");

    rerender(<Backlinks documentId="doc-2" onSelect={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).not.toContain("Old result");

    resolveSecond!([
      { id: "new-link", title: "New result", textContent: "New" },
    ]);
    await flushBacklinksLoad();
    expect(container.textContent).toContain("New result");
    unmount();
  });

  it("ignores results from a previous documentId when the selection changes", async () => {
    let resolveFirst!: (value: unknown[]) => void;
    let resolveSecond!: (value: unknown[]) => void;
    mockExec
      .mockReset()
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve; }),
      );

    const { container, rerender, unmount } = render(
      <Backlinks documentId="doc-1" onSelect={vi.fn()} />,
    );
    await act(async () => { await Promise.resolve(); });
    rerender(<Backlinks documentId="doc-2" onSelect={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });

    resolveFirst!([
      { id: "old-link", title: "Old result", textContent: "Old" },
    ]);
    await flushBacklinksLoad();
    expect(container.textContent).not.toContain("Old result");

    resolveSecond!([
      { id: "new-link", title: "New result", textContent: "New" },
    ]);
    await flushBacklinksLoad();
    expect(container.textContent).toContain("New result");
    unmount();
  });

  it("renders backlinks when they exist", async () => {
    const docs = [
      {
        id: "link-1",
        title: "Documento A",
        textContent: "Contenido del documento A",
      },
      { id: "link-2", title: "Documento B", textContent: "Otro contenido" },
    ];
    mockExec.mockResolvedValue(docs);
    const { getByText, unmount } = render(
      <Backlinks documentId="doc-1" onSelect={vi.fn()} />,
    );
    await flushBacklinksLoad();
    expect(getByText("Documento A")).toBeTruthy();
    expect(getByText("Documento B")).toBeTruthy();
    unmount();
  });

  it("calls onSelect when clicking a backlink", async () => {
    const onSelect = vi.fn();
    const docs = [
      { id: "link-1", title: "Documento A", textContent: "Contenido" },
    ];
    mockExec.mockResolvedValue(docs);
    const { getByText, unmount } = render(
      <Backlinks documentId="doc-1" onSelect={onSelect} />,
    );
    await flushBacklinksLoad();
    expect(getByText("Documento A")).toBeTruthy();
    await userEvent.click(getByText("Documento A"));
    expect(onSelect).toHaveBeenCalledWith("link-1");
    unmount();
  });

  it("llama onSelect con Enter", async () => {
    const onSelect = vi.fn();
    const docs = [
      { id: "link-1", title: "Documento A", textContent: "Contenido" },
    ];
    mockExec.mockResolvedValue(docs);
    const { getByText, unmount } = render(
      <Backlinks documentId="doc-1" onSelect={onSelect} />,
    );
    await flushBacklinksLoad();
    expect(getByText("Documento A")).toBeTruthy();
    (getByText("Documento A").closest('[role="button"]') as any).focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("link-1");
    unmount();
  });

  it("llama onSelect con Space", async () => {
    const onSelect = vi.fn();
    const docs = [
      { id: "link-1", title: "Documento A", textContent: "Contenido" },
    ];
    mockExec.mockResolvedValue(docs);
    const { getByText, unmount } = render(
      <Backlinks documentId="doc-1" onSelect={onSelect} />,
    );
    await flushBacklinksLoad();
    expect(getByText("Documento A")).toBeTruthy();
    (getByText("Documento A").closest('[role="button"]') as any).focus();
    await userEvent.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith("link-1");
    unmount();
  });

  it("finds documents that contain the documentId in links", async () => {
    mockExec.mockResolvedValue([]);
    const { unmount } = render(<Backlinks documentId="doc-42" onSelect={vi.fn()} />);
    await flushBacklinksLoad();
    expect(mockFind).toHaveBeenCalledWith({
      selector: { links: { $in: ["doc-42"] } },
    });
    unmount();
  });
});
