# Pre-launch checklist — BookmarkForge

- **Last review:** 2026-09-12
- **Source:** derived from [docs/audit.md](audit.md), [docs/security.md](security.md), [docs/operations.md](operations.md) and [docs/internal-security-checklist.md](internal-security-checklist.md).
- **How to use:** mark `[x]` when the point is complete. Each point indicates where the evidence or current status is. "Evidence" = document/file where to verify; "Gate" = automated command that checks it.
- **Security Champions program:** See [`.github/SECURITY_CHAMPIONS.md`](../.github/SECURITY_CHAMPIONS.md) for designation, responsibilities and escalation.

---

## 🔴 Blocking — without this, do not launch

> **Plan-gate note (2026-10-02):** items 1 and 2 below are blocked by a GitHub
> plan gate, not by a missing manual step. Verified with a repo-scoped token
> (authenticated as a repo admin): both the repository-rulesets API and the
> classic branch-protection API answer `403 — Upgrade to GitHub Pro or make
> this repository public to enable this feature` on this private repository
> (Free plan, personal account owner). Decision taken 2026-10-02: stay on Free
> and rely on CI-only enforcement (this repository's documented
> single-maintainer release control);
> The scripted path `scripts/setup-github-ruleset.mjs` was removed on 2026-10-13
> with the rest of the external-infrastructure scripts, so item 2 imports the
> payload directly (`.github/rulesets/main-protection.json`, or the equivalent
> `gh api --input` call) instead of running a repository script. The importable
> payload stays ready and is the actual artifact.
> Making the repository public would lift the gate
> but breaches the Open Core boundary (the public Core ships only as the
> curated export), so it is excluded.

- [ ] **1. `Enforce mandatory security gates` active on branch `main`**
  The ruleset `.github/rulesets/main-protection.json` must include `Enforce mandatory security gates` as mandatory check. This gate executes `npm run check:security-internal` on every PR.
  - Evidence: [.github/rulesets/main-protection.json](../.github/rulesets/main-protection.json), [.github/branch-protection.md](../.github/branch-protection.md).
  - Gate: `npm run check:launch-checklist` — validates that the payload is correct for the API (`Enforce mandatory security gates` present and **without** export fields like `source`/`id`).
  - **Steps:**
    1. Verify that the ruleset imported in GitHub includes `Enforce mandatory security gates`.
    2. Open a test PR that touches crypto/infrastructure and verify that the check blocks changes if it fails.
  - Pending manual: reimport the ruleset after any change in mandatory checks.

- [ ] **2. `main` protection imported and active**
  Import the ruleset `.github/rulesets/main-protection.json` in GitHub (Settings → Rules → Rulesets). It must require PR and mandatory checks; the repository has a single maintainer and does not depend on external approval.
  - Evidence: [.github/rulesets/main-protection.json](../.github/rulesets/main-protection.json), instructions in [.github/branch-protection.md](../.github/branch-protection.md).
  - Gate: `npm run check:launch-checklist` — validates that the payload is correct for the API (mandatory checks present and **without** export fields like `source`/`id`).
  - **Steps:**
    1. Import in GitHub: **Settings → Rules → Rulesets → New branch ruleset → Import a ruleset** with `.github/rulesets/main-protection.json`, or via API:
       ```bash
       gh api --method POST -H 'Accept: application/vnd.github+json' \
         /repos/ORG/REPO/rulesets --input .github/rulesets/main-protection.json
       ```
    2. Open a test PR that touches crypto/infrastructure and verify that mandatory checks block changes if they fail.
  - Pending manual: reimport the ruleset after any change in mandatory checks.

- [ ] **3. RPO/RTO and SLOs registered and confirmed**
  Reference values already exist in `docs/operations.md`; missing **official confirmation** (responsible person approval) and fixed quarterly review.
  - Evidence: [docs/operations.md](operations.md) → "SLOs and objectives": availability 99.9% (30 days), p95 signaling < 500 ms, 5xx < 0.5%, WS saturation < 70%, error-spike 0; **RPO 24 h**, **RTO 24 h** (vault) / **4 h** (server topology).
  - Known debt: [docs/architecture.md](architecture.md) → "Pending decisions" (SLO/RPO/RTO not formally fixed).

- [ ] **4. Responsible and alert channel before launch**
  Name who receives incident alerts and the contact channel (status page, email).
  - Evidence: [docs/operations.md](operations.md) → "Guard: responsible parties and alert channel must be registered before public launch".

- [ ] **5. GDPR legal closure**
  Document: data controller, purposes, legal basis, minimization, retention, rights, processors/sub-processors, international transfers, consent and incident procedure.
  - Evidence: [docs/ROPA.md](ROPA.md) — **operational fields filled (2026-08-31)**: legal bases and retention by processing (§3/§5), consent register and response deadlines (§9), incident procedure (§10), fixed quarterly review (§12). Legal closure remains **pending**: `⚠ PERSONAL DATA` fields remain about legal controller identity (§1), control authority (§1) and provider-signed DPA (§7/§8). [docs/security.md](security.md) → "GDPR" (technical controls ≠ legal certification); recognized as debt in [docs/audit.md](audit.md) §2 and §5.
  - **Remaining steps (external, operator):** complete guide in [docs/legal-closing-package.md](legal-closing-package.md) — provider DPA inventory, signing order with dependencies, templates and signature register.
    1. Fill §1: legal name, seat and competent control authority.
    2. Sign/keep provider DPAs (§7/§8): hosting, Sentry, AI providers.
    3. Confirm with legal review (the template is operational, not a legal opinion).

---

- [ ] **16. Critical routes smoke green against production build**
  Playwright battery of 7 tests that exercises routes that cannot fail on day 1: vault with 12-character password, recovery with 24-word phrase, Pro license activation with real signature (+ invalid key failing closed) and encrypted .bmf backup round-trip after simulated total loss.
  - Evidence: [docs/launch-day-smoke.md](launch-day-smoke.md) (runbook: topology, triage, relationship with signature keys).
  - Gate: `npm run launch:smoke` — verdict "ALL CRITICAL PATHS GREEN — cleared to release".
  - Real device complement: certify an iPhone with [docs/ios-manual-test-script.md](ios-manual-test-script.md) (vault creation, 24-word phrase, .bmf backup off-device and Safari IndexedDB purge at 7 days) — Android emulated is covered by `npm run e2e:mobile`. Day 0 execution sheet: [docs/ios-day0-session-sheet.md](ios-day0-session-sheet.md) (includes HTTPS drill mode `VITE_DEV_HTTPS=1` for secure context on iPhone).
  - Real device complement for sync: certify P2P pairing iPhone ↔ desktop with [docs/p2p-sync-manual-test-script.md](p2p-sync-manual-test-script.md) (double QR with real cameras, sync on LAN, LWW conflicts and air-gapped verification) — logic is already automated in `tests/e2e/vault-sync-real.spec.ts` (and in CI with `e2e:sync`). Use session sheet with ordered captures: [docs/p2p-sync-session-prep.md](p2p-sync-session-prep.md).

## 🟠 External validation — independent review

- [ ] **6. Pentest (real attack test)**
  Test the entitlement endpoint and license flow, telemetry, WebSocket and backup flows. (AI proxy was retired: no longer part of attack scope.) Documented as pending.
  - Evidence: [docs/audit.md](audit.md) §2 ("Pentest documented as pending"), [docs/security.md](security.md) → "External validation required", [docs/internal-security-checklist.md](internal-security-checklist.md) → "Cannot verify locally".
  - **Progress:** `scripts/penetration-test.mjs` — pentest runner with 7 phases (reconnaissance, vulnerability scan, authentication tests, cryptographic review, OWASP Top 10, business logic, report generation). CI flow in `.github/workflows/pen-test.yml` (monthly + pre-production).
  - Gate: `node scripts/penetration-test.mjs --target <url> --scope full` generates JSON/MD reports in `pen-test-reports/`. All CRITICAL and HIGH findings must be remediated before production deployment.

- [ ] **7. Manual accessibility (WCAG) and privacy review**
  Automated review (axe-core WCAG A/AA in CI) already exists; missing manual review with people (screen reader, keyboard, contrast) and human review of privacy policy.
  - Evidence: [docs/audit.md](audit.md) §4 ("Manual WCAG review documented as pending"), [docs/security.md](security.md) → "External validation required".

- [ ] **8. Independent SAST (CodeQL + Semgrep) in CI**
  Independent static analysis layer with severity policy (block High/Critical) and PR annotations.
  - Evidence: [.github/workflows/sast.yml](../.github/workflows/sast.yml) (jobs "CodeQL analysis" and "Semgrep analysis"), `scripts/check-sarif-severity.mjs` with tests, [first run triage guide](sast-triage.md); added as mandatory checks in `main` ruleset (pending reimport in GitHub).
  - Gate: `npm run check:workflows` (validates workflows), `npm run check:sarif-severity` (gate over a SARIF).
  - Pending: run first run (workflow_dispatch), triage findings, and create the triage log with the results — `docs/sast-triage.md` §7 defines the file to write and its columns.

---

## 🟡 Shortly after launch (first quarter)

- [ ] **9. Error logging with PII redaction and opt-in**
  Remote error reporting (Sentry) with `beforeSend` redactor, **disabled by default**: only sends if operator configures `VITE_SENTRY_DSN` **and** user opts in consent banner.
  - Evidence: [src/telemetry/remoteErrorReporter.ts](../src/telemetry/remoteErrorReporter.ts) (URLs without query, secrets redacted, no identity, consent per event; SDK with dynamic import), `@sentry/browser` in `package.json`, [docs/ROPA.md](ROPA.md) §3 T7 and §7, [docs/audit.md](audit.md) §6.
  - Gate: `npm run check:launch-checklist` (verifies dependency + module with redaction and opt-in).
  - Pending operational: configure operator DSN and sign DPA with Sentry (ROPA §7) before activating in production.

- [x] **10. Opt-in business analytics (decision taken and implemented 2026-08-31)**
  Opt-in channel, aggregated and non-PII: client sends ONE daily bucket per installation (counts by event type, no vault content, no IP, no raw id — only SHA-256 of a random installation id) to companion server when user opts in banner (`forge_consent_analytics`, default OFF). Server aggregates DAU/WAU/MAU, retention by cohort D1/D7/D30 and activation funnel; GET `/api/analytics/kpis` with admin token (`ANALYTICS_ADMIN_TOKEN`) and persistable state (`ANALYTICS_STATE_FILE`).
  - Evidence: [server/src/business-analytics.ts](../server/src/business-analytics.ts), [src/services/analyticsForwarder.ts](../src/services/analyticsForwarder.ts), `npm run kpi-report`, [docs/ROPA.md](ROPA.md) §3 T8 and §4.
  - Gate: unit tests `src/tests/server/business-analytics.test.ts` and `src/tests/services/analyticsForwarder.test.ts`; end-to-end smoke verified (POST 204, KPIs 200, 401 without token, 400 invalid). Automated channel monitoring is item 19 (Nightly KPI gate).

- [x] **11. Companion server load test**
  Validate current limits (WS connections, rate limits) with real load. Implemented in [scripts/load-test-server.mjs](../scripts/load-test-server.mjs) (`npm run test:load`): starts isolated server and validates budgets aligned with SLOs from [docs/operations.md](operations.md) — p95 join and relay signaling < 500 ms, saturation (1013 rejection above `MAX_CONNECTIONS`) and `/health` alive under load. (AI proxy was retired in 2026-09 and with it its upstream mock: server no longer proxies providers.)
  - Evidence: [scripts/load-test-server.mjs](../scripts/load-test-server.mjs), `npm run test:load`, `--json` for CI. Pending operational: first run against staging with real load.

- [ ] **12. Versioned contracts with external integrations**
  Formally document contracts (e.g. OpenAPI) with Whop and AI providers. Risk of dependency without versioned contract.
  - Evidence: [docs/audit.md](audit.md) §1 ("Integrations | Mixed") and §5 (Whop).

- [x] **13. Quarterly disaster drill (automated and executed 2026-08-31)**
  The full quarterly drill is formalized in CI: `.github/workflows/drill-quarterly.yml` (first day of each quarter + manual dispatch) executes backup-restore drill (RTO < 120 s) **and** Docker rollback drill (PATH A by image < 60 s, real images from previous `prod-*` tag). Requires ≥ 2 `prod-*` tags in repo.
  - Evidence: [.github/workflows/drill-quarterly.yml](../.github/workflows/drill-quarterly.yml), [docs/operations.md](operations.md) → "Quarterly disaster recovery drill" and "Local execution evidence (re-run) — Docker rollback".
  - **Executed (2026-08-31)** against local stack and real `prod-*` tags (`prod-20260831-1320-00b24d6` → `prod-20260831-1315-8f44a84`):
    - **Docker rollback** (`DRILL_DOCKER=1`): 6 phases, exit 0 — PATH A by image **9.6 s < 60 s (gate)** · BASELINE/RE-VERIFY 11/11 (re-run 224.6 s; first run 167.4 s, PATH A 12.2 s).
    - **Backup-restore** (`npm run drill:backup-restore`): restore BMF 6.6 s / plaintext 6.5 s, gate RTO < 120 s, `degraded: []` (no alert).
    - **Monthly drill** in `nightly.yml` (job `drill-backup-restore`, day 1 of month 03:17 UTC + dispatch) with RTO degradation alert (`DRILL_ALERT_WEBHOOK_URL`).
  - Pending external: first run in CI — requires repo push to GitHub (workflows do not yet exist in remote) and ≥ 2 remote `prod-*` tags; register run link as quarterly evidence.

- [ ] **14. Extension publication checklist**
  Prepare publication in Chrome Web Store / AMO (description, screenshots, extension privacy policy).
  - Evidence: [docs/audit.md](audit.md) §5 ("Missing ASO/extension store checklist").

- [x] **19. Nightly KPI gate (automated and verified 2026-08-31)**
  Opt-in analytics (item 10) stops being a passive collector: `kpi-report.mjs` calculates DAU/WAU/MAU and D1/D7/D30 retention by cohort and contrasts with configurable thresholds (`KPI_MIN_DAU/WAU/MAU`, `KPI_MIN_D7/D30_PCT`); below threshold emits `analytics_kpi_below_threshold` and fires HTTPS webhook (native Slack payload for `hooks.slack.com`, no PII; `http` rejected). Job `kpi-staging` in `nightly.yml` runs it against staging (admin token `STAGING_ANALYTICS_ADMIN_TOKEN`) and **fails the run** if a KPI drops. Collector validates itself in CI against local server (`kpi-collector-local` in `drill-quarterly.yml`).
  - Evidence: [scripts/kpi-report.mjs](../scripts/kpi-report.mjs), [.github/workflows/nightly.yml](../.github/workflows/nightly.yml), [scripts/kpi-local-collector-check.mjs](../scripts/kpi-local-collector-check.mjs), [docs/operations.md](operations.md) → "Nightly KPI gate" and "Slack connection (Incoming Webhook)".
  - Gate: 17 unit tests of `kpi-report` (incl. Slack detection and payload shape); local harness executed in PASS (DAU/WAU/MAU + D7 retention with exact thresholds, exit 0).
  - Pending external: configure secrets in GitHub (`STAGING_ANALYTICS_ADMIN_TOKEN`, `ANALYTICS_ALERT_WEBHOOK_URL`) and vars (`KPI_MIN_*`, `STAGING_URL`) and activate admin token in staging (same value as secret).

---

## 🟢 Environment verification — not verifiable from repository

- [ ] **15. GitHub Actions secrets, environments and permissions**
  Review what secrets exist, what environments are configured and who can launch deployments.
  - Evidence: [docs/internal-security-checklist.md](internal-security-checklist.md) → "Cannot verify locally" (environment and permission configuration).

- [ ] **16. Real security of staging and production**
  Review deployed infrastructure: TLS, non-root user, staging ports bound to loopback, absence of published internal services, etc. (code forces almost everything; missing inspect deployment). No Redis or database to review: topology is two stateless services.
  - Evidence: [docs/security.md](security.md) → "Mandatory production configuration"; [docs/internal-security-checklist.md](internal-security-checklist.md) → "Cannot verify locally".
  - Gates: `npm run check:http-config`, `npm run check:compose-config`, `npm run check:runtime-config`, `npm run check:docker-context`.

- [ ] **17. Authenticated DAST enabled**
  Basic nightly ZAP scan already runs; authenticated remains intentionally disabled (`if: ${{ false }}`). Already verified: context (`.zap/authenticated.context`), image digest `sha256:781a2bda…5081ef` (stable tag) and action SHA `de8ad967…b8b25` (tag `v0.15.0`, PGP-signed annotated tag, verified against official release). Missing: staging supplies real secrets (`STAGING_DAST_CONTEXT_B64`, `STAGING_DAST_CONTEXT_PASSWORD`) and validate authenticated scan against environment.
  - Evidence: [.github/workflows/dast-nightly.yml](../.github/workflows/dast-nightly.yml) (steps disabled with documented credential contract), [docs/internal-security-checklist.md](internal-security-checklist.md) → "Cannot verify locally".
  - Gates: `npm run check:zap-baseline`, `npm run check:zap-context`, `npm run check:zap-workflow`, `npm run check:workflows`.

- [ ] **18. Mandatory production configuration verified**
  `NODE_ENV=production`, exact `AI_SESSION_ORIGINS` (allow-list of `/api/license/entitlement`), `ENFORCE_SIGNAL_HMAC=1`, `TRUST_PROXY` only if applicable, keys only by secret manager. No AI credential to configure.
  - Evidence: [docs/security.md](security.md) → "Mandatory production configuration".
  - Gate: `npm run check:env`, `npm run check:secrets-in-commit`.

---

## Automated evidence (gates)

Execute before launch and in CI; results preserved as evidence (see [docs/operations.md](operations.md) → "Release preflight"):

```bash
npm ci
npm run typecheck:prod
npm run lint
npm run test
npm run build:ci
npm run check
npm run check:security-internal
npm run check:secrets-in-commit
npm run check:audit
```

Checklist progress (verifies verifiable and marks rest as manual):

```bash
npm run check:launch-checklist          # report (exit 0)
npm run check:launch-checklist:strict  # fails if any 🔴 blocking is incomplete
```

Automatic strict mode execution: job `launch-readiness` in [.github/workflows/nightly.yml](../.github/workflows/nightly.yml) (daily verification) and point 10 of pre-deploy gate `scripts/check-blindeo.mjs` (blocks production deployments while blockings open, via `deploy-prod.mjs` Phase A).

The complete list of covered controls and what **cannot** be verified locally is in [docs/internal-security-checklist.md](internal-security-checklist.md).
