import { test } from "@playwright/test";
import { skipPassword, expectUnlockedApp } from "./vault-helpers";

/**
 * vault-skip-password: the "Continue without encryption" path. A pristine
 * context skips the master password and lands directly on the unlocked app.
 */
test("skip password opens the app without a vault password", async ({ page }) => {
  await skipPassword(page);
  await expectUnlockedApp(page);
});
