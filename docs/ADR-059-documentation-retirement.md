# ADR-059 — Controlled documentation retirement

## Status

Accepted

## Date

2026-09-19

## Context

Historical documentation grew along with the product and some guides stopped
representing the current architecture. Deleting files without updating
references produced CI failures and could hide a loss of operational coverage.

## Decision

Retired documents are explicitly deleted and the change is recorded in
`docs/PENDIENTES.md` or in an ADR. `docs/docs-state-index.md` reflects only
present documents. The `check:docs-retire` gate prevents retiring a document that has no
reason and reference review, and `check:docs-index` prevents the intermediate `retirable` state
from surviving a commit: the canonical inventory is derived from disk and
only emits `vivo` or `transitorio`, so a row marked for retirement that does not
complete the flow (consent → deletion → regeneration) breaks the `npm run check` chain instead of
remaining as a pending mark. RPO/RTO/SLO, security, compliance and API contracts
cannot disappear without an equivalent replacement.

## Consequences

The inventory stops being a historical list of deleted files and becomes a
verifiable catalog of the checkout. Mass retirements require reviewing scripts,
workflows, tests and documentary references before regenerating baselines. This
decision (which entered a numbering conflict with the original ADR-026 and was
therefore renumbered) supersedes the thousand-plus words of accumulated context in
the previous audits and keeps the traceability needed for future retirements.
