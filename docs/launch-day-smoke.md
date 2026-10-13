# Launch runbook — Critical routes smoke (BookmarkForge)

> **What it is:** Playwright battery that exercises the four critical paths that
> CANNOT fail on launch day: vault creation with 12-character password, recovery
> with 24-word phrase, Pro license activation (including invalid key check, which
> must fail closed) and the encrypted `.bmf` backup round-trip after a simulated
> total loss. On launch day run `npm run launch:smoke:prod`, which tests the
> production build (`vite preview`), not the dev server.

- **Author:** single-use script `node scripts/run-launch-smoke.mjs` (do not call Playwright directly: the runner cleans orphan ports and verifies prerequisites).
- **Spec:** `tests/e2e/launch-smoke-critical-paths.spec.ts` (7 tests, ~2 min).
- **Profile:** `playwright.launch-smoke.config.ts` — 3 servers orchestrated with `webServer` as array (spread) so it **replaces** the base config's `webServer` instead of concatenating with it.

## Command

```bash
npm run launch:smoke:prod    # production mode (build + vite preview) — use this on launch day
npm run launch:smoke         # dev mode (fast, for iteration)
```

## What the runner does

1. Verifies release destination (ADR-058): `bookmarkforge/bookmarkforge-2026` is confirmed, the four surfaces match, so the battery starts. If the checkout points again to a provisional slug, to a template owner or declares a destination different from the remote, it would refuse to start — a green verdict cannot certify a release whose cloning points to an unconfirmed repository.
2. Verifies prerequisites (Playwright installed).
3. **Frees the battery ports** (app 4173 in test mode / 4174 in prod, companion 8787, license mock 8082) by killing orphan listeners from previous runs — without this, `reuseExistingServer` can recycle an old server with a broken proxy.
4. Executes the 7 tests and translates the result to a clear launch verdict.

## Topology (production mode)

| Process | Port | Role |
|---|---|---|
| `vite preview` | 4174 | serves `dist/` (production build) and proxies `/api` (the test-mode dev server uses 4173) |
| companion server (signaling + licenses) | 8787 | handles `/api/license/*` with real RSA-PSS signature |
| `scripts/license-mock.mjs` | 8082 | simulated Whop provider (activation + revocation) |

The build is generated with `VITE_E2E_PREVIEW_DIAGNOSTICS=true` to expose the backend diagnostics used by tests. `vite.config.ts` routes local traffic from `/api` → `VITE_API_PROXY_TARGET` (8787 in this profile; the 8799 of `crisis-containment` is an ephemeral companion server for that spec, not the global one). Note: this is Vite's local proxy for development, not the server's AI proxy (which was retired in 2026-09).

## The 7 tests and what they guarantee

1. **12-character password creates functional vault** — the real minimum gate (11 is rejected in test 2 before creating anything).
2. **11 characters rejected in UI** — validator fail-closed.
3. **Recovery with the exact 24 words shown in setup** — captures the phrase from setup screen and unlocks with it.
4. **23 words rejected** — no partial unlock.
5. **Valid license activates via real signing service** — client ↔ companion ↔ provider ↔ signature; the signed state passes client verification (requires that the local private key matches `src/services/licenseKeys.ts`; if not, run `node scripts/generate-license-keys.mjs --write`).
6. **Invalid key fails closed with visible error.**
7. **Encrypted .bmf backup round-trip** — exports via `BackupService` (same code UI calls), destroys IndexedDB (total loss), recreates vault with same password and restores from F0-2 wizard using vault password (vault security data does not travel in backup).

## Failure triage

- **Transient failure `browser has been closed`:** infrastructure flake — re-run isolated before investigating (`npx playwright test --config=playwright.launch-smoke.config.ts -g "test name"`).
- **`ECONNREFUSED 8787` or 502 in license:** orphan process or dead mock — re-run the runner (runner step 2 avoids most); ultimately close node processes manually and retry.
- **`Signed license state failed verification`:** key desynchronization — `node scripts/generate-license-keys.mjs --write` (regenerates private pair + committed public keys as coherent set) and retry.
- **Export never downloads:** the `showSaveFilePicker` stub must be registered with `addInitScript` **before** the initial `goto` (init scripts only apply to future navigations).
- **Row does not appear after restore:** vault opens in Dashboard — navigate explicitly to Bookmarks before asserting.
- **Timeout in recovery after previous rejection:** `RecoveryService` limits to one attempt every 2 s (`MIN_INTERVAL_MS = 2000`) — let the helper wait the window.

## Second and third browser engine (firefox + webkit)

The same critical routes run on the other two engines with:

```bash
npx playwright install firefox webkit   # once
npm run e2e:engines                     # both engines (or -- --project=webkit)
```

Profile: `playwright.engines.config.ts` (same topology as this battery, own ports). License tests are skipped with marker if there is no signing key (e.g. CI). In CI: job `e2e-engines`. Note ARM64 Windows: Playwright's WebKit runs emulated — can be slow or OOM if there are orphan processes; CI on Linux x64 is the reference.

## Relationship with launch checklist

Item 16 of [docs/launch-checklist.md](launch-checklist.md). Everything green here is a prerequisite to mark the release; a single red = do not launch.
