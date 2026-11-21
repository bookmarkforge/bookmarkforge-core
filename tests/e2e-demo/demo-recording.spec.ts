import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  VAULT_PASSWORD,
  dismissOverlays,
  expectUnlockedApp,
  setupVault,
  unlockVault,
} from "../e2e/vault-helpers";

/**
 * Product-demo recorder — NOT an assertion suite.
 *
 * Runs against `playwright.demo.config.ts` (`npm run demo:record`). The flow:
 *
 *   page 1 (setup.webm — discarded): seeds a real vault through the normal
 *     onboarding and captures a few bookmarks, so the demo never shows vault
 *     creation.
 *   page 2 (demo.webm — the keeper): same browser context, so IndexedDB is
 *     shared. It boots straight into the locked screen, unlocks with the
 *     password, and walks the main surfaces with human pacing.
 *
 * A fake cursor is injected so the .webm shows a pointer (Playwright's raw
 * screencast does not render one). Convert webm -> mp4 afterwards; see
 * AGENTS/docs or `npm run demo:record` output for the ffmpeg hint.
 */

const OUT_DIR = path.resolve("demo-output");

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Visible pointer for the recording: follows real mousemove events. */
async function injectFakeCursor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.style.cssText =
      "position:fixed;left:0;top:0;width:18px;height:18px;z-index:2147483647;" +
      "pointer-events:none;border-radius:50%;background:rgba(34,211,238,.85);" +
      "border:2px solid #fff;box-shadow:0 0 8px rgba(34,211,238,.9);" +
      "transform:translate(-50%,-50%);transition:transform .12s ease-out;";
    const mount = () => {
      if (document.body && !document.getElementById("demo-cursor")) {
        document.body.appendChild(cursor);
      } else if (document.getElementById("demo-cursor") !== cursor) {
        document.body.appendChild(cursor);
      }
    };
    document.addEventListener("mousemove", (e) => {
      mount();
      const el = document.getElementById("demo-cursor");
      if (el) {
        el.style.left = `${e.clientX}px`;
        el.style.top = `${e.clientY}px`;
      }
    });
    document.addEventListener("mousedown", () => {
      mount();
      const el = document.getElementById("demo-cursor");
      if (el) {
        el.style.transform = "translate(-50%,-50%) scale(1.6)";
        setTimeout(() => {
          el.style.transform = "translate(-50%,-50%)";
        }, 120);
      }
    });
  });
}

/** Capture a bookmark through the QuickCapture UI (same path as launch-smoke). */
async function addBookmarkViaUi(
  page: Page,
  url: string,
  title: string,
): Promise<void> {
  await page.getByTestId("add-bookmark-button").click();
  const input = page.getByTestId("quick-capture-input");
  await expect(input).toBeVisible();
  await input.fill(url);
  await page.getByTestId("bookmark-title-input").fill(title);
  await page.getByTestId("save-bookmark-button").click();
  await expect(page.getByTestId("close-quick-capture-button")).toBeHidden({
    timeout: 60_000,
  });
}

/** Click a sidebar section by its visible label; never fails the recording. */
async function tourSection(page: Page, name: RegExp): Promise<void> {
  const button = page
    .getByRole("navigation", { name: "Sidebar sections" })
    .getByRole("button", { name })
    .first();
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await pause(2200);
    // Gentle scroll so the view reads as alive, not frozen.
    await page.mouse.wheel(0, 350);
    await pause(1400);
    await page.mouse.wheel(0, -350);
    await pause(800);
  }
}

test("record product demo", async ({ page, context }) => {
  test.setTimeout(360_000);
  mkdirSync(OUT_DIR, { recursive: true });

  // ---- PAGE 1: seed the vault (its video is discarded) --------------------
  await setupVault(page, { password: VAULT_PASSWORD });
  await addBookmarkViaUi(
    page,
    "https://en.wikipedia.org/wiki/AES_encryption",
    "AES encryption — how it works",
  );
  await addBookmarkViaUi(
    page,
    "https://www.eff.org/deeplinks/2024/01/guide-victor-victor",
    "Surveillance self-defense guide",
  );
  await addBookmarkViaUi(
    page,
    "https://arxiv.org/abs/2005.11401",
    "RAG paper — retrieval augmented generation",
  );
  await dismissOverlays(page);
  await page.close();
  const setupVideo = page.video();
  if (setupVideo) {
    await setupVideo.saveAs(path.join(OUT_DIR, "setup.webm"));
  }

  // ---- PAGE 2: the demo itself --------------------------------------------
  const demo = await context.newPage();
  await injectFakeCursor(demo);
  await demo.goto("/app");

  // Locked screen -> unlock with the master password (shows the security UX).
  await expect(demo.getByLabel("Master Password")).toBeVisible({
    timeout: 60_000,
  });
  await pause(1500);
  await unlockVault(demo, VAULT_PASSWORD);
  await expectUnlockedApp(demo);
  await dismissOverlays(demo);
  await pause(2500);

  // Dashboard: let it breathe, gentle scroll.
  await demo.mouse.wheel(0, 300);
  await pause(1600);
  await demo.mouse.wheel(0, -300);
  await pause(1200);

  // Bookmarks: show the seeded rows, then live search filtering.
  await tourSection(demo, /bookmarks/i);
  const search = demo.getByTestId("search-input");
  if (await search.isVisible().catch(() => false)) {
    await search.click();
    await search.pressSequentially("AES", { delay: 140 });
    await pause(2200);
    await search.fill("");
    await pause(900);
  }

  // Capture flow again, on camera this time.
  await addBookmarkViaUi(
    demo,
    "https://blog.cloudflare.com/radar/",
    "Cloudflare Radar — internet traffic trends",
  );
  await pause(1200);

  // View tour: the different ways to look at the same vault.
  for (const name of [
    /database/i,
    /calendar/i,
    /kanban/i,
    /gallery/i,
    /timeline/i,
  ]) {
    await tourSection(demo, name);
  }

  // Settings: a quick look at the configuration surface.
  const settingsButton = demo.getByTestId("settings-button");
  if (await settingsButton.isVisible().catch(() => false)) {
    await settingsButton.click();
    await pause(2500);
    await demo.mouse.wheel(0, 400);
    await pause(1500);
    await demo.mouse.wheel(0, -400);
    await pause(800);
  }

  // Back to the dashboard for the close.
  await tourSection(demo, /dashboard|home/i);
  await pause(3000);

  await demo.close();
  const demoVideo = demo.video();
  if (demoVideo) {
    await demoVideo.saveAs(path.join(OUT_DIR, "demo.webm"));
  }
});
