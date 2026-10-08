# Human-like execution report on Chromium, Firefox and WebKit

- **Date:** 2026-09-24
- **Status:** **INCOMPLETE — execution interrupted; does not constitute a green or red gate**
- **Script:** `npm run e2e:human-like:browsers`
- **Configuration:** `playwright.human-like.browsers.config.ts`
- **Declared scope:** 161 files, 2030 tests per engine, 6090 tests total
- **Observed profile:** Playwright, 1 worker, no sharding

## Executive Summary

The new cross-engine script was invoked to run the complete human-like suite on Chromium, Firefox and WebKit. The tool does not support background processes and both executions were manually interrupted before Playwright emitted a final summary. No complete JSON report was generated.

Therefore, this document preserves the available evidence without converting a partial execution into a false result. The assertion debt measured in the state of this execution was **1549 of 2030 empty tests (76.3%)**; the subsequent payment of `tooltip-help-tests.spec.ts` and the current baseline are recorded in [PENDIENTES.md](PENDIENTES.md). The separation between this UI certification and the actual WebRTC certification is governed by [ADR-065](ADR-065-webrtc-playwright-webkit-limitations.md).

## Results Matrix

| Engine | Expected tests | Observed progress | Status | Evidence / interpretation |
|---|---:|---:|---|---|
| Chromium | 2030 | Independent attempts up to 1116/2030 and 26/2030 | INTERRUPTED / INCOMPLETE | The first attempt showed at least three visible failures before continuing: `should handle keyboard navigation`, `should handle landmark regions` and `should handle touch targets`. The visible output was truncated, so the list is not exhaustive. |
| Firefox | 2030 | 0 | NOT STARTED | Playwright orders projects after Chromium; the interruption prevented reaching Firefox. |
| WebKit | 2030 | 0 | NOT STARTED | Playwright orders projects after Chromium; the interruption prevented reaching WebKit. |
| **Total** | **6090** | **Not summable between restarts** | **INCOMPLETE** | No final summary or complete JSON artifact exists; total passed/failed/skipped are not declared. |

The two progress numbers come from independent restarts and should not be summed as unique cases.

## Evidencia de ejecución

### Attempt 1 — terminal reporter

Command:

```bash
npm run e2e:human-like:browsers
```

Playwright announced `Running 6090 tests using 1 worker`. The process reached at least case 1116 of Chromium and ended when interrupted and killed, without final summary.

Visible failures before interruption:

| Project | Spec | Test |
|---|---|---|
| Chromium | `advanced-accessibility-tests.spec.ts` | `should handle keyboard navigation` |
| Chromium | `advanced-accessibility-tests.spec.ts` | `should handle landmark regions` |
| Chromium | `advanced-accessibility-tests.spec.ts` | `should handle touch targets` |

The available terminal capture is truncated; this table only preserves the failures that could be verified and does not claim they were the only ones.

### Attempt 2 — persisted JSON reporter

Command:

```bash
PLAYWRIGHT_JSON_OUTPUT_NAME="test-results/human-like-browsers-full.json" \
  npm run e2e:human-like:browsers -- --reporter=json
```

Playwright announced `Running 6090 tests using 1 worker` and started Chromium. The execution was also interrupted around case 26. Since it did not finish, `test-results/human-like-browsers-full.json` was not created and there is no parseable JSON from which to obtain counts or durations per engine.

## Focused execution of human actions and flows

- **Date:** 2026-09-25
- **Specs:** `advanced-human-actions-tests.spec.ts` and `additional-human-flows-tests.spec.ts`
- **Tests per engine:** 6 (3 per spec)
- **Total cross-engine:** 18
- **Code corrections:** none; the specs were already executable contracts and passed without changes

Reproducible command per engine:

```bash
npm run e2e:human-like:browsers -- \
  src/tests/human-like/examples/advanced-human-actions-tests.spec.ts \
  src/tests/human-like/examples/additional-human-flows-tests.spec.ts \
  --project=<chromium|firefox|webkit>
```

| Engine | Passed | Failed | Skipped | Approximate duration | Status |
|---|---:|---:|---:|---:|---|
| Chromium | 6 | 0 | 0 | 1.4 min | GREEN |
| Firefox | 6 | 0 | 0 | 1.4 min | GREEN |
| WebKit | 6 | 0 | 0 | 2.6 min | GREEN |
| **Total** | **18** | **0** | **0** | **5.4 min** | **GREEN** |

Detail per spec:

| Spec | Chromium | Firefox | WebKit |
|---|---:|---:|---:|
| `advanced-human-actions-tests.spec.ts` (tests 11–13) | 3/3 | 3/3 | 3/3 |
| `additional-human-flows-tests.spec.ts` (tests 15–17) | 3/3 | 3/3 | 3/3 |

This matrix certifies only the human actions and flows listed in the two executed routes. It does not replace the complete human-like suite nor certify WebRTC; for that contractual limit see [ADR-065](ADR-065-webrtc-playwright-webkit-limitations.md).

## Debt audit in execution state

| Metric | Current value |
|---|---:|
| Human-like files | 161 |
| Human-like tests per engine | 2030 |
| Empty tests per engine | 1549 |
| Empty proportion | 76.3% |
| Completely empty files | 116 |
| Pending `advanced-*` files | 89 |
| Empty tests declared in baseline | 1549 |

This table is historical and reflects the state before the payment of `tooltip-help-tests.spec.ts`. The current figure is obtained from the ratchet and current sources of truth:

- [`scripts/vacuous-tests-baseline.json`](../scripts/vacuous-tests-baseline.json): detailed baseline.
- [PENDIENTES.md](PENDIENTES.md): debt audit and payments made.
- [ops-nightly.md](ops-nightly.md): suite sizing and baseline contract.

Local payments already reflected in the current measure include Alerts, Canvas/Graph, Search, Content Metadata, Accordions and Animations. This report does not modify that audit or the baseline.

## Criteria to replace this report with a conclusive matrix

A complete execution must meet all of the following:

1. Finish without interruption and produce exit code `0` or a final Playwright summary.
2. Cover the 2030 tests of Chromium, Firefox and WebKit: 6090 cases in total.
3. Persist a JSON or HTML report that allows verifying counts, failures and durations per project.
4. Record commit, operating system, Node and Playwright versions, start date/time and total duration.
5. Keep the execution result separate from static debt: an empty test can pass and a suite can be green without testing the announced behavior.

Until that evidence is available, the correct status is **INCOMPLETE**.
