import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  setupVault,
  unlockExpectingError,
  VAULT_PASSWORD,
} from "./vault-helpers";

/**
 * End-to-end regression replay for findings P-1..P-9 in
 * ../AUDITORIA-ERRORES-Y-OPTIMIZACIONES.txt.
 *
 * Run with:
 *   npx playwright test --project=chromium --workers=1 \
 *     tests/e2e/playtest-regressions.spec.ts
 *
 * Soft assertions intentionally collect the independent regressions in one
 * browser journey; the report lists every broken expectation at the end.
 */
async function pointerTargets(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return hit === element || element.contains(hit);
  });
}

async function rejectConsent(page: Page): Promise<void> {
  const reject = page.getByRole("button", { name: "Reject All" });
  if (await reject.isVisible().catch(() => false)) {
    await reject.evaluate((button) => (button as HTMLButtonElement).click());
    await expect(page.getByRole("region", { name: "Privacy consent" })).toBeHidden();
  }
}

test("reproduce and guard playtest findings P-1 through P-9", async ({ page }) => {
  test.setTimeout(360_000);
  const appErrors: string[] = [];
  const zeroizationWarnings: string[] = [];
  const failedSecretWrites: string[] = [];

  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && /SecureStorage|decrypt/i.test(text)) {
      appErrors.push(text);
    }
    if (/zeroPasswordBytes.*already zeroized/i.test(text)) {
      zeroizationWarnings.push(text);
    }
    if (/Failed to store secret.*DEVICE_KEY_WRAPPED/i.test(text)) {
      failedSecretWrites.push(text);
    }
  });

  // P-1(d): reproduce the first-visit consent state rather than inheriting the
  // E2E fixture's accepted-consent storage. Keep this script scoped to this page.
  await page.addInitScript(() => {
    localStorage.removeItem("forge_consent_decision_made");
    const observed: string[] = [];
    Object.defineProperty(window, "__playtestSecurityLabels", { value: observed });
    const scan = () => {
      for (const node of document.querySelectorAll<HTMLElement>("[aria-label]")) {
        const label = node.getAttribute("aria-label") ?? "";
        if (/DEV mode bypass/i.test(label) && !observed.includes(label)) observed.push(label);
      }
    };
    new MutationObserver(scan).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    });
    scan();
  });
  // The legacy setupVault helper opens `/`; the marketing/app split now serves
  // the app at `/app`. Redirect only this test's exact origin root so setup
  // still exercises the normal onboarding UI without changing shared helpers.
  const baseURL = String(test.info().project.use.baseURL ?? "http://127.0.0.1:4173");
  const appRoot = new URL("/", baseURL).href;
  await page.route(appRoot, (route) =>
    route.fulfill({ status: 302, headers: { location: "/app" } }),
  );
  await setupVault(page, { dismissOnboarding: false });
  await page.unroute(appRoot);

  // P-1(b/c): test real pointer hit targets on first-run overlays before
  // dismissing them. The first-run app can show both the backup and eviction
  // notices in addition to the empty-vault recovery wizard.
  const continueFresh = page.getByRole("button", {
    name: "Continue without restoring",
  });
  if (await continueFresh.isVisible().catch(() => false)) {
    expect.soft(
      await pointerTargets(continueFresh),
      "P-1(b): the empty-vault primary action should receive its own pointer hit",
    ).toBe(true);
  }
  const evictionDismiss = page.getByRole("button", { name: "Got it, I'll do it later" });
  if (await evictionDismiss.isVisible().catch(() => false)) {
    expect.soft(
      await pointerTargets(evictionDismiss),
      "P-1(b): the eviction notice dismiss action should be pointer-reachable",
    ).toBe(true);
  }
  const backupDismiss = page.getByRole("button", { name: "Got it, remind me later" });
  if (await backupDismiss.isVisible().catch(() => false)) {
    expect.soft(
      await pointerTargets(backupDismiss),
      "P-1(c): the backup notice dismiss action should be pointer-reachable",
    ).toBe(true);
  }
  if (await continueFresh.isVisible().catch(() => false)) {
    await continueFresh.evaluate((button) => (button as HTMLButtonElement).click());
  }
  const skipOnboarding = page.getByRole("button", { name: "Skip onboarding" });
  if (await skipOnboarding.isVisible().catch(() => false)) {
    await skipOnboarding.evaluate((button) => (button as HTMLButtonElement).click());
  }
  await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 60_000 });
  if (await evictionDismiss.isVisible().catch(() => false)) {
    await evictionDismiss.evaluate((button) => (button as HTMLButtonElement).click());
  }
  if (await backupDismiss.isVisible().catch(() => false)) {
    await backupDismiss.evaluate((button) => (button as HTMLButtonElement).click());
  }

  // Consent and the floating quick-capture action must not cover one another.
  const consent = page.getByRole("region", { name: "Privacy consent" });
  if (await consent.isVisible().catch(() => false)) {
    const fab = page.getByTestId("add-bookmark-button");
    expect.soft(
      await pointerTargets(fab),
      "P-1: the consent banner's full-width wrapper must not intercept the FAB",
    ).toBe(true);
    const consentAction = consent.getByRole("button", { name: "Reject All" });
    expect.soft(
      await pointerTargets(consentAction),
      "P-1: the consent action should be directly clickable",
    ).toBe(true);
    await rejectConsent(page);
  }

  // P-4: fresh vault initialization should not repeatedly report malformed
  // ciphertext as a SecureStorage failure.
  expect.soft(
    appErrors.filter((text) => /AES-GCM decryption failed|Failed to retrieve secret/i.test(text)),
    "P-4: no malformed/corrupt secret should be retried on a clean boot",
  ).toEqual([]);

  // P-7: an empty state must point at an action that exists, not claim a form
  // is above the list while only describing the browser extension.
  await page
    .getByRole("navigation", { name: "Sidebar sections" })
    .getByRole("button", { name: "Bookmarks", exact: true })
    .click();
  const emptyHint = page.getByText(/Drag the "Web Clipper" button/i);
  await expect(emptyHint).toBeVisible();
  expect.soft(
    await page.getByText("No bookmarks yet. Add your first link above!").textContent(),
    "P-7: empty-state copy must not direct users to a nonexistent form above",
  ).not.toMatch(/above/i);
  expect.soft(
    await emptyHint.textContent(),
    "P-7: the empty state should mention the in-app Quick Capture path",
  ).toMatch(/quick capture/i);

  // P-2: this component intentionally supports both bookmarks and plain-text
  // notes. Lock the observed contract: arbitrary text is classified as a note,
  // gets note-specific success feedback, and is stored in Documents (not as a
  // malformed bookmark). This avoids treating the documented note feature as a
  // URL-validation bug.
  await page.getByTestId("add-bookmark-button").click();
  const capture = page.getByTestId("quick-capture-input");
  await capture.fill("no-es-una-url");
  await page.getByTestId("save-bookmark-button").click();
  await expect(page.getByText("Note captured and processed!", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Sidebar sections" })
    .getByRole("button", { name: "Documents", exact: true })
    .click();
  await expect(page.getByText(/no-es-una-url/i)).toBeVisible();
  await page
    .getByRole("navigation", { name: "Sidebar sections" })
    .getByRole("button", { name: "Bookmarks", exact: true })
    .click();
  await expect(page.getByText("No bookmarks yet. Add your first link above!")).toBeVisible();

  // Add one valid bookmark to exercise its accessible row and route persistence.
  await page.getByTestId("add-bookmark-button").click();
  await page.getByTestId("quick-capture-input").fill("https://example.com/playtest-regression");
  await page.getByTestId("bookmark-title-input").fill("Playtest regression bookmark");
  await page.getByTestId("save-bookmark-button").click();
  await expect(page.getByText("Bookmark captured and processed!", { exact: true })).toBeVisible();
  await expect(page.getByText("Playtest regression bookmark", { exact: true })).toBeVisible();

  // P-3: sidebar labels must resolve to human-readable translations.
  expect.soft(
    await page.getByRole("navigation", { name: "Sidebar sections" }).innerText(),
    "P-3: sidebar must not render a missing i18n key literally",
  ).not.toContain("app_security");
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitem", { name: /Español/i }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe("es");
  expect.soft(
    await page.getByRole("button", { name: "app_security", exact: true }).count(),
    "P-3: Spanish sidebar must not expose app_security",
  ).toBe(0);
  await page.getByRole("button", { name: "Idioma" }).click();
  await page.getByRole("menuitem", { name: /English/i }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe("en");

  // P-8: no developer-only security wording should leak as an accessible name;
  // the modal close button and bookmark row should have bounded, meaningful
  // names instead of unlabeled/concatenated child controls.
  const jargon = await page.evaluate(() => {
    const observed = (window as Window & { __playtestSecurityLabels?: string[] })
      .__playtestSecurityLabels ?? [];
    const current = Array.from(document.querySelectorAll("[aria-label]"))
      .map((element) => element.getAttribute("aria-label") ?? "")
      .filter((label) => /DEV mode bypass/i.test(label));
    return [...new Set([...observed, ...current])];
  });
  expect.soft(jargon, "P-8: setup indicator must use user-facing language").toEqual([]);
  const rowSnapshot = await page
    .locator('[data-testid="bookmarks-virtual-list"]')
    .ariaSnapshot();
  expect.soft(
    rowSnapshot,
    "P-8: an accessible bookmark row must not use all child actions as its name",
  ).not.toMatch(/button "[^\n]*Playtest regression bookmark[^\n]*(?:Auto-Summarize|Remove tag|Delete)/);

  // P-1(a) + P-8: the lock confirmation must be pointer-reachable and every
  // icon-only button in the dialog must have an accessible name.
  await page.getByRole("button", { name: /Bloquear Bóveda|Lock Vault/i }).click();
  const lockDialog = page.getByRole("dialog");
  const confirm = lockDialog.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeVisible();
  expect.soft(
    await pointerTargets(confirm),
    "P-1: the floating FAB must not intercept the lock confirmation click",
  ).toBe(true);
  const unnamedButtons = await lockDialog.locator("button").evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const label = button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent?.trim();
        return !label;
      })
      .map((button) => button.outerHTML.slice(0, 160)),
  );
  expect.soft(unnamedButtons, "P-8: modal icon-only controls need accessible names").toEqual([]);
  // Deliver the action even on the known pointer-interception defect so the
  // same run can validate wrong-password handling and the reload path.
  await confirm.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.getByTestId("vault-locked-screen")).toBeVisible();

  // P-5/P-6: an ordinary wrong-password attempt should be rejected in the UI
  // without reusing a zeroized buffer or trying to write through a locked key.
  await unlockExpectingError(page, "not-the-regression-test-password");
  expect.soft(
    zeroizationWarnings,
    "P-5: failed unlock must not reuse an already-zeroized password buffer",
  ).toEqual([]);
  expect.soft(
    failedSecretWrites,
    "P-6: failed unlock should not attempt writes with a password-wrapped device key",
  ).toEqual([]);
  await page.getByLabel("Master Password").fill(VAULT_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 60_000 });

  // P-9: a cold reload of an app route must return the app shell (locked screen
  // or unlocked shell), never the marketing landing page.
  await page.reload();
  await expect.soft(
    page.getByTestId("vault-locked-screen").or(page.getByTestId("settings-button")),
    "P-9: a cold app-route reload must render an app shell",
  ).toBeVisible({ timeout: 60_000 });
  await expect.soft(
    page.getByRole("heading", { name: "Everything you save stays on your computer. Everything." }),
    "P-9: a cold app-route reload must not serve the marketing landing",
  ).toHaveCount(0);
});
