import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MantineProvider } from "@mantine/core";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s, i18n: { language: "en" } }),
}));
vi.mock("lucide-react", () => ({
  History: () => <svg />,
  RotateCcw: () => <svg />,
  X: () => <svg />,
}));

const mockExec = vi.fn();
const mockFind = vi.fn(() => ({ exec: mockExec }));
const mockDb = { versions: { find: mockFind } };
vi.mock("../../db/database", () => ({
  initDB: vi.fn(() => Promise.resolve(mockDb)),
}));

const { VersionHistory } = await import("../../components/VersionHistory");

describe("VersionHistory", () => {
  const renderHistory = (props: React.ComponentProps<typeof VersionHistory>) =>
    render(
      <MantineProvider>
        <VersionHistory {...props} />
      </MantineProvider>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("shows loading initially", () => {
    mockExec.mockReturnValue(new Promise(() => {}));
    const { getByText } = renderHistory({
      documentId: "doc-1",
      onRestore: vi.fn(),
      onClose: vi.fn(),
    });
    expect(getByText("app_loadingHistory")).toBeTruthy();
  });

  it("shows empty when there are no versions", async () => {
    mockExec.mockResolvedValue([]);
    renderHistory({ documentId: "doc-1", onRestore: vi.fn(), onClose: vi.fn() });
    expect(await screen.findByText("app_noVersionsYet")).toBeTruthy();
  });

  it("discards versions from a previous documentId when the selection changes", async () => {
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

    const { container, rerender } = renderHistory({
      documentId: "doc-1",
      onRestore: vi.fn(),
      onClose: vi.fn(),
    });
    await act(async () => { await Promise.resolve(); });
    rerender(
      <MantineProvider>
        <VersionHistory
          documentId="doc-2"
          onRestore={vi.fn()}
          onClose={vi.fn()}
        />
      </MantineProvider>,
    );
    await act(async () => { await Promise.resolve(); });

    resolveFirst!([
      {
        toJSON: () => ({
          id: "old-version",
          documentId: "doc-1",
          blocks: [],
          createdAt: "2026-01-15T10:00:00Z",
        }),
      },
    ]);
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).not.toContain("app_savedVersion");

    resolveSecond!([
      {
        toJSON: () => ({
          id: "new-version",
          documentId: "doc-2",
          blocks: [],
          createdAt: "2026-01-14T10:00:00Z",
        }),
      },
    ]);
    expect(await screen.findByText("app_savedVersion")).toBeTruthy();
  });

  it("renders the versions list", async () => {
    const versions = [
      { id: "v1", documentId: "doc-1", blocks: [], createdAt: "2026-01-15T10:00:00Z" },
      { id: "v2", documentId: "doc-1", blocks: [], createdAt: "2026-01-14T10:00:00Z" },
    ];
    mockExec.mockResolvedValue(versions.map((v) => ({ toJSON: () => v })));
    renderHistory({ documentId: "doc-1", onRestore: vi.fn(), onClose: vi.fn() });
    expect(await screen.findAllByText("app_savedVersion")).toHaveLength(2);
    expect(screen.getByText("app_versionHistory")).toBeTruthy();
  });

  it("fetches versions sorted by createdAt desc", async () => {
    mockExec.mockResolvedValue([]);
    renderHistory({ documentId: "doc-42", onRestore: vi.fn(), onClose: vi.fn() });
    await screen.findByText("app_noVersionsYet");
    expect(mockFind).toHaveBeenCalledWith({
      selector: { documentId: "doc-42" },
      sort: [{ createdAt: "desc" }],
    });
  });

  it("calls onRestore after confirming in the accessible dialog", async () => {
    const onRestore = vi.fn();
    const blocks = [{ type: "paragraph", content: "test" }];
    mockExec.mockResolvedValue([
      { toJSON: () => ({ id: "v1", documentId: "doc-1", blocks, createdAt: "2026-01-15T10:00:00Z" }) },
    ]);
    renderHistory({ documentId: "doc-1", onRestore, onClose: vi.fn() });
    await userEvent.click(await screen.findByTitle("app_restoreThisVersion"));
    await userEvent.click(screen.getByRole("button", { name: "app_confirm" }));
    expect(onRestore).toHaveBeenCalledWith(blocks);
  });

  it("does not call onRestore if the dialog is cancelled", async () => {
    const onRestore = vi.fn();
    mockExec.mockResolvedValue([
      { toJSON: () => ({ id: "v1", documentId: "doc-1", blocks: [], createdAt: "2026-01-15T10:00:00Z" }) },
    ]);
    renderHistory({ documentId: "doc-1", onRestore, onClose: vi.fn() });
    await userEvent.click(await screen.findByTitle("app_restoreThisVersion"));
    await userEvent.click(screen.getByRole("button", { name: "app_cancel" }));
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("closes with the X button", async () => {
    const onClose = vi.fn();
    mockExec.mockResolvedValue([]);
    renderHistory({ documentId: "doc-1", onRestore: vi.fn(), onClose });
    await screen.findByText("app_noVersionsYet");
    await userEvent.click(screen.getByLabelText("app_close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the auto-save notice in the footer", async () => {
    mockExec.mockResolvedValue([]);
    renderHistory({ documentId: "doc-1", onRestore: vi.fn(), onClose: vi.fn() });
    expect(await screen.findByText("app_autoSaveNote")).toBeTruthy();
  });

  it("shows the formatted date on each version", async () => {
    mockExec.mockResolvedValue([
      { toJSON: () => ({ id: "v1", documentId: "doc-1", blocks: [], createdAt: "2026-01-15T10:00:00Z" }) },
    ]);
    renderHistory({ documentId: "doc-1", onRestore: vi.fn(), onClose: vi.fn() });
    expect(await screen.findByText(/2026|1\/15|15\/1/)).toBeTruthy();
  });

  it("shows a restore button per version", async () => {
    mockExec.mockResolvedValue([
      { toJSON: () => ({ id: "v1", documentId: "doc-1", blocks: [], createdAt: "2026-01-15T10:00:00Z" }) },
      { toJSON: () => ({ id: "v2", documentId: "doc-1", blocks: [], createdAt: "2026-01-14T10:00:00Z" }) },
    ]);
    renderHistory({ documentId: "doc-1", onRestore: vi.fn(), onClose: vi.fn() });
    expect(await screen.findAllByTitle("app_restoreThisVersion")).toHaveLength(2);
  });
});
