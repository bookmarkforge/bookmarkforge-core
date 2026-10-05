import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

const createMockDoc = (overrides: Record<string, unknown> = {}) => ({
  id: "b1",
  tags: [],
  ...overrides,
  incrementalPatch: vi.fn().mockResolvedValue(undefined),
});

let currentDoc: ReturnType<typeof createMockDoc>;

// All mocks referenced by vi.mock factories must live in vi.hoisted(): the
// factory is hoisted above top-level `const`/`let` declarations, so plain
// module-scope variables are still in the temporal dead zone when the factory
// runs. This wrapper keeps the factory closures alive and the tests happy.
const mockState = vi.hoisted(() => {
  const mockFindOne = vi.fn();
  let mockFindDoc!: { tags: string[]; incrementalPatch: ReturnType<typeof vi.fn> };
  // find() must return a query object synchronously (RxDB semantics) so the
  // call site can chain .exec(); mockResolvedValue would hand back a Promise
  // and break the chain.
  const mockFind = vi.fn().mockImplementation(() => ({
    exec: vi.fn().mockResolvedValue([]),
  }));
  const mockBulkInsert = vi.fn().mockResolvedValue(undefined);
  const mockBulkUpdate = vi.fn().mockResolvedValue(undefined);
  const mockBookmarks = {
    findOne: mockFindOne,
    find: mockFind,
    bulkInsert: mockBulkInsert,
  };
  const mockDB = { bookmarks: mockBookmarks as any };
  return {
    mockFindOne,
    mockFind,
    mockFindDoc,
    mockBulkInsert,
    mockBulkUpdate,
    mockBookmarks,
    mockDB,
  };
});

vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue(mockState.mockDB),
}));

vi.mock("../../db/rxdb-optimized", () => ({
  bulkUpdate: mockState.mockBulkUpdate,
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/id", () => ({
  generateId: vi.fn().mockReturnValue("generated-id-123"),
}));

import { initDB } from "../../db/database";
import { useBookmarkCRUD } from "../../hooks/useBookmarkCRUD";

const t = (key: string) => key;

describe("useBookmarkCRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.mockFindDoc = {
      tags: [],
      incrementalPatch: vi.fn().mockResolvedValue(undefined),
    };
    mockState.mockFind.mockImplementation(() => ({
      exec: vi.fn().mockResolvedValue([mockState.mockFindDoc]),
    }));
    mockState.mockFindOne.mockImplementation(() => ({
      exec: vi.fn().mockImplementation(() => {
        currentDoc = createMockDoc();
        return Promise.resolve(currentDoc);
      }),
    }));
  });

  it("deletes a bookmark by id", async () => {
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await result.current.handleDelete("b1");
    expect(mockState.mockFindOne).toHaveBeenCalledWith("b1");
    expect(currentDoc.incrementalPatch).toHaveBeenCalledWith(
      expect.objectContaining({ isDeleted: true }),
    );
  });

  it("adds a tag to a bookmark", async () => {
    const { result } = renderHook(() => useBookmarkCRUD(t));
    const bookmark = { id: "b1", title: "Test", tags: [] } as any;
    await result.current.handleAddTag(bookmark, "new-tag");
    expect(currentDoc.incrementalPatch).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["new-tag"] }),
    );
  });

  it("removes a tag from a bookmark", async () => {
    mockState.mockFindOne.mockImplementation(() => ({
      exec: vi.fn().mockImplementation(() => {
        currentDoc = createMockDoc({ tags: ["old", "new-tag"] });
        return Promise.resolve(currentDoc);
      }),
    }));
    const { result } = renderHook(() => useBookmarkCRUD(t));
    const bookmark = {
      id: "b1",
      title: "Test",
      tags: ["old", "new-tag"],
    } as any;
    await result.current.handleRemoveTag(bookmark, "new-tag");
    expect(currentDoc.incrementalPatch).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["old"] }),
    );
  });

  it("clears all tags from a bookmark", async () => {
    const { result } = renderHook(() => useBookmarkCRUD(t));
    const bookmark = { id: "b1", title: "Test", tags: ["a", "b"] } as any;
    await result.current.handleClearTags(bookmark);
    expect(currentDoc.incrementalPatch).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [] }),
    );
  });

  it("bulk deletes bookmarks", async () => {
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await result.current.handleBulkDelete(new Set(["b1", "b2"]));
    expect(mockState.mockBulkUpdate).toHaveBeenCalledWith(
      mockState.mockBookmarks,
      expect.arrayContaining([
        expect.objectContaining({
          id: "b1",
          data: expect.objectContaining({ isDeleted: true }),
        }),
        expect.objectContaining({
          id: "b2",
          data: expect.objectContaining({ isDeleted: true }),
        }),
      ]),
    );
  });

  it("ignores a concurrent duplicate HTML import", async () => {
    let resolveText!: (value: string) => void;
    const text = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    const firstFile = { name: "first.html", text: vi.fn(() => text) } as any;
    const secondFile = new File(['<a href="https://second.example">Second</a>'], "second.html", {
      type: "text/html",
    });
    mockState.mockFindOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    });
    const { result } = renderHook(() => useBookmarkCRUD(t));

    let firstImport!: Promise<void>;
    await act(async () => {
      firstImport = result.current.handleImportHTML(firstFile);
      await Promise.resolve();
      await result.current.handleImportHTML(secondFile);
    });

    expect(firstFile.text).toHaveBeenCalledTimes(1);
    expect(mockState.mockBulkInsert).not.toHaveBeenCalled();
    resolveText('<a href="https://first.example">First</a>');
    await act(async () => {
      await firstImport;
    });
    expect(mockState.mockBulkInsert).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized HTML file before reading it", async () => {
    const file = {
      name: "bookmarks.html",
      size: 50 * 1024 * 1024 + 1,
      text: vi.fn(),
    } as any;
    const { result } = renderHook(() => useBookmarkCRUD(t));

    await act(async () => {
      await result.current.handleImportHTML(file);
    });

    expect(file.text).not.toHaveBeenCalled();
    expect(mockState.mockBulkInsert).not.toHaveBeenCalled();
  });

  it("rejects non-HTML files before reading them", async () => {
    const file = {
      name: "bookmarks.txt",
      size: 10,
      text: vi.fn(),
    } as any;
    const { result } = renderHook(() => useBookmarkCRUD(t));

    await act(async () => {
      await result.current.handleImportHTML(file);
    });

    expect(file.text).not.toHaveBeenCalled();
    expect(mockState.mockBulkInsert).not.toHaveBeenCalled();
  });

  it("imports safe HTTP links once and bounds imported titles", async () => {
    const longTitle = "x".repeat(700);
    const file = new File(
      [
        `<a href="https://example.com">Example</a><a href="https://example.com">Duplicate</a><a href="${"httpx"}://evil.example">Bad scheme</a><a href="javascript:alert(1)">Bad</a><a href="https://long.example">${longTitle}</a>`,
      ],
      "bookmarks.html",
      { type: "text/html" },
    );
    mockState.mockFindOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    });
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await act(async () => {
      await result.current.handleImportHTML(file);
    });
    const inserted = mockState.mockBulkInsert.mock.calls[0]![0] as any[];
    // only http(s) links pass the sanitizer; duplicate and unsafe links are dropped
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toEqual(
      expect.objectContaining({
        // sanitizeUrl returns parsed.href, which normalizes the trailing slash
        url: "https://example.com/",
        title: "Example",
      }),
    );
    expect(inserted[1]!.title).toHaveLength(500);
    // success path resets the importing flag
    expect(result.current.isImporting).toBe(false);
  });

  it("skips an HTML link already present by url hash", async () => {
    mockState.mockFindOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({ id: "existing" }),
    });
    const file = new File(
      ['<a href="https://already.example">Already there</a>'],
      "bookmarks.html",
      { type: "text/html" },
    );
    const { result } = renderHook(() => useBookmarkCRUD(t));

    await act(async () => {
      await result.current.handleImportHTML(file);
    });

    expect(mockState.mockBulkInsert).not.toHaveBeenCalled();
    expect(result.current.isImporting).toBe(false);
  });

  it("bulk adds a tag to multiple bookmarks", async () => {
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await result.current.handleBulkAddTag(
      "shared-tag",
      new Set(["b1", "b2"]),
    );
    expect(mockState.mockFindDoc!.incrementalPatch).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["shared-tag"] }),
    );
  });

  it("handles delete errors gracefully", async () => {
    (initDB as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB unavailable"),
    );
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await expect(result.current.handleDelete("b1")).resolves.toBeUndefined();
  });

  it("does nothing when adding an empty tag", async () => {
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await result.current.handleAddTag({ id: "b1" } as any, "   ");
    expect(mockState.mockFindOne).not.toHaveBeenCalled();
  });

  it("does not add a duplicate tag", async () => {
    mockState.mockFindOne.mockImplementation(() => ({
      exec: vi.fn().mockImplementation(() => {
        currentDoc = createMockDoc({ tags: ["existing"] });
        return Promise.resolve(currentDoc);
      }),
    }));
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await result.current.handleAddTag({ id: "b1" } as any, "existing");
    expect(currentDoc.incrementalPatch).not.toHaveBeenCalled();
  });

  it("does nothing when the bookmark doc is missing on add tag", async () => {
    mockState.mockFindOne.mockImplementation(() => ({
      exec: vi.fn().mockResolvedValue(null),
    }));
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await expect(
      result.current.handleAddTag({ id: "b1" } as any, "tag"),
    ).resolves.toBeUndefined();
  });

  it("does nothing when removing an empty tag", async () => {
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await result.current.handleRemoveTag({ id: "b1" } as any, "  ");
    expect(mockState.mockFindOne).not.toHaveBeenCalled();
  });

  it("does nothing when the bookmark doc is missing on clear tags", async () => {
    mockState.mockFindOne.mockImplementation(() => ({
      exec: vi.fn().mockResolvedValue(null),
    }));
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await expect(
      result.current.handleClearTags({ id: "b1" } as any),
    ).resolves.toBeUndefined();
  });

  it("handles add-tag errors gracefully", async () => {
    (initDB as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB unavailable"),
    );
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await expect(
      result.current.handleAddTag({ id: "b1" } as any, "tag"),
    ).resolves.toBeUndefined();
  });

  it("does nothing on bulk add with an empty tag", async () => {
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await result.current.handleBulkAddTag("  ", new Set(["b1"]));
    expect(mockState.mockFind).not.toHaveBeenCalled();
  });

  it("does nothing on bulk remove with an empty tag", async () => {
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await result.current.handleBulkRemoveTag("  ", new Set(["b1"]));
    expect(mockState.mockFind).not.toHaveBeenCalled();
  });

  it("bulk removes a tag from matching bookmarks", async () => {
    mockState.mockFindDoc = {
      tags: ["dev", "keep"],
      incrementalPatch: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await result.current.handleBulkRemoveTag("dev", new Set(["b1"]));
    expect(mockState.mockFindDoc.incrementalPatch).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["keep"] }),
    );
  });

  it("bulk clear tags patches every matching bookmark", async () => {
    mockState.mockFindDoc = {
      tags: ["dev", "keep"],
      incrementalPatch: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await result.current.handleBulkClearTags(new Set(["b1"]));
    expect(mockState.mockFindDoc.incrementalPatch).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [] }),
    );
  });

  it("bulk add skips bookmarks that already have the tag", async () => {
    mockState.mockFindDoc = {
      tags: ["shared"],
      incrementalPatch: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await result.current.handleBulkAddTag(
      "shared",
      new Set(["b1"]),
    );
    expect(mockState.mockFindDoc.incrementalPatch).not.toHaveBeenCalled();
  });

  it("handles bulk-delete errors gracefully", async () => {
    (initDB as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB unavailable"),
    );
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await expect(
      result.current.handleBulkDelete(new Set(["b1"])),
    ).resolves.toBeUndefined();
  });

  it("imports nothing when the HTML has no http links", async () => {
    const file = new File(
      [
        '<a href="mailto:user@example.com">Mail</a><a href="javascript:alert(1)">Bad</a>',
      ],
      "bookmarks.html",
      { type: "text/html" },
    );
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await act(async () => {
      await result.current.handleImportHTML(file);
    });
    expect(mockState.mockBulkInsert).not.toHaveBeenCalled();
  });

  it("handles import errors gracefully", async () => {
    (initDB as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB unavailable"),
    );
    const file = new File(
      ['<a href="https://example.com">Example</a>'],
      "bookmarks.html",
      { type: "text/html" },
    );
    const { result } = renderHook(() => useBookmarkCRUD(t));
    await act(async () => {
      await expect(
        result.current.handleImportHTML(file),
      ).resolves.toBeUndefined();
    });
    expect(result.current.isImporting).toBe(false);
  });
});
