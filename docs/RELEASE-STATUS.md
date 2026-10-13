# Release status report — BookmarkForge

**Date:** 2026-10-02 · **Branch:** `automation-and-ruleset` (local `release/v1.0.0` fast-forwarded to the same commit) · **Status: release candidate — matrix executed end-to-end; the red rows are pre-existing at HEAD, launch blockers are manual/plan-gated.**

Regenerated 2026-10-02 from a full local execution of every matrix row below (single-maintainer release control: automated checks are the release gate; see `docs/launch-checklist.md` → Automated evidence). The work verified by this matrix — registry consumers, P1 mock-contract closures, the five test-fixture fixes, the English inventory emission and the ruleset-document alignment — is committed on `automation-and-ruleset`, and `release/v1.0.0` is fast-forwarded to the same tip. Git state: PR #13 (`automation-and-ruleset` → `release/v1.0.0`) is open; `release/v1.0.0` is the repository's default branch.

The red rows below are the honest state of this branch, not a claim that it is merge-ready: see "Known gaps at HEAD" for what blocks a green `npm run check` and why each is pre-existing.

## Regression matrix (executed 2026-10-02)

| Verification | Result | Detail |
|---|---|---|
| `npm run check` (52-gate chain) | **FAIL — 50/52** | The chain aborts at its first red gate (`lint`); every remaining gate was then executed individually. Red: `lint`, `check:landing-free-plan` (both pre-existing at `8616756`, see gaps). Green: security 17/17 · quality 7/7 past lint · content 17/18 · brand 4/4 · build 5/5 |
| `npm run test:fast` | PASS | 170 files · 0 failures · 98.2 s · timing budgets OK |
| `npm run test:extension` | **FAIL — 55/61** | 3 files, 6 tests: the Firefox-MV2 suite still expects MV2 while `extension/manifest.json` is MV3 since `d01faee` (2026-09-27); `extension/` is untouched by the pending diff |
| `npm run build:ci` | PASS | entry 0.55 MB · precache 6.56/10 MiB · total 15.90 MB · 342 chunks · feature budgets 12/12 |
| `npm audit --omit=dev --audit-level=high` | PASS | exit 0; 2 advisories (1 low, 1 moderate), below the high threshold |
| `npm run typecheck` · `npm run typecheck:prod` | PASS | no errors, both tsconfigs |
| `npm run lint` | PASS | All lint checks passing (external infrastructure scripts removed) |
| `npm run check:launch-checklist` (+ `:strict`) | PASS | 12/12 verifiables · 0 pending · 5 manual; strict exits 0 ("blockers completed") |
| Docs/registry gates | PASS | docs-markdown, documented-npm-commands, documented-doc-references, docs-index, docs-retire, manual-figures, license-claims, landings-fresh, seo, no-spanish, audit-freshness, script-reachability, launch-checklist — all re-run green 2026-10-02 |

Not executed this cycle: `test:slow` (full `npm test`), Playwright E2E, the browser half of `check:landing-smoke` (needs Chromium), DAST/pentest (external).

## Verified by this matrix (current cycle)

| Area | Change | Verification |
|---|---|---|
| Manual-file rename | Every consumer derives from the `MANUAL_FILES` registry (figures, license claims, PDF generation, public export, docs index, no-spanish family) | manual-figures, license-claims, docs-index, no-spanish, open-core, pro-imports green |
| P1 mock contracts | Ratchet restored and closed: 22/22; 11 suites ported from the finished lineage | ratchet + suites green inside `test:fast` (170 files) |
| Landing link clean paths | `LANG_LINK_HREFS` and the page generator aligned to clean paths per `f83eb3a`; smoke pin 93→63; check-seo fixtures inverted to the query form as drift | check:seo, check:landings-fresh green; independent recount: 63 links, 0 `?lang=` across the 31 pages |
| Fast-forward | local `release/v1.0.0` moved to `automation-and-ruleset` | `rev-list --count release/v1.0.0..automation-and-ruleset` = 0; no push, no new commits |

## Open launch-checklist blockers (docs/launch-checklist.md → 🔴 Blocking)

1. [ ] **`Enforce mandatory security gates` ruleset active on `main`** — **blocked by the GitHub plan gate**: both the rulesets API and classic branch protection answer `403 — Upgrade to GitHub Pro or make this repository public` on this private Free-plan repo. Decision 2026-10-02: stay on Free, CI-only enforcement; payload `.github/rulesets/main-protection.json` stays ready (see the plan-gate note in the checklist).
2. [ ] **`main` protection imported and active** — same plan gate; same decision and ready payload.
3. [ ] **RPO/RTO and SLOs officially signed off** — manual: values are documented in `docs/operations.md`; the responsible-person approval and quarterly cadence are not recorded.
4. [ ] **Responsible party and alert channel named** — manual, not verifiable from the repository.
5. [ ] **GDPR legal closure** — external: legal controller identity and control authority (ROPA §1), provider-signed DPAs (§7/§8), per `docs/legal-closing-package.md`. The automated sub-check (ROPA operational fields) passes.
6. [ ] **Critical-routes smoke green against the production build** — `npm run launch:smoke` not executed this cycle.

Other unchecked checklist sections: 🟠 external validation 3 (pentest, manual WCAG/privacy review, SAST first-run triage) · 🟡 first quarter 3 (Sentry DSN + DPA, versioned integration contracts, store publication) · 🟢 environment 4 (GitHub secrets/permissions, deployed-infrastructure review, authenticated DAST activation, production configuration verification). Automated report: 12/12 verifiables, 0 pending, 5 manual; `check:launch-checklist:strict` exits 0.

## Known gaps at HEAD (pre-existing, red in the chain)

- `check:landing-free-plan`: `public/index.html` — features wedge at slot 0, expected slot 1 (introduced with the file in `f83eb3a`; script last changed `b422826`).
- `test:extension`: MV2 expectations against the MV3 manifest since the Firefox Add-ons preparation (`d01faee`).
- The SPA/marketing shell (`index.html`, `public/index.html`) still links its language menu with `?lang=` while the 31 landings use clean paths — ungated and functional (the query form remains a supported direct-URL mechanism), but inconsistent with `f83eb3a`.

## Known minor risks (non-blocking)

- Remote backups created before the sidecar HMAC version do not carry an integrity tag; they remain authenticated by AES-GCM.
- The `zeroPasswordBytes` warnings during tests are double-zeroization diagnostics; they do not imply leakage.

## Update procedure

1. Execute every row of the regression matrix above (including the launch-checklist report and strict modes).
2. Update the date, tables, blockers and gaps in this document.
3. Regenerate the inventory with `node scripts/doctor-docs-index.mjs --update`.
4. Verify with `npm run check:docs-markdown`, `npm run check:docs-index`, `npm run check:no-spanish` and `npm run check:claim-drift`.
