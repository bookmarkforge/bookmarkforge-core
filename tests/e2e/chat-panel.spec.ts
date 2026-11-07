import { test, expect } from "@playwright/test";
import { skipPassword } from "./vault-helpers";

/**
 * Chat Route E2E
 *
 * Tests that the Support Chat route loads without errors.
 */
test.describe("Chat Route", () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test("chat route loads without errors", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForTimeout(2000);

    // The page should render without error boundaries
    const body = await page.textContent("body");
    expect(body?.length).toBeGreaterThan(100);

    // Should not show an error boundary
    const errorText = page.getByText("Something went wrong");
    await expect(errorText).not.toBeVisible();
  });

  test("chatLocal route loads without errors", async ({ page }) => {
    await page.goto("/chatLocal");
    await page.waitForTimeout(2000);

    const body = await page.textContent("body");
    expect(body?.length).toBeGreaterThan(100);

    const errorText = page.getByText("Something went wrong");
    await expect(errorText).not.toBeVisible();
  });
});
