import { expect, type Page } from "@playwright/test";

/**
 * Storage-backend guard for the e2e suite.
 *
 * The suite is meant to exercise the durable Dexie/IndexedDB backend that
 * production uses (playwright.config.ts boots the server with
 * VITE_FORCE_DEXIE_STORAGE=true). If a spec runs against a reused dev server
 * that lacks that flag — a plain `npm run dev` — the headless Chromium used by
 * Playwright reports `navigator.webdriver === true`, so the app silently falls
 * back to in-memory storage. Persistence, reload and corruption specs then
 * pass or fail for the wrong reasons.
 *
 * The app publishes the resolved backend on `window` (dev/test builds only,
 * see `publishStorageBackend` in src/db/database.ts). This helper reads it and
 * fails loudly when it is not "Dexie".
 */

export const E2E_STORAGE_BACKEND_KEY = "__bmf_active_storage_backend__";

export async function readActiveStorageBackend(
  page: Page,
): Promise<string | null> {
  return page.evaluate((key) => {
    const value = (window as unknown as Record<string, unknown>)[key];
    return typeof value === "string" ? (value as string) : null;
  }, E2E_STORAGE_BACKEND_KEY);
}

export async function assertDurableBackend(
  page: Page,
  diagnostics: string[] = [],
): Promise<void> {
  const backend = await readActiveStorageBackend(page);
  const hint =
    backend === "Memory"
      ? "The dev server reused for this run booted the app on in-memory storage " +
        "(missing VITE_FORCE_DEXIE_STORAGE / `--mode test`). Restart it with " +
        "`npm run dev -- --mode test` or drop PLAYWRIGHT_REUSE_SERVER=true so " +
        "playwright.config.ts boots its own server."
      : "The app never published a storage backend. The vault may not have " +
        "finished initializing, or the diagnostic window hook is missing.";
  expect(
    backend,
    `${hint}` +
      (diagnostics.length ? `\nApp events:\n${diagnostics.join("\n")}` : ""),
  ).toBe("Dexie");
}
