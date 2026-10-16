import { test, expect, type Page } from "@playwright/test";
// crypto-js is a dependency of rxdb's encryption plugin; used here (Node
// context) to peek inside the inner encryption layer of raw IndexedDB rows
// and prove the authenticated envelope is present after migration.
import CryptoJS from "crypto-js";
import {
  setupVault,
  skipPassword,
  unlockAfterReload,
  VAULT_PASSWORD,
} from "./vault-helpers";
import { assertDurableBackend } from "./storage-backend-guard";

/**
 * vault-auth-encryption-migration — F-06 authenticated at-rest envelope,
 * end to end.
 *
 * Three guarantees, tested against the real app on the durable Dexie
 * backend:
 *
 * 1. MIGRATION — a vault written by a pre-F-06 build (inner CryptoJS field
 *    encryption only, bookmarkSchema v6) is still readable after upgrade and
 *    its rows are rewritten to the authenticated format (v7: outer AES-GCM
 *    envelope inside the inner ciphertext).
 * 2. REOPEN — after the migration the vault reopens with the same master
 *    password and the migrated data is intact.
 * 3. BACKUP/RESTORE — an encrypted (.bmf) backup exported from the migrated
 *    vault restores into a wiped/fresh install and the data comes back.
 *
 * The legacy vault is seeded for real: in the same page we open the app's
 * own IndexedDB with RxDB's pre-F-06 storage chain (crypto-js wrapper only,
 * no auth envelope) at bookmarkSchema v6, using the SAME resolved database
 * password the app derived, then reload so the app performs the v6→v7
 * migration on unlock.
 */

/** Minimal-but-valid v6 bookmark row shape (pre-F-06 schema). */
const LEGACY_BOOKMARK = {
  id: "e2e-legacy-migration-1",
  url: "https://example.com/legacy-migrated",
  title: "Legacy Migrated Bookmark E2E",
  urlHash: "b63056af5e5340dced51a3244406681d2291b2ba7bf0dd196a802d81b566e449",
  processed: false,
  isPrivate: false,
  isDeleted: false,
  createdAt: "2026-01-15T00:00:00.000Z",
  updatedAt: "2026-01-15T00:00:00.000Z",
};

/** Bookmark inserted through the current app BEFORE the wipe. */
const SEED_BOOKMARK = {
  id: "e2e-auth-seed-1",
  url: "https://example.com/authenticated-seed",
  title: "Authenticated Seed Bookmark E2E",
  urlHash: "098527e5429eccb2d5afe55f337249b8308b86d088be1c26b6df41829d0e48e5",
  processed: true,
  isPrivate: false,
  isDeleted: false,
  tags: [],
  relatedLinks: [],
  visitCount: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

/**
 * Reads every record of every rxdb-dexie-* IndexedDB database for the app's
 * vault and returns their JSON dumps. Used to prove the raw storage format
 * before/after the migration.
 */
async function dumpRawVaultStorage(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const rows: string[] = [];
    const all = (await indexedDB.databases()) ?? [];
    for (const { name } of all.filter((db) =>
      (db.name ?? "").startsWith("rxdb-dexie-bookmarkforge_v5"),
    )) {
      if (!name) continue;
      await new Promise<void>((resolve) => {
        const req = indexedDB.open(name);
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
        req.onsuccess = () => {
          const idb = req.result;
          const stores = Array.from(idb.objectStoreNames);
          let pending = stores.length;
          const finish = () => {
            pending -= 1;
            if (pending <= 0) {
              try {
                idb.close();
              } catch {
                /* ignore */
              }
              resolve();
            }
          };
          if (pending === 0) {
            try {
              idb.close();
            } catch {
              /* ignore */
            }
            resolve();
            return;
          }
          for (const storeName of stores) {
            let tx: IDBTransaction;
            try {
              tx = idb.transaction(storeName, "readonly");
            } catch {
              finish();
              continue;
            }
            const store = tx.objectStore(storeName);
            const getAll = store.getAll();
            getAll.onerror = () => finish();
            getAll.onsuccess = () => {
              for (const record of getAll.result as Array<Record<string, unknown>>) {
                try {
                  rows.push(JSON.stringify(record));
                } catch {
                  /* un-serializable record — skip */
                }
              }
              finish();
            };
          }
        };
      });
    }
    return rows;
  });
}

test("legacy v6 vault migrates to authenticated format and survives backup/restore", async ({
  page,
}) => {
  // ── Phase 1: create a current-format vault ───────────────────────────
  await setupVault(page);

  // Read the RESOLVED database password the app derived for this vault
  // (Argon2id-derived from the master password + per-vault salt). The legacy
  // seed below must use the exact same value, otherwise the CryptoJS layer
  // on the inner store rejects it (DB1).
  const resolvedPassword = await page.evaluate(async (masterPassword) => {
    // Read the canonical encrypted DB key and decrypt it with the vault
    // password. Do not use RxDatabase.password here: that property is an
    // implementation detail and may expose a normalized/hash value that is
    // not the password accepted by a new RxDB adapter instance.
    const { secureStorage } = await import("/src/services/SecureStorage.ts");
    const { SECURE_STORAGE_KEYS } = await import(
      "/src/services/SecurityVault.ts"
    );
    const { encryptionService } = await import(
      "/src/services/EncryptionService.ts"
    );
    const encrypted = await secureStorage.getSecret(SECURE_STORAGE_KEYS.DB_KEY);
    if (!encrypted) throw new Error("no encrypted db key found");
    return encryptionService.decrypt(encrypted, masterPassword);
  }, VAULT_PASSWORD);
  expect(typeof resolvedPassword).toBe("string");
  expect(resolvedPassword.length).toBeGreaterThan(20);

  // Close the app's DB so the legacy seed can open the same IndexedDB name.
  await page.evaluate(async () => {
    const { destroyDB } = await import("/src/db/database.ts");
    await destroyDB();
  });

  // ── Phase 2: seed a genuine pre-F-06 vault (CryptoJS-only, v6) ───────
  // Built with the REAL rxdb crypto-js plugin (the exact code that shipped
  // before F-06), so the on-disk rows are byte-for-byte the legacy format.
  // Wipe any lingering per-collection Dexie DBs (and their cached connections)
  // right before seeding: a leftover connection/password from the app's vault
  // otherwise triggers RxDB DB1 when the legacy stack opens with the seed
  // password. destroyDB alone does not close/retry blocked dexie connections.
  const seedResult = await page.evaluate(
    async ({ bookmark, password }) => {
      const { seedLegacyVault, wipeVaultDatabases } = await import(
        "/tests/e2e/legacy-vault-seeder.ts"
      );
      // destroyDB() closes the app singleton. The explicit sweep removes any
      // per-collection adapter left by a background init; the legacy seeder
      // opens with closeDuplicates so stale RxDB instances are closed before
      // the pre-F-06 stack is created.
      await wipeVaultDatabases();
      return seedLegacyVault({ password, bookmark });
    },
    { bookmark: LEGACY_BOOKMARK, password: resolvedPassword },
  );
  expect(
    seedResult.ok,
    `legacy seed failed: ${!seedResult.ok ? seedResult.error : ""}`,
  ).toBe(true);

  // Sanity: the seeded row is legacy-only — inner CryptoJS ciphertext with
  // NO outer envelope (no `v4:`/`v5:`/`v6:` marker anywhere).
  const preRaw = await dumpRawVaultStorage(page);
  const preDump = preRaw.join("\n");
  expect(preDump).toContain("U2FsdGVkX1"); // CryptoJS marker
  expect(preDump).not.toContain(LEGACY_BOOKMARK.title); // encrypted at rest
  expect(preDump).not.toMatch(/v[456]:/); // no authenticated envelope yet

  // ── Phase 3: reload → the app migrates v6 → v7 on unlock ────────────
  await page.reload();
  await unlockAfterReload(page, VAULT_PASSWORD);
  await assertDurableBackend(page);

  // The legacy bookmark is readable after the migration.
  // Insert a CURRENT-format bookmark through the app after the migration
  // (the v6 seed ran before the app re-opened; the pre-migration app DB was
  // destroyed to make room for the legacy vault). Both rows must be readable
  // side by side after the migration.
  await page.evaluate(async (bookmark) => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    await (db as any).bookmarks.insert(bookmark);
  }, SEED_BOOKMARK);

  const migrated = await page.evaluate(async () => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    const doc = await (db as any).bookmarks.findOne("e2e-legacy-migration-1").exec();
    const seed = await (db as any).bookmarks.findOne("e2e-auth-seed-1").exec();
    return {
      legacyTitle: doc?.get("title") ?? null,
      seedTitle: seed?.get("title") ?? null,
      legacyUrlHash: doc?.get("urlHash") ?? null,
    };
  });
  expect(migrated.legacyTitle).toBe(LEGACY_BOOKMARK.title);
  expect(migrated.seedTitle).toBe(SEED_BOOKMARK.title);
  // The legacy row's urlHash (a v6-required field) survives the v6→v7
  // migration untouched.
  expect(migrated.legacyUrlHash).toBe(LEGACY_BOOKMARK.urlHash);

  // Raw storage now carries the authenticated format. Extract the raw
  // `title`/`url` ciphertext of the migrated row from IndexedDB (bypassing
  // the app), decrypt the INNER CryptoJS layer here in Node, and assert the
  // recovered plaintext is itself a `v4:`/`v5:`/`v6:` envelope — the F-06
  // marker, now written under the per-vault KDF salt (A-1) — not the raw
  // bookmark value.
  const postRaw = await dumpRawVaultStorage(page);
  const postDump = postRaw.join("\n");
  expect(postDump).toContain("U2FsdGVkX1");
  expect(postDump).not.toContain(LEGACY_BOOKMARK.title);

  const migratedCiphertexts = await page.evaluate((dump) => {
    const secrets: string[] = [];
    for (const rec of dump) {
      try {
        const parsed = JSON.parse(rec) as Record<string, unknown>;
        if (parsed.id === "e2e-legacy-migration-1") {
          if (typeof parsed.title === "string") secrets.push(parsed.title);
          if (typeof parsed.url === "string") secrets.push(parsed.url);
        }
      } catch {
        /* skip */
      }
    }
    return secrets;
  }, postRaw);
  expect(migratedCiphertexts.length).toBeGreaterThan(0);
  // Every migrated encrypted field must decrypt (inner layer) into a v4/v5/v6
  // envelope — never into the raw legacy plaintext.
  for (const cipher of migratedCiphertexts) {
    expect(cipher.startsWith("U2FsdGVkX1")).toBe(true);
    const inner = CryptoJS.AES.decrypt(cipher, resolvedPassword).toString(
      CryptoJS.enc.Utf8,
    );
    expect(inner).toMatch(/^"?v[456]:/);
    expect(inner).not.toContain(LEGACY_BOOKMARK.title);
  }

  // ── Phase 4: export an ENCRYPTED backup from the migrated vault ──────
  const backupBase64 = await page.evaluate(async (password) => {
    const { BackupService } = await import("/src/services/BackupService");
    const { blob } = await BackupService.createBackupData(password);
    const buf = Buffer.from(await blob.arrayBuffer());
    return buf.toString("base64");
  }, VAULT_PASSWORD);
  const backupBuf = Buffer.from(backupBase64, "base64");
  // Encrypted .bmf files are fully opaque at rest (AES-GCM); the versioned
  // BMF1 header is INSIDE the encrypted payload. Decrypt the blob with the
  // export password to prove the format marker and the migrated content.
  const backupPlain = await page.evaluate(
    async ({ b64, password }) => {
      const { encryptionService } = await import(
        "/src/services/EncryptionService.ts"
      );
      const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dec = await encryptionService.decryptBinary(buf, password);
      return new TextDecoder().decode(dec);
    },
    { b64: backupBase64, password: VAULT_PASSWORD },
  );
  expect(backupPlain.startsWith("BMF1:")).toBe(true);
  expect(backupPlain).toContain("e2e-legacy-migration-1");

  // ── Phase 5: wipe the vault (nuclear forget) and restore from the
  //    encrypted backup ────────────────────────────────────────────────
  const forget = await page.evaluate(
    async (password) => {
      const { nuclearForgetService } = await import(
        "/src/services/NuclearForgetService.ts"
      );
      try {
        const report = await nuclearForgetService.nuclearForget({
          password,
          confirm: true,
          skipAudit: true,
        });
        return { ok: true, wiped: report.wiped };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    VAULT_PASSWORD,
  );
  expect(forget.ok, `nuclear forget failed: ${!forget.ok ? forget.error : ""}`).toBe(
    true,
  );

  // The UI loader is intentionally Pro-gated. This migration spec already
  // proves the encrypted backup bytes above; restore the same bytes through
  // the real BackupService API so the core migration test is not coupled to a
  // locally absent license. The UI entitlement path has its own coverage.
  const restoreResult = await page.evaluate(
    async ({ b64, password, expectedTitle }) => {
      try {
        const { BackupService } = await import("/src/services/BackupService");
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], "bookmarkforge-backup-2026-08-19.bmf", {
          type: "application/octet-stream",
        });
        await BackupService.importBackup(file, password);
        const { initDB } = await import("/src/db/database.ts");
        const db = await initDB(password);
        const restored = await (db as any).bookmarks
          .findOne("e2e-legacy-migration-1")
          .exec();
        return { ok: restored?.get("title") === expectedTitle };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    { b64: backupBase64, password: VAULT_PASSWORD, expectedTitle: LEGACY_BOOKMARK.title },
  );
  expect(restoreResult.ok, restoreResult.error ?? "backup restore did not recover the legacy row").toBe(true);
});
