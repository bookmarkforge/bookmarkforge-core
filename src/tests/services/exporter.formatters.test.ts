import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("jszip", () => {
  const mockInstance = {
    file: vi.fn().mockReturnThis(),
    generateAsync: vi
      .fn()
      .mockResolvedValue(new Blob(["mock-zip"], { type: "application/zip" })),
  };
  const JsZipMock = function () {
    return mockInstance;
  } as any;
  return { default: JsZipMock, __esModule: true, __mockInstance: mockInstance };
});

// Capture the markdown content passed to zip.file() so frontmatter tests can
// assert on the real output (the zip blob itself is mocked).
const mockJsZipInstance = (await import("jszip")) as unknown as {
  __mockInstance: {
    file: ReturnType<typeof vi.fn>;
  };
};
function capturedObsidianContent(): string {
  const calls = mockJsZipInstance.__mockInstance.file.mock.calls as Array<
    [string, string]
  >;
  return calls.map(([, content]) => content).join("");
}

vi.mock("../../utils", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mockBookmarks: any[] = [
  {
    id: "b1",
    title: "Test Page",
    url: "https://example.com",
    summary: "A test page",
    content: "",
    tags: ["dev", "test"],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
    isDeleted: false,
    description: "desc",
  },
  {
    id: "b2",
    title: "Empty Page",
    url: "https://empty.com",
    summary: "",
    content: "",
    tags: [],
    createdAt: "2024-01-03T00:00:00Z",
    updatedAt: "2024-01-03T00:00:00Z",
    isDeleted: false,
  },
];
const mockDocuments: any[] = [
  {
    id: "d1",
    title: "Doc One",
    textContent: "Hello world",
    tags: ["docs"],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
    isDeleted: false,
    folderId: "f1",
  },
  {
    id: "d2",
    title: "Empty Doc",
    textContent: "",
    tags: [],
    createdAt: "2024-01-03T00:00:00Z",
    updatedAt: "2024-01-03T00:00:00Z",
    isDeleted: false,
    folderId: "",
  },
];
const mockFolders: any[] = [
  { id: "f1", title: "Folder 1", parentId: "", createdAt: "2024-01-01T00:00:00Z" },
];
const mockData: any = {
  bookmarks: mockBookmarks,
  documents: mockDocuments,
  folders: mockFolders,
};
const mockOptions = {
  format: "json" as const,
  includeEmbeddings: false,
  includeFolders: true,
};

let mod: typeof import("../../services/exporter.formatters");

beforeEach(async () => {
  vi.clearAllMocks();
  mod = await import("../../services/exporter.formatters");
});

describe("exportToNotion", () => {
  it("returns ExportResult with notion format", () => {
    const result = mod.exportToNotion(mockData, mockOptions);
    expect(result.success).toBe(true);
    expect(result.format).toBe("notion");
    expect(result.filename).toMatch(/^bookmarkforge-notion-export-/);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.size).toBeGreaterThan(0);
  });

  it("includes bookmarks and documents in JSON output", async () => {
    const result = mod.exportToNotion(mockData, mockOptions);
    const text = await result.blob.text();
    const parsed = JSON.parse(text);
    expect(parsed.bookmarks).toHaveLength(2);
    expect(parsed.bookmarks[0].title).toBe("Test Page");
    expect(parsed.bookmarks[0].archived).toBe(false);
    expect(parsed.documents).toHaveLength(2);
    expect(parsed.documents[0].title).toBe("Doc One");
    expect(parsed.exported_by).toBe("BookmarkForge");
  });

  it("handles empty data", () => {
    const empty = { bookmarks: [], documents: [], folders: [] };
    const result = mod.exportToNotion(empty, mockOptions);
    expect(result.success).toBe(true);
    expect(result.filename).toMatch(/\.json$/);
  });
});

describe("exportToJSON", () => {
  it("returns correct JSON structure", async () => {
    const result = mod.exportToJSON(mockData, mockOptions);
    const text = await result.blob.text();
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe("1.0");
    expect(parsed.data.bookmarks).toHaveLength(2);
    expect(parsed.data.documents).toHaveLength(2);
    expect(parsed.data.folders).toHaveLength(1);
    expect(parsed.metadata.totalBookmarks).toBe(2);
    expect(parsed.metadata.includesEmbeddings).toBe(false);
  });

  it("handles empty data", () => {
    const result = mod.exportToJSON(
      { bookmarks: [], documents: [], folders: [] },
      mockOptions,
    );
    expect(result.success).toBe(true);
    expect(result.format).toBe("json");
    expect(result.size).toBeGreaterThan(0);
  });

  it("rejects an output that exceeds the size limit", () => {
    const originalBlob = globalThis.Blob;
    class OversizedBlob {
      readonly size = mod.MAX_EXPORT_TEXT_BYTES + 1;
    }
    vi.stubGlobal("Blob", OversizedBlob as unknown as typeof Blob);
    try {
      expect(() => mod.exportToJSON(mockData, mockOptions)).toThrow(
        /100 MB size limit/i,
      );
    } finally {
      vi.stubGlobal("Blob", originalBlob);
    }
  });
});

describe("exportToJSONL", () => {
  it("emits one JSON object per line with a type discriminator", async () => {
    const result = mod.exportToJSONL(mockData, mockOptions);
    expect(result.success).toBe(true);
    expect(result.format).toBe("jsonl");
    expect(result.filename).toMatch(/\.jsonl$/);

    const text = await result.blob.text();
    const lines = text.trim().split("\n");
    // 2 bookmarks + 2 documents + 1 folder
    expect(lines).toHaveLength(5);

    const records = lines.map((line) => JSON.parse(line));
    expect(records.map((r) => r.type)).toEqual([
      "bookmark",
      "bookmark",
      "document",
      "document",
      "folder",
    ]);
    expect(records[0]).toMatchObject({
      type: "bookmark",
      id: "b1",
      title: "Test Page",
      url: "https://example.com",
      tags: ["dev", "test"],
    });
    expect(records[2]).toMatchObject({
      type: "document",
      id: "d1",
      folderId: "f1",
      title: "Doc One",
      textContent: "Hello world",
    });
    expect(records[4]).toMatchObject({
      type: "folder",
      id: "f1",
      title: "Folder 1",
    });
  });

  it("fails closed when an item's privacy metadata is missing", async () => {
    const data = {
      bookmarks: [{ id: "legacy-bookmark", title: "Legacy", url: "https://example.com" }],
      documents: [{ id: "legacy-document", title: "Legacy document", textContent: "content" }],
      folders: [],
    } as any;

    const records = (await mod.exportToJSONL(data, mockOptions)).blob;
    const lines = (await records.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[0].isPrivate).toBe(true);
    expect(lines[1].isPrivate).toBe(true);
  });

  it("every line is independently parseable JSON (NDJSON invariant)", async () => {
    const result = mod.exportToJSONL(mockData, mockOptions);
    const text = await result.blob.text();
    const lines = text.trim().split("\n");
    for (const line of lines) {
      // No trailing commas, no wrapping array — each line parses standalone.
      const record = JSON.parse(line);
      expect(typeof record.type).toBe("string");
    }
  });

  it("includes embeddings only when explicitly requested", async () => {
    const data: any = {
      bookmarks: [
        {
          id: "b1",
          url: "https://example.com",
          title: "T",
          tags: [],
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          isDeleted: false,
          isPrivate: false,
          embedding: [0.1, 0.2, 0.3],
        },
      ],
      documents: [],
      folders: [],
    };

    const without = await (
      await mod.exportToJSONL(data, mockOptions)
    ).blob.text();
    expect(without).not.toContain("embedding");

    const withEmbeddings = await (
      await mod.exportToJSONL(data, { ...mockOptions, includeEmbeddings: true })
    ).blob.text();
    expect(withEmbeddings).toContain('"embedding":[0.1,0.2,0.3]');
  });

  it("handles empty data", () => {
    const result = mod.exportToJSONL(
      { bookmarks: [], documents: [], folders: [] },
      mockOptions,
    );
    expect(result.success).toBe(true);
    expect(result.format).toBe("jsonl");
    expect(result.size).toBe(0);
  });

  it("respects the abort signal (throws AbortError mid-stream)", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      mod.exportToJSONL(mockData, {
        ...mockOptions,
        signal: controller.signal,
      }),
    ).toThrow(/cancelled/i);
  });
});

describe("exportToCSV", () => {
  it("returns CSV with headers and data", async () => {
    const result = mod.exportToCSV(mockData, mockOptions);
    const text = await result.blob.text();
    expect(text).toContain(
      "Type,Title,URL/Content,Description,Tags,Created,Updated,Folder",
    );
    expect(text).toContain("Bookmark");
    expect(text).toContain("Document");
    expect(text).toContain("Test Page");
    expect(text).toContain("Doc One");
    expect(text).toContain("dev; test");
  });

  it("handles empty data", () => {
    const result = mod.exportToCSV(
      { bookmarks: [], documents: [], folders: [] },
      mockOptions,
    );
    expect(result.success).toBe(true);
    expect(result.format).toBe("csv");
  });

  it("escapes double quotes in CSV values", () => {
    const data: any = {
      bookmarks: [
        {
          title: 'He said "hello"',
          url: "https://x.com",
          tags: [],
          createdAt: "",
          updatedAt: "",
          isDeleted: false,
          id: "x",
        },
      ],
      documents: [],
      folders: [],
    };
    const result = mod.exportToCSV(data, mockOptions);
    expect(result.success).toBe(true);
  });

  it("prevents CSV formula injection — prefixes =, +, -, @ with single quote", async () => {
    const attacks = [
      { title: "=cmd|' /C calc'!A0", url: "https://safe.com", expected: "'" },
      { title: "+SUM(A1:A10)", url: "https://safe.com", expected: "'" },
      { title: "-IMPORTXML(\"http://evil.com\")", url: "https://safe.com", expected: "'" },
      { title: "@SUM(A1)", url: "https://safe.com", expected: "'" },
      { title: "=HYPERLINK(\"http://evil.com\")", url: "https://safe.com", expected: "'" },
      // Normal titles should NOT be prefixed
      { title: "Normal Title", url: "https://safe.com", expected: "Normal" },
      { title: "123 Numbers", url: "https://safe.com", expected: "123" },
    ];

    for (const attack of attacks) {
      const data: any = {
        bookmarks: [{
          title: attack.title,
          url: attack.url,
          tags: [],
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          isDeleted: false,
          id: "test",
          content: "",
          summary: "",
        }],
        documents: [],
        folders: [],
      };
      const result = mod.exportToCSV(data, mockOptions);
      const text = await result.blob.text();
      // The title field appears as a quoted CSV value: "...escaped title..."
      // escapeCsv first escapes " → "", then prefixes =+-@ with '
      const escapedTitle = attack.title.replace(/"/g, '""');
      if (attack.expected === "'") {
        expect(text).toContain(`"'${escapedTitle}"`);
      } else {
        expect(text).toContain(`"${escapedTitle}"`);
      }
    }
  });

  it("CSV formula injection: tags field is also protected", async () => {
    const data: any = {
      bookmarks: [{
        title: "Safe",
        url: "https://safe.com",
        tags: ["=cmd|'evil'"],
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        isDeleted: false,
        id: "test",
        content: "",
        summary: "",
      }],
      documents: [],
      folders: [],
    };
    const result = mod.exportToCSV(data, mockOptions);
    const text = await result.blob.text();
    // Tags column should have the formula injection prefix
    expect(text).toContain(`"'=cmd|'evil'"`);
  });
});

describe("exportToMarkdown", () => {
  it("generates markdown with bookmarks and documents", async () => {
    const result = mod.exportToMarkdown(mockData, mockOptions);
    const text = await result.blob.text();
    expect(text).toContain("# BookmarkForge Export");
    expect(text).toContain("## Bookmarks");
    expect(text).toContain("[Test Page](https://example.com/)");
    expect(text).toContain("## Documents");
    expect(text).toContain("Doc One");
    expect(text).toContain("dev, test");
  });

  it("handles data with no bookmarks", async () => {
    const data = { bookmarks: [], documents: mockDocuments, folders: [] };
    const result = mod.exportToMarkdown(data, mockOptions);
    const text = await result.blob.text();
    expect(text).not.toContain("## Bookmarks");
    expect(text).toContain("## Documents");
  });

  it("escapes brackets in bookmark titles inside markdown links", async () => {
    // A hostile/imported title containing `](` must not terminate the link
    // label early and inject its own destination URL.
    const evilTitle = "abc](https://evil.com) trailing";
    const data = {
      bookmarks: [
        {
          title: evilTitle,
          url: "https://example.com/",
          urlHash: "",
          tags: [],
          relatedLinks: [],
          processed: false,
          isPrivate: false,
          visitCount: 0,
          createdAt: "",
          updatedAt: "",
          isDeleted: false,
          id: "x",
        },
      ],
      documents: [],
      folders: [],
    };
    const result = mod.exportToMarkdown(data, mockOptions);
    const text = await result.blob.text();
    // The injected `](` is escaped, so the label cannot terminate early:
    // the only non-escaped link target in the row is the real URL.
    expect(text).toContain("https://example.com/)");
    expect(text).toContain("abc\\]");
    expect(text).not.toContain("abc](https://evil.com)");
  });

  it("handles data with no documents", async () => {
    const data = { bookmarks: mockBookmarks, documents: [], folders: [] };
    const result = mod.exportToMarkdown(data, mockOptions);
    const text = await result.blob.text();
    expect(text).toContain("## Bookmarks");
    expect(text).not.toContain("## Documents");
  });

  it("handles bookmarks without summary or tags", async () => {
    const bookmark: any[] = [
      {
        title: "No Tags",
        url: "https://x.com",
        tags: [],
        createdAt: "",
        updatedAt: "",
        isDeleted: false,
        id: "x",
      },
    ];
    const result = mod.exportToMarkdown(
      { bookmarks: bookmark, documents: [], folders: [] },
      mockOptions,
    );
    const text = await result.blob.text();
    expect(text).toContain("No Tags");
    expect(text).not.toContain("**Tags:**");
  });
});

describe("exportToObsidian frontmatter — newline-safe YAML escaping", () => {
  // The frontmatter must remain a single valid YAML block even when titles
  // contain newlines or a line that is exactly `---`. Before the fix, a
  // literal newline folded the value to a space (data corruption) and a
  // `---` line closed the frontmatter early, producing an unterminated
  // scalar and leaking the remaining fields into the markdown body.
  beforeEach(() => {
    mockJsZipInstance.__mockInstance.file.mockClear();
  });

  it("escapes newlines so the value survives round-trip exactly", async () => {
    const data: any = {
      bookmarks: [
        {
          id: "b-newline",
          title: "Multi\nline title",
          url: "https://example.com",
          summary: "",
          content: "",
          tags: [],
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          isDeleted: false,
        },
      ],
      documents: [],
      folders: [],
    };
    await mod.exportToObsidian(data, mockOptions);
    const text = capturedObsidianContent();
    // The frontmatter must not contain a raw newline inside the title.
    const frontmatter = text.split("---\n")[1] ?? "";
    expect(frontmatter).toContain("Multi\\nline title");
    expect(frontmatter).not.toContain("Multi\nline");
  });

  it("a title line containing --- cannot close the frontmatter early", async () => {
    const data: any = {
      bookmarks: [
        {
          id: "b-dash",
          title: "before\n---\nafter",
          url: "https://example.com",
          summary: "",
          content: "",
          tags: ["bookmark"],
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          isDeleted: false,
        },
      ],
      documents: [],
      folders: [],
    };
    await mod.exportToObsidian(data, mockOptions);
    const text = capturedObsidianContent();
    // The frontmatter block must still parse as one YAML doc: strip the
    // delimiters (gray-matter semantics) and assert the full object.
    const inner = text.split("---\n")[1] ?? "";
    const closing = inner.lastIndexOf("\n---\n");
    const yamlBlock = closing >= 0 ? inner.slice(0, closing) : inner;
    // Round-trip through the real YAML parser to prove the block is valid
    // and the value is preserved exactly. js-yaml ships no type declarations
    // (transitive dependency, not a direct one).
    // @ts-expect-error -- js-yaml has no bundled types
    const { load } = await import("js-yaml");
    const parsed = load(yamlBlock) as { title?: string };
    expect(parsed.title).toBe("before\n---\nafter");
  });
});

describe("exportToHTML", () => {
  it("generates HTML with bookmarks and documents", async () => {
    const result = mod.exportToHTML(mockData, mockOptions);
    const text = await result.blob.text();
    expect(text).toContain("<!DOCTYPE html>");
    expect(text).toContain("BookmarkForge Export");
    expect(text).toContain('class="bookmark"');
    expect(text).toContain('class="document"');
    expect(text).toContain(">Test Page</a>");
    expect(text).toContain(">Doc One</h3>");
    expect(text).toContain('class="tag"');
  });

  it("includes description when present", async () => {
    const result = mod.exportToHTML(mockData, mockOptions);
    const text = await result.blob.text();
    expect(text).toContain(">desc<");
  });

  // The exported HTML is a standalone file a user opens in a browser, so
  // vault-derived strings (titles, tags, URLs) must never survive as live
  // markup. DOMPurify strips script tags and event handlers, and the
  // non-strict path runs sanitizeLinks (re-sanitize + data: URI stripping).
  it("neutralizes script tags and event handlers in titles", async () => {
    const data: any = {
      bookmarks: [
        {
          id: "xss-b",
          title: '<img src=x onerror="alert(1)"><script>alert(2)</script>Safe',
          url: "https://example.com",
          summary: "",
          content: "",
          tags: ['<script>alert(3)</script>'],
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          isDeleted: false,
        },
      ],
      documents: [],
      folders: [],
    };
    const result = mod.exportToHTML(data, mockOptions);
    const text = await result.blob.text();
    expect(text).not.toContain("<script");
    expect(text).not.toContain("onerror");
    // Script bodies are stripped entirely by DOMPurify (not kept as text).
    expect(text).not.toContain("alert(2)");
    expect(text).not.toContain("alert(3)");
    // The safe text content survives.
    expect(text).toContain("Safe");
  });

  it("strips javascript: URLs from exported link hrefs", async () => {
    const data: any = {
      bookmarks: [
        {
          id: "xss-url",
          title: "Evil link",
          url: "javascript:alert(1)",
          summary: "",
          content: "",
          tags: [],
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          isDeleted: false,
        },
      ],
      documents: [],
      folders: [],
    };
    const result = mod.exportToHTML(data, mockOptions);
    const text = await result.blob.text();
    expect(text).not.toContain("javascript:");
  });

  it("skips tags section when empty", async () => {
    const bookmark: any[] = [
      {
        title: "X",
        url: "https://x.com",
        tags: [],
        createdAt: "",
        updatedAt: "",
        isDeleted: false,
      },
    ];
    const result = mod.exportToHTML(
      { bookmarks: bookmark, documents: [], folders: [] },
      mockOptions,
    );
    const text = await result.blob.text();
    expect(text).not.toContain('class="tags"');
  });

  it("handles empty data", () => {
    const result = mod.exportToHTML(
      { bookmarks: [], documents: [], folders: [] },
      mockOptions,
    );
    expect(result.success).toBe(true);
    expect(result.format).toBe("html");
  });

  it("sanitizes malicious title and javascript: URL in HTML export", async () => {
    const malicious: any[] = [
      {
        title: "<script>alert(1)</script>",
        url: "javascript:alert(1)",
        tags: [],
        createdAt: "",
        updatedAt: "",
        isDeleted: false,
      },
    ];
    const result = mod.exportToHTML(
      { bookmarks: malicious, documents: [], folders: [] },
      mockOptions,
    );
    const text = await result.blob.text();
    expect(text).not.toContain("<script>alert(1)</script>");
    expect(text).not.toContain('href="javascript:alert(1)"');
  });
});

describe("exportToObsidian", () => {
  it("returns ExportResult with obsidian format", async () => {
    const result = await mod.exportToObsidian(mockData, mockOptions);
    expect(result.success).toBe(true);
    expect(result.format).toBe("obsidian");
    expect(result.filename).toMatch(/\.zip$/);
    expect(result.blob).toBeInstanceOf(Blob);
  });
});
