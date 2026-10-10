import { test, expect } from "@playwright/test";
import { setupVault, unlockAfterReload, VAULT_PASSWORD } from "./vault-helpers";

/**
 * storage-quota-warning: when navigator.storage.estimate() reports ≥95%
 * usage, the StorageStatus pill renders a "Free up space" button that opens
 * the StorageCleanupDialog. F0-3 / ADR-034 D5.
 *
 * We stub storage.estimate() to simulate quota pressure because the real
 * browser in CI never reaches 95%. The button appears at ≥85% (warning)
 * and ≥95% (critical); this spec targets both thresholds.
 *
 * The stub must survive `page.reload()` (which rebuilds the JS context),
 * so we install it via `addInitScript` BEFORE navigating. Running
 * `Object.defineProperty(navigator, "storage", ...)` from `page.evaluate`
 * is wiped by the reload.
 */
async function stubQuota(page: import("@playwright/test").Page, used: number, total: number) {
  await page.addInitScript(
    ({ used, total }) => {
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        get: () => ({
          estimate: async () => ({ usage: used, quota: total }),
          persist: async () => true,
          persistUsage: async () => true,
          persistEstimate: async () => ({ usage: used, quota: total }),
          cursed: false,
        }),
      });
    },
    { used, total },
  );
}

test("Free up space button appears at 95% quota and opens cleanup dialog", async ({
  page,
}) => {
  // Stub before any navigation so it sticks across reload() in setupVault.
  await stubQuota(page, 96 * 1024 * 1024 * 1024, 100 * 1024 * 1024 * 1024);

  await setupVault(page);

  // The "Free up space" button should be visible (critical ≥95%).
  const freeUpBtn = page.getByRole("button", { name: "Free up space" });
  await expect(freeUpBtn).toBeVisible({ timeout: 15_000 });

  // Click it — the cleanup dialog should open.
  await freeUpBtn.click();

  // The dialog has an aria-label or heading "Storage is almost full".
  const dialog = page.getByRole("dialog", { name: /storage.*full/i });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // The dialog should contain the expected action buttons.
  await expect(dialog.getByText("Export backup first")).toBeVisible();
  await expect(dialog.getByText("Clear AI models")).toBeVisible();
  await expect(dialog.getByText("Compact Database")).toBeVisible();
});

test("Free up space button appears at 85% quota with warning styling", async ({
  page,
}) => {
  await stubQuota(page, 88 * 1024 * 1024 * 1024, 100 * 1024 * 1024 * 1024);

  await setupVault(page);

  // At 85% (warning), the button should still appear (amber styling).
  const freeUpBtn = page.getByRole("button", { name: "Free up space" });
  await expect(freeUpBtn).toBeVisible({ timeout: 15_000 });

  // Click it — same dialog.
  await freeUpBtn.click();
  const dialog = page.getByRole("dialog", { name: /storage.*full/i });
  await expect(dialog).toBeVisible({ timeout: 5_000 });
});

test("Free up space button is absent below 70% quota", async ({ page }) => {
  await setupVault(page);

  // No stub needed — CI browsers typically use <1% of quota.
  await page.reload();
  await unlockAfterReload(page, VAULT_PASSWORD);

  // The button should NOT appear when usage is normal (<70%).
  const freeUpBtn = page.getByRole("button", { name: "Free up space" });
  await expect(freeUpBtn).not.toBeVisible({ timeout: 5_000 });
});
