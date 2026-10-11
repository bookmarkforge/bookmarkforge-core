# ADR-063 — Feature budgets gate

- **Status:** accepted
- **Date:** 2026-09-21
- **Deciders:** BookmarkForge team

## Context

The global bundle budget detects aggregate growth, but it does not identify
which feature introduces the cost. A large new module could stay below the
global limit and still degrade a specific surface such as PDF, the editor,
the database or local AI.

## Decision

`check:feature-budgets` is added to the `npm run check` chain. The gate reads
`scripts/feature-budgets.json`, sums the emitted assets matching each feature
and fails when:

1. a feature exceeds its byte budget;
2. a declared feature disappears from the build;
3. a large unclassified asset appears.

The patterns ignore Vite's hash and are applied over `dist/assets`, so the gate
detects both size regressions and new heavy modules.

## Relation to gate governance

This gate is registered for `check-inspector-freeze`. The need it avoids is
concrete: a feature's growth must not hide behind the global budget. Its
behavior is verifiable by `scripts/__tests__/check-feature-budgets.test.mjs` and
its addition to the chain is protected by `check-inspector-freeze`, following
ADR-028.

## Consequences

- Every new feature must add a pattern or demonstrate that it stays below the
  classification threshold.
- Budgets are release limits, not an order for immediate restructuring.
- Budget updates require reviewing the bundle report and justifying the change
  in documentation.
