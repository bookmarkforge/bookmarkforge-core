import { expect, test } from "@playwright/test";
import { setupVault } from "./vault-helpers";

/**
 * p2p-lan-warning — asserts the same-LAN requirement is surfaced INSIDE the
 * P2P sync modal, on the role-chooser screen, before any pairing attempt.
 *
 * Why this deserves an e2e: the sync service is LAN-only by design
 * (iceServers: [] — no STUN/TURN), so a user who opens the modal with their
 * phone on mobile data can never pair. The failure surfaces minutes later as
 * a generic handshake timeout, which reads as "the app is broken". The
 * warning card must therefore be visible up front — on the role-chooser
 * screen, exactly where the user decides which device does what — and
 * translated in every locale.
 *
 * Regression guard: any refactor that drops the card, gates it behind a
 * locale that doesn't define the keys, or renames the keys out from under
 * i18n-completeness fails here.
 */
test.describe("P2P modal same-LAN warning", () => {
  test.beforeEach(async ({ page }) => {
    await setupVault(page);
    // The P2P card lives in the "Intelligence Center" modal (Dashboard.tsx)
    // Data tab, which only opens via the Omnibar command (same path the
    // export-import battery uses — see openDataTab there).
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByRole("option", { name: "Intelligence Center" })
      .click({ timeout: 30_000 });
    await page
      .getByRole("button", { name: "Data Sovereignty", exact: true })
      .click({ timeout: 30_000 });
    await page
      .getByRole("button", { name: "Start Local Connection" })
      .click({ timeout: 30_000 });
  });

  test("warning card is visible on the role-chooser screen", async ({
    page,
  }) => {
    // The Data tab behind the modal also shows an "Secure P2P Sync" h4 card
    // title — scope to the modal dialog to avoid the strict-mode clash.
    const dialog = page.getByRole("dialog", { name: "Secure P2P Sync" });
    await expect(dialog).toBeVisible();

    const note = page.getByRole("note");
    await expect(note).toBeVisible();
    await expect(
      note.getByText(
        "Both devices must be on the same Wi-Fi network",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      note.getByText(
        /This sync works device-to-device over your local network/,
      ),
    ).toBeVisible();
    await expect(
      note.getByText(/Tip: turn off mobile data on your phone/),
    ).toBeVisible();
  });

  test("warning is chooser-scoped and the host flow survives selection", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "This is the host" })
      .click();

    // The full card lives on the role-chooser screen only: once a role is
    // picked, the scanner/generating UI takes over and the stale warning
    // must not linger as clutter.
    await expect(page.getByRole("note")).toBeHidden();
    // And the host flow itself is alive (QR step appears).
    await expect(
      page.getByText("Step 1: Scan this QR with your second device."),
    ).toBeVisible();
  });
});
