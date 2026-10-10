/**
 * estimate-rows — counts the rows already stored in the vault's Dexie
 * databases WITHOUT opening an RxDB instance, powering the adaptive DB
 * init timeout (see DB_CONFIG.MIGRATION_PER_ROW_BUDGET_MS).
 *
 * RxDB's Dexie storage creates one IndexedDB per collection named
 * `rxdb-dexie-<dbName>--<schemaVersion>--<collection>` with the documents
 * in a `docs` object store, so a raw IDB `count()` is a fast, single
 * round-trip per store.
 *
 * Two discovery strategies:
 *   1. `indexedDB.databases()` enumeration — Chromium/Firefox.
 *   2. Direct probing of the known store names (Safari lacks
 *      `indexedDB.databases()`): for each collection, probe the schema
 *      versions BELOW its current one (the stores a pending migration
 *      would rewrite). Probing opens with version 1 and aborts the
 *      upgrade transaction when `oldVersion === 0`, so it NEVER creates
 *      an empty database just by counting.
 *
 * This module is deliberately dependency-free (pure IndexedDB + the
 * caller-supplied collection list) so the estimator can be unit-tested
 * without pulling in the RxDB layer.
 */

export interface EstimateCollectionRef {
  name: string;
  version: number;
}

/**
 * Opens one `rxdb-dexie-*` database and counts the rows in its `docs`
 * object store. Never throws and never creates databases:
 *   - a nonexistent store fires `upgradeneeded` with `oldVersion === 0`;
 *     the upgrade transaction is aborted, so nothing is created and the
 *     request rejects (resolved here as 0);
 *   - a store without a `docs` object store counts as 0.
 *
 * The open is deliberately WITHOUT an explicit version: RxDB/Dexie stores
 * are not necessarily at IndexedDB version 1 (Dexie maps its schema
 * versions onto higher IDB versions), so `open(name, 1)` fails with a
 * VersionError on real vaults — only a version-less open works at the
 * store's actual version.
 */
function countDocsInStore(storeDbName: string): Promise<number> {
  return new Promise<number>((resolve) => {
    let conn: IDBDatabase | null = null;
    try {
      const req = indexedDB.open(storeDbName);
      req.onupgradeneeded = (ev) => {
        // oldVersion === 0 → the store does not exist yet; abort so the
        // probe does not CREATE it (onerror then resolves as 0).
        if ((ev as IDBVersionChangeEvent).oldVersion === 0) {
          try {
            req.transaction?.abort();
          } catch {
            // ignore — the transaction may already be finished
          }
        }
      };
      req.onsuccess = () => {
        conn = req.result;
        try {
          if (!conn.objectStoreNames.contains("docs")) {
            resolve(0);
            return;
          }
          const countReq = conn
            .transaction("docs")
            .objectStore("docs")
            .count();
          countReq.onsuccess = () => resolve(countReq.result);
          countReq.onerror = () => resolve(0);
        } catch {
          resolve(0);
        } finally {
          try {
            conn.close();
          } catch {
            // ignore
          }
        }
      };
      req.onerror = () => {
        try {
          conn?.close();
        } catch {
          // ignore
        }
        resolve(0);
      };
      req.onblocked = () => {
        try {
          conn?.close();
        } catch {
          // ignore
        }
        resolve(0);
      };
    } catch {
      resolve(0);
    }
  });
}

/**
 * Probes the stores a pending migration would rewrite: for each
 * collection, the schema versions immediately below its current one
 * (target-1 and target-2 — a collection lives at exactly one on-disk
 * version per release; target-2 covers an interrupted chain from two
 * releases back).
 */
async function estimateRowsByProbing(
  dbName: string,
  collections: EstimateCollectionRef[],
): Promise<number> {
  const prefix = `rxdb-dexie-${dbName}--`;
  let total = 0;
  for (const ref of collections) {
    const target = ref.version;
    for (let v = target - 1; v >= Math.max(1, target - 2); v--) {
      total += await countDocsInStore(`${prefix}${v}--${ref.name}`);
    }
  }
  return total;
}

/**
 * Estimates the total rows in the vault's Dexie stores.
 *
 * @param dbName      RxDB database name (e.g. `bookmarkforge_v5`).
 * @param collections Current collection schemas; the store-name versions
 *                    to probe are derived from them.
 * @returns Total row count (0 when IndexedDB is unavailable or no stores
 *          exist). Never throws.
 */
export async function estimateExistingRows(
  dbName: string,
  collections: EstimateCollectionRef[],
): Promise<number> {
  if (typeof indexedDB === "undefined") {
    return 0;
  }

  // Chromium/Firefox: enumerate the vault's Dexie stores cheaply and
  // count every `rxdb-dexie-<dbName>--*` store (any schema version).
  if (typeof indexedDB.databases === "function") {
    try {
      const dbs = await indexedDB.databases();
      const prefix = `rxdb-dexie-${dbName}--`;
      let total = 0;
      for (const meta of dbs) {
        if (!meta.name || !meta.name.startsWith(prefix) || !meta.version) {
          continue;
        }
        total += await countDocsInStore(meta.name);
      }
      return total;
    } catch {
      // fall through to the probing path below
    }
  }

  // Safari: no indexedDB.databases() — probe the known store names.
  return estimateRowsByProbing(dbName, collections);
}
