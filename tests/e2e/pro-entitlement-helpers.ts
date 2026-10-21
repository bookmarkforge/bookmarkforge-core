import { expect, type Page } from "@playwright/test";

/**
 * Pro entitlement seeding for Pro-gated E2E specs (backup / restore flows).
 *
 * HOW IT WORKS — no client-side forging, ever:
 * The client only trusts an RSA-PSS signature over a payload bound to this
 * install's deviceId, verified with the committed public key. This helper
 * enters the mock license through the real Settings → Pro UI; no test imports
 * app source or forges client state. The request travels through the signing
 * service and Whop-compatible local adapter, which still requires the
 * operator's matching private signing key.
 *
 * Without the dev key the signing service fails closed (503
 * SIGNING_KEY_INVALID) and the seed fails loudly — it never silently
 * grants Pro.
 *
 * INTENTIONALLY OPT-IN: never call this from setupVault. Several specs
 * assert Free-tier limits and Pro-unavailable panels. Call only from a Pro-
 * gated spec after onboarding is closed; this helper opens and closes Settings.
 */

/** Persisted state key — mirrors LICENSE_CONFIG.storageKeys.licenseState. */
const LICENSE_STATE_KEY = "bf_license_state";

/**
 * Activate a mock-adapter license through the visible Settings → Pro flow.
 * The caller may supply the license key expected by its profile's mock
 * adapter; omitting it uses the shared E2E profile default.
 */
export async function seedProEntitlement(
  page: Page,
  licenseKey = process.env.BMF_E2E_LICENSE_KEY ?? "e2e-license-key",
): Promise<void> {
  if (!licenseKey.trim()) {
    throw new Error("seedProEntitlement requires a non-empty mock license key");
  }
  const settings = page.getByTestId("settings-button");
  await expect(settings).toBeVisible();
  await settings.click();
  const dialog = page.locator('[aria-labelledby="settings-dialog-title"]');
  await expect(dialog).toBeVisible();
  const pro = page.getByTestId("settings-pro");
  await expect(pro).toBeVisible();
  const activationError = pro.locator('p[role="alert"]');
  const activationStatus = pro.getByText(/^(Devices:|Activations left:)/);
  await pro.locator("#license-key-input").fill(licenseKey);
  await pro.getByRole("button", { name: "Activate" }).click();
  await expect(activationError.or(activationStatus)).toBeVisible({
    timeout: 60_000,
  });
  if (await activationError.isVisible()) {
    throw new Error(
      `seedProEntitlement: Settings license activation failed: ${(await activationError.textContent())?.trim() || "unknown license error"}`,
    );
  }
  await expect(pro.getByRole("button", { name: "Deactivate" })).toBeVisible();

  // The production persistence contract: a signed { payload, signature }
  // state in localStorage. Assert it so a silent downgrade (e.g. tamper
  // audit path clearing the state) fails here, not three steps later.
  // The key travels as an argument: page.evaluate closures run in the
  // browser and cannot see Node-scope constants.
  await expect
    .poll(() =>
      page.evaluate(
        (key) => localStorage.getItem(key) ?? "",
        LICENSE_STATE_KEY,
      ),
    )
    .toContain('"signature"');

  await dialog.getByRole("button", { name: "Close" }).first().click();
  await expect(dialog).toBeHidden();
}

/**
 * Remove the signed entitlement locally for specs that flip Pro → Free.
 * This deliberately avoids a server-side deactivation; it is only suitable
 * when the current test discards or reloads this browser state afterwards.
 */
export async function clearProEntitlement(page: Page): Promise<void> {
  await page.evaluate((key) => localStorage.removeItem(key), LICENSE_STATE_KEY);
}
