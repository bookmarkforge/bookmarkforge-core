import { expect, type Page } from "@playwright/test";

/**
 * Pro entitlement seeding for Pro-gated E2E specs (backup / restore flows).
 *
 * HOW IT WORKS — no client-side forging, ever:
 * The client only trusts a license state that is an RSA-PSS signature over
 * a payload bound to the install deviceId, verified with the committed
 * public key. Nothing editable can fake that. Instead, this helper runs the
 * REAL activation path in the page: LicenseService.activate() →
 * /api/license/activate (Vite proxy) → companion signing service (8787) →
 * Whop adapter → scripts/license-mock.mjs (8082, wired in
 * playwright.config.ts) → the server signs a payload for THIS deviceId with
 * the gitignored dev key (server/.license-signing-key.pkcs8). The response
 * is persisted by the production code path itself, exactly like a real
 * activation (launch-smoke-critical-paths does the same through the UI).
 *
 * Without the dev key the signing service fails closed (503
 * SIGNING_KEY_INVALID) and the seed fails loudly — it never silently
 * grants Pro.
 *
 * INTENTIONALLY OPT-IN: never call this from setupVault. Several specs
 * assert Free-tier limits (1,000-bookmark wall, Pro-unavailable panels);
 * seeding globally would break them. Only Pro-gated specs call it, on the
 * already-loaded app origin (no navigation: a goto after setupVault would
 * re-lock the vault and would interrupt the open onboarding wizard).
 */

/** Value scripts/license-mock.mjs accepts (matches LICENSE_MOCK_KEY in playwright.config.ts). */
const E2E_LICENSE_KEY = process.env.BMF_E2E_LICENSE_KEY ?? "e2e-license-key";

/** Persisted state key — mirrors LICENSE_CONFIG.storageKeys.licenseState. */
const LICENSE_STATE_KEY = "bf_license_state";

/**
 * Activate the mock-adapter license for this browser context's install and
 * wait until the signed state is persisted and cryptographically trusted.
 * The page must already be on the app origin (localStorage is origin-bound)
 * and the app bundle must be loaded — call it after setupVault/skipPassword.
 */
export async function seedProEntitlement(page: Page): Promise<void> {
  await page.evaluate(async (licenseKey) => {
    const { licenseService } = await import("/src/services/LicenseService.ts");
    await licenseService.activate(licenseKey);
    if (!licenseService.hasProAccess()) {
      throw new Error(
        "seedProEntitlement: activation did not yield Pro access " +
          "(signing service unreachable, dev key missing, or adapter key mismatch)",
      );
    }
  }, E2E_LICENSE_KEY);

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
}

/**
 * Remove the seeded entitlement (specs that flip Pro → Free mid-test).
 * Deliberately does NOT call licenseService.deactivate(): that performs
 * server-side bookkeeping on the shared mock instance, and a local state
 * removal is all a reload needs to boot back to Free.
 */
export async function clearProEntitlement(page: Page): Promise<void> {
  await page.evaluate((key) => localStorage.removeItem(key), LICENSE_STATE_KEY);
}
