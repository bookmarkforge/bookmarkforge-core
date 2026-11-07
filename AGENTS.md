# AGENTS.md — BookmarkForge engineering conventions

BookmarkForge is an **Open Core** project: the public Core is MIT-licensed,
while explicitly identified Pro components remain proprietary. Do not assume
that the root `package.json` license covers every file in the private checkout.

BookmarkForge is a **local-first, privacy-preserving** AI knowledge vault
(React 19 / Vite 8 / RxDB 17 / IndexedDB / WebCrypto AES-GCM + Argon2id).
It stores personal data: **default to fail-closed, zeroize, least privilege**.
These contracts are enforced by real gates — read them before touching
security-adjacent code.

---

## 1. Open Core boundary (MANDATORY)

- Keep the Core/Pro classification synchronized with `OPEN-CORE.md` and
  `scripts/export-public-repo.mjs`.
- Pro code must never enter the public export. Run `npm run check:open-core` after
  changing export rules or feature boundaries.
- New files that implement paid features must be classified before merge; do
  not rely on naming alone as a license boundary.

## 2. Password buffer ownership & zeroization (MANDATORY)

The codebase has an explicit ownership contract for secrets-as-bytes:

- **`crypto-core` CONSUMES password buffers.** Functions like
  `encrypt`/`decrypt`/`encryptWithSessionKey`/`deriveDbKey` zeroize a
  `Uint8Array` password in-place (`zeroPasswordBytes`) after deriving the
  master key. Callers must pass a **fresh copy** if the bytes are needed
  again — reusing a consumed buffer triggers a fail-closed reuse warning.
- **Max-effort zeroization** (`EncryptionService.zeroBytes`): double-fill —
  `fill(0)` → XOR each byte with `0xAA` → `fill(0)` — defeats compiler
  elision.
- **Never decode secrets into immutable JS strings** (strings cannot be
  zeroized). Keep master-password material as bytes end to end.
- `securityVault.withMasterPasswordBytes(caller, fn)` hands the callback a
  **caller-owned copy**; the caller **must `fill(0)` it in a `finally`** on
  every path (success and failure). Access is restricted: the caller must be
  registered via `securityVault.registerCaller(caller)` or the call throws.
  Example: `MutationGuard.sign`, `AttestationChain.sign`, `BackupService`.
- Domain-separated key material must be built in a **single contiguous
  `Uint8Array`** (never a spread into a number array, which leaves an
  un-zeroizable heap copy), imported, then zeroized in `finally`.
- **Lock boundaries are life/death for keys.** Async work that started while
  unlocked must re-check the lifecycle (`deviceKeyLifecycle`, lock promise)
  before materializing keys back into memory after a lock. The session-key
  cache (`resetSessionKeyCache`) is cleared on lock — never resurrect it.
- Wire formats (keep them stable): `v6:` =
  base64(`vault_salt(16) || hkdf_salt(16) || iv(12) || ciphertext`) — the
  per-vault KDF salt is embedded, so decryption never depends on local salt
  state (ADR-046); `v5:` = `hkdf_salt(16) || iv(12) || ciphertext` is legacy
  read-only, opportunistically re-wrapped on unlock (sunset proposal:
  `docs/ADR-052-v5-format-sunset.md`); `v4:` = `salt(16) || iv(12) ||
  ciphertext`; `v2:` is legacy read-only PBKDF2. New code writes `v6:`.
- Device-key separation (S9): the device-key JWK lives in **sessionStorage**
  (`bmf_device_key_jwk`, cleared when the tab closes — H2) and ciphertexts in
  IndexedDB — **both** surfaces are needed to decrypt. With a master password
  the JWK is wrapped (H5); never persist a plaintext copy. This line said
  "localStorage" until 2026-10-20; the code moved to sessionStorage so a later
  XSS cannot exfiltrate a key that outlives the session.

## 3. Header anchor convention (ADR / audit references)

- Security-significant changes carry a header anchor mapping to the decision
  record: `// ADR-019: …`, or audit round codes such as `// S1/R3: …`,
  `// P92: …`, `// H5: …`, `// B28: …` (security/privacy/hygiene/… items from
  `docs/audit.md`). Keep the anchor when you touch the file; add one for new
  hardening work.
- Standing decisions get a file at `docs/ADR-###-slug.md` — template:
  `Status / Date` then `Context / Decision / Consequences`
  (see `docs/ADR-001-check-static-brand.md`).
- Post-audit security regressions live at
  `src/tests/security/p<severity>-<slug>.regression.test.ts` and are **pinned
  by `scripts/audit-anchors.mjs`** (catalog + `audit-anchors-baseline.json`).
  Removing or renaming an anchored test is an ADR-level change;
  `npm run check:content` fails on drift.

## 4. Error handling: `INTENTIONAL SILENCE`

- **Never swallow errors silently.** A deliberately empty `catch` must say so:
  `catch { /* INTENTIONAL SILENCE: <precise reason> */ }`.
- Use `src/utils/logger` in app code (not `console.*`); bound repeated noise
  with `logRateLimited` (`src/utils/boundedLog`); redact secrets with
  `redactSecrets` before logging or persisting. User-facing errors must never
  leak raw `SyntaxError.message`, stack frames, or secret material
  (`src/telemetry/sanitize.ts` applies to the error pipeline). Note: telemetry
  collection has been removed from the application, but error sanitization
  remains for local logging.

## 5. Layer rules (enforced by `npm run check:quality`)

- `components` must NOT import `workers`, `memory`, or `db` directly.
  - Bootstrap (`initDB`/`destroyDB`) goes through
    `src/container/database.ts` (the sanctioned gate, incl. dynamic
    `import("…/container/database")`).
  - Data access goes through `src/services/*` or zustand stores.
- `workers` must NOT import `components` or `memory`; `memory` must NOT import
  `components` or `workers`; `hooks` must NOT import `components`.
- **Type-only imports are exempt** (erased at compile time; RxDB collection
  types such as `BookmarkDocType`/`BookmarkForgeDB` cross layers freely).
- The allowlist (`scripts/context-boundaries.allowlist.json`) must stay
  **empty** — a new runtime edge must be refactored, not allowlisted.

## 6. Mandatory gates before commit / push

> Note: `lint-staged` is configured and `husky` is in `prepare`, but this
> checkout has **no `.husky/pre-commit` hook file** — CI is the enforcement
> point. Run the gates locally; never push without them green.

> For a complete guide to all 117 NPM scripts, see [docs/npm-scripts-guide.md](docs/npm-scripts-guide.md).

```bash
npm run typecheck:prod          # tsc --noEmit (prod tsconfig)
npm run typecheck:server        # tsc --noEmit (server + api tsconfig)
npm run lint                    # ESLint scoped by domain (no global 4 GiB heap)
npm run test:fast               # bounded Vitest suites (security, db, services,
                                #   key components; successful-test logs are
                                #   suppressed by default; use BMF_TEST_LOGS=full
                                #   for diagnostic output)
npm run test:slow               # every other test file (~460; CI's slow-tests job
                                #   enforces timing on it; `npm test` is the same
                                #   surface — run it before merging areas the fast
                                #   profile does not cover)
npm run build:ci                # vite build + secret-scan + SRI + integrity
                                #   manifest + chunk-boundary + bundle-size gates
npm run check                   # the full gate chain (~50 check commands + lint):
                                 # open-core, pro-imports, removed-deps, env,
                                 # workflows,
                                 # http-config, compose-config, runtime-config,
                                 # boundaries, e2e-helpers,
                                 # e2e-fixture-neutralization, docs-markdown,
                                 # docs-index, documented-npm-commands,
                                 # npm-alias-references,
                                 # documented-doc-references,
                                 # release-target (ADR-058; blocking here and on
                                 #   the release path),
                                 # baseline-drift, baseline-gaps, csp,
                                 # extension-csp, i18n, claim-drift,
                                 # landing-free-plan, landing-root,
                                 # pocket-onboarding-copy,
                                 # license-claims, manual-figures, page-figures,
                                 # landings-fresh, english-only, audit-drift,
                                 # override-cve, direct-cve, no-unbounded-text,
                                 # tailwind-drift, rxdb17, static-brand,
                                 # brand-logo, seo, license-keys,
                                 # server-log-ip-privacy, pro-routes, lint,
                                 # chunks, script-reachability,
                                 # inspector-freeze

> Gates run separately in CI (not part of `npm run check`):
> `check:e2e-selectors`, `check:performance`,
> `check:zap-context`, `check:audit-drift:strict`,
> `check:audit-drift:strict-discovery`.
> Where they run: `check:performance` in the `build` job of `ci.yml`,
> `check:e2e-selectors` in that file's `quality` job, `check:zap-context` in
> `dast-nightly.yml`; `check:audit-drift:strict` and
> `check:audit-drift:strict-discovery` are by-hand modes no workflow runs.
> The dev-dependency CVE scan is not one of them and has no gate-form npm
> alias (`npm run check:security` runs the same scan in report mode): `nightly.yml`
> runs `node scripts/check-direct-cve.mjs --include-dev ...` directly.

```

- **The EN landing has ONE source.** `public/landing.html` (written by
  `scripts/build-landings.cjs`, registered as the `en` landing in
  `scripts/landing-registry.mjs`) is the document every host serves at `/`.
  Both retired copies were removed: `public/index.html` (the duplicate root
  document) and the repo-root `index.html`. `/index.html` is a permanent
  redirect to `/` on all four hosts, and the SPA shell lives at `/app`
  (`app.html`, the only Vite HTML entry, which the dev server serves at `/app`
  while `/` stays the landing). `check:landing-root` fails when a host answers
  `/` with another document, when the hosts disagree with each other, or when a
  duplicate root document comes back.
- **The legal notice is published in six languages only** (en, es, fr, de, pt,
  it — the reviewed primaries). The other 24 locales have no legal page:
  `/<lang>/privacy-and-terms.html` answers with the authoritative English
  notice (Netlify `public/_redirects`, Vercel `vercel.json` and the
  self-hosted `nginx.conf` all redirect it). `scripts/legal-identity.mjs` is
  the single source of truth for the controller identity (operator,
  establishment, contact address) and `check:legal-consolidation` fails when
  a legal surface drifts from it, when the private register and a published
  notice declare different sub-processors, or when an `evidence_ref` folder
  does not exist. See ADR-070.
- `npm run ci:local` aggregates the CI job (`typecheck:prod &&
  typecheck:server && lint && test:fast && build:ci && check`).
- Before a release: `npm run check:launch-checklist:strict` (Sentry DSN/DPA,
  RPO/RTO sign-off and manual WCAG are tracked as open operational items in
  `docs/launch-checklist.md` — see `docs/audit.md` for the known-gap ledger
  and `docs/ROPA.md` for GDPR processing records). This repository is operated
  by a single maintainer; automated checks remain the release control.
- **i18n:** every user-facing string goes through `t()` — hardcoded UI strings
  fail `check:i18n`/`check:english-only`. All 30 locales must stay
  key-complete with matching `{{placeholders}}`; add keys to every locale file
  (`npm run check:content` scaffolds). Two namespaces (ADR-071): `app` at
  `public/locales/<lng>.json` is what the shell boots from, `landing` at
  `public/locales/landing/<lng>.json` is **generated** from
  `scripts/translations/*.json` by `scripts/generate-landing-namespace.mjs`
  (never edit it by hand — `--check` is in `check:content`) and is fetched on
  demand through `loadLandingNamespace()`.
- **Repository prose is English.** `src/` is covered by `check:english-only`;
  `docs/`, `scripts/` and `legal/` are covered by `check:no-spanish`, a
  per-file ratchet over `scripts/no-spanish-baseline.json`. It fails when a
  file's Spanish line count GROWS above its baseline, so translating shrinks
  the baseline on every pass instead of the gate sitting red. Translate
  first; `--update` is only for a reviewed, deliberate re-pin. Local-language
  surfaces are out of scope by path (the localized manual family registered
  as `MANUAL_FILES` in `scripts/landing-registry.mjs`,
  `scripts/translations/`, `*-<locale>.md`), and a legitimate non-English
  line carries the same `i18n-allow` pragma `check:english-only` uses.
  Two gates are excluded because they hold Spanish as DATA: this one and
  `check-english-only`. ADR section labels accept both languages
  (`Estado`/`Status`, `Fecha`/`Date`, `Contexto`/`Context`,
  `Decisión`/`Decision`, `Consecuencias`/`Consequences`) and `docs/audit.md`
  publishes its status table as `## Verified status` / `| Command | Mode |`,
  both accepted by `check:audit-freshness`.
- **Secrets:** `VITE_*` vars are **inlined into the bundle** by Vite — never
  put real keys in `VITE_*`. There is no server-side AI key to keep anywhere:
  provider keys live in the user's encrypted vault and are read by the browser
  only. The companion server's only credential is the
  license signing key, mounted as a Compose secret. `build:ci` runs a
  literal-secret scan over `dist/` and fails on leaks;
  `check:secrets-in-commit` scans the tree.
- **Retired configuration stays blocked:** provider credentials, upstream bases
  and other keys with no runtime reader are rejected in Compose by
  `check:compose-config` / `check:runtime-config`, and `.env.example` must not
  document them.

## 7. Testing conventions

- Unit/integration: Vitest, mirrored under `src/tests/` per area
  (`security`, `db`, `services/ai`, `human-like`, `chaos`, `regression`…).
- E2E: Playwright specs in `tests/e2e/` (browsers/multiuser/nightly/human-like
  configs); vault setup runs Argon2id, so on slow runners raise timeouts via
  `E2E_TIMEOUT_MULTIPLIER` instead of deleting waits.
- **E2E fixture fidelity (MANDATORY):** the vault fixtures
  (`setupVault`, `dismissOverlays`, `skipPassword`) reach the surface a spec
  tests by CLICKING controls and WRITING state, so a spec whose subject is one
  of those surfaces can be neutralized before its first assertion and still
  pass (dashboard-banner-cls / ADR-055). A spec that touches a registered
  surface's UI or storage must preserve it through the documenting option
  (`{ keepBackupNotice: true }`, `{ dismissOnboarding: false }`) or declare a
  reasoned `// fixture-neutralization-waiver: <surfaceIds> — <reason>`.
  `npm run check:quality` enforces it, and rejects a new
  dismissal added to the fixture without registering its surface.
- Live test loop (local): `npm run test:fast:watch` re-runs only the
  fast-profile tests affected by the file you save. For browser-level
  feedback run `npm run e2e` (Playwright UI mode over the full suite,
  affected specs re-run on save) or `npm run e2e` (UI mode over the
  <60 s critical-vault smoke set in `playwright.smoke.config.ts`); plain
  `npm run e2e:smoke` is the pre-push gate. E2E configs reuse
  already-running servers, and the `--mode test` webServer keeps Argon2id
  on fast test params — never start the dev server for E2E without it
  (~28 s per vault setup otherwise).
- The landing surface has a packaged-build run too: `npm run e2e`
  builds `dist/`, serves it with `vite preview` (`playwright.preview.config.ts`)
  and walks the 30 generated locales in `tests/e2e/landing-responsive.spec.ts`
  against the packaged output — the artefact that ships, where a landing the
  build failed to emit fails even though the dev server would still serve it.
- **Custom-provider E2E topology:** `npm run e2e`
  (`playwright.custom-provider.config.ts`, `tests/e2e/custom-provider*.spec.ts`)
  drives the Custom (OpenAI-format) provider through the app's real Settings
  path against the OpenAI-compatible mock (`scripts/mock-openai-server.mjs`, SSE
  streaming; scenario models surface provider errors 401/429/500/503).
  - The browser calls the mock directly (`firewalledFetch` allows loopback).
    Nothing proxies AI any more: the provider call is the browser's. Use this
    suite when touching provider wiring, the configuration flow, SSE parsing or
    error surfacing.
  - It has no companion-side session bootstrap to exercise, so it does not need
    a license policy. A Pro-only AI path must still degrade for Free users at
    ROUTING time — `resolveProvider` probes WebLLM best-effort
    (`ProUnavailableError` → `hasWebLLM=false`); a Free request may never fail on
    the entitlement before reaching the provider it selected.
  - It does not replace the shared suite: crisis specs, multiuser/relay and the
    nightly matrix keep their own configs and topologies.
  - **Removed:** `playwright.ai-upstream.config.ts`, its spec and
    `scripts/test-upstream-server.mjs` covered the Gemini proxy chain
    (browser → companion session → `geminiProxyHandler` → fake upstream). The
    proxy is gone, so that topology has no subject left.
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
  warns only. A pin is a measurement, so a third layer fails when one sits
  more than 25% below its fresh measurement (`BMF_TEST_TIMING_PIN_FLOOR`; 1
  disables it) — the `31000` against a real 48347 ms shape, where a stale
  pin silently shrank that file's budget from 96.7 s to 62 s while every
  other layer stayed quiet. The `slow-tests` CI job enforces timing on the
  slow profile. Re-pin an intended slowdown with `BMF_TEST_TIMING=update`
  (baseline is reviewed in the PR diff); `BMF_TEST_TIMING_OFF=1` is the
  explicit opt-out.
- Security tests are adversarial, not happy-path: property tests (fast-check),
  fuzzed SSRF gate parity (P81 differential), format-level crypto vectors.
  Tests may not be skipped without a reason — the custom rule
  `no-unexplained-test-skip` enforces it.
- Mock crypto-carefully: `require-securityvault-mock-lock-unlock` demands
   lock/unlock lifecycle symmetry when mocking `SecurityVault`.

## 8. Security Champions Program

BookmarkForge operates a **Security Champions program** for distributed
security responsibility across the development team. Every PR must pass
mandatory security gates before merge.

### Mandatory Security Gates (every PR)

1. **`Enforce mandatory security gates`** (CI step in `ci.yml`) — Runs:
    - `npm run check:security-internal` — The internal security pipeline (9 checks):
      - `check:secrets-in-commit` — No secrets in git history
      - `check:workflows` — CI/CD workflow validation
      - `check:http-config` — HTTP configuration security
      - `check:compose-config` — Docker Compose security
      - `check:runtime-config` — Runtime configuration validation
      - `check:docker-context` — Docker context security
      - `check:image-pins` — Container image digest verification
      - `check:repository-hygiene` — Repository security hygiene
      - `check:zap-baseline` — OWASP ZAP baseline scan
    - `npm run check:server-log-ip-privacy` — IP privacy in server logs
    - `npm run check:blindeo` — Blindeo security scanner
    - (The full security pipeline spans 11 commands above;
      `check:security-internal` itself covers 9.)
    - Blocks PR merge on any failure.

2. **`npm run check`** — The full gate chain (~50 check commands + lint)

3. **SAST** (CodeQL + Semgrep) — Blocked on High/Critical findings

4. **Dependency review** — Automated dependency vulnerability scanning

### Branch Protection

The `main` branch requires these status checks to pass before merge:
- `Enforce mandatory security gates` ← **New: blocks merge on any failure**
- `Typecheck, lint, tests and security gates`
- `Playwright E2E`
- `Production build and repository checks`
- `Dependency review`
- `CodeQL analysis`
- `Semgrep analysis`

The ruleset is at `.github/rulesets/main-protection.json` with `integration_id: 15368` for all status checks. Import it via GitHub Settings → Rules → Rulesets, or via API with `gh api --method POST /repos/ORG/REPO/rulesets --input .github/rulesets/main-protection.json`. See `.github/branch-protection.md` for instructions.

### Security Champions Responsibilities

| Responsibility | Frequency |
|----------------|-----------|
| Verify `npm run check:security-internal` passes | Every PR |
| Review security-critical PRs (server/, crypto/, db/) | Every PR |
| Investigate High/Critical SAST findings | Within 48h |
| Participate in external penetration test | Quarterly |
| Update `.zap/rules.tsv` for new false positives | As needed |
| Review DAST reports and remediate | Weekly |
| Update this AGENTS.md with new vulnerabilities | After incidents |

### Penetration Testing

- **Monthly DAST**: `.github/workflows/pen-test.yml` runs OWASP ZAP against staging
- **Pre-production penetration test**: `node scripts/penetration-test.mjs --target <url> --scope full`
- **Reports**: Written to `pen-test-reports/` with JSON and Markdown formats
- **Gate**: All CRITICAL and HIGH findings must be remediated before production deployment

### Security Champions Program

See `.github/SECURITY_CHAMPIONS.md` for the full program documentation.
- Designation criteria, escalation procedures, and metrics
- Checklist per change type (server/, CSP, headers, extension, dependencies)
- Incident response scale (P0–P3 with SLAs)

## 9. Repository hygiene

- Ignored (never commit): `dist/`, `coverage/`, `test-results*/`,
  `playwright-report*/`, `tests/e2e/__diffs__/`, `tests/e2e/__snapshots__/`,
  `.env.*` (only `.env.example` is tracked).
- Tracked artifacts: visual baselines under `*.spec.ts-snapshots/`.
  Regenerating them is an intentional act — review pixel diffs; two views
  sharing a byte-identical baseline is a bug (previously found:
  `bookmark-list-empty` == `main-app-layout`). CI enforces this: the
  `visual-baseline-drift` job (`npm run check:build`) pixelmaches
  every baseline in the PR head against the merge base and fails when a
  baseline was regenerated with >10% pixel drift, so a content change is
  reviewed instead of silently shipped. The same job also runs
  `check:baseline-gaps`, which statically derives every baseline a spec's
  `toHaveScreenshot` will compare against (locale loops, backstop-set
  guards and template call sites are constant-folded)  and fails when any
  of them is not tracked in git — so a spec-can-reference-but-repo-hasn't-
  committed gap breaks CI instead of auto-writing an unreviewed baseline
  on the first fresh-checkout run.
- Documented baseline acceptances (drift reviewed, kept): 2026-11-04
  `landing-price-badges-two-en` (resized 320×2361 → 320×2450, +89 px) — the
  pricing matrix gained one row per card (`❌ Local AI Translation` on Free,
  `✅ Local AI Translation (Coming Soon)` on Pro) together with the early-bird
  price line, so the card legitimately grew; the only pixel change is the new
  rows and the reflow below them (reviewed side by side, badges, accent, pill
  shape and stack offset unchanged). The 2026-09-02
  `settings-panel` (+54.3%) — the old baseline had captured the App-level
  "Loading…" splash (lazy-chunk race: `Settings` unmounted the whole shell
  while its chunk resolved), i.e. the degenerate-baseline class above; the
  fix adds a local `<Suspense fallback={null}>` in `MainApp` and a dialog
  visibility wait in the spec. The new baseline is the actual panel
  (content-dense, fingerprint-identical to `text-fit-settings-panel-en`,
  byte-stable across two runs).
- Do not stage broadly (`git add -A`); stage exactly what a commit is about.
- Known documentation gaps to close when you touch the area:
  `AGENTS.md` consistency, `docs/architecture.md` coverage, and `eslint-rules/`
  rule coverage in `eslint-rules/README.md` (index exists; new rules must be
  added there). ADR registry: every ADR referenced by the anchor catalog now
  has a file on disk — ADR-001 (static brand), ADR-019 (Argon2id/V5 formats),
  ADR-026 (hardening wave 1), ADR-027 (hardening wave 2), ADR-029 (WebRTC
  sync hardening D1/D2/D5/D6), ADR-030 (umbrella security regression suite),
  ADR-032 (disk backup pruning D1), ADR-033 (restore surface on auth errors
  D3), ADR-034 (backup age freshness + storage quota D1/D5), ADR-037
  (backup-deletion ownership), ADR-038 (constant-time HMAC in attestation
  chains) and ADR-039 (SW-side integrity verification incl. lazy chunks).
  Numbers ADR-031/035/036 are
  not in the anchor catalog and remain unassigned. ADR-028 (gate-drift-
  detection, referenced by `check-inspector-freeze.mjs`) is formalized in
  `docs/ADR-028-gate-drift-detection.md`; ADR-040 (fusion of the Markdown
  inspectors into the unified `check:docs-markdown` gate — implemented in
  `scripts/check-docs-markdown.mjs` with its drift baseline at
  `scripts/docs-markdown-baseline.json`, in the `npm run check` chain, and
  accepted by the freeze via the ADR token), ADR-042 (CSS-only user
themes, decision D4) and ADR-043 (SEO contract gate — `check:seo`:
   canonical/hreflang/OG/Twitter/JSON-LD, noindex, language negotiation
   and manual preference, sitemap with hreflang and legal terminology) are
   formalized in `docs/ADR-040-docs-markdown-gate-fusion.md`,
   `docs/ADR-042-css-only-user-themes.md` and
    `docs/ADR-043-check-seo-gate.md`. ADR-045 (brand logo consistency
    gate — `check:brand-logo`) is formalized in
    `docs/ADR-045-check-brand-logo-gate.md`. ADR-047 (factual
    claim-drift gate), ADR-048 (license claims gate), ADR-049
    (manual figures gate), ADR-050 (page figures gate and planner)
    and ADR-051 (landings freshness gate) are formalized in
    `docs/ADR-047-claim-drift-gate.md`, `docs/ADR-048-license-claims-gate.md`,
    `docs/ADR-049-manual-figures-gate.md`,
    `docs/ADR-050-page-figures-gate-and-planner.md` and
    `docs/ADR-051-landings-fresh-gate.md`. ADR-046 (vault KDF salt rotation
    with the master password — including the Voy index extension) is
    formalized in `docs/ADR-046-vault-kdf-salt-rotation.md` and anchored by
    the dedicated `p0-vault-kdf-salt` / `p0-vault-rotation-rollback-drill`
    anchor entries in `scripts/audit-anchors.mjs`. ADR-052 (v5 format sunset —
    conditional, measurable retirement of the legacy static-salt read path;
    Phases 0-2 implemented: exposure counter, diagnostics card and the
    non-blocking unlock-screen notice) is proposed in
    `docs/ADR-052-v5-format-sunset.md`, and ADR-053 (single per-vault salt
    registry consolidating `kdf_salt` and the `deriveDbKey` salt) is
    implemented in full — registry, per-salt diagnostics inventory and the
    `vault-salt-registry-source` anchor — per
    `docs/ADR-053-vault-salt-registry.md`. ADR-066 (the P2P sync transport is
    Pro as a whole; the Core sync UI and CollaborationService reach it only
    through `src/services/pro-access.ts`) is formalized in
    `docs/ADR-066-p2p-sync-pro-boundary.md` and anchored by the dedicated
    `p2p-sync-core-degradation` / `collaboration-seam-start-stop` anchor
    entries in `scripts/audit-anchors.mjs`. ADR-069 (the landing translation
    ratchet: `check:landing-i18n` compares every locale against
    `scripts/translations/en.json` and fails on a locale that is a copy of
    English; the per-locale budget lives in
    `scripts/landing-i18n-baseline.json`) is formalized in
    `docs/ADR-069-landing-translation-ratchet.md`. ADR-070 (the legal notice
    is published in the six reviewed languages only, the other 24 locales
    redirect to the English notice, `scripts/legal-identity.mjs` is the single
    source of truth for the controller identity, and the register and every
    published notice must declare the same sub-processors) is formalized in
    `docs/ADR-070-legal-publication-identity-parity.md`.

## 10. Audit Factory conventions

BookmarkForge implements a **Software Factory** pattern for audits, inspired by Eric Risco's multi-agent pipeline concept. This system transforms manual audit execution into an automated, documented, and reproducible process.

### 10.1 Audit Factory Architecture

The Audit Factory consists of specialized agents that work in sequence:

1. **Spec Generator** (`scripts/audit-spec-generator.mjs`) — Converts a PRD (Product Requirements Document) into an executable spec with tasks, dependencies, and acceptance criteria.

2. **Spec Reviewer** (`scripts/audit-spec-reviewer.mjs`) — Validates the spec for completeness, correctness, and executability. Scores the spec and provides actionable feedback.

3. **Audit Orchestrator** (`scripts/audit-orchestrator.mjs`) — Executes the spec tasks in an isolated git worktree, managing dependencies, timeouts, and error handling.

4. **Findings Analyzer** (`scripts/audit-findings-analyzer.mjs`) — Aggregates findings from all check script outputs, deduplicates them, classifies by severity, and generates remediation recommendations.

5. **Fix Generator** (`scripts/audit-fix-generator.mjs`) — Creates automated patches for findings that allow it (baseline updates, config changes, documentation updates).

6. **Acceptance Evaluator** (`scripts/audit-acceptance-evaluator.mjs`) — Verifies that all acceptance criteria from the PRD are satisfied after execution.

7. **Ship Agent** (`scripts/audit-ship.mjs`) — Final gate that decides how to integrate audit results (direct merge, PR, or park).

### 10.2 PRD and PRP Templates

- **PRD Template:** `docs/templates/audit-prd.md` — Product Requirements Document describing what to audit and why.
- **PRP Template:** `docs/templates/audit-prp.md` — Product Requirements Plan with executable tasks and checkboxes.

### 10.3 Audit Workflow

```bash
# 1. Create PRD in docs/audits/AUDIT-NNN-[slug].md
# 2. Generate spec
npm run audit:factory:spec -- --prd docs/audits/AUDIT-NNN-[slug].md

# 3. Review spec (optional but recommended)
npm run audit:factory:review -- --spec docs/audits/AUDIT-NNN-[slug]/spec.json

# 4. Execute the full pipeline. `audit:factory:run` drives every spec
#    task — checks, findings analysis, patch generation/application,
#    fix verification and acceptance evaluation — inside an isolated
#    worktree, then copies findings/, patches/, reports/ and the JSON
#    reports back into the main checkout. Failing gates are recorded as
#    findings (continueOnFailure); only infrastructure errors stop the run.
npm run audit:factory:run -- --spec docs/audits/AUDIT-NNN-[slug]/spec.json --mode sequential

# 5. Review results in the main checkout: findings/aggregated.json,
#    patches/, reports/acceptance-evaluation.json and
#    docs/audits/AUDIT-NNN-[slug]/execution-report.json.
#    The individual agents can also be re-run by hand:
npm run audit:factory:analyze -- --input findings/ --output findings/aggregated.json --classify --recommend
npm run audit:factory:fix -- --input findings/aggregated.json --output patches/
npm run audit:factory:accept -- --prd docs/audits/AUDIT-NNN-[slug].md --input findings/aggregated.json

# 6. Ship decision (manual gate — pick direct-merge, pr or park)
npm run audit:factory:ship -- --mode pr --worktree ../audit-AUDIT-NNN-[slug] --branch audit/AUDIT-NNN-[slug]
```

### 10.4 Audit Factory Rules

- **Always use worktrees:** The orchestrator creates an isolated git worktree for each audit. Never run audits directly on the main branch.

- **Document everything:** Every audit must have a PRD in `docs/audits/`. The PRD is the persistent memory of what was audited and why.

- **Review specs before execution:** Always run `audit:factory:review` before `audit:factory:run` to catch issues early.

- **Classify findings by severity:** Use the severity classification from `docs/audit.md` (Critical | High | Medium | Low | Info).

- **Generate ADRs for decisions:** If an audit results in an architectural decision or significant change, create an ADR documenting it.

- **Update docs/audit.md:** After completing an audit, update the Verified status table in `docs/audit.md` with the new findings or resolved issues.

- **Never skip gates:** The Audit Factory respects all existing gates (`npm run check`, `npm run check:pr`, etc.). Do not bypass them.

### 10.5 Integration with Existing Gates

The Audit Factory leverages the existing check scripts:

- `check:security` — Security gates (open-core, pro-imports, env, workflows, CSP, CVE)
- `check:quality` — Quality gates (boundaries, e2e helpers, chunks, knip)
- `check:content` — Content gates (i18n, docs, SEO, claims, audit drift)
- `check:brand` — Brand gates (logo, static tokens, sitemap, nginx)
- `build:ci` — Build with integrity checks
- `typecheck:prod` — TypeScript type checking
- `test:fast` — Fast test suite

The spec generator maps PRD scopes to these check scripts automatically.

### 10.6 Documentation

- **Complete guide:** `docs/AUDIT-FACTORY.md` — Step-by-step guide for beginners.
- **Example:** `docs/AUDIT-FACTORY-EXAMPLE.md` — Complete example of an audit execution.
- **Templates:** `docs/templates/audit-prd.md`, `docs/templates/audit-prp.md`

### 10.7 When to Use Audit Factory

Use the Audit Factory when:
- Conducting periodic security audits (quarterly, pre-release)
- Verifying compliance with standards (OWASP, CIS)
- Investigating regressions after major changes
- Documenting audit trails for compliance requirements
- Onboarding new team members to the audit process

Do NOT use the Audit Factory when:
- Making quick one-off checks (use `npm run check` directly)
- Debugging a specific issue (use targeted tests)
- The audit scope is very narrow (a single check script is sufficient)

---
