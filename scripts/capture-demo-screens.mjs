#!/usr/bin/env node
/**
 * Capture demo screenshots of the real application for the README.
 *
 * The flow exercises the authentic product path with throwaway demo data:
 * security confirmation → vault setup → QuickCapture → search → lock.
 * No real vault password, recovery kit, license key or user data is used;
 * the screenshots only ever show demo content typed by this script.
 *
 * The steps themselves live in `scripts/demo-tour-flow.mjs` so the still
 * screenshots and the recorded WebM tour can never drift apart.
 *
 * Usage:
 *   node scripts/capture-demo-screens.mjs --base-url http://127.0.0.1:5199
 *   node scripts/capture-demo-screens.mjs --base-url http://127.0.0.1:5199 --mobile
 *   node scripts/capture-demo-screens.mjs --base-url http://127.0.0.1:5199 --out-dir /tmp/fresh
 *
 * `--out-dir` exists so the nightly media job can capture into a scratch
 * directory and compare the result with the committed stills before anything
 * overwrites them (see scripts/compare-demo-media.mjs).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import {
  DEMO_BOOKMARKS,
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
  setupDemoVault,
  step,
  unlockDemoVault,
} from "./demo-tour-flow.mjs";

const DEFAULT_OUT_DIR = "docs";

/** Splits `--out-dir` out of argv, leaving the shared contract untouched. */
function extractOutDir(argv) {
  const rest = [argv[0], argv[1]];
  let outDir = DEFAULT_OUT_DIR;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out-dir") outDir = argv[++i];
    else rest.push(argv[i]);
  }
  if (!outDir) throw new Error("--out-dir needs a directory");
  return { rest, outDir: resolve(outDir) };
}

let OUT_DIR = resolve(DEFAULT_OUT_DIR);

async function saveScreenshot(page, filename) {
  await page.waitForTimeout(400); // let Mantine animations settle
  await page.screenshot({ path: join(OUT_DIR, filename), animations: "disabled" });
  console.log(`captured ${filename}`);
}

async function main() {
  const { rest, outDir } = extractOutDir(process.argv);
  const { baseUrl, mobile } = parseDemoArgs(rest);
  // Above the per-step ceilings (vault creation alone allows 180s) so the
  // watchdog only fires on a genuine hang.
  installWatchdog(420);
  OUT_DIR = outDir;
  mkdirSync(OUT_DIR, { recursive: true });
  step(`start baseUrl=${baseUrl} mobile=${mobile} outDir=${OUT_DIR}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(SHELL_TIMEOUT);
  await freezeDemoClock(page);

  // 1) First screen of a pristine context: local-first security promise.
  step(`goto ${baseUrl} (cold dev server can take a while)`);
  await page.goto(baseUrl);
  await page
    .getByRole("heading", { name: "Secure your vault" })
    .waitFor({ state: "visible", timeout: SHELL_TIMEOUT });
  step("security confirmation visible");
  if (mobile) {
    await saveScreenshot(page, "bookmarkforge-demo-mobile-secure.png");
  }

  // 2) Real setup flow → unlocked dashboard.
  await setupDemoVault(page);
  step("vault created; dismissing overlays");
  await dismissOverlays(page);
  await dismissPrivacyConsent(page);
  // The guided tour mounts ~800ms later; without this the coach-mark popover
  // would be baked into every still. See dismissWelcomeTour.
  await dismissWelcomeTour(page);
  await saveScreenshot(
    page,
    mobile
      ? "bookmarkforge-demo-mobile-dashboard.png"
      : "bookmarkforge-demo-app.png",
  );

  if (!mobile) {
    // 3) QuickCapture open with the first demo URL typed.
    step("opening QuickCapture");
    await fillQuickCapture(page, DEMO_BOOKMARKS[0]);
    await saveScreenshot(page, "bookmarkforge-demo-capture.png");
    await page.getByTestId("save-bookmark-button").click();
    await page
      .getByTestId("close-quick-capture-button")
      .waitFor({ state: "hidden", timeout: 60_000 });

    // 4) Bookmarks view with the captured row.
    step("navigating to Bookmarks");
    await gotoBookmarks(page);
    await saveScreenshot(page, "bookmarkforge-demo-bookmarks.png");

    // 5) Two more captures, then a live search narrowing the list.
    await addBookmark(page, DEMO_BOOKMARKS[1]);
    await addBookmark(page, DEMO_BOOKMARKS[2]);
    const search = page.getByTestId("search-input");
    await search.fill("webgpu");
    await page.waitForTimeout(600);
    await saveScreenshot(page, "bookmarkforge-demo-search.png");
    await search.fill("");
    await page.waitForTimeout(300);

    // 6) Lock screen — the product's privacy stance in one frame.
    step("locking vault");
    await lockDemoVault(page);
    await saveScreenshot(page, "bookmarkforge-demo-locked.png");
    await unlockDemoVault(page);
  } else {
    // Mobile: capture panel on the small viewport.
    step("mobile QuickCapture");
    await page.getByTestId("add-bookmark-button").click();
    const input = page.getByTestId("quick-capture-input");
    await input.waitFor({ state: "visible" });
    await input.fill(DEMO_BOOKMARKS[0].url);
    await saveScreenshot(page, "bookmarkforge-demo-mobile-capture.png");
  }

  step("closing browser");
  await context.close();
  await browser.close();
  // Provenance, not decoration: font rasterisation differs between operating
  // systems, so a pixel comparison against these images is only meaningful on
  // the platform that produced them. scripts/run-demo-media-nightly.mjs reads
  // this before it decides whether drift is a failure or a warning.
  //
  // Both modes write the same manifest, so each merges its own geometry instead
  // of replacing it: the file describes the media set, not the last run.
  const manifestPath = join(OUT_DIR, "bookmarkforge-demo-manifest.json");
  let previous = {};
  if (existsSync(manifestPath)) {
    try {
      previous = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      previous = {};
    }
  }
  const manifest = {
    generatedBy: "scripts/capture-demo-screens.mjs",
    demoDataOnly: true,
    realCredentials: false,
    platform: process.platform,
    arch: process.arch,
    runs: {
      ...(previous.runs ?? {}),
      [mobile ? "mobile" : "desktop"]: {
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        deviceScaleFactor: mobile ? 2 : 1,
      },
    },
    bookmarks: DEMO_BOOKMARKS.map((b) => b.title),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("done");
}

// The Playwright browser connection keeps the Node event loop alive, so an
// error left unhandled would hang the caller forever. Always hard-exit.
main().catch((error) => {
  console.error("[capture] FAILED:", error?.message ?? error);
  process.exit(1);
});
