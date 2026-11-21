/**
 * scripts/sw-integrity-runtime.js — ADR-039
 *
 * Service-worker-side integrity verification for EVERY response the SW
 * serves (precache and lazy CacheFirst/StaleWhileRevalidate routes alike).
 *
 * Why: the DOM-side check (src/utils/bundleIntegrity.ts) only hashes assets
 * present in the initial document, and the MutationObserver only sees
 * <script> elements. A tampered LAZY chunk (blocknote, pdf, WebLLM, locales)
 * delivered by `import()` after boot bypassed both — the 2026-09-02 audit
 * finding B-1 (docs/audit-report-2026-09-02.md). This runtime closes that
 * gap at the choke point every chunk crosses: the service worker's fetch
 * handler.
 *
 * Build contract (bookmarkforge:integrity-manifest plugin in vite.config.ts):
 * this file's contents are APPENDED VERBATIM to the generated dist/sw.js,
 * preceded by `self.__BMF_SW_INTEGRITY_MANIFEST__ = {...}`. No imports or
 * exports are allowed here — it must survive as a bare script body.
 *
 * Semantics (fail-closed):
 *   - Only same-origin GET-served responses whose pathname exists in the
 *     manifest are verified; everything else passes through untouched
 *     (/api/*, navigations, cross-origin, unlisted paths).
 *   - A hash mismatch returns HTTP 504 to the page (the chunk NEVER
 *     executes), deletes the poisoned entry from every Cache Storage
 *     bucket, and notifies all window clients with the same
 *     `bundle-integrity-failed` contract the app already handles
 *     (AppInitializer + telemetry/productionMonitor).
 *   - Absence of the manifest disables verification (dev/test builds and
 *     the HMR path); the build gate (build:ci secret-scan/SRI) guarantees
 *     the manifest is embedded in production artifacts.
 *
 * Note: console.* is the only channel available inside the generated SW
 * (src/utils/logger cannot be imported into a verbatim script body); it is
 * visible in chrome://serviceworker-internals and never carries secret data.
 */

(function () {
  "use strict";

  const manifest = self.__BMF_SW_INTEGRITY_MANIFEST__;
  const files =
    manifest && manifest.files && typeof manifest.files === "object"
      ? manifest.files
      : null;
  const enabled = Boolean(files && Object.keys(files).length > 0);

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex;
  }

  function toSameOriginPathname(url) {
    try {
      const parsed = new URL(url, self.location.origin);
      if (parsed.origin !== self.location.origin) {
        return null; // cross-origin — never verified, never blocked here
      }
      return parsed.pathname;
    } catch {
      /* INTENTIONAL SILENCE: an unparseable URL cannot be matched against
         the manifest, so it falls through unverified rather than being
         misreported as tampering. */
      return null;
    }
  }

  function notifyClients(payload) {
    if (!self.clients || typeof self.clients.matchAll !== "function") {
      return;
    }
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          client.postMessage(payload);
        }
      })
      .catch(() => {
        /* INTENTIONAL SILENCE: client notification is best-effort; the 504
           returned to the page is the authoritative fail-closed signal. */
      });
  }

  async function deleteFromAllCaches(pathname) {
    if (!self.caches) {
      return;
    }
    try {
      const names = await self.caches.keys();
      for (const name of names) {
        const cache = await self.caches.open(name);
        // ignoreSearch: Workbox precache URLs can carry revision params.
        await cache.delete(pathname, { ignoreSearch: true });
      }
    } catch {
      /* INTENTIONAL SILENCE: eviction is defense-in-depth on top of the 504;
         a failure here must not mask the integrity failure itself. */
    }
  }

  /**
   * True when `response` is a verifiable same-origin manifest asset with
   * matching bytes. Non-ok, cross-origin and unlisted responses pass.
   */
  async function verifyResponse(requestUrl, response) {
    if (!enabled || !response || !response.ok) {
      return true;
    }
    const pathname = toSameOriginPathname(requestUrl);
    if (pathname === null) {
      return true;
    }
    const expected = files[pathname];
    if (!expected) {
      return true;
    }
    let body;
    try {
      body = await response.clone().arrayBuffer();
    } catch {
      /* INTENTIONAL SILENCE: if the body cannot even be read, it cannot be
         trusted either — treat it as a mismatch (fail closed). */
      return false;
    }
    const actual = await sha256Hex(body);
    return actual === expected;
  }

  function reportMismatch(pathname, actual, expected) {
    console.error(
      "[sw-integrity] Hash mismatch — serving 504 and evicting cache entry",
      {
        file: pathname,
        expected: String(expected).substring(0, 16) + "...",
        actual: actual.substring(0, 16) + "...",
      },
    );
    notifyClients({
      type: "bundle-integrity-failed",
      mismatchedFiles: [pathname],
      reason: "sw-cache-handler",
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Wraps a Workbox handler promise: verifies the produced response and
   * replaces it with a 504 when verification fails.
   */
  async function guardResponse(requestUrl, responsePromise) {
    const response = await responsePromise;
    const verified = await verifyResponse(requestUrl, response);
    if (verified) {
      return response;
    }
    const pathname = toSameOriginPathname(requestUrl) ?? requestUrl;
    let actual = "";
    try {
      const bytes = await response.clone().arrayBuffer();
      actual = await sha256Hex(bytes);
    } catch {
      /* INTENTIONAL SILENCE: diagnostic-only — the mismatch is already
         decided and reported below. */
    }
    reportMismatch(pathname, actual, files[pathname] ?? "");
    await deleteFromAllCaches(pathname);
    return new Response("Integrity check failed", {
      status: 504,
      statusText: "Integrity check failed",
    });
  }

  // Install the FetchEvent.respondWith wrapper. Running AFTER the Workbox
  // listeners are registered is irrelevant: respondWith is resolved per
  // dispatch, so patching the prototype affects every later fetch event.
  if (enabled && typeof FetchEvent !== "undefined") {
    const originalRespondWith = FetchEvent.prototype.respondWith;
    FetchEvent.prototype.respondWith = function (responseLike) {
      const request = this.request;
      const requestUrl = request ? request.url : "";
      const pathname =
        request && request.method === "GET"
          ? toSameOriginPathname(requestUrl)
          : null;
      // Guard only assets the manifest pins (lazy chunks, locales, precache
      // entries). Every response is re-verified on each serve — no memo —
      // because a cache entry can be rewritten after a first verified hit.
      // Cost is bounded: SHA-256 via WebCrypto runs at GB/s; the largest
      // guarded asset is the ~6.5 MB WebLLM chunk (~10 ms, once per load).
      if (!pathname || !files[pathname]) {
        return originalRespondWith.call(this, responseLike);
      }
      const guarded = guardResponse(requestUrl, Promise.resolve(responseLike));
      return originalRespondWith.call(this, guarded);
    };
  }

  // Test/diagnostic surface (harmless in production; the build strips
  // nothing — these are plain properties on the SW global).
  self.__BMF_SW_INTEGRITY__ = {
    enabled,
    verifyResponse,
    guardResponse,
  };
})();
