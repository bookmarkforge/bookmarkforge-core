/**
 * estimate-rows — regression tests for the adaptive-init-timeout row
 * estimator (src/db/estimate-rows.ts).
 *
 * Covers the two discovery paths:
 *   1. Chromium/Firefox — `indexedDB.databases()` enumeration.
 *   2. Safari — no `indexedDB.databases()`; the estimator probes the known
 *      `rxdb-dexie-<dbName>--<version>--<collection>` store names for the
 *      schema versions below each collection's current one.
 *
 * Critical invariants asserted here:
 *   - both paths agree on a pre-migration vault (stores at old versions);
 *   - the probing path NEVER creates databases (an upgrade transaction on
 *     a nonexistent store is aborted, so the count is side-effect free);
 *   - a vault with no stores estimates 0 on both paths.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { estimateExistingRows, type EstimateCollectionRef } from "../../db/estimate-rows";

// Mirrors the real vault shape (bookmarks at v7, etc.). The estimator only
// uses name + version, so a representative subset is enough.
const COLLECTIONS: EstimateCollectionRef[] = [
  { name: "bookmarks", version: 8 },
  { name: "documents", version: 2 },
  { name: "templates", version: 3 },
  { name: "folders", version: 4 },
];

function createStore(name: string, rows: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("docs", { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("docs", "readwrite");
      for (let i = 0; i < rows; i++) {
        tx.objectStore("docs").put({ id: `r${i}`, v: i });
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

async function listDatabaseNames(): Promise<string[]> {
  const dbs = await indexedDB.databases();
  return dbs.map((d) => d.name).filter((n): n is string => Boolean(n));
}

/** Simulates Safari: hide indexedDB.databases() behind an own property. */
function shadowDatabases(): void {
  Object.defineProperty(indexedDB, "databases", {
    value: undefined,
    configurable: true,
  });
}

function restoreDatabases(): void {
  delete (indexedDB as { databases?: unknown }).databases;
}

async function clearAllStores(): Promise<void> {
  const names = await listDatabaseNames();
  await Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        }),
    ),
  );
}

describe("estimateExistingRows", () => {
  beforeEach(async () => {
    await clearAllStores();
    restoreDatabases();
  });
  afterEach(() => {
    // A test may shadow databases() mid-body and fail before restoring;
    // guarantee the next test starts with the real API.
    restoreDatabases();
  });

  it("returns 0 when no vault stores exist (databases() path)", async () => {
    await expect(estimateExistingRows("testdb", COLLECTIONS)).resolves.toBe(0);
  });

  it("returns 0 when no vault stores exist (Safari probing path)", async () => {
    shadowDatabases();
    await expect(estimateExistingRows("testdb", COLLECTIONS)).resolves.toBe(0);
  });

  it("counts rows across all vault stores via databases() enumeration", async () => {
    await createStore("rxdb-dexie-testdb--6--bookmarks", 3);
    await createStore("rxdb-dexie-testdb--1--documents", 5);
    // A store at the CURRENT version (already migrated) is still counted
    // by the enumeration path — the budget stays generous either way.
    await createStore("rxdb-dexie-testdb--8--bookmarks", 2);
    await expect(estimateExistingRows("testdb", COLLECTIONS)).resolves.toBe(10);
  });

  it("Safari path counts the stores a pending migration would rewrite", async () => {
    shadowDatabases();
    // bookmarks v8 → probe v6 and v5 (v6 exists, 3 rows)
    await createStore("rxdb-dexie-testdb--6--bookmarks", 3);
    // templates v3 → probe v2 and v1 (v2 exists, 4 rows)
    await createStore("rxdb-dexie-testdb--2--templates", 4);
    // documents v2 → probe v1 (does not exist → 0)
    // Current-version stores are NOT rewritten by a migration: v8 is not
    // probed and must not inflate the estimate.
    await createStore("rxdb-dexie-testdb--8--bookmarks", 99);
    await expect(estimateExistingRows("testdb", COLLECTIONS)).resolves.toBe(7);
  });

  it("both discovery paths agree on a pre-migration vault", async () => {
    await createStore("rxdb-dexie-testdb--6--bookmarks", 3);
    await createStore("rxdb-dexie-testdb--3--folders", 5);
    await createStore("rxdb-dexie-testdb--1--documents", 2);

    const withDatabases = await estimateExistingRows("testdb", COLLECTIONS);
    shadowDatabases();
    const safariPath = await estimateExistingRows("testdb", COLLECTIONS);
    restoreDatabases();

    expect(withDatabases).toBe(10);
    expect(safariPath).toBe(10);
  });

  it("Safari probing never creates databases", async () => {
    shadowDatabases();
    // No stores exist; probing v6/v5/v2/v1... for every collection must
    // abort the upgrade transactions instead of creating empty databases.
    await expect(estimateExistingRows("testdb", COLLECTIONS)).resolves.toBe(0);
    restoreDatabases();
    await expect(listDatabaseNames()).resolves.toHaveLength(0);
  });

  it("ignores stores that belong to a different database name", async () => {
    await createStore("rxdb-dexie-otherdb--6--bookmarks", 8);
    await expect(estimateExistingRows("testdb", COLLECTIONS)).resolves.toBe(0);
  });

  it("counts stores that are not at IndexedDB version 1 (Dexie layout)", async () => {
    // RxDB/Dexie can map its schema versions onto IDB versions > 1; a
    // version-locked open would fail with VersionError and misreport 0.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("rxdb-dexie-testdb--6--bookmarks", 3);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("docs", { keyPath: "id" });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("docs", "readwrite");
        tx.objectStore("docs").put({ id: "a", v: 1 });
        tx.objectStore("docs").put({ id: "b", v: 2 });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      req.onerror = () => reject(req.error);
    });
    await expect(estimateExistingRows("testdb", COLLECTIONS)).resolves.toBe(2);
  });

  it("ignores stores without a docs object store", async () => {
    await createStore("rxdb-dexie-testdb--6--bookmarks", 3);
    // A store whose schema has no `docs` table counts as 0 (older RxDB
    // layouts or foreign stores sharing the prefix).
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("rxdb-dexie-testdb--1--documents", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("other", { keyPath: "id" });
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    await expect(estimateExistingRows("testdb", COLLECTIONS)).resolves.toBe(3);
  });
});
