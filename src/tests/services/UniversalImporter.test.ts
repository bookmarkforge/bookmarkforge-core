/**
 * Tests for UniversalImporter
 * Mocks RxDatabase and logger
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import JSZip from "jszip";
import { attachmentStore } from "../../services/documentAttachments";
import { createStreamingCsvFile } from "../helpers/csvFixtures";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../services/SanitizationService", () => ({
  SanitizationService: {
    sanitizeHtml: vi.fn((s: string) => s.replace(/<[^>]*>/g, "")),
  },
  sanitizeUrl: vi.fn((s: string) => s),
  sanitizeUserInput: vi.fn((s: string, maxLen?: number) => {
    const cleaned = s.replace(/<[^>]*>/g, "");
    return maxLen ? cleaned.slice(0, maxLen) : cleaned;
  }),
  validateAndSanitizeUrl: vi.fn((s: string) => s),
  sanitizeTags: vi.fn((tags: unknown) => {
    if (!Array.isArray(tags)) {return [];}
    return tags
      .map((t) => String(t).replace(/^#+/, "").trim().toLowerCase())
      .filter((t) => t.length > 0 && t.length <= 50)
      .filter((t, i, self) => self.indexOf(t) === i);
  }),
}));

// UniversalImporter now depends on AttachmentStore for markdown imports;
// keep the unit suite free of the rxdb/SecureStorage module chain it pulls in.
vi.mock("../../services/documentAttachments", () => ({
  attachmentStore: {
    persistFile: vi.fn().mockResolvedValue("att-mock"),
  },
}));

import {
  UniversalImporter,
  universalImporter,
} from "../../services/UniversalImporter";
import { LicenseError } from "../../services/LicenseService";

describe("UniversalImporter", () => {
  let importer: UniversalImporter;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    importer = new UniversalImporter();

    mockDb = {
      bookmarks: {
        findOne: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue(null),
        })),
        insert: vi.fn().mockResolvedValue({}),
      },
      documents: {
        insert: vi.fn().mockResolvedValue({}),
        findOne: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue(null),
        })),
      },
      folders: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([]),
        })),
        findOne: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue(null),
        })),
        insert: vi.fn().mockResolvedValue({}),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("free-tier limit handling", () => {
    it.each([
      [
        "Pocket HTML",
        async () =>
          new File(
            [
              '<a href="https://one.example">One</a><a href="https://two.example">Two</a><a href="https://three.example">Three</a>',
            ],
            "pocket.html",
          ),
      ],
      [
        "Raindrop CSV",
        async () =>
          new File(
            [
              "title,url\nOne,https://one.example\nTwo,https://two.example\nThree,https://three.example",
            ],
            "raindrop.csv",
          ),
      ],
      [
        "generic CSV",
        async () =>
          new File(
            [
              "title,url\nOne,https://one.example\nTwo,https://two.example\nThree,https://three.example",
            ],
            "bookmarks.csv",
          ),
      ],
      [
        "Omnivore JSON",
        async () =>
          new File(
            [
              JSON.stringify({
                data: {
                  articles: [
                    { title: "One", url: "https://one.example" },
                    { title: "Two", url: "https://two.example" },
                    { title: "Three", url: "https://three.example" },
                  ],
                },
              }),
            ],
            "omnivore.json",
          ),
      ],
      [
        "BookmarkForge JSON",
        async () =>
          new File(
            [
              JSON.stringify({
                bookmarks: [
                  { title: "One", url: "https://one.example" },
                  { title: "Two", url: "https://two.example" },
                  { title: "Three", url: "https://three.example" },
                ],
              }),
            ],
            "export.json",
          ),
      ],
      [
        "Markdown ZIP",
        async () => {
          const zip = new JSZip();
          zip.file("one.md", "# One\n\nFirst note");
          zip.file("two.md", "# Two\n\nSecond note");
          zip.file("three.md", "# Three\n\nThird note");
          return new File([await zip.generateAsync({ type: "arraybuffer" })], "vault.zip");
        },
      ],
    ])("stops cleanly for %s with a partial limit result", async (_label, makeFile) => {
      const limitError = new LicenseError(
        "Free plan limit reached",
        "FREE_LIMIT_REACHED",
      );
      const insert =
        mockDb.bookmarks.insert.mockResolvedValueOnce({}).mockRejectedValue(limitError);
      mockDb.documents.insert
        .mockResolvedValueOnce({})
        .mockRejectedValue(limitError);

      const file = await (makeFile as () => Promise<File>)();
      const result =
        _label === "Omnivore JSON"
          ? await importer.importDataWithDetection(mockDb, file)
          : await importer.importData(mockDb, file);

      expect(result).toMatchObject({
        success: true,
        importedCount: 1,
        skippedCount: 0,
        limitReached: true,
      });
      expect(result.error).toContain("Imported 1; Free limit reached");
      expect(insert.mock.calls.length + mockDb.documents.insert.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  describe("importData", () => {
    it("should import a JSON file with bookmarks and documents", async () => {
      const file = new File(
        [
          JSON.stringify({
            bookmarks: [
              { url: "https://example.com", title: "Test", tags: ["tag1"] },
            ],
            documents: [
              { title: "Doc 1", content: "# Hello", tags: ["doc-tag"] },
            ],
          }),
        ],
        "export.json",
        { type: "application/json" },
      );

      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(2);
      expect(result.skippedCount).toBe(0);
      expect(mockDb.bookmarks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          processed: false,
          isPrivate: false,
          isDeleted: false,
          relatedLinks: [],
          visitCount: 0,
        }),
      );
    });

    it("should import a CSV file with URLs", async () => {
      const file = createStreamingCsvFile([
        "Title,URL\nTest Site,https://testsite.com\n,https://another.com",
      ]);

      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(2);
    });

    it("should skip bookmarks duplicated by URL", async () => {
      mockDb.bookmarks.findOne.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: "existing" }),
      });

      const file = new File(
        [
          JSON.stringify({
            bookmarks: [{ url: "https://example.com", title: "Existing" }],
          }),
        ],
        "export.json",
        { type: "application/json" },
      );

      const result = await importer.importData(mockDb, file);
      expect(result.importedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
    });

    it("should reject an unsupported format", async () => {
      const file = new File(["data"], "data.txt", { type: "text/plain" });
      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported file format");
    });

    it("should reject JSON without a recognizable structure", async () => {
      const file = new File([JSON.stringify({ random: "data" })], "data.json", {
        type: "application/json",
      });

      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(false);
      expect(result.error).toContain("JSON format not recognized");
    });

    it("should handle a file-read error", async () => {
      const badFile = {
        name: "test.json",
        text: vi.fn().mockRejectedValue(new Error("File read error")),
      } as any;

      const result = await importer.importData(mockDb, badFile);
      expect(result.success).toBe(false);
    });

    it("should import a bookmark without a title using the default value", async () => {
      const file = new File(
        [JSON.stringify({ bookmarks: [{ url: "https://example.com" }] })],
        "export.json",
        { type: "application/json" },
      );

      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(true);
      expect(mockDb.bookmarks.insert).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Untitled Bookmark" }),
      );
    });

    it("includes urlHash in JSON-imported bookmarks (schema required field)", async () => {
      // Regression: the JSON importer computed urlHash for the dedup query
      // but omitted it from the inserted document, so every bookmark failed
      // the RxDB schema (urlHash is required) and was silently skipped.
      const file = new File(
        [
          JSON.stringify({
            bookmarks: [{ url: "https://example.com", title: "T" }],
          }),
        ],
        "export.json",
        { type: "application/json" },
      );

      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(1);
      const inserted = mockDb.bookmarks.insert.mock.calls[0][0];
      expect(typeof inserted.urlHash).toBe("string");
      expect(inserted.urlHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should import a bookmark with Notion-format fields", async () => {
      const file = new File(
        [
          JSON.stringify({
            bookmarks: [
              {
                url: "https://n.com",
                description: "desc",
                created_time: "2024-01-01",
                last_edited_time: "2024-01-02",
              },
            ],
          }),
        ],
        "notion.json",
        { type: "application/json" },
      );

      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(true);
      expect(mockDb.bookmarks.insert).toHaveBeenCalledWith(
        expect.objectContaining({ summary: "desc" }),
      );
    });

    it("preserves bookmark summary from a BMF self-export (summary field)", async () => {
      // Regression: the JSON importer only read `description` (legacy
      // Notion), so a JSON export → import round-trip silently dropped every
      // bookmark summary the exporter writes under `summary`.
      const file = new File(
        [
          JSON.stringify({
            version: "1.0",
            data: {
              bookmarks: [
                {
                  url: "https://example.com",
                  title: "T",
                  summary: "AI summary text",
                  content: "body content",
                  tags: [],
                },
              ],
              documents: [],
              folders: [],
            },
            metadata: {},
          }),
        ],
        "export.json",
        { type: "application/json" },
      );

      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(1);
      expect(mockDb.bookmarks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: "AI summary text",
          content: "body content",
        }),
      );
    });

    it("preserves document summary from a BMF self-export", async () => {
      // Regression: the JSON importer never read `summary` for documents, so
      // AI-generated document summaries were lost on a round-trip.
      const file = new File(
        [
          JSON.stringify({
            version: "1.0",
            data: {
              bookmarks: [],
              documents: [
                {
                  id: "doc-1",
                  title: "Doc",
                  folderId: "root",
                  textContent: "body",
                  summary: "doc summary",
                  tags: [],
                },
              ],
              folders: [],
            },
            metadata: {},
          }),
        ],
        "export.json",
        { type: "application/json" },
      );

      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(1);
      expect(mockDb.documents.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: "doc summary",
          textContent: "body",
        }),
      );
    });

    it("should handle an individual insert error", async () => {
      mockDb.bookmarks.insert.mockRejectedValueOnce(new Error("Insert failed"));

      const file = new File(
        [
          JSON.stringify({
            bookmarks: [{ url: "https://e.com", title: "Test" }],
          }),
        ],
        "export.json",
        { type: "application/json" },
      );

      const result = await importer.importData(mockDb, file);
      expect(result.importedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
    });

    it("should skip empty lines in CSV", async () => {
      const file = new File(
        ["Title,URL\nFirst,https://first.com\n\n,https://second.com\n"],
        "data.csv",
        { type: "text/csv" },
      );

      const result = await importer.importData(mockDb, file);
      expect(result.importedCount).toBe(2);
    });

    it("should ignore non-http URLs in CSV", async () => {
      const file = new File(["Title,URL\nInvalid,ftp://bad.com"], "data.csv", {
        type: "text/csv",
      });

      const result = await importer.importData(mockDb, file);
      expect(result.importedCount).toBe(0);
    });

    it("sanitizes malicious content in JSON import", async () => {
      const file = new File(
        [
          JSON.stringify({
            bookmarks: [
              {
                url: "https://example.com",
                title: "<img src=x onerror=alert(1)>",
                content: "<script>evil()</script>",
                tags: ["t"],
              },
            ],
          }),
        ],
        "export.json",
        { type: "application/json" },
      );

      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(true);
      const inserted = mockDb.bookmarks.insert.mock.calls[0][0];
      expect(inserted.title).not.toContain("<img");
      expect(inserted.content).not.toContain("<script>");
    });
  });

  describe("safeParseJSON", () => {
    it("should strip __proto__ keys", () => {
      const malicious = '{"__proto__":{"admin":true},"url":"https://e.com"}';
      const result = (importer as any).constructor.safeParseJSON(malicious);
      expect(Object.keys(result)).not.toContain("__proto__");
      expect(result.url).toBe("https://e.com");
    });

    it("should handle null JSON", () => {
      const result = (importer as any).constructor.safeParseJSON("null");
      expect(result).toBeNull();
    });

    it("should handle array JSON", () => {
      const result = (importer as any).constructor.safeParseJSON("[1,2,3]");
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle non-plain-object prototypes", () => {
      const result = (importer as any).constructor.safeParseJSON(
        JSON.stringify(new Date()),
      );
      expect(result).toBeDefined();
    });
  });

  describe("Pocket preview detection", () => {
    it("detects ril_export.html by Pocket shape and previews links, dates, and tags", async () => {
      const file = new File(
        ["<H3>Unread</H3><DL><p><DT><A HREF=\"https://one.example\" ADD_DATE=\"1700000000\" TAGS=\"work,read\">One</A></DL>"],
        "ril_export.html",
        { type: "text/html" },
      );
      await expect(UniversalImporter.previewPocketFile(file)).resolves.toMatchObject({
        source: "pocket",
        linkCount: 1,
        datedCount: 1,
        uniqueTagCount: 2,
        unreadCount: 1,
      });
    });

    it("detects Pocket CSV by headers and previews dates and tags", async () => {
      const file = new File(
        ["title,url,status,time_added,tags\nOne,https://one.example,Unread,1700000000,work|read"],
        "pocket-export.csv",
        { type: "text/csv" },
      );
      await expect(UniversalImporter.previewPocketFile(file)).resolves.toMatchObject({
        source: "pocket",
        linkCount: 1,
        datedCount: 1,
        uniqueTagCount: 2,
        unreadCount: 1,
      });
    });
  });

  describe("importFromPocketHTML", () => {
    it("should import bookmarks from a Pocket HTML export", async () => {
      const html =
        '<DT><A HREF="https://example.com" ADD_DATE="1234567890" TAGS="tag1,tag2">Test Title</A>';
      const file = new File([html], "bookmarks.html", {
        type: "text/html",
      });
      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(true);
      expect(mockDb.bookmarks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com",
          title: "Test Title",
          tags: expect.arrayContaining(["tag1", "tag2"]),
        }),
      );
    });

    it("maps Pocket Unread, Read, and Archive sections without deleting archived items", async () => {
      const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
        <H3>Unread</H3><DL><p><DT><A HREF="https://unread.example">Unread</A></DL>
        <H3>Read</H3><DL><p><DT><A HREF="https://read.example">Read</A></DL>
        <H3>Archive</H3><DL><p><DT><A HREF="https://archive.example">Archive</A></DL>`;
      const file = new File([html], "pocket.html", { type: "text/html" });
      await importer.importData(mockDb, file);

      expect(mockDb.bookmarks.insert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ isRead: false }),
      );
      expect(mockDb.bookmarks.insert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ isRead: true }),
      );
      expect(mockDb.bookmarks.insert).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          isRead: true,
          tags: expect.arrayContaining(["pocket-archive"]),
          isDeleted: false,
        }),
      );
    });

    it("should skip non-http URLs in Pocket HTML", async () => {
      const html =
        '<DT><A HREF="ftp://bad.com" ADD_DATE="0" TAGS="">Bad</A>';
      const file = new File([html], "bookmarks.html", {
        type: "text/html",
      });
      const result = await importer.importData(mockDb, file);
      expect(result.importedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
    });

    it("should handle Pocket HTML without links", async () => {
      const html = "<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p></DL>";
      const file = new File([html], "empty.html", { type: "text/html" });
      const result = await importer.importData(mockDb, file);
      expect(result.importedCount).toBe(0);
      expect(result.skippedCount).toBe(0);
    });

    it("should assign the pocket-import tag when there are no tags", async () => {
      const html =
        '<DT><A HREF="https://example.com" ADD_DATE="0" TAGS="">No Tags</A>';
      const file = new File([html], "bk.html", { type: "text/html" });
      await importer.importData(mockDb, file);
      expect(mockDb.bookmarks.insert).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ["pocket-import"] }),
      );
    });

    it("should skip duplicate bookmarks in Pocket HTML", async () => {
      mockDb.bookmarks.findOne.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: "existing" }),
      });
      const html =
        '<DT><A HREF="https://example.com" ADD_DATE="0" TAGS="">Dup</A>';
      const file = new File([html], "bk.html", { type: "text/html" });
      const result = await importer.importData(mockDb, file);
      expect(result.importedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
    });
  });

  describe("importFromRaindropCSV", () => {
    it("should import from Raindrop CSV", async () => {
      const csv =
        "title,url,tags,domain,created\nTest,https://test.com,tag1|tag2,test.com,2024-01-01";
      const file = new File([csv], "raindrop.csv", { type: "text/csv" });
      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(true);
    });

    it("maps Pocket-style status columns in CSV without treating Archive as deletion", async () => {
      const csv =
        "title,url,status\nUnread,https://unread.example,Unread\nRead,https://read.example,Read\nArchive,https://archive.example,Archive";
      const file = new File([csv], "pocket.csv", { type: "text/csv" });
      await importer.importData(mockDb, file);

      expect(mockDb.bookmarks.insert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ isRead: false }),
      );
      expect(mockDb.bookmarks.insert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ isRead: true }),
      );
      expect(mockDb.bookmarks.insert).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          isRead: true,
          tags: expect.arrayContaining(["pocket-archive"]),
          isDeleted: false,
        }),
      );
    });

    it("should detect Raindrop by file name", async () => {
      const csv =
        "title,url,tags,domain,created\nTest,https://test.com,a,test.com,2024-01-01";
      const file = new File([csv], "raindrop_export.csv", {
        type: "text/csv",
      });
      const result = await importer.importDataWithDetection(mockDb, file);
      expect(result.success).toBe(true);
    });

    it("should handle malformed CSV in Raindrop", async () => {
      const csv = "title,url\nOnlyTitle";
      const file = new File([csv], "raindrop.csv", { type: "text/csv" });
      const result = await importer.importData(mockDb, file);
      expect(result.importedCount).toBe(0);
    });
  });

  describe("importFromOmnivoreJSON", () => {
    it("should import from Omnivore JSON", async () => {
      const data = {
        data: {
          articles: [
            { id: "1", title: "Article", url: "https://art.com", labels: [{ name: "dev" }], savedAt: "2024-01-01" },
          ],
        },
      };
      const file = new File([JSON.stringify(data)], "omnivore_data.json", {
        type: "application/json",
      });
      const result = await importer.importDataWithDetection(mockDb, file);
      expect(result.success).toBe(true);
    });

    it("should detect Omnivore by content", async () => {
      const data = { "savedAt": "2024-01-01", data: { articles: [] } };
      const file = new File([JSON.stringify(data)], "export.json", {
        type: "application/json",
      });
      const result = await importer.importDataWithDetection(mockDb, file);
      expect(result.success).toBe(true);
    });

    it("should handle Omnivore JSON without articles", async () => {
      const data = { "savedAt": "2024-01-01", data: { articles: [] } };
      const file = new File([JSON.stringify(data)], "omnivore_export.json", {
        type: "application/json",
      });
      const result = await importer.importDataWithDetection(mockDb, file);
      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(0);
    });

    it("should handle invalid Omnivore JSON", async () => {
      const file = new File(["not json"], "omnivore.json", {
        type: "application/json",
      });
      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(false);
      expect(result.importedCount).toBe(0);
    });
  });

  describe("importDataWithDetection", () => {
    it("should detect Pocket HTML by the NETSCAPE header", async () => {
      const html = "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p></DL>";
      const file = new File([html], "export.html", { type: "text/html" });
      const result = await importer.importDataWithDetection(mockDb, file);
      expect(result.success).toBe(true);
    });

    it("should detect Raindrop by filename", async () => {
      const csv = "title,url\nTest,https://test.com";
      const file = new File([csv], "raindrop_export.csv", {
        type: "text/csv",
      });
      const result = await importer.importDataWithDetection(mockDb, file);
      expect(result.success).toBe(true);
    });

    it("should detect Omnivore by filename", async () => {
      const data = JSON.stringify({ data: { articles: [] } });
      const file = new File([data], "omnivore_export.json", {
        type: "application/json",
      });
      const result = await importer.importDataWithDetection(mockDb, file);
      expect(result.success).toBe(true);
    });

    it("should reject detection before reading an oversized file", async () => {
      const file = {
        name: "large.json",
        size: 50 * 1024 * 1024 + 1,
        text: vi.fn().mockResolvedValue("{}"),
      } as unknown as File;
      const result = await importer.importDataWithDetection(mockDb, file);
      expect(result.success).toBe(false);
      expect(file.text).not.toHaveBeenCalled();
    });

    it("should fall back to importData when there is no detection", async () => {
      const data = JSON.stringify({ bookmarks: [] });
      const file = new File([data], "unknown.json", {
        type: "application/json",
      });
      const result = await importer.importDataWithDetection(mockDb, file);
      expect(result.success).toBe(true);
    });
  });

  describe("document import in JSON", () => {
    it("should import documents from JSON", async () => {
      const file = new File(
        [
          JSON.stringify({
            documents: [
              {
                title: "Doc",
                content: "# Hello",
                tags: ["tag"],
                created_time: "2024-01-01",
                last_edited_time: "2024-01-02",
              },
            ],
          }),
        ],
        "export.json",
        { type: "application/json" },
      );
      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(true);
      expect(mockDb.documents.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Doc",
          textContent: "# Hello",
          tags: ["tag"],
        }),
      );
    });

    it("should handle a document insert error", async () => {
      mockDb.documents.insert.mockRejectedValueOnce(
        new Error("Insert failed"),
      );
      const file = new File(
        [
          JSON.stringify({
            documents: [{ title: "Doc", content: "content" }],
          }),
        ],
        "export.json",
        { type: "application/json" },
      );
      const result = await importer.importData(mockDb, file);
      expect(result.importedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
    });

    it("rejects a ZIP with too many entries before reading note contents", async () => {
      const zip = new JSZip();
      for (let index = 0; index < 10_001; index++) {
        zip.file(`notes/${index}.md`, "# note");
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const file = new File([blob], "large-vault.zip", { type: "application/zip" });

      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(false);
      expect(result.error).toContain("too many entries");
      expect(mockDb.documents.insert).not.toHaveBeenCalled();
    });

    it("rejects a DEFLATE-compressed entry whose uncompressed size exceeds the per-entry limit", async () => {
      // DEFLATE compresses a repeated seed very well: the compressed ZIP is
      // tiny (well under 50 MB), but the uncompressed content exceeds
      // MAX_ZIP_ENTRY_BYTES (50 MB). JSZip's preflight _data.uncompressedSize
      // check catches this before decompression.
      const seed = "abcdefghij";
      const bigNote = seed.repeat(Math.ceil(51 * 1024 * 1024 / seed.length));
      const zip = new JSZip();
      zip.file("bomb.md", bigNote);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const file = new File([blob], "bomb.zip", { type: "application/zip" });

      const result = await importer.importData(mockDb, file);

      expect(result.success).toBe(false);
      expect(result.error).toContain("safety size limit");
      expect(mockDb.documents.insert).not.toHaveBeenCalled();
      expect(mockDb.bookmarks.insert).not.toHaveBeenCalled();
    });

    it("passes the preflight check when uncompressed size metadata is present and within limits", async () => {
      // Verify the normal (non-bomb) path still works
      const zip = new JSZip();
      zip.file("note.md", "# Small note\nHello world.");
      const blob = await zip.generateAsync({ type: "blob" });
      const file = new File([blob], "safe.zip", { type: "application/zip" });

      const result = await importer.importData(mockDb, file);
      expect(result.success).toBe(true);
    });

    it("skips SVG attachments from a markdown zip", async () => {
      const zip = new JSZip();
      const png = new TextEncoder().encode("PNGDATA");
      const evilSvg = new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );
      zip.file("note.md",
        `---\ntitle: "Note"\nfolder: ""\n---\n\n![png](attachments/img.png)\n\n![svg](attachments/pwn.svg)\n`,
      );
      zip.file("attachments/img.png", png);
      zip.file("attachments/pwn.svg", evilSvg);
      const blob = await zip.generateAsync({ type: "blob" });
      const file = new File([blob], "vault.zip", { type: "application/zip" });

      const persistFileMock = vi.mocked(attachmentStore).persistFile;
      const result = await importer.importData(mockDb, file);
      expect(result.importedCount).toBe(1);
      // The PNG ref is persisted; the SVG ref is left verbatim (never persisted).
      expect(persistFileMock).toHaveBeenCalledTimes(1);
      const inserted = mockDb.documents.insert.mock.calls[0]![0] as {
        textContent?: string;
      };
      expect(inserted.textContent).toContain("bmf-attachment://att-mock");
      expect(inserted.textContent).toContain("attachments/pwn.svg");
    });
  });
});
