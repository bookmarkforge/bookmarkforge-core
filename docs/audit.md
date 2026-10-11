# Technical audit — BookmarkForge (verifiable ledger)

- **Last verification executed:** 2026-09-24, on the working tree in branch `release/v1.0.0`.
- **Scope:** static audit of code, configuration, CI and documentation. Does not include pentest, production load test or formal legal review.
- **Document rule:** each assertion carries the command that backs it and the expected observable. If an assertion cannot be reproduced from this checkout, it is explicitly declared as historical execution or external debt — not asserted. No scores: a number from 0 to 10 is not reproducible and rounds 6–7 of this same ledger demonstrated that a "9.2 global" was calculated on a tree that did not compile.

## Verified status (2026-09-24)

This table no longer depends on manual re-reading: `npm run check:audit-freshness` re-executes it (ADR-064) and fails if the document stopped describing the tree. The `Mode` column declares how each row is verified:

- `chain` — the command is a gate of the `npm run check` chain; the gate checks that it remains.
- `exec` — executed here and compared exit code and each backtick fragment against real output.
- `deep` / `network` — only under `--deep` / `--allow-network`, because they are heavy or have network; CI executes them with `npm run check:audit-freshness:deep`.
- `self` — the command contains this gate (or is the suite that runs its test), so the number it publishes is **derived** from the tree (chain size, fast profile files) instead of trusting.

A row without `Mode`, an unknown mode, a non-existent script, a `self` without registered derivation or a derived number that does not match **fails the gate**: zero rows are omitted.

| Command | Mode | Observable on this date |
|---|---|---|
| `npm run check` | `self` | exit 0 · 53-gate chain |
| `npm run test:fast` | `self` | exit 0 · all 177 test files passed |
| `npm run lint` | `chain` | exit 0 (within chain) |
| `node scripts/check-page-figures.mjs` | `exec` | `ok: 61 pages agree with code (freeCap=2500, devices={0,5}, prices=59/79, refund=30d, revalidation=48h, recovery=24w)` |
| `npm run typecheck` | `deep` | exit 0 (tsc exits 0 only without errors) — the old WIP locus src/tests/human-like/examples/ compiles again |
| `npm run check:launch-checklist` | `deep` | `Summary: 12/12 verifiable completed · 0 pending · 5 manual` |
| `npm audit --omit=dev` | `network` | `found 0 vulnerabilities` |

> **Note:** `check:launch-checklist` only examines the checkout. Production may serve an artifact older than this tree (see A11-2). This is why `scripts/check-sitemap-coverage.mjs` is a repository gate and not an HTTP probe.

## Live surface (snapshot)

| Assertion | Verification (command → observable) |
|---|---|
| Stack: React 19 + strict TS + Vite; RxDB 17 + IndexedDB; Node ≥24 + `ws`; Mantine 9 | `node -e "const p=require('./package.json'); console.log(p.dependencies.react, p.dependencies.rxdb, p.dependencies['@mantine/core'], p.devDependencies.typescript)"` → `^19.2.8 ^17.4.0 ^9.5.1 ^5.9.3` · `node -e "console.log(Object.keys(require('./package.json').scripts).length)"` → `199` npm scripts total |
| Crypto: AES-256-GCM + Argon2id/HKDF in Web Worker; WASM memory wipe | `ls src/utils/crypto-core.ts src/utils/argon2-kdf.ts src/services/EncryptionService.ts src/utils/wasm-zero-memory.ts` → all 4 exist |
| Centralized sanitization | `grep -rln "DOMPurify" src/services/SanitizationService.ts` → 1 match |
| HSTS present in `_headers` (including per-path blocks) | `grep -c "Strict-Transport-Security" public/_headers` → `5` |
| Sitemap with 61 URLs (root + 30 landings + pocket + 30 legal) | `grep -c "<loc>" public/sitemap.xml` → `61` |
| Dead surface of retired AI proxy removed from server and API doc | `grep -rn "services/ai" server/src/*.ts \| wc -l` → `0` · `grep -c "services/ai" docs/openapi.yaml` → `0` · `grep -m1 "openapi:" docs/openapi.yaml` → `openapi: 3.1.0` |
| Script inventory snapshot contract (on-demand) | `npm run check:audit-script-snapshot` → `snapshot OK; unreferenced candidates: …` (20 candidates). The snapshot `.tmp-audit-script-candidates.txt` is gitignored: in a new clone regenerate with `node scripts/__tests__/audit-script-inventory.test.mjs --update` |
| Server without `ai-proxy.ts`; shared helpers in `proxy-utils.ts` | `ls server/src/ai-proxy.ts` → does not exist · `ls server/src/proxy-utils.ts` → exists |
| AI mocks removed | `ls scripts/ai-mock.mjs scripts/ai-mock-https.mjs` → both do not exist |
| 10 workflows, all external actions pinned by 40-char SHA-256 | `ls .github/workflows/*.yml \| wc -l` → `10` · `grep -rcE "uses: [^@]+@[0-9a-f]{40}" .github/workflows/*.yml` → each file ≥1 and `grep -rnE "uses: [^@]+@v[0-9]" .github/workflows` → no results |
| ZAP pinned by SHA | `grep -n "zaproxy/action-baseline" .github/workflows/dast-nightly.yml` → `@de8ad967d3548d44ef623df22cf95c3b0baf8b25` |
| Compose prod: images by `IMAGE_TAG` (no mutable base tags to pin in that file) | `grep -c "@sha256" docker-compose.prod.yml` → `0`; `image:` lines are `bookmarkforge/web:${IMAGE_TAG:?…}` / `bookmarkforge/api:…`. `grep -c "@sha256" docker-compose.staging.yml` → `1`. Gate: `npm run check:image-pins` → exit 0 |
| Dockerfile: the `deps` stage removes the `prepare` hook before `npm ci --omit=dev` | `sed -n '9,15p' Dockerfile` → `npm pkg delete scripts.prepare && npm ci --omit=dev` |
| Figure budgets monitored on 61 surfaces | `node scripts/check-page-figures.mjs` → `ok: 61 pages agree with code` (see status table) |
| Production smoke without dead endpoints | `node scripts/local-smoke.mjs` → passes (3 static checks + health + client-events + WS) · `grep -c "services/ai" scripts/production-smoke.mjs` → `0` |
| Load test measures current surface (signaling, no AI proxy) | `grep -n "load-test" .github/workflows/nightly.yml` → job `load-test` with `node scripts/load-test-server.mjs --connections=50 --json` · `grep -c "services/ai" scripts/load-test-server.mjs` → `0` |
| Alerts: webhooks documented, business probe on live endpoint | `grep -c "DRILL_ALERT_WEBHOOK_URL\|ANALYTICS_ALERT_WEBHOOK_URL" .env.example` → `2` · `grep -n "API_PROBE_BUSINESS_PATH" scripts/monitoring-alerts.mjs` → `POST /api/license/entitlement` |
| Language registry with a single source (30 locales) | `grep -rln "landing-registry" scripts functions` → consumers derive from the registry; `npm run check:seo` → exit 0 (`302 to all 29 localized landings`) |
| Landings smoke in a real browser (ADR-062) | `npm run check:landing-smoke` → `ok: 31 route(s), 15 critical resource(s), 63 internal link(s)` (needs Chromium, so it is NOT in `npm run check`: it runs in `check:deploy` and in its own step in `ci.yml`). The offline half of the same decision is `npm run check:landings-fresh`, in the chain |
| Assertion integrity of the E2E suites (on-demand) | `npm run check:vacuous-tests` → `ok: 2 suite(s), 2184 test(s), 1596 vacuous (73.1%, baselined) · 3 declared row(s) checked`. Ratchet: `scripts/vacuous-tests-baseline.json` freezes the debt (1589 in human-like, 7 in multi-user, each entry hand-audited) and fails if it grows; it also verifies that the *Suite* column of `docs/ops-nightly.md` matches the tree. In `nightly.yml` (job `coverage`). Detailed debt in `docs/PENDIENTES.md` |

## Historical findings ledger

Format: each row preserves the finding and the **verifiable evidence today** (command → expected observable). "Corrected" means the observable is met in this checkout; it is not an assertion about past CI executions (see "What this document does not assert").

### App and product

| ID | Finding (original state) | Verifiable evidence |
|---|---|---|
| B1 | **GDPR consent broken:** `AnalyticsService`, `errorReporter` and `clientEventReporter` read the legacy key `bmf_local_error_storage` instead of the `ConsentBanner` keys (`forge_consent_*`); the user's choice had no effect | `grep -rln "forge_consent_analytics" src --include="*.ts"` → `src/constants/storage-keys.ts`, `src/services/AnalyticsService.ts`, `src/services/analyticsForwarder.ts` (single shared key). Tests: `npx vitest run src/tests/error-logging/errorReporter.test.ts` → 45 passed |
| B2 | **Complement of previous:** the telemetry toggle in `SecuritySection.tsx` wrote to the legacy key and did not sync with the services | `npx vitest run src/tests/components/settings/SecuritySection.test.tsx` → green; the test asserts writing to `forge_consent_*` keys and cleanup of the legacy one |
| B3 | **SRS notifications never delivered:** `await navigator.serviceWorker.ready` hangs forever without registered SW; fallback `new Notification()` was unreachable | `sed -n '89,95p' src/services/NotificationService.ts` → uses `getRegistration()` (resolves `undefined`) with fallback. `npx vitest run src/tests/services/NotificationService.test.ts` → green, including no-registration path |
| B4 | **Gemini TTS/image broke contract:** naked base64 vs expected data URL (B7-1), and TTS PCM without RIFF/WAVE header was a corrupt file even though mime said `audio/wav` (B8-1) | `ls src/utils/audioFormat.ts` → exists; `grep -n "toPlayableAudioDataUrl" src/services/ai/TTSService.ts` → used in TTS path. `npx vitest run src/tests/utils/audioFormat.test.ts` → 27 passed (tests read header with their own `DataView`, do not reuse module parsers) |
| B5 | Incomplete i18n keys (`ai_error_serverError` missing in Spanish: 5xx errors in English in Spanish UI) | `grep -c "ai_error_serverError" public/locales/es.json public/locales/en.json` → `1` in both |
| B6 | Dead permissiveness in firewall: `getGeminiProxyPreset()` preset origin of `VITE_GEMINI_PROXY_URL`, variable already retired | `grep -rn "getGeminiProxyPreset" src --include="*.ts"` → 0 matches |
| B7 | Tests asserting removed surface (`hasGeminiKey`, proxy URL validation) kept alive description of a product that no longer exists | `grep -rn "hasGeminiKey" src --include="*.ts" --include="*.tsx" \| grep -v test` → 0 matches |
| B8 | Silent catch in `useRxDB` (hidden query errors returning `[]`) and in smart-links of `useBlockEditorLogic` | `grep -n "logger.warn" src/hooks/useRxDB.tsx` → line 89 · `grep -n "logger.warn" src/components/block-editor/useBlockEditorLogic.ts` → lines 395 and 464 |
| B9 | First-run E2E hung by KDF Argon2id with desktop parameters in Playwright webServer | `sed -n '92,97p' playwright.config.ts` → webServer launches Vite with `--mode test` (activates `ARGON2_PARAMS_TEST`) |
| B10 | Automated accessibility | `ls tests/e2e/a11y.spec.ts` → exists (axe-core in E2E). The manual WCAG review remains pending and is external debt for this repo |

### Infrastructure and supply-chain

| ID | Finding (original state) | Verifiable evidence |
|---|---|---|
| A1 | Nightly DAST without SHA pin and with ZAP image digest placeholder | `grep -n "zaproxy/action-baseline" .github/workflows/dast-nightly.yml` → 40-char SHA; `grep -c "REPLACE_WITH_VERIFIED_ZAP_IMAGE_DIGEST" .github/workflows/*.yml` → 0 |
| A2 | GitHub actions by mutable tag (`@v4`) in 7 workflows | `grep -rnE "uses: [^@]+@v[0-9]" .github/workflows` → no results; gate `npm run check:workflows` → exit 0 (requires 40-char SHA pin for all external actions) |
| A3 | Docker images by mutable tag | `grep -c "@sha256" docker-compose.staging.yml` → `1`; in prod images arrive by `IMAGE_TAG`. Gate: `npm run check:image-pins` → exit 0. *Honest note:* the historical row asserted "all pinned by digest" for a compose that today builds by `IMAGE_TAG`; the current gate is the source |
| A4 | False positives in validators (`validate-workflows` with local refs, `validate-runtime-config` with CRLF/`command:` blocks) | `npm run check:workflows` and `npm run check:runtime-config` → exit 0 (validators carry the fixes; their contract tests are in `test:fast`) |
| A5 | Domain leak: `exporter.formatters.ts` and `security.txt` used `bookmarkforge.app`; `security.txt` with an undocumented email | `grep -rln "bookmarkforge\.app" src server public` → no results · `grep "Contact" public/.well-known/security.txt` → `mailto:bookmarkforge@proton.me` |
| A6 | Server `Permissions-Policy` without `interest-cohort=()` | `grep -n "interest-cohort" server/src/ai-proxy.ts` → file no longer exists; header lives in current headers layer (`npm run check:csp` → exit 0) |
| A7 | Staging: `AI_SESSION_ORIGINS` hardcoded to a port → 403 `CSRF_ORIGIN` with a non-standard `HTTP_PORT` | `grep -n "HTTP_PORT" docker-compose.staging.yml` → interpolation `http://127.0.0.1:${HTTP_PORT:-18080}` |
| A8 | Redis deployed in production without consumer (rest of AI proxy retirement) | `grep -c "AI_PROXY_REDIS_URL" docker-compose.prod.yml` → `0` |
| A9 | Nginx renderer destroyed `_headers` and `sitemap.xml` with `--write` (obsolete duplicated templates) | Unique property redesigned (Round 10): `npx vitest run src/tests/scripts/nginx-render.test.ts` → 5 passed (surgical fix, byte-by-byte idempotency, FAIL guards, abort all-or-nothing); `npx vitest run scripts/__tests__/nginx-render-renderers.test.mjs` → green; `npm run check:nginx-render` → exit 0 |
| A10 | Smoke/monitor/load-test pointing to removed endpoints (`/api/services/ai/*`) | `grep -c "services/ai" scripts/production-smoke.mjs scripts/load-test-server.mjs` → `0` in both · `grep -n "API_PROBE_BUSINESS_PATH" scripts/monitoring-alerts.mjs` → `POST /api/license/entitlement`; `npx vitest run scripts/__tests__/monitoring-alerts.test.mjs` → green |
| A11 | Frozen counts ("12/12") printed by `deploy-prod`/`rollback`/`monitoring-alerts` | `grep -n "production-smoke PASS" scripts/deploy-prod.mjs` → count-agnostic tag (no fixed number) |
| A12 | Checklist required `AI_SESSION_REQUIRE_LICENSE` (control server no longer implements) → permanent red item | `npm run check:launch-checklist` → `12/12 verifiable · 0 pending` (see status table) |

### Operations and CI (drills, KPIs, load)

| ID | Finding (original state) | Verifiable evidence |
|---|---|---|
| O1 | `nightly.yml` invoked non-existent script with invalid args in load job | `grep -n "load-test" .github/workflows/nightly.yml` → `node scripts/load-test-server.mjs --connections=50 --json` (real script and args) |
| O2 | No quarterly drill in CI; backup-restore drill only ran in quarterly test | `grep -n "rollback-docker\|backup-restore" .github/workflows/drill-quarterly.yml` → jobs present · `grep -n "drill-backup-restore" .github/workflows/nightly.yml` → monthly job (day 1 cron) with RTO degradation alert |
| O3 | No nightly business KPI gate (DAU/WAU/MAU unmonitored) | `grep -n "kpi-staging" .github/workflows/nightly.yml` → job present · `ls scripts/__tests__/kpi-report.test.mjs` → exists |
| O4 | Analytics collector only validated against staging | `grep -n "kpi-collector-local" .github/workflows/drill-quarterly.yml` → job that validates pipeline against local server, without secrets or external network |
| O5 | Previous tag image build broken for the rollback drill (the `prepare` hook failed at `npm ci --omit=dev`) | `sed -n '11,15p' Dockerfile` → `npm pkg delete scripts.prepare` before `npm ci --omit=dev`. *Note:* the historical row attributed the fix to `--ignore-scripts`; the current mechanism is `npm pkg delete` (the `build` stage needs its postinstalls) |
| O6 | The Docker rollback drill brought up an incomplete stack (redis missing) | Obsolete per A8: redis no longer exists in any compose; `scripts/drill-rollback.mjs` brings up license-mock + companion server. *The documented PASS run (2026-08-31) was execution evidence over that earlier state — not reproducible from this checkout without Docker and `prod-*` tags* |
| O7 | Load: AI proxy budgets with no subject | `grep -c "services/ai" scripts/load-test-server.mjs` → `0`; it measures signaling (join/relay p95, saturation, `/health`) |

### Verification drift (rounds 6–8)

The structural lesson of this ledger: the code evolved (retirement of the AI proxy, Pro gate via loader) and its verifications kept describing the previous version. `npm run check` and `test:fast` were green while `npx vitest run` (full suite) had 8 files and 35 tests red.

| ID | Finding | Verifiable evidence |
|---|---|---|
| D1 | Test hanging E2E in the webServer (see B9) | `sed -n '92,97p' playwright.config.ts` |
| D2 | OpenAPI documenting 6 nonexistent endpoints; docs describing a removed proxy; `docs/audit.md` citing `server/src/ai-session.ts` (deleted file) | `grep -c "services/ai" docs/openapi.yaml` → `0` · `ls server/src/ai-proxy.ts server/src/ai-session.ts` → nonexistent |
| D3 | Compose and validators **requiring** dead infrastructure (redis in prod, `ai-mock` in staging) | `grep -c "AI_PROXY_REDIS_URL" docker-compose.prod.yml` → `0` · `ls scripts/ai-mock.mjs` → does not exist · `npm run check:compose-config && npm run check:runtime-config` → exit 0 (with a guard that fails if AI config reappears without a reader) |
| D4 | Tests stubbing the Pro module instead of the loader (`loadBackupService`/`loadWebLLMService`); mocked response of the removed proxy | `npm run test:fast` → exit 0 (the file census lives in the "Verified status" table, which derives it) |
| D5 | Two commits with the same subject (history hygiene) | `git log --format=%s \| sort \| uniq -d` → `Remove Gemini proxy: route directly to Gemini API` (recorded, not fixable without a rewrite) |

### Declared maintainability debt (uncorrected, measurable)

| ID | Finding | Verification |
|---|---|---|
| M1 | Residual helper duplication in `server/src` despite `proxy-utils.ts` | `grep -rc "function clientIp" server/src --include="*.ts"` → 4 files with a copy (`business-analytics`, `client-events`, `index`, `proxy-utils`). Declared criterion: helpers with different body/rate-limit limits are intentionally kept local |
| M2 | Empty `PAID_PATH_PREFIXES`: the `check:pro-routes` gate is wired but no Pro routes are declared | `grep -n "PAID_PATH_PREFIXES" server/src/route-table.ts` → `= []` · `npm run check:pro-routes` → exit 0 (`11 routes classified, 16 dispatched, 0 entitlement-gated`). Adding the first paid route must activate the gate |
| M3 | Legal classification of the BYO-key AI provider (user's third party vs operator's processor) | Pending legal decision, noted in the ROPA/legal package; not rewritable without advice (external debt) |

## Open debts

Verifiable from the repo:

1. **A11-2 — production does not match the checkout.** Probes from 2026-09-22: `curl -s -o /dev/null -w "%{http_code}" https://bookmarkforgeapp.com/…` → `/` = 200; `/ar/`, `/es/`, `/sitemap.xml`, `/privacy-and-terms.html` = **404**. It is not valid to claim this checkout's sitemap is published, nor to submit its 61 URLs to Search Console. Closure: deploy this checkout, repeat the probes and run `node scripts/check-hreflang-graph.mjs https://bookmarkforgeapp.com`.
2. **M1/M2** (previous table): declared helper duplication and undeclared Pro routes — both with a measurement command.

Declared debts **not verifiable from the repo** (listed so they exist; none can be closed with code):

- Ruleset import in GitHub: `.github/rulesets/main-protection.json` exists in the checkout (`ls .github/rulesets/main-protection.json`), but activating it on the remote is an external action and **this document asserts nothing about the real protection state of the remote branch**.
- Sentry DSN + signed DPA (ROPA §7) to enable the opt-in remote reporting.
- The real URLs of the alert webhooks (`ANALYTICS_ALERT_WEBHOOK_URL`, `DRILL_ALERT_WEBHOOK_URL`) and their secrets in GitHub.
- Signed RPO/RTO targets (the drills measure empirical RTO with gates; the official target is an organizational decision).
- Manual WCAG review (the automated one runs in E2E: `tests/e2e/a11y.spec.ts`).
- ROPA: `grep -c "⚠ COMPLETAR" docs/ROPA.md` → **0** on this date (the inventory no longer has fields marked incomplete; the formal legal confirmation remains external).

## What this document no longer asserts

Retired as unsustainable from the repository:

- **Per-area and global scores** (8.6 → 9.2 → "target 9.5"): subjective and not reproducible; round 6 demonstrated that the 9.2 was computed over a tree that did not compile. A reader who wants an assessment has the commands in the status table.
- **"main protection: ✅" rows**: a local JSON asserts nothing about the state of the remote branch. It is replaced by the local file's observable and the external debt of importing it.
- **"Single-maintainer repository"** as a governance claim: replaced by observable data — `git shortlog -sn HEAD` (4 commit identities), `git log --merges | wc -l` → `0`, 0 PRs/merges in the history. No claims about reviews, teams or responsibilities.
- **Inherited counts** ("11/13", "633 tests", "~70 scripts"): replaced by the gate output on the verification date; the live number is the one the command prints.

## What this document cannot prove

- That the GitHub workflows have ever run (there are no PRs or merges in the history): every CI gate is theory until the first push. Context command: `git log --merges --oneline | wc -l` → `0`.
- Historical runs (2026-08-31 Docker drill PASS, the smoke's first run, E2E in a real browser): they are execution evidence recorded in `docs/operations.md` and in this ledger as history; they are **not** re-run from this checkout without Docker, `prod-*` tags or a deployment.
- Production behavior (see A11-2): no local gate substitutes for probes against the real domain after a deployment.

## Methodology

1. Every ledger row was re-verified against the working tree before being kept; those that no longer held were corrected toward the real observable (A3, O5, O6, B5) or retired.
2. Commands were executed on 2026-09-22 on Windows (Git Bash); observables are output text or exit codes, not interpretations.
3. The classification lives in this file; the gates live in `scripts/check-*.mjs`. When an assertion depends on a gate, the gate takes precedence over this document.
4. Next update: the status table re-executes on its own (`npm run check:audit-freshness` inside `npm run check`; CI with `--deep --allow-network`) and only A11-2's probes remain manual; any new finding row enters with its command or does not enter.