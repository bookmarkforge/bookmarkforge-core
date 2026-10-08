# ADR-065: Playwright's WebKit does not certify real WebRTC

- **Status:** Accepted
- **Date:** 2026-09-25
- **Related:** [ADR-029 — WebRTC sync hardening](ADR-029-webrtc-sync-hardening.md), [ADR-057 — Documented reference integrity](ADR-057-documented-reference-integrity-gate.md), [ADR-062 — Landings smoke gate](ADR-062-landing-smoke-gate.md)

## Context

BookmarkForge uses WebRTC to transport data between devices and WebSocket
only for signaling. TURN is optional and uses ephemeral credentials.
Certifying that capability requires more than loading the app: it requires two
real peers, signaling, ICE candidates, a deterministic network
path, opening a data channel, encrypted transfer and observable behavior
under failure.

The `npm run e2e:human-like:browsers` script runs the same human-like suite on
Playwright's Chromium, Firefox and WebKit projects. That is useful for detecting
rendering, DOM, accessibility, navigation and storage differences across
the three engines. It does not turn Playwright's bundled WebKit into Safari
on macOS or iOS, nor into a production environment with real network, permissions and peers.

The limitation is especially important for WebRTC: the WebKit project
finishing green, `RTCPeerConnection` being available, or the UI degrading
correctly when support is missing does not prove two browsers can
connect. A test that cannot establish a real connection must be marked as
blocked or not run; it must never turn the absence of transport into a
PASS.

## Decision

1. **Separate the two certifications.** The `e2e:human-like:browsers` matrix certifies
   UI contracts and application behavior on Playwright's Chromium, Firefox and WebKit.
   It does not certify WebRTC, ICE, TURN, DataChannel, signaling nor
   cross-process P2P synchronization.

2. **Playwright's WebKit is explicitly outside WebRTC certification.**
   Its result will be labeled `UI cross-engine / WebKit automation`, never
   as `WebRTC certified`. The limitation is a property of the automation environment, not
   a claim that real Safari does not support the functionality.

3. **WebRTC evidence must be real and traceable.** Transport
   certification requires an environment with two real peers and the signaling
   server controlled by the test. The reference automated contract
   is `npm run e2e:sync`, which runs
   `tests/e2e/vault-sync-real.spec.ts` and
   `tests/e2e/vault-sync-signaling.spec.ts` on Chromium. Unit tests
   with mocks remain valid for the state machine, the SDP format and
   security invariants, but they do not replace a network connection.

4. **Safari/iOS requires manual or real-device certification.** The real iPhone check and the desktop ↔ iPhone P2P session described
   in [ios-manual-test-script.md](ios-manual-test-script.md) and
   [p2p-sync-manual-test-script.md](p2p-sync-manual-test-script.md) are the proper
   way to cover the production browser. A Playwright WebKit result
   is not added to that matrix as a substitute.

5. **A block is an honest result.** If the environment cannot establish
   WebRTC, the report must record `unsupported`, `blocked` or `not run` with the
   reason and the evidence. Those states must not be turned into `passed`, asserts
   must not be removed to achieve a false green, and WebRTC certification must not be
   declared release-ready based only on the human-like suite.

## Cross-browser certification scope

| Surface | Chromium | Firefox | Playwright WebKit | Real Safari/iOS |
|---|---|---|---|---|
| UI, navigation, DOM and automated accessibility | Yes | Yes | Yes | Complementary/manual |
| Local vault, IndexedDB and application behavior | Yes | Yes | Yes, subject to the environment | Complementary/manual |
| WebSocket signaling | Dedicated test | Dedicated test where applicable | Not inferred from human-like | Real session |
| WebRTC, ICE, TURN and DataChannel | `e2e:sync` | Requires a dedicated suite/evidence | Not certified by this ADR | Manual/real device |
| Sync encryption, integrity and recovery | Service tests + real E2E | Service tests + real E2E | Not certified by this ADR | Manual/real device |

A "Yes" row certifies only the contract stated in that cell. The table
does not constitute full browser certification nor a guarantee that
all Pro capabilities work on every engine.

## Consequences

- The cross-engine result can remain a green gate for the
  UI experience without claiming WebKit has working WebRTC support.
- WebRTC failures observed on WebKit must be investigated against real Safari
  before being attributed to a product defect.
- Release documentation must always separate `UI automation green` from
  `WebRTC transport certified`.
- Evolution of Playwright WebKit, of the operating system or of the network harness
  does not change this ADR automatically. To lift the restriction you must
  supply the evidence of two peers, signaling, ICE/TURN, encrypted
  transfer and failure recovery in the environment you want to certify.
- WebRTC certification remains a separate requirement from the human-like assertion
  gate and from the empty-debt ratchet.

## Criteria for lifting the limitation

The limitation can only be withdrawn through a later ADR or an explicit
amendment when there is a reproducible run demonstrating, at minimum:

1. two real WebKit peers on a supported network;
2. complete signaling and room-secret validation;
3. ICE/TURN connection and DataChannel opening;
4. transfer of an encrypted payload with a valid checksum;
5. close, timeout, rejection and reconnection without silent loss; and
6. archived evidence with commit, versions, operating system, runner and
   result matrix.

Until then, the correct result for WebKit + WebRTC is **not certified /
real device required**, not "green" nor "Safari failure" by default.
