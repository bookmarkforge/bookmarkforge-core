/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/WebRTCSyncService.ts`. No implementation is present in this repository. */
export { compareSyncVersions, constantTimeStringEqual } from "./webrtc-sync/compare";
export type SyncState = "disconnected" | "gathering" | "ready_to_share" | "connecting" | "connected" | "syncing" | "completed" | "error";
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
    registerCallbacks(stateCallback: (state: SyncState, message?: string) => void, progressCallback: (progress: number) => void): void;
    private minimizeSDP;
    private encodeLocalDescription;
    decodeDescription(encoded: string): RTCSessionDescriptionInit | null;
    private setupDataChannel;
    private teardownPreviousSession;
    startHost(): Promise<string>;
    processClientAnswer(encodedAnswer: string): Promise<void>;
    startClient(encodedOffer: string): Promise<string>;
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
