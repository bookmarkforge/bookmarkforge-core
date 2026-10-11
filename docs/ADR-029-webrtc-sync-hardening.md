# ADR-029: WebRTC sync hardening (post-wave 2)

- **Status:** accepted (implemented; this record formalizes the existing decisions)
- **Date:** 2026-09-02 (retro-documented from the code, the anchor catalog and the private `audit.md`)

## Context

Post-audit hardening was organized in waves 1 and 2 (`docs/ADR-026-post-audit-hardening-wave-1.md`,
`docs/ADR-027-post-audit-hardening-wave-2.md`). After those waves, the WebRTC/DR
follow-ups came to light under **ADR-029+**: a set of point-to-point
synchronization decisions that harden the WebRTC service at the surface
(transfer sessions, SDP shape, checksum comparisons) and pin
the deterministic conflict-resolution dependency of the DB core.
The anchor catalog (`scripts/audit-anchors.mjs`) references decisions
D1, D2, D5 and D6; the `check:extension-csp` gate describes itself as an
ADR-029 follow-up.

## Decision

1. **D1 — Watchdog for stuck transfers.** `WebRTCSyncService` maintains a
   transfer watchdog (`SYNC_TRANSFER_TIMEOUT_MS = 30_000`): if a peer
   sends `sync_start` and then goes silent, the incoming transfer is
   cancelled and the session state it had reserved is released. The timer
   is only refreshed after accepted chunks and is cleared when
   verification/persistence begins — a slow peer cannot reserve the receiver
   forever (anchor `p4-sync-transfer-watchdog`).
2. **D2 — SDP shape gate before the browser handoff.** Before
   handing a session description to the `RTCPeerConnection`, the service
   rejects malformed, oversized and unsupported-role SDP:
   - Encoded descriptions > 64 KiB are rejected before decompressing
     (`decodeDescription` returns `null`).
   - Unsupported types (`pranswer`), NUL bytes and malformed JSON are
     rejected (`isValidSessionDescription` validator in `webrtc-sync/validation`).
   - `minimizeSDP` filters `srflx`/`relay` candidates (`host` only), excludes
     irrelevant lines and preserves the data-channel session metadata the
     browser's parser needs (anchor `p5-sdp-shape-gate`).
3. **D5 — Constant-time comparison of checksums/HMAC.** The client uses
   constant-time comparison (`constantTimeStringEqual` in
   `webrtc-sync/compare`, mirroring the server-side comparison) both for
   session checksums and for payload authentication keys; the
   adversarial coverage is anchored in `WebRTCSyncService.test.ts` (64-char
   input, one-char mismatch, differing lengths) (anchor `p4-constant-time-cmp`).
4. **D6 — Deterministic conflict resolution as an anchored source.**
   `src/db/database.core.ts` is anchored as a *source* (not as a test): deterministic
   LWW resolution via `compareRxRevision` cannot silently
   disappear in a refactor (anchor `database-core-source`). It complements
   ADR-026 D8 (`sync-version-comparator`).
5. **Security-critical source.** `src/services/WebRTCSyncService.ts` is
   anchored as a source (anchor `webrtc-sync-source`): filtering of private
   records and authenticated, bounded sync cannot be removed without the
   `check:audit-drift` gate failing.
6. **Follow-up — Extension CSP.** The `check:extension-csp` gate enforces a
   single canonical, verbatim CSP in the extension manifests (Chrome MV3 +
   Firefox MV2): `script-src 'self'; object-src 'none'; connect-src 'self';
   frame-src 'none'; base-uri 'none'; form-action 'none'; style-src 'self'`. It is
   deliberately stricter than the app's (the extension does no fetch/XHR of
   its own), hardened after the extension surface audit.

## Consequences

- WebRTC sync is fail-closed on all three surfaces: sessions, SDP shape
  and integrity comparisons. Relaxing any of them is an ADR-level change
  (the `check:audit-drift` gate fails if an anchor disappears).
- The minimized SDP only keeps `host` candidates: peers depend on
  direct connectivity or on the STUN/TURN whitelisted by ADR-026/027; a non-whitelisted relay
  cannot sneak in via `srflx`/`relay` embedded in the SDP.
- The registry of these anchors (3 of them on the same
  `WebRTCSyncService.test.ts`, plus 2 sources) is in
  `scripts/audit-anchors-baseline.json`; the numbering is not contiguous (D1, D2,
  D5, D6) because only decisions with a regression anchor enter the catalog
  — the original series' D3/D4 decisions have no anchor and are not formalized
  here.