
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import type { TFunction } from "i18next";

const mockInstance = {
  set: () => mockInstance,
  from: () => mockInstance,
  save: vi.fn(),
};
vi.mock("html2pdf.js", (() => ({ default: vi.fn(() => mockInstance) })) as any)

import {
  SortIcon,
  exportJSON,
  exportCSV,
  exportMarkdown,
  exportPDF,
} from "../../components/bookmarks/bookmarkTableUtils";
import type { Bookmark } from "../../types";

const sampleBookmark = {
  id: "1",
  title: "Test Bookmark",
  url: "https://example.com",
  summary: "A test summary",
  tags: ["test", "example"],
  relatedLinks: [],
  embedding: undefined,
  processed: false,
  isPrivate: false,
  isDeleted: false,
  visitCount: 0,
  createdAt: "2024-01-15T10:00:00.000Z",
  updatedAt: "2024-01-15T10:00:00.000Z",
  content: "Test content",
} as unknown as Bookmark;

describe("SortIcon", () => {
  it("renders for non-active field", () => {
    const { container } = render(
      <SortIcon field="title" sortField="url" sortDirection="asc" />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders for active asc field", () => {
    const { container } = render(
      <SortIcon field="title" sortField="title" sortDirection="asc" />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders for active desc field", () => {
    const { container } = render(
      <SortIcon field="createdAt" sortField="createdAt" sortDirection="desc" />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("exportJSON", () => {
  it("calls createElement and sets href/download attributes", () => {
    const anchor = document.createElement("a");
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockReturnValue(anchor);
    const setAttributeSpy = vi.spyOn(anchor, "setAttribute");
    const appendChildSpy = vi.spyOn(document.body, "appendChild");

    exportJSON([sampleBookmark]);

    expect(createElementSpy).toHaveBeenCalledWith("a");
    expect(setAttributeSpy).toHaveBeenCalledWith(
      "download",
      "bookmarks_export.json",
    );
    expect(setAttributeSpy).toHaveBeenCalledWith(
      "href",
      expect.stringContaining("data:text/json"),
    );
    expect(appendChildSpy).toHaveBeenCalled();

    createElementSpy.mockRestore();
  });

  it("uses custom filename when provided", () => {
    const anchor = document.createElement("a");
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockReturnValue(anchor);
    const setAttributeSpy = vi.spyOn(anchor, "setAttribute");

    exportJSON([sampleBookmark], "custom.json");

    expect(setAttributeSpy).toHaveBeenCalledWith("download", "custom.json");
    createElementSpy.mockRestore();
  });
});

describe("exportCSV", () => {
  const t = ((key: string) => {
    const map: Record<string, string> = {
      app_csvTitle: "Title",
      app_csvUrl: "URL",
      app_csvSummary: "Summary",
      app_csvTags: "Tags",
      app_csvCreatedAt: "Created",
    };
    return map[key] || key;
  }) as unknown as TFunction;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an anchor with CSV blob URL", () => {
    const link = document.createElement("a");
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockReturnValue(link);

    exportCSV([sampleBookmark], t as any);

    expect(createElementSpy).toHaveBeenCalledWith("a");
    createElementSpy.mockRestore();
  });

  it("uses default filename when not provided", () => {
    const link = document.createElement("a");
    vi.spyOn(document, "createElement").mockReturnValue(link);
    const setAttribute = vi.spyOn(link, "setAttribute");

    exportCSV([sampleBookmark], t as any);

    expect(setAttribute).toHaveBeenCalledWith(
      "download",
      expect.stringMatching(/^bookmarks_export_\d{4}-\d{2}-\d{2}\.csv$/),
    );
  });

  it("handles bookmarks with missing fields", () => {
    const link = document.createElement("a");
    vi.spyOn(document, "createElement").mockReturnValue(link);

    const sparse = {
      id: "2",
      title: "",
      url: "",
      summary: "",
      tags: undefined as unknown as string[],
      relatedLinks: [],
      embedding: undefined,
      processed: false,
      isPrivate: false,
      isDeleted: false,
      visitCount: 0,
      createdAt: "2024-01-15T10:00:00.000Z",
      updatedAt: "2024-01-15T10:00:00.000Z",
      content: "",
    } as unknown as Bookmark;

    expect(() => exportCSV([sparse], t)).not.toThrow();
  });
});

describe("exportMarkdown", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a download link with markdown content", () => {
    const link = document.createElement("a");
    vi.spyOn(document, "createElement").mockReturnValue(link);
    const setAttribute = vi.spyOn(link, "setAttribute");

    const t = ((s: string): string => s) as unknown as TFunction;
    exportMarkdown(sampleBookmark, t as any);

    expect(setAttribute).toHaveBeenCalledWith(
      "href",
      expect.stringContaining("blob:"),
    );
    expect(setAttribute).toHaveBeenCalledWith("download", "test_bookmark.md");
  });

  it("handles missing summary using fallback t() text", () => {
    const link = document.createElement("a");
    vi.spyOn(document, "createElement").mockReturnValue(link);

    const noSummary: Bookmark = { ...sampleBookmark, summary: "" };
    const tMock = vi.fn((k: string) => k);
    const t = tMock as unknown as TFunction;

    exportMarkdown(noSummary, t);
    expect(
      tMock.mock.calls.some((c: string[]) => c[0] === "app_noSummaryAvailable"),
    ).toBe(true);
  });

  it("handles missing content", () => {
    const link = document.createElement("a");
    vi.spyOn(document, "createElement").mockReturnValue(link);

    const noContent: Bookmark = { ...sampleBookmark, content: "" };
    expect(() =>
      exportMarkdown(
        noContent,
        vi.fn((k: string) => k) as unknown as TFunction,
      ),
    ).not.toThrow();
  });
});

describe("exportPDF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls html2pdf when reading-content element exists", async () => {
    const el = document.createElement("div");
    el.id = "reading-content";
    document.body.appendChild(el);

    await exportPDF(sampleBookmark as any);

    const mod = await import("html2pdf.js");
    expect(mod.default).toHaveBeenCalled();
    expect(mockInstance.save).toHaveBeenCalled();

    document.body.removeChild(el);
  });

  it("skips the export when the signal is already aborted", async () => {
    const el = document.createElement("div");
    el.id = "reading-content";
    document.body.appendChild(el);
    const controller = new AbortController();
    controller.abort();

    await exportPDF(sampleBookmark as any, controller.signal);

    const mod = await import("html2pdf.js");
    expect(mod.default).not.toHaveBeenCalled();
    document.body.removeChild(el);
  });

  it("does nothing when reading-content element is absent", async () => {
    await exportPDF(sampleBookmark as any);

    const mod = await import("html2pdf.js");
    expect(mod.default).not.toHaveBeenCalled();
  });
});
