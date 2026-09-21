#!/usr/bin/env node
/**
 * Record the README demo tour as a WebM video.
 *
 * Why a video at all: the GIF in `docs/` is 6 frames at 640px because GIF has
 * no inter-frame compression and a 256-colour palette. The same tour rendered
 * as VP8 WebM keeps full colour, 1280×720 text and real motion at a fraction of
 * the bits. The recording is produced by Playwright itself (the bundled ffmpeg
 * `recordVideo` already uses for every trace/video artifact), so no new
 * dependency, no system ffmpeg and no GPU are required.
 *
 * Two pages, on purpose:
 *
 *   page 1 — creates the demo vault and compiles every lazy route, OFF camera;
 *   page 2 — the only recording kept: it starts on the locked vault, unlocks it
 *            and shows the product being used.
 *
 * Vault creation is Argon2id-bound and measured at ~14 s on the ARM machine
 * this asset was produced on (~7 s just to unlock). Paying that cost once
 * inside the published video would triple its length without showing anything
 * about the product, so it happens on the discarded page. The steps that
 * remain come from `scripts/demo-tour-flow.mjs`, the same module the
 * screenshots use, so the video can never show a different flow than the
 * stills.
 *
 * Usage:
 *   node scripts/capture-demo-tour.mjs --base-url http://127.0.0.1:5199
 *   node scripts/capture-demo-tour.mjs --base-url http://127.0.0.1:5199 --out /tmp/tour.webm
 */
import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import {
  DEMO_BOOKMARKS,
  RAW_TOUR_PATH,
  SHELL_TIMEOUT,
  addBookmark,
  dismissOverlays,
  dismissPrivacyConsent,
  dismissWelcomeTour,
  fillQuickCapture,
  freezeDemoClock,
  gotoBookmarks,
  installWatchdog,
  lockDemoVault,
  parseDemoArgs,
  searchBookmarks,
  setupDemoVault,
  step,
  unlockDemoVault,
} from "./demo-tour-flow.mjs";

const VIEWPORT = { width: 1280, height: 720 };

/** Deliberate pacing so a viewer can follow the real UI transitions. */
const BEAT = { short: 700, hold: 1800, read: 1500 };

function parseArgs(argv) {
  const passthrough = [argv[0], argv[1]];
  let out = resolve(RAW_TOUR_PATH);
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out") out = resolve(argv[++i]);
    else passthrough.push(argv[i]);
  }
  const { baseUrl, mobile } = parseDemoArgs(passthrough);
  if (mobile) {
    throw new Error(
      "the tour records a single 1280x720 desktop viewport; --mobile is not supported " +
        "(use scripts/capture-demo-screens.mjs --mobile for the small-screen stills)",
    );
  }
  return { baseUrl, out };
}

function pause(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Opening frame. Rendered inside the recorded page (so it lands in the single
 * video file) and styled with the application's own light surface colours so
 * the cut into the real UI is not jarring.
 */
const TITLE_CARD = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>BookmarkForge demo tour</title>
<style>
  html,body{margin:0;height:100%;}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;
       background:linear-gradient(180deg,#f4f7fb 0%,#ffffff 100%);
       color:#0f172a;font-family:'Inter','Segoe UI',system-ui,sans-serif;text-align:center;}
  h1{margin:0;font-size:56px;letter-spacing:-0.02em;}
  .accent{color:#2563eb;}
  p{margin:14px 0 0;font-size:20px;color:#475569;}
  ol{margin:34px 0 0;padding:0;list-style:none;display:flex;gap:28px;font-size:15px;color:#64748b;}
  li::before{content:"";display:inline-block;width:8px;height:8px;margin-inline-end:8px;
             border-radius:9999px;background:#2563eb;vertical-align:middle;}
  .note{position:fixed;bottom:28px;font-size:12px;color:#94a3b8;letter-spacing:.04em;}
</style></head>
<body>
  <h1>Bookmark<span class="accent">Forge</span></h1>
  <p>Your private, local-first knowledge vault</p>
  <ol><li>Unlock</li><li>Capture</li><li>Search</li><li>Lock</li></ol>
  <div class="note">Product tour · demo data only</div>
</body></html>`;

/**
 * Page 1: everything the video should not spend 20 seconds on. It creates the
 * demo vault and touches the lazy routes so page 2 runs without module-loading
 * stutter. The bookmark panels are opened and closed WITHOUT saving, so the
 * recording starts from a genuinely empty vault.
 */
async function prepareVaultOffCamera(page) {
  step("off camera: security confirmation → vault setup");
  await setupDemoVault(page);
  await dismissOverlays(page);
  await dismissPrivacyConsent(page);
  // Persisted per origin, so completing it here is what keeps the recorded
  // page free of the coach-mark popover.
  await dismissWelcomeTour(page);

  step("off camera: preloading the bookmark routes");
  await gotoBookmarks(page);
  await page.getByTestId("add-bookmark-button").click();
  await page.getByTestId("quick-capture-input").waitFor({ state: "visible" });
  await page.getByTestId("close-quick-capture-button").click();
  await page
    .getByTestId("close-quick-capture-button")
    .waitFor({ state: "hidden", timeout: 15_000 });
  await page.getByTestId("search-input").click();
  await page.keyboard.press("Escape");
}

/** The recorded tour: unlock → capture → organise → search → lock. */
async function runRecordedTour(page, { typeDelayMs }) {
  step("unlock");
  await page
    .getByTestId("vault-locked-screen")
    .waitFor({ state: "visible", timeout: SHELL_TIMEOUT });
  await pause(BEAT.read);
  // Argon2id runs here; the recording shows the real wait, not a fake spinner.
  await unlockDemoVault(page, { typeDelayMs, pause });
  // Safety net: if the tour state had not persisted, catch it before the demo
  // content starts instead of letting it cover the whole recording.
  await dismissWelcomeTour(page, { timeoutMs: 1500 });
  await pause(BEAT.hold);

  step("quick capture");
  await fillQuickCapture(page, DEMO_BOOKMARKS[0], {
    typeDelayMs: Math.round(typeDelayMs / 4),
    pause,
  });
  await page.getByTestId("save-bookmark-button").click();
  await page
    .getByTestId("close-quick-capture-button")
    .waitFor({ state: "hidden", timeout: 60_000 });
  await pause(BEAT.short);

  step("bookmark list");
  await gotoBookmarks(page);
  await pause(BEAT.read);

  step("two more captures");
  await addBookmark(page, DEMO_BOOKMARKS[1], { pause });
  await pause(BEAT.short);
  await addBookmark(page, DEMO_BOOKMARKS[2], { pause });
  await pause(BEAT.short);

  step("search");
  await searchBookmarks(page, "webgpu", { typeDelayMs: typeDelayMs * 2 });
  await pause(BEAT.read + 200);
  await searchBookmarks(page, "");
  await pause(BEAT.short);

  step("lock");
  await lockDemoVault(page, { pause });
  // Closing frame: the vault locked again, which is the product's promise.
  await pause(BEAT.hold + 900);
}

async function main() {
  const { baseUrl, out } = parseArgs(process.argv);
  installWatchdog(420);
  mkdirSync(dirname(out), { recursive: true });
  step(`start baseUrl=${baseUrl} out=${out}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    // Playwright encodes VP8 with its bundled ffmpeg; the requested size must
    // not exceed the viewport or the capture would be upscaled.
    recordVideo: { dir: dirname(out), size: VIEWPORT },
  });

  // ── page 1: the discarded setup ──────────────────────────────────────────
  const setupPage = await context.newPage();
  const setupVideo = setupPage.video();
  setupPage.setDefaultTimeout(SHELL_TIMEOUT);
  await freezeDemoClock(setupPage);
  await setupPage.goto(baseUrl);
  await prepareVaultOffCamera(setupPage);
  await setupPage.close();
  const discarded = await setupVideo?.path();
  if (discarded) rmSync(discarded, { force: true });

  // ── page 2: the published recording ──────────────────────────────────────
  const page = await context.newPage();
  const video = page.video();
  page.setDefaultTimeout(SHELL_TIMEOUT);
  await freezeDemoClock(page);

  step("title card");
  await page.setContent(TITLE_CARD, { waitUntil: "load" });
  await pause(BEAT.hold);

  step("tour");
  await page.goto(baseUrl);
  await runRecordedTour(page, { typeDelayMs: 55 });

  step("closing context (flushes the video)");
  await context.close();
  const recordedPath = await video.path();
  await video.saveAs(out);
  // Playwright names the file after the page GUID; keep one copy.
  if (resolve(recordedPath) !== resolve(out)) rmSync(recordedPath, { force: true });
  await browser.close();

  const { size } = statSync(out);
  step(`recorded ${out} (${size} bytes)`);
  // Duration and quality are reported by scripts/build-demo-video.mjs, which
  // owns the only ffmpeg probe in this pipeline.
  console.log(JSON.stringify({ raw: out, bytes: size, viewport: VIEWPORT }, null, 2));
}

main().catch((error) => {
  console.error("[capture-tour] FAILED:", error?.message ?? error);
  process.exit(1);
});
