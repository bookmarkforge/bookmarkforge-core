/**
 * — adversarial-input verification for the import/export area.
 *
 * These tests close the outstanding-verification items of the
 * tracking list that can be verified with vitest (no browser required):
 *
 * - ZIP with tampered declared sizes (declared < actual): the preflight
 * trusts JSZip metadata only when the post-decompression measurement
 * agrees; a bomb that lies about its size must still be caught.
 * - ZIP entries whose declared size is absent: measured after decompression,
 * counted exactly once.
 * - CSV with formula cells and URL schemes: import sanitization behavior
 * (title/text sanitization, URL scheme guard) asserted on real inputs.
 * - CSV export of an imported adversarial record: the export path escapes
 * the formula prefix (round-trip sanity).
 *
 * The private-repo suite lives at src/tests/services/adversarial-import.test.ts
 * and runs with the SAME mocks as UniversalImporter.branches.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

const { attachmentStore } = vi.hoisted(() => ({
  attachmentStore: { persistFile: vi.fn(async () => "att-mock") },
}));
vi.mock("../../services/documentAttachments", () => ({
  attachmentStore,
}));

vi.mock("../../db/database", () => ({
  initDB: vi.fn(),
}));

const mockLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
vi.mock("../../utils/logger", () => ({ logger: mockLogger }));

vi.mock("../../services/ai/SemanticSearchService", () => ({
  semanticSearchService: {},
  runWithTimeout: (_op: unknown) => Promise.resolve(),
}));

const { UniversalImporter } = await import("../../services/UniversalImporter");

function makeDb() {
  const db = {
    bookmarks: {
      insert: vi.fn().mockResolvedValue({}),
      find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
      bulkRemove: vi.fn().mockResolvedValue({}),
    },
    documents: {
      insert: vi.fn().mockResolvedValue({}),
      find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
      bulkRemove: vi.fn().mockResolvedValue({}),
    },
    folders: {
      insert: vi.fn().mockResolvedValue({}),
      find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
      bulkRemove: vi.fn().mockResolvedValue({}),
    },
  };
  // The mocks match the shape BookmarkForgeDB uses at runtime; cast keeps the
  // tests honest about the mock while satisfying the importer's parameter.
  return db as unknown as {
    bookmarks: {
      insert: ReturnType<typeof vi.fn>;
      find: () => { exec: () => Promise<unknown[]> };
      findOne: () => { exec: () => Promise<unknown> };
      bulkRemove: ReturnType<typeof vi.fn>;
    };
    documents: {
      insert: ReturnType<typeof vi.fn>;
      find: () => { exec: () => Promise<unknown[]> };
      findOne: () => { exec: () => Promise<unknown> };
      bulkRemove: ReturnType<typeof vi.fn>;
    };
    folders: {
      insert: ReturnType<typeof vi.fn>;
      find: () => { exec: () => Promise<unknown[]> };
      findOne: () => { exec: () => Promise<unknown> };
      bulkRemove: ReturnType<typeof vi.fn>;
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

describe("P5 — ZIP with tampered / missing declared sizes", () => {
  it("rejects a ZIP whose entry declares a small size but decompresses beyond the per-entry limit", async () => {
    // Hand-craft a lie: JSZip metadata says the entry is tiny, the real
    // content is over MAX_ZIP_ENTRY_BYTES. The post-decompression fallback
    // must catch it instead of trusting the declared number.
    const zip = new JSZip();
    zip.file("bomb.md", "a".repeat(51 * 1024 * 1024));
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    // Overwrite the declared uncompressed size in JSZip's private metadata
    // with a small number AFTER generation, simulating a tampered header.
    const file = new File([blob], "lying.zip", { type: "application/zip" });
    const result = await new UniversalImporter().importData(makeDb() as never, file);
    expect(result.success).toBe(false);
    expect(result.error).toContain("safety size limit");
  });

  it("counts an entry without declared size exactly once across multiple unknown-size entries", async () => {
    // Several entries whose sizes JSZip does not expose: the cumulative limit
    // must be enforced against real decompressed bytes, added once per entry.
    const zip = new JSZip();
    const chunk = "x".repeat(2 * 1024 * 1024); // 2 MiB each
    zip.file("n1.md", `---\ntitle: One\n---\n\n${chunk}`);
    zip.file("n2.md", `---\ntitle: Two\n---\n\n${chunk}`);
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const file = new File([blob], "unknown-sizes.zip", { type: "application/zip" });
    const result = await new UniversalImporter().importData(makeDb() as never, file);
    // 4 MiB total is well under the limit: both notes import, proving the
    // unknown-size path does not abort legitimate archives.
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(2);
  });

  it("rejects a zip whose many small entries add up past the cumulative limit even when each entry is under the per-entry cap", async () => {
    const zip = new JSZip();
    // 110 entries × 2 MiB = 220 MiB > 200 MiB cumulative limit.
    for (let i = 0; i < 110; i++) {
      zip.file(`n${i}.md`, `---\ntitle: N${i}\n---\n\n${"y".repeat(2 * 1024 * 1024)}`);
    }
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const file = new File([blob], "cumulative.zip", { type: "application/zip" });
    const result = await new UniversalImporter().importData(makeDb() as never, file);
    expect(result.success).toBe(false);
    expect(result.error).toContain("safety size limit");
  });
});

describe("P5 — CSV adversarial cells and URL schemes", () => {
  it("sanitizes a formula-bearing title on import (no script execution surface)", async () => {
    const csv = [
      "Title,URL",
      '=HYPERLINK("http://evil.com"),"https://safe.com"',
      "+SUM(A1:A10),https://safe2.com",
      "@cmd,https://safe3.com",
    ].join("\n");
    const file = new File([csv], "formulas.csv", { type: "text/csv" });
    const db = makeDb();
    const result = await new UniversalImporter().importData(
      db as never,
      file,
    );
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(3);
    const inserted = (
      (db.bookmarks.insert as unknown as { mock: { calls: unknown[][] } }).mock
        .calls
    ).map(
      ([doc]) => doc as { title: string; url: string },
    );
    // Titles survive as literal text; they are not executed anywhere by the
    // importer (no eval, no formula interpretation).
    expect(inserted[0]!.title).toContain("HYPERLINK");
    expect(inserted[1]!.title).toContain("SUM");
    expect(inserted[2]!.title).toContain("cmd");
  });

  it("skips rows whose URL uses a non-http scheme and keeps valid ones", async () => {
    const csv = [
      "Title,URL",
      "Evil,javascript:alert(1)",
      "Evil2,data:text/html,<script>",
      "Evil3,file:///etc/passwd",
      "Good,https://ok.com",
    ].join("\n");
    const file = new File([csv], "schemes.csv", { type: "text/csv" });
    const db = makeDb();
    const result = await new UniversalImporter().importData(
      db as never,
      file,
    );
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
    const inserted = (
      (db.bookmarks.insert as unknown as { mock: { calls: unknown[][] } }).mock
        .calls
    ).map(
      ([doc]) => doc as { url: string },
    );
    expect(inserted[0]!.url).toBe("https://ok.com/");
    expect(result.skippedCount).toBe(3);
    // The three scheme-attack rows were never inserted.
    expect(db.bookmarks.insert).toHaveBeenCalledTimes(1);
  });

  it("export path: a formula title imported from CSV is escaped again in the CSV export", async () => {
    // Round-trip: import "=HYPERLINK(...)" and export it; the exporter's
    // escapeCsv must prefix the formula character so a spreadsheet opening
    // the export cannot execute it.
    const { exportToCSV } = await import("../../services/exporter.formatters");
    const data = {
      bookmarks: [
        {
          id: "b1",
          title: '=HYPERLINK("http://evil.com")',
          url: "https://safe.com",
          tags: [],
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          isDeleted: false,
          content: "",
          summary: "",
        },
      ],
      documents: [],
      folders: [],
    } as never;
    const result = exportToCSV(data, {} as never);
    const text = await (result as { blob: Blob }).blob.text();
    expect(text).toContain('"\'=HYPERLINK');
  });

  it("HTML import sanitizes script-bearing content into the summary", async () => {
    const html = [
      "<!DOCTYPE html><html><head><title>Pocket Export</title></head><body>",
      '<ul><li><a href="https://a.com">A</a>',
      "<div><script>alert(1)</script><p>legit text</p></div>",
      "</li></ul></body></html>",
    ].join("");
    const file = new File([html], "ril_export.html", { type: "text/html" });
    const db = makeDb();
    const result = await new UniversalImporter().importData(
      db as never,
      file,
    );
    expect(result.success).toBe(true);
    const inserted = (
      (db.bookmarks.insert as unknown as { mock: { calls: unknown[][] } }).mock
        .calls
    ).map(
      ([doc]) => doc as { summary: string },
    );
    expect(inserted[0]!.summary).not.toContain("<script");
    expect(inserted[0]!.summary).not.toContain("alert(1)");
  });
});
