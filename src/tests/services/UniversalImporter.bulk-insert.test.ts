/**
 * Batched bookmark insertion in `flushBookmarkInsertWindow`.
 *
 * The dedup lookup is batched per window; these tests pin the write half of
 * that window: one `bulkInsert` per chunk, per-document errors counted as
 * skipped, and the per-record fallback that keeps the Free wall's partial
 * accounting exact (a `preInsert` throw rejects the whole batch, writing
 * nothing).
 */
vi.mock("../../services/documentAttachments", () => ({
  attachmentStore: {
    persistFile: vi.fn().mockResolvedValue("att-mock"),
  },
}));

import { UniversalImporter } from "../../services/UniversalImporter";
import { LicenseError } from "../../services/LicenseService";
import type { BookmarkForgeDB } from "../../db/types";
import { createStreamingCsvRowsFile } from "../helpers/csvFixtures";

type BulkInsertOutcome =
  | { success?: unknown[]; error?: { documentId?: string }[] }
  | undefined;

function makeDb(
  bulkInsert?: (documents: unknown[]) => Promise<BulkInsertOutcome>,
) {
  return {
    bookmarks: {
      findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
      find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      insert: vi.fn().mockResolvedValue({}),
      bulkInsert: vi.fn(
        bulkInsert ??
          (async (documents: unknown[]) => ({ success: documents, error: [] })),
      ),
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

function jsonFile(bookmarks: Array<{ url: string; title?: string }>): File {
  return new File([JSON.stringify({ bookmarks })], "export.json", {
    type: "application/json",
  });
}

function urls(count: number): Array<{ url: string; title: string }> {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://bulk${index}.example`,
    title: `Bulk ${index}`,
  }));
}

describe("UniversalImporter batched bookmark insert", () => {
  let importer: UniversalImporter;

  beforeEach(() => {
    vi.clearAllMocks();
    importer = new UniversalImporter();
  });

  it("writes a dedup window with one bulkInsert call instead of per-row inserts", async () => {
    const db = makeDb();

    const result = await importer.importData(db as unknown as BookmarkForgeDB, jsonFile(urls(3)));

    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(3);
    expect(result.skippedCount).toBe(0);
    expect(db.bookmarks.bulkInsert).toHaveBeenCalledTimes(1);
    expect(db.bookmarks.bulkInsert.mock.calls[0]![0]).toHaveLength(3);
    expect(db.bookmarks.insert).not.toHaveBeenCalled();
  });

  it("splits a large window into bounded chunks", async () => {
    const db = makeDb();

    const result = await importer.importData(db as unknown as BookmarkForgeDB, jsonFile(urls(250)));

    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(250);
    // 250 candidates / BOOKMARK_BULK_INSERT_CHUNK (100) → 100 + 100 + 50.
    expect(db.bookmarks.bulkInsert).toHaveBeenCalledTimes(3);
    const sizes = (db.bookmarks.bulkInsert.mock.calls as unknown[][][]).map(
      ([docs]) => (docs as unknown[]).length,
    );
    expect(sizes).toEqual([100, 100, 50]);
    expect(db.bookmarks.insert).not.toHaveBeenCalled();
  });

  it("counts a document listed in the error array as skipped, without journaling it", async () => {
    let received: Array<{ id: string; url: string }> = [];
    const db = makeDb(async (documents) => {
      received = documents as Array<{ id: string; url: string }>;
      return {
        success: [documents[0]],
        error: [{ documentId: (documents[1] as { id: string }).id }],
      };
    });

    const result = await importer.importData(db as unknown as BookmarkForgeDB, jsonFile(urls(2)));

    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    // The failed row is reported through the result, never retried per row.
    expect(db.bookmarks.insert).not.toHaveBeenCalled();
    expect(received).toHaveLength(2);
  });

  it("falls back to per-row inserts when the Free wall rejects the whole batch", async () => {
    const limitError = new LicenseError(
      "Free plan limit reached",
      "FREE_LIMIT_REACHED",
    );
    const db = makeDb(async () => {
      throw limitError;
    });
    db.bookmarks.insert
      .mockResolvedValueOnce({})
      .mockRejectedValue(limitError);

    const result = await importer.importData(db as unknown as BookmarkForgeDB, jsonFile(urls(3)));

    // One row lands before the wall; the rest never reach the collection.
    expect(result).toMatchObject({
      success: true,
      importedCount: 1,
      skippedCount: 0,
      limitReached: true,
    });
    expect(db.bookmarks.bulkInsert).toHaveBeenCalledTimes(1);
    expect(db.bookmarks.insert).toHaveBeenCalledTimes(2);
  });

  it("keeps working when the adapter exposes no bulkInsert", async () => {
    const db = makeDb();
    delete (db.bookmarks as { bulkInsert?: unknown }).bulkInsert;

    const result = await importer.importData(db as unknown as BookmarkForgeDB, jsonFile(urls(2)));

    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(2);
    expect(db.bookmarks.insert).toHaveBeenCalledTimes(2);
  });

  it("journals the bulk-inserted ids so an abort rolls back exactly those", async () => {
    const db = makeDb();
    const controller = new AbortController();
    let progressCalls = 0;
    const file = createStreamingCsvRowsFile({
      rowCount: 600,
      name: "bulk.csv",
      row: (index) => `Site ${index},https://site${index}.com\n`,
    });

    const result = await importer.importData(db as unknown as BookmarkForgeDB, file, {
      signal: controller.signal,
      onProgress: () => {
        progressCalls += 1;
        if (progressCalls === 10) {
          controller.abort();
        }
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Import cancelled");

    const chunks = db.bookmarks.bulkInsert.mock.calls as unknown[][][];
    const written = chunks.flatMap(([docs]) => docs as Array<{ id: string }>);
    // The first 400-row window flushed before the abort at record 450.
    expect(written).toHaveLength(400);
    expect(chunks.every(([docs]) => (docs as unknown[]).length <= 100)).toBe(
      true,
    );

    // Rollback looks the journal ids up by `$in`; the union across its batches
    // must be exactly what the bulk writes landed.
    const rollbackIds = (
      db.bookmarks.find.mock.calls as unknown as Array<[
        { selector?: { id?: { $in?: string[] } } },
      ]>
    )
      .map(([query]) => query?.selector?.id?.$in)
      .filter((ids): ids is string[] => Array.isArray(ids))
      .flat();
    expect(rollbackIds.sort()).toEqual(written.map((doc) => doc.id).sort());
  });
});
