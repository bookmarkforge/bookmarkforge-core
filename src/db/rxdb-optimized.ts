import type { RxCollection, RxDocument, RxQuery, MangoQuery } from "rxdb";
import { logger } from "../utils/logger";
import { queryCache } from "./rxdb-cache";

export { QueryCache, queryCache } from "./rxdb-cache";

interface BulkWriteResult<T> {
  success: RxDocument<T>[];
  error: Array<{ message: string }>;
}

interface CompositeIndex {
  name: string;
  fields: string[];
  unique?: boolean;
  sparse?: boolean;
}

// LEGACY / STALE — do not use. These entries were written for an older
// multi-user design and reference fields that DO NOT EXIST in the current
// schemas (src/db/schema.ts): there is no `userId`, `isFavorite`, `status`,
// `priority`, `dueDate`, `projectId`, or `parentId` on bookmark/docs, and no
// tasks/notes collections. createCompositeIndexes() on any of these would
// fail schema validation (silently logged). The live index strategy lives in
// the `indexes` arrays of each RxJsonSchema in src/db/schema.ts.
export const RECOMMENDED_INDEXES: CompositeIndex[] = [
  { name: "idx_bookmarks_user_created", fields: ["userId", "createdAt"] },
  { name: "idx_bookmarks_user_updated", fields: ["userId", "updatedAt"] },
  { name: "idx_bookmarks_user_deleted", fields: ["userId", "isDeleted"] },
  { name: "idx_bookmarks_user_favorite", fields: ["userId", "isFavorite"] },
  { name: "idx_bookmarks_url", fields: ["url"], unique: true, sparse: true },
  { name: "idx_bookmarks_search", fields: ["userId", "title", "description"] },

  { name: "idx_tasks_user_status", fields: ["userId", "status"] },
  { name: "idx_tasks_user_priority", fields: ["userId", "priority"] },
  { name: "idx_tasks_due_date", fields: ["userId", "dueDate"] },
  { name: "idx_tasks_project", fields: ["userId", "projectId"] },

  { name: "idx_notes_user_updated", fields: ["userId", "updatedAt"] },
  { name: "idx_notes_parent", fields: ["userId", "parentId"] },
];

export async function createCompositeIndexes<T>(
  collection: RxCollection<T>,
  indexes: CompositeIndex[],
): Promise<void> {
  const col = collection as unknown as Record<string, unknown>;
  for (const index of indexes) {
    try {
      if (typeof col.getIndexes === "function") {
        const existingIndexes = (await col.getIndexes()) as Array<{
          name: string;
        }>;
        const exists = existingIndexes.some(
          (idx: { name: string }) => idx.name === index.name,
        );

        if (!exists && typeof col.createIndex === "function") {
          await col.createIndex(index);
          logger.debug(`[RxDB] Created index: ${index.name}`);
        }
      }
    } catch (error) {
      logger.error("[RxDB] Failed to create index", {
        indexName: index.name,
        error,
      });
    }
  }
}

export function createOptimizedQuery<T>(
  collection: RxCollection<T>,
  selector: MangoQuery<T>["selector"],
  options: {
    sort?: MangoQuery<T>["sort"];
    limit?: number;
    skip?: number;
  } = {},
): RxQuery<T[], RxDocument<T>> {
  const { sort, limit, skip } = options;

  // Pass sort/skip/limit in the MangoQuery object itself. RxDB's chainable
  // `.sort()` REPLACES queryObject.sort with a single part per call (it does
  // not accumulate), so multi-field sorts must go through `find({ sort: [...] })`
  // — the documented API. The old `query.sort(sort)` (guarded by `: any`)
  // passed the array into `.sort()`, producing a nested `[[part]]` sort.
  return collection.find({
    selector,
    sort,
    skip,
    limit,
  }) as unknown as RxQuery<T[], RxDocument<T>>;
}

export async function executeCachedQuery<T>(
  collection: RxCollection<T>,
  selector: MangoQuery<T>["selector"],
  options: {
    sort?: MangoQuery<T>["sort"];
    limit?: number;
    skip?: number;
    cacheKey?: string;
    cacheTTL?: number;
    index?: string;
  } = {},
): Promise<RxDocument<T>[]> {
  const cacheKey =
    options.cacheKey ||
    JSON.stringify({ collection: collection.name, selector, options });

  await queryCache.ready();
  const cached = queryCache.get(cacheKey);
  if (cached) {
    logger.debug(`[RxDB] Cache hit: ${cacheKey}`);
    return cached as RxDocument<T>[];
  }

  const query = createOptimizedQuery(collection, selector, options);
  const results = await query.exec();

  queryCache.set(cacheKey, results as unknown[], options.cacheTTL);

  return results as RxDocument<T>[];
}

export async function batchInsert<T>(
  collection: RxCollection<T>,
  docs: T[],
  batchSize = 100,
): Promise<RxDocument<T>[]> {
  const results: RxDocument<T>[] = [];

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const batchResults = (await collection.bulkInsert(
      batch,
    )) as unknown as BulkWriteResult<T>;
    if (batchResults.error.length > 0) {
      logger.warn(
        `[RxDB] batchInsert: ${batchResults.error.length} inserts failed`,
        {
          collection: collection.name,
          errors: batchResults.error.map((e) => e.message),
        },
      );
    }
    results.push(...batchResults.success);

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  queryCache.invalidate(new RegExp(`"collection":"${collection.name}"`));

  return results;
}

export async function bulkUpdate<T>(
  collection: RxCollection<T>,
  updates: Array<{ id: string; data: Partial<T> }>,
): Promise<void> {
  const docsResult = await collection.findByIds(updates.map((u) => u.id));
  const docs = docsResult as unknown as Map<string, RxDocument<T>>;

  const failures: string[] = [];
  await Promise.all(
    updates.map(async (update) => {
      const doc = docs.get(update.id);
      if (doc) {
        const docAny = doc as unknown as {
          incrementalPatch: (data: Partial<T>) => Promise<void>;
        };
        try {
          await docAny.incrementalPatch(update.data);
        } catch (error) {
          failures.push(update.id);
          logger.error(`[RxDB] bulkUpdate: failed to patch ${update.id}`, {
            error,
          });
        }
      } else {
        failures.push(update.id);
      }
    }),
  );

  if (failures.length > 0) {
    logger.warn(
      `[RxDB] bulkUpdate: ${failures.length} updates failed/missing`,
      { collection: collection.name, ids: failures },
    );
  }

  queryCache.invalidate(new RegExp(`"collection":"${collection.name}"`));
}

const MAX_SEARCH_TERMS = 10;

export async function searchWithRelevance<
  T extends { title?: string; description?: string; tags?: string[] },
>(
  collection: RxCollection<T>,
  query: string,
  options: {
    fields?: string[];
    limit?: number;
    fuzzy?: boolean;
  } = {},
): Promise<Array<{ doc: RxDocument<T>; score: number }>> {
  const { fields = ["title", "description", "tags"], limit = 20 } = options;
  let searchTerms = query.toLowerCase().split(/\s+/);
  if (searchTerms.length > MAX_SEARCH_TERMS) {
    logger.warn(
      `[RxDB] searchWithRelevance: query has ${searchTerms.length} terms, truncating to ${MAX_SEARCH_TERMS}`,
    );
    searchTerms = searchTerms.slice(0, MAX_SEARCH_TERMS);
  }

  const searchSelector = {
    $or: fields.flatMap((field) =>
      searchTerms.map((term) => ({
        [field]: {
          $regex: term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        },
      })),
    ),
  };
  const allDocs = await collection
    .find({
      selector: searchSelector as unknown as MangoQuery<T>["selector"],
      limit: limit * 10,
    })
    .exec();

  const scored = allDocs.map((doc: RxDocument<T>) => {
    let score = 0;
    const data = doc.toJSON() as Record<string, unknown>;

    for (const term of searchTerms) {
      for (const field of fields) {
        const value = data[field];

        if (typeof value === "string") {
          const lowerValue = value.toLowerCase();
          if (lowerValue === term) {score += 10;}
          else if (lowerValue.startsWith(term)) {score += 7;}
          else if (lowerValue.includes(term)) {score += 5;}
        } else if (Array.isArray(value)) {
          const matches = value.filter(
            (v) => typeof v === "string" && v.toLowerCase().includes(term),
          ).length;
          score += matches * 3;
        }
      }
    }

    return { doc, score };
  });

  return scored
    .filter((item: { doc: RxDocument<T>; score: number }) => item.score > 0)
    .sort(
      (
        a: { doc: RxDocument<T>; score: number },
        b: { doc: RxDocument<T>; score: number },
      ) => b.score - a.score,
    )
    .slice(0, limit);
}

interface QueryMetrics {
  query: string;
  duration: number;
  resultCount: number;
  cached: boolean;
}

export class QueryProfiler {
  private metrics: QueryMetrics[] = [];
  private maxMetrics = 100;

  record(metric: QueryMetrics): void {
    this.metrics.push(metric);

    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    if (metric.duration > 100) {
      logger.warn(
        `[RxDB] Slow query detected: ${metric.query} (${metric.duration}ms)`,
      );
    }
  }

  getSlowQueries(threshold = 100): QueryMetrics[] {
    return this.metrics.filter((m) => m.duration > threshold);
  }

  getStats(): {
    avgDuration: number;
    totalQueries: number;
    cacheHitRate: number;
  } {
    if (this.metrics.length === 0) {
      return { avgDuration: 0, totalQueries: 0, cacheHitRate: 0 };
    }

    const avgDuration =
      this.metrics.reduce((sum, m) => sum + m.duration, 0) /
      this.metrics.length;
    const cacheHits = this.metrics.filter((m) => m.cached).length;

    return {
      avgDuration,
      totalQueries: this.metrics.length,
      cacheHitRate: cacheHits / this.metrics.length,
    };
  }

  clear(): void {
    this.metrics = [];
  }
}

export const queryProfiler = new QueryProfiler();
