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

## Consequences

- Deleting or renaming a file used by a runbook fails locally
  before reaching review.
- Retiring an HTTP route requires updating the live instructions at the same
  time as the router.
- Historical audits can keep describing retired incidents and endpoints
  without misrepresenting the current operational state.
- The detector is deliberately syntactic: it does not prove that an endpoint accepts
  every method nor that an external URL is reachable. Those properties
  remain covered by the server, OpenAPI, smoke and deploy contracts.
