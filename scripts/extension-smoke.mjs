/**
 * scripts/extension-smoke.mjs — loads the PACKAGED extension into a real
 * Chromium browser and verifies the capture flow end-to-end.
 *
 * Why this exists (audit H5): the extension unit tests (extension/__tests__)
 * run in jsdom with a mocked `chrome` API, so they cannot catch packaging
 * errors (missing files, broken manifest, popup runtime errors). This script
 * launches Chromium with `--load-extension` against the built output
 * (OUTPUT_DIR, default dist-extension) and asserts:
 *
 *   1. the manifest parses as MV3 and every referenced file ships;
 *   2. the extension service worker starts (background.js boots);
 *   3. the popup renders its controls (popup.html + popup.js boot);
 *   4. the capture URL builder emits the S0/R1 fragment-hash contract
 *      (never GET query params — URLs/titles must not hit server logs).
 *
 * A click-through probe (5) opens a real tab and clicks Save: in a browser
 * harness that grants `activeTab` (e.g. a headed session with xvfb) it
 * validates the full popup -> chrome.tabs.create path. In the headless
 * harness `chrome.action.openPopup()` does not surface a popup page and
 * activeTab is not granted, so the probe reports a warning instead of
 * failing the run — steps 1-4 are the deterministic gate.
 *
 * Requires `npx playwright install chromium` (CI installs it). Run after
 * `npm run build:extension:custom`. Exit code non-zero on any failure.
 */
import { chromium } from "playwright";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { APP_DOMAIN } from "./csp-config.js";

const ROOT = process.cwd();
const OUTPUT_DIR = process.env.OUTPUT_DIR || "dist-extension";
const DEPLOY_DOMAIN = APP_DOMAIN; // follows BOOKMARKFORGE_DOMAIN
// Honor an absolute OUTPUT_DIR verbatim; path.join would prepend ROOT.
const OUT = isAbsolute(OUTPUT_DIR) ? OUTPUT_DIR : join(ROOT, OUTPUT_DIR);

function fail(message) {
  console.error(`[extension-smoke] FAIL: ${message}`);
  process.exit(1);
}

// ── 1. Manifest + packaging sanity ───────────────────────────────────────
const manifestPath = join(OUT, "manifest.json");
if (!existsSync(manifestPath)) {
  fail(`manifest.json not found in ${OUT} — run npm run build:extension:custom first`);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.manifest_version !== 3) {
  fail(`expected MV3 manifest, got manifest_version=${manifest.manifest_version}`);
}
const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
].filter(Boolean);
for (const file of referenced) {
  if (!existsSync(join(OUT, file))) {
    fail(`manifest references missing file: ${file}`);
  }
}
console.log(`[extension-smoke] manifest OK (MV3, ${referenced.length} referenced files present)`);

// ── 2. Launch Chromium with the extension loaded ─────────────────────────
// `channel: "chromium"` forces the FULL Chrome binary in new-headless mode:
// the default headless shell (chromium_headless_shell) does NOT support
// extensions, so the service worker would never start there.
// Chromium profile lives in os.tmpdir() (never the repo root) and is
// removed after the run, so the smoke test leaves zero artifacts behind.
const userDataDir = join(tmpdir(), `bmf-extension-smoke-${process.pid}`);
rmSync(userDataDir, { recursive: true, force: true });

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [
    `--disable-extensions-except=${OUT}`,
    `--load-extension=${OUT}`,
  ],
});

try {
  // The MV3 service worker starts shortly after the browser launches.
  let extensionSw = null;
  for (let attempt = 0; attempt < 20 && !extensionSw; attempt++) {
    extensionSw =
      context.serviceWorkers().find((w) => w.url().includes("chrome-extension://")) ??
      null;
    if (!extensionSw) {
      await context.waitForEvent("serviceworker", { timeout: 1000 }).catch(() => {});
    }
  }
  if (!extensionSw) fail("extension service worker never started");
  console.log(`[extension-smoke] service worker alive: ${extensionSw.url()}`);

  const extensionId = new URL(extensionSw.url()).hostname;

  // ── 3. Popup renders ─────────────────────────────────────────────────────
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForSelector("#saveBtn", { timeout: 5000 });
  if (!(await popup.locator("#pageTitle").count())) {
    fail("popup missing #pageTitle element");
  }
  console.log("[extension-smoke] popup rendered (saveBtn + pageTitle present)");

  // ── 4. Fragment-hash capture contract (S0/R1) ───────────────────────────
  // DEPLOY_DOMAIN comes from csp-config.js (follows BOOKMARKFORGE_DOMAIN
  // env). The evaluate() callback runs in Chromium, so we pass it as arg.
  const fragment = await popup.evaluate(
    ({ deployDomain }) => {
      const url = globalThis.BookmarkForgeCaptureUrl.buildCaptureUrl(
        `https://${deployDomain}`,
        { url: "https://example.com/a?b=1", title: "A & B <title>" },
      );
      return {
        url,
        hasQuery: url.includes("?url="),
        hasFragment: url.includes("#url="),
      };
    },
    { deployDomain: DEPLOY_DOMAIN },
  );
  if (!fragment.hasFragment || fragment.hasQuery) {
    fail(
      `capture URL violates the fragment-hash contract: ${fragment.url} ` +
        "(URLs/titles must ride the #fragment, never GET query params)",
    );
  }
  console.log("[extension-smoke] capture URL uses #fragment (no query params)");

  // ── 5. Best-effort click-through probe ──────────────────────────────────
  // Opens a real tab and clicks Save on the popup. The full assertion only
  // runs when the harness surfaces the popup as a page AND grants activeTab
  // (headless new-mode does not); otherwise the probe warns and moves on.
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<!doctype html><html><head><title>Smoke Target</title></head><body>hello</body></html>",
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const targetUrl = `http://127.0.0.1:${server.address().port}/page`;

  try {
    const tab = await context.newPage();
    await tab.goto(targetUrl);
    await tab.bringToFront();

    const captureOpened = context
      .waitForEvent("page", { timeout: 8000 })
      .catch(() => null);
    await extensionSw.evaluate(() => chrome.action.openPopup().catch(() => {}));
    const popupPage = await context
      .waitForEvent("page", { timeout: 4000 })
      .catch(() => null);

    if (popupPage && popupPage.url().includes("popup.html")) {
      await popupPage.bringToFront();
      await popupPage.locator("#saveBtn").click({ timeout: 5000 });
    } else {
      // Popup not surfaced as a page — drive the already-open popup directly
      // while the target tab stays active.
      await popup.locator("#saveBtn").click({ timeout: 5000 });
    }
    const capturePage = await captureOpened;
    if (capturePage) {
      const captureUrl = capturePage.url();
      if (!captureUrl.includes("/capture#url=")) {
        fail(
          `capture tab URL does not carry the #url fragment: ${captureUrl.slice(0, 120)}`,
        );
      }
      console.log(`[extension-smoke] click-through OK -> ${captureUrl.slice(0, 120)}...`);
      await capturePage.close().catch(() => {});
    } else {
      console.log(
        "[extension-smoke] note: click-through probe skipped (activeTab not granted in headless harness)",
      );
    }
    await tab.close().catch(() => {});
  } finally {
    server.close();
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await context.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
}
console.log("[extension-smoke] PASS — packaged extension loads in real Chromium");
process.exit(0);
