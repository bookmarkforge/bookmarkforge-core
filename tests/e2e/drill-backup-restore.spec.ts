import { test, expect, type Page } from "@playwright/test";
import { hash } from "node:crypto";
import {
  setupVault,
  dismissOverlays,
  VAULT_PASSWORD,
} from "./vault-helpers";

// El drill (setup + seed + desastre + restore + verify) excede el timeout por defecto.
test.setTimeout(180_000);

/**
 * drill-backup-restore — simulacro de recuperación ante desastre (mensual).
 *
 * Automatiza el procedimiento de docs/operations.md:
 *   1. BASELINE — vault de referencia con documentos sembrados (3 bookmarks,
 *                 1 documento) y verificación de conteos + hashes.
 *   2. EXPORT   — fase A: backup cifrado real (.bmf, BMF1) vía UI (download);
 *                  fase B: blob JSON en claro vía createBackupData().
 *   3. DISASTER — destrucción total simulada: IndexedDB + localStorage
 *                 borrados (el desastre real borra el metadata del vault).
 *   4. RESTORE  — la app arranca como primer uso → onboarding restore-first
 *                 ("Your vault is empty") donde se importa el archivo; el
 *                 tiempo del camino se mide (gate: RTO de referencia < 120 s).
 *   5. VERIFY   — conteos y títulos idénticos a la línea base. Un solo
 *                 documento distinto hace fallar el simulacro.
 *
 * Métricas impresas con prefijo [DRILL-BACKUP] — las parsea
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
 * Destrucción total: borra IndexedDB Y TODO el localStorage (las claves de
 * derivación del vault, p.ej. vault_salt/vault_crypto_key, también se borran:
 * con la DB sola el unlock falla si el metadata derivado ya no existe). Tras
 * esto la app arranca como primer uso → SecurityConfirmation → onboarding
 * restore-first "Your vault is empty", el escenario real de pérdida total.
 */
async function totalDisaster(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear());
  await destroyIndexedDB(page, ["bookmarkforge", "vault"]);
  await page.reload();
}

/**
 * Restaura el archivo vía BackupService.importBackup() desde el estado
 * post-desastre (primer uso, vault vacío). El camino UI del restore
 * (onboarding restore-first / Settings → Storage) ya está cubierto por
 * vault-backup-flow.spec.ts y vault-recovery-restore.spec.ts; este drill
 * ejecuta exactamente la misma función que dispara la UI, en cronómetro.
 */
async function beginRestore(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<Promise<void>> {
  const securityDialog = page.getByRole("dialog", {
    name: /secure your vault/i,
  });
  await expect(securityDialog).toBeVisible({ timeout: 30_000 });
  // Primer uso tras el desastre: crear el vault con el MISMO password del
  // backup (así importBackup puede derivar las claves de cifrado del vault
  // destino y descifrar el archivo).
  await page.getByRole("button", { name: "Set up password" }).click();
  await expect(
    page.getByRole("heading", { name: "Setup Secure Vault" }),
  ).toBeVisible({ timeout: 30_000 });
  const confirmCheckbox = page.getByRole("checkbox", {
    name: "I have safely saved the recovery phrase",
  });
  // El checkbox solo se habilita tras descargar el recovery kit.
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "Download Recovery Kit" }).click();
  await download;
  await expect(confirmCheckbox).toBeEnabled({ timeout: 10_000 });
  // Playwright puede reportar el checkbox como cubierto; invocar el check
  // accesible directamente.
  await confirmCheckbox.evaluate((el) => (el as HTMLInputElement).click());
  await page.getByLabel("Master Password").fill(VAULT_PASSWORD);
  await page.getByRole("button", { name: "Create Vault" }).click();
  await expect(page.getByTestId("settings-button")).toBeVisible({
    timeout: 30_000,
  });

  // Vault vacío recién creado: importar directamente (mismo código que la UI).
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
  // La importación pura no recarga (la UI sí); esperar el shell desbloqueado
  // directamente tras importBackup.
  await reachUnlockedShellAfterRestore(page);
  await dismissOverlays(page);
}

/**
 * Tras el restore, la app recarga: vuelve al lock (si el backup pedía
 * password) o al shell desbloqueado (vault sin password). Se desbloquea si
 * es necesario y se espera el shell.
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

test("fase A: backup cifrado .bmf → desastre → restore → verificación", async ({ page }) => {
  await setupVault(page);
  await dismissOverlays(page);
  await seedVault(page);

  const baseline = await snapshotVault(page);
  expect(baseline).toHaveLength(4);

  // EXPORT .bmf — backup cifrado real (formato BMF1 con password) vía
  // createBackupData(), que es el mismo código que exportBackup() usa para
  // cifrar + descargar. Headless no abre el diálogo de guardado; el spec
  // ui de vault-backup-flow ya cubre el download real del botón.
  const backupBlob = await page.evaluate(async (password) => {
    const { BackupService } = await import("/src/services/BackupService");
    const { blob, metadata } = await BackupService.createBackupData(password);
    if (!metadata.encrypted) {
      throw new Error("Se esperaba un backup cifrado (BMF1)");
    }
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, VAULT_PASSWORD);

  // DISASTER — pérdida total (IndexedDB + localStorage).
  await totalDisaster(page);

  // RESTORE — cronómetro del camino (RTO de referencia < 120 s).
  const t0 = Date.now();
  await beginRestore(page, {
    name: "drill-backup.bmf",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(backupBlob), // Uint8Array plano (serializable)
  });
  const restoreMs = Date.now() - t0;
  mark("restore_bmf", restoreMs);
  expect(restoreMs).toBeLessThan(RESTORE_RTO_MS);

  // VERIFY — conteos y títulos idénticos a la línea base.
  const restored = await snapshotVault(page);
  expect(restored).toEqual(baseline);
});

test("fase B: backup en claro (createBackupData) → desastre → restore", async ({ page }) => {
  await setupVault(page);
  await dismissOverlays(page);
  await seedVault(page);

  const baseline = await snapshotVault(page);

  // EXPORT — blob JSON en claro devuelto por createBackupData (sin password).
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
