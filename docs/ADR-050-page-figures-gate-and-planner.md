# ADR-050: Figures on public pages and the update planner

- **Status:** accepted (implemented: `scripts/check-page-figures.mjs`,
  `scripts/plan-manual-figures-update.mjs` with their suites in
  `scripts/__tests__/`, step "Enforce page figure claims" in `ci.yml`)
- **Date:** 2026-09-16

## Context

ADR-049 hardened the 30 manuals. In the same round, restoring the
legal pages generator (`generate-privacy-pages.mjs`) gave them — to the
24 localized pages — the full pricing and SLA skeleton, and the pages probe showed that
**no gate covered those surfaces**:
`check-claim-drift` only scans root `public/*.html` (the legal pages live
in `public/<locale>/privacy-and-terms.html`), and `check:manual-figures` only
reads `docs/`. The generated landings and `pocket-alternative.html` — which also
state prices and limits — were left in the same hole.

Also, changing a truth constant forces updating dozens of
lines spread across 67 files; the developer discovers *which* lines
are breaking the gate iteration by iteration. That discovery belongs to the
planner, not to the CI error.

## Decision

1. **Reuse, do not duplicate.** `check-page-figures` imports the truth and the
   evaluator from `check-manual-figures` (`loadTruth`, `allowedValueSets`,
   `evaluateManual`). Every new rule the manuals gate wins travels
   free to the pages; there is no second copy of the regexes to maintain.
2. **Adapt the surface, not the rules.** Pages are HTML: the gate
   strips tags per line (the failure line numbers are those of the
   raw file), compacts inline JSON-LD into a synthetic line (its
   `u0026` escapes fabricated numbers) and neutralizes the competitor's spoken prices
   per `patch-landing-copy.mjs`'s documented convention
   ("28 dollars", without `$`; our prices always carry `$`).
3. **61-surface contract.** The 30 localized legal pages (EN at the root)
   + 30 landings + pocket. A missing page is reported as an error — coverage never
   shrinks silently.
4. **Planner via differential evaluation.** The plan does not reprint regexes: it runs
   the shared evaluator with a sentinel value per constant and lists the
   lines that *stop passing* (green in the current tree). A red baseline
   aborts planning; a constant whose removed value is still
   canonical by another route (e.g. `proPrice` 79→70 with `proRegularPrice` 79)
   produces an explicit warning instead of a misleading "0 lines".
5. **Registration in the freeze (O-1).** `check:page-figures` and
   `plan:manual-figures` are registered in `KNOWN_GATES` as `docs`; this ADR
   is the justification the freeze requires.
6. **Wiring.** `check:page-figures` in the `npm run check` chain and its own
   step in `ci.yml`; `plan:manual-figures` as a developer tool
   (`node scripts/plan-manual-figures-update.mjs --set KEY=VALUE [--pages]
   [--json]`). Both gates only read sources included in the public export,
   so the exported repo runs the identical validation.

## Consequences

- Public pages can no longer state a figure the code does not
  back: price drift in the 24 localized legal pages that nobody would see today breaks CI.
- A constant change produces, with a single command, the exact list of
  manual lines (and page lines, with `--pages`) to update — multi-surface coordination is
  no longer manual.
- The "competitor prices without `$`" convention is now an invariant with a
  test: writing it with `$` on a landing breaks the gate.
- Maintenance: the per-language units live in a single place
  (`check-manual-figures.mjs`); the two new suites add 27 cases to the
  bounded profile (~1s).
