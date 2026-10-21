/**
 * Shared storage-maintenance operations for the settings Storage section and
 * the dashboard's "free up space" dialog. Keeping the AI-cache sweep here (one
 * implementation) stops the two surfaces from drifting.
 */

const AI_CACHE_NAME_HINTS = ["webllm", "transformers", "models"] as const;

/**
 * Clears the locally downloaded AI model cache (Cache API entries whose cache
 * name hints at WebLLM/transformers/models, plus the WebLLM IndexedDB stores).
 *
 * Errors propagate to the caller so the UI can surface an error toast — this
 * matches the Storage section's original inline behaviour (a failed sweep must
 * not silently report success).
 */
export interface ClearAICacheResult {
  /** Approximate bytes freed from the Cache API. */
  bytesFreed: number;
  /** Number of Cache API entries deleted. */
  cacheEntriesDeleted: number;
  /** Number of IndexedDB databases deleted. */
  idbDatabasesDeleted: number;
}

/**
 * Estimates the total size of a named Cache by iterating its requests.
 * Returns 0 when the Cache API is unavailable or the cache does not exist.
 */
async function estimateCacheSize(name: string): Promise<number> {
  try {
    const cache = await caches.open(name);
    const requests = await cache.keys();
    let total = 0;
    for (const req of requests) {
      const resp = await cache.match(req);
      if (resp) {
        const blob = await resp.blob();
        total += blob.size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export async function clearAICache(): Promise<ClearAICacheResult> {
  let bytesFreed = 0;
  let cacheEntriesDeleted = 0;
  let idbDatabasesDeleted = 0;

  if ("caches" in window) {
    const cacheKeys = await caches.keys();
    for (const key of cacheKeys) {
      if (AI_CACHE_NAME_HINTS.some((hint) => key.includes(hint))) {
        bytesFreed += await estimateCacheSize(key);
        await caches.delete(key);
        cacheEntriesDeleted++;
      }
    }
  }

  if ("databases" in indexedDB) {
    const dbs = await (
      indexedDB as IDBFactory & {
        databases(): Promise<{ name?: string }[]>;
      }
    ).databases();
    for (const dbInfo of dbs) {
      if (dbInfo.name && dbInfo.name.includes("webllm")) {
        indexedDB.deleteDatabase(dbInfo.name);
        idbDatabasesDeleted++;
      }
    }
  }

  return { bytesFreed, cacheEntriesDeleted, idbDatabasesDeleted };
}
