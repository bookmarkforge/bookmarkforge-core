/**
 * A-1 / ADR-046 — an already-open tab follows a KDF-salt rotation performed in
 * a sibling tab.
 *
 * The salt lives in MODULE state (crypto-core's `vaultKdfSalt`), so a rotation
 * used to reach other tabs only on their next reload. Until then those tabs
 * kept writing `v6:` payloads keyed to the salt the vault had just retired: the
 * harvested corpus kept growing under a salt whose precomputation an attacker
 * had already paid for, and the vault had two live salts.
 *
 * This spec is the end-to-end half of that fix, with two real tabs of the same
 * context (same origin, same IndexedDB, same BroadcastChannel scope) and no
 * simulation of the channel:
 *
 *   - both tabs start on the SAME salt, and the second tab's write embeds it;
 *   - the first tab rotates the master password through the real Settings flow;
 *   - the second tab adopts the new salt WITHOUT a reload — proved by a marker
 *     left in its JS realm surviving the adoption;
 *   - the second tab's next write embeds the NEW salt and still round-trips
 *     through its own read path (adopting a salt must never break the writer);
 *   - storage holds the committed salt, which is why the notification can be
 *     acted on (persist-before-install).
 */
import { test, expect } from "@playwright/test";
import {
  expectUnlockedApp,
  readInstalledVaultKdfSalt,
  readVaultKdfSaltFromToken,
  setupVault,
  unlockVault,
  writeVaultProbeSecret,
} from "./vault-helpers";

const NEW_PASSWORD = "cross-tab-rotated-password-7";
const PROBE_KEY = "e2e_kdf_probe";
const PROBE_VALUE = "e2e-kdf-probe";
const SALT_HEX = /^[0-9a-f]{32}$/;

test("a tab that is already open adopts the KDF salt rotated in a sibling tab", async ({
  page,
  context,
}) => {
  await setupVault(page);
  const saltBefore = await readInstalledVaultKdfSalt(page);
  expect(saltBefore).toMatch(SALT_HEX);

  // ── A second tab of the same context. Its module state is its own, so it
  //    provisions whatever the vault currently stores at its own unlock.
  const secondTab = await context.newPage();
  await secondTab.goto("/");
  // The session flag is per tab, so this normally lands on the unlock screen —
  // but a shared-context restore can already have the shell up, and the premise
  // under test is the salt, not how this tab got unlocked.
  if (!(await secondTab.getByTestId("settings-button").isVisible())) {
    await unlockVault(secondTab);
  }
  await expectUnlockedApp(secondTab);

  expect(await readInstalledVaultKdfSalt(secondTab)).toBe(saltBefore);
  expect(await writeVaultProbeSecret(secondTab, PROBE_KEY, PROBE_VALUE)).toBe(
    saltBefore,
  );

  // Marker in the second tab's JS realm: if it survives the rotation below, the
  // adoption happened in the SAME document — no reload, which is the point.
  await secondTab.evaluate(() => {
    (window as unknown as { __crossTabMarker?: string }).__crossTabMarker =
      "alive";
  });

  // ── Rotate the master password in the FIRST tab (the production flow).
  await page.getByTestId("settings-button").click();
  const passwordInput = page.getByTestId("vault-password-input");
  await expect(passwordInput).toBeVisible({ timeout: 30_000 });
  await passwordInput.fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Update Password" }).click();
  await expect(
    page.getByText("Master password updated successfully"),
  ).toBeVisible({ timeout: 30_000 });

  const saltAfter = await readInstalledVaultKdfSalt(page);
  expect(saltAfter).toMatch(SALT_HEX);
  expect(saltAfter).not.toBe(saltBefore);
  // The rotation persisted the salt BEFORE installing it, which is what makes
  // the cross-tab notification safe to act on rather than a race.
  expect(await readVaultKdfSaltFromToken(page)).toBe(saltAfter);

  // ── The sibling tab follows, in the same document…
  await expect
    .poll(() => readInstalledVaultKdfSalt(secondTab), {
      timeout: 20_000,
      intervals: [100, 250, 500, 1_000],
    })
    .toBe(saltAfter);
  expect(
    await secondTab.evaluate(
      () => (window as unknown as { __crossTabMarker?: string }).__crossTabMarker,
    ),
  ).toBe("alive");

  // ── …and the adoption locks the tab (ADR-046 fail-closed contract): the
  //    rotation changed BOTH the password and the salt, so keeping the old
  //    session alive would let this tab write ciphertext the new password
  //    cannot decrypt. The unlock screen returns; no reload happened (the
  //    marker above proves the same document).
  await expect(
    secondTab.getByLabel("Master Password"),
  ).toBeVisible({ timeout: 30_000 });
  await unlockVault(secondTab, NEW_PASSWORD);

  // ── Its next write is keyed with the NEW salt: the retired one stops
  //    accumulating ciphertext from this tab. The payload still round-trips
  //    through this tab's own read path — the master-key cache is keyed by
  //    salt, so adopting one never returns a key derived under the other.
  expect(await writeVaultProbeSecret(secondTab, PROBE_KEY, PROBE_VALUE)).toBe(
    saltAfter,
  );
  expect(
    await secondTab.evaluate(
      async ({ key }) => {
        const { securityVault } = await import(
          "/src/services/SecurityVault.ts"
        );
        return securityVault.decryptSecret(key);
      },
      { key: PROBE_KEY },
    ),
  ).toBe(PROBE_VALUE);
});
