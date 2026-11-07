/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/WebRTCSyncService.ts`. No implementation is present in this repository. */
import { type PairingMode } from "./webrtc-sync/pairing";
export { compareSyncVersions, constantTimeStringEqual } from "./webrtc-sync/compare";
export type SyncState = "disconnected" | "gathering" | "ready_to_share" | "connecting" | "connected" | "pairing" | "syncing" | "completed" | "error";
type PairingUiEvent = {
    type: "sas";
    code: string;
} | {
    type: "confirmed";
} | {
    type: "failed";
    message: string;
};
export declare class WebRTCUnsupportedError extends Error {
    constructor();
}
export declare function isWebRTCSupported(): boolean;
declare class WebRTCSyncService {
    private peerConnection;
    private dataChannel;
    private onStateChange;
    private onProgress;
    private hostFallbackTimer;
    private clientFallbackTimer;
    private disconnectTimer;
    private incomingTransferTimer;
    private currentState;
    private setState;
    registerCallbacks(stateCallback: (state: SyncState, message?: string) => void, progressCallback: (progress: number) => void, pairingCallback?: (event: PairingUiEvent) => void): void;
    private minimizeSDP;
    private encodeLocalDescription;
    private parseEncodedPayload;
    decodeDescription(encoded: string): RTCSessionDescriptionInit | null;
    describeOfferPairing(encoded: string): "none" | "verify" | "code" | "invalid";
    getPairingCode(): string | null;
    private setupDataChannel;
    private teardownPreviousSession;
    startHost(options?: {
        pairing?: PairingMode;
    }): Promise<string>;
    processClientAnswer(encodedAnswer: string): Promise<void>;
    startClient(encodedOffer: string, options?: {
        pairingCode?: string;
    }): Promise<string>;
    private armPairing;
    private armClientPairing;
    private resetPairing;
    private beginPairingHandshake;
    private handlePairHello;
    private maybeDerivePairingSession;
    confirmPairing(): void;
    private handlePairConfirm;
    private maybeStartPairedSync;
    private failPairing;
    private sendOrThrow;
    private startSync;
    private incomingBuffer;
    private expectedChunks;
    private expectedChecksum;
    private expectedSyncAuth;
    private expectedPayloadHmac;
    private receivedPayloadBytes;
    private expectedBatchId;
    private expectedBatchIndex;
    private expectedSyncSessionId;
    private expectedHasMore;
    private nextExpectedBatchIndex;
    private paginatedSessionActive;
    private paginatedSessionId;
    private supportsPaginatedSync;
    private capabilitiesNegotiated;
    private completedSyncSessions;
    private processingIncoming;
    private outboundSyncActive;
    private syncGeneration;
    private pendingBatchAcks;
    private capabilityWaiter;
    private peerLastSyncAt;
    private advertisedCursor;
    private pairing;
    private pairingCode;
    private outboundPairField;
    private onPairingEvent;
    private handleIncomingMessage;
    private clearIncomingTransferTimeout;
    private armIncomingTransferTimeout;
    private resetBuffer;
    private resetPaginationSession;
    private negotiateCapabilities;
    private getAdvertisedCursor;
    private readAdvertisedCursor;
    private persistSyncCursor;
    private waitForBatchAck;
    private clearPendingBatchAcks;
    private processReceivedData;
    private maybeScheduleDisconnectAfterSync;
    disconnect(): void;
}
export declare const webRTCSyncService: WebRTCSyncService;
