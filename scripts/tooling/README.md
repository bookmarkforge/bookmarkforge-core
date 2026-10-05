# Quality Tooling

This folder contains executors and development utilities that are not part of
the application domain or server operation.

## Bounded Lint

`lint-bounded.mjs` runs the same flat ESLint configuration by domain and
sequential batches. It prevents `eslint .` from accumulating the entire
repository graph in a single process and allows working with an explicit
memory budget:

```bash
npm run lint                 # Recommended entry; uses the bounded executor
npm run lint:all             # Monolithic ESLint diagnostics/checking
BMF_LINT_HEAP_MB=2048 npm run lint
BMF_LINT_BATCH_SIZE=80 npm run lint
```

Bounded lint fails on the first batch with errors; it does not convert
errors to warnings or skip files. `lint:all` is preserved as a parity
control and for diagnosing differences between batches and the monolithic
execution.

## Mock Contract Audit

`mock-contract-audit.mjs` compares, for each `vi.mock(spec, factory)` in
`src/tests`, the shape returned by the factory with what the modules that
the test actually imports and uses at value position. Detects mocks that
partially substitute their module and only pass because the branch touching
the absent member is never exercised. `[dir]` findings (modules imported
directly by the test) are the real candidates; the rest is usually noise
from modules reachable only by transitive import.

```bash
node scripts/tooling/mock-contract-audit.mjs
MOCK_AUDIT_VERBOSE=1 node scripts/tooling/mock-contract-audit.mjs
MOCK_AUDIT_STRICT=1 node scripts/tooling/mock-contract-audit.mjs  # exits 1 if [dir] findings exist
```

It is a report, not a gate: it is not wired into `npm run check`.

## Unified Budget Report

`build-budget-report.mjs` generates a unified JSON combining the three
project budget perspectives:

- **Static** (performance-budget): entry static closure, total precache, total bundles, chunks count
- **Chunks** (check-chunk-boundaries): entry, unlock (SecurityManager + SecurityConfirmation), mainApp, precache, ort-wasm
- **Browser** (performance-budget): firstInteractionMs

```bash
node scripts/build-budget-report.mjs           # human table
node scripts/build-budget-report.mjs --json    # JSON to stdout
node scripts/build-budget-report.mjs --write   # writes dist/reports/budget-report.json
npm run build:budget-report                    # alias in package.json
```

The JSON has the shape `{ generated, status, static, chunks, browser }` where
each budget field is `{ budget, actual, unit }`. Status is `pass` if all
actual values ≤ budget, `fail` if any exceed, and `skip` if dist/ does not exist.

## Log Noise in Tests

The bounded runner uses `--silent=passed-only` by default: preserves
Vitest summaries and shows console output from failed tests, but does not
flood CI or the terminal with expected logs for each passing case.

```bash
npm run test:fast                 # bounded output
BMF_TEST_LOGS=full npm run test:fast  # full diagnostics
```

Suppression only affects the Vitest process output; it does not deactivate
the buffer, sinks, telemetry, or logger assertions.


- `scripts/tooling/`: quality utilities, static analysis, and bundling.
- `scripts/testing/`: executors, profiles, and test reports.
- `scripts/security/`: security gates and technical compliance.
- `scripts/operations/`: deployment, staging, drills, and observability.

Migration is done in phases: first stabilize entrypoints and tests; then
internal modules can be moved. Current scripts at the root remain
compatible entrypoints during the transition.
