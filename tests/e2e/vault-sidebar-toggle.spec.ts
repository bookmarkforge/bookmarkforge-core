import { test, expect } from "@playwright/test";
import { setupVault, unlockAfterReload, safeReload, VAULT_PASSWORD } from "./vault-helpers";
import { layoutState } from "./sidebar-collapse-helpers";

/**
 * vault-sidebar-toggle: runs under playwright.idb-persistence.ts. Collapsing
 * the sidebar persists in localStorage — after a reload the sidebar stays
 * collapsed (the toggle now reads "Expand sidebar").
 *
 * Also asserts the layout shift (plan 002): the Tailwind v4
 * `sidebar-collapsed` variant must move the content column from 220px to
 * 64px when the rail collapses. Before the variant was registered, only
 * the label changed while the content stayed at 220px.
 */
test("sidebar collapsed state persists across reload", async ({ page }) => {
  await setupVault(page);

  // Expanded baseline: 220px rail, content offset by the same amount.
  await expect
    .poll(() => layoutState(page), { timeout: 5_000 })
    .toEqual({ sidebarWidth: 220, contentMargin: "220px", htmlCollapsed: false });

  const collapseBtn = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(collapseBtn).toBeVisible({ timeout: 30_000 });
  await collapseBtn.click();

  // After collapse the toggle label flips to "Expand sidebar" and the
  // layout shifts: 64px rail, 64px content margin, variant class on <html>.
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => layoutState(page), { timeout: 5_000 })
    .toEqual({ sidebarWidth: 64, contentMargin: "64px", htmlCollapsed: true });

  await safeReload(page);
  // The vault relocks after reload — unlock, then the sidebar state must
  // still be collapsed (button label "Expand sidebar").
  await unlockAfterReload(page, VAULT_PASSWORD);
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible({ timeout: 30_000 });
});
