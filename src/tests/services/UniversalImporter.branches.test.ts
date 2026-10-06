/**
 * Branch-coverage companion suite for UniversalImporter.
 *
 * The main suite (UniversalImporter.test.ts) covers the happy paths; this
 * file targets the branches the v8 report lists as uncovered:
 *  - pending-rollback persistence/validation (sessionStorage) and the
 *    rollbackImport error/timeout/batch machinery
 *  - AbortSignal handling during import and mid-import yield points
 *  - detection routes (DT/A marker, Omnivore content marker, .md, .zip)
 *  - JSON normalizers: dates (seconds/millis/invalid), visitCount clamping,
 *    broken/lastChecked/lastVisitedAt passthrough, blocks sanitization,
 *    relatedLinks/documentLinks filtering, folder trees and parents
 *  - CSV: no-stream fallback, streaming reader (quoted newlines, chunk-split
 *    quotes), record-limit guard, insert errors
 *  - Markdown: single-file imports, zip preflight dirs, bookmark wikilinks,
 *    linked notes, folder frontmatter trees, attachment dedup refs
 *  - Omnivore: root-shape articles, label shapes, no-articles, invalid JSON
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import JSZip from "jszip";
import { attachmentStore } from "../../services/documentAttachments";
import {
  createStreamingCsvFile,
  createStreamingCsvRowsFile,
} from "../helpers/csvFixtures";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../services/SanitizationService", () => ({
  SanitizationService: {
    sanitizeHtml: vi.fn((s: string) => s.replace(/[<>]/g, "")),
  },
  sanitizeUrl: vi.fn((s: string) => s),
  sanitizeUserInput: vi.fn((s: string, maxLen?: number) => {
    const cleaned = s.replace(/[<>]/g, "");
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

vi.mock("../../services/documentAttachments", () => ({
  attachmentStore: {
    persistFile: vi.fn().mockResolvedValue("att-mock"),
  },
}));

import { UniversalImporter } from "../../services/UniversalImporter";
import { STORAGE_KEYS } from "../../constants/storage-keys";

const STORAGE_KEY = STORAGE_KEYS.PENDING_IMPORT_ROLLBACK;

function makeDb() {
  return {
    bookmarks: {
      findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
      find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      insert: vi.fn().mockResolvedValue({}),
      bulkRemove: vi.fn().mockResolvedValue({}),
    },
    documents: {
      findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
      find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      insert: vi.fn().mockResolvedValue({}),
      bulkRemove: vi.fn().mockResolvedValue({}),
    },
    folders: {
      findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
      find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      insert: vi.fn().mockResolvedValue({}),
      bulkRemove: vi.fn().mockResolvedValue({}),
    },
  };
}

function jsonFile(payload: unknown, name = "export.json"): File {
  return new File([JSON.stringify(payload)], name, { type: "application/json" });
}

function seedJournal(journal: {
  bookmarkIds?: string[];
  documentIds?: string[];
  folderIds?: string[];
  version?: number;
  createdAt?: unknown;
}): void {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: journal.version ?? 2,
      createdAt: journal.createdAt ?? Date.now(),
      bookmarkIds: journal.bookmarkIds ?? [],
      documentIds: journal.documentIds ?? [],
      folderIds: journal.folderIds ?? [],
    }),
  );
}


describe("UniversalImporter branch coverage", () => {
  let importer: UniversalImporter;
  // Same convention as the main suite: the mock DB is structurally typed
  // against the importer's usage, not the real BookmarkForgeDB.
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    importer = new UniversalImporter();
    mockDb = makeDb();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Pending rollback: sessionStorage load / validation ──────────────────

  it("clears an expired, malformed or invalid pending rollback journal", () => {
    const badSeeds = [
      { version: 1, bookmarkIds: ["b1"] },
      { version: 2, createdAt: Date.now() + 60_000, bookmarkIds: ["b1"] },
      { version: 2, createdAt: Date.now() - 48 * 60 * 60 * 1000, bookmarkIds: ["b1"] },
      { version: 2, createdAt: "not-a-date" as unknown as number },
      { version: 2, bookmarkIds: [""] },
      { version: 2, bookmarkIds: ["x".repeat(201)] },
      { version: 2, bookmarkIds: [42 as unknown as string] },
      {
        version: 2,
        bookmarkIds: Array(60_000).fill("a"),
        documentIds: Array(60_000).fill("b"),
      },
    ];
    for (const seed of badSeeds) {
      seedJournal(seed);
      // Constructor must drop the invalid journal without throwing.
      const fresh = new UniversalImporter();
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      void fresh;
    }
  });

  it("loads a valid pending rollback journal and clears it after a completed rollback", async () => {
    seedJournal({ bookmarkIds: ["b1", "b2"], documentIds: ["d1"], folderIds: ["f1"] });
    importer = new UniversalImporter();

    const foundBookmarks = [{ id: "b1" }, { id: "b2" }];
    const foundDocuments = [{ id: "d1" }];
    const foundFolders = [{ id: "f1" }];
    mockDb.bookmarks.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue(foundBookmarks),
    });
    mockDb.documents.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue(foundDocuments),
    });
    mockDb.folders.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue(foundFolders),
    });

    const ok = await importer.retryPendingRollback(mockDb);
    expect(ok).toBe(true);
    expect(mockDb.bookmarks.bulkRemove).toHaveBeenCalledWith(foundBookmarks);
    expect(mockDb.documents.bulkRemove).toHaveBeenCalledWith(foundDocuments);
    expect(mockDb.folders.bulkRemove).toHaveBeenCalledWith(foundFolders);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("skips batch work when a rollback query finds no matching rows", async () => {
    seedJournal({ bookmarkIds: ["ghost"] });
    importer = new UniversalImporter();
    const ok = await importer.retryPendingRollback(mockDb);
    expect(ok).toBe(true);
    expect(mockDb.bookmarks.bulkRemove).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent retryPendingRollback calls on one promise", async () => {
    seedJournal({ bookmarkIds: ["b1"] });
    // Re-create AFTER seeding: the constructor loads the journal once.
    importer = new UniversalImporter();
    // retryPendingRollback is async, so each call wraps the tracked promise
    // in a fresh wrapper — identity is not comparable. The real dedup signal
    // is that the underlying rollback runs exactly once.
    const first = importer.retryPendingRollback(mockDb);
    const second = importer.retryPendingRollback(mockDb);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    // The rollback query ran exactly once despite two concurrent calls.
    expect(mockDb.bookmarks.find).toHaveBeenCalledTimes(1);
  });

  it("keeps the journal and refuses new imports when rollback fails", async () => {
    seedJournal({ bookmarkIds: ["b1"] });
    // Re-create AFTER seeding: the constructor loads the journal once.
    importer = new UniversalImporter();
    mockDb.bookmarks.find.mockReturnValue({
      exec: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const ok = await importer.retryPendingRollback(mockDb);
    expect(ok).toBe(false);
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    const { logger } = await import("../../utils/logger");
    expect(vi.mocked(logger.error)).toHaveBeenCalled();

    // A second attempt also fails, and importData refuses to proceed.
    const again = await importer.retryPendingRollback(mockDb);
    expect(again).toBe(false);
    const result = await importer.importData(mockDb, jsonFile({ bookmarks: [] }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("previous import rollback is incomplete");
  });

  it("stops batch rollback when the 30s deadline elapses between batches", async () => {
    seedJournal({ bookmarkIds: Array(501).fill("x").map((x, i) => `${x}${i}`) });
    // Re-create AFTER seeding: the constructor loads the journal once.
    importer = new UniversalImporter();

    // Hold the first batch's query open, advance the fake clock past the
    // 30s deadline while it hangs, then release it: the second batch sees
    // Date.now() >= deadline and aborts.
    let releaseExec!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseExec = resolve;
    });
    mockDb.bookmarks.find.mockReturnValue({
      exec: vi.fn().mockImplementation(async () => {
        await gate;
        return Array.from({ length: 500 }, (_, i) => ({ id: `x${i}` }));
      }),
    });

    vi.useFakeTimers();
    const pending = importer.retryPendingRollback(mockDb);
    // Batch 1 is stuck awaiting exec; advance the clock with no timers due.
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    releaseExec();
    // Fire the batch-1 yield timer so the loop reaches the deadline check.
    await vi.advanceTimersByTimeAsync(0);
    const ok = await pending;
    expect(ok).toBe(false);
    expect(mockDb.bookmarks.bulkRemove).toHaveBeenCalledTimes(1);
    const { logger } = await import("../../utils/logger");
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "[UniversalImporter] Rollback failed",
      expect.objectContaining({
        bookmarkError: "Bookmark rollback timed out",
      }),
    );
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("logs non-Error rollback failures via String()", async () => {
    seedJournal({ bookmarkIds: ["b1"] });
    // Re-create AFTER seeding: the constructor loads the journal once.
    importer = new UniversalImporter();
    mockDb.bookmarks.find.mockReturnValue({
      exec: vi.fn().mockRejectedValue("plain string failure"),
    });
    const ok = await importer.retryPendingRollback(mockDb);
    expect(ok).toBe(false);
    const { logger } = await import("../../utils/logger");
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "[UniversalImporter] Rollback failed",
      expect.objectContaining({ bookmarkError: "plain string failure" }),
    );
  });

  it("persists the journal and reports rollbackIncomplete when a mid-import rollback fails", async () => {
    // Folders are imported before bookmarks/documents and have no per-item
    // try/catch: a folder insert error aborts the whole import, and a folder
    // rollback failure leaves the journal pending. The first folder must
    // succeed so the journal actually contains an id.
    mockDb.folders.insert
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("folder insert failed"));
    // The import path queries existing folders WITHOUT a selector; the
    // rollback path queries WITH one. Only the rollback query fails.
    mockDb.folders.find.mockImplementation((query?: unknown) => ({
      exec: vi.fn().mockImplementation(async () => {
        if (query) {throw new Error("rollback exploded");}
        return [];
      }),
    }));

    const result = await importer.importData(
      mockDb,
      jsonFile({
        folders: [
          { id: "f1", title: "One", parentId: "root" },
          { id: "f2", title: "Two", parentId: "root" },
        ],
        bookmarks: [],
        documents: [],
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("folder insert failed");
    expect(result.error).toContain("Rollback incomplete");
    expect(result.rollbackIncomplete).toBe(true);
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    const { logger } = await import("../../utils/logger");
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "[UniversalImporter] Folder rollback failed",
      expect.objectContaining({ folderCount: 1 }),
    );
  });

  it("survives with sessionStorage undefined (memory fallback only)", async () => {
    vi.stubGlobal("sessionStorage", undefined);
    importer = new UniversalImporter();
    expect(await importer.retryPendingRollback(mockDb)).toBe(true);

    // Force a pending rollback, then a completed one — persist and clear must
    // both tolerate the missing storage. Only the rollback query (with a
    // selector) fails; the import-path existing-folders query must resolve.
    mockDb.folders.insert.mockRejectedValueOnce(new Error("x"));
    mockDb.folders.find.mockImplementation((query?: unknown) => ({
      exec: vi.fn().mockImplementation(async () => {
        if (query) {throw new Error("y");}
        return [];
      }),
    }));
    await importer.importData(
      mockDb,
      jsonFile({
        folders: [{ id: "f1", title: "One", parentId: "root" }],
        bookmarks: [],
        documents: [],
      }),
    );
    mockDb.folders.find.mockReturnValue({ exec: vi.fn().mockResolvedValue([]) });
    expect(await importer.retryPendingRollback(mockDb)).toBe(true);
  });

  // ── Abort handling ───────────────────────────────────────────────────────

  it("returns an AbortError result when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await importer.importData(mockDb, jsonFile({ bookmarks: [] }), {
      signal: controller.signal,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Import cancelled");
    const { logger } = await import("../../utils/logger");
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "[UniversalImporter] Import failed",
      expect.objectContaining({ rollbackCompleted: true }),
    );
  });

  it("aborts mid-import at a yield point, rolls back and reports the cancel", async () => {
    const controller = new AbortController();
    let progressCalls = 0;
    const file = createStreamingCsvRowsFile({
      rowCount: 60,
      name: "bulk.csv",
      row: (index) => `Site ${index},https://site${index}.com\n`,
    });

    const result = await importer.importData(mockDb, file, {
      signal: controller.signal,
      onProgress: () => {
        progressCalls++;
        if (progressCalls === 2) {
          controller.abort();
        }
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Import cancelled");
    // Rows 1..49 are inserted; the abort fires inside the yield at row 50
    // (index 50) before that row is parsed.
    expect(mockDb.bookmarks.insert).toHaveBeenCalledTimes(49);
    // The rollback query ran and found no rows (mock returns []).
    expect(mockDb.bookmarks.find).toHaveBeenCalled();
  });

  it("cancels the CSV reader when aborted during a streaming read", async () => {
    const controller = new AbortController();
    let releaseRead!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let pulls = 0;
    const file = {
      name: "bookmarks.csv",
      size: 1024,
      text: vi.fn(),
      stream: () =>
        new ReadableStream({
          pull(ctrl) {
            pulls++;
            if (pulls === 1) {
              ctrl.enqueue(new TextEncoder().encode("Title,URL\nhttps://a.com\n"));
              return;
            }
            // Hang the second pull until the reader is cancelled.
            return gate;
          },
        }),
    } as unknown as File;

    const resultPromise = importer.importData(mockDb, file, {
      signal: controller.signal,
    });
    // Wait until the reader is blocked on the second pull, then abort: the
    // abort listener cancels the reader and the pending read resolves.
    await vi.waitFor(() => expect(pulls).toBe(2));
    controller.abort();
    releaseRead();
    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toBe("Import cancelled");
  });

  // ── importData / importDataWithDetection routing ─────────────────────────

  it("rejects an oversized file before reading (importData)", async () => {
    const file = {
      name: "big.json",
      size: 50 * 1024 * 1024 + 1,
      text: vi.fn(),
    } as unknown as File;
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(false);
    expect(result.error).toContain("File too large");
    expect(file.text).not.toHaveBeenCalled();
  });

  it("detects Pocket HTML from a bare <DT><A marker (no NETSCAPE header)", async () => {
    const file = new File(
      ['<DL><p><DT><A HREF="https://d.com" ADD_DATE="1700000000000">D</A></DL>'],
      "export.dat",
      { type: "text/plain" },
    );
    const result = await importer.importDataWithDetection(mockDb, file);
    expect(result.success).toBe(true);
    expect(mockDb.bookmarks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://d.com" }),
    );
  });

  it("detects Omnivore from the \"type\":\"article\" content marker", async () => {
    const file = jsonFile(
      {
        type: "article",
        articles: [{ title: "A", url: "https://art.com" }],
      },
      "export.json",
    );
    const result = await importer.importDataWithDetection(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
  });

  it("routes .md through the single-file markdown importer in detection mode", async () => {
    const file = new File(["# Solo\n\nBody text"], "solo.md", {
      type: "text/markdown",
    });
    const result = await importer.importDataWithDetection(mockDb, file);
    expect(result.success).toBe(true);
    expect(mockDb.documents.insert).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Solo" }),
    );
  });

  it("routes .zip through the markdown zip importer in detection mode", async () => {
    const zip = new JSZip();
    zip.file("note.md", "# Note\n");
    const blob = await zip.generateAsync({ type: "blob" });
    const file = new File([blob], "vault.zip", { type: "application/zip" });
    const result = await importer.importDataWithDetection(mockDb, file);
    expect(result.success).toBe(true);
    expect(mockDb.documents.insert).toHaveBeenCalledTimes(1);
  });

  it("refuses detection imports while a pending rollback is incomplete", async () => {
    seedJournal({ bookmarkIds: ["b1"] });
    importer = new UniversalImporter();
    mockDb.bookmarks.find.mockReturnValue({
      exec: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const result = await importer.importDataWithDetection(
      mockDb,
      jsonFile({ bookmarks: [] }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("previous import rollback is incomplete");
  });

  it("reports rollbackIncomplete through the detection path too", async () => {
    mockDb.folders.insert
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("boom"));
    mockDb.folders.find.mockImplementation((query?: unknown) => ({
      exec: vi.fn().mockImplementation(async () => {
        if (query) {throw new Error("rollback boom");}
        return [];
      }),
    }));
    const result = await importer.importDataWithDetection(
      mockDb,
      jsonFile({
        folders: [
          { id: "f1", title: "One", parentId: "root" },
          { id: "f2", title: "Two", parentId: "root" },
        ],
        bookmarks: [],
        documents: [],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.rollbackIncomplete).toBe(true);
    const { logger } = await import("../../utils/logger");
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "[UniversalImporter] Detection failed",
      expect.anything(),
    );
  });

  // ── JSON importer: normalizers and edge records ──────────────────────────

  it("clamps visitCount and normalizes broken/lastChecked/lastVisitedAt", async () => {
    const result = await importer.importData(
      mockDb,
      jsonFile({
        bookmarks: [
          { url: "https://a.com", visitCount: -5 },
          { url: "https://b.com", visitCount: "42" },
          { url: "https://c.com", visitCount: 2_000_000 },
          { url: "https://d.com", visitCount: 3.7 },
          {
            url: "https://e.com",
            broken: true,
            lastChecked: "1700000000",
            lastVisitedAt: "1700000000000",
          },
          { url: "https://f.com", broken: "yes", lastVisitedAt: "not-a-date" },
        ],
      }),
    );
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(6);

    const byUrl = new Map(
      (mockDb.bookmarks.insert.mock.calls as any[][]).map(([doc]) => [doc.url, doc]),
    );
    expect(byUrl.get("https://a.com").visitCount).toBe(0);
    expect(byUrl.get("https://b.com").visitCount).toBe(42);
    expect(byUrl.get("https://c.com").visitCount).toBe(1_000_000);
    expect(byUrl.get("https://d.com").visitCount).toBe(0);

    const e = byUrl.get("https://e.com");
    expect(e.broken).toBe(true);
    expect(new Date(e.lastChecked).toISOString()).toBe(e.lastChecked);
    expect(new Date(e.lastVisitedAt).toISOString()).toBe(e.lastVisitedAt);

    const f = byUrl.get("https://f.com");
    expect(f.broken).toBeUndefined();
    expect(f.lastVisitedAt).toBeUndefined();
  });

  it("normalizes import dates: unix seconds, millis, invalid and empty", async () => {
    await importer.importData(
      mockDb,
      jsonFile({
        bookmarks: [
          { url: "https://s.com", createdAt: "1700000000" },
          { url: "https://m.com", createdAt: "1700000000000" },
          { url: "https://i.com", createdAt: "not-a-date" },
          { url: "https://e.com", createdAt: "" },
          { url: "https://n.com", createdAt: "99999999999999999999999999" },
        ],
      }),
    );
    const byUrl = new Map(
      (mockDb.bookmarks.insert.mock.calls as any[][]).map(([doc]) => [doc.url, doc]),
    );
    expect(byUrl.get("https://s.com").createdAt).toBe(
      new Date(1_700_000_000_000).toISOString(),
    );
    expect(byUrl.get("https://m.com").createdAt).toBe(
      new Date(1_700_000_000_000).toISOString(),
    );
    for (const url of ["https://i.com", "https://e.com", "https://n.com"]) {
      expect(Number.isNaN(Date.parse(byUrl.get(url).createdAt))).toBe(false);
    }
  });

  it("filters relatedLinks: non-strings, long URLs, duplicates and non-http", async () => {
    await importer.importData(
      mockDb,
      jsonFile({
        bookmarks: [
          {
            url: "https://x.com",
            relatedLinks: [
              "https://a.com",
              "https://a.com",
              "ftp://bad.com",
              123,
              `https://${"x".repeat(2000)}`,
              "https://b.com",
            ],
          },
        ],
      }),
    );
    const inserted = (mockDb.bookmarks.insert.mock.calls as any)[0][0];
    expect(inserted.relatedLinks).toEqual(["https://a.com", "https://b.com"]);
  });

  it("sanitizes blocks: unsafe keys, depth cap, entry/array caps, long strings", async () => {
    const deep: Record<string, unknown> = { leaf: "deep" };
    for (let i = 0; i < 12; i++) {
      deep.next = { ...deep };
      delete deep.leaf;
    }
    await importer.importData(
      mockDb,
      jsonFile({
        documents: [
          {
            title: "Blocks",
            blocks: [
              {
                url: "https://safe.com",
                text: "x".repeat(12_000),
                __proto__: { polluted: true },
                constructor: "bad",
                prototype: "bad",
                ["k".repeat(101)]: "long-key",
                arr: Array.from({ length: 600 }, (_, i) => i),
                deep,
              },
            ],
          },
        ],
      }),
    );
    const inserted = (mockDb.documents.insert.mock.calls as any)[0][0];
    expect(inserted.blocks).toHaveLength(1);
    const block = inserted.blocks[0];
    expect(block.url).toBe("https://safe.com");
    expect(block.text).toHaveLength(10_000);
    // Prototype-pollution keys are filtered as own enumerable entries
    // (checking via keys, not property access — __proto__/constructor are
    // inherited from Object.prototype on the rebuilt object).
    expect(Object.keys(block)).not.toContain("__proto__");
    expect(Object.keys(block)).not.toContain("constructor");
    expect(Object.keys(block)).not.toContain("prototype");
    expect(block["k".repeat(101)]).toBeUndefined();
    expect(block.arr).toHaveLength(500);
    // The nested chain beyond depth 10 is pruned to undefined.
    expect(JSON.stringify(block.deep)).not.toContain("deep");
  });

  it("falls back to the root object when data has no bookmarks/documents arrays", async () => {
    const result = await importer.importData(
      mockDb,
      jsonFile({
        data: { unrelated: 1 },
        bookmarks: [{ url: "https://root.com", title: "R" }],
      }),
    );
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
  });

  it("accepts truthy non-array bookmarks/documents keys without crashing", async () => {
    const result = await importer.importData(
      mockDb,
      jsonFile({ bookmarks: "not-an-array", documents: "also-not" }),
    );
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(0);
  });

  it("rejects imports above the 100k record limit before hashing anything", async () => {
    const many = Array.from({ length: 100_001 }, (_, i) => ({
      url: `https://n${i}.com`,
    }));
    const result = await importer.importData(mockDb, jsonFile({ bookmarks: many }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("too many records");
    expect(mockDb.bookmarks.insert).not.toHaveBeenCalled();
  });

  it("deduplicates source document ids and resolves document links to new ids", async () => {
    const result = await importer.importData(
      mockDb,
      jsonFile({
        documents: [
          { id: "d1", title: "First" },
          { id: "d1", title: "Second duplicate source" },
          {
            title: "Linked",
            links: [
              "d1",
              "d1",
              "missing",
              123,
              "x".repeat(300),
            ],
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(3);
    const byTitle = new Map(
      (mockDb.documents.insert.mock.calls as any[][]).map(([doc]) => [doc.title, doc]),
    );
    const linked = byTitle.get("Linked");
    expect(linked.links).toHaveLength(1);
    const targetId = linked.links[0];
    expect(byTitle.get("First").id).toBe(targetId);
  });

  it("omits document summary when it is not a string", async () => {
    await importer.importData(
      mockDb,
      jsonFile({
        documents: [{ title: "NoSummary", summary: 12345 }],
      }),
    );
    const inserted = (mockDb.documents.insert.mock.calls as any)[0][0];
    expect(inserted.summary).toBeUndefined();
  });

  it("maps string and object document tags through sanitizeUserInput", async () => {
    await importer.importData(
      mockDb,
      jsonFile({
        documents: [
          { title: "T", tags: ["ok", 42 as unknown as string] },
        ],
      }),
    );
    const inserted = (mockDb.documents.insert.mock.calls as any)[0][0];
    expect(inserted.tags).toEqual(["ok", "42"]);
  });

  // ── JSON importer: folders and parent resolution ─────────────────────────

  it("imports folder trees, resolves known parents and rejects invalid records", async () => {
    const result = await importer.importData(
      mockDb,
      jsonFile({
        folders: [
          { id: "f1", title: "One", parentId: "root" },
          { id: "f2", title: "Two", parentId: "f1" },
          { id: "orphan", title: "Orphan", parentId: "ghost" },
          { id: "x".repeat(101), title: "Too long" },
          { id: "root", title: "Root" },
          "not-an-object",
          { title: "No id" },
        ],
        documents: [
          { title: "DocA", folderId: "f1" },
          { title: "DocB", folderId: "ghost" },
        ],
      }),
    );
    expect(result.success).toBe(true);
    // f1, f2 and the orphan are inserted; the rest are rejected/skipped.
    expect(mockDb.folders.insert).toHaveBeenCalledTimes(3);
    const folderCalls = (mockDb.folders.insert.mock.calls as any[][]).map(([doc]) => doc);
    expect(folderCalls[0]).toEqual(
      expect.objectContaining({ id: "f1", parentId: "root" }),
    );
    expect(folderCalls[1]).toEqual(
      expect.objectContaining({ id: "f2", parentId: "f1" }),
    );
    expect(folderCalls[2]).toEqual(
      expect.objectContaining({ id: "orphan", parentId: "root" }),
    );
    const byTitle = new Map(
      (mockDb.documents.insert.mock.calls as any[][]).map(([doc]) => [doc.title, doc]),
    );
    expect(byTitle.get("DocA").folderId).toBe("f1");
    expect(byTitle.get("DocB").folderId).toBe("root");
  });

  it("resolves parents through existing DB folders and breaks cycles", async () => {
    mockDb.folders.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue([
        { id: "self", parentId: "self" },
        { id: "ex", parentId: "root" },
      ]),
    });
    const result = await importer.importData(
      mockDb,
      jsonFile({
        folders: [
          { id: "f1", title: "First", parentId: "root" },
          { id: "new1", title: "New", parentId: "ex" },
          // Same id as an already-imported folder, self-parent: the
          // requestedParentId === id guard collapses it to root.
          { id: "f1", title: "Dup", parentId: "f1" },
          // Parent id unknown to the tree → root without resolution.
          { id: "self2", title: "Self", parentId: "self2" },
          // self -> self loop exhausts the 20-depth budget → root.
          { id: "deep", title: "Deep", parentId: "self" },
        ],
        bookmarks: [],
        documents: [],
      }),
    );
    expect(result.success).toBe(true);
    const folderCalls = (mockDb.folders.insert.mock.calls as any[][]).map(([doc]) => doc);
    expect(folderCalls[0]).toEqual(
      expect.objectContaining({ id: "f1", parentId: "root" }),
    );
    expect(folderCalls[1]).toEqual(
      expect.objectContaining({ id: "new1", parentId: "ex" }),
    );
    expect(folderCalls[2]).toEqual(
      expect.objectContaining({ id: "f1", parentId: "root" }),
    );
    expect(folderCalls[3]).toEqual(
      expect.objectContaining({ id: "self2", parentId: "root" }),
    );
    expect(folderCalls[4]).toEqual(
      expect.objectContaining({ id: "deep", parentId: "root" }),
    );
  });

  it("skips folder records that already exist, but still allows children", async () => {
    mockDb.folders.findOne.mockImplementation(({ selector }: any) => ({
      exec: vi.fn().mockResolvedValue(
        selector.id === "f1" ? { id: "f1", parentId: "root" } : null,
      ),
    }));
    const result = await importer.importData(
      mockDb,
      jsonFile({
        folders: [
          { id: "f1", title: "Existing", parentId: "root" },
          { id: "child", title: "Child", parentId: "f1" },
        ],
        bookmarks: [],
        documents: [],
      }),
    );
    expect(result.success).toBe(true);
    expect(mockDb.folders.insert).toHaveBeenCalledTimes(1);
    expect(mockDb.folders.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "child", parentId: "f1" }),
    );
  });

  // ── CSV paths ────────────────────────────────────────────────────────────

  it("falls back to file.text() when File.stream is unavailable", async () => {
    const file = {
      name: "bookmarks.csv",
      size: 1024,
      text: vi.fn().mockResolvedValue("Title,URL\nF,https://fallback.com"),
    } as unknown as File;
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
    expect(file.text).toHaveBeenCalled();
  });

  it("streams CSV records with quoted newlines inside a field", async () => {
    const file = createStreamingCsvFile([
      'Title,URL\n"multi\nline",https://quoted.com\n',
    ]);
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
    expect(mockDb.bookmarks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ title: "multi\nline", url: "https://quoted.com" }),
    );
  });

  it("handles a quote split across stream chunks (pendingQuote)", async () => {
    const file = createStreamingCsvFile([
      "Title,URL\n\"split",
      "quoted\",https://split.com\n",
    ]);
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
    expect(mockDb.bookmarks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ title: "splitquoted", url: "https://split.com" }),
    );
  });

  it("parses escaped quotes and a final record without trailing newline", async () => {
    const file = new File(
      ['Title,URL\n"say ""hi""",https://escaped.com\n,https://notitle.com'],
      "data.csv",
      { type: "text/csv" },
    );
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(2);
    const calls = (mockDb.bookmarks.insert.mock.calls as any[][]).map(([doc]) => doc);
    expect(calls[0]).toEqual(
      expect.objectContaining({ title: 'say "hi"', url: "https://escaped.com" }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({ title: "https://notitle.com" }),
    );
  });

  it("skips CSV rows whose insert fails and keeps going", async () => {
    mockDb.bookmarks.insert
      .mockRejectedValueOnce(new Error("insert failed"))
      .mockResolvedValueOnce({});
    const file = new File(
      ["Title,URL\nBad,https://bad.com\nGood,https://good.com"],
      "data.csv",
      { type: "text/csv" },
    );
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it(
    "enforces the 100k record limit on the CSV path",
    async () => {
      // Rows without an http URL skip the crypto/DB work entirely (the limit
      // is enforced on recordIndex before any per-row processing).
      const file = createStreamingCsvRowsFile({
        rowCount: 100_001,
        name: "huge.csv",
        rowsPerChunk: 512,
        row: (index) => `S${index},\n`,
      });

      // The importer yields every 50 records so large real imports do not
      // monopolize the main thread. Fake that scheduler here: waiting for the
      // real zero-delay timers makes this boundary test take ~30s on Windows.
      vi.useFakeTimers();
      const resultPromise = importer.importData(mockDb, file);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain("too many records");
    },
    180_000,
  );

  it("reads Raindrop description/created columns and ;-separated tags", async () => {
    const file = new File(
      [
        "title,url,tags,description,created\n" +
          "T,https://t.com,a;b,desc text,1700000000",
      ],
      "raindrop.csv",
      { type: "text/csv" },
    );
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(mockDb.bookmarks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "desc text",
        tags: ["a", "b"],
        createdAt: new Date(1_700_000_000_000).toISOString(),
      }),
    );
  });

  it("falls back to positional columns when Raindrop headers do not match", async () => {
    const file = new File(
      ["foo,url\nBar,https://b.com"],
      "raindrop.csv",
      { type: "text/csv" },
    );
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(mockDb.bookmarks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Bar", url: "https://b.com" }),
    );
  });

  // ── Pocket HTML edge cases ───────────────────────────────────────────────

  it("handles missing href, missing tags and unix-millis add_date", async () => {
    const html =
      '<DL><DT><A HREF="https://m.com" ADD_DATE="1700000000000">M</A>' +
      "<DT><A ADD_DATE=\"0\">NoHref</A>" +
      "<DT><A HREF=\"https://u.com\"></A></DL>";
    const file = new File([html], "bk.html", { type: "text/html" });
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    const calls = (mockDb.bookmarks.insert.mock.calls as any[][]).map(([doc]) => doc);
    expect(calls[0].createdAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(calls[1]).toEqual(
      expect.objectContaining({ title: "Untitled", tags: ["pocket-import"] }),
    );
  });

  // ── Omnivore ─────────────────────────────────────────────────────────────

  it("imports root-shape Omnivore articles with mixed label shapes and no-url skips", async () => {
    const file = jsonFile(
      {
        articles: [
          {
            id: "1",
            title: "With labels",
            originalUrl: "https://orig.com",
            labels: ["dev", { name: "ai" }, { other: 1 }, 42],
            description: "desc",
            content: "body",
            savedAt: "2024-01-01",
            updatedAt: "2024-01-02",
          },
          { id: "2", title: "No url" },
          { id: "3", title: "Only content", url: "https://oc.com", content: "body3" },
        ],
      },
      "omnivore_export.json",
    );
    const result = await importer.importDataWithDetection(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    const byUrl = new Map(
      (mockDb.bookmarks.insert.mock.calls as any[][]).map(([doc]) => [doc.url, doc]),
    );
    const inserted = byUrl.get("https://orig.com");
    expect(inserted.tags).toEqual(["dev", "ai"]);
    // description wins over content for the content field.
    expect(inserted.content).toBe("desc");
    expect(inserted.summary).toBe("desc");
    // No description → content used directly.
    expect(byUrl.get("https://oc.com").content).toBe("body3");
  });

  it("returns a no-articles result for Omnivore files without an array", async () => {
    const file = jsonFile({ data: {} }, "omnivore_export.json");
    const result = await importer.importDataWithDetection(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(0);
    expect(result.error).toBe("No articles array found");
  });

  it("reports invalid Omnivore JSON through the detection path", async () => {
    const file = new File(["not json"], "omnivore_export.json", {
      type: "application/json",
    });
    const result = await importer.importDataWithDetection(mockDb, file);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid Omnivore JSON format");
  });

  // ── Markdown: single files ───────────────────────────────────────────────

  it("imports a frontmatter-less markdown file as a document", async () => {
    const file = new File(["# Heading\n\nBody"], "plain.md", {
      type: "text/markdown",
    });
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
  });

  it("imports a bookmark markdown note with a stable bmf_id", async () => {
    const file = new File(
      [
        "---\nurl: https://stable.com\nbmf_type: bookmark\nbmf_id: bmf-1\n" +
          "tags: [one, two]\ncreated: 2024-01-01\nupdated: 2024-01-02\n---\n" +
          "# Stable\n\n## Related\n\nhttps://ext.com\n",
      ],
      "stable.md",
      { type: "text/markdown" },
    );
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
    expect(mockDb.bookmarks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "bmf-1",
        url: "https://stable.com",
        title: "Stable",
        tags: ["one", "two"],
        relatedLinks: ["https://ext.com"],
      }),
    );
  });

  it("skips a markdown bookmark note with a non-http url", async () => {
    const file = new File(
      ["---\nurl: ftp://bad.com\n---\n# Bad"],
      "bad.md",
      { type: "text/markdown" },
    );
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  // ── Markdown: ZIP vaults ─────────────────────────────────────────────────

  it("rejects an invalid zip and a zip without markdown notes", async () => {
    const bad = new File([new Uint8Array([1, 2, 3])], "bad.zip", {
      type: "application/zip",
    });
    const badResult = await importer.importData(mockDb, bad);
    expect(badResult.success).toBe(false);
    expect(badResult.error).toBe("Invalid ZIP file. Upload a BookmarkForge or Obsidian export.");

    const zip = new JSZip();
    zip.file("attachments/img.png", new TextEncoder().encode("PNG"));
    const blob = await zip.generateAsync({ type: "blob" });
    const noNotes = new File([blob], "no-notes.zip", { type: "application/zip" });
    const noNotesResult = await importer.importData(mockDb, noNotes);
    expect(noNotesResult.success).toBe(false);
    expect(noNotesResult.error).toBe("No Markdown notes found in the ZIP file.");
  });

  it("skips directory entries inside the vault zip", async () => {
    const zip = new JSZip();
    zip.folder("sub");
    zip.file("sub/note.md", "# Sub note\n");
    const blob = await zip.generateAsync({ type: "blob" });
    const file = new File([blob], "vault.zip", { type: "application/zip" });
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
  });

  it("dedups bookmarks by url hash and by bmf_id across vault notes", async () => {
    mockDb.bookmarks.findOne.mockImplementation(({ selector }: any) => ({
      exec: vi.fn().mockResolvedValue(
        selector.urlHash ? { id: "existing" } : null,
      ),
    }));
    mockDb.documents.findOne.mockImplementation(({ selector }: any) => ({
      exec: vi.fn().mockResolvedValue(
        selector.id === "bmf-doc" ? { id: "bmf-doc" } : null,
      ),
    }));

    const zip = new JSZip();
    zip.file("dup-url.md", "---\nurl: https://dup.com\n---\n# Dup");
    zip.file("dup-bmf.md", "---\nurl: https://other.com\nbmf_type: document\nbmf_id: bmf-doc\n---\n# Dup doc");
    const blob = await zip.generateAsync({ type: "blob" });
    const file = new File([blob], "vault.zip", { type: "application/zip" });

    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(2);
  });

  it("resolves related wikilinks to bookmark URLs and keeps external URLs", async () => {
    const zip = new JSZip();
    zip.file("a.md", "---\nurl: https://a.com\n---\n# A");
    zip.file(
      "b.md",
      "---\nurl: https://b.com\n---\n# B\n\n## Related\n\n[[a]]\n\nhttps://ext.com\n\n[[missing]]\n\n[[a]]",
    );
    zip.file("c.md", "# Doc C");
    const blob = await zip.generateAsync({ type: "blob" });
    const file = new File([blob], "vault.zip", { type: "application/zip" });

    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(3);
    const byUrl = new Map(
      (mockDb.bookmarks.insert.mock.calls as any[][]).map(([doc]) => [doc.url, doc]),
    );
    expect(byUrl.get("https://b.com").relatedLinks).toEqual([
      "https://a.com",
      "https://ext.com",
    ]);
  });

  it("resolves linked-note wikilinks to imported document ids only", async () => {
    const zip = new JSZip();
    zip.file("d.md", "# D");
    zip.file(
      "e.md",
      "# E\n\n## Linked notes\n\n[[d]]\n\n[[missing]]\n\n[[d]]\n\n[[a]]",
    );
    zip.file("a.md", "---\nurl: https://a.com\n---\n# A");
    const blob = await zip.generateAsync({ type: "blob" });
    const file = new File([blob], "vault.zip", { type: "application/zip" });

    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(3);
    const byTitle = new Map(
      (mockDb.documents.insert.mock.calls as any[][]).map(([doc]) => [doc.title, doc]),
    );
    const e = byTitle.get("E");
    expect(e.links).toHaveLength(1);
    expect(e.links[0]).toBe(byTitle.get("D").id);
  });

  it("mirrors folder frontmatter paths into the folder tree, reusing segments", async () => {
    const zip = new JSZip();
    zip.file(
      "one.md",
      "---\nfolder: Notes/Work\n---\n# One",
    );
    zip.file(
      "two.md",
      "---\nfolder: Notes/Work\n---\n# Two",
    );
    zip.file(
      "three.md",
      "---\nfolder: ../evil\n---\n# Three",
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const file = new File([blob], "vault.zip", { type: "application/zip" });

    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(3);
    // Notes/Work creates 2 folders; the second note reuses them.
    expect(mockDb.folders.insert).toHaveBeenCalledTimes(2);
    const byTitle = new Map(
      (mockDb.documents.insert.mock.calls as any[][]).map(([doc]) => [doc.title, doc]),
    );
    expect(byTitle.get("One").folderId).toBeDefined();
    expect(byTitle.get("Two").folderId).toBe(byTitle.get("One").folderId);
    // ../evil is rejected by sanitizeFolderPath → root.
    expect(byTitle.get("Three").folderId).toBe("root");
  });

  it("persists duplicate attachment refs once per normalized path and rewrites all", async () => {
    const zip = new JSZip();
    const png = new TextEncoder().encode("PNGDATA");
    zip.file(
      "note.md",
      "---\ntitle: \"Note\"\nfolder: \"\"\n---\n\n" +
        "![x](attachments/img.png)\n\n" +
        "![y](../attachments/img.png)\n\n" +
        "![z](attachments/missing.png)\n\n" +
        "![w](attachments/)\n",
    );
    zip.file("attachments/img.png", png);
    const blob = await zip.generateAsync({ type: "blob" });
    const file = new File([blob], "vault.zip", { type: "application/zip" });

    const persistFileMock = vi.mocked(attachmentStore).persistFile;
    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    // Both refs normalize to the same path → persisted once, rewritten twice.
    expect(persistFileMock).toHaveBeenCalledTimes(1);
    const inserted = (mockDb.documents.insert.mock.calls as any)[0][0];
    expect(inserted.textContent).toContain("bmf-attachment://att-mock");
    // Missing attachment and empty path refs stay verbatim.
    expect(inserted.textContent).toContain("attachments/missing.png");
    expect(inserted.textContent).toContain("attachments/)");
  });

  it("logs and skips markdown notes whose insert fails", async () => {
    mockDb.documents.insert.mockRejectedValueOnce(new Error("boom"));
    const zip = new JSZip();
    zip.file("broken.md", "# Broken");
    zip.file("fine.md", "# Fine");
    const blob = await zip.generateAsync({ type: "blob" });
    const file = new File([blob], "vault.zip", { type: "application/zip" });

    const result = await importer.importData(mockDb, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    const { logger } = await import("../../utils/logger");
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "[UniversalImporter] Failed to import markdown note",
      expect.objectContaining({ slug: "broken" }),
    );
  });
});