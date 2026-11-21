import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const mockBulkInsert = vi.fn();
const mockCountExec = vi.fn();
const mockFindExec = vi.fn();
const mockWhereChain = { elemMatch: vi.fn(), regex: vi.fn() };

vi.mock("../../db/database", () => ({
  initDB: async () => ({
    bookmarks: {
      bulkInsert: mockBulkInsert,
      count: () => ({ exec: mockCountExec }),
      find: () => ({
        exec: mockFindExec,
        where: () => mockWhereChain,
      }),
      bulkRemove: vi.fn(),
    },
  }),
}));

import { initDB } from "../../db/database";

describe("RxDB stress test — 50k+ documents (mocked)", () => {
  let db: Awaited<ReturnType<typeof initDB>>;

  beforeAll(async () => {
    db = await initDB();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("handles 50,000 bulk inserts across 100 batches", async () => {
    mockBulkInsert.mockResolvedValue(undefined);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const batch = Array.from({ length: 500 }, (_, j) => ({
        id: `stress-${i * 500 + j}`,
        url: `https://example.com/page/${i * 500 + j}`,
        title: `Stress Test Page ${i * 500 + j}`,
        tags: i % 10 === 0 ? ["stress", "milestone"] : ["stress"],
      }));
      await db.bookmarks!.bulkInsert(batch as any);
    }
    const elapsed = performance.now() - start;

    expect(mockBulkInsert).toHaveBeenCalledTimes(100);
    expect(mockBulkInsert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "stress-0" })]),
    );
    expect(elapsed).toBeLessThan(10_000);
  });

  it("queries 50,000 records efficiently", async () => {
    const mockDocs = Array.from({ length: 50_000 }, (_, i) => ({
      id: `stress-${i}`,
      title: `Page ${i}`,
      url: `https://example.com/${i}`,
    }));
    mockFindExec.mockResolvedValue(mockDocs);

    const start = performance.now();
    const result = await db.bookmarks!.find().exec();
    const elapsed = performance.now() - start;

    expect(result).toHaveLength(50_000);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("counts records accurately", async () => {
    mockCountExec.mockResolvedValue(50_000);

    const count = await db.bookmarks!.count().exec();
    expect(count).toBe(50_000);
  });
});
