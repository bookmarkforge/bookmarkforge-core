import { describe, it, expect } from "vitest";
import { addRxPlugin } from "rxdb";

// crypto-js ships no types (see the module declaration in
// src/declarations.d.ts); used only to peek inside the inner CryptoJS
// layer of stored rows.
import CryptoJS from "crypto-js";
import {
  RxDBDevModePlugin,
  disableWarnings,
} from "rxdb/plugins/dev-mode";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { authenticatedEncryptionStorage } from "../../db/authEncryptionStorage";

// Keep RxDB validation active while silencing its one-time informational
// banner; the test asserts encryption behavior, not third-party diagnostics.
disableWarnings();
addRxPlugin(RxDBDevModePlugin);
addRxPlugin(RxDBMigrationSchemaPlugin);

const CRYPTOJS_MARKER = "U2FsdGVkX1"; // base64 of "Salted__" (CryptoJS AES)

/**
 * Decrypts raw CryptoJS ciphertext found in IndexedDB with the vault
 * password, returning the plaintext that sits INSIDE the inner layer.
 * With the F-06 authenticated envelope active, that plaintext is itself
 * a `v4:`/`v5:` crypto-core envelope.
 */
function decryptCryptoJsValue(ciphertext: string, password: string): string {
  // crypto-js is a dependency of rxdb's encryption plugin; use its AES
  // primitives directly to peek inside the inner layer.
  return CryptoJS.AES.decrypt(ciphertext, password).toString(
    CryptoJS.enc.Utf8,
  );
}

/** Extracts the raw `secret` field values from stored records. */
function rawSecrets(rawRecords: string[]): string[] {
  const secrets: string[] = [];
  for (const rec of rawRecords) {
    try {
      const parsed = JSON.parse(rec) as { secret?: string };
      if (typeof parsed.secret === "string") {
        secrets.push(parsed.secret);
      }
    } catch {
      // non-JSON record (attachment blob etc.) — skip
    }
  }
  return secrets;
}

/** Identity migration — dev-mode requires one strategy per version step. */
const migrateNoop = (doc: Record<string, unknown>) => ({ ...doc });

async function readRawIndexedDBValues(dbNamePrefix: string): Promise<string[]> {
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

/** Minimal schema with one encrypted field, at the given version. */
function docSchema(version: number) {
  return {
    title: "doc schema",
    version,
    primaryKey: "id",
    type: "object",
    properties: {
      id: { type: "string", maxLength: 100 },
      secret: { type: "string", maxLength: 500 },
    },
    required: ["id"],
    encrypted: ["secret"],
  };
}

/** Legacy stack: the previous production chain (CryptoJS only). */
async function legacyStack() {
  const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
  const { wrappedKeyEncryptionCryptoJsStorage } = await import(
    "rxdb/plugins/encryption-crypto-js"
  );
  const { wrappedValidateZSchemaStorage } = await import(
    "rxdb/plugins/validate-z-schema"
  );
  return wrappedValidateZSchemaStorage({
    storage: wrappedKeyEncryptionCryptoJsStorage({
      storage: getRxStorageDexie(),
    }),
  });
}

/** Full stack: the new production chain (authenticated envelope outside). */
async function fullStack() {
  const { getRxStorageDexie } = await import("rxdb/plugins/storage-dexie");
  const { wrappedKeyEncryptionCryptoJsStorage } = await import(
    "rxdb/plugins/encryption-crypto-js"
  );
  const { wrappedValidateZSchemaStorage } = await import(
    "rxdb/plugins/validate-z-schema"
  );
  return wrappedValidateZSchemaStorage({
    storage: authenticatedEncryptionStorage({
      storage: wrappedKeyEncryptionCryptoJsStorage({
        storage: getRxStorageDexie(),
      }),
    }),
  });
}

describe("authenticated RxDB encryption (F-06)", () => {
  it("writes an authenticated envelope around the inner ciphertext at rest", async () => {
    const { createRxDatabase } = await import("rxdb");
    const storage = await fullStack();
    const dbName = "test-auth-raw-" + Date.now();
    const password = "correct-horse-battery-staple";
    const SECRET = "confidential-plan-A";

    const db = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });
    await (db as any).addCollections({
      docs: { schema: docSchema(0), migrationStrategies: {} },
    });
    await (db as any).docs.insert({ id: "d1", secret: SECRET });
    await db.close();

    const rawRecords = await readRawIndexedDBValues(dbName);
    const rawDump = rawRecords.join("\n");

    // 1. The plaintext must never appear in raw storage.
    expect(rawDump).not.toContain(SECRET);
    // 2. The inner CryptoJS ciphertext must be present (inner layer intact).
    expect(rawDump).toContain(CRYPTOJS_MARKER);
    // 3. The authenticated outer envelope (crypto-core v4/v5 marker) must
    //    be inside the inner ciphertext: decode the inner layer and the
    //    recovered plaintext must itself be a v4/v5 envelope, not the raw
    //    secret.
    const stored = rawSecrets(rawRecords).filter((s) =>
      s.startsWith(CRYPTOJS_MARKER),
    );
    expect(stored.length).toBeGreaterThan(0);
    for (const s of stored) {
      const inner = decryptCryptoJsValue(s, password);
      expect(inner).toMatch(/^"?v[45]:/);
      expect(inner).not.toContain(SECRET);
    }

    // Round-trip with the same password still returns the plaintext.
    const db2 = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });
    await (db2 as any).addCollections({
      docs: { schema: docSchema(0), migrationStrategies: {} },
    });
    const doc = await (db2 as any).docs.findOne("d1").exec();
    expect(doc).not.toBeNull();
    expect((doc as any).secret).toBe(SECRET);
    await db2.close();

    await deleteRawDB(dbName);
  });

  it("migrates legacy CryptoJS-only rows to the authenticated format on schema bump", async () => {
    const { createRxDatabase } = await import("rxdb");
    const legacy = await legacyStack();
    const dbName = "test-auth-migration-" + Date.now();
    const password = "correct-horse-battery-staple";
    const SECRET = "legacy-top-secret";

    // Step 1: write with the LEGACY stack at schema version 1.
    const dbOld = await createRxDatabase({
      name: dbName,
      storage: legacy,
      password,
      ignoreDuplicate: true,
    });
    await (dbOld as any).addCollections({
      docs: { schema: docSchema(1), migrationStrategies: { 1: migrateNoop } },
    });
    await (dbOld as any).docs.insert({ id: "d1", secret: SECRET });
    await dbOld.close();

    // Sanity: raw storage has inner ciphertext but NO outer envelope.
    let rawDump = (await readRawIndexedDBValues(dbName)).join("\n");
    expect(rawDump).not.toContain(SECRET);
    expect(rawDump).toContain(CRYPTOJS_MARKER);
    expect(rawDump).not.toMatch(/v[45]:/);

    // Step 2: reopen with the FULL stack at schema version 2 — the version
    // bump forces a migration that rewrites every row through the
    // authenticated storage layer.
    const full = await fullStack();
    const dbNew = await createRxDatabase({
      name: dbName,
      storage: full,
      password,
      ignoreDuplicate: true,
    });
    await (dbNew as any).addCollections({
      docs: {
        schema: docSchema(2),
        migrationStrategies: { 1: migrateNoop, 2: migrateNoop },
      },
    });
    const doc = await (dbNew as any).docs.findOne("d1").exec();
    expect(doc).not.toBeNull();
    expect((doc as any).secret).toBe(SECRET);
    await dbNew.close();

    // Step 3: after the migration the row carries the outer envelope INSIDE
    // the inner ciphertext (the inner layer encrypts whatever value it
    // receives — now the v5 envelope instead of the raw secret).
    const migratedRecords = await readRawIndexedDBValues(dbName);
    const migratedDump = migratedRecords.join("\n");
    expect(migratedDump).toContain(CRYPTOJS_MARKER);
    expect(migratedDump).not.toContain(SECRET);
    const migrated = rawSecrets(migratedRecords).filter((s) =>
      s.startsWith(CRYPTOJS_MARKER),
    );
    expect(migrated.length).toBeGreaterThan(0);
    const migratedInner = decryptCryptoJsValue(migrated[0]!, password);
    expect(migratedInner).toMatch(/^"?v[45]:/);
    // And the envelope decrypts back to the original secret with the right
    // password (already proven by the round-trip read above).

    await deleteRawDB(dbName);
  });

  it("preserves the exact TYPE of encrypted string fields", async () => {
    const { createRxDatabase } = await import("rxdb");
    const storage = await fullStack();
    const dbName = "test-auth-typefidelity-" + Date.now();
    const password = "correct-horse-battery-staple";

    // A field whose CONTENT is valid JSON must NOT be type-coerced on
    // read: "123" is a string that happens to parse as a number, and a
    // pasted object literal is a string that happens to parse as JSON.
    // Without the JSON_BLOB_PREFIX tag, decryptDoc's JSON.parse would
    // silently turn these into number/object — corrupting document
    // content on every read/write cycle.
    const JOHN_DOE = "123";
    const JSON_LOOKING = '{"a":1}';

    const db = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });
    await (db as any).addCollections({
      docs: { schema: docSchema(0), migrationStrategies: {} },
    });
    await (db as any).docs.insert({
      id: "d1",
      secret: JOHN_DOE,
    });
    await (db as any).docs.insert({
      id: "d2",
      secret: JSON_LOOKING,
    });
    await db.close();

    const db2 = await createRxDatabase({
      name: dbName,
      storage,
      password,
      ignoreDuplicate: true,
    });
    await (db2 as any).addCollections({
      docs: { schema: docSchema(0), migrationStrategies: {} },
    });
    const doc1 = await (db2 as any).docs.findOne("d1").exec();
    const doc2 = await (db2 as any).docs.findOne("d2").exec();
    expect((doc1 as any).secret).toBe(JOHN_DOE);
    expect(typeof (doc1 as any).secret).toBe("string");
    expect((doc2 as any).secret).toBe(JSON_LOOKING);
    expect(typeof (doc2 as any).secret).toBe("string");
    await db2.close();

    await deleteRawDB(dbName);
  });

  it("wrong password fails loudly (tagged auth error) instead of silent garbage", async () => {
    const { createRxDatabase } = await import("rxdb");
    const storage = await fullStack();
    const dbName = "test-auth-wrongpw-" + Date.now();
    const SECRET = "only-for-the-right-password";

    const db = await createRxDatabase({
      name: dbName,
      storage,
      password: "the-right-password",
      ignoreDuplicate: true,
    });
    await (db as any).addCollections({
      docs: { schema: docSchema(0), migrationStrategies: {} },
    });
    await (db as any).docs.insert({ id: "d1", secret: SECRET });
    await db.close();

    // Reopen with the wrong password: the read must either throw a
    // DB1-tagged authentication error or (if the wrong password slips
    // past the inner layer's internal-store check) must NOT return the
    // plaintext.
    let threw = false;
    try {
      const dbWrong = await createRxDatabase({
        name: dbName,
        storage,
        password: "definitely-wrong",
        ignoreDuplicate: true,
      });
      await (dbWrong as any).addCollections({
        docs: { schema: docSchema(0), migrationStrategies: {} },
      });
      const doc = await (dbWrong as any).docs.findOne("d1").exec();
      if (doc) {
        const value = (doc as any).secret;
        expect(value).not.toBe(SECRET);
      }
      await dbWrong.close();
    } catch (err) {
      threw = true;
      // RxDB's internal-store password-hash check (DB1) is the expected
      // loud failure; if the wrong password slips past it, the read path
      // must throw our tagged WrongPasswordError instead of silently
      // returning garbage.
      const code = (err as Error & { code?: string }).code;
      const name = (err as Error).name;
      expect(code === "DB1" || name === "WrongPasswordError").toBe(true);
    }
    expect(threw).toBe(true);

    await deleteRawDB(dbName);
  });
});
