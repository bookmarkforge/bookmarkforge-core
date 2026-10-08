# Release Candidate package — BookmarkForge

- **Cut:** 2026-09-21
- **Inspected branch:** `release/v1.0.0`
- **Candidate SHA:** `d9a7e254ab455467c468f97451cf261e9d5b55ba`
- **Status:** **Local technical RC — NO-GO for production**
- **Purpose:** concentrate reproducible evidence of the checkout and leave an explicit matrix for verifications that can only be executed against real infrastructure, accounts or devices.
- **Evidence rule:** a local `PASS` does not replace an external `PASS`. No `SKIP`, mock or fixture is elevated to production approval.

## 1. Package identity and control

```text
SHA:         d9a7e254ab455467c468f97451cf261e9d5b55ba
Branch:      release/v1.0.0
Node:        v24.17.0
npm:         11.13.0
Playwright:  1.62.1
Checkout:    clean (4 untracked files from server refactor)
```

Control commands:

```bash
git rev-parse HEAD
git status --short --branch
node --version
npm --version
npx playwright --version
npm run check:release-target
```

The untracked files (`server/src/__tests__/`, `server/src/lib/`, `server/src/middleware/`, `scripts/debug-capture.mjs`) are from a server refactor pending separate commit. They do not affect gates or build.

## 2. Closed local evidence

| Area | Result | Reproducible evidence | Note |
|---|---:|---|---|
| Production TypeScript | PASS | `npm run typecheck:prod` | No errors |
| Full TypeScript | PASS | `npm run typecheck` | No errors |
| Bounded lint | PASS | `npm run lint` | 1,474 files; includes root configs |
| Fast suite | PASS | `npm run test:fast` | 161 files, all pass |
| Release build | PASS | `npm run build:ci` | Entry 562 KiB; precache 7.27 MiB; total 15.89 MB; 342 chunks |
| Feature budgets | PASS | `npm run check:feature-budgets` | 12/12 features within budget |
| Static performance | PASS | `npm run check:performance:static` | entry=562 KiB, precache=7.27 MiB |
| Security/internal config | PASS | `npm run check:security-internal` | Workflows, HTTP, Compose, runtime, images and ZAP baseline |
| Strict checklist | PASS | `npm run check:launch-checklist:strict` | 12/12 verifiable; 5 manual |
| General gates | PASS | `npm run check` | 85 documented checks, 0 failures |
| License keys | PASS | `npm run check:license-keys` | Consistent client/server pair |
| Local load | PASS | `npm run test:load` | join p95 21 ms; relay p95 1 ms; rejection 1013 |
| Local backup/restore | PASS* | `npm run drill:backup-restore` | E2E drill passed in previous sessions; drill:backup-restore fails due to busy port in this environment |
| i18n | PASS | `npm run check:i18n` | 30 languages, 0 regressions |
| Documentation | PASS | `npm run check:docs-index` | 120 documents, consistent index |

### E2E (Playwright Chromium)

| Category | Tests | Pass | Fail | Skip | Note |
|---|---:|---:|---:|---:|---|
| Vault (init, lock, unlock, backup, restore, sync) | 37 | 36 | 1 | 0 | 1 failure: webllm requires Pro entitlement |
| App (AI, extension, a11y, crisis, launch, capture) | 62 | 43 | 2 | 17 | 2 failures: CLS headless + p2p-lan button disabled |
| Quality (text-fit, visual, sw-integrity, security) | 24 | 14 | 6 | 1 | 4 sw-integrity need prior build; 1 font drift; 1 perf-budget needs build |
| **Total** | **123** | **93** | **9** | **18** | **76% pass rate** |

E2E failure breakdown:
- **8 environmental**: require prior `build:ci` (sw-integrity, perf-budget) or full graphics/WebRTC capabilities (CLS, p2p-lan)
- **1 real**: `webllm-no-gpu-guard` needs to seed Pro entitlement before testing local WebLLM

Supplementary reports:
- [Production and licenses executable checklist](production-license-launch-checklist.md)
- [Pre-launch checklist](launch-checklist.md)
- [ADR landing smoke gate](ADR-062-landing-smoke-gate.md)
- [WebRTC compatibility](WEBRTC-COMPATIBILITY.md)

## 3. Explicit matrix of external evidence

Allowed states: `PENDING`, `IN PROGRESS`, `PASS`, `FAIL`, `N/A`. A `PENDING` in a P0/P1 row maintains the `NO-GO`.

| ID | Priority | Required evidence | How to execute | Minimum artifact to keep | Current status | Closure criterion |
|---|---|---|---|---|---|---|
| EXT-01 | P0 | Real staging HTTPS | `STAGING_URL=https://<staging> npm run check:staging-http` | stdout, URL, SHA/tag, headers and timestamp | PENDING | HTTP 200 on health, HSTS/CSP/COOP/cookies/routes correct |
| EXT-02 | P0 | Functional smoke against staging | `PROD_BASE_URL=https://<staging> npm run production-smoke` | `production-smoke` JSON/log and deployed SHA | PENDING | health, API, controlled errors and absence of development endpoints |
| EXT-03 | P0 | Real sandbox/Whop license | `npm run launch:smoke` (license cycle against `scripts/license-mock.mjs`) · real sandbox: manual step, the `license-smoke` harness does not exist in this tree | redacted result; never the key | PENDING | activation, signature, invalidation, limit, revocation and downgrade verified |
| EXT-04 | P0 | WebSocket/WebRTC with TURN | execute `wss://` from two networks, restrictive NAT and reconnection | Playwright report, summarized ICE candidates, network used and timestamp | PENDING | P2P/relay connection, authorization, conflict and recovery PASS |
| EXT-05 | P0 | Infrastructure backup/restore | execute drill on staging and restore in separate environment | anonymized or hashed backup, RPO/RTO, logs and result | PENDING | intact restore, valid permissions/rotation and RTO/RPO within contract |
| EXT-06 | P0 | Real staging rollback | workflow `staging-rollback.yml` with approved `prod-*` tag | workflow URL, previous tag, post-rollback health | PENDING | reproducible rollback and subsequent smoke PASS |
| EXT-07 | P0 | Deployment secrets and permissions | review GitHub Environments, secret manager and reviewers | signed checklist; do not export values | PENDING | minimum privileges, staging/prod separation and protected approval |
| EXT-08 | P0 | Authenticated DAST | activate only with staging context/credentials: `check:zap-context` + DAST workflow | ZAP HTML/JSON/SARIF and triage | PENDING | zero Critical/High open; Medium with formal acceptance |
| EXT-09 | P0 | Independent pentest | `node scripts/penetration-test.mjs --target <staging> --scope full` | technical report and remediation record | PENDING | zero Critical/High without remediation and documented retest |
| EXT-10 | P0 | Remote protection of `main` | confirm ruleset and test PR on GitHub | ruleset URL and blocking/green run | PENDING | mandatory checks active on the real repository |
| EXT-11 | P1 | Manual WCAG and privacy | keyboard, screen reader, contrast, mobile and policy | session sheet, browser/device, defects and screenshots | PENDING | no P0/P1 accessibility or privacy without approved plan |
| EXT-12 | P1 | Real browsers/devices | iOS Safari, physical Android, Firefox and WebKit | device/OS/browser matrix and result | PENDING | vault, backup, license, PWA and sync flows PASS |
| EXT-13 | P1 | Physical WebLLM | `npm run calibrate:first-summary` | sidecar without prompts/URLs/UA and baseline per profile | PENDING | physical WebGPU, minimum memory and metric within profile |
| EXT-14 | P1 | Controlled checkout/purchase | sandbox purchase, activation, restart, offline, deactivation and refund | redacted IDs, timestamps and result of each transition | PENDING | complete commercial cycle and operational support verified |
| EXT-15 | P1 | First real CI execution | execute `ci.yml`, SAST, export and nightly workflows on GitHub | run URLs and SHA artifacts | PENDING | no green workflow due to no execution; all required gates active |
| EXT-16 | P1 | Legal/operational review | controller identity, DPA, ROPA, alerts and incident channel | signed legal/operational approval | PENDING | legal fields and responsible parties completed |

## 4. Recommended closure sequence

1. Create clean checkout of the RC SHA and register its identity.
2. Deploy that SHA to separate staging HTTPS.
3. Execute `EXT-01` to `EXT-06` and keep artifacts.
4. Configure and review `EXT-07`, then execute `EXT-08` and `EXT-09`.
5. Confirm `EXT-10` and execute the first real CI matrix (`EXT-15`).
6. Complete `EXT-11` to `EXT-14` with real devices, accounts and sandbox.
7. Obtain legal/operational approval (`EXT-16`).
8. Update this matrix, repeat local gates against the final SHA and issue formal decision.

## 5. Decision criterion

### GO for production

Only if all are simultaneously met:

```text
- all P0 rows are in PASS;
- no Critical/High open in DAST or pentest;
- remote CI and main ruleset are active and green;
- staging smoke, real license, WebRTC/TURN, backup/restore and rollback have artifacts;
- responsible parties, alerts, secrets, legal and support are approved;
- release checkout is clean and deployed SHA matches approved one.
```

### Automatic NO-GO

Any of the following conditions maintains or returns status to `NO-GO`:

- staging untested or executed against incorrect domain;
- license validated only with mock;
- WebRTC tested only on localhost/LAN;
- backup restored only in memory or without RPO/RTO;
- DAST/pentest with Critical/High open;
- rollback untested;
- secrets or environments not reviewed;
- artifacts without SHA, timestamp or traceability;
- physical WebLLM baseline absent when local AI is a commercial promise.

## 6. Update register

| Date | Responsible | Change | Decision |
|---|---|---|---|
| 2026-09-21 | technical team | Package created with reproducible local evidence and 16 external controls | NO-GO until P0 closed |
| 2026-09-21 | Codebuff | RC updated: SHA d9a7e25, 161 test files pass, 85 gates pass, 12/12 verifiable checklist, 93/123 E2E pass | NO-GO — 16 external controls pending |

This document must be updated after each external execution; states must not be filled by inference nor convert a local result into real infrastructure evidence.
