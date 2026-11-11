#!/usr/bin/env node
/**
 * record-clips.mjs — records real BookmarkForge screen captures with
 * Playwright into video/public/clips/*.webm for the Remotion pipeline.
 *
 * What it does:
 *   1. Starts the Vite dev server in --mode test (fast Argon2id params).
 *   2. Launches a persistent Chromium profile (video/.profile) so the vault
 *      survives between runs — first run records vault setup, later runs
 *      skip straight to the demo clips.
 *   3. Records one .webm per page: unlock, dashboard tour, save bookmark,
 *      search. Each is a separate clip for make-short.mjs.
 *
 * Usage:
 *   node scripts/make-clips.mjs            # from video/
 *   node scripts/make-clips.mjs --keep-server   # leave dev server running
 *
 * Requires: cd video && npm install (playwright is a root devDependency —
 * run `npm install` at the repo root too if @playwright/test is missing).
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIDEO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.join(VIDEO_DIR, "..");
const PORT = Number(process.env.RECORD_PORT ?? 5199);
const BASE = `http://127.0.0.1:${PORT}`;
const PROFILE_DIR = path.join(VIDEO_DIR, ".profile");
const CLIPS_DIR = path.join(VIDEO_DIR, "public", "clips");
const RAW_DIR = path.join(VIDEO_DIR, "raw");
const KEEP_SERVER = process.argv.includes("--keep-server");

const VIEWPORT = { width: 540, height: 960 }; // exact 9:16
const PASSWORD = "recording-pass-2026";
const TEST_URL = "https://en.wikipedia.org/wiki/Local-first_software";
const SEARCH_TERM = "wikipedia";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/app`);
      if (res.ok) return;
    } catch { /* server not up yet */ }
    await sleep(500);
  }
  throw new Error(`dev server did not come up on ${BASE}`);
}

function startDevServer() {
  const child = spawn(
    "npm",
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(PORT), "--mode", "test"],
    { cwd: REPO_ROOT, shell: true, stdio: "ignore" },
  );
  child.unref();
  return child;
}

async function typeHuman(page, selector, text, cps = 18) {
  const loc = page.locator(selector).first();
  await loc.click();
  for (const ch of text) {
    await loc.pressSequentially(ch, { delay: 1000 / cps });
  }
}

async function dismissOverlays(page) {
  // Best-effort: close onboarding / welcome-tour / wizard overlays if present.
  const targets = [
    page.locator('[aria-label*="Skip onboarding" i]').first(),
    page.locator('[aria-label*="Skip tour" i]').first(),
    page.locator('[aria-label*="Close" i]').first(),
  ];
  for (const name of [/skip/i, /got it/i, /done/i, /maybe later/i]) {
    targets.push(page.getByRole("button", { name }).first());
  }
  for (const loc of targets) {
    try {
      if (await loc.isVisible({ timeout: 700 })) {
        await loc.click();
        await sleep(500);
      }
    } catch { /* INTENTIONAL SILENCE: overlay optional */ }
  }
}

async function unlockVault(page) {
  await page.goto(`${BASE}/app`);
  const pw = page.getByLabel("Master Password");
  await pw.waitFor({ state: "visible", timeout: 90_000 });
  await typeHuman(page, 'input[aria-label*="assword" i], input[type="password"]', PASSWORD, 22);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByTestId("settings-button").waitFor({ state: "visible", timeout: 90_000 });
  await sleep(1200);
  await dismissOverlays(page);
}

async function goToBookmarks(page) {
  // Portrait viewport → mobile BottomNav; wider → sidebar. Try both.
  const bottomTab = page.locator('[data-bottom-nav-tab="bookmarks"]').first();
  if (await bottomTab.isVisible({ timeout: 4000 }).catch(() => false)) {
    await bottomTab.click();
  } else {
    await page
      .getByRole("navigation", { name: "Sidebar sections" })
      .getByRole("button", { name: "Bookmarks", exact: true })
      .click();
  }
  await page.getByTestId("search-input").waitFor({ state: "visible", timeout: 30_000 });
}

async function setupVault(page) {
  await page.goto(`${BASE}/app`);
  await page.getByRole("heading", { name: "Secure your vault" }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Set up password" }).click();
  await page.getByRole("heading", { name: "Setup Secure Vault" }).waitFor({ timeout: 30_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("button", { name: "Download Recovery Kit" }).click(),
  ]);
  await download;
  await page.getByRole("checkbox", { name: /safely saved the recovery phrase/i }).check();
  await typeHuman(page, 'input[aria-label*="aster Password" i], input[type="password"]', PASSWORD, 20);
  await page.getByRole("button", { name: "Create Vault" }).click();
  await page.getByTestId("settings-button").waitFor({ state: "visible", timeout: 120_000 });
  await sleep(1500);
  await dismissOverlays(page);
}

async function saveClip(context, name, fn) {
  const page = await context.newPage();
  try {
    await fn(page);
    await sleep(800);
  } finally {
    await page.close();
  }
  const video = page.video();
  if (!video) {
    console.warn(`no video for ${name}`);
    return;
  }
  const src = await video.path();
  const dest = path.join(CLIPS_DIR, `${name}.webm`);
  await copyFile(src, dest);
  console.log(`clip saved: ${name}.webm`);
}

async function main() {
  await mkdir(CLIPS_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });

  let server = null;
  try { await waitForServer(3000); } catch {
    console.log(`starting dev server on :${PORT} (--mode test)`);
    server = startDevServer();
    await waitForServer(90_000);
  }

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    viewport: VIEWPORT,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
    headless: true,
    args: ["--force-device-scale-factor=1"],
  });

  // Pre-accept the GDPR consent banner (same keys the E2E suite seeds) so it
  // does not cover the quick-capture FAB during recording.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("forge_consent_decision_made", "true");
      localStorage.setItem("forge_consent_analytics", "true");
      localStorage.setItem("forge_consent_error_reporting", "true");
      localStorage.setItem("forge_consent_client_events", "true");
      localStorage.setItem("bmf_local_error_storage", "true");
    } catch { /* INTENTIONAL SILENCE: localStorage may be unavailable early */ }
  });

  try {
    // Probe vault state with a throwaway page (its video is tiny and unused).
    // Vite cold-compiles on first hit — wait generously for either screen.
    const probe = await context.newPage();
    await probe.goto(`${BASE}/app`);
    const needsSetup = await probe
      .getByRole("heading", { name: "Secure your vault" })
      .waitFor({ state: "visible", timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    const hasUnlock = !needsSetup && (await probe
      .getByLabel("Master Password")
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => true)
      .catch(() => false));
    await probe.close();

    if (needsSetup) {
      console.log("first run: recording vault setup…");
      await saveClip(context, "vault-setup", setupVault);
    } else if (!hasUnlock) {
      console.log("vault appears already unlocked — continuing");
    } else {
      console.log("vault exists — skipping setup");
    }

    await saveClip(context, "vault-unlock", async (page) => {
      await page.goto(`${BASE}/app`);
      const pw = page.getByLabel("Master Password");
      await pw.waitFor({ state: "visible", timeout: 60_000 });
      await typeHuman(page, 'input[type="password"]', PASSWORD, 26);
      await page.getByRole("button", { name: "Unlock", exact: true }).click();
      await page.getByTestId("settings-button").waitFor({ state: "visible", timeout: 90_000 });
      await sleep(2500); // hold on dashboard for the viewer
    });

    await saveClip(context, "dashboard-tour", async (page) => {
      await unlockVault(page);
      // Slow cinematic scroll through the dashboard.
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, 260);
        await sleep(900);
      }
      await page.mouse.wheel(0, -99999);
      await sleep(1200);
    });

    await saveClip(context, "save-bookmark", async (page) => {
      await unlockVault(page);
      await page.getByTestId("add-bookmark-button").click();
      const input = page.getByTestId("quick-capture-input");
      await input.waitFor({ state: "visible", timeout: 15_000 });
      await typeHuman(page, '[data-testid="quick-capture-input"]', TEST_URL, 24);
      await sleep(600);
      await page.getByTestId("save-bookmark-button").click();
      await sleep(2000); // let the toast / list update land on camera
      // Navigate to the Bookmarks view so the saved item is visible.
      await goToBookmarks(page);
      await sleep(2000);
    });

    await saveClip(context, "settings-security", async (page) => {
      await unlockVault(page);
      await page.getByTestId("settings-button").click();
      await page.getByTestId("settings-security").waitFor({ state: "visible", timeout: 30_000 });
      // Cinematic scroll through the security/storage sections.
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 300);
        await sleep(1000);
      }
    });

    await saveClip(context, "import-dialog", async (page) => {
      await unlockVault(page);
      // Dashboard header "Open Importer" → ImportDialog (Pocket/CSV/Notion).
      const importerBtn = page.getByRole("button", { name: /open importer/i }).first();
      await importerBtn.waitFor({ state: "visible", timeout: 15_000 });
      await importerBtn.click();
      await page.locator('[aria-labelledby="import-dialog-title"]').waitFor({ state: "visible", timeout: 20_000 });
      await sleep(2500); // hold on the import dialog
      const closeBtn = page.locator('[aria-label*="Close" i]').first();
      if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await closeBtn.click();
      }
      await sleep(800);
    });

    await saveClip(context, "documents-view", async (page) => {
      await unlockVault(page);
      const tab = page.locator('[data-bottom-nav-tab="documents"]').first();
      if (await tab.isVisible({ timeout: 5000 }).catch(() => false)) {
        await tab.click();
      } else {
        await page
          .getByRole("navigation", { name: "Sidebar sections" })
          .getByRole("button", { name: /documents/i })
          .first()
          .click();
      }
      await sleep(2000);
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 300);
        await sleep(900);
      }
    });

    await saveClip(context, "create-document", async (page) => {
      await unlockVault(page);
      const tab = page.locator('[data-bottom-nav-tab="documents"]').first();
      if (await tab.isVisible({ timeout: 5000 }).catch(() => false)) {
        await tab.click();
      }
      await page.getByTestId("new-document-button").click();
      await sleep(1500);
      // Type into the editor (contenteditable or textarea).
      const editor = page.locator('[contenteditable="true"], textarea').first();
      await editor.click().catch(async () => {
        await page.keyboard.press("Tab");
      });
      const lines = [
        "Reading list — Q4",
        "",
        "Articles on local-first software and encrypted storage.",
        "Review weekly, archive what I finished.",
      ];
      for (const line of lines) {
        await page.keyboard.type(line, { delay: 28 });
        await page.keyboard.press("Enter");
        await sleep(250);
      }
      await sleep(1500);
    });

    await saveClip(context, "multi-save", async (page) => {
      await unlockVault(page);
      const urls = [
        "https://example.com/article-on-privacy",
        "https://dev.to/local-first-patterns",
        "https://en.wikipedia.org/wiki/End-to-end_encryption",
      ];
      for (const url of urls) {
        await page.getByTestId("add-bookmark-button").click();
        const input = page.getByTestId("quick-capture-input");
        await input.waitFor({ state: "visible", timeout: 15_000 });
        await typeHuman(page, '[data-testid="quick-capture-input"]', url, 30);
        await sleep(400);
        await page.getByTestId("save-bookmark-button").click();
        // Wait for the capture modal to fully close before the next save.
        await page
          .getByTestId("close-quick-capture-button")
          .waitFor({ state: "hidden", timeout: 60_000 })
          .catch(() => sleep(1500));
        await sleep(600);
      }
      await goToBookmarks(page);
      await sleep(2000);
    });

    await saveClip(context, "chat-local", async (page) => {
      await unlockVault(page);
      const tab = page.locator('[data-bottom-nav-tab="chatLocal"]').first();
      if (await tab.isVisible({ timeout: 5000 }).catch(() => false)) {
        await tab.click();
      }
      await sleep(1500);
      const input = page.locator('textarea, input[type="text"], [contenteditable="true"]').last();
      await input.click().catch(() => {});
      await page.keyboard.type("Summarize my reading list", { delay: 45 });
      await sleep(400);
      await page.keyboard.press("Enter");
      await sleep(5000); // let the local response stream on camera
    });

    await saveClip(context, "search", async (page) => {
      await unlockVault(page);
      await goToBookmarks(page);
      const search = page.getByTestId("search-input");
      await search.click();
      await typeHuman(page, '[data-testid="search-input"]', SEARCH_TERM, 20);
      await sleep(1800);
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Backspace");
      await sleep(800);
    });
  } finally {
    await context.close();
    if (server && !KEEP_SERVER) server.kill();
  }

  console.log(`done — clips in ${path.relative(REPO_ROOT, CLIPS_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
