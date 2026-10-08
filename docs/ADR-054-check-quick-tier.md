# ADR-054: `check:quick` pre-commit quick tier and its integration into the official chain

- **Status:** accepted (additive tier implemented and documented; integration
  into the `npm run check` chain is **rejected** for now — see Decision 4)
- **Date:** 2026-09-17

## Context

The `npm run check` chain runs 40 gates in series and takes ~62 s in this
checkout (2026-09-17 measurement: `lint` 21.0 s + `check:no-unbounded-text`
13.4 s = 55% of the total; the other 38 gates average ~0.6 s). That cadence is
right for CI and for pre-push, but it is too slow for the save-edit loop,
where the real question is "what will CI reject?" and not "is the
whole repo green?".

Also, the chain's order does not prioritize the historically most
frequent failures: a `check:boundaries` failure (a new import edge
between layers) is among the most common and today is discovered in position 8 of the
chain, after gates that fail far less often.

The freeze inspector (O-1, `scripts/check-inspector-freeze.mjs`,
`docs/ADR-028-gate-drift-detection.md`) freezes inspector growth
in the chain: every new gate must be registered in `KNOWN_GATES` or
justified by an ADR naming it. Any proposal of a tier, reordering
or consolidation therefore needs its own recorded decision. This ADR is
that decision.

## Decision

1. **What the tier is.** `node scripts/check-quick.mjs` (npm script
   `check:quick`, ~2.5 s measured) runs 8 sub-second freeze gates in
   most-likely-to-fail order: `check:boundaries`, `check:env`,
   `check:open-core`, `check:pro-imports`, `check:compose-config`,
   `check:runtime-config`, `check:license-keys` and
   `check:server-log-ip-privacy`. It prints a duration table per gate and is
   fail-fast: the first red gate stops the tier and shows its
   full output, which is the answer the developer was looking for.

2. **Tier contracts** (pinned by
   `scripts/__tests__/check-quick.test.mjs`):
   - **Additive:** it is not part of the `npm run check` chain, so the
     freeze does not see it and it requires no `KNOWN_GATES` registration nor naming ADR.
   - **Read-only selector:** each entry re-runs a gate already
     registered in `KNOWN_GATES` (`security` or `meta` category); the tier does not
     re-implement any validation. The test verifies the registration and that each entry's
     script exists on disk, so a rename in
     either place breaks the test and not the tier at runtime.
   - **Sub-second only:** gates costing >1 s (the two network CVEs, `check:audit-drift`,
     `lint`, `check:no-unbounded-text`) are left out; the test explicitly excludes the known
     slow ones and pins the tier's entry cap.
   - **Never replaces `npm run check`:** it is a fast signal, not the gate. Full
     verification before pushing remains mandatory
     (CONTRIBUTING.md §6).

3. **Reordering the official chain: no.** The current order is already
   reasonably fail-fast and any reordering would change the freeze contract
   (`KNOWN_GATES` is kept ordered and stable) and the CI one without a
   demonstrated need. The two real bottlenecks (`lint` 21 s,
   `check:no-unbounded-text` 13.4 s) are optimized by design (lint
   scoped by domains, bounded corpus) and not by position in the chain.

4. **Integration into the chain: rejected for now.** Adding `check:quick` to
   `npm run check` would duplicate the execution of its 8 gates (the chain
   already runs them), adding ~2.5 s with no gain whatsoever, and would force registering the
   gate in the freeze as `meta`. The tier's value lies precisely outside
   the chain. If the chain ever gains a profile mechanism
   (e.g. a flag that runs only the tier), this decision will be revisited; until
   then, `check:quick` stays additive.

5. **Gate consolidation: none, and none needed.** The two CVE gates
   measure different things (`overrides` block pins vs declared tree) and already
   share a single `npm audit --json` fetch
   (`scripts/npm-audit-payload.mjs`). The merging of the old Markdown
   inspectors into `check:docs-markdown` already happened (ADR-040). No known
   overlap between gates remains.

## Consequences

- The save-edit loop answers in <3 s; full verification remains
  `npm run check` before pushing, documented in CONTRIBUTING.md §6.
- Maintaining the sub-second contract is an ongoing duty: a tier gate
  that grows beyond ~1 s must leave it (the test watches this with the
  entry cap and the exclusion list).
- Reordering the tier is a history-guided decision: whoever suffers a
  failure must move the most frequent gate to the front and say so in the PR
  (the script-header contract).
- If it is ever integrated into the chain, `check:quick` must be registered in
  `KNOWN_GATES` (`meta` category) and accept the double cost of its gates, or
  implement the profile mechanism that avoids the duplication first.
- The tier introduces no new dependencies: only Node core and the scripts of
  already existing gates.
