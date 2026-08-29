import { test, expect } from "@playwright/test";
import { setupVault, unlockVault } from "./vault-helpers";

/**
 * vault-auto-lock: with auto-lock enabled and a short timeout, the vault
 * locks itself after inactivity. The timeout is injected via
 * addInitScript BEFORE the app boots so useSettings reads it from
 * localStorage (auto_lock_timeout, ms) and AutoLockManager arms a short
 * timer.
 */
test("auto-lock locks the vault after the configured inactivity timeout", async ({
  page,
}) => {
  // autoLockEnabled defaults to true; only the timeout needs overriding.
  await page.addInitScript(() => {
    window.localStorage.setItem("auto_lock_timeout", "2000");
  });

  await setupVault(page);

  // Unlocked shell renders; AutoLockManager timer is armed.
  await expect(page.getByTestId("settings-button")).toBeVisible({
    timeout: 30_000,
  });

  // No activity → the 2s timer fires and forces the lock screen.
  await expect(page.getByTestId("vault-locked-screen")).toBeVisible({
    timeout: 15_000,
  });

  // Lock survives — the correct password still unlocks.
  await unlockVault(page);
});
