import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

vi.mock("react-i18next", () => ({
  // i18n.ts:96 uses initReactI18next at import time (via exporter.formatters)
  // — the mock must export it with i18next's expected shape: type '3rdParty'
  // (i18next.use() validates module.type) plus an init() callback.
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      if (opts && typeof opts === "object" && opts.defaultValue !== undefined)
        return opts.defaultValue;
      if (typeof opts === "string") return opts;
      return key;
    },
  }),
}));

const mocks = vi.hoisted(() => {
  const bookmarks = [
    {
      id: "bm1",
      url: "https://example.com",
      title: "Example",
      content: "Some content",
      summary: "A summary",
      tags: ["tag1"],
      relatedLinks: [],
      embedding: [0.1],
      processed: true,
      isDeleted: false,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    },
    {
      id: "bm2",
      url: "https://test.org",
      title: "Test",
      content: "",
      summary: "",
      tags: ["tag2"],
      relatedLinks: [],
      processed: false,
      isDeleted: true,
      createdAt: "2024-02-01",
      updatedAt: "2024-02-01",
    },
  ];
  const documents = [
    {
      id: "doc1",
      folderId: "",
      title: "My Doc",
      blocks: [],
      textContent: "Hello world",
      summary: "",
      tags: ["doc-tag"],
      links: [],
      processed: true,
      isPrivate: false,
      isDeleted: false,
      createdAt: "2024-01-15",
      updatedAt: "2024-01-15",
    },
  ];
  const folders = [
    {
      id: "fld1",
      title: "My Folder",
      parentId: "",
      createdAt: "2024-01-01",
    },
  ];
  const initDB = vi.fn().mockResolvedValue({
    bookmarks: { find: () => ({ exec: () => Promise.resolve(bookmarks) }) },
    documents: { find: () => ({ exec: () => Promise.resolve(documents) }) },
    folders: { find: () => ({ exec: () => Promise.resolve(folders) }) },
  });
  return { initDB };
});

vi.mock("../../db/database", () => ({ initDB: mocks.initDB }));

const mockCreateObjectURL = vi.fn().mockReturnValue("blob:test-url");
const mockRevokeObjectURL = vi.fn();
const _origURL = URL;
vi.stubGlobal(
  "URL",
  new Proxy(_origURL, {
    get(target, prop, receiver) {
      if (prop === "createObjectURL") return mockCreateObjectURL;
      if (prop === "revokeObjectURL") return mockRevokeObjectURL;
      return Reflect.get(target, prop, receiver);
    },
  }),
);

vi.mock("lucide-react", () => {
  const mockIcon = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Download: mockIcon("Download"),
    FileText: mockIcon("FileText"),
    Database: mockIcon("Database"),
    Calendar: mockIcon("Calendar"),
    Tag: mockIcon("Tag"),
    Filter: mockIcon("Filter"),
    Settings: mockIcon("Settings"),
  };
});

import ExportDialog from "../../components/ExportDialog";

describe("Integration: Export Flow (ExportDialog + UniversalExporter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dialog with format options", () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("JSON")).toBeTruthy();
    expect(screen.getByText("CSV")).toBeTruthy();
    expect(screen.getByText("Markdown")).toBeTruthy();
    expect(screen.getByText("Notion")).toBeTruthy();
    expect(screen.getByText("Obsidian")).toBeTruthy();
    expect(screen.getByText("HTML")).toBeTruthy();
  });

  it("exports JSON and calls URL.createObjectURL", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("JSON"));
    await userEvent.click(screen.getByText("app_export"));
    await waitFor(() => expect(mocks.initDB).toHaveBeenCalled());
    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalled());
  });

  it("exports CSV", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("CSV"));
    await userEvent.click(screen.getByText("app_export"));
    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalled());
  });

  it("exports Markdown", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("Markdown"));
    await userEvent.click(screen.getByText("app_export"));
    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalled());
  });

  it("exports Notion", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("Notion"));
    await userEvent.click(screen.getByText("app_export"));
    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalled());
  });

  it("exports Obsidian (zip with JSZip)", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("Obsidian"));
    await userEvent.click(screen.getByText("app_export"));
    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalled());
  });

  it("exports HTML", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("HTML"));
    await userEvent.click(screen.getByText("app_export"));
    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalled());
  });

  it("shows success message with file name", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("JSON"));
    await userEvent.click(screen.getByText("app_export"));
    await waitFor(() =>
      expect(screen.getByText("app_exportSuccess")).toBeTruthy(),
    );
    const names = screen.getAllByText(/bookmarkforge-export-/);
    expect(names.length).toBeGreaterThan(0);
  });

  it("handles error when initDB fails", async () => {
    mocks.initDB.mockRejectedValueOnce(new Error("DB error"));
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("JSON"));
    await userEvent.click(screen.getByText("app_export"));
    await waitFor(() => {
      expect(screen.getAllByText("app_exportError").length).toBeGreaterThan(0);
    });
  });

  it("closes dialog when clicking cancel", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ExportDialog isOpen={true} onClose={onClose} />,
    );
    await userEvent.click(screen.getByText("app_cancel"));
    expect(onClose).toHaveBeenCalled();
    rerender(<ExportDialog isOpen={false} onClose={onClose} />);
    expect(screen.queryByText("JSON")).toBeNull();
  });
});
