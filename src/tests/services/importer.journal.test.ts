import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createImportExecutionOptions,
  clearPersistedRollback,
  getLimitResult,
  insertTrackedBookmark,
  insertTrackedDocument,
  insertTrackedFolder,
  loadPendingRollback,
  persistPendingRollback,
  rollbackImport,
  throwIfAborted,
  FreeTierImportLimitReached,
  type ImportJournal,
} from "../../services/importer.journal";
import { STORAGE_KEYS } from "../../constants/storage-keys";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../services/LicenseService", () => ({
  isFreeLimitError: (error: unknown) =>
    error instanceof Error && error.name === "LicenseError" &&
    (error as { code?: string }).code === "FREE_LIMIT_REACHED",
}));

const KEY = STORAGE_KEYS.PENDING_IMPORT_ROLLBACK;

function makeDb() {
  const removed = {
    bookmarks: [] as string[],
    documents: [] as string[],
    folders: [] as string[],
  };
  // find() must return only the docs matching the $in selector.
  const smartCollection = (name: keyof typeof removed) => {
    const store = new Map<string, { id: string }>();
    return {
      store,
      find: vi.fn((query: { selector: { id: { $in: string[] } } }) => ({
        exec: vi.fn(async () =>
          query.selector.id.$in
            .map((id) => store.get(id))
            .filter((d): d is { id: string } => d !== undefined),
        ),
      })),
      bulkRemove: vi.fn(async (items: { id: string }[]) => {
        for (const item of items) {
          store.delete(item.id);
          removed[name].push(item.id);
        }
      }),
      insert: vi.fn(async (doc: { id: string }) => {
        store.set(doc.id, doc);
        return doc;
      }),
    };
  };
  return {
    removed,
    bookmarks: smartCollection("bookmarks"),
    documents: smartCollection("documents"),
    folders: smartCollection("folders"),
  };
}

const emptyJournal = (): ImportJournal => ({
  bookmarkIds: [],
  documentIds: [],
  folderIds: [],
});

describe("pending rollback persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a journal through sessionStorage", () => {
    const journal: ImportJournal = {
      bookmarkIds: ["b1", "b2"],
      documentIds: ["d1"],
      folderIds: ["f1"],
    };
    persistPendingRollback(journal);
    expect(loadPendingRollback()).toEqual(journal);
  });

  it("returns null when nothing is stored", () => {
    expect(loadPendingRollback()).toBeNull();
  });

  it("rejects and clears entries with a wrong version", () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        createdAt: Date.now(),
        bookmarkIds: [],
        documentIds: [],
        folderIds: [],
      }),
    );
    expect(loadPendingRollback()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("rejects expired and future-dated journals", () => {
    const base = {
      version: 2,
      bookmarkIds: [],
      documentIds: [],
      folderIds: [],
    };
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...base, createdAt: Date.now() - 25 * 60 * 60 * 1000 }),
    );
    expect(loadPendingRollback()).toBeNull();

    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...base, createdAt: Date.now() + 60_000 }),
    );
    expect(loadPendingRollback()).toBeNull();
  });

  it("rejects malformed id lists", () => {
    const base = { version: 2, createdAt: Date.now() };
    for (const bad of [
      { bookmarkIds: "not-array", documentIds: [], folderIds: [] },
      { bookmarkIds: [""], documentIds: [], folderIds: [] },
      { bookmarkIds: ["x".repeat(201)], documentIds: [], folderIds: [] },
      { bookmarkIds: [42], documentIds: [], folderIds: [] },
      { bookmarkIds: [], documentIds: [], folderIds: [null] },
    ]) {
      sessionStorage.setItem(KEY, JSON.stringify({ ...base, ...bad }));
      expect(loadPendingRollback()).toBeNull();
    }
  });

  it("clearPersistedRollback removes the entry", () => {
    persistPendingRollback(emptyJournal());
    clearPersistedRollback();
    expect(loadPendingRollback()).toBeNull();
  });
});

describe("rollbackImport", () => {
  it("removes journaled docs across all three collections", async () => {
    const db = makeDb();
    await db.bookmarks.insert({ id: "b1" });
    await db.documents.insert({ id: "d1" });
    await db.folders.insert({ id: "f1" });
    const result = await rollbackImport(db as never, {
      bookmarkIds: ["b1", "b2-missing"],
      documentIds: ["d1"],
      folderIds: ["f1"],
    });
    expect(result.completed).toBe(true);
    expect(db.removed.bookmarks).toEqual(["b1"]);
    expect(db.removed.documents).toEqual(["d1"]);
    expect(db.removed.folders).toEqual(["f1"]);
  });

  it("reports incomplete when a bulkRemove fails but still attempts the rest", async () => {
    const db = makeDb();
    await db.bookmarks.insert({ id: "b1" });
    await db.documents.insert({ id: "d1" });
    db.bookmarks.bulkRemove.mockRejectedValueOnce(new Error("io error"));
    const result = await rollbackImport(db as never, {
      bookmarkIds: ["b1"],
      documentIds: ["d1"],
      folderIds: [],
    });
    expect(result.completed).toBe(false);
    expect(db.removed.documents).toEqual(["d1"]);
  });

  it("batches removals at 500 ids per find", async () => {
    const db = makeDb();
    const ids = Array.from({ length: 501 }, (_, i) => `b${i}`);
    for (const id of ids) await db.bookmarks.insert({ id });
    const result = await rollbackImport(db as never, {
      bookmarkIds: ids,
      documentIds: [],
      folderIds: [],
    });
    expect(result.completed).toBe(true);
    expect(db.bookmarks.find).toHaveBeenCalledTimes(2);
    expect(db.removed.bookmarks).toHaveLength(501);
  });
});

describe("insertTracked*", () => {
  it("inserts and records ids in the journal", async () => {
    const db = makeDb();
    const journal = emptyJournal();
    await insertTrackedBookmark(db as never, { id: "b1" } as never, journal);
    await insertTrackedDocument(db as never, { id: "d1" } as never, journal);
    await insertTrackedFolder(db as never, { id: "f1" } as never, journal);
    expect(journal).toEqual({
      bookmarkIds: ["b1"],
      documentIds: ["d1"],
      folderIds: ["f1"],
    });
  });

  it("works without a journal", async () => {
    const db = makeDb();
    await expect(
      insertTrackedBookmark(db as never, { id: "b1" } as never),
    ).resolves.toBeUndefined();
  });
});

describe("getLimitResult", () => {
  const execOptions = () => ({
    ...createImportExecutionOptions({}),
    importedCount: 42,
  });

  it("returns null for unrelated errors", () => {
    expect(getLimitResult(new Error("boom"), execOptions())).toBeNull();
  });

  it("maps FreeTierImportLimitReached to a partial-success result", () => {
    const result = getLimitResult(
      new FreeTierImportLimitReached(7, 3),
      execOptions(),
    );
    expect(result).toMatchObject({
      success: true,
      importedCount: 7,
      skippedCount: 3,
      limitReached: true,
    });
  });

  it("maps a LicenseError free-limit to a partial-success result", () => {
    const err = new Error("cap") as Error & { code: string };
    err.name = "LicenseError";
    err.code = "FREE_LIMIT_REACHED";
    const result = getLimitResult(err, execOptions());
    expect(result).toMatchObject({
      success: true,
      importedCount: 42,
      limitReached: true,
    });
  });
});

describe("throwIfAborted / createImportExecutionOptions", () => {
  it("throws AbortError only when the signal is aborted", () => {
    expect(() => throwIfAborted()).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
    const ctrl = new AbortController();
    ctrl.abort();
    try {
      throwIfAborted(ctrl.signal);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).name).toBe("AbortError");
    }
  });

  it("creates fresh journal state per execution", () => {
    const a = createImportExecutionOptions({});
    const b = createImportExecutionOptions({});
    a.journal.bookmarkIds.push("x");
    expect(b.journal.bookmarkIds).toEqual([]);
    expect(a.recordsSeen).toBe(0);
    expect(a.importedCount).toBe(0);
  });
});
