# ADR-066: P2P sync behind the Pro entitlement seam — Pro transport, Core UI that degrades honestly

- **Status:** accepted
- **Date:** 2026-10-13
- **Related:** ADR-026, ADR-029 (WebRTC sync hardening), ADR-053 F1-E,
  `OPEN-CORE.md`, `src/services/pro-access.ts`

## Context

Device-to-device sync is a Pro feature: the shipped tier list
(`src/constants/pricing.ts`) declares P2P sync across devices as unavailable on
Free. The implementation, however, used to live mostly in **Core**: the direct transfer
(`WebRTCSyncService`), the replication manager (`SyncService`), the signaling
socket and the replication modifiers were only *conditionally used*, not
*excluded*. The Core UI imported them statically, so:

- every Free user downloaded the Pro sync chunk (the gate decided at runtime,
  after the bytes were already in the bundle) — a licensing boundary the
  bundler could not see;
- the public Open Core export could not compile without the transport, so
  `scripts/pro-boundary.mjs` replaced those modules with an inert `.d.ts` +
  `.js` pair... while the Core UI kept importing the pair directly. In that
  tree the P2P controls rendered and then did nothing: no error, no upgrade
  prompt, a dead button whose only consumer was the placeholder's own
  once-per-property warning;
- the Pro modules themselves carried no entitlement check — the transport and
  the replication manager contain none today either — so "this feature is Pro"
  was a fact whichever Core call site remembered to ask for rather than a
  boundary the export, the gates and the published documentation could all read.

The same shape had already been solved for backups, PDF extraction and the Pro
AI engines: Core holds no static reference to a Pro implementation, and every
proprietary surface is reached through `src/services/pro-access.ts` (MIT),
which consults `licenseService.hasProAccess()` before fetching the first byte.
P2P sync was the remaining surface outside that seam, and `OPEN-CORE.md` did
not classify every shipped feature at all: the Pro boundary was documented as a
mechanism, not as a per-feature list.

## Decision

**The P2P sync transport is Pro as a whole, and the Core sync surface reaches
it only through the entitlement seam.**

1. **Transport — excluded from Core.** `scripts/pro-boundary.mjs`
   (`PRO_MODULE_PATHS`) declares the complete transport: `WebRTCSyncService.ts`,
   `SyncService.ts`, `sync/signaling.ts`, `sync/replication.ts`,
   `webrtc-sync/protocol.ts` and `webrtc-sync/validation.ts`. Those paths are
   removed from the public tree and replaced there by the generated
   `.d.ts` + inert `.js` pair, exactly like the other Pro modules.
   `webrtc-sync/compare.ts` deliberately **stays Core**: it is the revision
   comparator the Core folder sync (`FolderSyncService.ts`) imports, and Pro is
   an exact file list, never a directory.
2. **Core UI — no static Pro reference.** `src/components/sync/SyncStatus.tsx`,
   `src/components/sync/P2PSyncModal.tsx`, `src/components/Collaboration.tsx`,
   `src/services/CollaborationService.ts` and `src/container/AppContainer.ts`
   resolve their manager through the seam
   (`loadSyncService()` / `loadWebRTCSyncService()`, with
   `announceProUnavailable()` for the shared "requires Pro" panel) instead of
   importing the transport. The seam rejects with
   `ProUnavailableError` — `no-license` for a Free session (before any Pro byte
   is requested), `load-failed` for a module that is missing, fails to load or
   turns out to be the export's placeholder.
3. **Degradation is a product surface, not an accident.** The Core widget keeps
   reporting the true local-first state (`app_syncInactive`), a Free user gets
   the same "requires Pro" treatment as every other Pro surface, and teardown
   paths that cannot await (`CollaborationService.stop()` releasing a live
   session) use the seam's synchronous facade, which is installed only after a
   successful load — so an Open Core build no-ops the teardown instead of
   calling into a placeholder.
4. **The boundary is machine-readable and published.** `scripts/pro-boundary.mjs`
   is the single source read by the exporter, the placeholder generator,
   `check:open-core` and `check:pro-imports`; `OPEN-CORE.md` carries the
   per-feature Core/Pro table, and `check:open-core` fails if a path declared in
   the policy is not named in that table. The regression anchors (below) keep
   the seam's degradation contract tested from the Core side.
5. **Anchors.** `scripts/audit-anchors.mjs` anchors the two Core-side contracts
   this decision creates: the sync widget's seam-driven states
   (`src/tests/components/sync/SyncStatus.test.tsx`) and the collaboration
   service's seam-driven start/stop (`src/tests/services/CollaborationService.test.ts`).
   Removing or renaming either is an ADR-level change, enforced by
   `check:audit-drift`.

## Consequences

- **A Free user (and any Open Core build) downloads no Pro sync byte.** The
  request itself is behind the gate, so the boundary is visible to the
  bundler instead of being decided after the fact.
- **The public export compiles and behaves.** The transport is absent by
  policy, the placeholder pair keeps `tsc` clean, and the seam turns the
  placeholder into an honest `load-failed` rejection rather than a silent
  success — the failure class this decision exists to prevent.
- **The Core sync UI is now asynchronous at its edges.** Components resolve
  their manager on mount and on restart, so their tests mock the seam (a
  resolved service, or the typed rejection) rather than a module import. That
  is the same shape the backup and AI surfaces already have.
- **Cost: the Pro-subject E2E specs ship but cannot pass in the export.**
  `tests/e2e/vault-sync-signaling.spec.ts`, `tests/e2e/vault-sync-real.spec.ts`,
  `tests/e2e/p2p-lan-warning.spec.ts` and
  `tests/e2e/webrtc-handshake-diagnostics.spec.ts` drive the real transport, i.e.
  the placeholder pair in an exported tree. This ADR adds one spec to a
  pre-existing class (the transport was already Pro); a public-side exemption
  for Pro-subject specs is the tracked follow-up, and the private tree keeps
  running them.
- **Cost: the published table is a maintenance contract.** Adding a Pro module
  now means editing the policy list and the classification table together, or
  `check:open-core` fails. That is deliberate: the published document can no
  longer drift from the enforced boundary.
- **Cost: the seam is the only tolerated path.** `check:pro-imports` reports
  zero tolerated static references, so a future "quick import" of the transport
  in a Core component fails the chain instead of eroding the boundary.

## Rejected alternatives

- **Keep the transport in Core and gate it in the UI.** The bytes would ship to
  every Free user and the public export would still need the implementation
  present; the license boundary would remain unenforceable at distribution time.
- **Delete the sync UI from the public export.** The Free product would lose the
  surface that explains the Pro value (and the upsell path with it), and Core
  would have to diverge per distribution instead of degrading from one codebase.
- **Let the export's inert placeholder stand in for a working sync.** A control
  that renders `connected` over a placeholder is the silent false-success class
  the seam already refuses for backups and the AI engines; the widget must
  report the truth instead.
- **Leave `OPEN-CORE.md` without a per-feature table.** The document would
  describe the boundary as a mechanism only, and a shipped feature could be
  classified in no document at all — the drift `check:open-core` now blocks.
