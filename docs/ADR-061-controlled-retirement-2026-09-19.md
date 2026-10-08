# ADR-061: Controlled documentation retirement — first batch (2026-09-19)

- **Status:** Accepted (2026-09-19)
- **Date:** 2026-09-19
- **Related:** [ADR-059 — Controlled documentation retirement](ADR-059-documentation-retirement.md), [ADR-028 — Gate drift detection](ADR-028-gate-drift-detection.md), [ADR-040 — Markdown gate fusion](ADR-040-docs-markdown-gate-fusion.md)

## Context

The September 2026 mass documentation retirement was carried out **without going through the consent mechanism** of ADR-059: the `check:docs-retire` gate only consents to rows marked `retirable` whose files **still exist**, and it was not wired into `npm run check`, so nothing stopped 79 documents from vanishing at once — including compliance material with no equivalent replacement. Restoring the corpus left the mechanism intact but inert: the gate existed, it had a proven contract, and nobody ran it.

This ADR records the **first real controlled retirement** executed through that
mechanism, file by file, with the rationale required by ADR-059.

## Decision

The retirement is executed with ADR-059's full mechanism: prior gate consent on `retirable` rows, deletion, live-reference review, index and baseline
regeneration, and a durable file-by-file record of the rationale.

### 1. The gate becomes mandatory

`check:docs-retire` (`scripts/check-docs-retire.mjs`) is integrated into the `npm run check` chain, immediately after `check:docs-markdown`. From now on, any `retirable` row that does not meet the consent conditions (empty note, missing file, path outside `docs/`) breaks CI, and the transitional `retirable` state cannot survive a commit (the canonical index does not express it and `doctor-docs-index` rejects it).

In the public export the index is private and does not travel: the gate explicitly *skips* when it detects the index's absence alongside the export's `manifest.json`. Without a manifest, the missing index is still a failure (exit 2).

### 2. Retired files (consent obtained: 3/3 `retirable` rows)

| Retired file | Why it is dispensable | Updated references |
|---|---|---|
| `docs/audit-report-2026-09-04.md` | Audit delta over the 2026-09-02 report, declared **superseded by the ledger** `docs/audit.md` in its own finding A6-6. Its content lives in the ledger and in the primary report. | A6-6 row of `docs/audit.md` rewritten to reflect the retirement and explain why the primary report is kept. |
| `docs/drill-run-2026-08-31-rollback-docker.md` | Record of a **FAIL** run of the Docker rollback drill (it failed at PREP). The current evidence is the **PASS** re-run documented in `docs/operations.md` and in the ledger; the failed record described an already-corrected state. | Link removed from `docs/launch-checklist.md` (evidence 13) and citation dropped from the `docs/audit.md` ledger row. |
| `docs/release-note-r3-4.md` | Point-in-time release note (2026-08-31, rounds 3/4) with **zero live references** in the repository; its scope is covered by `docs/RELEASE-STATUS.md`, the `docs/audit.md` ledger and the operations runbooks. | None (it had no references). |

### 3. Files evaluated and **rejected** (kept)

| File | Reason for keeping |
|---|---|
| `docs/audit-report-2026-09-02.md` | It is the **provenance** of findings M-1 and B-1, cited by ADR-038, ADR-039, `scripts/sw-integrity-runtime.js` and a security regression test. Retiring it would mean rewriting citations in security ADRs and in code. |
| `docs/que-nos-falta.md` | ~~Retired~~ (2026-09-19, this commit). Its 4 unique debts (S3 lifecycle bucket, composite sign/rewrite action, streak-ramp parity in the consistency SVG, flaky monitoring-alerts test) were migrated to `docs/ops-nightly.md` §8 and `docs/PENDIENTES.md` P2. Remaining operational content (infrastructure blockers, legal closure, execution order) verified as covered by the 4 live sources. |
| `docs/legacy-compatibility-plan.md` | **Active** (compatibility retirement policy with owner and per-surface retirement criteria). |
| `docs/scripts-inventory-scanner-limits.md` | **Active** (operational documentation of the `check:audit-script-snapshot` gate). |
| `docs/ios-day0-session-sheet.md`, `docs/p2p-sync-session-prep.md` | Live operational material: referenced by `docs/launch-checklist.md` and by `scripts/capture-p2p-desk-drill.mjs`. |
| `docs/history-attribution.md` | Single decision record (why history was not rewritten); no alternative source exists. |
| Rest of the corpus (security, compliance, RPO/RTO, API contracts, ADRs, manuals) | Categories protected by ADR-059 or live product documentation. |

## Consequences

- The canonical inventory drops to 101 documents and the `check:docs-markdown` baseline to 100 files; both regenerated in the same change.
- **Later** (2026-09-19, same day): `docs/que-nos-falta.md` was retired after migrating its 4 unique debts to `ops-nightly.md` §8 and `PENDIENTES.md` P2; the inventory ends at **102 documents** (101 − 1 + `CHANGELOG.md`).
- The retirement is traced here (ADR-059 accepts PENDIENTES.md or an ADR as the record) and live references now point to the current sources, not to superseded artifacts.
- Future retirements repeat the flow: mark `retirable` with a note, pass the gate, delete, update references, regenerate index and baseline, and record the rationale. The intermediate `retirable` state is never committed.
- The gate in CI prevents a retirement mark with insufficient reason or unreviewed references from reaching `main`.
