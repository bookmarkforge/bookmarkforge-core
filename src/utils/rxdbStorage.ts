/* eslint-disable @typescript-eslint/no-explicit-any -- RxDB's RxStorage
 * generics are intentionally opaque; this factory mirrors the any-heavy
 * plumbing of rxdb's own storage plugins. */
import type { RxStorage } from "rxdb";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { getRxStorageLocalstorage } from "rxdb/plugins/storage-localstorage";
import { wrappedKeyCompressionStorage } from "rxdb/plugins/key-compression";

/**
 * Detects whether IndexedDB (the runtime backend Dexie uses) is available.
 * IndexedDB is broadly supported in browsers and workers; this guard exists
 * so the factory can fall back to localStorage in exotic/embedded runtimes
 * that lack it.
 */
function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

interface RxStorageConfig {
  /** Enable key compression (zlib) for stored documents */
  keyCompression?: boolean;
  /** Maximum database size in bytes (backend specific; advisory only) */
  maxSize?: number;
}

/**
 * Creates an RxDB storage backend that prioritizes Dexie (IndexedDB) with a
 * localStorage fallback.
 *
 * - Tries `getRxStorageDexie()` first when IndexedDB is available — the
 *   durable, production-grade backend
 * - Falls back to `getRxStorageLocalstorage()` only when IndexedDB is missing
 * - Enables key compression via `wrappedKeyCompressionStorage` when requested
 *
 * @returns A configured storage backend ready for use with createRxDatabase
 */
export function createRxStorage(
  config: RxStorageConfig = {},
): RxStorage<any, any> {
  const { keyCompression = true } = config;

  let storage: RxStorage<any, any> = isIndexedDbAvailable()
    ? getRxStorageDexie()
    : getRxStorageLocalstorage();

  if (keyCompression) {
    storage = wrappedKeyCompressionStorage({ storage });
  }

  return storage;
}

