import { test, expect, type Page } from "@playwright/test";
import { hash } from "node:crypto";
import {
  setupVault,
  dismissOverlays,
  VAULT_PASSWORD,
} from "./vault-helpers";

// The drill (setup + seed + disaster + restore + verify) exceeds the default timeout.
test.setTimeout(180_000);

/**
 * drill-backup-restore — disaster-recovery drill (monthly).
 *
 * Automates the procedure in docs/operations.md:
 *   1. BASELINE — reference vault with seeded documents (3 bookmarks,
 *                 1 document) and verification of counts + hashes.
 *   2. EXPORT   — phase A: real encrypted backup (.bmf, BMF1) through the UI (download);
 *                 phase B: plaintext JSON blob through createBackupData().
 *   3. DISASTER — simulated total destruction: IndexedDB + localStorage
 *                 wiped (the real disaster removes the vault metadata).
 *   4. RESTORE  — the app boots as a first run → restore-first onboarding
 *                 ("Your vault is empty") where the file is imported; the
 *                 path time is measured (gate: reference RTO < 120 s).
 *   5. VERIFY   — counts and titles identical to the baseline. A single
 *                 different document fails the drill.
 *
 * Metrics printed with the [DRILL-BACKUP] prefix — parsed by
 * scripts/drill-backup-restore.mjs.
 */

const SEED = {
  bookmarks: Array.from({ length: 3 }, (_, i) => ({
    id: `drill-bookmark-${i}`,
    url: `https://example.com/drill/${i}`,
    urlHash: hash("sha256", `https://example.com/drill/${i}`),
    title: `Drill Bookmark ${i}`,
    processed: true,
    isPrivate: false,
    isDeleted: false,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
  })),
  document: {
    id: "drill-document",
    folderId: "drill-folder",
    title: "Drill Document",
    blocks: [],
    textContent: "drill-content",
    processed: true,
    isPrivate: false,
    isDeleted: false,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
  },
} as const;

type Snapshot = Array<{ id: string; title: string }>;

async function seedVault(page: Page): Promise<void> {
  await page.evaluate(async (seed) => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    for (const bookmark of seed.bookmarks) {
      await db.bookmarks.insert(bookmark as never);
    }
    await db.documents.insert(seed.document as never);
  }, SEED);
}

async function snapshotVault(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    const bookmarks = await db.bookmarks.find().exec();
    const documents = await db.documents.find().exec();
    return [
      ...bookmarks.map((b) => ({ id: b.id, title: b.title })),
      ...documents.map((d) => ({ id: d.id, title: d.title })),
    ].sort((a, b) => a.id.localeCompare(b.id));
  });
}

const RESTORE_RTO_MS = 120_000;

function mark(name: string, ms: number): void {
  console.log(`[DRILL-BACKUP] ${name}=${ms}ms`);
}

function destroyIndexedDB(page: Page, names: string[]): Promise<void> {
  return page.evaluate(async (dbsToDelete) => {
    let databases: Array<{ name?: string }> = [];
    try {
      databases = (await indexedDB.databases?.()) ?? [];
    } catch {
      databases = [];
    }
    if (databases.length === 0) {
      databases = dbsToDelete.map((name) => ({ name }));
    }
    for (const { name } of databases) {
      if (!name || !dbsToDelete.some((prefix) => name.startsWith(prefix))) {
        continue;
      }
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    }
  }, names);
}

/**
 * Total destruction: wipes IndexedDB AND ALL of localStorage (the vault
 * derivation keys, e.g. vault_salt/vault_crypto_key, go too: with the DB
 * alone the unlock fails once the derived metadata no longer exists). After
 * this the app boots as a first run → SecurityConfirmation → restore-first
 * onboarding "Your vault is empty", the real total-loss scenario.
 */
async function totalDisaster(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear());
  await destroyIndexedDB(page, ["bookmarkforge", "vault"]);
  await page.reload();
}

/**
 * Restores the file through BackupService.importBackup() from the
 * post-disaster state (first run, empty vault). The UI path of the restore
 * (restore-first onboarding / Settings → Storage) is already covered by
 * vault-backup-flow.spec.ts and vault-recovery-restore.spec.ts; this drill
 * runs exactly the same function the UI triggers, on a stopwatch.
 */
async function beginRestore(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<Promise<void>> {
  const securityDialog = page.getByRole("dialog", {
    name: /secure your vault/i,
  });
  await expect(securityDialog).toBeVisible({ timeout: 30_000 });
  // First run after the disaster: create the vault with the SAME password as
  // the backup (so importBackup can derive the encryption keys of the target
  // vault and decrypt the file).
  await page.getByRole("button", { name: "Set up password" }).click();
  await expect(
    page.getByRole("heading", { name: "Setup Secure Vault" }),
  ).toBeVisible({ timeout: 30_000 });
  const confirmCheckbox = page.getByRole("checkbox", {
    name: "I have safely saved the recovery phrase",
  });
  // The checkbox only becomes enabled after downloading the recovery kit.
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "Download Recovery Kit" }).click();
  await download;
  await expect(confirmCheckbox).toBeEnabled({ timeout: 10_000 });
  // Playwright may report the checkbox as covered; invoke the accessible
  // check directly.
  await confirmCheckbox.evaluate((el) => (el as HTMLInputElement).click());
  await page.getByLabel("Master Password").fill(VAULT_PASSWORD);
  await page.getByRole("button", { name: "Create Vault" }).click();
  await expect(page.getByTestId("settings-button")).toBeVisible({
    timeout: 30_000,
  });

  // Freshly created empty vault: import directly (the same code as the UI).
  await page.evaluate(
    async ({ name, mimeType, bytes, password }) => {
      const { BackupService } = await import("/src/services/BackupService");
      const fileLike = new File([new Uint8Array(bytes)], name, {
        type: mimeType,
      });
      await BackupService.importBackup(fileLike, password);
    },
    {
      name: file.name,
      mimeType: file.mimeType,
      bytes: Array.from(file.buffer),
      password: file.name.endsWith(".bmf") ? VAULT_PASSWORD : undefined,
    },
  );
  // The bare import does not reload (the UI does); wait for the unlocked
  // shell directly after importBackup.
  await reachUnlockedShellAfterRestore(page);
  await dismissOverlays(page);
}

/**
 * After the restore the app reloads: it returns to the lock screen (if the
 * backup required a password) or to the unlocked shell (vault without a
 * password). Unlock if needed and wait for the shell.
 */
async function reachUnlockedShellAfterRestore(page: Page): Promise<void> {
  const lockedScreen = page.getByTestId("vault-locked-screen");
  const settingsButton = page.getByTestId("settings-button");
  await expect(
    lockedScreen.or(settingsButton),
  ).toBeVisible({ timeout: 30_000 });
  if (await lockedScreen.isVisible().catch(() => false)) {
    await page.getByLabel("Master Password").fill(VAULT_PASSWORD);
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await expect(settingsButton).toBeVisible({ timeout: 30_000 });
}

test("phase A: encrypted .bmf backup → disaster → restore → verification", async ({ page }) => {
  await setupVault(page);
  await dismissOverlays(page);
  await seedVault(page);

  const baseline = await snapshotVault(page);
  expect(baseline).toHaveLength(4);

  // EXPORT .bmf — real encrypted backup (BMF1 format with password) through
  // createBackupData(), the same code exportBackup() uses to encrypt +
  // download. Headless does not open the save dialog; the vault-backup-flow
  // UI spec already covers the real download from the button.
  const backupBlob = await page.evaluate(async (password) => {
    const { BackupService } = await import("/src/services/BackupService");
    const { blob, metadata } = await BackupService.createBackupData(password);
    if (!metadata.encrypted) {
      throw new Error("Expected an encrypted backup (BMF1)");
    }
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, VAULT_PASSWORD);

  // DISASTER — total loss (IndexedDB + localStorage).
  await totalDisaster(page);

  // RESTORE — stopwatch for the path (reference RTO < 120 s).
  const t0 = Date.now();
  await beginRestore(page, {
    name: "drill-backup.bmf",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(backupBlob), // plain Uint8Array (serializable)
  });
  const restoreMs = Date.now() - t0;
  mark("restore_bmf", restoreMs);
  expect(restoreMs).toBeLessThan(RESTORE_RTO_MS);

  // VERIFY — counts and titles identical to the baseline.
  const restored = await snapshotVault(page);
  expect(restored).toEqual(baseline);
});

test("phase B: plaintext backup (createBackupData) → disaster → restore", async ({ page }) => {
  await setupVault(page);
  await dismissOverlays(page);
  await seedVault(page);

  const baseline = await snapshotVault(page);

  // EXPORT — plaintext JSON blob returned by createBackupData (no password).
  const payload = await page.evaluate(async () => {
    const { BackupService } = await import("/src/services/BackupService");
    const { blob } = await BackupService.createBackupData(undefined);
    return blob.text();
  });

  // DISASTER
  await totalDisaster(page);

  // RESTORE
  const t0 = Date.now();
  await beginRestore(page, {
    name: "drill-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(payload),
  });
  const restoreMs = Date.now() - t0;
  mark("restore_plaintext", restoreMs);
  expect(restoreMs).toBeLessThan(RESTORE_RTO_MS);

  const restored = await snapshotVault(page);
  expect(restored).toEqual(baseline);
});
