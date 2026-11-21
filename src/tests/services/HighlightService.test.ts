import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindExec = vi.fn();
const mockFindOneExec = vi.fn();
const mockInsert = vi.fn();
const mockPatch = vi.fn();
const mockRemove = vi.fn();

const mockInitDB = vi.fn().mockResolvedValue({
  highlights: {
    find: vi.fn(() => ({ exec: mockFindExec })),
    findOne: vi.fn(() => ({ exec: mockFindOneExec })),
    insert: vi.fn((doc) => mockInsert(doc)),
  },
});

vi.mock("../../db/database", () => ({
  initDB: vi.fn(() => mockInitDB()),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockGenerateId = vi.fn();
vi.mock("../../utils/id", () => ({
  generateId: vi.fn(() => mockGenerateId()),
}));

const { highlightService } = await import("../../services/HighlightService");
const { logger } = await import("../../utils/logger");

describe("HighlightService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateId.mockReset();
    mockFindExec.mockReset();
    mockFindOneExec.mockReset();
    mockInsert.mockReset();
    mockPatch.mockReset();
    mockRemove.mockReset();
  });

  it("adds a highlight", async () => {
    mockGenerateId.mockReturnValue("hl-1");
    mockInsert.mockResolvedValue({});
    mockFindOneExec.mockResolvedValue(null);

    const result = await highlightService.addHighlight(
      "bm1",
      "selected text",
      "#ff0",
      "my note",
    );

    expect(result).toEqual({
      id: "hl-1",
      bookmarkId: "bm1",
      text: "selected text",
      color: "#ff0",
      note: "my note",
      createdAt: expect.any(String),
    });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "hl-1",
        bookmarkId: "bm1",
        text: "selected text",
      }),
    );
  });

  it("adds a highlight with default color and note", async () => {
    mockGenerateId.mockReturnValue("hl-2");
    mockInsert.mockResolvedValue({});

    const result = await highlightService.addHighlight("bm1", "text");

    expect(result?.color).toBe("#fef08a");
    expect(result?.note).toBe("");
  });

  it("returns null when insert fails", async () => {
    mockGenerateId.mockReturnValue("hl-3");
    mockInsert.mockRejectedValue(new Error("DB error"));
    mockFindOneExec.mockResolvedValue(null);

    const result = await highlightService.addHighlight("bm1", "text");
    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it("gets highlights by bookmarkId", async () => {
    const mockDocs = [
      {
        toJSON: () => ({
          id: "hl-1",
          bookmarkId: "bm1",
          text: "hello",
          color: "#ff0",
          note: "",
          createdAt: "2024-01-01",
        }),
      },
      {
        toJSON: () => ({
          id: "hl-2",
          bookmarkId: "bm1",
          text: "world",
          color: "#0ff",
          note: "note",
          createdAt: "2024-01-02",
        }),
      },
    ];
    mockFindExec.mockResolvedValue(mockDocs);

    const result = await highlightService.getHighlights("bm1");

    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe("hello");
    expect(result[1]!.text).toBe("world");
  });

  it("returns empty array when getHighlights fails", async () => {
    mockFindExec.mockRejectedValue(new Error("DB error"));
    const result = await highlightService.getHighlights("bm1");
    expect(result).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("removes a highlight by id", async () => {
    const mockDoc = { remove: mockRemove };
    mockFindOneExec.mockResolvedValue(mockDoc);

    await highlightService.removeHighlight("hl-1");

    expect(mockFindOneExec).toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalled();
  });

  it("handles remove when highlight not found", async () => {
    mockFindOneExec.mockResolvedValue(null);

    await highlightService.removeHighlight("nonexistent");

    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("handles remove error", async () => {
    mockFindOneExec.mockRejectedValue(new Error("DB error"));

    await highlightService.removeHighlight("hl-1");

    expect(logger.error).toHaveBeenCalled();
  });

  it("updates highlight note", async () => {
    const mockDoc = { incrementalPatch: mockPatch };
    mockFindOneExec.mockResolvedValue(mockDoc);

    await highlightService.updateNote("hl-1", "new note");

    expect(mockPatch).toHaveBeenCalledWith({ note: "new note" });
  });

  it("handles updateNote when highlight not found", async () => {
    mockFindOneExec.mockResolvedValue(null);

    await highlightService.updateNote("hl-1", "new note");

    expect(mockPatch).not.toHaveBeenCalled();
  });
});
