import { expect, test, type Page } from "@playwright/test";

// SW integrity tamper suite — ADR-039, browser-level.
//
// The unit/synthetic suites (scripts/__tests__/sw-integrity-runtime.test.mjs,
// src/tests/security/p3-sw-integrity-runtime.regression.test.ts) prove the
// runtime's logic in isolation. This spec proves the REAL deployment
// contract in an actual Chromium against a `build:ci` production artifact:
//
//   1. The service worker installs, precaches, and controls the page.
//   2. A tampered PRECACHE entry (main entry chunk) is hash-verified on
//      serve → the page gets a 504 (the chunk NEVER executes), the
//      poisoned entry is evicted from every cache bucket, and the next
//      reload self-heals from the network.
//   3. A tampered RUNTIME-CACHE entry (StaleWhileRevalidate locale — the
//      lazy-path class the 2026-09-02 audit finding B-1 was about) gets
//      the same treatment.
//   4. Negative control: a cache entry for a path NOT in the manifest
//      passes through untouched — verification is scoped, not a blanket
//      network block.
//
// Only the SW can answer 504 "Integrity check failed" (vite preview never
// does), so a 504 on the tampered URL is the authoritative tamper signal.
// Consent keys are seeded OFF (see playwright.sw-integrity.config.ts) so
// no telemetry or /api traffic disturbs the measurement.

const BOOT_TIMEOUT = 60_000;

/** Boot the app, wait for SW install+activate, reload so the SW controls. */
async function bootWithSw(page: Page): Promise<void> {
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.text().toLowerCase().includes("serviceworker")) {
      console.log(`[debug console.${msg.type()}]`, msg.text().slice(0, 250));
    }
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  try {
    await page.evaluate(() => navigator.serviceWorker.ready, undefined);
  } catch (err) {
    const diag = await page.evaluate(async () => {
      let regs: unknown[] = [];
      try {
        regs = await navigator.serviceWorker.getRegistrations().then((rs) =>
          rs.map((r) => ({
            scope: r.scope,
            active: r.active?.state,
            installing: r.installing?.state,
            waiting: r.waiting?.state,
          })),
        );
      } catch {
        regs = [{ error: "getRegistrations threw" }];
      }
      const swResponse = await fetch("/sw.js").then(
        (r) => ({ status: r.status, type: r.headers.get("content-type") }),
        (e) => ({ fetchError: String(e) }),
      );
      return { regs, swResponse, url: location.href };
    });
    console.log("[debug bootWithSw diag]", JSON.stringify(diag));
    throw err;
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, {
    timeout: BOOT_TIMEOUT,
  });
  // React shell mounted (root children exist) — the build actually booted.
  await page.waitForSelector("#root > *");
}

/** The build manifest element injected into index.html must exist (ADR-039). */
async function expectManifestPresent(page: Page): Promise<void> {
  const present = await page.evaluate(
    () => document.getElementById("__BMF_INTEGRITY_MANIFEST__") !== null,
  );
  expect(present, "production index.html must embed __BMF_INTEGRITY_MANIFEST__").toBe(true);
}

/** Rewrite every cached entry whose pathname matches with tampered bytes. */
async function tamperCacheEntry(page: Page, pathname: string): Promise<number> {
  return page.evaluate(async (target) => {
    const tampered = () =>
      new Response("/* TAMPERED by e2e sw-integrity-tamper.spec.ts */", {
        status: 200,
        headers: { "content-type": "application/javascript" },
      });
    let touched = 0;
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      for (const key of await cache.keys()) {
        if (new URL(key.url).pathname === target) {
          await cache.put(key, tampered());
          touched += 1;
        }
      }
    }
    return touched;
  }, pathname);
}

/** Count cached entries for a pathname across every Cache Storage bucket. */
async function countCached(page: Page, pathname: string): Promise<number> {
  return page.evaluate(async (target) => {
    let total = 0;
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const key of await cache.keys()) {
        if (new URL(key.url).pathname === target) total += 1;
      }
    }
    return total;
  }, pathname);
}

/** Collect every 504 answered while the page is under the SW's control. */
function collect504s(page: Page): string[] {
  const hits: string[] = [];
  page.on("response", (res) => {
    if (res.status() === 504) hits.push(new URL(res.url()).pathname);
  });
  return hits;
}

test("baseline: SW installs, controls the page, and serves the clean build", async ({
  page,
}) => {
  const hits = collect504s(page);
  await bootWithSw(page);
  await expectManifestPresent(page);

  const names = await page.evaluate(() => caches.keys());
  expect(names.length).toBeGreaterThan(0);

  expect(hits, "a clean build must not produce any SW integrity 504s").toEqual([]);
});

test("precache tamper: tampered entry chunk is 504'd, evicted, and self-heals", async ({
  page,
}) => {
  await bootWithSw(page);
  await expectManifestPresent(page);

  const entryPath = await page.evaluate(() => {
    const script = document.querySelector('script[type="module"]');
    return script ? new URL((script as HTMLScriptElement).src).pathname : null;
  });
  expect(entryPath).not.toBeNull();
  expect(await countCached(page, entryPath!)).toBeGreaterThan(0);
  expect(await tamperCacheEntry(page, entryPath!)).toBeGreaterThan(0);

  // Tamper → reload → the SW must answer 504 for the poisoned chunk.
  const tampered = page.waitForResponse(
    (res) => res.status() === 504 && new URL(res.url()).pathname === entryPath,
    { timeout: BOOT_TIMEOUT },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await tampered;
  await page.waitForLoadState("domcontentloaded");

  // Fail-closed eviction: the poisoned entry must be gone from every bucket.
  expect(await countCached(page, entryPath!)).toBe(0);

  // Self-heal: next reload fetches the real chunk from the network.
  const recovered = page.waitForResponse(
    (res) => res.status() === 200 && new URL(res.url()).pathname === entryPath,
    { timeout: BOOT_TIMEOUT },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await recovered;
  await page.waitForSelector("#root > *");
});

test("runtime cache tamper: tampered lazy locale is 504'd, evicted, and self-heals", async ({
  page,
}) => {
  await bootWithSw(page);
  await expectManifestPresent(page);

  // Locales are served StaleWhileRevalidate and cached on first use — the
  // lazy-path class the DOM-side check could never see (audit B-1).
  const localePath = "/locales/en.json";
  expect(await countCached(page, localePath)).toBeGreaterThan(0);
  expect(await tamperCacheEntry(page, localePath)).toBeGreaterThan(0);

  const tampered = page.waitForResponse(
    (res) => res.status() === 504 && new URL(res.url()).pathname === localePath,
    { timeout: BOOT_TIMEOUT },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await tampered;
  await page.waitForLoadState("domcontentloaded");

  expect(await countCached(page, localePath)).toBe(0);

  const recovered = page.waitForResponse(
    (res) => res.status() === 200 && new URL(res.url()).pathname === localePath,
    { timeout: BOOT_TIMEOUT },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await recovered;
  await page.waitForSelector("#root > *");
});

test("negative control: unlisted cache entries pass through untouched", async ({
  page,
}) => {
  const hits = collect504s(page);
  await bootWithSw(page);
  await expectManifestPresent(page);

  // A cache entry for a path the manifest does NOT pin. An attacker
  // planting such an entry must not be able to turn it into an app-wide
  // outage — verification is scoped to manifest-listed assets only.
  const unlisted = "/assets/__e2e_not_in_manifest__.js";
  const planted = await page.evaluate(async (url) => {
    const cache = await caches.open("bookmarkforge-e2e-negative");
    await cache.put(
      new Request(url),
      new Response("/* planted but unlisted */", { status: 200 }),
    );
    return true;
  }, unlisted);
  expect(planted).toBe(true);

  // Fetch through the SW: it must NOT be 504'd — it falls through to the
  // network (preview server answers 404 for a nonexistent asset).
  const result = await page.evaluate(async (url) => {
    const res = await fetch(url);
    return { status: res.status, body: await res.text() };
  }, unlisted);
  expect(result.status).not.toBe(504);
  expect(result.body).not.toContain("Integrity check failed");

  // The app stays healthy and no 504 was ever answered.
  await page.waitForSelector("#root > *");
  expect(hits).toEqual([]);
});