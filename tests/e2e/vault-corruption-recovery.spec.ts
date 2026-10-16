import { test, expect, type Page } from "@playwright/test";
import { skipPassword } from "./vault-helpers";
import { seedProEntitlement } from "./pro-entitlement-helpers";

/**
 * vault-corruption-recovery — F0-2 end to end (corrupted vault).
 *
 * A vault whose RxDB storage is damaged on disk must not leave the user in
 * an endless "Retry" loop. AppContent's corruption-recovery screen has to
 * appear with a "Restore from backup file" path, and importing a plain
 * `.json` backup must wipe the damaged state, open a fresh vault and make
 * the imported data visible in the panel.
 *
 * Corruption is simulated for real: we overwrite every record of every
 * `rxdb-dexie-bookmarkforge_v5--*` IndexedDB database (the per-collection
 * databases RxDB's Dexie storage creates) with a value that keeps the
 * primary key but strips the schema/document fields, so the next initDB
 * fails to parse the vault metadata and classifies as INACCESSIBLE.
 *
 * The spec runs against the `--mode test` server (VITE_FORCE_DEXIE_STORAGE)
 * so there is exactly one storage backend — Dexie — and a corruption never
 * silently falls back to Memory storage.
 */

/** Corrupt every record of every RxDB Dexie database for the vault. */
async function corruptVaultIndexedDB(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const corrupted: string[] = [];
    const all = (await indexedDB.databases()) ?? [];
    const targets = all.filter((db) =>
      (db.name ?? "").startsWith("rxdb-dexie-bookmarkforge_v5"),
    );

    for (const { name } of targets) {
      if (!name) continue;
      corrupted.push(name);
      await new Promise<void>((resolve) => {
        const req = indexedDB.open(name);
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
        req.onsuccess = () => {
          const idb = req.result;
          const storeNames = Array.from(idb.objectStoreNames);
          let pending = storeNames.length;
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
          for (const storeName of storeNames) {
            let tx: IDBTransaction;
            try {
              tx = idb.transaction(storeName, "readwrite");
            } catch {
              finish();
              continue;
            }
            const store = tx.objectStore(storeName);
            tx.oncomplete = finish;
            tx.onerror = finish;
            tx.onabort = finish;
            const cursorReq = store.openCursor();
            cursorReq.onerror = () => {
              /* the store is empty or unreadable — nothing to corrupt */
            };
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (!cursor) return;
              // Keep the primary key (in-line key paths must stay valid) but
              // strip every real field so the document no longer satisfies
              // the RxDB schema/metadata shape on the next open.
              const keyPath = store.keyPath;
              const value = cursor.value as
                | Record<string, unknown>
                | string
                | number
                | boolean
                | null;
              const broken: Record<string, unknown> = { __bmf_corrupted: true };
              if (typeof keyPath === "string") {
                const key =
                  value && typeof value === "object"
                    ? (value as Record<string, unknown>)[keyPath]
                    : cursor.primaryKey;
                broken[keyPath] = key;
              } else if (Array.isArray(keyPath)) {
                for (const part of keyPath) {
                  broken[part] =
                    value && typeof value === "object"
                      ? (value as Record<string, unknown>)[part]
                      : undefined;
                }
              }
              try {
                cursor.update(broken);
              } catch {
                // Index/key constraint on this record — leave it; corrupting
                // the metadata records is what fails the next init.
              }
              cursor.continue();
            };
          }
        };
      });
    }

    return corrupted;
  });
}

/** Skip the no-password gate and land on the DB-error recovery screen. */
async function skipToRecoveryScreen(page: Page): Promise<void> {
  const securityDialog = page.locator(
    '[aria-labelledby="security-confirmation-title"]',
  );
  await expect(securityDialog).toBeVisible({ timeout: 30_000 });
  await securityDialog.getByRole("button").last().click();
  await expect(
    page.getByRole("heading", { name: "Database initialization failed" }),
  ).toBeVisible({ timeout: 30_000 });
}

test("corrupted vault → recovery screen → restore from file → data visible", async ({
  page,
}) => {
  // Capture app-side errors so a restore failure reports the root cause
  // instead of a bare "toast never appeared" timeout.
  const appErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") appErrors.push(msg.text());
  });
  page.on("pageerror", (err) => appErrors.push(err.message));

  // 1. Create a real vault on disk (skip-password path keeps the
  //    corruption-recovery screen directly reachable without the lock gate).
  await skipPassword(page);

  // Restore goes through BackupService (Pro-gated): seed the entitlement on
  // the already-loaded page. The license survives the later reload because
  // the corruption step only damages IndexedDB, never localStorage.
  await seedProEntitlement(page);

  // 2. Damage the RxDB storage on purpose.
  const corruptedNames = await corruptVaultIndexedDB(page);
  expect(
    corruptedNames.length,
    `expected to corrupt some rxdb-dexie-* databases, saw: ${corruptedNames.join(", ") || "(none)"}`,
  ).toBeGreaterThan(0);

  // 3. Reload → the vault tries to reopen and must fail with a
  //    storage/corruption error instead of silently creating a new vault.
  await page.reload();
  await skipToRecoveryScreen(page);

  // 4. The recovery screen offers restore (never for auth-class errors).
  await expect(
    page.getByRole("button", { name: "Restore from backup file" }),
  ).toBeVisible();

  // 5. Restore a minimal valid plain-JSON backup (same shape the importer
  //    accepts via validateBackupEnvelope + the schema's required fields).
  await page.getByTestId("restore-backup-input").setInputFiles({
    name: "bookmarkforge-restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        bookmarks: [
          {
            id: "e2e-corruption-restore-bookmark-1",
            url: "https://example.com/recovered-from-corruption",
            // urlHash is a required schema field (SHA-256 hex of the URL);
            // without it bulkInsert/upsert both fail and the restore errors.
            urlHash: "779f91ac047a7e9e7b6f3d2a4b8c1e0f5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c",
            title: "Recovered Bookmark E2E",
            processed: true,
            isPrivate: false,
            isDeleted: false,
            createdAt: "2026-08-16T00:00:00.000Z",
            updatedAt: "2026-08-16T00:00:00.000Z",
          },
        ],
      }),
    ),
  });

  // Success path: handleRestoreFromFile toasts then immediately calls
  // window.location.reload(), so the toast is too transient to assert — wait
  // for the post-reload skip gate instead. Failure path: the recovery screen
  // stays and shows an error toast. Waiting for either makes failures
  // diagnosable without racing the reload.
  const reloadedGate = page.locator(
    '[aria-labelledby="security-confirmation-title"]',
  );
  const errorToast = page.getByText(
    "Could not restore the backup. Check the file and password.",
  );
  await expect
    .poll(
      async () => {
        const state = {
          gate: await reloadedGate.isVisible(),
          welcome: await page
            .getByRole("heading", { name: "Welcome to BookmarkForge" })
            .isVisible()
            .catch(() => false),
          error: await errorToast.isVisible(),
        };
        if (state.error) {
          throw new Error(
            `Restore failed. App errors:\n${appErrors.slice(-20).join("\n") || "(none captured)"}`,
          );
        }
        return state.gate || state.welcome;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  expect(
    await errorToast.isVisible(),
    `restore failed. app errors:\n${appErrors.join("\n")}`,
  ).toBe(false);

  await skipPassword(page);

  const continueFresh = page.getByRole("button", {
    name: "Continue without restoring",
  });
  if (await continueFresh.isVisible().catch(() => false)) {
    await continueFresh.click();
  }
  const getStarted = page.getByRole("button", { name: "Get Started" });
  if (await getStarted.isVisible().catch(() => false)) {
    await getStarted.click();
  }

  // The restored bookmark is visible in the panel (not just in the DB).
  await page
    .getByRole("button", { name: "Bookmarks", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Recovered Bookmark E2E", { exact: false }),
  ).toBeVisible({ timeout: 30_000 });
});
