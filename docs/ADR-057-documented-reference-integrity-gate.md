# ADR-057: Documented reference integrity gate

- **Status:** accepted (implemented in `scripts/check-documented-doc-references.mjs`)
- **Date:** 2026-09-18

## Context

Operational documentation can stay apparently correct after a file
or an endpoint is retired: the Markdown still renders, but the runbook leads
to a nonexistent route or to evidence that is no longer in the checkout. Retiring
the AI proxy left exactly this kind of risk in probes, audits and
runbooks.

It is not valid to scan the whole repository with the same policy. ADRs, audits
and the documentation index deliberately keep retired names as historical evidence.
The corpus must focus on live documentation: onboarding, workflows and documents
marked `vivo` in `docs/docs-state-index.md`.

## Decision

1. Add `check:documented-doc-references` to the official `npm run check` chain.
2. Scan concrete local-file references in the live corpus and fail if
   the target does not exist.
3. Extract concrete HTTP paths and check them against `server/src/route-table.ts`,
   honoring paths declared as prefixes.
4. Ignore historical families (`ADR-*`, `docs/audit.md` and the index itself) and
   wildcard family expressions, which do not describe a single target.
5. Emit file, line and failing reference to make the fix easy.
6. Register the gate in the freeze inspector as category `docs` and keep this
   ADR as the scope contract.
7. **Amendment 2026-10-12 — bare and parent-relative links enter the scope.**
   Point 2 only saw references rooted at a known top-level directory (`docs/`,
   `scripts/`, …) or an explicit filename, so a Markdown link written the way a
   reader's client resolves it — `](user-manual-ar.md)` from inside `docs/`, or
   `](../TRADEMARKS.md)` — was never validated. That blind spot let 56 dangling
   links report `all live references resolve`: 51 rows in `docs/index.md`
   (50 l10n manuals plus `../TRADEMARKS.md`) and the 5 manual-validation
   procedures `docs/launch-checklist.md` depends on, all registered as P-29,
   P-30 and P-31 in `docs/PENDIENTES.md`. The scan now resolves Markdown link
   targets against the directory of the document that contains them, ignoring
   schemes, root-relative paths, pure anchors and extensions the repository does
   not ship (`.md`, `.pdf`, `.yml` and `.yaml` are in scope). Because the tree
   carries those reviewed dangling links today, the rule lands as a ratchet
   rather than as zero tolerance — the shape of `check:no-spanish` and
   `check-docs-markdown` (ADR-028): `scripts/documented-doc-references-baseline.json`
   freezes the current set, each entry with the reason it is tolerated, and the
   gate fails on a dangling link that is not in the baseline, on a baselined
   entry that resolves again (the debt was paid, so the entry must go), on an
   entry without a reason, on a missing baseline, and on a scope fingerprint
   mismatch so that a narrowed scan fails closed. `--update` rewrites the set
   with empty reasons on purpose, so a regenerated baseline keeps failing until
   a reviewer states why each tolerated link is allowed; regenerating a baseline
   is a deliberate, reviewed act, which is why this gate is not a step of
   `gate-refresh.mjs`. The gate is in `npm run check:content`, so the full
   `npm run check` (and therefore CI) now turns red on the first bare or
   parent-relative link that does not resolve.

## Consequences

- Deleting or renaming a file used by a runbook fails locally
  before reaching review.
- Retiring an HTTP route requires updating the live instructions at the same
  time as the router.
- Historical audits can keep describing retired incidents and endpoints
  without misrepresenting the current operational state.
- A dangling link is now either a blocker or an entry with a stated reason in
  the baseline; the third state — passing with no explanation at all — is gone.

- The detector is deliberately syntactic: it does not prove that an endpoint accepts
  every method nor that an external URL is reachable. Those properties
  remain covered by the server, OpenAPI, smoke and deploy contracts.
