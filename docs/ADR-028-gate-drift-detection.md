# ADR-028: Gate-drift-detection — verifiability of the documentation inspectors

- **Status:** accepted (implemented; this record formalizes the existing decision)
- **Date:** 2026-09-02 (retro-documented from `scripts/check-inspector-freeze.mjs`)

## Context

The project governs its gates through an "inspector freeze" (O-1) in
`scripts/check-inspector-freeze.mjs`: documentation-format inspectors — a
`check:*` gate whose only job is validating the shape,
format, volume or hygiene of docs — cannot grow freely. Adding a new one
requires an ADR that (a) names the concrete failure it prevents and (b) demonstrates
that it is catchable by the **gate-drift-detection** negative job. A gate whose
rules can disappear or degrade without anyone noticing is not a gate: it is
a statement of intent. The ADR-028 decision sets the mechanism that makes
that catchability requirement verifiable.

## Decision

1. **Gate-drift-detection as an admission contract.** Every new documentation inspector
   in the `npm run check` chain must demonstrate that its failure is
   caught by a verifiable negative path: if the gate is weakened, removed
   or its baseline is inflated, a drift-detection test detects it. The
   freeze's requirement (b) — "catchable by the negative-path
   gate-drift-detection job (ADR-028)" — rests on this decision.
2. **The gate's ADR must name the concrete gate.** To be accepted by the
   freeze, the ADR must contain `check:<name>` textually in its body
   (`adrNamesGate`), so the justification is mechanizable and auditable:
   the freeze itself validates that the ADR names the gate before admitting it.
3. **Protected core exempt.** Security (`security`) and
   language (`language`) inspectors are the protected core and can grow without this ADR
   gate; the `meta` category (build/chunks/lint…) does not require it either. Drift
   detection applies to the documentation category (and to any
   new gate of unknown category, which is treated as `docs` by default).

## Consequences

- A PR adding a documentation gate without an ADR naming and justifying it
  fails `check:inspector-freeze` with a message pointing exactly at this
  ADR's (a) and (b).
- The existence of a per-gate baseline (a common pattern in the repo:
  `check:audit-drift`, `check:no-unbounded-text`, `check:tailwind-drift`, …)
  materializes the "negative path": the baseline is the drift anchor that
  gate-drift-detection watches.
- This ADR is not in the regression anchor catalog
  (`scripts/audit-anchors.mjs` — the catalog covers hardening ADR-026/027/029+);
  ADR-028 is gate governance and is referenced only in prose
  from `check-inspector-freeze.mjs`. Its number is now formalized in the
  registry, closing the gap between ADR-027 (wave 2) and ADR-029.