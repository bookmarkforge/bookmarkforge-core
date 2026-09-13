# AGENTS.md — BookmarkForge engineering conventions

BookmarkForge is a **local-first, privacy-preserving** AI knowledge vault
(React 19 / Vite 8 / RxDB 17 / IndexedDB / WebCrypto AES-GCM + Argon2id).
It stores personal data: **default to fail-closed, zeroize, least privilege**.
These contracts are enforced by real gates — read them before touching
security-adjacent code.

---

## 1. Password buffer ownership & zeroization (MANDATORY)

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
- Wire formats (keep them stable): `v5:` = `hkdf_salt(16) || iv(12) ||
  ciphertext`; `v4:` = `salt(16) || iv(12) || ciphertext`; `v2:` is legacy
  read-only PBKDF2. New code writes `v5:`.
- Device-key separation (S9): the device-key JWK lives in localStorage and
  ciphertexts in IndexedDB — **both** surfaces are needed to decrypt. With a
  master password the JWK is wrapped (H5); never persist a plaintext copy.

## 2. Header anchor convention (ADR / audit references)

- Security-significant changes carry a header anchor mapping to the decision
  record: `// ADR-019: …`, or audit round codes such as `// S1/R3: …`,
  `// P92: …`, `// H5: …`, `// B28: …` (security/privacy/hygiene/… items from
  `docs/audit.md`). Keep the anchor when you touch the file; add one for new
  hardening work.
- Standing decisions get a file at `docs/ADR-###-slug.md` — template:
  `Estado / Fecha` then `Contexto / Decisión / Consecuencias`
  (see `docs/ADR-001-check-static-brand.md`).
- Post-audit security regressions live at
  `src/tests/security/p<severity>-<slug>.regression.test.ts` and are **pinned
  by `scripts/audit-anchors.mjs`** (catalog + `audit-anchors-baseline.json`).
  Removing or renaming an anchored test is an ADR-level change;
  `npm run check:audit-drift` fails on drift.

## 3. Error handling: `INTENTIONAL SILENCE`

- **Never swallow errors silently.** A deliberately empty `catch` must say so:
  `catch { /* INTENTIONAL SILENCE: <precise reason> */ }`.
- Use `src/utils/logger` in app code (not `console.*`); bound repeated noise
  with `logRateLimited` (`src/utils/boundedLog`); redact secrets with
  `redactSecrets` before logging or persisting. User-facing errors must never
  leak raw `SyntaxError.message`, stack frames, or secret material
  (`src/telemetry/sanitize.ts` applies to the error pipeline).

## 4. Layer rules (enforced by `npm run check:boundaries`)

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

## 5. Mandatory gates before commit / push

> Note: `lint-staged` is configured and `husky` is in `prepare`, but this
> checkout has **no `.husky/pre-commit` hook file** — CI is the enforcement
> point. Run the gates locally; never push without them green.

```bash
npm run typecheck:prod          # tsc --noEmit (prod tsconfig)
npm run lint                    # ESLint acotado por dominios (sin heap global de 4 GiB)
npm run test:fast               # bounded Vitest suites (security, db, services,
                                #   key components; successful-test logs are
                                #   suppressed by default; use BMF_TEST_LOGS=full
                                #   for diagnostic output)
npm run test:slow               # every other test file (~480; CI's slow-tests job
                                #   enforces timing on it; `npm test` is the same
                                #   surface — run it before merging areas the fast
                                #   profile does not cover)
npm run build:ci                # vite build + secret-scan + SRI + integrity
                                #   manifest + chunk-boundary + bundle-size gates
npm run check                   # the 17-gate chain: env, workflows, http/compose/
                                #   runtime config, boundaries, e2e-helpers, csp,
                                #   extension-csp, i18n (completeness+quality+code),
                                #   english-only, audit-drift, no-unbounded-text,
                                #   tailwind-drift, rxdb17, static-brand,
                                #   license-keys, lint, chunks, inspector-freeze
```

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
  put real keys in `VITE_*`. Server-side `GEMINI_API_KEY` etc. stay on the
  companion server. `build:ci` runs a literal-secret scan over `dist/` and
  fails on leaks; `check:secrets-in-commit` scans the tree.

## 6. Testing conventions

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

## 7. Security Champions Program

BookmarkForge operates a **Security Champions program** for distributed
security responsibility across the development team. Every PR must pass
mandatory security gates before merge.

### Mandatory Security Gates (every PR)

1. **`Enforce mandatory security gates`** (CI step in `ci.yml`) — Runs:
   - `npm run check:security-internal` — The full internal security pipeline (9 checks):
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
   - Blocks PR merge on any failure.

2. **`npm run check`** — The 17-gate chain (includes CSP, i18n, audit-drift, etc.)

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

## 8. Repository hygiene

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
- Known documentation gaps to close when you touch the area:
  `AGENTS.md` consistency, `docs/ARCHITECTURE.md` coverage, and `eslint-rules/`
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
  canonical/hreflang/OG/Twitter/JSON-LD, noindex, negociación de idioma
  y preferencia manual, sitemap con hreflang y terminología legal) are
  formalized in `docs/ADR-040-docs-markdown-gate-fusion.md`,
  `docs/ADR-042-css-only-user-themes.md` and
  `docs/ADR-043-check-seo-gate.md`.