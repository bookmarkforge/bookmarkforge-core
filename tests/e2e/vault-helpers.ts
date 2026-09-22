import { expect, type ConsoleMessage, type Locator, type Page } from "@playwright/test";
import { humanE2E } from "./human-behavior";
import { assertDurableBackend } from "./storage-backend-guard";

/**
 * Shared helpers for the vault e2e suite (tests/e2e).
 *
 * The suite runs against a dedicated Vite `--mode test` server with
 * VITE_FORCE_DEXIE_STORAGE=true (see playwright.config.ts), so persistence
 * and password-rotation specs exercise the durable IndexedDB backend. Each
 * browser context starts clean: SecurityConfirmation is the first screen.
 *
 * Interactions are routed through the humanE2E facade (see
 * ./human-behavior.ts): locally the flows move/type like a human, while CI
 * runs the same plain Playwright actions as before.
 */

export const VAULT_PASSWORD = "correct-horse-42";

/**
 * Environment-aware timeout multiplier. Slow CI runners and local VMs need
 * larger budgets for KDF operations. Set E2E_TIMEOUT_MULTIPLIER=N to
 * override (e.g. 2 doubles every timeout).
 */
const multiplier =
  Number(process.env.E2E_TIMEOUT_MULTIPLIER) ||
  (process.env.CI ? 1 : 1);
function scaled(ms: number): number {
  return Math.round(ms * multiplier);
}

/** Default timeout for vault KDF-dependent waits (e.g. setupVault). */
const VAULT_SHELL_TIMEOUT = scaled(60_000);

/**
 * Cross-browser safe reload. Firefox occasionally interprets page.reload()
 * as a download when a PWA service worker is registered, throwing
 * "Download is starting". This helper catches that and falls back to a
 * direct navigation to the current URL.
 */
export async function safeReload(page: Page): Promise<void> {
  try {
    await page.reload({ timeout: 10_000 });
  } catch {
    await page.goto(page.url());
  }
}

/** Stable selector that only exists inside the unlocked MainApp shell. */
export async function expectUnlockedApp(
  page: Page,
  diagnostics: string[] = [],
  timeoutMs: number = VAULT_SHELL_TIMEOUT,
): Promise<void> {
  try {
    await page
      .getByTestId("settings-button")
      .waitFor({ state: "visible", timeout: timeoutMs });
  } catch (error) {
    if (diagnostics.length) {
      throw new Error(
        `Vault did not reach the unlocked shell. App errors:\n${diagnostics.join("\n")}`,
        { cause: error },
      );
    }
    throw error;
  }

  // The unlocked shell only renders after the DB is ready, so this is the
  // right place to reject a run that booted on in-memory storage (a reused
  // plain `npm run dev` server). Persistence/reload specs would otherwise
  // assert against a backend production never uses.
  await assertDurableBackend(page, diagnostics);
}

/**
 * Click an overlay-dismiss button, retrying when the page's main thread is
 * too busy to complete Playwright's hit-target checks within one attempt.
 *
 * Observed flake (vault-sync-real, parallel workers): the "Skip onboarding"
 * button resolved, was visible and stable, but the click still timed out —
 * parallel browser contexts running Argon2id KDF starve the main thread, so
 * a single 5 s unscaled attempt was a coin flip. Each retry re-checks
 * visibility first (a prior attempt or the Escape below may have closed the
 * overlay already) and presses Escape between attempts, which dismisses both
 * the onboarding dialog and the WelcomeTour.
 *
 * noWaitAfter: these are soft UI dismissals, but Playwright's default
 * post-click nav-wait can hang on "scheduled navigations" under load. The
 * overlay's disappearance is asserted by callers / expectUnlockedApp.
 */
async function dismissWithRetry(
  page: Page,
  button: Locator,
  attempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!(await button.isVisible().catch(() => false))) {
      return; // overlay already gone — nothing to dismiss
    }
    try {
      await button.click({ timeout: scaled(10_000), noWaitAfter: true });
      return;
    } catch {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  // Final unguarded attempt: if the overlay truly cannot be dismissed the
  // test must fail here with the click's own error, not downstream.
  await button.click({ timeout: scaled(10_000), noWaitAfter: true });
}

/**
 * Dismiss the Onboarding wizard (and any WelcomeTour overlay) via Escape.
 *
 * Every surface this function clears is REGISTERED in
 * scripts/check-e2e-fixture-neutralization.mjs. A spec whose subject is one of
 * them (onboarding wizard, WelcomeTour, backup reminder banner, QuickTips) must
 * preserve it through the documenting option below, or declare a reasoned
 * `// fixture-neutralization-waiver:` — `npm run check` fails otherwise. Adding
 * a dismissal here without registering the surface fails that same gate, so the
 * neutralized set cannot grow behind the specs' backs.
 */
export async function dismissOverlays(
  page: Page,
  options: { keepBackupNotice?: boolean } = {},
): Promise<void> {
  const human = humanE2E(page);
  // Most callers invoke this immediately after the shell is visible. The
  // settings button can also be visible *behind* an onboarding overlay, so
  // use the overlay's own selectors rather than the shell as the fast path.
  const onboarding = page.locator(
    '[aria-labelledby="onboarding-dialog-title"]',
  );
  const skipTour = page.getByRole("button", { name: /skip tour/i });
  const backupDismiss = page.getByRole("button", {
    name: "Got it, remind me later",
  });
  const tipDismiss = page.getByRole("button", { name: "Dismiss tip" });
  // `keepBackupNotice` is for specs whose SUBJECT is the backup banner
  // (dashboard-banner-cls measures its reveal): clicking "Got it, remind me
  // later" is not clearing an overlay, it is a state change on the thing being
  // measured — it writes the 48 h snooze (BACKUP_BANNER_DISMISSED_UNTIL) that
  // makes shouldShowBackupBanner() false, so the banner never reveals again and
  // the measurement collapses to zero. With the flag, the banner is neither
  // counted as a blocking overlay nor dismissed.
  const overlayVisible =
    (await onboarding.isVisible().catch(() => false)) ||
    (await skipTour.isVisible().catch(() => false)) ||
    (!options.keepBackupNotice &&
      (await backupDismiss.isVisible().catch(() => false))) ||
    (await tipDismiss.isVisible().catch(() => false));
  if (!overlayVisible) {
    return;
  }

  // Dismiss the blocking onboarding dialog before touching dashboard notices;
  // its backdrop intentionally intercepts pointer events behind it.
  const skipOnboarding = page.getByRole("button", {
    name: "Skip onboarding",
  });
  await dismissWithRetry(page, skipOnboarding);
  await dismissWithRetry(page, skipTour);

  // These are dismissible dashboard notices rather than modal overlays. Clear
  // them explicitly so they cannot cover the first keyboard/click interaction
  // in a later human-like flow.
  // These notice buttons can be transient (a toast/tip that auto-dismisses
  // or detaches between the visibility check and the action). Previously each
  // .evaluate(click()) carried a 30s default timeout, so a toast that vanished
  // after isVisible() hung the whole suite on a bounded 3s instead. A
  // transient disappearance is non-fatal — these are just dismissible notices.
  const dashboardNotices = options.keepBackupNotice
    ? [tipDismiss]
    : [backupDismiss, tipDismiss];
  for (const notice of dashboardNotices) {
    if (await notice.isVisible().catch(() => false)) {
      await notice
        .evaluate(
          (b) => (b as HTMLButtonElement).click(),
          { timeout: 3_000 },
        )
        .catch(() => {
          /* element detached/dismissed before the forced click — fine */
        });
    }
  }

  for (let i = 0; i < 3; i += 1) {
    await human.press("Escape");
    await page.waitForTimeout(150);
    if (await page.getByTestId("settings-button").isVisible().catch(() => false)) {
      return;
    }
  }
  // Fall back to clicking the onboarding skip button if focus never reached it.
  const skip = page.getByRole("button", { name: "Skip onboarding" });
  if (await skip.isVisible().catch(() => false)) {
    await human.click(skip);
  }
  await expectUnlockedApp(page);
}

/**
 * Complete the first-time vault setup flow: confirmation → recovery kit →
 * confirm checkbox → master password → Create Vault. Ends unlocked with
 * onboarding dismissed.
 *
 * `password` overrides the shared VAULT_PASSWORD (launch-smoke uses a
 * 12-character one to mirror SECURITY_CONFIG.MIN_PASSWORD_LENGTH through the
 * real UI gate). `onRecoveryPhrase` receives the exact 24-word phrase the
 * setup screen displayed — launch-smoke's round-trip recovery depends on it
 * being the phrase the UI actually showed, not a side-channel value.
 */
export async function setupVault(
  page: Page,
  options: {
    dismissOnboarding?: boolean;
    /**
     * Keep the dashboard's backup reminder banner up (see
     * `dismissOverlays`): the specs that MEASURE the banner — its reveal CLS
     * cost (dashboard-banner-cls, ADR-055) — must not have the setup path
     * snooze it for 48 h before their first assertion. Every other caller
     * wants the notices cleared so they cannot cover later interactions.
     */
    keepBackupNotice?: boolean;
    password?: string;
    onRecoveryPhrase?: (phrase: string) => void;
  } = {},
): Promise<void> {
  // Playwright does not auto-navigate; every spec must land on the app first.
  await page.goto("/");
  const human = humanE2E(page);

  // Collect app-side events so a vault-setup failure reports the ROOT cause:
  // the UI only shows a generic "Error setting up the vault." fallback for
  // non-classified errors, which hides e.g. the device-key / firewall / KDF
  // failures observed under parallel load. Errors AND warns are captured
  // (the nuking event is often a warn) with a timestamp, newest-first.
  const appErrors: string[] = [];
  const note = (kind: string, text: string): void => {
    appErrors.push(`[${kind}] ${new Date().toISOString().slice(11, 23)} ${text.slice(0, 300)}`);
    if (appErrors.length > 30) {appErrors.shift();}
  };
  const onConsole = (msg: ConsoleMessage): void => {
    if (msg.type() === "error" || msg.type() === "warning") {
      note(msg.type() === "error" ? "console.error" : "console.warn", msg.text());
    }
  };
  const onPageError = (err: Error): void => {
    note("pageerror", err.message);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  try {

  // SecurityConfirmation is the first screen on a pristine context.
  await expect(
    page.getByRole("heading", { name: "Secure your vault" }),
  ).toBeVisible({ timeout: VAULT_SHELL_TIMEOUT });
  await human.click(page.getByRole("button", { name: "Set up password" }));

  // SecurityManager first-time setup screen.
  await expect(
    page.getByRole("heading", { name: "Setup Secure Vault" }),
  ).toBeVisible({ timeout: VAULT_SHELL_TIMEOUT });

  // Recovery kit download unlocks the confirmation checkbox.
  const download = page.waitForEvent("download");
  await human.click(page.getByRole("button", { name: "Download Recovery Kit" }));
  await download;

  const confirmCheckbox = page.getByRole("checkbox", {
    name: "I have safely saved the recovery phrase",
  });
  await expect(confirmCheckbox).toBeEnabled({ timeout: scaled(10_000) });
  await human.check(confirmCheckbox);

  if (options.onRecoveryPhrase) {
    // The setup screen renders the live phrase in the font-mono paragraph
    // under the recovery-phrase label. textContent() over innerText(): keeps
    // words separated even when the box wraps/scrolls, and reads the same
    // node the user would read or copy.
    const phraseText =
      (await page
        .locator("p.font-mono.break-all")
        .first()
        .textContent()) ?? "";
    options.onRecoveryPhrase(phraseText.trim());
  }

  await human.type(
    page.getByLabel("Master Password"),
    options.password ?? VAULT_PASSWORD,
  );
  await human.click(page.getByRole("button", { name: "Create Vault" }));

  // The unlock happens right after DB init; MainApp + onboarding render.
  // Watch for BOTH outcomes — the unlocked shell (success) or the setup
  // error banner (failure) — and surface the app's root error instead of
  // a bare 30s timeout when the flow fails.
  const settingsButton = page.getByTestId("settings-button");
  const setupErrorBanner = page.locator(".security-error-in");
  try {
    await Promise.race([
      settingsButton.waitFor({ state: "visible", timeout: VAULT_SHELL_TIMEOUT }),
      setupErrorBanner.waitFor({ state: "visible", timeout: VAULT_SHELL_TIMEOUT }).then(
        async () => {
          const bannerText = (await setupErrorBanner.textContent()) ?? "";
          throw new Error(
            `Vault setup failed. UI: "${bannerText}"` +
              (appErrors.length
                ? `\nApp errors:\n${appErrors.join("\n")}`
                : ""),
          );
        },
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Vault setup failed")) {
      throw error;
    }
    throw new Error(
      `Vault setup timed out reaching the unlocked shell` +
        (appErrors.length ? `\nApp events:\n${appErrors.join("\n")}` : ""),
      { cause: error },
    );
  }
  // The vault is created (DB initialized) even while the F0-2 recovery
  // wizard is open — reject a wrong-mode (Memory) server before any
  // persistence assertion can run against a backend production never uses.
  await assertDurableBackend(page, appErrors);
  // The F0-2 recovery wizard mounts right after "Create Vault" on an empty
  // vault; callers that want to exercise that restore-first screen keep the
  // overlay instead of auto-dismissing it.
  if (options.dismissOnboarding !== false) {
    await dismissOverlays(page, {
      keepBackupNotice: options.keepBackupNotice,
    });
  }
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}

/** Skip the password entirely (SecurityConfirmation → unlocked app). */
export async function skipPassword(page: Page): Promise<void> {
  const human = humanE2E(page);
  // Pre-seed overlay state before the app boots (same convention as the
  // text-fit/visual suites): WelcomeTour is a lazy chunk that can mount
  // after the onboarding skip and shows itself ~800ms later, racing the
  // test flow and intercepting the next interaction with its backdrop.
  // Marking it complete in localStorage is deterministic and survives Vite
  // full-reloads.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("forge_welcome_tour_complete", "true");
    } catch {
      /* ignore */
    }
  });
  await page.goto("/");
  const securityDialog = page.locator(
    '[aria-labelledby="security-confirmation-title"]',
  );
  const skipButton = securityDialog.getByRole("button").last();
  const settingsButton = page.getByTestId("settings-button");

  // A reused dev-server/browser session may already be unlocked. Wait for
  // either valid startup state instead of assuming the security dialog wins
  // the first render; pristine contexts still take the skip path below.
  await expect(settingsButton.or(securityDialog)).toBeVisible({
    timeout: 30_000,
  });
  if (!(await securityDialog.isVisible().catch(() => false))) {
    await expectUnlockedApp(page);
    await dismissOverlays(page);
    return;
  }

  // The in-memory skip flag is lost on a page reload (e.g. a Vite dev
  // full-reload under load), which drops the app back on SecurityConfirmation
  // mid-fixture. Retry the skip instead of failing the whole suite on a
  // dev-server hiccup; the per-attempt budgets keep the total under the
  // human-like suite's 90s timeout even on the pathological path.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(securityDialog).toBeVisible({
      timeout: attempt === 0 ? 20_000 : 8_000,
    });
    // Use the dialog structure rather than translated button labels so this
    // helper works for every locale in the text-fit matrix.
    await human.click(skipButton);
    try {
      await expect(settingsButton).toBeVisible({ timeout: 10_000 });
      // The skip succeeded → the DB initialized. Reject a Memory backend
      // before any persistence assertion can run against it.
      await assertDurableBackend(page);
      await dismissOverlays(page);
      return;
    } catch {
      // A skip can complete while the shell is still mounting. If the dialog
      // has gone away, wait for the shell rather than retrying a locator that
      // can no longer exist; only repeat when the dialog genuinely reappears.
      if (!(await securityDialog.isVisible().catch(() => false))) {
        await expectUnlockedApp(page);
        await dismissOverlays(page);
        return;
      }
      // The dialog reappeared (reload); loop and skip again.
    }
  }

  await expectUnlockedApp(page);
  await dismissOverlays(page);
}

/** Lock the vault through the Header lock button and its accessible modal. */
export async function lockVault(page: Page): Promise<void> {
  const human = humanE2E(page);
  await human.click(page.getByRole("button", { name: "Lock Vault" }));
  // Header uses Mantine's accessible Modal (not a native browser dialog).
  // Accepting `page.once("dialog")` would never dismiss it, leaving the
  // authenticated shell mounted and making the following lock assertion time
  // out.
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeVisible();
  // Mantine's animated modal can briefly report a transformed button outside
  // the viewport while the floating QuickCapture control is still settling.
  // The accessible target is already uniquely resolved and visible, so force
  // the click after the visibility assertion instead of waiting 60s on an
  // irrelevant pointer-interception race.
  // Invoke the accessible button directly. This avoids a rare pointer
  // interception race while Mantine animates the modal and guarantees the
  // React onClick handler is delivered exactly once.
  await confirm.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.getByTestId("vault-locked-screen")).toBeVisible({
    timeout: VAULT_SHELL_TIMEOUT,
  });
}

/**
 * Unlock the locked vault through the UI with the given password (defaults
 * to VAULT_PASSWORD). Precondition: the "Vault is locked." screen is visible
 * (e.g. after `lockVault`, or after a reload with the lock flag persisted).
 *
 * `observe` runs while initDB() is still in flight — i.e. AFTER the Unlock
 * click but BEFORE the shell mounts. That window is where schema-migration
 * / vault-open progress overlays live (the migration runs inside the
 * unlock flow, before `isLocked` flips), so specs that must assert on a
 * transient progress screen pass a callback here instead of re-implementing
 * the unlock sequence. The callback may throw; its error surfaces as the
 * test failure. A no-op observe keeps the plain-unlock behaviour.
 */
export async function unlockVaultObserving(
  page: Page,
  observe: () => Promise<void>,
  password: string = VAULT_PASSWORD,
  opts: { shellTimeoutMs?: number } = {},
): Promise<void> {
  const human = humanE2E(page);
  await human.type(page.getByLabel("Master Password"), password);
  await human.click(page.getByRole("button", { name: "Unlock" }));
  await observe();
  // Slow engines (WebKit) rewrite encrypted rows several times slower than
  // Chromium; specs that just observed a long migration pass a larger
  // shell budget here instead of hitting the 30s default mid-migration.
  await expectUnlockedApp(page, [], opts.shellTimeoutMs);
}

/** Unlock the locked vault and wait for the shell (no observation). */
export async function unlockVault(
  page: Page,
  password = VAULT_PASSWORD,
): Promise<void> {
  await unlockVaultObserving(page, async () => {}, password);
}

/** Attempt to unlock with the given password and expect an error banner. */
export async function unlockExpectingError(
  page: Page,
  password: string,
  errorText = "Invalid password. Please try again.",
): Promise<void> {
  const human = humanE2E(page);
  await human.type(page.getByLabel("Master Password"), password);
  await human.click(page.getByRole("button", { name: "Unlock" }));
  await expect(
    page.getByText(errorText, { exact: true }),
  ).toBeVisible({ timeout: VAULT_SHELL_TIMEOUT });
}

/**
 * After a reload, the vault is locked again (localStorage flag persists) —
 * unlock with the given password and wait for the app shell.
 */
export async function unlockAfterReload(
  page: Page,
  password: string,
): Promise<void> {
  await expect(page.getByTestId("vault-locked-screen")).toBeVisible({
    timeout: VAULT_SHELL_TIMEOUT,
  });
  await unlockVault(page, password);
}

/**
 * Start RxDB WebRTC replication for one room, through the same entry point the
 * collaboration UI uses (`CollaborationService.start` →
 * `syncService.startP2PSync`).
 *
 * Shared by every sync spec (the multiuser suite and the public-relay suite):
 * the two differ in how the app is CONFIGURED (self-hosted server vs public
 * relay), not in how a room is joined.
 */
export async function startP2PSync(
  page: Page,
  roomId: string,
  roomSecret: string,
): Promise<void> {
  await page.evaluate(
    async ({ roomId, roomSecret }) => {
      const { initDB } = await import("/src/db/database.ts");
      const db = await initDB();
      const { syncService } = await import("/src/services/SyncService.ts");
      await syncService.startP2PSync(db, roomId, roomSecret);
    },
    { roomId, roomSecret },
  );
}

/**
 * Derive the keyed signaling room name the client actually joins (A-2), using
 * the app's own derivation from inside the page rather than a duplicated copy
 * of the HMAC — a copy that could silently drift from what the client sends.
 */
export async function readSyncTopic(
  page: Page,
  roomId: string,
  roomSecret: string,
  collectionName: string,
): Promise<string> {
  return page.evaluate(
    async ({ roomId, roomSecret, collectionName }) => {
      const { deriveSyncTopic } = await import("/src/services/SyncService.ts");
      return deriveSyncTopic(roomSecret, roomId, collectionName);
    },
    { roomId, roomSecret, collectionName },
  );
}

/**
 * Reads the per-vault Argon2id KDF salt a stored record was WRITTEN with,
 * straight out of its ciphertext: a `v6:` payload embeds the 16-byte salt in
 * its header, so the derivation the app actually used is observable from the
 * bytes without reaching into app internals.
 *
 * Works for records stored raw (the H5 verification token, which is
 * password-encrypted only and stays readable while the vault is locked) as well
 * as for probe writes performed by a spec.
 *
 * @returns the salt as 32 hex chars, or null when the record is
 *   missing/legacy (`v5:`/`v4:` carry no vault salt).
 */
export async function readVaultKdfSaltFromSecret(
  page: Page,
  key: string,
): Promise<string | null> {
  return await page.evaluate(async ({ key }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bookmarkforge_secure_vault");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains("secrets")) {return null;}
      const record = await new Promise<{ value?: unknown } | undefined>(
        (resolve, reject) => {
          const transaction = db.transaction(["secrets"], "readonly");
          const request = transaction.objectStore("secrets").get(key);
          request.onsuccess = () =>
            resolve(request.result as { value?: unknown } | undefined);
          request.onerror = () => reject(request.error);
        },
      );
      const value = record?.value;
      if (typeof value !== "string" || !value.startsWith("v6:")) {return null;}
      const bytes = Uint8Array.from(atob(value.slice(3)), (character) =>
        character.charCodeAt(0),
      );
      return Array.from(bytes.subarray(0, 16), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    } finally {
      db.close();
    }
  }, { key });
}

/** The vault's salt as embedded in the H5 verification token ciphertext. */
export const VAULT_VERIFICATION_KEY = "vault_verification";

export async function readVaultKdfSaltFromToken(
  page: Page,
): Promise<string | null> {
  return await readVaultKdfSaltFromSecret(page, VAULT_VERIFICATION_KEY);
}

/**
 * The salt INSTALLED in this tab's crypto layer (module state), which is what
 * its next write will be keyed with. Distinct from the stored salt on purpose:
 * the gap between the two is exactly the multi-tab window A-1 closes.
 */
export async function readInstalledVaultKdfSalt(
  page: Page,
): Promise<string | null> {
  return await page.evaluate(async () => {
    const { encryptionService } = await import(
      "/src/services/EncryptionService.ts"
    );
    return encryptionService.getVaultKdfSaltHex();
  });
}

/**
 * Performs a REAL vault write (a password-encrypted payload persisted through
 * `securityVault.encryptSecret`) and returns the salt that write was keyed
 * with, read out of the returned `v6:` ciphertext.
 *
 * This is the observable behind "the tab stopped writing under the retired
 * salt": the payload embeds the salt it was encrypted with, so what the tab is
 * actually using is what the caller sees — not what some internal getter
 * claims. `readVaultKdfSaltFromSecret` cannot serve here because
 * `SecureStorage.setSecret` wraps the payload in the device-key layer before
 * persisting it (`rawPut` of `encryptValue(payload)`), leaving only records
 * written raw — the H5 verification token — readable as `v6:` in IndexedDB.
 *
 * @returns the salt as 32 hex chars, or null when the payload is legacy
 *   (`v5:`/`v4:` carry no vault salt).
 */
export async function writeVaultProbeSecret(
  page: Page,
  key: string,
  value = "e2e-kdf-probe",
): Promise<string | null> {
  return await page.evaluate(
    async ({ key, value }) => {
      const { securityVault } = await import("/src/services/SecurityVault.ts");
      const payload = await securityVault.encryptSecret(value, key);
      if (!payload.startsWith("v6:")) {return null;}
      const bytes = Uint8Array.from(atob(payload.slice(3)), (character) =>
        character.charCodeAt(0),
      );
      return Array.from(bytes.subarray(0, 16), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
    { key, value },
  );
}
