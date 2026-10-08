# ADR-038: Constant-time comparison of HMAC signatures in the attestation chains

- **Status:** accepted (implemented; anchor `p3-constant-time-hmac`)
- **Date:** 2026-09-02

## Context

The 2026-09-02 audit (`docs/audit-report-2026-09-02.md`, finding M-1)
found an internal inconsistency: the codebase has a constant-time
comparison primitive (`constantTimeCompare`,
`src/services/security-vault/compare.ts`) and uses it correctly in
`SecurityVault` (plaintext and share-secret verification) and, on the Node
server side, `timingSafeEqual` protects all signaling secrets. But
the client's two attestation chains compared signed hex with `===` /
`!==`:

1. `MutationGuard.verify` and `MutationGuard.detectTampering`
   (`src/services/security/MutationGuard.ts`).
2. `AttestationChain.verifyChain` — both the signature and the `prevHash`, which
   carries the previous entry's HMAC
   (`src/services/security/AttestationChain.ts`).

A short-circuiting string comparison leaks the matching prefix length
to any attacker able to insert chosen signatures into
storage (localStorage / encrypted SecureStorage) and observe the boolean
result of `verify` / `verifyChain` — the classic string-comparison timing
oracle. The mitigation cost is negligible compared to the cost of
deriving the HMAC key (Argon2id + importKey), and the code already had the
primitive exported: it was pure inconsistency, not a technical limitation.

## Decision

1. **Every comparison of secret digests uses `constantTimeCompare`.** The
   3 comparison points (`MutationGuard.verify`,
   `MutationGuard.detectTampering`, `AttestationChain.verifyChain` — the latter
   including `prevHash` because it carries a secret HMAC) were replaced by the
   shared primitive from `src/services/security-vault/compare.ts`. Nothing
   changes semantically for legitimate inputs: the primitive is fail-closed
   for differing lengths (length XOR included in the accumulator).
2. **Anchored regression:** `src/tests/security/p3-constant-time-hmac.regression.test.ts`
   combines (a) a comment-stripped source scan (same method as
   `p2-secure-storage-prod-guard.regression.test.ts`) that rejects any
   `===`/`!==` over `.signature`/`.prevHash` and requires the explicit
   `constantTimeCompare` call at the 3 points, with (b) a behavioral pin of the
   primitive (equality, inequality in the last byte, length inequality in both
   directions, empties). The `p3-constant-time-hmac` anchor is
   catalogued in `scripts/audit-anchors.mjs` + baseline: deleting the test is an
   ADR-level change and breaks `npm run check:audit-drift`.
3. **Honest fast profile:** `scripts/test-fast.mjs` listed
   `security/MutationGuard.test.ts` (`.ts` extension) when the real file is
   `.tsx`; the `.filter(has)` silently dropped it and its 12 tests never
   ran in `test:fast`. The selector was fixed and
   `AttestationChain.test.tsx`, which was not in the profile, was added.
4. **AGENTS.md without fragile figures:** the mention "bounded Vitest suites
   (62 files)" becomes descriptive — the real count had already drifted (63
   files in the audit run; +1 with the new regression test
   and +2 fixed selectors) and no gate backs it.

## Consequences

- The timing oracles in the client's two attestation chains are
  closed and protected by an anchored regression; the app's comparison
  surface is now uniform (SecurityVault, MutationGuard, AttestationChain,
  Node server).
- `test:fast` genuinely runs the MutationGuard and AttestationChain suites;
  its file count goes up and is no longer documented as a number
  that can drift with nobody noticing.
- Any future comparison of secret material must be added to the regression test's
  scan or get its own anchor; using `===` over a digest again becomes
  a CI failure, not a review opinion.
- Still pending (out of scope here, recorded in the
  audit report): the 24 remaining locales with `syst_perfMismatchDesc` in English
  and the unsalted password verifier in the session cache (M-2).
