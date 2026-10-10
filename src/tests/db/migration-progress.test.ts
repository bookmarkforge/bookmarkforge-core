import { describe, it, expect, beforeEach } from "vitest";
import {
  getMigrationProgress,
  subscribeMigrationProgress,
  updateCollectionMigrationProgress,
  setVaultLoadingRows,
  resetMigrationProgress,
  type CollectionMigrationProgress,
} from "../../db/migration-progress";

/**
 * Direct unit tests for the migration-progress pub/sub store
 * (src/db/migration-progress.ts). The module keeps a singleton snapshot,
 * so every test starts from a clean reset.
 */
describe("migration-progress store", () => {
  beforeEach(() => {
    resetMigrationProgress();
  });

  it("starts with an empty inactive snapshot", () => {
    expect(getMigrationProgress()).toEqual({
      active: false,
      collections: [],
      total: 0,
      handled: 0,
      percent: 0,
      error: undefined,
      loadingRows: null,
    });
  });

  it("returns a stable reference until the next update", () => {
    const first = getMigrationProgress();
    expect(getMigrationProgress()).toBe(first);
    updateCollectionMigrationProgress(entry("bookmarks", "RUNNING", 100, 10));
    expect(getMigrationProgress()).not.toBe(first);
  });

  it("upserts per collectionName and moves the replaced entry last", () => {
    updateCollectionMigrationProgress(entry("bookmarks", "RUNNING", 100, 10));
    updateCollectionMigrationProgress(entry("documents", "RUNNING", 50, 50));
    updateCollectionMigrationProgress(entry("bookmarks", "RUNNING", 100, 40));
    const state = getMigrationProgress();
    expect(state.collections.map((c) => c.collectionName)).toEqual([
      "documents",
      "bookmarks",
    ]);
    expect(state.collections[1]!.handled).toBe(40);
  });

  it("aggregates totals across collections and floors the percent", () => {
    updateCollectionMigrationProgress(entry("bookmarks", "DONE", 1000, 250));
    updateCollectionMigrationProgress(entry("documents", "DONE", 100, 100));
    const state = getMigrationProgress();
    expect(state.total).toBe(1100);
    expect(state.handled).toBe(350);
    expect(state.percent).toBe(31); // floor(350 / 1100 * 100)
  });

  it("keeps percent at 0 when nothing is handled yet", () => {
    updateCollectionMigrationProgress(entry("bookmarks", "RUNNING", 100, 0));
    expect(getMigrationProgress().percent).toBe(0);
  });

  it("stays active while any collection RUNNING and flips inactive when all finish", () => {
    updateCollectionMigrationProgress(entry("bookmarks", "RUNNING", 10, 5));
    updateCollectionMigrationProgress(entry("documents", "DONE", 10, 10));
    expect(getMigrationProgress().active).toBe(true);
    updateCollectionMigrationProgress(entry("bookmarks", "DONE", 10, 10));
    const state = getMigrationProgress();
    expect(state.active).toBe(false);
    expect(state.collections).toHaveLength(2); // DONE entries are retained
  });

  it("surfaces the first ERROR entry and clears it once that collection finishes", () => {
    updateCollectionMigrationProgress({
      ...entry("chunks", "ERROR", 5, 2),
      error: "schema mismatch",
    });
    expect(getMigrationProgress().error).toBe("schema mismatch");
    updateCollectionMigrationProgress(entry("chunks", "DONE", 5, 5));
    expect(getMigrationProgress().error).toBeUndefined();
  });

  it("publishes the reopen loading row count without activating a migration", () => {
    setVaultLoadingRows(2000);
    const state = getMigrationProgress();
    expect(state.loadingRows).toBe(2000);
    expect(state.active).toBe(false);
    expect(state.total).toBe(0);
  });

  it("lets a RUNNING migration supersede the loading rows", () => {
    setVaultLoadingRows(2000);
    updateCollectionMigrationProgress(entry("bookmarks", "RUNNING", 2000, 100));
    expect(getMigrationProgress().loadingRows).toBeNull();
  });

  it("preserves loadingRows across non-RUNNING updates", () => {
    setVaultLoadingRows(2000);
    updateCollectionMigrationProgress(entry("documents", "DONE", 50, 50));
    expect(getMigrationProgress().loadingRows).toBe(2000);
  });

  it("notifies subscribers once per mutation", () => {
    let notified = 0;
    subscribeMigrationProgress(() => {
      notified += 1;
    });
    updateCollectionMigrationProgress(entry("a", "RUNNING", 10, 1));
    updateCollectionMigrationProgress(entry("b", "RUNNING", 10, 2));
    setVaultLoadingRows(5);
    expect(notified).toBe(3);
  });

  it("notifies every subscriber and stops after unsubscribe", () => {
    const seen: string[] = [];
    const unsubA = subscribeMigrationProgress(() => {
      seen.push("a");
    });
    subscribeMigrationProgress(() => {
      seen.push("b");
    });
    updateCollectionMigrationProgress(entry("bookmarks", "RUNNING", 10, 1));
    expect(seen).toEqual(["a", "b"]);
    unsubA();
    updateCollectionMigrationProgress(entry("bookmarks", "RUNNING", 10, 2));
    expect(seen).toEqual(["a", "b", "b"]);
  });

  it("tolerates a double unsubscribe", () => {
    const unsub = subscribeMigrationProgress(() => {});
    unsub();
    expect(() => unsub()).not.toThrow();
    // Store still usable after the extra unsubscribe.
    updateCollectionMigrationProgress(entry("bookmarks", "DONE", 1, 1));
    expect(getMigrationProgress().percent).toBe(100);
  });

  it("reset clears the store and notifies subscribers", () => {
    setVaultLoadingRows(5000);
    updateCollectionMigrationProgress(entry("bookmarks", "RUNNING", 10, 5));
    let notified = 0;
    subscribeMigrationProgress(() => {
      notified += 1;
    });
    resetMigrationProgress();
    expect(notified).toBe(1);
    expect(getMigrationProgress()).toEqual({
      active: false,
      collections: [],
      total: 0,
      handled: 0,
      percent: 0,
      error: undefined,
      loadingRows: null,
    });
  });
});

function entry(
  collectionName: string,
  status: CollectionMigrationProgress["status"],
  total: number,
  handled: number,
): CollectionMigrationProgress {
  return {
    collectionName,
    status,
    total,
    handled,
    percent: total > 0 ? Math.floor((handled / total) * 100) : 0,
  };
}
