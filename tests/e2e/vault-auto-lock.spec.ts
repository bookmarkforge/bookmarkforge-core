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

/**
 * The inactivity lock is driven by a wall-clock DEADLINE, not by a countdown
 * timer. A hidden, frozen or suspended tab (and a device that slept) runs no
 * timers at all, so on wake the elapsed time is not "what the timer had
 * left" — it is whatever the clock says. Without the deadline, this vault
 * would stay open for another full timeout after the machine woke up.
 *
 * Simulated here without CDP: the page's `Date.now` is skewed forward (what a
 * suspended device looks like to JS) and a resume signal is dispatched. With
 * a 5-minute timeout, the lock screen must appear while the armed timer still
 * has minutes left to run — proof the decision came from the deadline and not
 * from the timer.
 */
test("auto-lock honours the deadline after a suspension that ran no timers", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // 5 minutes: long enough that the timer cannot fire inside this test.
    window.localStorage.setItem("auto_lock_timeout", "300000");
  });

  await setupVault(page);
  await expect(page.getByTestId("settings-button")).toBeVisible({
    timeout: 30_000,
  });

  // 40 minutes pass while no timer runs, then the browser signals the resume.
  await page.evaluate(() => {
    const w = window as unknown as { __bfRealNow?: typeof Date.now };
    const realNow = Date.now.bind(Date);
    w.__bfRealNow = realNow;
    const skewMs = 40 * 60 * 1000;
    Date.now = () => realNow() + skewMs;
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(page.getByTestId("vault-locked-screen")).toBeVisible({
    timeout: 10_000,
  });

  // Restore the clock so the unlock below is not stamped 40 minutes ahead.
  await page.evaluate(() => {
    const w = window as unknown as { __bfRealNow?: typeof Date.now };
    if (w.__bfRealNow) {
      Date.now = w.__bfRealNow;
    }
  });
  await unlockVault(page);
});
