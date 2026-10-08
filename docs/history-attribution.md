# Content attribution in history

> Decision record (2026-08-31). It was decided **not to rewrite history** to separate
> content from the first audit round that got absorbed in the commits of the
> second round. This document records the real attribution to not lose context.

## Context

During the second audit round, changes were committed with `git commit --only`
on files that **the previous session had also edited** (first round). Since hunks
were not separated, part of the first round content got absorbed in the second
round commits. The intersection with the `00b24d6` baseline was empty.

The content exists and works and is verified green; the mix is **attributable**,
not functional.

## Previous content (round 1) absorbed in round 2 commits

| Commit (round 2) | Shared file | Previous content absorbed |
|---|---|---|
| `572c910` (SHA pins) | `sast.yml` | Entire file (94 lines, created by round 1) |
| | `staging-deploy.yml`, `staging-rollback.yml` | 68 + 102 lines (staging files created by round 1) |
| | `ci.yml`, `dast-nightly.yml`, `staging-smoke.yml` | ~160 previous lines vs ~26 pins |
| | `validate-workflows.mjs`, `validate-gates.test.mjs` | ~86 previous lines vs ~19 of the gate |
| `9dd011b` (E2E) | `nightly.yml` | ~52 previous lines vs ~6 (pins + load-test) |
| `62afb96` (analytics) | `.env.example`, `package.json`, `AnalyticsService.ts` | ~52 previous lines vs ~23 |
| `a0f1525` (docs) | `audit.md`, `ROPA.md`, `launch-checklist.md` | ~450 previous lines vs ~81 |

## Consequence

The `00b24d6` baseline (first round, 312 files) remained **incomplete**: it lacks ~500+
lines of gates and documentation from the first round, attributed today to the second
round commits. Functionally there is no loss; for history audit purposes, the
authorship of previous content must be understood as part of the first round.

## Reason for the decision

- Destructive history rewrite that touches `00b24d6` (committed by another process).
- Work of rounds 3/4 without committing in the tree at decision time.
- The functional state is correct; the cost of surgery exceeded the attribution benefit.
