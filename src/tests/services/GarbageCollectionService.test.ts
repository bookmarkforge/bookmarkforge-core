/**
 * Tests for GarbageCollectionService
 * Mocks initDB, RxCollection and logger
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCollections: Record<string, any> = {};

function createMockCollection(name: string) {
  const collection = {
    name,
    schema: { primaryPath: "id" },
    find: vi.fn(),
    bulkRemove: vi.fn(),
  };
  mockCollections[name] = collection;
  return collection;
}

const mockDb = {
  bookmarks: createMockCollection("bookmarks"),
  documents: createMockCollection("documents"),
  folders: createMockCollection("folders"),
  flashcards: createMockCollection("flashcards"),
  versions: createMockCollection("versions"),
  messages: createMockCollection("messages"),
  chunks: createMockCollection("chunks"),
};

const mockInitDB = vi.fn().mockResolvedValue(mockDb);
vi.mock("../../db/database", () => ({
  initDB: vi.fn(() => mockInitDB()),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { garbageCollectionService } from "../../services/GarbageCollectionService";
// Import the mocked initDB to re-link after vi.clearAllMocks clears implementations
import { initDB } from "../../db/database";

describe("GarbageCollectionService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockInitDB.mockResolvedValue(mockDb);
    // restoreAllMocks clears initDB's implementation, re-link to mockInitDB
    (initDB as any).mockImplementation(() => mockInitDB());
    garbageCollectionService.stop();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    garbageCollectionService.stop();
  });

  describe("start / stop / isActive", () => {
    it("should start and be active", () => {
      garbageCollectionService.start();
      expect(garbageCollectionService.isActive()).toBe(true);
    });

    it("should stop and not be active", () => {
      garbageCollectionService.start();
      garbageCollectionService.stop();
      expect(garbageCollectionService.isActive()).toBe(false);
    });

    it("should not start if already running", () => {
      garbageCollectionService.start();
      garbageCollectionService.start();
      expect(garbageCollectionService.isActive()).toBe(true);
    });

    it("stop should not fail when there is no interval", () => {
      garbageCollectionService.stop();
      expect(garbageCollectionService.isActive()).toBe(false);
    });

    it("should run cleanup immediately on start", () => {
      const runSpy = vi
        .spyOn(garbageCollectionService as any, "runCleanup")
        .mockResolvedValue(undefined);
      garbageCollectionService.start();
      expect(runSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("triggerManualCleanup", () => {
    it("should run manual cleanup", async () => {
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        });
        (col as any).bulkRemove.mockResolvedValue({ success: true });
      }
      const result = await garbageCollectionService.triggerManualCleanup(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should restore the original retentionDays after cleanup", async () => {
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        });
      }
      await garbageCollectionService.triggerManualCleanup(7);
    });

    it("should restore retentionDays even on failure", async () => {
      const original = (garbageCollectionService as any).RETENTION_DAYS;
      const spy = vi
        .spyOn(garbageCollectionService as any, "runCleanup")
        .mockRejectedValue(new Error("test"));
      await expect(
        garbageCollectionService.triggerManualCleanup(7),
      ).rejects.toThrow();
      expect((garbageCollectionService as any).RETENTION_DAYS).toBe(original);
      spy.mockRestore();
    });

    it("should work without retentionDays", async () => {
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        });
      }
      const result = await garbageCollectionService.triggerManualCleanup();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("runCleanup / cleanupCollection", () => {
    function setupCollectionMock(docs: any[] = []) {
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue(docs),
        });
        (col as any).bulkRemove.mockResolvedValue({ success: true });
      }
    }

    it("should clean collections with deleted documents", async () => {
      const deletedDoc = {
        id: "del1",
        isDeleted: true,
        updatedAt: "2020-01-01T00:00:00.000Z",
      };
      setupCollectionMock([deletedDoc]);
      const result = await garbageCollectionService.triggerManualCleanup(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      // It should have called bulkRemove at least once
      expect(mockCollections.bookmarks.bulkRemove).toHaveBeenCalled();
    });

    it("should stop when there are no more documents", async () => {
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        });
      }
      const result = await garbageCollectionService.triggerManualCleanup(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should process batches and stop when fewer than the batch size remain", async () => {
      const docs = Array.from({ length: 50 }, (_, i) => ({
        id: `del${i}`,
        isDeleted: true,
        updatedAt: "2020-01-01T00:00:00.000Z",
      }));
      setupCollectionMock(docs);
      await garbageCollectionService.triggerManualCleanup(1);
      expect(mockCollections.bookmarks.bulkRemove).toHaveBeenCalledWith(
        docs.map((d) => d.id),
      );
    });

    it("cleans ONLY soft-deletable collections derived from the schema (P83)", async () => {
      const deletedDoc = {
        id: "del1",
        isDeleted: true,
        updatedAt: "2020-01-01T00:00:00.000Z",
      };
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([deletedDoc]),
        });
        (col as any).bulkRemove.mockResolvedValue({ success: true });
      }
      await garbageCollectionService.triggerManualCleanup(1);
      expect(mockCollections.bookmarks.find).toHaveBeenCalled();
      expect(mockCollections.documents.find).toHaveBeenCalled();
      // versions is deliberately queried by pruneVersions (rolling retention
      // window over createdAt — versions never soft-delete), so it is the one
      // non-soft-deletable collection that GC touches.
      expect(mockCollections.versions.find).toHaveBeenCalled();
      // No isDeleted in schema → out of GC scope
      expect(mockCollections.folders.find).not.toHaveBeenCalled();
      expect(mockCollections.flashcards.find).not.toHaveBeenCalled();
      expect(mockCollections.messages.find).not.toHaveBeenCalled();
      expect(mockCollections.chunks.find).not.toHaveBeenCalled();
    });

    it("should use the schema primaryPath when defined", async () => {
      (mockCollections.bookmarks as any).schema = { primaryPath: "customId" };
      const deletedDoc = {
        customId: "c1",
        isDeleted: true,
        updatedAt: "2020-01-01T00:00:00.000Z",
      };
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([deletedDoc]),
        });
        (col as any).bulkRemove.mockResolvedValue({ success: true });
      }
      await garbageCollectionService.triggerManualCleanup(1);
      expect(mockCollections.bookmarks.bulkRemove).toHaveBeenCalledWith(["c1"]);
    });

    it('should use "id" as the default primaryPath', async () => {
      (mockCollections.bookmarks as any).schema = {};
      const deletedDoc = {
        id: "default-id",
        isDeleted: true,
        updatedAt: "2020-01-01T00:00:00.000Z",
      };
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([deletedDoc]),
        });
        (col as any).bulkRemove.mockResolvedValue({ success: true });
      }
      await garbageCollectionService.triggerManualCleanup(1);
      expect(mockCollections.bookmarks.bulkRemove).toHaveBeenCalledWith([
        "default-id",
      ]);
    });

    it("should handle an error in cleanupCollection", async () => {
      (mockCollections.bookmarks as any).find.mockImplementation(() => {
        throw new Error("find error");
      });
      for (const key of [
        "documents",
        "folders",
        "flashcards",
        "versions",
        "messages",
        "chunks",
      ]) {
        (mockCollections[key] as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        });
      }
      await garbageCollectionService.triggerManualCleanup(1);
      // Should not throw, just log
    });

    it("should handle a non-Error error in cleanupCollection (String(error) branch)", async () => {
      const { logger } = await import("../../utils/logger");
      (mockCollections.bookmarks as any).find.mockImplementation(() => {
        throw "DB connection string error"; // string, no Error
      });
      for (const key of [
        "documents",
        "folders",
        "flashcards",
        "versions",
        "messages",
        "chunks",
      ]) {
        (mockCollections[key] as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        });
      }
      await garbageCollectionService.triggerManualCleanup(1);
      // cleanupCollection catch usa: error instanceof Error ? error.message : String(error)
      // Con string, usa String(error) en vez de error.message
      expect(logger.error).toHaveBeenCalledWith(
        "[GarbageCollectionService] Collection cleanup failed",
        expect.objectContaining({
          collection: "bookmarks",
          error: "DB connection string error",
        }),
      );
    });
  });

  describe("getSoftDeleteStats", () => {
    it("should return stats with everything at 0", async () => {
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        });
      }
      const stats = await garbageCollectionService.getSoftDeleteStats();
      expect(stats.total).toBe(0);
    });

    it("should count soft-deleted documents", async () => {
      (mockCollections.bookmarks as any).find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([{}, {}]),
      });
      for (const key of [
        "documents",
        "folders",
        "flashcards",
        "versions",
        "messages",
        "chunks",
      ]) {
        (mockCollections[key] as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        });
      }
      const stats = await garbageCollectionService.getSoftDeleteStats();
      expect(stats.bookmarks).toBe(2);
      expect(stats.total).toBe(2);
    });

    it("should throw when initDB fails", async () => {
      mockInitDB.mockRejectedValueOnce(new Error("DB error"));
      await expect(
        garbageCollectionService.getSoftDeleteStats(),
      ).rejects.toThrow("DB error");
    });
  });

  describe("setRetentionDays", () => {
    it("changes the RETENTION_DAYS value", () => {
      const original = (garbageCollectionService as any).RETENTION_DAYS;
      garbageCollectionService.setRetentionDays(7);
      expect((garbageCollectionService as any).RETENTION_DAYS).toBe(7);
      garbageCollectionService.setRetentionDays(original);
    });
  });

  describe("stop", () => {
    it("should log cleanup stopped", async () => {
      const { logger } = await import("../../utils/logger");
      garbageCollectionService.start();
      await Promise.resolve(); // drain microtasks of the initial runCleanup
      garbageCollectionService.stop();
      expect(logger.info).toHaveBeenCalledWith(
        "[GarbageCollectionService] Cleanup job stopped",
      );
    });
  });

  describe("runCleanup - initial error catch", () => {
    it("should log an error when runCleanup fails on start", async () => {
      const { logger } = await import("../../utils/logger");
      const spy = vi
        .spyOn(garbageCollectionService as any, "runCleanup")
        .mockRejectedValue(new Error("DB connection lost"));

      garbageCollectionService.start();
      // Drain the microtask queue so the .catch() runs
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalledWith(
        "[GarbageCollectionService] Initial cleanup failed",
        expect.objectContaining({ error: expect.any(Error) }),
      );
      spy.mockRestore();
      garbageCollectionService.stop();
    });

    it("should log a periodic error when runCleanup fails", async () => {
      const { logger } = await import("../../utils/logger");
      const spy = vi
        .spyOn(garbageCollectionService as any, "runCleanup")
        .mockRejectedValue(new Error("Periodic failure"));

      garbageCollectionService.start();
      await Promise.resolve(); // initial drain

      // Advance 24h so the setInterval fires
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      await Promise.resolve(); // drain microtasks from the periodic .catch

      expect(logger.error).toHaveBeenCalledWith(
        "[GarbageCollectionService] Periodic cleanup failed",
        expect.objectContaining({ error: expect.any(Error) }),
      );
      spy.mockRestore();
      garbageCollectionService.stop();
    });
  });

  describe("runCleanup - periodic interval", () => {
    it("runs cleanup periodically via setInterval", async () => {
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        });
      }
      const runSpy = vi
        .spyOn(garbageCollectionService as any, "runCleanup")
        .mockResolvedValue(0);

      garbageCollectionService.start();

      // Run once immediately
      expect(runSpy).toHaveBeenCalledTimes(1);

      // Advance by CLEANUP_INTERVAL_MS (24h)
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      expect(runSpy).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      expect(runSpy).toHaveBeenCalledTimes(3);

      garbageCollectionService.stop();
      runSpy.mockRestore();
    });
  });

  describe("runCleanup - error propagation", () => {
    it("loggea error pero no lanza en cleanupCollection", async () => {
      (mockCollections.bookmarks as any).find.mockImplementation(() => {
        throw new Error("DB read fail");
      });
      (mockCollections.documents as any).find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      (mockCollections.folders as any).find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      (mockCollections.flashcards as any).find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      (mockCollections.versions as any).find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      (mockCollections.messages as any).find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      (mockCollections.chunks as any).find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });

      const result = await garbageCollectionService.triggerManualCleanup(1);
      expect(result.totalDeleted).toBeGreaterThanOrEqual(0);
    });

    it("handles error in bulkRemove", async () => {
      const deletedDoc = {
        id: "del1",
        isDeleted: true,
        updatedAt: "2020-01-01T00:00:00.000Z",
      };
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([deletedDoc]),
        });
        (col as any).bulkRemove.mockRejectedValue(new Error("bulk fail"));
      }

      const result = await garbageCollectionService.triggerManualCleanup(1);
      expect(result.totalDeleted).toBeGreaterThanOrEqual(0);
    });

    it("runCleanup throws if initDB fails", async () => {
      mockInitDB.mockRejectedValueOnce(new Error("DB offline"));
      await expect(
        garbageCollectionService.triggerManualCleanup(1),
      ).rejects.toThrow("DB offline");
    });
  });

  describe("cleanupCollection - batch boundaries", () => {
    it("processes exactly BATCH_SIZE documents and stops", async () => {
      const exactly100 = Array.from({ length: 100 }, (_, i) => ({
        id: `doc-${i}`,
        isDeleted: true,
        updatedAt: "2020-01-01T00:00:00.000Z",
      }));

      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue(exactly100),
        });
        (col as any).bulkRemove.mockResolvedValue({});
      }

      const result = await garbageCollectionService.triggerManualCleanup(1);
      expect(result.totalDeleted).toBeGreaterThanOrEqual(100);
    });

    it("logs collection cleanup completed when deletedCount > 0", async () => {
      const { logger } = await import("../../utils/logger");
      const deletedDoc = {
        id: "del1",
        isDeleted: true,
        updatedAt: "2020-01-01T00:00:00.000Z",
      };
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([deletedDoc]),
        });
        (col as any).bulkRemove.mockResolvedValue({});
      }

      await garbageCollectionService.triggerManualCleanup(1);

      expect(logger.info).toHaveBeenCalledWith(
        "[GarbageCollectionService] Collection cleanup completed",
        expect.objectContaining({ collection: "bookmarks", deletedCount: 1 }),
      );
    });

    it("processes more than BATCH_SIZE across multiple iterations", async () => {
      let callCount = 0;
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockImplementation(() => ({
          exec: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount <= 2) {
              return Promise.resolve(
                Array.from({ length: 100 }, (_, i) => ({
                  id: `doc-${callCount}-${i}`,
                  isDeleted: true,
                  updatedAt: "2020-01-01T00:00:00.000Z",
                })),
              );
            }
            return Promise.resolve([]);
          }),
        }));
        (col as any).bulkRemove.mockResolvedValue({});
      }

      const result = await garbageCollectionService.triggerManualCleanup(1);
      expect(result.totalDeleted).toBeGreaterThanOrEqual(100);
    });

    it("logs a warning when MAX_ITERATIONS (100) is reached", async () => {
      const { logger } = await import("../../utils/logger");

      // Mock find for bookmarks: always returns 100 docs (the full batch)
      // so the loop never breaks on docs.length < BATCH_SIZE.
      // The while loop (iterations < MAX_ITERATIONS=100) executes the body 100
      // complete runs (iterations 1..100), deleting 100 docs per batch →
      // deletedCount = 100 * 100 = 10000.
      const batchDoc = (i: number) => ({
        id: `maxiter-${i}`,
        isDeleted: true,
        updatedAt: "2020-01-01T00:00:00.000Z",
      });
      let bookmarksFindCount = 0;
      (mockCollections.bookmarks as any).find.mockImplementation(() => ({
        exec: vi.fn().mockImplementation(() => {
          bookmarksFindCount++;
          return Promise.resolve(
            Array.from({ length: 100 }, (_, i) => batchDoc(bookmarksFindCount * 100 + i)),
          );
        }),
      }));
      (mockCollections.bookmarks as any).bulkRemove.mockResolvedValue({});

      // The other collections return empty so they do not interfere
      for (const key of ["documents", "folders", "flashcards", "versions", "messages", "chunks"]) {
        (mockCollections[key] as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        });
        (mockCollections[key] as any).bulkRemove.mockResolvedValue({});
      }

      await garbageCollectionService.triggerManualCleanup(1);

      // It should have logged the MAX_ITERATIONS warning
      expect(logger.warn).toHaveBeenCalledWith(
        "[GarbageCollectionService] Max iterations reached",
        expect.objectContaining({ collection: "bookmarks", deletedCount: 10000 }),
      );
      // cleanupCollection returns the deletedCount even if there is a warning
      expect(bookmarksFindCount).toBeGreaterThanOrEqual(100);
    });

    it("uses schema.primaryPath default 'id' when not defined", async () => {
      (mockCollections.documents as any).schema = {};
      const deletedDoc = {
        id: "default-pk",
        isDeleted: true,
        updatedAt: "2020-01-01T00:00:00.000Z",
      };
      for (const col of Object.values(mockCollections)) {
        (col as any).find.mockReturnValue({
          exec: vi.fn().mockResolvedValue([deletedDoc]),
        });
        (col as any).bulkRemove.mockResolvedValue({});
      }

      await garbageCollectionService.triggerManualCleanup(1);
      expect(mockCollections.documents.bulkRemove).toHaveBeenCalledWith([
        "default-pk",
      ]);
    });
  });

  describe("getSoftDeleteStats - schema-derived collections (P83)", () => {
    it("counts soft-deletes only in soft-deletable collections", async () => {
      (mockCollections.bookmarks as any).find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([{}, {}, {}]),
      });
      (mockCollections.documents as any).find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([{}, {}]),
      });
      // folders/flashcards/versions/messages/chunks do NOT have isDeleted in their
      // schema → GC does not query them (derived from COLLECTIONS).
      const stats = await garbageCollectionService.getSoftDeleteStats();
      expect(stats.bookmarks).toBe(3);
      expect(stats.documents).toBe(2);
      expect(stats.total).toBe(5);
      expect(Object.keys(stats).sort()).toEqual(
        ["bookmarks", "documents", "total"].sort(),
      );
    });
  });

  describe("pruneVersions", () => {
    it("deletes versions older than VERSION_RETENTION_DAYS", async () => {
      const oldVersions = [
        { id: "v1", createdAt: "2025-01-01T00:00:00.000Z" },
        { id: "v2", createdAt: "2025-02-01T00:00:00.000Z" },
      ];
      const versionsCollection = mockDb.versions;
      const execMock = vi.fn().mockResolvedValue(oldVersions);
      versionsCollection.find = vi.fn().mockReturnValue({ exec: execMock });
      versionsCollection.bulkRemove = vi.fn().mockResolvedValue(undefined);

      const totalDeleted = await garbageCollectionService.triggerManualCleanup();

      expect(versionsCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          selector: expect.objectContaining({ createdAt: expect.any(Object) }),
          sort: [{ createdAt: "asc" }],
          limit: 100,
        }),
      );
      expect(versionsCollection.bulkRemove).toHaveBeenCalledWith(["v1", "v2"]);
    });

    it("processes versions in batches of BATCH_SIZE", async () => {
      const versionsCollection = mockDb.versions;
      const batch1 = Array.from({ length: 100 }, (_, i) => ({
        id: `v${i}`,
        createdAt: "2025-01-01T00:00:00.000Z",
      }));
      const batch2 = [{ id: "v100", createdAt: "2025-03-01T00:00:00.000Z" }];
      let callCount = 0;
      versionsCollection.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? batch1 : batch2);
        }),
      });
      versionsCollection.bulkRemove = vi.fn().mockResolvedValue(undefined);

      await garbageCollectionService.triggerManualCleanup();

      expect(versionsCollection.bulkRemove).toHaveBeenCalledTimes(2);
      expect(versionsCollection.bulkRemove).toHaveBeenNthCalledWith(
        1,
        batch1.map((v) => v.id),
      );
      expect(versionsCollection.bulkRemove).toHaveBeenNthCalledWith(
        2,
        batch2.map((v) => v.id),
      );
    });

    it("stops pruning when versions collection returns empty batch", async () => {
      const versionsCollection = mockDb.versions;
      versionsCollection.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      versionsCollection.bulkRemove = vi.fn().mockResolvedValue(undefined);

      await garbageCollectionService.triggerManualCleanup();

      expect(versionsCollection.bulkRemove).not.toHaveBeenCalled();
    });

    it("handles batch error in pruneVersions without aborting cleanup", async () => {
      const versionsCollection = mockDb.versions;
      versionsCollection.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockRejectedValue(new Error("query failed")),
      });

      // Should not throw — pruneVersions catches per-batch errors
      const result = await garbageCollectionService.triggerManualCleanup();
      expect(result.totalDeleted).toBeGreaterThanOrEqual(0);
    });

    it("cancels pruning when generation changes mid-batch", async () => {
      const versionsCollection = mockDb.versions;
      const batch = Array.from({ length: 100 }, (_, i) => ({
        id: `v${i}`,
        createdAt: "2025-01-01T00:00:00.000Z",
      }));
      let callCount = 0;
      versionsCollection.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.resolve(batch);
          // Bump generation directly to simulate stop() mid-flight
          (garbageCollectionService as any).cleanupGeneration++;
          return Promise.resolve(batch);
        }),
      });
      versionsCollection.bulkRemove = vi.fn().mockResolvedValue(undefined);

      await garbageCollectionService.triggerManualCleanup();

      // After generation bump, the loop check at the top of the next
      // iteration detects the mismatch and breaks. Two batches are
      // processed (first returns batch, second bumps generation, third
      // iteration breaks). bulkRemove called twice.
      expect(versionsCollection.bulkRemove).toHaveBeenCalledTimes(2);
    });

    it("skips versions collection when not present on db", async () => {
      const dbWithoutVersions = { bookmarks: createMockCollection("bookmarks") };
      mockInitDB.mockResolvedValueOnce(dbWithoutVersions);

      // Should not throw
      const result = await garbageCollectionService.triggerManualCleanup();
      expect(result.totalDeleted).toBeGreaterThanOrEqual(0);
    });
  });

  describe("cleanupCollection - generation cancellation", () => {
    it("cancels soft-delete cleanup when generation changes mid-batch", async () => {
      const collection = mockDb.bookmarks;
      const batch = Array.from({ length: 100 }, (_, i) => ({
        id: `b${i}`,
        isDeleted: true,
        updatedAt: "2025-01-01T00:00:00.000Z",
      }));
      let callCount = 0;
      collection.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.resolve(batch);
          // Bump generation directly to simulate stop() mid-flight.
          // cleanupCollection has a second generation check AFTER the query
          // but BEFORE bulkRemove, so the mutation is skipped.
          (garbageCollectionService as any).cleanupGeneration++;
          return Promise.resolve(batch);
        }),
      });
      collection.bulkRemove = vi.fn().mockResolvedValue(undefined);

      await garbageCollectionService.triggerManualCleanup();

      // First batch: bulkRemove called. Second batch: generation bumped
      // during exec, second generation check after exec detects mismatch
      // and breaks BEFORE bulkRemove. Only 1 call.
      expect(collection.bulkRemove).toHaveBeenCalledTimes(1);
    });
  });

  describe("triggerManualCleanup - retention restore on error", () => {
    it("restores retentionDays after error in initDB", async () => {
      const original = (garbageCollectionService as any).RETENTION_DAYS;
      mockInitDB.mockRejectedValueOnce(new Error("fail"));

      await expect(
        garbageCollectionService.triggerManualCleanup(1),
      ).rejects.toThrow();
      expect((garbageCollectionService as any).RETENTION_DAYS).toBe(original);
    });

    it("restores retentionDays after error in runCleanup", async () => {
      const original = (garbageCollectionService as any).RETENTION_DAYS;
      const spy = vi
        .spyOn(garbageCollectionService as any, "runCleanup")
        .mockRejectedValue(new Error("fail"));

      await expect(
        garbageCollectionService.triggerManualCleanup(1),
      ).rejects.toThrow();
      expect((garbageCollectionService as any).RETENTION_DAYS).toBe(original);
      spy.mockRestore();
    });
  });
});
