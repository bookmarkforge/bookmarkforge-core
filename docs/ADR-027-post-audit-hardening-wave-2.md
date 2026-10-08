# ADR-027: Post-audit hardening — wave 2 (signaling server)

- **Status:** accepted (implemented; this record formalizes the existing decision)
- **Date:** 2026-09-02 (retro-documented from the code and `docs/audit.md`)

## Context

Wave 1 of post-audit hardening (`docs/ADR-026-post-audit-hardening-wave-1.md`)
covered the client (WebRTC sync, storage, conflict
resolution). The audit also identified that the self-hosted signaling
server — exposed to the Internet by design, since it coordinates the P2P handshake —
needed resource limits and authentication hardening of its own. The
companion server receives no vault content (see `docs/architecture.md`),
but an attacker can abuse its resources and its join surface.

## Decision

1. **Environment-bounded integers.** All of the server's numeric limits
   (connections, rooms, peers per room, payload sizes, time windows)
   are read from the environment validated as bounded integers — with no unbounded
   defaults nor silent string coercion.
2. **Anti-replay window.** Signed messages of the signaling protocol
   are validated against a time/replay window; messages outside the window
   are rejected (protection against replaying captured handshakes).
3. **Constant-time authentication.** Comparison of admin/token credentials
   (`SIGNALING_ADMIN_TOKEN`) uses constant-time comparison
   so as not to leak length or prefix through timing.
4. **Isolated join rate limit.** The rate limit for room entries uses a
   map isolated per identity, so that an abusive client cannot exhaust
   the global rate-limit budget nor cause key collisions with
   other clients (anchor `signaling-server-bounded-resources`).
5. **Regression anchor.** The complete set is anchored in
   `src/tests/sync/signaling-server.test.*` via `scripts/audit-anchors.mjs`
   (ADR-027 / wave 2): removing or renaming the test fails the
   `check:audit-drift` gate.

## Consequences

- The signaling server is fail-closed: without explicit limits configuration,
  the defaults are restrictive, not permissive.
- Limits are operable via the environment without a code redeploy; changes to
  structural defaults require an ADR.
- The night operator's webhook/secret policy (P92/H5) and the WoW duration
  budget (ADR-019) live in `docs/ops-nightly.md` and
  `docs/audit.md` — this ADR covers only the signaling surface.
