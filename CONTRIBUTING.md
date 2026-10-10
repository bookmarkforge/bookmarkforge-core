# Contributing to BookmarkForge

BookmarkForge follows an **Open Core** model. Contributions to the public Core
are accepted under MIT; Pro components in the private checkout are proprietary
and must not be copied into the public export. Read `OPEN-CORE.md` and
`PRO-LICENSE.md` before changing a boundary.

> BookmarkForge is a **local-first, privacy-preserving** AI knowledge vault
> (React 19 / Vite 8 / RxDB 17 / IndexedDB / WebCrypto AES-GCM + Argon2id).
> It stores personal data: **default to fail-closed, zeroize, least privilege**.
> These contracts are enforced by real gates — read `AGENTS.md` before touching
> security-adjacent code.

This document describes the development workflow for code, tests, docs, and
release hygiene. It is a companion to `AGENTS.md` (engineering conventions) and
`docs/audit.md` (audit record); where they differ, the more specific document
wins.

---

## 1. Finding your way in

- **Frontend:** React + TypeScript + Vite; heavy routes and features are lazy.
- **Persistence:** RxDB over IndexedDB; schemas in `src/db`.
- **Cryptography:** `EncryptionService` delegates to `crypto.worker.ts`; AES-GCM
  with Argon2id/HKDF derivation.
- **Domain services:** `src/services` for backup/restore, sync, licensing, AI,
  consent, analytics, sanitization.
- **Companion server:** `server/src` is a minimal HTTP + WS server for
  licensing/entitlement, client events, analytics, and P2P signaling. There is
  **BYOK AI**: provider calls go from the browser straight to the provider
  the user configured.
- **Sync:** WebRTC transports data; WS is signaling only; TURN is optional with
  ephemeral credentials.
- **Operations:** Docker Compose separates `web` and `api` (both stateless, no
  Redis); the reverse proxy terminates TLS and serves assets.

Trust boundaries are documented in `docs/architecture.md`. Layer rules are
enforced by `npm run check:boundaries`.

---

## 2. Communication and issue hygiene

- Prefer the existing docs over a fresh question. If something in this document
  or in `AGENTS.md` is ambiguous, say so in the issue/PR rather than guessing.
- Security-sensitive reports should follow the project's existing disclosure
  expectations; do not file sensitive security details in a public issue until
  the maintainer says to.
- Keep user-facing strings localized through `t()` — hardcoded UI strings fail
  `check:i18n` / `check:english-only`.

---

## 3. Coding conventions

- TypeScript strict mode; ESLint 9 with `typescript-eslint` and custom rules.
- Security-significant changes carry a header anchor to the decision record:
  `// ADR-019: …`, or audit round codes such as `// S1/R3: …`, `// P92: …`,
  `// H5: …`, `// B28: …`.
- Never swallow errors silently. A deliberately empty `catch` must explain why:
  `catch { /* INTENTIONAL SILENCE: precise reason */ }`.
- Use `src/utils/logger` in app code (not `console.*`). Bound repeated noise with
  `logRateLimited` (`src/utils/boundedLog`); redact secrets with `redactSecrets`
  before logging or persisting. User-facing errors must never leak raw
  `SyntaxError.message`, stack frames, or secret material.
- Keep secrets as bytes end to end. Do not decode them into immutable JS strings.
  See `AGENTS.md` §1 for the password-buffer ownership and zeroization contract.

### Layer rules (enforced by `npm run check:boundaries`)

- `components` must NOT import `workers`, `memory`, or `db` directly.
  Bootstrap (`initDB`/`destroyDB`) goes through
  `src/container/database.ts` (the sanctioned gate, including dynamic
  `import("…/container/database")`).
  Data access goes through `src/services/*` or zustand stores.
- `workers` must NOT import `components` or `memory`; `memory` must NOT import
  `components` or `workers`; `hooks` must NOT import `components`.
- Type-only imports are exempt (erased at compile time; RxDB collection types
  such as `BookmarkDocType`/`BookmarkForgeDB` cross layers freely).
- The allowlist (`scripts/context-boundaries.allowlist.json`) must stay **empty** —
  a new runtime edge must be refactored, not allowlisted.

---

## 4. Git workflow

### Branch naming

Branch names are a coordination tool, not a formal lifecycle. Recommended
conventions:
- `feat/<short-slug>` for new functionality
- `fix/<short-slug>` for bug fixes
- `docs/<short-slug>` for documentation-only changes
- `security/<short-slug>` for security hardening

Keep branch names short, ASCII-friendly, and hyphenated. Avoid vague names like
`update`, `fix`, `patch`.

### Commit messages

- Write the subject as a complete sentence describing **why** more than **what**.
- Avoid generic subjects such as "Update" or "Fix" without context.

### Review model

This repository is operated by a single maintainer. Review is therefore
automated-first:

- Changes to `main` are expected to go through a Pull Request with the required
  checks passing.
- The required checks are defined locally in `.github/rulesets/main-protection.json`.
- Import/activate the ruleset on the host before relying on it; see
  `.github/branch-protection.md` and `docs/launch-checklist.md` item 2.

If you are reviewing a PR (even your own), at minimum:
- Look at the diff, not only at the summary.
- Confirm that security-sensitive files mention the relevant ADR/audit anchor.
- Confirm that any new user-facing string passes i18n gates.
- Confirm that new runtime edges did not go through the allowlist.

### Protected history

The project aims for linear protection on `main`:
`required_linear_history`, no force-push, PR-only landing, with required status
checks. `AGENTS.md` notes that this checkout currently has **no
`.husky/pre-commit` hook file** — CI is the enforcement point, not a local hook.

---

## 5. Development environment

- Node ≥ 24.17.0 (see `engines` in `package.json`).
- Install with the project's package manager as defined in `package.json`.
- Copy `.env.example` to `.env` and adjust locally. `VITE_*` variables are
  inlined into the client bundle by Vite — never put real keys there.
- Cloud AI calls are made directly by the browser to the provider selected by
  the user, using credentials stored in the encrypted vault. Do not configure
  server-side AI keys or proxy URLs; `assertValidForBuild` rejects provider keys
  accidentally bundled into the client.

Useful local commands:
- `npm run dev`
- `npm run typecheck:prod`
- `npm run lint` (domain-scoped ESLint; for full monolithic diagnostics use `npm run lint:all`)
- `npm run test:fast` (successful test logs are suppressed by default; use `BMF_TEST_LOGS=full` for diagnostics)
- `npm run ci:local` = `typecheck:prod && lint && test:fast && build:ci && check`

### Manual command surface (not part of `npm run check`)

`scripts/check-script-reachability.mjs` fails when a declared script has no
entry point, and this table is the entry point for the commands below: they are
run by hand on purpose, and `check:documented-npm-commands` verifies every name
here still exists.

| Command | What it is for |
|---|---|
| `npm run test:watch` | Vitest in watch mode for the file you are editing. |
| `npm run test:rollback` | Unit tests for the pure decision logic of `scripts/rollback.mjs`. |
| `npm run test:staging-policy` | Staging target policy and HTTP checks, run by hand against staging. |
| `npm run test:timing` | Slowest test files, for the timing budget (diagnostic, not a gate). |
| `npm run whop:test` | Whop service unit tests. |
| `npm run whop:validate` | Runs the Whop integration service against the configured sandbox. |
| `npm run e2e:headed` | E2E with a visible browser, for debugging one spec. |
| `npm run e2e:browsers` | Cross-browser E2E config (Chromium, Firefox, WebKit). |
| `npm run e2e:human-like:browsers` | The human-like example suite across Chromium, Firefox and WebKit (`playwright.human-like.browsers.config.ts`); needs `npx playwright install firefox webkit`. |
| `npm run e2e:batched` | Memory-bounded runner that walks the whole E2E suite in batches. |
| `npm run e2e:visual` | Visual-regression spec (`tests/e2e/visual-testing.spec.ts`). |
| `npm run e2e:visual:browsers` | The same visual spec across the browser configs. |
| `npm run dev:extension` | Loads the extension build for manual iteration. |
| `npm run server:watch` | Signaling server with restart-on-change. |
| `npm run health:dashboard` | Real-time terminal health dashboard (local probing, not a gate). |
| `npm run check:nightly` | The nightly surface locally: pre-deploy gates + audit + the slow suite. |
| `npm run ci:local:parallel` | Dependency-aware scheduler for the local CI gates. |
| `npm run ci:local:e2e` | `ci:local` plus the browser suites. |
| `npm run gate:refresh` | One ordered regeneration pass for the drift-sensitive artifacts. |
| `npm run check:landing-smoke` | Opens the 31 landing routes in Chromium: navigation, critical resources, links and console errors (ADR-062). Needs `npx playwright install chromium`. |
| `npm run benchmark:import-csv` | Importer benchmark over a large CSV. |
| `npm run benchmark:storage` | Storage benchmark (Dexie vs the RxDB SQLite trial). |
| `npm run charts:webrtc-recovery` | Renders `webrtc-recovery-history.json` as a self-contained HTML trend page. |
| `npm run check:vacuous-tests` | Assertion-integrity ratchet for the E2E suites: fails if a test that passes when its feature is absent is added without a baseline entry, and verifies the declared suite sizes in `docs/ops-nightly.md` match the tree. The current debt (1589 of 2050 tests in the human-like suite) is baselined on purpose — see `docs/PENDIENTES.md`. |
| `npm run history:webrtc-recovery` | Appends one WebRTC recovery summary to the nightly history file. |
| `npm run report:webrtc-handshake` | Per-browser handshake diagnostics from a saved Playwright report. |
| `npm run report:webrtc-nightly` | Renders the convergence summary as a Markdown table for PR comments. |

Five rows are gates rather than dev loops: `npm run check:extension-dist` and
`npm run check:model-digests` run on demand. `npm run check:landing-smoke` is
also absent from `npm run check`, but for a different reason — it needs a
Chromium binary and the chain is offline by contract — so it runs in the release
chain (`check:deploy`) and in its own CI step. `npm run
check:audit-script-snapshot` (script-inventory scanner,
`docs/scripts-inventory-scanner-limits.md`) stays out of the chain for a third
reason: its snapshot is gitignored local audit state, so a fresh clone must
regenerate it first (`node scripts/__tests__/audit-script-inventory.test.mjs
--update`). `npm run check:vacuous-tests` is the fourth reason: it is a
nightly-quality report (assertion integrity of the E2E suites + declared-surface
drift in `docs/ops-nightly.md`), not a release blocker, so it runs in the
nightly's `coverage` job and by hand. If any of them moves into `npm run
check`, wire it into the chain and delete its row here.

---

## 6. Mandatory gates before commit / push

This checkout has no `.husky/pre-commit` hook file — CI is the enforcement
point. Run the gates locally; never push without them green.

For the save-edit loop there is a fast tier: `npm run check:quick` (~2.5 s)
re-runs the sub-second security gates ordered by how often they fail first
(boundaries, env, open-core, pro-imports, compose/runtime config, license-keys,
log privacy) with per-gate timing, fail-fast on the first red. It is additive —
not part of the `npm run check` chain, so the inspector freeze (O-1) does not
apply — and it never replaces the full chain before pushing.

```bash
npm run typecheck:prod          # tsc --noEmit (prod tsconfig)
npm run lint                    # node scripts/tooling/lint-bounded.mjs (domain-scoped)
npm run test:fast               # bounded Vitest suites (security, db, services,
                                #   key components, quality-gate script tests —
                                #   count deliberately unnumbered, see ADR-038)
npm run test:slow               # every other test file (~460; CI's slow-tests job
                                #   enforces timing on it; `npm test` is the same
                                #   surface — run it before merging areas the fast
                                #   profile does not cover)
npm run build:ci                # vite build + secret-scan + SRI + integrity
                                #   manifest + chunk-boundary + bundle-size gates
npm run check                   # the full gate chain (~40 check commands + lint):
                                 # open-core, pro-imports, removed-deps, env,
                                 # workflows,
                                 # http-config, compose-config, runtime-config,
                                 # boundaries, e2e-helpers, docs-markdown,
                                 # docs-index, documented-npm-commands,
                                 # documented-doc-references,
                                 # release-target (ADR-058; blocking here and on
                                 #   the release path),
                                 # baseline-drift, baseline-gaps, csp,
                                 # extension-csp, i18n, claim-drift,
                                 # landing-free-plan, pocket-onboarding-copy,
                                 # license-claims, manual-figures, page-figures,
                                 # landings-fresh, english-only, audit-drift,
                                 # override-cve, direct-cve, no-unbounded-text,
                                 # tailwind-drift, rxdb17, static-brand,
                                 # brand-logo, seo, license-keys,
                                 # server-log-ip-privacy, pro-routes, lint,
                                 # chunks, inspector-freeze
```

Two contract gates have their own governing records — read them before
touching the surfaces they guard:

- SEO surface (`check:seo`): `docs/ADR-043-check-seo-gate.md` — canonical /
  hreflang / OG / JSON-LD, noindex of the private app, language negotiation
  and the sitemap contract.
- Brand mark (`check:brand-logo`): `docs/ADR-045-check-brand-logo-gate.md` — every icon PNG and inline brand SVG must match the canonical artwork (`public/icons/logo-512.png`).

- `npm run ci:local` aggregates the CI job (`typecheck:prod && lint &&
  test:fast && build:ci && check`).
- Before a release: `npm run check:launch-checklist:strict` (Sentry DSN/DPA,
  RPO/RTO sign-off and manual WCAG are tracked as open operational items in
  `docs/launch-checklist.md` — see `docs/audit.md` for the known-gap ledger
  and `docs/ROPA.md` for GDPR processing records). This repository is operated
  by a single maintainer; automated checks remain the release control.
- **i18n:** every user-facing string goes through `t()` — hardcoded UI strings
  fail `check:i18n`/`check:english-only`. All 30 locales must stay
  key-complete with matching `{{placeholders}}`; add keys to every locale file
  (`npm run check:i18n:fix` scaffolds).
- **Secrets:** `VITE_*` vars are **inlined into the bundle** by Vite — never
  put real keys in `VITE_*`. There is no server-side AI key: AI provider keys
  live in the user's encrypted vault and are read by the browser only. The
  companion server's only credential is the license signing key. `build:ci`
  runs a literal-secret scan over `dist/` and fails on leaks;
  `check:secrets-in-commit` scans the tree.
- **Dependency CVE gates:** `check:override-cve` and `check:direct-cve` share
  ONE `npm audit --json` acquisition (`scripts/npm-audit-payload.mjs`): the
  first gate runs the audit and the second reads the cached payload (~1.6 s
  together vs ~3.3 s before; measured 2026-09-17). The cache lives under
  `node_modules/.cache/bookmarkforge-npm-audit/` (gitignored, wiped by
  `npm ci`) and a cached payload is valid ONLY while `package.json` and
  `package-lock.json` have not changed since it was written (mtime+size
  fingerprint stored inside the cache file) and its age is under 10 minutes —
  anything else re-runs the audit, so the cache can never vouch for a tree it
  does not describe. Fail-closed is unchanged: an audit that cannot run is
  still a gate failure (exit 2). `BMF_AUDIT_FRESH=1` forces a fresh run and
  `--audit-json <path>` bypasses the cache entirely (the nightly workflow
  uses it).

---

## 7. Testing conventions

- Unit/integration: Vitest, mirrored under `src/tests/` per area
  (`security`, `db`, `services/ai`, `human-like`, `chaos`, `regression`…).
- E2E: Playwright specs in `tests/e2e/` (browsers/multiuser/nightly/human-like
  configs); vault setup runs Argon2id, so on slow runners raise timeouts via
  `E2E_TIMEOUT_MULTIPLIER` instead of deleting waits.
- Live test loop (local): `npm run test:fast:watch` re-runs only the
  fast-profile tests affected by the file you save. For browser-level
  feedback run `npm run e2e:ui` (Playwright UI mode over the full suite,
  affected specs re-run on save) or `npm run e2e:smoke:ui` (UI mode over the
  <60 s critical-vault smoke set in `playwright.smoke.config.ts`); plain
  `npm run e2e:smoke` is the pre-push gate. E2E configs reuse
  already-running servers, and the `--mode test` webServer keeps Argon2id
  on fast test params — never start the dev server for E2E without it
  (~28 s per vault setup otherwise).
- Test profiles: `scripts/test-profiles.mjs` owns the two bounded surfaces —
  `test:fast` (curated smoke + critical areas) and `test:slow` (every other
  file; `npm test` with no selectors runs the same surface). Both are driven
  by `scripts/test-bounded.mjs --profile fast|slow`, which never schedules
  files vitest excludes (`src/tests/scripts/check-rxdb17.test.ts`,
  `src/tests/utils/crypto-core.fuzz.test.ts` — gated by dedicated tooling),
  so scheduled == executed.
- Slow-test guard: the bounded runner pipes each run through
  `scripts/check-test-timing.mjs` — on CI (`CI=true`) a NEW test file at/over
  the profile's bar fails the run naming the culprit: 5 s for `test:fast`,
  10 s for the slow profile (its files are legitimately heavier; a 5 s bar
  would flake), plus 2× its pinned time in
  `scripts/test-timing-baseline.json` for every pinned file; locally it
  warns only. The `slow-tests` CI job enforces timing on the slow profile.
  Re-pin an intended slowdown with `BMF_TEST_TIMING=update` (baseline is
  reviewed in the PR diff); `BMF_TEST_TIMING_OFF=1` is the explicit opt-out.
- Security tests are adversarial, not happy-path: property tests (fast-check),
  fuzzed SSRF gate parity (P81 differential), format-level crypto vectors.
  Tests may not be skipped without a reason — the custom rule
  `no-unexplained-test-skip` enforces it.
- Mock crypto-carefully: `require-securityvault-mock-lock-unlock` demands
  lock/unlock lifecycle symmetry when mocking `SecurityVault`.

When you add tests, prefer the existing area mirror (`src/tests/<area>/…`). If
you are testing a security regression, use the pinned regression layout under
`src/tests/security/p<severity>-<slug>.regression.test.ts` and coordinate with
`scripts/audit-anchors.mjs`; removing or renaming an anchored test is an
ADR-level change.

---

## 8. Documentation and decision records

- Documented decisions use ADR files under `docs/ADR-###-slug.md` — template:
  `Status / Date` then `Context / Decision / Consequences`
  (see `docs/ADR-001-check-static-brand.md`).
- Post-audit security regressions live at
  `src/tests/security/p<severity>-<slug>.regression.test.ts` and are **pinned
  by `scripts/audit-anchors.mjs`** (catalog + `audit-anchors-baseline.json`).
  Removing or renaming an anchored test is an ADR-level change;
  `npm run check:audit-drift` fails on drift.
- README completeness, architecture coverage, and `eslint-rules/` coverage in
  `eslint-rules/README.md` are documented gaps to close when you touch the area.

---

## 9. Repository hygiene

- Ignored (never commit): `dist/`, `coverage/`, `test-results*/`,
  `playwright-report*/`, `tests/e2e/__diffs__/`, `tests/e2e/__snapshots__/`,
  `.env.*` (only `.env.example` is tracked).
- Tracked artifacts: visual baselines under `*.spec.ts-snapshots/`.
  Regenerating them is an intentional act — review pixel diffs; two views
  sharing a byte-identical baseline is a bug (previously found:
  `bookmark-list-empty` == `main-app-layout`). CI enforces this: the
  `visual-baseline-drift` job (`npm run check:baseline-drift`) pixelmaches
  every baseline in the PR head against the merge base and fails when a
  baseline was regenerated with >10% pixel drift, so a content change is
  reviewed instead of silently shipped. The same job also runs
  `check:baseline-gaps`, which statically derives every baseline a spec's
  `toHaveScreenshot` will compare against (locale loops, backstop-set
  guards and template call sites are constant-folded)  and fails when any
  of them is not tracked in git — so a spec-can-reference-but-repo-hasn't-
  committed gap breaks CI instead of auto-writing an unreviewed baseline
  on the first fresh-checkout run.
- Documented baseline acceptances (drift reviewed, kept): 2026-09-02
  `settings-panel` (+54.3%) — the old baseline had captured the App-level
  "Loading…" splash (lazy-chunk race: `Settings` unmounted the whole shell
  while its chunk resolved), i.e. the degenerate-baseline class above; the
  fix adds a local `<Suspense fallback={null}>` in `MainApp` and a dialog
  visibility wait in the spec. The new baseline is the actual panel
  (content-dense, fingerprint-identical to `text-fit-settings-panel-en`,
  byte-stable across two runs).
- Do not stage broadly (`git add -A`); stage exactly what a commit is about.

---

## 10. Releases and pre-launch readiness

- Release preflight runs the same gates as CI plus the stricter launch checklist.
- The launch checklist is in `docs/launch-checklist.md`. It separates
  🔴 blocking, 🟠 external validation, 🟡 early-post-launch, and 🟢
  environment-only (not verifiable from the repository) items.
- Before a release: `npm run check:launch-checklist:strict` (Sentry DSN/DPA,
  RPO/RTO sign-off and manual WCAG are tracked as open operational items in
  `docs/launch-checklist.md` — see `docs/audit.md` for the known-gap ledger
  and `docs/ROPA.md` for GDPR processing records). This repository is operated
  by a single maintainer; automated checks remain the release control.

---

## 11. What not to do

- Do not commit real keys, `.env` files, license-signing keys, tokens, or
  credentials. Run `npm run check:secrets-in-commit` if unsure.
- Do not push to `main` without the gates green.
- Do not add a new layer edge by editing the allowlist; refactor instead.
- Do not skip tests without a reason the custom rule can lint.
- Do not hardcode UI strings; localize them through `t()`.

---

## 12. Quick checklist for a change

Before marking a PR ready:
1. `npm run typecheck:prod`
2. `npm run lint`
3. `npm run test:fast` (and `npm run test:slow` if the change touches areas the
   fast profile does not cover)
4. `npm run build:ci`
5. `npm run check`
6. If the change is security-adjacent: confirm the ADR/audit anchor is present
   and the zeroization/lock/event-redaction contract still holds.
7. If the change touches user-visible text: confirm i18n completeness and
   english-only compliance.
8. If the change adds a new runtime edge: confirm it did not go through the
   allowlist and that `check:boundaries` still passes.

---

## 13. When you are unsure

- Read `AGENTS.md` first; it is the engineering contract.
- If the question is legal/GDPR, read `docs/ROPA.md` and note that it is an
  **operational template, not legal advice**.
- If the question is audit-related, read `docs/audit.md` and the anchored
  regression tests; do not remove an anchored test without an ADR.

---

## 14. Pull-request template (quick reference)

- **What changed and why.**
- **Which gates passed locally** (`typecheck:prod`, `lint`, `test:fast`,
  `build:ci`, `check`).
- **Which surfaces you verified** (vendor, server, extension, E2E, security
  regression tests, i18n, boundaries).
- **Security/audit anchors** added or updated (if any).
- **Open risks** that still need a human decision (legal, ops, store listing,
  SLO/RPO/RTO sign-off).
