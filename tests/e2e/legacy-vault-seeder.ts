/**
 * legacy-vault-seeder — Vite-served helper for the F-06 migration e2e spec.
 *
 * `page.evaluate` cannot resolve bare `rxdb` specifiers, but a module served
 * through Vite CAN: this file is imported via the dev-server URL
 * (`/tests/e2e/legacy-vault-seeder.ts`), so Vite resolves the rxdb plugin
 * imports to the same optimized bundles the app uses — guaranteeing the
 * seeded vault is written with the exact pre-F-06 stack (CryptoJS field
 * encryption only, no authenticated envelope).
 *
 * It builds a `bookmarkforge_v5` database at bookmarkSchema **v6** using
 * rxdb's own `wrappedKeyEncryptionCryptoJsStorage` chain — the real code
 * that shipped before F-06 — inserts one bookmark and closes.
 */
import { addRxPlugin, createRxDatabase } from "rxdb";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { RxDBDevModePlugin, disableWarnings } from "rxdb/plugins/dev-mode";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { wrappedKeyEncryptionCryptoJsStorage } from "rxdb/plugins/encryption-crypto-js";
import { wrappedValidateZSchemaStorage } from "rxdb/plugins/validate-z-schema";

export interface LegacySeedOptions {
  password: string;
  /** Single bookmark, or an array for bulk seeding (benchmarks). */
  bookmark: Record<string, unknown> | Record<string, unknown>[];
}

/** Identity migrations for the six pre-F-06 schema steps. */
const noop = (doc: Record<string, unknown>) => ({ ...doc });

/**
 * Seeds a legacy (pre-F-06) encrypted vault into the page's IndexedDB.
 * Fails loudly (returns {ok:false}) instead of throwing so the spec can
 * report the app-side root cause.
 */
export async function seedLegacyVault(
  options: LegacySeedOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  disableWarnings();
  addRxPlugin(RxDBDevModePlugin);
  addRxPlugin(RxDBMigrationSchemaPlugin);

  const storage = wrappedValidateZSchemaStorage({
    storage: wrappedKeyEncryptionCryptoJsStorage({
      storage: getRxStorageDexie(),
    }),
  });

  // urlHash is required exactly as in the real pre-F-06 v6 schema (Dexie
  // rejects indexes on non-required fields — DXE1).
  const schema = legacyV6BookmarkSchema;

  const db = await openLegacyDb(options.password);
  try {
    await db.addCollections({
      bookmarks: {
        schema,
        migrationStrategies: {
          1: noop,
          2: noop,
          3: noop,
          4: noop,
          5: noop,
          6: noop,
        },
      },
    });
    const bookmarks = (db as any).bookmarks;
    if (Array.isArray(options.bookmark)) {
      await bookmarks.bulkInsert(options.bookmark);
    } else {
      await bookmarks.insert(options.bookmark);
    }
    await db.close();
    return { ok: true };
  } catch (err) {
    await db.close().catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Pre-F-06 v6 bookmark schema (CryptoJS-only, no authenticated envelope). */
const legacyV6BookmarkSchema = {
  title: "bookmark schema",
  version: 6,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    url: { type: "string", maxLength: 2000 },
    urlHash: { type: "string", maxLength: 64 },
    title: { type: "string", maxLength: 500 },
    content: { type: "string", maxLength: 10_000_000 },
    summary: { type: "string", maxLength: 100_000 },
    tags: { type: "array", items: { type: "string" } },
    relatedLinks: {
      type: "array",
      items: { type: "string", maxLength: 2000 },
    },
    embedding: { type: "array", items: { type: "number" } },
    processed: { type: "boolean" },
    isPrivate: { type: "boolean" },
    isDeleted: { type: "boolean" },
    broken: { type: "boolean" },
    lastChecked: { type: "string", format: "date-time", maxLength: 100 },
    lastVisitedAt: { type: "string", format: "date-time", maxLength: 100 },
    visitCount: {
      type: "number",
      multipleOf: 1,
      minimum: 0,
      maximum: 1000000,
    },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
    updatedAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: [
    "id",
    "url",
    "urlHash",
    "title",
    "createdAt",
    "updatedAt",
    "processed",
    "isPrivate",
    "isDeleted",
  ],
  indexes: [
    "urlHash",
    "createdAt",
    "updatedAt",
    "processed",
    "isDeleted",
    ["isPrivate", "isDeleted", "createdAt"],
    ["isDeleted", "createdAt"],
    ["isDeleted", "updatedAt"],
    ["processed", "isDeleted"],
    ["processed", "createdAt"],
    ["isDeleted", "processed", "createdAt"],
  ],
  encrypted: [
    "url",
    "title",
    "content",
    "summary",
    "relatedLinks",
    "embedding",
  ],
};

/** The v7 schema differs from v6 only by the version bump. */
const v7BookmarkSchema = {
  ...legacyV6BookmarkSchema,
  version: 7,
};

/**
 * Opens a `bookmarkforge_v5` database with the CURRENT post-F-06 stack
 * (CryptoJS + authenticated AES-GCM envelope + z-schema validation).
 */
async function openCurrentStackDb(password: string) {
  const { authenticatedEncryptionStorage } = await import(
    "/src/db/authEncryptionStorage.ts"
  );
  const storage = wrappedValidateZSchemaStorage({
    storage: authenticatedEncryptionStorage({
      storage: wrappedKeyEncryptionCryptoJsStorage({
        storage: getRxStorageDexie(),
      }),
    }),
  });
  return createRxDatabase({
    name: "bookmarkforge_v5",
    storage,
    password,
    closeDuplicates: true,
    ignoreDuplicate: true,
  });
}

/** Legacy-only stack used by the seeder (pre-F-06). */
async function openLegacyDb(password: string) {
  const storage = wrappedValidateZSchemaStorage({
    storage: wrappedKeyEncryptionCryptoJsStorage({
      storage: getRxStorageDexie(),
    }),
  });
  return createRxDatabase({
    name: "bookmarkforge_v5",
    storage,
    password,
    closeDuplicates: true,
    ignoreDuplicate: true,
  });
}

export interface MigrationProbeResult {
  ok: boolean;
  error?: string;
  /** addCollections() wall time — the pure v6→v7 rewrite. */
  ms?: number;
  /** Post-migration row count (should equal the seed count). */
  total?: number;
}

/**
 * Times the pure v6→v7 schema migration (the authenticated-envelope
 * rewrite) with the CURRENT storage stack, WITHOUT the rest of the app
 * boot. Returns wall-clock ms for addCollections + the migrated row count.
 */
export async function measureAuthMigration(
  password: string,
): Promise<MigrationProbeResult> {
  return runMigrationProbe(password, openCurrentStackDb);
}

/** Same migration but WITHOUT the authenticated envelope (CryptoJS only). */
export async function measureLegacyMigration(
  password: string,
): Promise<MigrationProbeResult> {
  return runMigrationProbe(password, openLegacyDb);
}

/** Same migration but with NO encryption at all (plain Dexie). */
export async function measurePlainMigration(
  password: string,
): Promise<MigrationProbeResult> {
  const storage = wrappedValidateZSchemaStorage({
    storage: getRxStorageDexie(),
  });
  // A plain stack cannot handle a schema with an `encrypted` array (UT6).
  const schema: any = { ...v7BookmarkSchema };
  delete schema.encrypted;
  const open = () =>
    createRxDatabase({
      name: "bookmarkforge_v5",
      storage,
      password,
      ignoreDuplicate: true,
    });
  return runMigrationProbeWithSchema(password, open, schema);
}

async function runMigrationProbe(
  password: string,
  open: (password: string) => Promise<any>,
): Promise<MigrationProbeResult> {
  return runMigrationProbeWithSchema(password, open, v7BookmarkSchema);
}

async function runMigrationProbeWithSchema(
  password: string,
  open: (password: string) => Promise<any>,
  schema: any,
): Promise<MigrationProbeResult> {
  disableWarnings();
  addRxPlugin(RxDBMigrationSchemaPlugin);
  const db = await open(password);
  const t0 = performance.now();
  try {
    await db.addCollections({
      bookmarks: {
        schema,
        migrationStrategies: {
          1: noop,
          2: noop,
          3: noop,
          4: noop,
          5: noop,
          6: noop,
          7: noop,
        },
      },
    });
    const ms = performance.now() - t0;
    const total = await (db as any).bookmarks.count().exec();
    await db.close();
    return { ok: true, ms, total };
  } catch (err) {
    await db.close().catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Hard-wipes every RxDB Dexie store of the vault (named
 * `rxdb-dexie-<db>--<collection>`; `destroyDB` only works from the app
 * page that owns the singleton). Deliberately does NOT touch
 * `bookmarkforge_secure_vault` — that holds the SecurityVault metadata
 * (verification token, wrapped device key) the app needs to unlock.
 */
export async function wipeVaultDatabases(): Promise<string[]> {
  const names = await indexedDB.databases();
  const targets = names
    .map((d) => d.name)
    .filter((n): n is string => Boolean(n) && /^rxdb-dexie-/i.test(n!));
  // Retry blocked deletions: a stale connection (e.g. the app page) can
  // hold the DB open; once it closes, the deletion goes through.
  for (let attempt = 0; attempt < 5 && targets.length > 0; attempt++) {
    const remaining: string[] = [];
    for (const name of targets) {
      const ok = await new Promise<boolean>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        req.onblocked = () => {
          // Keep waiting: the blocking connection may close on its own.
          setTimeout(() => resolve(false), 400);
        };
      });
      if (!ok) {
        remaining.push(name);
      }
    }
    targets.length = 0;
    targets.push(...remaining);
    if (remaining.length > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return targets;
}

/**
 * Times ONLY the per-field crypto: 6 fields per row, encrypt + decrypt,
 * the exact work the auth envelope adds to each migrated row.
 */
export async function measureCryptoCost(
  password: string,
  rows: number,
): Promise<{ ok: boolean; error?: string; ms?: number; ops?: number }> {
  try {
    const { encrypt, decrypt } = await import("/src/utils/crypto-core.ts");
    const fields = [
      "https://example.com/bench-0/a-very-long-url-path",
      "Benchmark Bookmark Title",
      "Some content body",
      "A short summary",
      JSON.stringify(["https://example.com/related-1", "https://example.com/related-2"]),
      JSON.stringify([0.1, 0.2, 0.3, 0.4]),
    ];
    const t0 = performance.now();
    for (let i = 0; i < rows; i++) {
      for (const f of fields) {
        const ct = await encrypt(f, password);
        await decrypt(ct, password);
      }
    }
    const ms = performance.now() - t0;
    return { ok: true, ms, ops: rows * fields.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
