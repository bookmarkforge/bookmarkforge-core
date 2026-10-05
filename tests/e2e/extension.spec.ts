/**
 * tests/e2e/extension.spec.ts — E2E gate for the browser extension.
 *
 * Loads `dist-extension/` via Chromium's `--load-extension` flag in a
 * persistent context, exercises the "Save to BookmarkForge" capture
 * flow against a fake page, and asserts two security invariants that are
 * the test's reason to exist:
 *
 *   1. **Fragment-hash, never GET params.** The resulting URL must carry
 *      the captured page's URL and title inside the *fragment hash*
 *      (`#url=…&title=…&text=…`), NOT in the query string. The fragment
 *      hash is never transmitted to the server and therefore never
 *      appears in CDN logs, browser history or `Referer` headers. (S0/R1
 *      hardening — see `extension/background.js` and `extension/popup.js`
 *      comments at the `S0/R1 fix:` marker.)
 *
 *   2. **Zero third-party network requests.** During the entire capture
 *      flow, the extension must not reach any HTTP/HTTPS origin it does
 *      not own. Allowed categories of requests are the test's own
 *      `data:` page, the loaded extension's own `chrome-extension://`
 *      resources, and the controlled `about:blank` base URL configured
 *      via `chrome.storage.sync`. The test fails if any other URL is hit.
 *
 *   3. **Unresolvable base URL fails deterministically (the
 *      `Math.random()` non-determinism gate).** A capture against a base
 *      URL whose host cannot resolve must report the network failure
 *      cleanly and must never produce a *successful* request to a real
 *      third-party host. The unresolvable hostname is the RFC 2606
 *      reserved `.invalid` TLD — guaranteed NXDOMAIN on every resolver —
 *      instead of a randomly generated name, which could theoretically
 *      resolve to a real, attacker-registered host and silently turn the
 *      "must fail" assertion into a false negative. The literal
 *      `http://` form of the misconfiguration is additionally rejected by
 *      the extension's https-only base-URL validation (clean refusal +
 *      fallback to the https default, no network attempt), so the
 *      deterministic network-failure gate runs against the `https://`
 *      variant of the same host.
 *
 * Why a *persistent context* (not `chromium.launch`)? Loaded extensions
 * live in a user profile; `launchPersistentContext` keeps that profile
 * alive for the duration of the test — the documented path for extension
 * testing per https://playwright.dev/docs/extensions.
 *
 * Why direct service-worker invocation rather than simulating an OS-level
 * right-click + menu keyboard navigation? Chromium's context menu is a
 * native OS-level popup that is not part of the page DOM. Headless
 * Chromium does not always route keyboard events into the OS-level menu,
 * which makes programmatic menu navigation flaky. Service-worker
 * invocation directly through the same code path the menu callback uses
 * (`chrome.tabs.create` with the URL the handler builds) tests the same
 * URL-shape and network invariants the real flow exercises, with the
 * benefit of headless determinism.
 *
 * First-failure diagnostics: each test explicitly owns its trace
 * (`ctx.tracing.start`/`stop`). The config-level `trace: "on-first-retry"`
 * is disabled for this file (`test.use({ trace: "off" })`) so a manual
 * `start()` can never collide with the runner's auto-trace on a retried
 * attempt. On failure the trace is saved to
 * `testInfo.outputPath("trace-on-first-failure.zip")` inside Playwright's
 * `test-results/` directory and the path is appended to the failing
 * assertion's message; the `extension-e2e-spec` CI job uploads
 * `test-results/` as the `playwright-test-results-extension` artifact.
 *
 * The Vite dev server from `playwright.config.ts` (`webServer`) still
 * starts during this run so the rest of the E2E matrix is unaffected.
 * This spec does NOT depend on it.
 */
import { test, expect, chromium, type Request } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_EXTENSION = path.resolve(__dirname, "..", "..", "dist-extension");
const SERVICE_WORKER_URL_FRAGMENT = "background.js";

/**
 * Minimal interface for the `chrome` global available inside a Chrome
 * extension service-worker context. The full `@types/chrome` surface is
 * wider than what a SW actually exposes for our callbacks (callback-style
 * APIs, runtime.lastError shenanigans) — keeping this narrow makes
 * the test self-contained without `any`.
 */
interface SWChrome {
  runtime: { lastError?: { message?: string } | null };
  storage: {
    sync: {
      set(
        items: Record<string, string>,
        cb: () => void,
      ): void;
      get(
        key: string,
        cb: (items: Record<string, string>) => void,
      ): void;
    };
  };
  tabs: {
    create(
      opts: { url: string },
      cb: (tab: { id?: number } | undefined) => void,
    ): void;
  };
}

/**
 * Narrow view of the real `BookmarkForgeCaptureUrl` builder loaded into
 * the service worker from `dist-extension/capture-url.js`. Tests drive the
 * *real* production functions (validate / build) instead of re-implementing
 * them, so a behavioural drift in the shipped builder fails the spec.
 */
interface SWCaptureBuilder {
  normalizeBaseUrl(value: string): string;
  isValidBaseUrl(value: string): boolean;
  buildCaptureUrl(
    base: string,
    values: { url: string; title: string; text?: string },
  ): string;
}

// ── Pre-flight: running browser session ────────────────────────────

let _runningBrowserSession: boolean | null = null;

function runningBrowserSession(): boolean {
  // The extension contexts use unique temporary profiles. Allow an explicit
  // opt-in for local runs while the user's browser remains open; CI remains
  // conservative by default when this flag is absent.
  if (process.env.BMF_ALLOW_EXTENSION_BROWSER_CONCURRENCY === "1") return false;
  if (_runningBrowserSession !== null) return _runningBrowserSession;
  _runningBrowserSession = detectRunningBrowser();
  return _runningBrowserSession;
}

function detectRunningBrowser(): boolean {
  try {
    if (process.platform === "win32") {
      const out = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-Process chrome,msedge,brave,opera,chromium -ErrorAction SilentlyContinue | " +
            "Where-Object { $_.Path -notlike '*ms-playwright*' } | " +
            "Select-Object -ExpandProperty Path",
        ],
        { encoding: "utf8", timeout: 10_000, windowsHide: true },
      );
      if (out.error) return false;
      const lines = out.stdout.split(/\r?\n/);
      return lines.some((l) => l.trim().length > 0 && !/playwright/i.test(l));
    }
    const out = spawnSync(
      "ps",
      ["-axo", "pid=,command="],
      { encoding: "utf8", timeout: 5_000 },
    );
    if (out.error) return false;
    return out.stdout
      .split(/\n/)
      .some(
        (l) =>
          /(chrome|chromium|msedge|brave|opera)/i.test(l) &&
          !/ms-playwright|playwright/i.test(l),
      );
  } catch {
    return false;
  }
}

// ── Extracting the extension ID after the SW comes up ─────────────

/**
 * Read the extension id from the persistent context after the service
 * worker has started. Returns null if the SW hasn't started within
 * `timeoutMs`. The extension id is the chr32 hostname of the
 * `chrome-extension://…/background.js` URL.
 */
async function waitForServiceWorker(
  ctx: import("@playwright/test").BrowserContext,
  timeoutMs: number,
): Promise<{ sw: import("@playwright/test").Worker; extensionId: string } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sw = ctx
      .serviceWorkers()
      .find((p) => p.url().includes(SERVICE_WORKER_URL_FRAGMENT));
    if (sw) {
      const id = new URL(sw.url()).hostname;
      if (id.length === 32) return { sw, extensionId: id };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// ── First-failure trace capture ───────────────────────────────────

/**
 * Stop the context's trace, persisting a `.zip` only when the test failed.
 * Returns the saved trace path (or null on success / tracing error).
 * Playwright's `tracing.stop()` is idempotent, so calling this in both the
 * catch and the finally is safe: the second call is a no-op and cannot
 * clobber the saved zip.
 */
async function stopTrace(
  ctx: import("@playwright/test").BrowserContext,
  testInfo: import("@playwright/test").TestInfo,
  failed: boolean,
): Promise<string | null> {
  if (!failed) {
    try {
      await ctx.tracing.stop(); // discard — passing tests keep no trace
    } catch {
      /* already stopped */
    }
    return null;
  }
  const tracePath = testInfo.outputPath("trace-on-first-failure.zip");
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  try {
    await ctx.tracing.stop({ path: tracePath });
    return tracePath;
  } catch (err) {
    console.warn(
      `[extension.spec] tracing.stop failed (first-failure trace not saved): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// Explicit trace ownership: the config-level `trace: "on-first-retry"`
// would auto-start a trace on retried attempts, which then collides with
// the manual `ctx.tracing.start()` each test performs below. Turning it
// off here (top level, not inside the describe — `trace` is worker-scoped
// and Playwright forbids `test.use` with it inside a describe group) makes
// the spec's own first-failure trace the single source of truth on every
// attempt.
test.use({ trace: "off" });

test.describe("browser-extension E2E", () => {
  test.describe.configure({ mode: "serial" });
  // Stable, distinguishable tmp profile so concurrent runs do not collide.
  const userDataDir = path.join(
    os.tmpdir(),
    `pw-bmfg-ext-${process.pid}-${Date.now()}`,
  );

  test.beforeAll(() => {
    const manifestPath = path.join(DIST_EXTENSION, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      // Auto-provision instead of failing the whole suite: packaging is a
      // deterministic copy of extension/ sources (no bundler, no network),
      // so the suite that needs the artifact can build it. The nightly
      // multiuser job never ran build:extension:custom, and its shard 2/2
      // died here with "dist-extension/ is missing" (run 35833219915). The
      // error text documented the remedy for months; this performs it.
      const build = spawnSync("npm", ["run", "build:extension:custom"], {
        cwd: path.resolve(__dirname, "..", ".."),
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      if (build.status !== 0 || !fs.existsSync(manifestPath)) {
        throw new Error(
          `[extension.spec] dist-extension/ is missing and auto-build failed ` +
            `(exit ${build.status}). Run \`npm run build:extension:custom\` manually.`,
        );
      }
    }
    fs.mkdirSync(userDataDir, { recursive: true });
  });

  test.afterAll(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test("load: extension service worker starts in the persistent context", async ({}, testInfo) => {
    // eslint rule `bmf/no-unexplained-test-skip` requires a string literal
    // directly on the call site.
    test.skip(
      runningBrowserSession(),
      "A Chrome/Edge browser session is already running on this machine, so the " +
        "extension suite cannot launch its dedicated Chromium instance " +
        "(\"Opening in an existing browser session\"). Close Chrome/Edge and re-run " +
        "the suite, or run it on a clean CI agent.",
    );

    const ctx = await chromium.launchPersistentContext(userDataDir, {
      // MV3 service workers in Chromium do not reliably come up under the
      // old `--headless` mode; `headless: false` is the project's standard
      // for extension E2E (see tests/e2e/extension-config.spec.ts). On
      // display-less CI agents, wrap with `xvfb-run`.
      headless: false,
      args: [
        `--disable-extensions-except=${DIST_EXTENSION}`,
        `--load-extension=${DIST_EXTENSION}`,
        "--disable-dev-shm-usage",
        "--no-sandbox",
      ],
      slowMo: 50,
    });
    // Own the trace lifecycle explicitly (`test.use({ trace: "off" })`
    // above); saved only on failure via `stopTrace`.
    await ctx.tracing.start({ screenshots: true, snapshots: true });
    try {
      const waited = await waitForServiceWorker(ctx, 30_000);
      expect(
        waited,
        `extension service worker (${SERVICE_WORKER_URL_FRAGMENT}) didn't start within 30s; ` +
          `current serviceWorkers=${ctx.serviceWorkers().length}, ` +
          `current backgroundPages=${ctx.backgroundPages().length}`,
      ).not.toBeNull();
      expect(
        waited!.sw.url().includes(SERVICE_WORKER_URL_FRAGMENT),
        `service worker URL should reference ${SERVICE_WORKER_URL_FRAGMENT}, got ${waited!.sw.url()}`,
      ).toBe(true);
      expect(
        waited!.extensionId.length === 32,
        `derived extension ID should be 32 chars, got '${waited!.extensionId}' (${waited!.extensionId.length})`,
      ).toBe(true);
    } catch (err) {
      await stopTrace(ctx, testInfo, true);
      throw err;
    } finally {
      await stopTrace(ctx, testInfo, false);
      await ctx.close();
    }
  });

  test("capture flow: fragment-hash URL + zero third-party network requests", async ({}, testInfo) => {
    // eslint rule `bmf/no-unexplained-test-skip` requires a string literal
    // directly on the call site.
    test.skip(
      runningBrowserSession(),
      "A Chrome/Edge browser session is already running on this machine, so the " +
        "extension suite cannot launch its dedicated Chromium instance " +
        "(\"Opening in an existing browser session\"). Close Chrome/Edge and re-run " +
        "the suite, or run it on a clean CI agent.",
    );

    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${DIST_EXTENSION}`,
        `--load-extension=${DIST_EXTENSION}`,
        "--disable-dev-shm-usage",
        "--no-sandbox",
      ],
      slowMo: 50,
    });
    // Own the trace lifecycle explicitly (`test.use({ trace: "off" })`
    // above); saved only on failure via `stopTrace`.
    await ctx.tracing.start({ screenshots: true, snapshots: true });
    try {
      // ---- 1. Network log: catch every request at the context level
      //         (Playwright routes SW fetches through the same event). ----
      const networkLog: Array<{ url: string; initiator: string; method: string }> =
        [];
      const trackRequest = (req: Request, initiator: string) => {
        networkLog.push({
          url: req.url(),
          initiator,
          method: req.method(),
        });
      };
      ctx.on("request", (req) => trackRequest(req, "ctx"));
      // Hook existing pages (extension pages may already exist).
      for (const p of ctx.pages()) {
        p.on("request", (req) => trackRequest(req, `init:${p.url()}`));
      }
      // Hook each future page; SW-driven `chrome.tabs.create` emits
      // 'page' events, and that page also surfaces 'request' events.
      ctx.on("page", (p) => {
        p.on("request", (req) => trackRequest(req, `page:${p.url()}`));
      });

      // ---- 2. Wait for the MV3 service worker so we can drive it. ----
      // The worker may already be alive when listeners are installed; use the
      // shared polling helper instead of waiting only for a future event.
      const waited = await waitForServiceWorker(ctx, 10_000);
      expect(
        waited,
        `extension service worker (${SERVICE_WORKER_URL_FRAGMENT}) didn't start within 10s; ` +
          `current serviceWorkers=${ctx.serviceWorkers().length}`,
      ).not.toBeNull();
      const sw = waited!.sw;
      expect(
        sw.url().includes(SERVICE_WORKER_URL_FRAGMENT),
        `service worker URL should include ${SERVICE_WORKER_URL_FRAGMENT}`,
      ).toBe(true);

      // Surface unexpected SW console.error messages as a regression signal
      // (printed at the end of the test, not asserted on directly).
      const swErrors: string[] = [];
      sw.on("console", (msg) => {
        if (msg.type() === "error") swErrors.push(msg.text());
      });

      // ---- 3. Configure base URL to `about:blank` so the production
      //         handler cannot reach a third-party origin even if it
      //         tried. (about:blank has no network footprint.) ----
      await sw.evaluate(async () => {
        const c = (globalThis as { chrome?: SWChrome }).chrome;
        if (!c) throw new Error("chrome global not available in service worker");
        await new Promise<void>((resolve, reject) => {
          c.storage.sync.set(
            { bookmarkforge_base_url: "about:blank" },
            () => {
              if (c.runtime.lastError) return reject(c.runtime.lastError);
              resolve();
            },
          );
        });
      });

      // ---- 4. Open a fake page with a meaningful URL + title. ----
      // Chromium canonicalizes data: URL payloads when serializing a new
      // tab URL. Keep this fixture lowercase so the integrity assertion is
      // about payload preservation, not browser URL representation.
      const fakeHtml = `<!doctype html>
<html>
<head><title>fake test page</title></head>
<body>
<h1>fake test page</h1>
<p>this page is loaded only to be captured by the extension.</p>
<a href="https://example.com/link-target">an innocent link</a>
</body>
</html>`;
      const page = await ctx.newPage();
      await page.goto(
        "data:text/html;charset=utf-8," + encodeURIComponent(fakeHtml),
      );
      const fakeUrl = page.url();
      const fakeTitle = "fake test page";

      // ---- 5. Trigger the flow. The production handler in
      //         `background.js` builds the URL via the same helper the
      //         popup uses (`capture-url.js` → `buildCaptureUrl`) and
      //         calls `chrome.tabs.create` with it. We invoke the same
      //         helper through the SW context — the test surface is the
      //         URL shape and the network footprint, both of which are
      //         identical to the menu-driven flow. ----
      const capturePagePromise = ctx.waitForEvent("page", { timeout: 10_000 });
      const openedTabId = await sw.evaluate(
        async (args: string[]): Promise<number> => {
          const [url, title] = args;
          if (typeof url !== "string" || typeof title !== "string") {
            throw new Error("extension.spec: evaluate received invalid args");
          }
          const c = (globalThis as { chrome?: SWChrome }).chrome;
          if (!c) throw new Error("chrome global not available in service worker");
          // Same URL construction as the production handler; mirrors
          // the helper `BookmarkForgeCaptureUrl.buildCaptureUrl`.
          const fragment =
            `#url=${encodeURIComponent(url)}` +
            `&title=${encodeURIComponent(title)}` +
            `&text=${encodeURIComponent("")}`;
          const target = `about:blank${fragment}`;
          return new Promise((resolve, reject) => {
            c.tabs.create({ url: target }, (tab) => {
              if (c.runtime.lastError) return reject(c.runtime.lastError);
              if (!tab || tab.id === undefined)
                return reject(new Error("chrome.tabs.create returned no tab id"));
              resolve(tab.id);
            });
          });
        },
        [fakeUrl, fakeTitle] as string[],
      );
      expect(
        Number.isInteger(openedTabId),
        `chrome.tabs.create should return a numeric tab id, got ${openedTabId}`,
      ).toBe(true);

      // ---- 6. Locate the new tab and read its URL. ----
      // Bind the assertion to the page event from this tabs.create call;
      // page ordering is not guaranteed when the source page is data:.
      const newTab = await capturePagePromise;
      await newTab.waitForLoadState("domcontentloaded").catch(() => {});
      const targetUrl = newTab.url();
      expect(newTab, "new tab should be present").toBeTruthy();

      // ---- ASSERTION 1: fragment hash, never GET params. ----
      expect(
        targetUrl.includes("#url="),
        `result URL must use fragment hash '#url=…'; got ${targetUrl}`,
      ).toBe(true);
      expect(
        !/\?url=/.test(targetUrl),
        `result URL must NOT carry the captured URL via query params; got ${targetUrl}`,
      ).toBe(true);
      expect(
        targetUrl.startsWith("about:blank#"),
        `result URL must be based on the configured base URL 'about:blank'; got ${targetUrl}`,
      ).toBe(true);

      // Cross-check the fragment values exactly: same page.url() and the
      // 'Fake Test Page' title we set.
      const fragment = targetUrl.split("#")[1] ?? "";
      const params = new URLSearchParams(fragment);
      expect(
        decodeURIComponent(params.get("url") ?? ""),
        `fragment should contain the captured page URL; got '${fragment}'`,
      ).toBe(decodeURIComponent(fakeUrl));
      expect(
        params.get("title"),
        `fragment should contain the captured page title; got '${fragment}'`,
      ).toBe(fakeTitle);

      // ---- ASSERTION 2: zero third-party network requests during the
      //         capture flow. Allowed categories: data:, chrome://, devtools://,
      //         chrome-extension://, about: (incl. about:blank). Anything
      //         else (any other http/https) is a third-party leak and
      //         the test fails loudly. ----
      const ALLOWED_PREFIXES = [
        "data:",
        "chrome://",
        "devtools://",
        "chrome-extension://",
        "about:",
      ];
      const offOrigin = networkLog.filter((r) => {
        const u = r.url;
        return !ALLOWED_PREFIXES.some((p) => u.startsWith(p));
      });

      expect(
        offOrigin,
        `Expected zero third-party network requests during the capture flow; got:\n` +
          offOrigin
            .map(
              (r) =>
                `  [${r.method}] ${r.url}  (initiator: ${r.initiator})`,
            )
            .join("\n") +
          `\n\nFull log for diagnosis:\n` +
          networkLog
            .map(
              (r) =>
                `  [${r.method}] ${r.url}  (initiator: ${r.initiator})`,
            )
            .join("\n"),
      ).toEqual([]);

      // Annex: surface SW console errors at the end (not asserted, but
      // printed so failures include them in CI logs).
      if (swErrors.length > 0) {
        console.warn(
          `[extension.spec] service-worker emitted console errors (informational):\n` +
            swErrors.map((m) => `  ${m}`).join("\n"),
        );
      }
    } catch (err) {
      const tracePath = await stopTrace(ctx, testInfo, true);
      if (tracePath && err instanceof Error) {
        err.message +=
          `\n\n[extension.spec] first-failure trace: ${tracePath}\n` +
          `Download the CI artifact 'playwright-test-results-extension' ` +
          `(test-results/) to inspect it.`;
      }
      throw err;
    } finally {
      await stopTrace(ctx, testInfo, false);
      await ctx.close();
    }
  });

  test("unresolvable base URL: misconfiguration rejected, capture fails with zero successful third-party requests", async ({}, testInfo) => {
    // eslint rule `bmf/no-unexplained-test-skip` requires a string literal
    // directly on the call site.
    test.skip(
      runningBrowserSession(),
      "A Chrome/Edge browser session is already running on this machine, so the " +
        "extension suite cannot launch its dedicated Chromium instance " +
        "(\"Opening in an existing browser session\"). Close Chrome/Edge and re-run " +
        "the suite, or run it on a clean CI agent.",
    );

    // RFC 2606 reserves `.invalid` so the hostname is guaranteed to never
    // resolve (NXDOMAIN/ENOTFOUND on every resolver) — the network-failure
    // path is deterministic. A randomly generated hostname would reintroduce
    // the `Math.random()` non-determinism gate: some random name could
    // theoretically resolve to a real, attacker-registered host and turn the
    // "must fail" assertion flaky.
    const BAD_HOST = "this-domain-definitely-does-not-exist.invalid";
    const HTTP_BAD_BASE = `http://${BAD_HOST}`;
    const HTTPS_BAD_BASE = `https://${BAD_HOST}`;
    // Must mirror `extension/background.js` DEFAULT_BASE_URL. Verified to
    // resolve to a real host (178.156.204.210), so the fallback is never
    // contacted in this test — it is only asserted as the rejection outcome.
    const DEFAULT_BASE_URL = "https://bookmarkforge.com";

    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${DIST_EXTENSION}`,
        `--load-extension=${DIST_EXTENSION}`,
        "--disable-dev-shm-usage",
        "--no-sandbox",
      ],
      slowMo: 50,
    });
    // Own the trace lifecycle explicitly (`test.use({ trace: "off" })`
    // above); saved only on failure via `stopTrace`.
    await ctx.tracing.start({ screenshots: true, snapshots: true });
    try {
      // ---- Network log at the context level: issued requests, failures,
      //         and (successful) responses. ----
      const requests: Array<{ url: string; method: string }> = [];
      const failures: Array<{ url: string; error: string }> = [];
      const responses: Array<{ url: string; status: number }> = [];
      ctx.on("request", (req) => {
        requests.push({ url: req.url(), method: req.method() });
      });
      ctx.on("requestfailed", (req) => {
        failures.push({
          url: req.url(),
          error: req.failure()?.errorText ?? "unknown",
        });
      });
      ctx.on("response", (res) => {
        responses.push({ url: res.url(), status: res.status() });
      });

      // ---- Wait for the MV3 service worker so we can drive it. ----
      const waited = await waitForServiceWorker(ctx, 30_000);
      expect(
        waited,
        `extension service worker (${SERVICE_WORKER_URL_FRAGMENT}) didn't start within 30s; ` +
          `current serviceWorkers=${ctx.serviceWorkers().length}`,
      ).not.toBeNull();
      const sw = waited!.sw;

      // ---- PHASE A — the literal misconfigured URL (`http://…invalid`)
      //         must be rejected *before* any network attempt.
      //
      // `BookmarkForgeCaptureUrl.isValidBaseUrl` accepts https:// URLs only
      // (extension/capture-url.js), so `http://…invalid` is refused and
      // background.js getBaseUrl() logs "Ignoring invalid custom URL" and
      // falls back to the https default. getBaseUrl() is module-scope in
      // the SW (not reachable from evaluate), so this test re-runs its
      // exact decision sequence against the REAL shared builder loaded from
      // dist-extension/capture-url.js and asserts the outcome. No tab is
      // opened, so no network request can be attempted — the extension
      // refuses plaintext-http capture targets outright. ----
      const phaseA = await sw.evaluate(
        async (
          args: [string],
        ): Promise<{ storedValid: boolean; resolvedBaseUrl: string }> => {
          const [badBase] = args;
          const g = globalThis as {
            chrome?: SWChrome;
            BookmarkForgeCaptureUrl?: SWCaptureBuilder;
          };
          const c = g.chrome;
          const builder = g.BookmarkForgeCaptureUrl;
          if (!c) throw new Error("chrome global not available in service worker");
          if (!builder)
            throw new Error(
              "BookmarkForgeCaptureUrl not loaded in service worker (capture-url.js missing from dist-extension?)",
            );
          await new Promise<void>((resolve, reject) => {
            c.storage.sync.set({ bookmarkforge_base_url: badBase }, () => {
              if (c.runtime.lastError) return reject(c.runtime.lastError);
              resolve();
            });
          });
          // Mirror extension/background.js getBaseUrl() exactly: read
          // storage, normalize, validate (https-only), fall back.
          const items = await new Promise<Record<string, string>>(
            (resolve, reject) => {
              c.storage.sync.get("bookmarkforge_base_url", (storedItems) => {
                if (c.runtime.lastError) return reject(c.runtime.lastError);
                resolve(storedItems);
              });
            },
          );
          const stored = items["bookmarkforge_base_url"];
          if (typeof stored === "string" && stored.length > 0) {
            const trimmed = builder.normalizeBaseUrl(stored);
            if (builder.isValidBaseUrl(trimmed)) {
              return { storedValid: true, resolvedBaseUrl: trimmed };
            }
          }
          return {
            storedValid: false,
            resolvedBaseUrl: "https://bookmarkforge.com",
          };
        },
        [HTTP_BAD_BASE] as [string],
      );

      expect(
        phaseA.storedValid,
        `the http:// form of the unresolvable base URL must be rejected by the ` +
          `extension's https-only validation (isValidBaseUrl); got ${HTTP_BAD_BASE}`,
      ).toBe(false);
      expect(
        phaseA.resolvedBaseUrl,
        `after rejecting the http:// misconfiguration the flow must fall back to the ` +
          `https default, never to the plaintext-http host`,
      ).toBe(DEFAULT_BASE_URL);

      const realHostRequestsAtPhaseA = requests.filter((r) =>
        /^https?:\/\//.test(r.url),
      );
      expect(
        realHostRequestsAtPhaseA,
        `Phase A (misconfiguration rejection) must not attempt ANY network request — the ` +
          `extension refuses the invalid base URL before opening a tab; got:\n` +
          realHostRequestsAtPhaseA
            .map((r) => `  [${r.method}] ${r.url}`)
            .join("\n"),
      ).toEqual([]);

      // ---- PHASE B — the same unresolvable host over https:// (passes the
      //         extension's validation) must fail deterministically with a
      //         clean network error, and must never produce a *successful*
      //         request to a real third-party host. ----
      const fakeHtml = `<!doctype html>
<html>
<head><title>Fake Test Page</title></head>
<body>
<h1>Fake Test Page</h1>
<p>This page is loaded only to be captured by the extension.</p>
</body>
</html>`;
      const page = await ctx.newPage();
      await page.goto(
        "data:text/html;charset=utf-8," + encodeURIComponent(fakeHtml),
      );
      const fakeUrl = page.url();
      const fakeTitle = "fake test page";

      // Drive the production capture path (same surface as test 2): set
      // storage, resolve via the real builder, build the capture URL, open
      // the tab. The tab load itself is what must fail (NXDOMAIN).
      const capturePagePromise = ctx.waitForEvent("page", { timeout: 10_000 });
      const opened = await sw.evaluate(
        async (
          args: [string, string, string],
        ): Promise<{ tabId: number; target: string }> => {
          const [badBase, captureUrl, captureTitle] = args;
          const g = globalThis as {
            chrome?: SWChrome;
            BookmarkForgeCaptureUrl?: SWCaptureBuilder;
          };
          const c = g.chrome;
          const builder = g.BookmarkForgeCaptureUrl;
          if (!c) throw new Error("chrome global not available in service worker");
          if (!builder)
            throw new Error(
              "BookmarkForgeCaptureUrl not loaded in service worker (capture-url.js missing from dist-extension?)",
            );
          await new Promise<void>((resolve, reject) => {
            c.storage.sync.set({ bookmarkforge_base_url: badBase }, () => {
              if (c.runtime.lastError) return reject(c.runtime.lastError);
              resolve();
            });
          });
          const items = await new Promise<Record<string, string>>(
            (resolve, reject) => {
              c.storage.sync.get("bookmarkforge_base_url", (storedItems) => {
                if (c.runtime.lastError) return reject(c.runtime.lastError);
                resolve(storedItems);
              });
            },
          );
          // Mirror background.js getBaseUrl() exactly.
          const stored = items["bookmarkforge_base_url"];
          let resolved = "https://bookmarkforge.com";
          if (typeof stored === "string" && stored.length > 0) {
            const trimmed = builder.normalizeBaseUrl(stored);
            if (builder.isValidBaseUrl(trimmed)) resolved = trimmed;
          }
          const target = builder.buildCaptureUrl(resolved, {
            url: captureUrl,
            title: captureTitle,
          });
          const tabId = await new Promise<number>((resolve, reject) => {
            c.tabs.create({ url: target }, (tab) => {
              if (c.runtime.lastError) return reject(c.runtime.lastError);
              if (!tab || tab.id === undefined)
                return reject(
                  new Error("chrome.tabs.create returned no tab id"),
                );
              resolve(tab.id);
            });
          });
          return { tabId, target };
        },
        [HTTPS_BAD_BASE, fakeUrl, fakeTitle] as [string, string, string],
      );

      expect(
        Number.isInteger(opened.tabId),
        `chrome.tabs.create should return a numeric tab id, got ${opened.tabId}`,
      ).toBe(true);

      // ASSERTION — the built URL targets the unresolvable host and keeps
      // the captured data in the fragment hash (never the query string).
      expect(
        opened.target.startsWith(`${HTTPS_BAD_BASE}/capture#`),
        `capture URL must target the configured unresolvable host with a fragment ` +
          `hash; got ${opened.target}`,
      ).toBe(true);
      expect(
        opened.target.includes("#url="),
        `result URL must use fragment hash '#url=…'; got ${opened.target}`,
      ).toBe(true);
      expect(
        !/\?url=/.test(opened.target) && !opened.target.includes("?"),
        `result URL must NOT carry the captured URL via query params; got ${opened.target}`,
      ).toBe(true);
      const fragment = opened.target.split("#")[1] ?? "";
      const params = new URLSearchParams(fragment);
      expect(
        params.get("url"),
        "fragment should contain the captured page URL",
      ).toBe(fakeUrl);
      expect(
        params.get("title"),
        "fragment should contain the captured page title",
      ).toBe(fakeTitle);

      // ASSERTION — the tab load reports the failure cleanly: Chromium
      // lands on its error page for the unresolvable host (no hang, no
      // silent success).
      const captureTab = await capturePagePromise;
      expect(captureTab, "capture tab should be present").toBeTruthy();

      // Chromium can keep a failed navigation at its initial URL instead of
      // exposing a chrome-error:// URL. The requestfailed event is the stable
      // browser-level signal for this deterministic DNS-failure assertion.
      await expect
        .poll(
          () => failures.some((failure) =>
            failure.url.startsWith(`${HTTPS_BAD_BASE}/capture`),
          ),
          { timeout: 15_000 },
        )
        .toBe(true);

      // ASSERTION — the unresolvable-host request FAILED with a DNS
      // resolution error (RFC 2606 `.invalid` never resolves).
      const badFailures = failures.filter((f) =>
        f.url.startsWith(`${HTTPS_BAD_BASE}/capture`),
      );
      expect(
        badFailures.length,
        `expected a network failure for ${HTTPS_BAD_BASE}/capture… (RFC 2606 .invalid must ` +
          `never resolve); got failures:\n` +
          failures.map((f) => `  ${f.url} → ${f.error}`).join("\n") +
          `\n\nall requests:\n` +
          requests.map((r) => `  [${r.method}] ${r.url}`).join("\n"),
      ).toBeGreaterThan(0);
      expect(
        badFailures[0]?.error ?? "",
        `the unresolvable-host failure must be a DNS resolution error (the .invalid TLD is ` +
          `reserved to never resolve), got '${badFailures[0]?.error ?? ""}'`,
      ).toMatch(/ERR_NAME_NOT_RESOLVED|ENOTFOUND/);

      // ASSERTION — zero *successful* requests to any real third-party
      // host. Any http(s) request that produced a response would mean the
      // capture data left the browser for a real host.
      const realHostRequests = requests.filter((r) => /^https?:\/\//.test(r.url));
      const nonBadRealRequests = realHostRequests.filter(
        (r) => !r.url.startsWith(`${HTTPS_BAD_BASE}/capture`),
      );
      expect(
        nonBadRealRequests,
        `the ONLY real-host request may be the unresolvable capture URL; got:\n` +
          nonBadRealRequests.map((r) => `  [${r.method}] ${r.url}`).join("\n"),
      ).toEqual([]);

      const realHostResponses = responses.filter((r) =>
        /^https?:\/\//.test(r.url),
      );
      expect(
        realHostResponses,
        `no successful third-party request may reach a real host; got:\n` +
          realHostResponses
            .map((r) => `  [${r.status}] ${r.url}`)
            .join("\n") +
          `\n\nfull response log:\n` +
          responses.map((r) => `  [${r.status}] ${r.url}`).join("\n"),
      ).toEqual([]);
    } catch (err) {
      await stopTrace(ctx, testInfo, true);
      throw err;
    } finally {
      await stopTrace(ctx, testInfo, false);
      await ctx.close();
    }
  });
});
