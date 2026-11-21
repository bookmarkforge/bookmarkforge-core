/**
 * Tests for rxdb-optimized.ts
 * Mocks RxCollection, hardwareDetector and logger
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockHardwareDetector = vi.hoisted(() => ({
  getDeviceTier: vi.fn(),
}));
vi.mock("../../services/HardwareDetectorService", () => ({
  hardwareDetector: mockHardwareDetector,
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { logger } from "../../utils/logger";
import {
  createCompositeIndexes,
  createOptimizedQuery,
  executeCachedQuery,
  batchInsert,
  bulkUpdate,
  searchWithRelevance,
  QueryProfiler,
  queryCache,
  RECOMMENDED_INDEXES,
  queryProfiler,
} from "../../db/rxdb-optimized";

interface Doc {
  id: string;
  userId: string;
  title: string;
  description: string;
  tags: string[];
}

function matchCondition(doc: Doc, field: string, cond: unknown): boolean {
  if (
    cond &&
    typeof cond === "object" &&
    (cond as Record<string, unknown>).$regex !== undefined
  ) {
    const re = new RegExp(
      String((cond as Record<string, unknown>).$regex),
      "i",
    );
    const v = (doc as unknown as Record<string, unknown>)[field];
    if (Array.isArray(v))
      return v.some((x) => typeof x === "string" && re.test(x));
    return re.test(String(v ?? ""));
  }
  return (doc as unknown as Record<string, unknown>)[field] === cond;
}

function matchSelector(doc: Doc, sel: Record<string, unknown>): boolean {
  if (sel.$or && Array.isArray(sel.$or)) {
    return (sel.$or as Array<Record<string, unknown>>).some((sub) =>
      Object.entries(sub).every(([k, v]) => matchCondition(doc, k, v)),
    );
  }
  return Object.entries(sel).every(([k, v]) => matchCondition(doc, k, v));
}

function makeCollection(docs: Doc[]) {
  const store = new Map<string, Doc>(docs.map((d) => [d.id, { ...d }]));
  const col = {
    name: "bookmarks",
    find: vi.fn(function (q?: { selector?: unknown; limit?: number }) {
      let results = docs;
      if (q?.selector) {
        const sel = q.selector as Record<string, unknown>;
        results = docs.filter((d) => matchSelector(d, sel));
      }
      if (q?.limit) results = results.slice(0, q.limit);
      const queryObj: Record<string, unknown> = {
        sort: () => queryObj,
        skip: () => queryObj,
        limit: () => queryObj,
        exec: vi.fn().mockResolvedValue(
          results.map((d) => ({
            toJSON: () => d,
            incrementalPatch: vi.fn(async (patch: Partial<Doc>) => {
              const cur = store.get(d.id)!;
              store.set(d.id, { ...cur, ...patch });
            }),
          })),
        ),
      };
      return queryObj;
    }),
    bulkInsert: vi.fn((batch: Doc[]) => {
      for (const b of batch) store.set(b.id, { ...b });
      return Promise.resolve({
        success: batch.map((b) => ({ id: b.id })),
        error: [],
      });
    }),
    findByIds: vi.fn((ids: string[]) => {
      const m = new Map<string, unknown>();
      for (const id of ids) {
        const d = store.get(id);
        if (d) {
          m.set(id, {
            toJSON: () => d,
            incrementalPatch: vi.fn(async (patch: Partial<Doc>) => {
              store.set(id, { ...d, ...patch });
            }),
          });
        }
      }
      return Promise.resolve(m);
    }),
  };
  return col as unknown as import("rxdb").RxCollection<Doc>;
}

describe("createCompositeIndexes", () => {
  const mockCollection = {
    getIndexes: vi.fn(),
    createIndex: vi.fn(),
  } as any;

  it("should create indexes that do not exist", async () => {
    mockCollection.getIndexes.mockResolvedValue([{ name: "existing" }]);
    await createCompositeIndexes(mockCollection, [
      { name: "new_idx", fields: ["userId", "createdAt"] },
    ]);
    expect(mockCollection.createIndex).toHaveBeenCalledWith({
      name: "new_idx",
      fields: ["userId", "createdAt"],
    });
  });

  it("should not create indexes that already exist", async () => {
    const localCollection = {
      getIndexes: vi.fn().mockResolvedValue([{ name: "existing" }]),
      createIndex: vi.fn(),
    } as any;
    await createCompositeIndexes(localCollection, [
      { name: "existing", fields: ["a"] },
    ]);
    expect(localCollection.createIndex).not.toHaveBeenCalled();
  });

  it("should handle error during index creation", async () => {
    mockCollection.getIndexes.mockResolvedValue([]);
    mockCollection.createIndex.mockRejectedValue(new Error("Index error"));
    await expect(
      createCompositeIndexes(mockCollection, [
        { name: "bad_idx", fields: ["x"] },
      ]),
    ).resolves.toBeUndefined(); // Must not throw
  });

  it("skips when getIndexes/createIndex are unavailable", async () => {
    const col = {
      name: "bookmarks",
    } as unknown as import("rxdb").RxCollection<Doc>;
    await expect(
      createCompositeIndexes(col, RECOMMENDED_INDEXES),
    ).resolves.toBeUndefined();
  });
});

describe("RECOMMENDED_INDEXES", () => {
  it("should contain indexes for bookmarks", () => {
    const bookmarkIndexes = RECOMMENDED_INDEXES.filter((i) =>
      i.name.startsWith("idx_bookmarks"),
    );
    expect(bookmarkIndexes.length).toBeGreaterThan(0);
  });

  it("should contain indexes for tasks", () => {
    const taskIndexes = RECOMMENDED_INDEXES.filter((i) =>
      i.name.startsWith("idx_tasks"),
    );
    expect(taskIndexes.length).toBeGreaterThan(0);
  });
});

describe("createOptimizedQuery", () => {
  it("builds a query with selector and options", () => {
    const col = makeCollection([]);
    const query = createOptimizedQuery(
      col,
      { userId: "u1" },
      { sort: [{ createdAt: "asc" }], limit: 5, skip: 2 },
    );
    expect(query).toBeDefined();
    // sort/skip/limit are passed inside the MangoQuery object to `find()`
    // (RxDB's chainable .sort() replaces rather than accumulates, so
    // multi-field sorts must go through the query object).
    expect(col.find).toHaveBeenCalledWith({
      selector: { userId: "u1" },
      sort: [{ createdAt: "asc" }],
      skip: 2,
      limit: 5,
    });
  });
});

describe("executeCachedQuery", () => {
  const mockCollection = {
    name: "test",
    find: vi.fn(() => mockQuery),
  } as any;
  const mockQuery = {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([{ id: "1" }]),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should run query and cache result", async () => {
    const results = await executeCachedQuery(mockCollection, { id: "1" } as any);
    expect(results).toEqual([{ id: "1" }]);
  });

  it("should use cache on second call", async () => {
    await executeCachedQuery(mockCollection, { id: "1" } as any);
    mockCollection.find = vi.fn(() => mockQuery);
    const spy = vi.spyOn(mockQuery, "exec");
    const results = await executeCachedQuery(mockCollection, { id: "1" } as any);
    expect(spy).not.toHaveBeenCalled();
    expect(results).toEqual([{ id: "1" }]);
  });

  it("uses an explicit cacheKey and serves from cache on repeat", async () => {
    const col = makeCollection([
      { id: "1", userId: "u1", title: "A", description: "", tags: [] },
    ]);
    const r1 = await executeCachedQuery(
      col,
      { userId: "u1" },
      { cacheKey: "explicit" },
    );
    expect(r1).toHaveLength(1);
    expect(queryCache.get("explicit")).not.toBeNull();
    const callsBefore = (col.find as ReturnType<typeof vi.fn>).mock.calls
      .length;
    const r2 = await executeCachedQuery(
      col,
      { userId: "u1" },
      { cacheKey: "explicit" },
    );
    expect(r2).toHaveLength(1);
    expect((col.find as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsBefore,
    );
  });
});

describe("batchInsert", () => {
  it("should insert documents in batches", async () => {
    const mockCollection = {
      name: "test",
      bulkInsert: vi.fn((batch: unknown[]) =>
        Promise.resolve({ success: batch, error: [] }),
      ),
    } as any;

    const docs = Array.from({ length: 5 }, (_, i) => ({ id: `doc-${i}` }));
    const results = await batchInsert(mockCollection, docs, 2);
    expect(results).toHaveLength(5);
    // 5 docs / batchSize 2 → 3 bulkInsert batches
    expect(mockCollection.bulkInsert).toHaveBeenCalledTimes(3);
  });

  it("inserts all docs and splits into batches (realistic collection)", async () => {
    const docs = Array.from({ length: 250 }, (_, i) => ({
      id: String(i),
      userId: "u",
      title: `t${i}`,
      description: "",
      tags: [],
    }));
    const col = makeCollection(docs);
    const result = await batchInsert(col, docs, 100);
    expect(result).toHaveLength(250);
    expect(col.bulkInsert).toHaveBeenCalledTimes(3);
  });

  it("reports errors from a failing batch", async () => {
    const col = makeCollection([]) as unknown as import("rxdb").RxCollection<Doc>;
    (col as unknown as { bulkInsert: ReturnType<typeof vi.fn> }).bulkInsert =
      vi.fn().mockResolvedValue({
        success: [],
        error: [{ message: "dup" }],
      });
    const result = await batchInsert(col, [
      { id: "1", userId: "u", title: "A", description: "", tags: [] },
    ]);
    expect(result).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("bulkUpdate", () => {
  const mockCollection = {
    findByIds: vi.fn(),
    name: "test",
  } as any;

  it("should update documents", async () => {
    const doc1 = { incrementalPatch: vi.fn() };
    const doc2 = { incrementalPatch: vi.fn() };
    mockCollection.findByIds.mockResolvedValue(
      new Map([
        ["1", doc1],
        ["2", doc2],
      ]),
    );

    await bulkUpdate(mockCollection, [
      { id: "1", data: { title: "Updated 1" } },
      { id: "2", data: { title: "Updated 2" } },
    ]);

    expect(doc1.incrementalPatch).toHaveBeenCalledWith({ title: "Updated 1" });
    expect(doc2.incrementalPatch).toHaveBeenCalledWith({ title: "Updated 2" });
  });

  it("logs failures for missing docs", async () => {
    const col = makeCollection([]);
    await bulkUpdate(col, [{ id: "ghost", data: { title: "X" } }]);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("searchWithRelevance", () => {
  const mockCollection = {
    find: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: "1",
            title: "Hello World",
            description: "A test",
            tags: ["tag1"],
          }),
        },
        {
          toJSON: () => ({
            id: "2",
            title: "Other",
            description: "No match",
            tags: [],
          }),
        },
        {
          toJSON: () => ({
            id: "3",
            title: "Hello Again",
            description: "Another hello",
            tags: ["hello"],
          }),
        },
      ]),
    })),
  } as any;

  it("should search and sort by relevance", async () => {
    const results = await searchWithRelevance(mockCollection as any, "hello");
    expect(results).toHaveLength(2);
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
  });

  it("should return empty array if there are no matches", async () => {
    const results = await searchWithRelevance(mockCollection as any, "zzz");
    expect(results).toHaveLength(0);
  });

  it("should limit results", async () => {
    const results = await searchWithRelevance(mockCollection as any, "hello", {
      limit: 1,
    });
    expect(results).toHaveLength(1);
  });

  it("truncates queries with too many terms", async () => {
    const docs: Doc[] = [
      {
        id: "1",
        userId: "u",
        title: "React hooks",
        description: "state",
        tags: ["react"],
      },
    ];
    const col = makeCollection(docs);
    const many = Array.from({ length: 15 }, (_, i) => `term${i}`).join(" ");
    await searchWithRelevance(col, many, { limit: 10 });
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("QueryProfiler", () => {
  let profiler: QueryProfiler;

  beforeEach(() => {
    profiler = new QueryProfiler();
  });

  it("should record metrics", () => {
    profiler.record({
      query: "test",
      duration: 50,
      resultCount: 5,
      cached: false,
    });
    const stats = profiler.getStats();
    expect(stats.totalQueries).toBe(1);
    expect(stats.avgDuration).toBe(50);
  });

  it("getSlowQueries should return slow queries", () => {
    profiler.record({
      query: "fast",
      duration: 50,
      resultCount: 1,
      cached: false,
    });
    profiler.record({
      query: "slow",
      duration: 200,
      resultCount: 1,
      cached: false,
    });
    const slow = profiler.getSlowQueries(100);
    expect(slow).toHaveLength(1);
    expect(slow[0]!.query).toBe("slow");
  });

  it("getStats should return zeros if there are no metrics", () => {
    const stats = profiler.getStats();
    expect(stats.avgDuration).toBe(0);
    expect(stats.totalQueries).toBe(0);
    expect(stats.cacheHitRate).toBe(0);
  });

  it("clear should clear metrics", () => {
    profiler.record({
      query: "test",
      duration: 10,
      resultCount: 1,
      cached: false,
    });
    profiler.clear();
    expect(profiler.getStats().totalQueries).toBe(0);
  });

  it("should limit the number of metrics", () => {
    (profiler as any).maxMetrics = 3;
    for (let i = 0; i < 5; i++) {
      profiler.record({
        query: `q${i}`,
        duration: 10,
        resultCount: 1,
        cached: false,
      });
    }
    expect(profiler.getStats().totalQueries).toBe(3);
  });
});
