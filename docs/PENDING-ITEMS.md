# Pending

Live register of open debt. Updated on 2026-09-19 (branch `release/v1.0.0`, `D:/bookmark7`, Node 24.17.0). The audit that originated this list (branch `main`, 01:55 UTC) was surpassed on several fronts: what is already closed is preserved at the end, in "Resolved", with its evidence, to not lose traceability.

## Current Status

- `npm run check`: green, complete chain with freeze intact.
- `npx vitest run scripts/__tests__/`: 1246 tests, 0 failures.
- Components: **0 failures**. `src/tests/components` + `src/tests/security`: 194 files, 2609 green tests. The 9 audit failures are closed (and a tenth appeared, `lazyComponents`).
- `npm run check:chunks`: passes with `dist/` regenerated.
- `npm run check:release-target`: **confirmed** (`bookmarkforge/bookmarkforge`) — the release path is available again.
- Working tree: 25 modified and 4 added without commit (legal templates). The controlled retirement and GDPR consolidation are already committed (`32b4b6a`, `2ce321b`).

## P0 — Git and husky environment

Reconfined today, no changes regarding the audit:

- The checkout lives in `D:/bookmark7` and belongs to another Windows SID, so every git command needs `git -c safe.directory=D:/bookmark7 ...`; the alternative is the global exception `git config --global --add safe.directory D:/bookmark7`. Without it, any operation responds `detected dubious ownership`.
- The practical consequence: `npm run prepare` (husky) fails with `fatal: not in a git directory` and **does not install hooks**. `.husky/` is in `.gitignore`, so every checkout must recreate them.
- `npm run check:repository-hygiene` passes as well, but the real effect is a local repo running without hooks.

## P1 — Incomplete mock contracts in tests

Sweep done today with `node scripts/tooling/mock-contract-audit.mjs` (AST audit
of `vi.mock`): 59 files with some mock that does not cover its module's contract,
613 findings, of which **22 are about a module that the test imports
directly** (`[dir]`, the rest is noise from modules reachable only by
transitive import). Component tests were already closed.

**Status 2026-10-02: the 22 direct-import contracts below are CLOSED.** Every
factory listed here now provides its members, pinned by the ratchet
`node scripts/tooling/mock-contract-audit.mjs` — 22/22 mock paths present,
with 12 adversarial tests in `scripts/__tests__/mock-contract-audit.test.mjs`
(comment-only factories, `vi.hoisted` objects, spread/computed-key overrides
and shorthand `undefined` all fail closed). The 10 touched suites run green
(268 tests). The general AST sweep (59 files / 613 findings, the rest
transitive-import noise) remains open.

- `src/tests/security/p0-legacy-share-mismatch.regression.test.ts` → 10
  `secureStorage` members used by `SecurityVault` and
  `security-vault/integrity.ts` (`getVerificationIntegrity`,
  `storeVerificationTokenWithIntegrity`, `restoreWrappedDeviceKeyBlob`,
  `purgeExpiredPendingKeys`, …).
- `src/tests/services/SecurityVault.test.ts` and
  `p0-vault-rotation-rollback-drill.test.ts` → `auditLog.verifyIntegrity`
  (`SecurityVault`), and `AuditLogService.test.ts` →
  `secureStorage.isDeviceKeyMaterialized` / `isDeviceKeyWrapped`
  (`AuditLogService`).
- `src/tests/services/verifyBridgeMessage.test.ts` → `SECURE_STORAGE_KEYS`
  (`BroadcastBridgeService`, `db/database`, `VaultIntegration`).
- `src/tests/services/AnalyticsService.test.ts` → `safeRemove` from
  `safeStorage` (`AnalyticsService`, `ConsentService`).
- `src/tests/services/ai/warmup-latch.integration.test.ts` →
  `resourceManager.isHighEndDevice` (`ProviderManager`) and
  `buildSafeUserContent` from `ai/utils` (`WebLLMService`).
- `src/tests/services/integrations/cloudSync.*.test.ts` →
  `loadDiskBackupService` from `pro-access` (`BackupService`).
- `src/tests/memory/MemoryEngine.lifecycle.test.ts` → `memoryPipeline.onNewMessage`.
- `src/tests/services/ai/SemanticCacheService.test.ts` → `redactSecrets` from
  the logger (`EncryptionService`).

Deferred from the same pass: `storeVerificationTokenWithIntegrity` on
`buildRotationContext` (`SecurityVault.ts`) has no caller in `rotation.ts` — a
dead adapter awaiting a retirement decision; its member contract is pinned
regardless.

Separately, there is the `lucide-react` noise (93 icons in 9 component tests):
they are explicit stubs with `data-testid`, so completing them would add icons
for branches that never mount; it is left as a style decision, not as debt.

## P2 — Deliberate prunings still to do

- **Integrity of assertions in the human-like suite (large debt, decided 2026-09-24).** Of the 2050 tests in `src/tests/human-like/examples` (161 files, inherited from `bace7c2` on 2026-09-22), **1589 (77.5%) are vacuous**: their only assertion lives inside an `if (await loc.isVisible(…).catch(() => false))`, so they pass exactly when the function they name does NOT exist — 123 of the 160 original files (120 after the 2026-09-24 payments: `advanced-alerts-tests.spec.ts` rewritten from 10 vacuous to 5 real tests against the sonner toast contract, and `canvas-graph-tests.spec.ts` rewritten from 15 vacuous to 5 real tests against the verified xyflow/d3 contracts) can never fail (one of them, `advanced-alerts-tests.spec.ts` §74.3, goes so far as to assert that the close button remains visible AFTER clicking it). The nightly "Human-like E2E" job has been green whether the app works or not. Measurement: `node scripts/analyze-vacuous-tests.mjs`; ratchet: `npm run check:vacuous-tests` (freezes the number in `scripts/vacuous-tests-baseline.json` and fails if it grows; runs in the nightly `coverage` job). Limitation of the classifier documented: an "empty" means "no `expect` in the test callback", not "cannot fail" — `a11y` and `launch-smoke` assert via helpers that throw; the 6 remaining baseline entries are audited by hand, file by file, in their `reason`.
  **Equivalent census in vitest (2026-09-24): no theater.** The 14.6% gross that the classifier produces over `src/tests` + `scripts/__tests__` is scope noise: it includes the Playwright human-like suite (which vitest doesn't execute) and counts as "empty" tests that assert with non-`expect` APIs. Fine classification of the 72 tests signaled outside human-like: 16 use assertion helpers (`expectClaim` and similar), 41 are deliberate no-throw contracts ("does not fail if…" — the contract IS not to throw), 15 are legitimate guarded, **0 truly empty bodies**; 8 more files use `node:assert`, fast-check or snapshots (invisible to the AST, all verified by hand). No gate is created for vitest: there is no debt to ratchet. The remediation — rewriting or removing the 94 `advanced-*` files — is a product decision and does not belong in an audit round; what this gate does not allow is for the number to grow.
- `src/services/pro-access.ts`: its exports still have no internal consumers (verified today), but it is the Open Core / public export frontier surface; removing them risks the export placeholder.
- `src/utils/crypto-core.ts` → `resetSessionSalt`: defined and without calls in `src/` (verified). Kept because it's adjacent to the salt rotation work.
- `scripts/__tests__/monitoring-alerts.test.mjs` → test `API_DEGRADADO end-to-end` flaky in full run (real latency with timers), PASS in isolation. Doesn't affect nightly; noise in `test:fast`. Inject clock/timer mocks or mark `retry` when touching that area.

## P3 — Security Dashboard Polish

Verified today: the three points remain open.

- The sidebar item uses `app_securityDashboard`, too long for a 220 px rail, and truncates. Shortening it requires a new key (`app_security` doesn't exist today in locales) and updating all 30 languages without breaking the `npm run check:i18n` delta.
- Approximate values in the UI of `src/components/SecurityDashboard.tsx`: `encryptionFormat` fixed `AES-256-GCM` and `KDF` fixed `Argon2id (v4/v5)`, with `vaultKdfSalt` truncated. `src/services/security-vault/salt-registry.ts` has the real inventory and isn't wired to the component.
- Automatic refresh is a `setInterval` of 30 s without pause for visibility, so it wakes the tab in background; moving it to a visibility hook or the store would reduce it.

## Changes pending commit

- Documentation of this session: the three deletions from controlled retirement, `docs/audit.md`, `docs/launch-checklist.md`, `docs/security.md`, `docs/operations.md`, `docs/docs-state-index.md`, `docs/CHANGELOG.md`, the new ADRs (`docs/ADR-060-legal-consolidation-gate.md` and `docs/ADR-061-controlled-retirement-2026-09-19.md`) and the legal consolidation gate with its test (`scripts/check-legal-consolidation.mjs`, `scripts/__tests__/check-legal-consolidation.test.mjs`).
- Unified budget report: `scripts/build-budget-report.mjs` generates a JSON that combines the three budgets (static, chunks, browser) in `dist/reports/budget-report.json`. Includes unit test (`scripts/__tests__/build-budget-report.test.mjs`), npm script (`npm run build:budget-report`) and documentation in `scripts/tooling/README.md`.
- Dependencies: `package.json` and `package-lock.json` without `md-to-pdf`, `puppeteer` or `markdown-it` (the lock drops 1403 lines). Now `check:removed-deps` (`scripts/check-removed-deps.mjs` + its test) also blocks them from returning to `src/`: syntactic scanner over the forms that load a module (`import`, `export … from`, `import = require`, `import()`/`require()`/`require.resolve`, `vi.mock`/`jest.requireActual`), without false positives for mentions in comments or for `userAgent.includes("puppeteer")` in `src/utils/environmentDetection.ts`. Validated with `npm run typecheck`, `npm run lint`, `npm run test:fast` and `npm run check`.
- External to this work, present in the tree and untouched: `src/constants/navigation.ts` and `src/services/importer.markdown.ts`.
- Documents and their artifacts go together: the index and baseline also encode the retirement, so committing the changelog without the deletions leaves CI red.

## Resolved since the audit

| Audited debt | Closure evidence |
|---|---|
| 90 documents deleted and docs gates red | Corpus restored and renumbered to `ADR-059` (`384bdea`); controlled retirement of 3 documents with consent of `npm run check:docs-retire` and rationale in `ADR-061`. Index at 103 documents. |
| 62 files outside `check:docs-markdown` scan | Baseline regenerated: 102 files, 34 ADR, 0 findings. |
| `check:documented-doc-references` without index | 82 live documents, 256 local references resolved. |
| 9 `scripts/__tests__` failures for missing corpus and index | Complete suite: 1246 tests, 0 failures. |
| Key `securityVaultChangedInAnotherTab` missing in locales and `check:i18n` red | Integrated with cloud delta in `24ba20c`; `npm run check:i18n` passes. |
| 8 workflow vars and secrets undocumented | `npm run check:workflows` passes. |
| `check:inspector-freeze`: `check:docs-markdown` without ADR in chain | The gate is registered in `ADR-040`; the freeze passes with the gate wired. |
| `check:pocket-onboarding-copy` with `docs/onboarding-emails.md` missing | Document restored; the gate passes. |
| `dist/` missing and `check:chunks` in SKIP | `npm run build:ci` regenerated `dist/`; `npm run check:chunks` validates chunk invariants and input size. |
| `security-vault/auth.ts`, `rotation.ts` and `secrets.ts` untracked, with "integration pending" | Integrated and tracked (`c9f5804`). |
| `check:release-target` red for provisional slug | `bookmarkforge/bookmarkforge` confirmed as real target; the provisional slug list is now empty and the regression guardian requires the four surfaces to keep matching (ADR-058 amended). |
| Git unreadable in a checkout owned by another user | `readRemotes` and the export's `ls-files` invoke git with `safe.directory`, so the confirmed remote is no longer reported as absent. The global `safe.directory` fix on the machine remains in the git/husky debt above. |
| 9 component failures (8 in `BlockEditor.branches`, 1 in `Onboarding`) | **Harness in the first 8**: the `useBlockEditorLogic` mock didn't provide `lang`, which the real hook always returns (`i18n.language`), so the editor did `undefined.startsWith("es")`; added, with two new tests that fix the dictionary (`en` and `es-MX`, the regional case that exists for the `startsWith`). **Harness + product in the ninth**: the `sonner` mock lacked `dismiss`; and the real flow was hardened because a failing `dismiss` would abort the reboot and report a restoration already committed as failed. 31/31 green in both files. |
| 10th component failure: `lazyComponents.test.ts` (not listed in the audit) | `SecurityDashboard` entered the `src/components/app/lazyComponents.ts` barrel in `59644c6` without updating the frozen list in the expectation. Updated (deliberate export: routed in `AppRoutes.tsx` and used by `Settings.tsx`) and added its mock, which the file itself requires of all `lazy()` targets. |

## What to do now

1. The `safe.directory` exception so git and husky work in this checkout.
2. Commit the full documentation area, including the changelog and derived artifacts.
3. Decide whether to shorten the dashboard label by paying the cost across 30 locales.

## Sources

Verification of this update: `npm run check` (green, freeze intact), `npm run check:i18n`, `npm run check:workflows`, `npm run check:pocket-onboarding-copy`, `npm run check:inspector-freeze`, `npm run check:chunks`, `npm run check:release-target`, `npx tsc --noEmit`, `npm run test:fast` (152 files, timing budgets intact), `npx vitest run src/tests/components src/tests/security` (194 files, 2609 tests, 0 failures) and `git -c safe.directory=D:/bookmark7 status --porcelain`.
