# ADR-030: Security regression umbrella suite (security tier)

- **Status:** accepted (implemented; this record formalizes the existing decision)
- **Date:** 2026-09-02 (retro-documented from the anchor catalog and `scripts/audit-anchors.mjs`)

## Context

The anchor catalog references an "umbrella" anchor covering the **whole**
`p[0-9]-*.regression.test.ts` family under `src/tests/security/`, rather than a
concrete file: the `security-tier-4-p-regression-suite` anchor ("security
tier 4" in the catalog's terminology). While individual anchors
protect specific tests (p0-ice-whitelist, p1-private-sync,
p2-secure-storage-prod-guard, p3-verify-password-private), the umbrella guarantees
that **no** severity-typed regression test can disappear from the
canonical directory without the gate detecting it — including severity
levels that do not yet have an anchor of their own.

## Decision

1. **Severity umbrella anchor.** `src/tests/security/p[0-9]-*.regression.test.ts`
   is anchored as a set: if the glob matches no file, the
   `check:audit-drift` gate fails (anchor `security-tier-4-p-regression-suite`). The numeric
   `[0-9]` glob covers any severity p0…p9, so adding a new
   severity does not require touching the anchor.
2. **Discovery (advisory, non-blocking by default).** Any file with
   the canonical shape `src/tests/security/p[0-9]+-*.regression.test.{ts,tsx,mjs}`
   that is **not** in the catalog is reported as `NEW … discovered — not yet
   anchored` (and as `discovered` in `--json`). The message is informative: promoting a
   discovered file to an anchor is an ADR-level change, not a
   baseline action. With `--strict-discovery` (alias `--strict`), any
   discovery becomes a hard failure.
3. **Promotion to anchor = ADR-level change.** Adding or removing an individual entry from
   `ANCHORS[]` requires updating `scripts/audit-anchors-baseline.json` (the gate
   detects *catalog inflation* if an anchor exists in the catalog but not in the
   baseline, or with a different glob/kind) and, by `AGENTS.md` §3 contract, is an
   ADR-anchored change.

## Consequences

- The security regression suite can never shrink to zero files through
  overzealous cleanup or a mistaken rename — the umbrella detects it even when the
  concrete file has no individual anchor.
- New security tests without an anchor appear in the gate logs
  (`check:audit-drift`) as discovered; ignoring them is viable short term
  but leaves a visible signal in CI, and `--strict-discovery` elevates that debt to a
  failure.
- The "tier 4" level in the catalog is a label for the umbrella suite; levels
  1–3 correspond to the individual anchors by high/medium severity
  (p0–p3) inherited from ADR-026/027 and formalized in their ADRs.