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
npm run lint                    # eslint . (custom rules in eslint-rules/)
npm run test:fast               # bounded Vitest suites (security, db, services,
                                #   key components — count deliberately unnumbered,
                                #   see ADR-038)
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
- Before a release: `npm run check:launch-checklist --strict` (Sentry DSN/DPA,
  RPO/RTO sign-off, manual WCAG, CODEOWNERS are tracked as open operational
  items in `docs/launch-checklist.md` — see `docs/audit.md` for the known-gap
  ledger and `docs/ROPA.md` for GDPR processing records).
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
- Security tests are adversarial, not happy-path: property tests (fast-check),
  fuzzed SSRF gate parity (P81 differential), format-level crypto vectors.
  Tests may not be skipped without a reason — the custom rule
  `no-unexplained-test-skip` enforces it.
- Mock crypto-carefully: `require-securityvault-mock-lock-unlock` demands
  lock/unlock lifecycle symmetry when mocking `SecurityVault`.

## 7. Repository hygiene

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
  guards and template call sites are constant-folded) and fails when any
  of them is not tracked in git — so a spec-can-reference-but-repo-hasn't-
  committed gap breaks CI instead of auto-writing an unreviewed baseline
  on the first fresh-checkout run.
- Do not stage broadly (`git add -A`); stage exactly what a commit is about.
- Known documentation gaps to close when you touch the area:
  `AGENTS.md` consistency, `docs/ARCHITECTURE.md` coverage, and `eslint-rules/`
  rule coverage in `eslint-rules/README.md` (index exists; new rules must be
  added there). ADR registry: every ADR referenced by the anchor catalog now
  has a file on disk — ADR-001 (static brand), ADR-019 (Argon2id/V5 formats),
  ADR-026 (hardening wave 1), ADR-027 (hardening wave 2), ADR-029 (WebRTC
  sync hardening D1/D2/D5/D6), ADR-030 (umbrella security regression suite),
  ADR-032 (disk backup pruning D1), ADR-033 (restore surface on auth errors
  D3), ADR-034 (backup age freshness + storage quota D1/D5) and ADR-037
  (backup-deletion ownership). Numbers ADR-031/035/036 and ADR-040/042 are
  not in the anchor catalog: 031/035/036 are unassigned, ADR-028 (gate-drift-
  detection, referenced by `check-inspector-freeze.mjs`) is formalized in
  `docs/ADR-028-gate-drift-detection.md`, and ADR-040/042 remain implicit
  prose references (`check-inspector-freeze.mjs`, `ThemeService.ts`) until
  formalized.