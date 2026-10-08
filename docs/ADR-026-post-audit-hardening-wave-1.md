# ADR-026: Post-audit hardening — wave 1

- **Status:** accepted (implemented; this record formalizes the existing decision)
- **Date:** 2026-09-02 (retro-documented from the code and `docs/audit.md`)

## Context

The full security audit (`docs/audit.md`) produced a set of
critical- and high-severity findings about the synchronization surface,
storage and conflict resolution. The remediation was organized in two
waves (`scripts/audit-anchors.mjs` — "ADR-026 wave 1, ADR-027 wave 2"), each with
adversarial regression tests anchored by the `check:audit-drift` gate.

## Decision

1. **Sync firewall and restricted access lists.**
   - ICE server allowlist: STUN/TURN endpoints are restricted to an
     allowlist — defense against hostile endpoints acting as a relay
     (anchor `p0-ice-whitelist`).
   - Private records are never replicated to a peer: the privacy
     filter runs before the transfer (anchor `p1-private-sync`).
   - The unlock surface does not reveal whether a vault exists when
     private fencing is active (anchor `p3-verify-password-private`).
2. **Production guard for SecureStorage.** Production builds
   refuse to mount an unencrypted `SecureStorage` — fail-closed at the
   encryption-at-rest layer (anchor `p2-secure-storage-prod-guard`).
3. **Device key serialization.** Cryptographic generation of the
   device key is serialized across tabs to avoid races that would
   produce divergent keys (anchor `secure-storage-device-key-lock`,
   ADR-026 D2).
4. **Numeric revision comparator for LWW.** RxDB's last-writer-wins conflict
   resolution compares numeric revision heights
   (`src/utils/syncVersion.ts`) instead of lexicographic order, which broke with `9 > 10`
   (anchors `sync-version-comparator` + `sync-version-comparator-source`,
   ADR-026 D8). The source file is anchored in addition to the test: a refactor cannot
   remove the comparator silently.
5. **Anchored security-critical sources.** `src/services/SecureStorage.ts` and
   `src/services/WebRTCSyncService.ts` are anchored as sources (not just their
   tests): their silent disappearance would break encryption at rest and
   sync privacy filtering.
6. **Anchors as a contract.** Every remediation carries its regression test under
   `src/tests/security/p<severity>-<slug>.regression.test.ts` and its entry in
   `scripts/audit-anchors-baseline.json`. Adding or removing an anchor is an
   ADR-level change (`AGENTS.md` §3).

## Consequences

- `npm run check:audit-drift` fails if an anchored test or source disappears or is
  renamed out of its expected location; the gate is part of the
  `npm run check` chain.
- The ICE allowlist and the sync firewall are structural configuration, not
  optional: relaxing them requires an ADR and a security review.
- Wave 2 of this hardening (signaling server limits) is
  recorded in `docs/ADR-027-post-audit-hardening-wave-2.md`; the later
  WebRTC/DR work came to light in ADR-029+ (referenced in the anchor
  catalog).
