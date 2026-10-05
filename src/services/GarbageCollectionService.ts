import { initDB } from "../db/database";
import { COLLECTIONS } from "../db/database.core";
import { logger } from "../utils/logger";
import type { RxCollection } from "rxdb";

/**
 * Soft-deletable collections, DERIVED from COLLECTIONS (src/db/database.core.ts)
 * by introspecting each schema for the isDeleted + updatedAt fields. Replaces a
 * hardcoded list that drifted from the schema (folders/flashcards/versions/
 * messages/chunks never had isDeleted, so their cleanup was a silent no-op).
 * Adding a soft-deletable collection to the DB now automatically adds it here.
 */
const SOFT_DELETE_COLLECTION_NAMES: readonly string[] = Object.entries(
  COLLECTIONS,
)
  .filter(([, config]) => {
    const props = config.schema.properties as Record<string, unknown>;
    return props.isDeleted !== undefined && props.updatedAt !== undefined;
  })
  .map(([name]) => name);

/**
 * GarbageCollectionService - Periodic cleanup of soft-deleted records
 * Removes records marked as isDeleted after a retention period to free up storage
 */
class GarbageCollectionService {
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  // Invalidates an in-flight cleanup when stop() is called, so a long RxDB
  // query cannot continue deleting batches after the service is stopped.
  private cleanupGeneration = 0;
  private cleanupPromise: Promise<number> | null = null;

  // Configuration
  private readonly CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // Run daily
  private RETENTION_DAYS = 30; // Keep soft-deleted records for 30 days
  // NOTE (sync interplay): hard-purging a tombstone removes the only local
  // evidence of a deletion. If a WebRTC sync peer was offline longer than
  // this window and re-pairs later, its stale live copy of the purged doc
  // re-inserts on this device (LWW has no local record to compare). Lowering
  // RETENTION_DAYS widens that resurrection window; the 30-day default +
  // manual QR pairing is the accepted tradeoff.
  // Per-collection retention overrides, applied only to soft-deletable
  // collections from SOFT_DELETE_COLLECTION_NAMES.
  private readonly RETENTION_DAYS_BY_COLLECTION: Readonly<
    Record<string, number>
  > = {};
  // Versions never soft-delete (no isDeleted field), so the soft-delete loop
  // cannot prune them; without this the versions collection grows unboundedly
  // (every 5 minutes of editing inserts a full document snapshot). Prune by
  // the createdAt index over a rolling retention window.
  private readonly VERSION_RETENTION_DAYS = 90;
  private readonly BATCH_SIZE = 100; // Process in batches to avoid blocking

  /**
   * Start the periodic cleanup job
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("[GarbageCollectionService] Cleanup job already running");
      return;
    }

    logger.info("[GarbageCollectionService] Starting periodic cleanup job");
    this.isRunning = true;

    // Run immediately on start
    this.runCleanup(this.cleanupGeneration).catch((error) => {
      logger.error("[GarbageCollectionService] Initial cleanup failed", {
        error,
      });
    });

    // Schedule periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.runCleanup(this.cleanupGeneration).catch((error) => {
        logger.error("[GarbageCollectionService] Periodic cleanup failed", {
          error,
        });
      });
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop the periodic cleanup job
   */
  stop(): void {
    this.cleanupGeneration += 1;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.isRunning = false;
    logger.info("[GarbageCollectionService] Cleanup job stopped");
  }

  /**
   * Check if the cleanup job is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Prunes document versions older than the retention window. Versions have
   * no isDeleted field, so they never enter the soft-delete pipeline above;
   * without this step the collection would grow without bound for every
   * actively edited document. Batched over the createdAt index so a large
   * history is removed without blocking the main thread.
   */
  private async pruneVersions(
    db: Record<string, RxCollection>,
    generation: number,
  ): Promise<number> {
    const collection = db.versions;
    if (!collection) {
      return 0;
    }
    const cutoff = new Date(
      Date.now() - this.VERSION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    let deleted = 0;
    // Same safety cap as cleanupCollection: at BATCH_SIZE=100, 100 iterations
    // prune up to 10,000 versions per run. Without a bound, a version
    // collection that keeps returning full batches (or a mock/DB quirk) would
    // loop and allocate forever.
    const MAX_ITERATIONS = 100;
    let iterations = 0;
    for (;;) {
      if (generation !== this.cleanupGeneration) {
        logger.info("[GarbageCollectionService] Version pruning cancelled");
        break;
      }
      if (iterations >= MAX_ITERATIONS) {
        logger.warn(
          "[GarbageCollectionService] Version pruning max iterations reached",
          { deleted },
        );
        break;
      }
      iterations++;
      try {
        const stale = await collection
          .find({
            selector: { createdAt: { $lt: cutoff } },
            sort: [{ createdAt: "asc" }],
            limit: this.BATCH_SIZE,
          })
          .exec();
        if (stale.length === 0) {
          break;
        }
        await collection.bulkRemove(
          stale.map((d: { id: string }) => d.id),
        );
        deleted += stale.length;
        if (stale.length < this.BATCH_SIZE) {
          break;
        }
      } catch (error) {
        // One bad batch must not abort the whole cleanup run (mirrors
        // cleanupCollection's per-collection error handling).
        logger.error(
          "[GarbageCollectionService] Version pruning batch failed",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
        break;
      }
    }
    if (deleted > 0) {
      logger.info("[GarbageCollectionService] Pruned old document versions", {
        deleted,
      });
    }
    return deleted;
  }

  /**
   * Run the cleanup process for all collections.
   * Concurrent interval/manual callers share one in-flight operation so they
   * cannot race on the same soft-deleted documents.
   */
  private runCleanup(
    generation = this.cleanupGeneration,
    defaultRetentionDays = this.RETENTION_DAYS,
  ): Promise<number> {
    if (this.cleanupPromise) {return this.cleanupPromise;}

    const operation = this.runCleanupInternal(generation, defaultRetentionDays);
    let tracked: Promise<number>;
    // eslint-disable-next-line prefer-const -- declared separately so the finally callback can close over it
    tracked = operation.finally(() => {
      if (this.cleanupPromise === tracked) {
        this.cleanupPromise = null;
      }
    });
    this.cleanupPromise = tracked;
    return tracked;
  }

  private async runCleanupInternal(
    generation: number,
    defaultRetentionDays: number,
  ): Promise<number> {
    logger.info("[GarbageCollectionService] Starting cleanup process");
    const startTime = Date.now();

    try {
      const db = (await initDB()) as unknown as Record<string, RxCollection>;
      let totalDeleted = 0;

      for (const name of SOFT_DELETE_COLLECTION_NAMES) {
        if (generation !== this.cleanupGeneration) {
          logger.info("[GarbageCollectionService] Cleanup cancelled");
          break;
        }
        const collection = db[name];
        if (!collection) {
          logger.warn(
            "[GarbageCollectionService] Collection not found on db",
            { collection: name },
          );
          continue;
        }
        const retentionDays =
          this.RETENTION_DAYS_BY_COLLECTION[name] ?? defaultRetentionDays;
        const cutoffDate = new Date(
          Date.now() - retentionDays * 24 * 60 * 60 * 1000,
        );
        totalDeleted += await this.cleanupCollection(
          collection,
          cutoffDate,
          generation,
        );
      }

      totalDeleted += await this.pruneVersions(db, generation);

      const duration = Date.now() - startTime;
      logger.info("[GarbageCollectionService] Cleanup completed", {
        totalDeleted,
        durationMs: duration,
      });

      return totalDeleted;
    } catch (error) {
      logger.error("[GarbageCollectionService] Cleanup process failed", {
        error,
      });
      throw error;
    }
  }

  /**
   * Cleanup a specific collection of soft-deleted records
   */
  private async cleanupCollection(
    collection: RxCollection<unknown>,
    cutoffDate: Date,
    generation: number,
  ): Promise<number> {
    let deletedCount = 0;
    let iterations = 0;
    const MAX_ITERATIONS = 100; // Safety cap: at BATCH_SIZE=100, handles up to 10,000 docs

    try {
      while (iterations < MAX_ITERATIONS) {
        if (generation !== this.cleanupGeneration) {
          logger.info("[GarbageCollectionService] Collection cleanup cancelled", {
            collection: collection.name,
          });
          break;
        }
        iterations++;

        // Always fetch from skip=0: after each batch deletion the remaining docs
        // shift down, so incrementing skip would skip documents unintentionally.
        const deletedDocs = await collection
          .find({
            selector: {
              isDeleted: true,
              updatedAt: { $lt: cutoffDate.toISOString() },
            } as Record<string, unknown>,
            limit: this.BATCH_SIZE,
          })
          .exec();

        if (deletedDocs.length === 0) {
          break; // No more docs to clean up
        }

        // Stop before mutating if the service was stopped while the query was
        // in flight. The already-fetched batch remains untouched.
        if (generation !== this.cleanupGeneration) {break;}

        // Use bulkRemove for efficiency instead of sequential awaits
        const primaryPath = collection.schema.primaryPath || "id";
        const ids = deletedDocs.map(
          (doc: unknown) => (doc as Record<string, unknown>)[primaryPath],
        ) as string[];
        await collection.bulkRemove(ids);
        deletedCount += ids.length;

        // If we got fewer docs than the batch size, we're done
        if (deletedDocs.length < this.BATCH_SIZE) {
          break;
        }
      }

      if (iterations >= MAX_ITERATIONS) {
        logger.warn("[GarbageCollectionService] Max iterations reached", {
          collection: collection.name,
          deletedCount,
        });
      }

      if (deletedCount > 0) {
        logger.info("[GarbageCollectionService] Collection cleanup completed", {
          collection: collection.name,
          deletedCount,
        });
      }
    } catch (error) {
      logger.error("[GarbageCollectionService] Collection cleanup failed", {
        collection: collection.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return deletedCount;
  }

  private normalizeRetentionDays(days: number): number {
    if (!Number.isFinite(days) || days < 0 || days > 3650) {
      throw new Error("Retention days must be between 0 and 3650");
    }
    return Math.floor(days);
  }

  /** Override the default retention days for future cleanup runs. */
  setRetentionDays(days: number): void {
    this.RETENTION_DAYS = this.normalizeRetentionDays(days);
  }

  /**
   * Manual cleanup trigger - useful for testing or on-demand cleanup.
   * The optional retention applies only to this run and cannot race with the
   * service-wide default used by the periodic job.
   */
  async triggerManualCleanup(
    retentionDays?: number,
  ): Promise<{ totalDeleted: number; durationMs: number }> {
    logger.info("[GarbageCollectionService] Manual cleanup triggered");

    const effectiveRetentionDays =
      retentionDays === undefined
        ? this.RETENTION_DAYS
        : this.normalizeRetentionDays(retentionDays);
    const startTime = Date.now();
    const totalDeleted = await this.runCleanup(
      this.cleanupGeneration,
      effectiveRetentionDays,
    );
    const duration = Date.now() - startTime;

    return { totalDeleted, durationMs: duration };
  }

  /**
   * Get statistics about soft-deleted records, keyed by the soft-deletable
   * collections derived from the schemas (SOFT_DELETE_COLLECTION_NAMES) plus
   * a `total` field. The key set stays in sync with the DB definition.
   */
  async getSoftDeleteStats(): Promise<Record<string, number>> {
    try {
      const db = (await initDB()) as unknown as Record<string, RxCollection>;
      const stats: Record<string, number> = { total: 0 };

      await Promise.all(
        SOFT_DELETE_COLLECTION_NAMES.map(async (name) => {
          const collection = db[name];
          if (!collection) {
            stats[name] = 0;
            return;
          }
          const docs = (await collection
            .find({ selector: { isDeleted: true } as Record<string, unknown> })
            .exec()) as unknown[];
          stats[name] = docs.length;
          stats.total = (stats.total ?? 0) + docs.length;
        }),
      );

      return stats;
    } catch (error) {
      logger.error(
        "[GarbageCollectionService] Failed to get soft delete stats",
        { error },
      );
      throw error;
    }
  }
}

export const garbageCollectionService = new GarbageCollectionService();
