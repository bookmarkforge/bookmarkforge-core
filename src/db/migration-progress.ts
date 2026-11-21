/**
 * migration-progress — tiny pub/sub store that surfaces RxDB's schema
 * migration progress (RxMigrationStatus.count) to the UI while
 * `initDB()` is still awaiting `addCollections`.
 *
 * The migration runs INSIDE `createDBInstance` (database.ts), which the
 * UI awaits before it ever gets the `RxDatabase` object — so the UI has
 * no direct handle on `db.migrationStates()`. database.ts therefore
 * subscribes to the RxDB migration states and mirrors the aggregate into
 * this module; AppContent reads it via `useMigrationProgress` and renders
 * a "migrating vault" screen with a progress bar instead of a static
 * "Loading…" for the (potentially minutes-long) v6→v7 rewrite.
 *
 * The store ALSO carries the plain reopen state: while initDB() opens the
 * collections on a normal reopen (no migration), database.ts publishes
 * the estimated row count via `setVaultLoadingRows` so the UI can show a
 * "Loading vault… N items" overlay instead of a silent spinner. A RUNNING
 * migration supersedes it (updateCollectionMigrationProgress clears it),
 * and the init cleanup (resetMigrationProgress) drops it when the open
 * settles.
 *
 * Deliberately dependency-free so it can be unit-tested without React or
 * RxDB.
 */

export interface CollectionMigrationProgress {
  collectionName: string;
  status: "RUNNING" | "DONE" | "ERROR";
  total: number;
  handled: number;
  percent: number;
  error?: string;
}

export interface VaultMigrationProgress {
  /** True while at least one collection migration is running. */
  active: boolean;
  collections: CollectionMigrationProgress[];
  /** Sum of per-collection totals/handled and the overall percent. */
  total: number;
  handled: number;
  percent: number;
  /** First collection-level error message, if any. */
  error?: string;
  /**
   * Estimated rows already in the vault's Dexie stores while initDB()
   * opens the collections WITHOUT a schema migration (a normal reopen).
   * `null` when no init is in flight or once a migration takes over
   * (see updateCollectionMigrationProgress).
   */
  loadingRows: number | null;
}

let state: VaultMigrationProgress = createEmptyProgress();

function createEmptyProgress(): VaultMigrationProgress {
  return {
    active: false,
    collections: [],
    total: 0,
    handled: 0,
    percent: 0,
    loadingRows: null,
  };
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Current snapshot (stable reference until the next update). */
export function getMigrationProgress(): VaultMigrationProgress {
  return state;
}

/** Subscribe to progress changes; returns an unsubscribe function. */
export function subscribeMigrationProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Replaces/upserts one collection's progress and recomputes the
 * aggregate. Keeps entries for DONE/ERROR collections so the UI can show
 * the full picture; `active` stays true while any collection RUNNING.
 */
export function updateCollectionMigrationProgress(
  entry: CollectionMigrationProgress,
): void {
  const collections = [
    ...state.collections.filter(
      (c) => c.collectionName !== entry.collectionName,
    ),
    entry,
  ];
  const total = collections.reduce((sum, c) => sum + c.total, 0);
  const handled = collections.reduce((sum, c) => sum + c.handled, 0);
  // Once a collection migration actually RUNS it supersedes the plain
  // reopen loading state: the migrating screen shows its own totals, and
  // keeping loadingRows here would re-show the loading screen right after
  // the last migration flips DONE (active → false) but before the init
  // cleanup resets the store.
  const migrationRunning = collections.some((c) => c.status === "RUNNING");
  state = {
    active: migrationRunning,
    collections,
    total,
    handled,
    percent: total > 0 ? Math.floor((handled / total) * 100) : 0,
    error: collections.find((c) => c.status === "ERROR")?.error,
    loadingRows: migrationRunning ? null : state.loadingRows,
  };
  emit();
}

/**
 * Publishes the plain reopen state: `estimatedRows` rows are already in
 * the vault and `addCollections` is opening them (no schema migration
 * pending). The UI shows a "Loading vault… N items" indicator instead of
 * a static spinner. Cleared by `resetMigrationProgress()` and replaced by
 * `null` once a migration starts.
 */
export function setVaultLoadingRows(estimatedRows: number): void {
  state = {
    ...state,
    loadingRows: estimatedRows,
  };
  emit();
}

/** Clears the store (called when the init attempt settles). */
export function resetMigrationProgress(): void {
  state = createEmptyProgress();
  emit();
}
