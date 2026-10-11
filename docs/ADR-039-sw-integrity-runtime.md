# ADR-039: Asset integrity verification inside the Service Worker (lazy chunks included)

- **Status:** accepted (implemented; anchor `p3-sw-integrity-runtime`)
- **Date:** 2026-09-02

## Context

The 2026-09-02 audit (`docs/audit-report-2026-09-02.md`, finding B-1,
the first of the "high-impact improvements") showed that runtime integrity
verification only covered the initial DOM:

1. `checkBundleIntegrity` (`src/utils/bundleIntegrity.ts`) hashes the
   `script[src]` / `link[stylesheet]` / `link[modulepreload]` present at
   startup. Lazy chunks (blocknote, pdf, WebLLM, locales — the same ones
   the SW serves via CacheFirst/StaleWhileRevalidate) load afterwards and
   are never re-hashed.
2. The MutationObserver (`startScriptInjectionGuard`) only sees `<script>`
   elements; a chunk delivered to a dynamic `import()` never goes through it.

An attacker with write access to the origin (compromised deploy, poisoned CDN,
cache poisoning) could serve a modified chunk after boot without triggering
`bundle-integrity-failed`.

## Decision

1. **The verification point is the Service Worker** — the bottleneck
   through which EVERY served asset passes. Two `vite.config.ts` plugins
   collaborate:
   - `bookmarkforge:integrity-manifest` writes `dist/integrity-manifest.json`
     (a copy of the verified surface, single source of truth for the
     embed and for tooling/diagnostics);
   - `bookmarkforge:sw-integrity-embed` — a DEDICATED plugin with
     `closeBundle: { order: "post" }` — embeds that manifest JSON and the
     runtime `scripts/sw-integrity-runtime.js` at the START of the Workbox-generated
     `sw.js` (byte 0). The `order: "post"` is mandatory:
     vite-plugin-pwa writes `sw.js` in its OWN closeBundle and hooks
     without `order` run in array order (verified empirically — a
     "reverse order" assumption made the embed silently skip
     because `sw.js` did not exist yet). The embed is idempotent (markers
     `__BMF_SW_INTEGRITY_EMBED_START__/END__`); the manifest assignment
     ends in `;` to avoid the ASI join with the runtime IIFE (real
     bug caught by artifact verification: the full SW
     threw a TypeError when evaluated). The runtime wraps
     `FetchEvent.prototype.respondWith`, so its coverage does not depend
     on the registration order of the Workbox routes.
   - `sw.js` and `index.html` are excluded from the manifest
     (self-referential).
2. **Fail-closed runtime** (`scripts/sw-integrity-runtime.js`, pure script
   body, no imports/exports): it wraps `FetchEvent.prototype.
   respondWith`; for a same-origin GET whose pathname is in the manifest it
   hashes the body (SHA-256 WebCrypto) and on mismatch responds **504** (the
   chunk NEVER executes), deletes the poisoned entry from all caches
   (`ignoreSearch` for revisioned precache URLs) and notifies
   clients with `postMessage({type:"bundle-integrity-failed", reason:
   "sw-cache-handler", …})`. Without a manifest (dev/test) nothing is patched.
3. **Bridge to the existing contract:** `initSwIntegrityBridge`
   (`src/utils/swIntegrityBridge.ts`, wired in `main.tsx`) replays the SW
   message as a `window` CustomEvent `bundle-integrity-failed`, so
   AppInitializer (recovery screen) and `telemetry/productionMonitor`
   react with no changes.
4. **Build gate (scripts/build-ci.mjs):** `build:ci` verifies that the
   embed exists exactly once at byte 0 of `sw.js`, extracts the
   embedded manifest (without self-references), EXECUTES the embedded bytes
   against a synthetic SW environment and tests the verdicts: runtime active,
   `respondWith` wrapped, genuine asset verified and altered byte
   rejected — on a REAL asset from `dist/`. This turns the two classes of failure found during
   development into a CI
   failure (silent embed skip due to hook order; ASI TypeError on evaluation).
5. **Anchored regression:** `src/tests/security/p3-sw-integrity-runtime.
   regression.test.ts` (anchor `p3-sw-integrity-runtime` in
   `scripts/audit-anchors.mjs` + baseline) pins the three seams; the runtime's
   behavior is tested by executing the real bytes against
   a synthetic SW (`scripts/__tests__/sw-integrity-runtime.test.mjs`).

## Consequences

- Integrity moves from "initial DOM" to "the whole runtime": every asset response
  served by the SW — precache and lazy chunks alike — is verified against the
  manifest before it reaches the page; a modified chunk becomes
  a 504 + audit event, not code in execution.
- Bounded and accepted cost: SHA-256 per served response (no memo, because
  a cache entry can be rewritten after a first verified hit); the
  largest custodied asset is the WebLLM chunk (~6.5 MB ≈ 10 ms once per
  load). Non-GET, cross-origin, unlisted and non-ok requests pass through untouched.
- `sw.js` and `index.html` are outside the hash for self-reference; their
  protection is the server transport + SRI for the HTML, and the
  browser's byte-diff in the SW update checks.
- The notification enters through the same `bundle-integrity-failed` contract, so
  the monitoring spike alert (`bundle-integrity-spike`, 3
  failures/5 min) and the AuditLog entry apply without duplicating channels.
