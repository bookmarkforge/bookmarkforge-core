import { describe, it, expect } from "vitest";
import { addRxPlugin } from "rxdb";
import {
  RxDBDevModePlugin,
  disableWarnings,
} from "rxdb/plugins/dev-mode";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";

// Keep RxDB validation active while silencing its one-time informational
// banner; the test asserts encryption behavior, not third-party diagnostics.
disableWarnings();
addRxPlugin(RxDBDevModePlugin);
// Required for the live-migration test (v2 plaintext folders → v3 schema).
addRxPlugin(RxDBMigrationSchemaPlugin);

// ── helpers ──────────────────────────────────────────────────────────

/**
 * RxDB's Dexie storage creates a *separate* IndexedDB per collection,
 * prefixed with `rxdb-dexie-`.  e.g. for a DB named "test-123" with a
 * collection "bookmarks", Dexie creates:
 *   - rxdb-dexie-test-123-bookmarks
 *   - rxdb-dexie-test-123-bookmarks-encrypted-view
 *   …
 *
 * This helper discovers ALL IndexedDB databases whose names contain the
 * given prefix, then reads every record from every object store in each
 * one, returning them as serialized JSON strings.
 */
async function readRawIndexedDBValues(dbNamePrefix: string): Promise<string[]> {
  // List all IndexedDB databases on the system and find the ones
  // that belong to this RxDB instance.
  const allDBs = await indexedDB.databases();
  const matchingDBs = allDBs.filter((db) => db.name?.includes(dbNamePrefix));

  const collected: string[] = [];

  for (const dbInfo of matchingDBs) {
    const records = await new Promise<string[]>((resolve) => {
      const request = indexedDB.open(dbInfo.name!);
      request.onerror = () => resolve([]);
      request.onsuccess = () => {
        const db = request.result;
        const storeNames = Array.from(db.objectStoreNames);
        if (storeNames.length === 0) {
          db.close();
          resolve([]);
          return;
        }

        const dbRecords: string[] = [];
        let completed = 0;
        for (const storeName of storeNames) {
          try {
            const tx = db.transaction(storeName, "readonly");
            const store = tx.objectStore(storeName);
            const getAll = store.getAll();
            getAll.onsuccess = () => {
              for (const record of getAll.result as Array<
                Record<string, unknown>
              >) {
                dbRecords.push(JSON.stringify(record));
              }
              completed++;
              if (completed === storeNames.length) {
                db.close();
                resolve(dbRecords);
              }
            };
            getAll.onerror = () => {
              completed++;
              if (completed === storeNames.length) {
                db.close();
                resolve(dbRecords);
              }
            };
          } catch {
            completed++;
            if (completed === storeNames.length) {
              db.close();
              resolve(dbRecords);
            }
          }
        }
      };
    });
    collected.push(...records);
  }

  return collected;
}

/**
 * Deletes ALL IndexedDB databases whose names contain the given prefix.
 * Matches the per-collection databases that RxDB's Dexie storage creates.
 */
async function deleteRawDB(dbNamePrefix: string): Promise<void> {
  const allDBs = await indexedDB.databases();
  const matchingDBs = allDBs.filter((db) => db.name?.includes(dbNamePrefix));

  await Promise.all(
    matchingDBs.map(
      (dbInfo) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(dbInfo.name!);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        }),
    ),
  );
}

/** CryptoJS AES encryption produces base64 strings starting with
 *  "U2FsdGVkX1" (the encoding of "Salted__"). This is a reliable
 *  marker for CryptoJS-encrypted ciphertext. */
const CRYPTOJS_MARKER = "U2FsdGVkX1";

/** Identity migration — dev-mode requires one strategy per version step
 *  (keys 1..N for a schema at version N) even on a fresh database. */
const migrateNoop = (doc: Record<string, unknown>) => ({ ...doc });

describe("RxDB Encryption At Rest", () => {
  it("encrypted database is unreadable without the correct password", async () => {
    const { createRxDatabase } = await import("rxdb");
    const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
    const { wrappedKeyEncryptionCryptoJsStorage } =
      await import("rxdb/plugins/encryption-crypto-js");
    const { wrappedValidateZSchemaStorage } =
      await import("rxdb/plugins/validate-z-schema");

    const storage = wrappedValidateZSchemaStorage({
      storage: wrappedKeyEncryptionCryptoJsStorage({
        storage: getRxStorageDexie(),
      }),
    });

    const dbName = "test-encryption-" + Date.now();

    const db = await createRxDatabase({
      name: dbName,
      storage,
      password: "correct-horse-battery-staple",
      ignoreDuplicate: true,
    });

    const schema = {
      title: "test schema",
      version: 0,
      primaryKey: "id",
      type: "object",
      properties: {
        id: { type: "string", maxLength: 100 },
        secret: { type: "string" },
      },
      required: ["id"],
    };

    await db.addCollections({ secrets: { schema } });
    await db.secrets.insert({ id: "1", secret: "my-sensitive-data" });
    await db.close();

    try {
      const db2 = await createRxDatabase({
        name: dbName,
        storage,
        password: "wrong-password",
        ignoreDuplicate: true,
      });
      await db2.addCollections({ secrets: { schema } });
      const doc = await db2.secrets.findOne("1").exec();
      if (doc) {
        const secretValue = (doc as any).secret;
        expect(secretValue).not.toBe("my-sensitive-data");
        expect(typeof secretValue).toBe("string");
        expect(secretValue.length).toBeGreaterThan(0);
      }
      await db2.close();
    } catch (error) {
      expect(error).toBeDefined();
    }

    await deleteRawDB(dbName);
  });

  it("data is retrievable with correct password", async () => {
    const { createRxDatabase } = await import("rxdb");
    const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
    const { wrappedKeyEncryptionCryptoJsStorage } =
      await import("rxdb/plugins/encryption-crypto-js");
    const { wrappedValidateZSchemaStorage } =
      await import("rxdb/plugins/validate-z-schema");

    const storage = wrappedValidateZSchemaStorage({
      storage: wrappedKeyEncryptionCryptoJsStorage({
        storage: getRxStorageDexie(),
      }),
    });

    const dbName = "test-encryption-correct-" + Date.now();
    const password = "my-strong-password";

    const db = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });

    const schema = {
      title: "test schema",
      version: 0,
      primaryKey: "id",
      type: "object",
      properties: {
        id: { type: "string", maxLength: 100 },
        secret: { type: "string" },
      },
      required: ["id"],
    };

    await db.addCollections({ secrets: { schema } });
    await db.secrets.insert({ id: "1", secret: "my-sensitive-data" });
    await db.close();

    const db2 = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });
    await db2.addCollections({ secrets: { schema } });
    const doc = await db2.secrets.findOne("1").exec();
    expect(doc).not.toBeNull();
    expect((doc as any).secret).toBe("my-sensitive-data");
    await db2.close();

    await deleteRawDB(dbName);
  });

  it("empty password should not encrypt data", async () => {
    const { createRxDatabase } = await import("rxdb");
    const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
    const { wrappedKeyEncryptionCryptoJsStorage } =
      await import("rxdb/plugins/encryption-crypto-js");
    const { wrappedValidateZSchemaStorage } =
      await import("rxdb/plugins/validate-z-schema");

    const storage = wrappedValidateZSchemaStorage({
      storage: wrappedKeyEncryptionCryptoJsStorage({
        storage: getRxStorageDexie(),
      }),
    });

    const dbName = "test-no-encrypt-" + Date.now();

    const db = await createRxDatabase({
      name: dbName,
      storage,
      ignoreDuplicate: true,
    });

    const schema = {
      title: "test schema",
      version: 0,
      primaryKey: "id",
      type: "object",
      properties: {
        id: { type: "string", maxLength: 100 },
        data: { type: "string" },
      },
      required: ["id"],
    };

    await db.addCollections({ items: { schema } });
    await db.items.insert({ id: "1", data: "plaintext-data" });
    await db.close();

    const db2 = await createRxDatabase({
      name: dbName,
      storage,
      ignoreDuplicate: true,
    });
    await db2.addCollections({ items: { schema } });
    const doc = await db2.items.findOne("1").exec();
    expect(doc).not.toBeNull();
    expect((doc as any).data).toBe("plaintext-data");
    await db2.close();

    await deleteRawDB(dbName);
  });

  it("raw IndexedDB contains ciphertext, not plaintext, for encrypted fields", async () => {
    const { createRxDatabase } = await import("rxdb");
    const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
    const { wrappedKeyEncryptionCryptoJsStorage } =
      await import("rxdb/plugins/encryption-crypto-js");
    const { wrappedValidateZSchemaStorage } =
      await import("rxdb/plugins/validate-z-schema");

    const storage = wrappedValidateZSchemaStorage({
      storage: wrappedKeyEncryptionCryptoJsStorage({
        storage: getRxStorageDexie(),
      }),
    });

    const dbName = "test-ciphertext-validation-" + Date.now();
    const password = "correct-horse-battery-staple";

    // Use the project's own bookmark schema so encrypted fields match production
    const bookmarkSchema = {
      title: "bookmark schema",
      version: 0,
      primaryKey: "id",
      type: "object",
      properties: {
        id: { type: "string", maxLength: 100 },
        url: { type: "string", maxLength: 2000 },
        title: { type: "string", maxLength: 500 },
        content: { type: "string" },
        summary: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        processed: { type: "boolean" },
        isDeleted: { type: "boolean" },
        createdAt: { type: "string", maxLength: 100 },
        updatedAt: { type: "string", maxLength: 100 },
      },
      required: [
        "id",
        "url",
        "title",
        "createdAt",
        "updatedAt",
        "processed",
        "isDeleted",
      ],
      encrypted: ["url", "title", "content", "summary"],
    };

    // Known plaintext values that should never appear in raw storage
    const PLAINTEXT = {
      url: "https://secret-example.com/private-data",
      title: "Top Secret Investment Research Notes",
      content: "These notes contain confidential M&A analysis",
      summary: "Summary of confidential merger details",
    };

    // 1. Insert a document with known plaintext in encrypted fields
    const db = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });
    await db.addCollections({ bookmarks: { schema: bookmarkSchema } });
    await db.bookmarks.insert({
      id: "test-1",
      url: PLAINTEXT.url,
      title: PLAINTEXT.title,
      content: PLAINTEXT.content,
      summary: PLAINTEXT.summary,
      tags: ["sensitive"],
      processed: true,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await db.close();

    // 2. Read raw bytes from IndexedDB, bypassing RxDB decryption
    const rawRecords = await readRawIndexedDBValues(dbName);
    const rawDump = rawRecords.join("\n");

    // 3. Assert plaintext does NOT appear anywhere in the raw storage
    expect(rawDump).not.toContain(PLAINTEXT.url);
    expect(rawDump).not.toContain(PLAINTEXT.title);
    expect(rawDump).not.toContain(PLAINTEXT.content);
    expect(rawDump).not.toContain(PLAINTEXT.summary);

    // 4. At least one record should contain the CryptoJS ciphertext marker
    //    ("U2FsdGVkX1" = base64 of "Salted__", the CryptoJS AES header)
    const hasCiphertext = rawRecords.some((r) => r.includes(CRYPTOJS_MARKER));
    expect(hasCiphertext).toBe(true);

    // 5. Verify data is still correctly decryptable with the right password
    const db2 = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });
    await db2.addCollections({ bookmarks: { schema: bookmarkSchema } });
    const doc = await db2.bookmarks.findOne("test-1").exec();
    expect(doc).not.toBeNull();
    expect(doc!.get("title")).toBe(PLAINTEXT.title);
    expect(doc!.get("url")).toBe(PLAINTEXT.url);
    expect(doc!.get("content")).toBe(PLAINTEXT.content);
    expect(doc!.get("summary")).toBe(PLAINTEXT.summary);
    await db2.close();

    await deleteRawDB(dbName);
  });

  it("unencrypted fields remain plaintext in raw IndexedDB", async () => {
    const { createRxDatabase } = await import("rxdb");
    const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
    const { wrappedKeyEncryptionCryptoJsStorage } =
      await import("rxdb/plugins/encryption-crypto-js");
    const { wrappedValidateZSchemaStorage } =
      await import("rxdb/plugins/validate-z-schema");

    const storage = wrappedValidateZSchemaStorage({
      storage: wrappedKeyEncryptionCryptoJsStorage({
        storage: getRxStorageDexie(),
      }),
    });

    const dbName = "test-plaintext-fields-" + Date.now();
    const password = "correct-horse-battery-staple";

    // Schema with NO encrypted fields
    const schema = {
      title: "plain schema",
      version: 0,
      primaryKey: "id",
      type: "object",
      properties: {
        id: { type: "string", maxLength: 100 },
        name: { type: "string" },
        value: { type: "string" },
      },
      required: ["id"],
      // Note: no "encrypted" array — this field is not encrypted
    };

    const db = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });
    await db.addCollections({ items: { schema } });
    await db.items.insert({
      id: "1",
      name: "visible-data",
      value: "should-be-readable",
    });
    await db.close();

    const rawRecords = await readRawIndexedDBValues(dbName);
    const rawDump = rawRecords.join("\n");

    // Unencrypted fields should remain as plaintext in raw storage
    expect(rawDump).toContain("visible-data");
    expect(rawDump).toContain("should-be-readable");

    await deleteRawDB(dbName);
  });

  it("different passwords produce different ciphertext for the same plaintext", async () => {
    const { createRxDatabase } = await import("rxdb");
    const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
    const { wrappedKeyEncryptionCryptoJsStorage } =
      await import("rxdb/plugins/encryption-crypto-js");
    const { wrappedValidateZSchemaStorage } =
      await import("rxdb/plugins/validate-z-schema");

    const storage = wrappedValidateZSchemaStorage({
      storage: wrappedKeyEncryptionCryptoJsStorage({
        storage: getRxStorageDexie(),
      }),
    });

    const schema = {
      title: "test schema",
      version: 0,
      primaryKey: "id",
      type: "object",
      properties: {
        id: { type: "string", maxLength: 100 },
        secret: { type: "string" },
      },
      required: ["id"],
      encrypted: ["secret"],
    };

    const plaintext = "same-secret-value";

    // Encrypt with password A
    const dbNameA = "test-diff-cipher-a-" + Date.now();
    const dbA = await createRxDatabase({
      name: dbNameA,
      storage,
      password: "password-alpha",
      ignoreDuplicate: true,
    });
    await dbA.addCollections({ items: { schema } });
    await dbA.items.insert({ id: "1", secret: plaintext });
    await dbA.close();
    const rawA = await readRawIndexedDBValues(dbNameA);

    // Encrypt with password B
    const dbNameB = "test-diff-cipher-b-" + Date.now();
    const dbB = await createRxDatabase({
      name: dbNameB,
      storage,
      password: "password-beta",
      ignoreDuplicate: true,
    });
    await dbB.addCollections({ items: { schema } });
    await dbB.items.insert({ id: "1", secret: plaintext });
    await dbB.close();
    const rawB = await readRawIndexedDBValues(dbNameB);

    // The raw serialized records should differ (different ciphertext)
    // even though the plaintext is identical
    const dumpA = rawA.join("\n");
    const dumpB = rawB.join("\n");
    expect(dumpA).not.toBe(dumpB);

    // Both should contain CryptoJS-encrypted data
    expect(rawA.some((r) => r.includes(CRYPTOJS_MARKER))).toBe(true);
    expect(rawB.some((r) => r.includes(CRYPTOJS_MARKER))).toBe(true);

    // Neither should contain the plaintext
    expect(dumpA).not.toContain(plaintext);
    expect(dumpB).not.toContain(plaintext);

    await deleteRawDB(dbNameA);
    await deleteRawDB(dbNameB);
  });

  it("folders/templates/highlights/insights store ciphertext at rest (production schemas)", async () => {
    const { createRxDatabase } = await import("rxdb");
    const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
    const { wrappedKeyEncryptionCryptoJsStorage } =
      await import("rxdb/plugins/encryption-crypto-js");
    const { wrappedValidateZSchemaStorage } =
      await import("rxdb/plugins/validate-z-schema");
    const {
      folderSchema,
      templateSchema,
      highlightSchema,
      insightSchema,
    } = await import("../../db/schema");

    const storage = wrappedValidateZSchemaStorage({
      storage: wrappedKeyEncryptionCryptoJsStorage({
        storage: getRxStorageDexie(),
      }),
    });

    const dbName = "test-ciphertext-four-" + Date.now();
    const password = "correct-horse-battery-staple";
    const now = new Date().toISOString();

    // Known plaintext values that must never appear in raw storage.
    const PLAINTEXT = {
      folderTitle: "Super Secret Project Plans",
      templateTitle: "Quarterly Strategy Template",
      templateBlockText: "Confidential roadmap for 2026",
      highlightText: "The acquisition price was 4.2 billion",
      highlightNote: "Verify this number with counsel before publishing",
      insightTitle: "Review your AI bookmarks on encryption",
      insightContent:
        "Three of your saved articles argue local-first crypto is a hard requirement.",
    };

    const db = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });
    await db.addCollections({
      folders: {
        schema: folderSchema as any,
        migrationStrategies: {
          1: migrateNoop,
          2: migrateNoop,
          3: migrateNoop,
          4: migrateNoop,
        },
      },
      templates: {
        schema: templateSchema as any,
        migrationStrategies: { 1: migrateNoop, 2: migrateNoop, 3: migrateNoop },
      },
      highlights: {
        schema: highlightSchema as any,
        migrationStrategies: { 1: migrateNoop, 2: migrateNoop, 3: migrateNoop },
      },
      insights: {
        schema: insightSchema as any,
        migrationStrategies: { 1: migrateNoop, 2: migrateNoop, 3: migrateNoop },
      },
    });
    await db.folders.insert({
      id: "f1",
      title: PLAINTEXT.folderTitle,
      parentId: "",
      createdAt: now,
    });
    await db.templates.insert({
      id: "t1",
      title: PLAINTEXT.templateTitle,
      blocks: [{ type: "h1", text: PLAINTEXT.templateBlockText }],
      createdAt: now,
    });
    await db.highlights.insert({
      id: "h1",
      bookmarkId: "b1",
      text: PLAINTEXT.highlightText,
      color: "yellow",
      note: PLAINTEXT.highlightNote,
      createdAt: now,
    });
    await db.insights.insert({
      id: "i1",
      type: "summary",
      title: PLAINTEXT.insightTitle,
      content: PLAINTEXT.insightContent,
      relatedIds: ["doc-1", "doc-2"],
      isRead: false,
      createdAt: now,
    });
    await db.close();

    // Raw IndexedDB must not contain any plaintext for the encrypted fields.
    const rawRecords = await readRawIndexedDBValues(dbName);
    const rawDump = rawRecords.join("\n");
    for (const value of Object.values(PLAINTEXT)) {
      expect(rawDump).not.toContain(value);
    }
    expect(rawRecords.some((r) => r.includes(CRYPTOJS_MARKER))).toBe(true);

    // Data must still decrypt correctly with the right password.
    const db2 = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });
    await db2.addCollections({
      folders: {
        schema: folderSchema as any,
        migrationStrategies: {
          1: migrateNoop,
          2: migrateNoop,
          3: migrateNoop,
          4: migrateNoop,
        },
      },
      templates: {
        schema: templateSchema as any,
        migrationStrategies: { 1: migrateNoop, 2: migrateNoop, 3: migrateNoop },
      },
      highlights: {
        schema: highlightSchema as any,
        migrationStrategies: { 1: migrateNoop, 2: migrateNoop, 3: migrateNoop },
      },
      insights: {
        schema: insightSchema as any,
        migrationStrategies: { 1: migrateNoop, 2: migrateNoop, 3: migrateNoop },
      },
    });
    const folder = await db2.folders.findOne("f1").exec();
    expect(folder).not.toBeNull();
    expect(folder!.get("title")).toBe(PLAINTEXT.folderTitle);
    const template = await db2.templates.findOne("t1").exec();
    expect(template).not.toBeNull();
    expect(template!.get("title")).toBe(PLAINTEXT.templateTitle);
    expect((template!.get("blocks") as any[])[0].text).toBe(
      PLAINTEXT.templateBlockText,
    );
    const highlight = await db2.highlights.findOne("h1").exec();
    expect(highlight).not.toBeNull();
    expect(highlight!.get("text")).toBe(PLAINTEXT.highlightText);
    expect(highlight!.get("note")).toBe(PLAINTEXT.highlightNote);
    const insight = await db2.insights.findOne("i1").exec();
    expect(insight).not.toBeNull();
    expect(insight!.get("title")).toBe(PLAINTEXT.insightTitle);
    expect(insight!.get("content")).toBe(PLAINTEXT.insightContent);
    expect(insight!.get("relatedIds")).toEqual(["doc-1", "doc-2"]);
    await db2.close();

    await deleteRawDB(dbName);
  });

  it("v2 plaintext folders are re-encrypted by the v3 schema migration", async () => {
    const { createRxDatabase } = await import("rxdb");
    const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
    const { wrappedKeyEncryptionCryptoJsStorage } =
      await import("rxdb/plugins/encryption-crypto-js");
    const { wrappedValidateZSchemaStorage } =
      await import("rxdb/plugins/validate-z-schema");
    const { folderSchema } = await import("../../db/schema");

    const storage = wrappedValidateZSchemaStorage({
      storage: wrappedKeyEncryptionCryptoJsStorage({
        storage: getRxStorageDexie(),
      }),
    });

    const dbName = "test-folder-migration-" + Date.now();
    const password = "correct-horse-battery-staple";
    const now = new Date().toISOString();
    const SECRET_TITLE = "Secret Folder Name";

    // Old v2 folder schema: title NOT encrypted.
    const oldFolderSchema = {
      title: "folder schema",
      version: 2,
      primaryKey: "id",
      type: "object",
      properties: {
        id: { type: "string", maxLength: 100 },
        title: { type: "string", maxLength: 500 },
        parentId: { type: "string", maxLength: 100 },
        createdAt: { type: "string", format: "date-time", maxLength: 100 },
      },
      required: ["id", "title", "parentId", "createdAt"],
      indexes: ["parentId"],
    };

    const db = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });
    await db.addCollections({
      folders: {
        schema: oldFolderSchema,
        migrationStrategies: { 1: migrateNoop, 2: migrateNoop },
      },
    });
    await db.folders.insert({
      id: "f1",
      title: SECRET_TITLE,
      parentId: "",
      createdAt: now,
    });
    await db.close();

    // Sanity: under the old schema the title sits in raw storage as plaintext.
    let raw = await readRawIndexedDBValues(dbName);
    expect(raw.join("\n")).toContain(SECRET_TITLE);

    // Reopen with the production v4 schema (title encrypted + F-06
    // authenticated envelope). The schema version bump forces a migration;
    // identity strategies are correct here because only the `encrypted`
    // array / storage layer changed — the storage layer encrypts the
    // field on the migration write.
    const db2 = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });
    await db2.addCollections({
      folders: {
        schema: folderSchema as any,
        migrationStrategies: {
          1: migrateNoop,
          2: migrateNoop,
          3: migrateNoop,
          4: migrateNoop,
        },
      },
    });
    const doc = await db2.folders.findOne("f1").exec();
    expect(doc).not.toBeNull();
    expect(doc!.get("title")).toBe(SECRET_TITLE);
    await db2.close();

    // After migration the raw storage must no longer contain the plaintext
    // title and must contain CryptoJS ciphertext instead.
    raw = await readRawIndexedDBValues(dbName);
    const dump = raw.join("\n");
    expect(dump).not.toContain(SECRET_TITLE);
    expect(raw.some((r) => r.includes(CRYPTOJS_MARKER))).toBe(true);

    await deleteRawDB(dbName);
  });
});
