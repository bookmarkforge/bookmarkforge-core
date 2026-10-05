/**
 * tests/e2e/sidebar-collapse-layout.spec.ts
 *
 * Regression gate for the sidebar-collapse layout fix (plan 002): the
 * Tailwind v4 `sidebar-collapsed` variant must shift the main content
 * column when the sidebar collapses.
 *
 * Before the fix the variant was never registered (`@custom-variant` was
 * missing after the Tailwind v4 migration), so collapsing only shrank the
 * sidebar rail while the content margin stayed at 220px — the content
 * visually jumped under the rail. The e2e toggle test only checked the
 * button label, so the broken layout shipped unnoticed.
 *
 * Uses `skipPassword` (session-only, no vault) so the layout assertions
 * are independent of the vault-unlock flow. Measures the computed layout
 * in both states (md+ viewport, Desktop Chrome):
 *
 *   1. expanded:  rail 220px (`w-[220px]`), content margin 220px
 *      (`md:ms-[220px]`), no `sidebar-collapsed` class on <html>
 *   2. collapsed: rail 64px (`data-[collapsed=true]:w-16`), content
 *      margin 64px (`md:sidebar-collapsed:ms-[64px]`), class applied
 *   3. expanded again: everything restored
 *
 * The content margin mirrors the rail width in both states; asserting
 * computed values keeps the check independent of class names and of the
 * 200ms CSS transition (assertions poll until the layout settles).
 */
import { test, expect } from "@playwright/test";
import { skipPassword } from "./vault-helpers";
import {
  CONTENT_SELECTOR,
  SIDEBAR_SELECTOR,
  layoutState,
} from "./sidebar-collapse-helpers";

test("collapsing the sidebar shifts the content column", async ({ page }) => {
  await skipPassword(page);

  const sidebar = page.locator(SIDEBAR_SELECTOR);
  await expect(sidebar).toBeVisible({ timeout: 30_000 });

  // Expanded: 220px rail, content offset by the same amount.
  await expect
    .poll(() => layoutState(page), { timeout: 5_000 })
    .toEqual({ sidebarWidth: 220, contentMargin: "220px", htmlCollapsed: false });

  await page.getByRole("button", { name: "Collapse sidebar" }).click();

  // Collapsed: 64px rail, content offset by 64px, variant class on <html>.
  await expect
    .poll(() => layoutState(page), { timeout: 5_000 })
    .toEqual({ sidebarWidth: 64, contentMargin: "64px", htmlCollapsed: true });

  await page.getByRole("button", { name: "Expand sidebar" }).click();

  // Expanding restores the original layout.
  await expect
    .poll(() => layoutState(page), { timeout: 5_000 })
    .toEqual({ sidebarWidth: 220, contentMargin: "220px", htmlCollapsed: false });
});
