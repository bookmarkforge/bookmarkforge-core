import { test, expect, type Page } from "@playwright/test";
import {
  setupVault,
  unlockVaultObserving,
  VAULT_PASSWORD,
} from "./vault-helpers";

/**
 * vault-migration-progress — permanent CI coverage for the migration
 * progress overlay (ADR-019 / src/db/migration-progress.ts).
 *
 * The v6→v7 schema migration runs INSIDE the unlock flow (initDB is
 * awaited before `isLocked` flips), so the full-screen "Migrating
 * vault… N%" overlay is only observable in the window between the Unlock
 * click and the shell mounting. This spec:
 *
 *   1. Seeds a REAL pre-F-06 legacy vault (CryptoJS-only, bookmarkSchema
 *      v6, N rows via tests/e2e/legacy-vault-seeder.ts) so the app
 *      performs the authenticated-envelope rewrite on the next unlock.
 *   2. Unlocks and asserts the migrating overlay appears AND shows a
 *      strictly-intermediate percent — i.e. live per-batch progress, not
 *      just the final state.
 *   3. Waits for the shell and verifies every seeded row survived the
 *      migration (count + a spot-check title).
 *
 * NO fragile timing: the overlay visibility uses Playwright's
 * auto-retrying `toBeVisible`, and the intermediate-percent proof polls
 * the overlay with a deadline, terminating the moment a value in
 * (0, 100) is observed — it never assumes a fixed sleep will land inside
 * the migration. The seed size (E2E_MIGRATION_SEED_ROWS, default 200,
 * 100 on WebKit — see DEFAULT_SEED_ROWS/WEBKIT_SEED_ROWS) makes the
 * migration last several seconds even on fast runners (~20ms per row),
 * so per-batch percent updates are always observable, while staying
 * inside the per-test timeout on slow engines (Windows WebKit rewrites
 * rows ~8× slower — the shell wait budget covers that).
 */

/**
 * Seed volume: env-overridable so CI can grow/shrink the migration cost.
 * 200 rows ≈ 4s of migration on Chromium and ~35s on Windows WebKit —
 * long enough for the percent polling to catch live progress everywhere,
 * short enough to stay inside the per-test timeout on slow engines.
 * WebKit gets a smaller seed: its Windows/emulated builds rewrite rows
 * ~8× slower, and 100 rows still migrate for ~15-35s there, which is far
 * more than the polling needs to observe live per-batch percents.
 */
const DEFAULT_SEED_ROWS = 200;
const WEBKIT_SEED_ROWS = 100;

/**
 * Builds `count` minimal-but-valid v6 bookmark rows (the pre-F-06 schema:
 * the same required field set the existing migration spec seeds). urlHash
 * is a unique 64-hex string; createdAt/updatedAt are valid date-times.
 */
function makeLegacyRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e2e-progress-${i}`,
    url: `https://example.com/progress/${i}`,
    title: `Vault Progress Bookmark ${i}`,
    urlHash: `${i.toString(16).padStart(64, "0")}`,
    processed: false,
    isPrivate: false,
    isDeleted: false,
    createdAt: `2026-01-15T00:00:00.${String(i % 1000).padStart(3, "0")}Z`,
    updatedAt: `2026-01-15T00:00:00.${String(i % 1000).padStart(3, "0")}Z`,
  }));
}

/**
 * Resolves the database password the app derived for the vault (Argon2id
 * from the master password + per-vault salt). The legacy seed below must
 * use the exact same value, otherwise the CryptoJS layer on the inner
 * store rejects it (DB1).
 */
async function resolveDbPassword(page: Page): Promise<string> {
  return page.evaluate(async (masterPassword) => {
    // Use the canonical encrypted DB key rather than RxDatabase.password,
    // which is an implementation detail and can be a normalized/hash value.
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
}

test("legacy vault migration shows a live percent progress overlay and keeps all rows", async ({
  page,
}, testInfo) => {
  const envRows = Number.parseInt(
    process.env.E2E_MIGRATION_SEED_ROWS ?? "",
    10,
  );
  const SEED_ROWS =
    Number.isFinite(envRows) && envRows > 0
      ? envRows
      : testInfo.project.name === "webkit"
        ? WEBKIT_SEED_ROWS
        : DEFAULT_SEED_ROWS;

  // ── Phase 1: create a current-format vault and resolve its DB key ───
  await setupVault(page);
  const resolvedPassword = await resolveDbPassword(page);
  expect(typeof resolvedPassword).toBe("string");
  expect(resolvedPassword.length).toBeGreaterThan(20);

  // Close the app's DB so the legacy seed can open the same IndexedDB name.
  await page.evaluate(async () => {
    const { destroyDB } = await import("/src/db/database.ts");
    await destroyDB();
  });

  // ── Phase 2: seed a genuine pre-F-06 vault (CryptoJS-only, v6) ──────
  const bookmarks = makeLegacyRows(SEED_ROWS);
  const seedResult = await page.evaluate(
    async ({ password, rows }) => {
      const { seedLegacyVault, wipeVaultDatabases } = await import(
        "/tests/e2e/legacy-vault-seeder.ts"
      );
      await wipeVaultDatabases();
      return seedLegacyVault({ password, bookmark: rows });
    },
    { password: resolvedPassword, rows: bookmarks },
  );
  expect(
    seedResult.ok,
    `legacy seed failed: ${!seedResult.ok ? seedResult.error : ""}`,
  ).toBe(true);

  // ── Phase 3: reload → unlock → observe the progress overlay ─────────
  await page.reload();
  await expect(page.getByTestId("vault-locked-screen")).toBeVisible({
    timeout: 30_000,
  });

  // Sample the overlay's percent until a strictly-intermediate value is
  // seen (live per-batch progress) or the deadline passes. No fixed-sleep
  // assumption: the loop exits as soon as the migration shows progress.
  const seenPercents: number[] = [];
  const INTERMEDIATE_DEADLINE_MS = 90_000;
  await unlockVaultObserving(
    page,
    async () => {
      const overlay = page.getByTestId("vault-migrating-screen");
      // Auto-retrying visibility: catches the overlay whenever it appears
      // (it stays mounted through the 650ms exit hold + fade, and the
      // migration itself runs for several seconds at SEED_ROWS rows).
      await expect(overlay).toBeVisible({ timeout: 60_000 });

      const deadline = Date.now() + INTERMEDIATE_DEADLINE_MS;
      while (Date.now() < deadline) {
        // isVisible() never waits: once the overlay fades/unmounts this
        // immediately returns false instead of stalling on a detached node.
        if (await overlay.isVisible().catch(() => false)) {
          const text = ((await overlay.textContent().catch(() => "")) ?? "")
            .trim();
          const match = text.match(/(\d+)%/);
          if (match) {
            const pct = Number(match[1]);
            seenPercents.push(pct);
            if (pct > 0 && pct < 100) {
              break;
            }
          }
        }
        await page.waitForTimeout(100);
      }
    },
    VAULT_PASSWORD,
    // The shell must mount AFTER the whole migration finishes; Windows
    // WebKit rewrites rows ~8× slower than Chromium, so the default 30s
    // shell wait is not enough once a real migration is in flight.
    { shellTimeoutMs: 100_000 },
  );

  // The overlay showed a LIVE percentage (0 < p < 100) — per-batch
  // progress reached the UI, not just a final 100% flash.
  expect(
    seenPercents.some((p) => p > 0 && p < 100),
    `expected a strictly-intermediate percent on the migrating overlay, saw: ${JSON.stringify(seenPercents)}`,
  ).toBe(true);

  // ── Phase 4: the shell mounts and every seeded row survived ─────────
  const migrated = await page.evaluate(async (expectedCount) => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    const count = await (db as any).bookmarks.count().exec();
    const first = await (db as any).bookmarks.findOne().exec();
    return {
      count: Number(count),
      firstTitle: first?.get("title") ?? null,
    };
  }, SEED_ROWS);
  expect(migrated.count).toBe(SEED_ROWS);
  expect(migrated.firstTitle).toBe("Vault Progress Bookmark 0");
});
