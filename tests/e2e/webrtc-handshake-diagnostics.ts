import type { Page } from "@playwright/test";

/**
 * Shared e2e helper for per-browser WebRTC handshake diagnostics.
 *
 * `captureHandshakeEvidence` reads the WebRTCSyncService internals from the
 * app page and snapshots the SDP descriptions, ICE candidate lists and the
 * peer-connection / data-channel states. `classifyHandshake` turns that raw
 * evidence into a deterministic handshake classification so a cross-browser
 * run can label a failure (capability, gathering, ICE, channel) before any
 * human judgment is applied. Both the sync contract spec and the opt-in
 * diagnostic spec reuse this module — keep helpers here, not in specs.
 */

export type SyncStateSnapshot = {
  state: string;
  message?: string;
  /** Latched: true once ANY callback observed "completed". The service
   * schedules a post-completion disconnect ~2 s after success
   * (maybeScheduleDisconnectAfterSync), so the live `state` only holds
   * "completed" for that window — under parallel-worker main-thread
   * starvation a poll can miss it and observe only the post-disconnect
   * "disconnected". The latch lets assertions prove the sync DID complete.
   */
  everCompleted?: boolean;
};

export interface SyncWindow extends Window {
  __bookmarkForgeSyncState?: SyncStateSnapshot;
}

export type HandshakeEvidence = {
  url: string;
  rtcSupported: boolean;
  state: string;
  message?: string;
  connectionState: string | null;
  iceConnectionState: string | null;
  iceGatheringState: string | null;
  signalingState: string | null;
  dataChannelState: string | null;
  localSdp: string;
  remoteSdp: string;
  localCandidates: string[];
  remoteCandidates: string[];
  localCandidateCount: number;
  remoteCandidateCount: number;
};

/** Cap the full SDP snapshots so an attachment stays bounded. */
const MAX_SDP_CAPTURE = 4 * 1024;

/** Register the in-page sync-state probe used by every diagnostic capture. */
export async function installSyncStateProbe(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const state: SyncStateSnapshot = { state: "disconnected" };
    (window as SyncWindow).__bookmarkForgeSyncState = state;
    const { webRTCSyncService } = await import(
      "/src/services/WebRTCSyncService"
    );
    webRTCSyncService.registerCallbacks((nextState, message) => {
      state.state = nextState;
      state.message = message;
      if (nextState === "completed") {
        state.everCompleted = true;
      }
    }, () => undefined);
  });
}

/**
 * Snapshot the WebRTC service internals: full local/remote SDP (bounded),
 * ICE candidate lists, and the connection/data-channel states. Never throws
 * on a failed handshake — the failure IS the evidence. Throws only when the
 * page/app itself is unavailable (harness regression).
 */
export async function captureHandshakeEvidence(
  page: Page,
): Promise<HandshakeEvidence> {
  return page.evaluate(async () => {
    const syncState = (window as SyncWindow).__bookmarkForgeSyncState;
    const { webRTCSyncService } = await import(
      "/src/services/WebRTCSyncService"
    );
    const internals = webRTCSyncService as unknown as {
      currentState?: string;
      peerConnection?: {
        connectionState?: string;
        iceConnectionState?: string;
        iceGatheringState?: string;
        signalingState?: string;
        localDescription?: { type?: string; sdp?: string } | null;
        remoteDescription?: { type?: string; sdp?: string } | null;
      } | null;
      dataChannel?: { readyState?: string } | null;
    };
    const pc = internals.peerConnection;
    const candidatesFrom = (sdp?: string | null): string[] =>
      (sdp ?? "")
        .split(/\r?\n/)
        .filter((line) => line.startsWith("a=candidate:"))
        .slice(0, 10);
    // Inlined (not the module constant): page.evaluate runs in the browser,
    // where module-scope consts are not visible.
    const sdpOf = (sdp?: string | null): string =>
      (sdp ?? "").slice(0, 4096);
    const localSdp = sdpOf(pc?.localDescription?.sdp);
    const remoteSdp = sdpOf(pc?.remoteDescription?.sdp);
    return {
      url: window.location.href,
      rtcSupported: typeof globalThis.RTCPeerConnection !== "undefined",
      state: syncState?.state ?? internals.currentState ?? "unknown",
      message: syncState?.message,
      connectionState: pc?.connectionState ?? null,
      iceConnectionState: pc?.iceConnectionState ?? null,
      iceGatheringState: pc?.iceGatheringState ?? null,
      signalingState: pc?.signalingState ?? null,
      dataChannelState: internals.dataChannel?.readyState ?? null,
      localSdp,
      remoteSdp,
      localCandidates: candidatesFrom(pc?.localDescription?.sdp),
      remoteCandidates: candidatesFrom(pc?.remoteDescription?.sdp),
      localCandidateCount: candidatesFrom(pc?.localDescription?.sdp).length,
      remoteCandidateCount: candidatesFrom(pc?.remoteDescription?.sdp).length,
    };
  });
}

/**
 * Deterministic handshake classification from raw evidence. The checks are
 * ordered from the most fundamental capability to the deepest transport
 * state, so a WebKit run (no API) is never mislabelled as an ICE failure and
 * a Firefox loopback run (gathering never starts) is never mislabelled as a
 * data-channel issue.
 */
export function classifyHandshake(evidence: HandshakeEvidence): string {
  if (evidence.rtcSupported === false) {
    return "capability-missing";
  }
  if (evidence.state === "error") {
    if (/WebRTC is not supported/.test(evidence.message ?? "")) {
      return "capability-missing";
    }
    return "error-state";
  }
  // Gathering never started AND nothing was exchanged: the engine could not
  // enumerate interfaces for this page origin (Mozilla bug 1672145 class).
  if (
    evidence.iceGatheringState === "new" &&
    evidence.localCandidateCount === 0 &&
    evidence.remoteCandidateCount === 0
  ) {
    return "gathering-blocked";
  }
  if (evidence.localCandidateCount === 0) {
    return "no-local-candidates";
  }
  if (evidence.remoteCandidateCount === 0) {
    return "no-remote-candidates";
  }
  if (evidence.iceConnectionState === "failed") {
    return "ice-failed";
  }
  if (
    evidence.connectionState === "connecting" ||
    evidence.connectionState === "checking"
  ) {
    return evidence.dataChannelState === "open"
      ? "channel-open"
      : "handshake-stuck";
  }
  if (
    evidence.connectionState === "connected" ||
    evidence.dataChannelState === "open"
  ) {
    return "connected";
  }
  if (evidence.state === "completed") {
    return "contract-complete";
  }
  return "unknown";
}

/**
 * Final handshake classification combining the mid-flight snapshot with the
 * terminal one. The service auto-disconnects two seconds after a completed
 * sync (`disconnectTimer` → `disconnect()`), so a terminal snapshot may show
 * `state: disconnected` with a torn-down peer connection even though the
 * handshake fully succeeded. When the early snapshot is inconclusive
 * (stuck/unknown/no-candidates) but the terminal snapshot is the
 * post-completion teardown of a run whose offer AND answer were exchanged,
 * the handshake is classified as connected — the auto-disconnect only fires
 * after `completed`.
 */
export function classifyHandshakeOutcome(
  early: HandshakeEvidence,
  terminal: HandshakeEvidence,
  exchange: { offerExchanged: boolean; answerExchanged: boolean },
): string {
  const primary = classifyHandshake(early);
  const bothExchanged = exchange.offerExchanged && exchange.answerExchanged;
  const autoDisconnected =
    bothExchanged &&
    terminal.rtcSupported === true &&
    terminal.state === "disconnected" &&
    terminal.connectionState === null &&
    terminal.localCandidateCount === 0;
  if (
    autoDisconnected &&
    (primary === "unknown" ||
      primary === "handshake-stuck" ||
      primary === "no-local-candidates" ||
      primary === "no-remote-candidates")
  ) {
    return "connected";
  }
  return primary;
}
