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
      if (!resp) {continue;}
      // Never materialize the body: model caches run to hundreds of MB and
      // blob() would spike the heap in the very flow meant to free memory.
      // Prefer Content-Length, then count bytes through the stream.
      const contentLengthHeader = resp.headers.get("content-length");
      const contentLength =
        contentLengthHeader === null ? NaN : Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength >= 0) {
        total += contentLength;
        continue;
      }
      const body = resp.body;
      if (body && typeof body.getReader === "function") {
        const reader = body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {break;}
            total += value ? value.byteLength : 0;
          }
        } finally {
          reader.releaseLock();
        }
      } else {
        total += (await resp.blob()).size;
      }
    }
    return total;
  } catch {
    // INTENTIONAL SILENCE: size estimation is best-effort; a failed probe
    // must not block the cache deletion that follows it.
    return 0;
  }
}

/**
 * Deletes an IndexedDB database and resolves only when the deletion actually
 * completed. A `blocked` event means an open connection (e.g. the WebLLM
 * engine) kept the database alive — that is a failure, not a success, so the
 * caller must not count it as wiped.
 */
function deleteIDBDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    if (!req) {
      reject(new Error(`IndexedDB ${name} deleteDatabase returned no request`));
      return;
    }
    req.onsuccess = () => resolve();
    req.onerror = () =>
      reject(req.error || new Error(`Failed to delete IndexedDB ${name}`));
    req.onblocked = () =>
      reject(new Error(`IndexedDB ${name} deletion blocked by an open connection`));
  });
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
        // Await the deletion: a blocked/failed delete leaves the database
        // intact, and reporting it as wiped would be a false success.
        await deleteIDBDatabase(dbInfo.name);
        idbDatabasesDeleted++;
      }
    }
  }

  return { bytesFreed, cacheEntriesDeleted, idbDatabasesDeleted };
}
