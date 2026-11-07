import { expect, test, type Page } from "@playwright/test";
import { expectUnlockedApp, setupVault } from "./vault-helpers";
import { assertDurableBackend } from "./storage-backend-guard";

/**
 * pwa-mobile — emulated-Android (Pixel 7) verification of the two things the
 * desktop batteries cannot prove:
 *
 *   1. The vault KDF resolves the MOBILE Argon2id profile (m = 65536 KiB =
 *      64 MiB, t = 3, p = 1) — the memory-constrained parameters real phones
 *      get (RFC 9106 §4 / ADR-019). Only observable on a PRODUCTION build:
 *      the dev/test server forces the 8 MiB test profile, so this spec runs
 *      against `vite preview` (see playwright.mobile.config.ts). The proof
 *      channel is the diagnostics hook published by publishKdfParams
 *      (src/db/database.ts), gated behind VITE_E2E_KDF_DIAGNOSTICS=true —
 *      never present in real production bundles.
 *
 *   2. The PWA install surface on Android Chrome: web manifest served and
 *      well-formed (standalone display, start_url, icons), the Workbox
 *      service worker registered and activated, and the installability
 *      state machine — the beforeinstallprompt event defers Chrome's
 *      install banner, so the visible install button is stubbed into view
 *      via the same event the browser fires; clicking it must consume the
 *      deferred prompt (prompt() called, userChoice awaited) instead of
 *      crashing or doing nothing.
 *
 * Everything else (vault create, recovery, backup) is engine-covered by the
 * launch-smoke and engines batteries; this profile adds ONLY what is
 * device-shaped: memory profile + installability.
 */

/** Window key set by publishKdfParams (src/db/database.ts). */
const KDF_PARAMS_KEY = "__bmf_active_kdf_params__";

/** The mobile profile's enforced constants (src/utils/argon2-kdf.ts). */
const MOBILE_KDF = { m: 65_536, t: 3, p: 1 };

type KdfParams = { m: number; t: number; p: number };

/** Deferred beforeinstallprompt event, for stubbing installability. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Stub the beforeinstallprompt event the way a real Android Chrome fires it
 * when a site is installable: listener-visible event with prompt()/
 * userChoice. Installs the stub BEFORE any goto (init script) so the app's
 * listener (usePWA.ts) catches it during boot and flips isInstallable —
 * which renders the Header install button (pwa-install-button).
 */
async function stubInstallable(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = globalThis as unknown as {
      __bmfInstallPromptCalled?: boolean;
    };
    state.__bmfInstallPromptCalled = false;
    const makeEvent = () => {
      const synthetic = new Event("beforeinstallprompt", {
        bubbles: false,
        cancelable: true,
      }) as BeforeInstallPromptEvent;
      synthetic.prompt = async () => {
        state.__bmfInstallPromptCalled = true;
      };
      synthetic.userChoice = Promise.resolve({ outcome: "accepted" });
      return synthetic;
    };
    // The app attaches its listener when React mounts (Header effect), which
    // is seconds after document creation — a one-shot dispatch at macrotask 0
    // fires into the void. Re-dispatch FRESH event objects (an Event cannot
    // be dispatched twice) until the app boot window has passed.
    const timer = setInterval(() => {
      window.dispatchEvent(makeEvent());
    }, 600);
    setTimeout(() => clearInterval(timer), 30_000);
  });
}

test.describe("mobile KDF profile (emulated Android, production build)", () => {
  test("creating the vault derives keys with the 64 MiB mobile Argon2id parameters", async ({
    page,
  }) => {
    // Prod build + mobile device descriptor → isMobileDevice() true,
    // isTestMode() false → ARGON2_PARAMS must be ARGON2_PARAMS_MOBILE.
    await setupVault(page, { password: "mobile-smoke-12" });
    await expectUnlockedApp(page);
    await assertDurableBackend(page);

    const params = await page.evaluate(
      (key) =>
        (globalThis as unknown as Record<string, unknown>)[key] as
          | KdfParams
          | undefined,
      KDF_PARAMS_KEY,
    );

    // Fail-closed on the PROOF, not the suspicion: if the diagnostics hook
    // is missing (wrong build flag), this test fails naming the remedy —
    // it must never pass because "the flow completed".
    expect(
      params,
      "KDF diagnostics hook missing — was dist/ built with VITE_E2E_KDF_DIAGNOSTICS=true? (see scripts/run-mobile-smoke.mjs)",
    ).toBeDefined();
    expect(params).toEqual(MOBILE_KDF);
  });
});

test.describe("PWA install surface (emulated Android Chrome)", () => {
  test("the web manifest is served, valid and standalone", async ({
    request,
  }) => {
    const res = await request.get("/manifest.json");
    expect(res.status()).toBe(200);
    const manifest = (await res.json()) as Record<string, unknown>;

    expect(manifest.name).toBe("BookmarkForge");
    expect(manifest.short_name).toBe("BForge");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/app");
    // Chrome requires icons (192px+) and the manifest must declare a scope
    // so the install banner treats the whole origin as the app.
    const icons = manifest.icons as Array<Record<string, unknown>>;
    expect(Array.isArray(icons)).toBe(true);
    expect(icons.length).toBeGreaterThan(0);
    expect(icons.some((i) => String(i.src).includes("192"))).toBe(true);
    // (Manifest linkage from the document is asserted in the UI test below.)
  });

  test("the document links the manifest and the service worker activates", async ({
    page,
    request,
  }) => {
    await page.goto("/");

    // Manifest link present in the served HTML.
    const manifestHref = await page
      .locator('link[rel="manifest"]')
      .getAttribute("href");
    expect(manifestHref, "document must link the web manifest").toBeTruthy();
    const manifestRes = await request.get(manifestHref!);
    expect(manifestRes.status()).toBe(200);

    // Service worker registered, activated and controlling this page —
    // the offline/PWA backbone. Workbox registers sw.js from /. Bounded
    // poll: getRegistration() can resolve while the worker is still
    // registering (all handles null) — a one-shot read races that window.
    const swState = await page.evaluate(async () => {
      for (let i = 0; i < 100; i++) {
        const reg = await navigator.serviceWorker.getRegistration();
        const active = reg?.active ?? null;
        if (reg && active && active.state === "activated") {
          return {
            registered: true,
            scope: reg.scope,
            script: active.scriptURL,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const finalReg = await navigator.serviceWorker.getRegistration();
      return {
        registered: Boolean(finalReg),
        scope: finalReg?.scope ?? null,
        script: finalReg?.active?.scriptURL ?? null,
      };
    });
    expect(swState.registered).toBe(true);
    expect(swState.script).toContain("sw.js");
  });

  test("the install prompt is offered and activating it consumes the deferred prompt", async ({
    page,
  }) => {
    await stubInstallable(page);
    await page.goto("/");

    // The install button lives in the app Header, which mounts only in the
    // main (unlocked) app — create the vault so the Header exists. The app's
    // beforeinstallprompt listener is root-level, so the stub events already
    // fired during setup are what flips isInstallable once Header mounts.
    await setupVault(page);

    // The Header install button renders exactly when the app believes the
    // device is installable (isInstallable from usePWAInstall).
    const installButton = page.getByTestId("pwa-install-button");
    await expect(
      installButton,
      "install button must render once beforeinstallprompt fires",
    ).toBeVisible({ timeout: 30_000 });

    await installButton.click();

    // The click must have called the deferred prompt's prompt() — the real
    // Chrome install dialog — and awaited its outcome.
    const promptCalled = await page.evaluate(
      () =>
        (globalThis as unknown as { __bmfInstallPromptCalled?: boolean })
          .__bmfInstallPromptCalled === true,
    );
    expect(promptCalled).toBe(true);
  });
});
