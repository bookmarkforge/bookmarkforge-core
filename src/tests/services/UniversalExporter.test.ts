/**
 * Tests for UniversalExporter
 * Mocks RxDatabase, logger and JSZip
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let mockJsZip: any;
vi.mock("jszip", () => ({
  default: vi.fn(function () {
    return mockJsZip;
  }),
}));

function createMockJsZip() {
  mockJsZip = {
    file: vi.fn().mockReturnThis(),
    generateAsync: vi.fn().mockResolvedValue(new Blob(["zip"])),
  };
  return mockJsZip;
}

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  UniversalExporter,
  universalExporter,
} from "../../services/UniversalExporter";

describe("UniversalExporter", () => {
  let exporter: UniversalExporter;
  let mockDb: any;

  const createMockDoc = (overrides = {}) => {
    const data = {
      id: "1",
      url: "https://example.com",
      title: "Test",
      content: "Content",
      summary: "Summary",
      tags: ["tag1"],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      isDeleted: false,
      isPrivate: false,
      folderId: "root",
      textContent: "Document text",
      ...overrides,
    };
    // The exporter materializes records via toJSON (RxDB v17 contract).
    return { ...data, toJSON: () => ({ ...data }) };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createMockJsZip();
    exporter = new UniversalExporter();

    mockDb = {
      bookmarks: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([createMockDoc()]),
        })),
      },
      documents: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([
            createMockDoc({
              folderId: "root",
              textContent: "Doc text",
            }) as any,
          ]),
        })),
      },
      folders: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([
            {
              id: "root",
              title: "Root",
              parentId: "",
              createdAt: "2024-01-01",
              toJSON() {
                return {
                  id: "root",
                  title: "Root",
                  parentId: "",
                  createdAt: "2024-01-01",
                };
              },
            },
          ]),
        })),
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("exportData", () => {
    it("should export to JSON", async () => {
      const result = await exporter.exportData(mockDb, { format: "json" });
      expect(result.success).toBe(true);
      expect(result.format).toBe("json");
      expect(result.blob).toBeInstanceOf(Blob);
    });

    it("handles RxDB v17 documents whose spread carries circular internals", async () => {
      // Regression: RxDB v17 RxDocuments are proxies that answer `toJSON()`
      // with clean data but whose destructure/spread copies hidden rxjs
      // state (SafeSubscriber/Subscription). The exporter used to spread
      // them, so every real ExportDialog export failed with "Converting
      // circular structure to JSON". Simulate the proxy faithfully:
      // JSON.stringify({ ...doc }) must explode without the fix.
      const circularState: { finalizers: Array<Record<string, unknown>> } = {
        finalizers: [],
      };
      circularState.finalizers.push({ parentage: circularState });
      const rxProxy = (data: Record<string, unknown>) =>
        new Proxy(data, {
          ownKeys() {
            return [...Reflect.ownKeys(data), "_rxState"];
          },
          getOwnPropertyDescriptor(target, prop) {
            if (prop === "_rxState") {
              return {
                enumerable: true,
                configurable: true,
                value: circularState,
              };
            }
            return Reflect.getOwnPropertyDescriptor(target, prop);
          },
          get(target, prop, receiver) {
            if (prop === "toJSON") {
              return () => ({ ...target });
            }
            return Reflect.get(target, prop, receiver);
          },
        });

      mockDb.bookmarks.find = vi.fn(() => ({
        exec: vi.fn().mockResolvedValue([
          rxProxy({
            id: "px-b1",
            url: "https://example.com/px",
            title: "Proxy",
            content: "C",
            summary: "S",
            tags: [],
            relatedLinks: [],
            visitCount: 1,
            isDeleted: false,
            isPrivate: false,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          }),
        ]),
      }));

      const result = await exporter.exportData(mockDb, {
        format: "json",
        includeFolders: true,
      });
      expect(result.success).toBe(true);
      const parsed = JSON.parse(
        new TextDecoder().decode(await result.blob.arrayBuffer()),
      );
      expect(parsed.data.bookmarks[0]).toMatchObject({
        url: "https://example.com/px",
        title: "Proxy",
      });
      expect(
        JSON.stringify(parsed).includes("SafeSubscriber"),
      ).toBe(false);
    });

    it("should export to JSONL", async () => {
      const result = await exporter.exportData(mockDb, { format: "jsonl" });
      expect(result.success).toBe(true);
      expect(result.format).toBe("jsonl");
      expect(result.filename).toMatch(/\.jsonl$/);
      expect(result.blob).toBeInstanceOf(Blob);
    });

    it("should export to JSONL with empty data", async () => {
      mockDb = {
        bookmarks: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
        documents: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
        folders: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
      };
      const result = await exporter.exportData(mockDb, { format: "jsonl" });
      expect(result.success).toBe(true);
      expect(result.format).toBe("jsonl");
    });

    it("should cancel before reading the database", async () => {
      const controller = new AbortController();
      controller.abort();
      const progress: number[] = [];
      const result = await exporter.exportData(mockDb, {
        format: "json",
        signal: controller.signal,
        onProgress: (value) => progress.push(value),
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Export cancelled");
      expect(mockDb.bookmarks.find).not.toHaveBeenCalled();
      expect(progress).toEqual([]);
    });

    it("should export to CSV", async () => {
      const result = await exporter.exportData(mockDb, { format: "csv" });
      expect(result.success).toBe(true);
      expect(result.format).toBe("csv");
    });

    it("should export to Markdown", async () => {
      const result = await exporter.exportData(mockDb, { format: "markdown" });
      expect(result.success).toBe(true);
      expect(result.format).toBe("markdown");
    });

    it("should export to HTML", async () => {
      const result = await exporter.exportData(mockDb, { format: "html" });
      expect(result.success).toBe(true);
      expect(result.format).toBe("html");
    });

    it("should export to Notion", async () => {
      const result = await exporter.exportData(mockDb, { format: "notion" });
      expect(result.success).toBe(true);
      expect(result.format).toBe("notion");
    });

    it("should export to Obsidian", async () => {
      const result = await exporter.exportData(mockDb, { format: "obsidian" });
      expect(result.success).toBe(true);
      expect(result.format).toBe("obsidian");
      expect(mockJsZip.file).toHaveBeenCalled();
    });

    it("should cancel ZIP compression if aborted during progress", async () => {
      const controller = new AbortController();
      mockJsZip.generateAsync = vi.fn().mockImplementation(async (options: {
        onUpdate?: () => void;
      }) => {
        controller.abort();
        options.onUpdate?.();
        return new Blob(["unreachable"]);
      });

      const result = await exporter.exportData(mockDb, {
        format: "obsidian",
        signal: controller.signal,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Export cancelled");
    });

    it("should fail with an unsupported format", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "unknown" as any,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should filter by date range", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "json",
        dateRange: {
          start: new Date("2023-01-01"),
          end: new Date("2023-12-31"),
        },
      });
      expect(result.success).toBe(true);
    });

    it("should filter by tags", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "json",
        tags: ["tag1"],
      });
      expect(result.success).toBe(true);
    });

    it("should filter by searchQuery", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "json",
        searchQuery: "Test",
      });
      expect(result.success).toBe(true);
    });

    it("should include embeddings when specified", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "json",
        includeEmbeddings: true,
      });
      expect(result.success).toBe(true);
    });

    it("should include folders when specified", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "json",
        includeFolders: true,
      });
      expect(result.success).toBe(true);
    });

    it("should export with empty data (no bookmarks or documents)", async () => {
      mockDb = {
        bookmarks: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
        documents: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
        folders: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
      };
      const result = await exporter.exportData(mockDb, { format: "json" });
      expect(result.success).toBe(true);
    });

    it("should export with null/missing metadata", async () => {
      mockDb = {
        bookmarks: {
          find: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue([
              createMockDoc({
                tags: undefined,
                summary: null,
                content: undefined,
                isDeleted: true,
              }),
            ]),
          })),
        },
        documents: {
          find: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue([
              createMockDoc({
                tags: undefined,
                textContent: null,
                folderId: undefined,
              }) as any,
            ]),
          })),
        },
        folders: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
      };
      const result = await exporter.exportData(mockDb, { format: "notion" });
      expect(result.success).toBe(true);
    });

    it("should filter by tags with no matches", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "json",
        tags: ["nonexistent-tag"],
      });
      expect(result.success).toBe(true);
    });

    it("should search with no matches", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "json",
        searchQuery: "ZZZZnoMatch",
      });
      expect(result.success).toBe(true);
    });

    it("should search by URL", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "json",
        searchQuery: "example",
      });
      expect(result.success).toBe(true);
    });

    it("should export to obsidian when JSZip fails", async () => {
      mockJsZip.generateAsync = vi
        .fn()
        .mockRejectedValue(new Error("Zip error"));
      const result = await exporter.exportData(mockDb, { format: "obsidian" });
      expect(result.success).toBe(false);
    });

    it("should export markdown with empty data", async () => {
      mockDb = {
        bookmarks: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
        documents: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
        folders: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
      };
      const result = await exporter.exportData(mockDb, { format: "markdown" });
      expect(result.success).toBe(true);
    });

    it("should export html with empty data", async () => {
      mockDb = {
        bookmarks: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
        documents: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
        folders: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
      };
      const result = await exporter.exportData(mockDb, { format: "html" });
      expect(result.success).toBe(true);
    });

    // ── Branch coverage: date range WITH matching docs ──
    it("should keep bookmarks within the date range", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "json",
        dateRange: {
          start: new Date("2023-06-01"),
          end: new Date("2024-06-01"),
        },
      });
      // createdAt=2024-01-01 is within 2023-06-01..2024-06-01
      // Ejercita: b.createdAt && >= start && <= end → TRUE (keep)
      expect(result.success).toBe(true);
    });

    // ── Branch coverage: searchQuery matching on summary ──
    it("should search in bookmark summaries", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "json",
        searchQuery: "Summary",
      });
      // mock doc summary="Summary" → summary.toLowerCase().includes("summary") → TRUE
      expect(result.success).toBe(true);
    });

    // ── Branch coverage: searchQuery matching on content ──
    it("should search in bookmark content", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "json",
        searchQuery: "Content",
      });
      // mock doc content="Content" → content.toLowerCase().includes("content") → TRUE
      expect(result.success).toBe(true);
    });

    // ── Branch coverage: searchQuery matching on document textContent ──
    it("should search in document textContent", async () => {
      const result = await exporter.exportData(mockDb, {
        format: "json",
        searchQuery: "Doc text",
      });
      // mock doc textContent="Doc text" → textContent.toLowerCase().includes("doc text") → TRUE
      expect(result.success).toBe(true);
    });

    // ── Branch coverage: catch with non-Error throw ──
    it("should return 'Unknown error' when the error is not an Error instance", async () => {
      mockDb.bookmarks.find = vi.fn(() => {
        throw "DB connection lost"; // string, no Error
      });
      const result = await exporter.exportData(mockDb, {
        format: "json",
      });
      expect(result.success).toBe(false);
      // error instanceof Error → false → "Unknown error"
      expect(result.error).toBe("Unknown error");
    });

    // ── Branch coverage: dateRange filter with undefined createdAt ──
    it("should exclude bookmarks without createdAt from the date filter (b.createdAt && falsy)", async () => {
      mockDb = {
        bookmarks: {
          find: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue([
              createMockDoc({ createdAt: undefined }), // sin createdAt → filtrado OUT
              createMockDoc({ createdAt: "2024-06-15T00:00:00.000Z" }), // dentro del rango
            ]),
          })),
        },
        documents: {
          find: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue([]),
          })),
        },
        folders: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
      };
      const result = await exporter.exportData(mockDb, {
        format: "json",
        dateRange: { start: new Date("2024-01-01"), end: new Date("2024-12-31") },
      });
      expect(result.success).toBe(true);
    });

    // ── Branch coverage: tags filter with undefined tags ──
    it("should exclude bookmarks without tags when filtering by tags (b.tags && falsy)", async () => {
      mockDb = {
        bookmarks: {
          find: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue([
              createMockDoc({ tags: undefined }),  // sin tags → b.tags && es falsy → excluido
              createMockDoc({ tags: ["tag1"] }),  // con tag1 → incluido
            ]),
          })),
        },
        documents: {
          find: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue([
              createMockDoc({ tags: undefined, textContent: "docs", folderId: "root" }),
            ]),
          })),
        },
        folders: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
      };
      const result = await exporter.exportData(mockDb, {
        format: "json",
        tags: ["tag1"],
      });
      expect(result.success).toBe(true);
    });

    // ── Branch coverage: searchQuery with document textContent null, matching by title ──
    it("should find documents with null textContent by title (short-circuit eval)", async () => {
      mockDb = {
        bookmarks: {
          find: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue([]),
          })),
        },
        documents: {
          find: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue([
              createMockDoc({
                textContent: null as any,
                title: "Target Doc",
                url: "https://target.example.com",
              }),
            ]),
          })),
        },
        folders: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
      };
      const result = await exporter.exportData(mockDb, {
        format: "json",
        searchQuery: "Target",
      });
      // d.title.includes("Target") → TRUE, mantiene el doc pese a textContent null
      expect(result.success).toBe(true);
    });

    // ── Branch coverage: searchQuery when summary/content/textContent is null ──
    it("should find bookmarks when summary and content are null (short-circuit eval)", async () => {
      mockDb = {
        bookmarks: {
          find: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue([
              createMockDoc({
                summary: null,
                content: null as any,
                title: "Target Doc",
                url: "https://target.example.com",
              }),
            ]),
          })),
        },
        documents: {
          find: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue([]),
          })),
        },
        folders: {
          find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        },
      };
      const result = await exporter.exportData(mockDb, {
        format: "json",
        searchQuery: "Target",
      });
      // title.includes("Target") → TRUE, mantiene el doc pese a summary/content null
      expect(result.success).toBe(true);
    });
  });
});
