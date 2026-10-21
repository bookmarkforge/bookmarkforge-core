/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/webrtc-sync/validation.ts`. No implementation is present in this repository. */
export interface SyncStartMessage {
    type: "sync_start";
    totalChunks: number;
    checksum: string;
    auth?: string;
    hmac?: string;
    batchId?: string;
    batchIndex?: number;
    hasMore?: boolean;
    syncSessionId?: string;
}
export interface SyncAckMessage {
    type: "sync_ack";
    batchId: string;
}
export interface SyncChunkMessage {
    type: "sync_chunk";
    index: number;
    data: string;
}
export declare function isBoundedString(value: unknown, maxLength: number): value is string;
export declare function isSha256Hex(value: unknown): value is string;
export declare function isBoundedSyncTimestamp(value: unknown): value is string;
export declare function isOptionalSyncCursor(value: unknown): value is string | null;
export declare function isSyncStartMessage(value: unknown): value is SyncStartMessage;
export declare function isString(value: unknown, maxLength: number): value is string;
export declare function isStringArray(value: unknown, maxItems?: number): value is string[];
export declare function isValidSessionDescription(value: unknown): value is RTCSessionDescriptionInit;
export declare function isValidSyncDoc(doc: unknown, collection: "documents" | "bookmarks", strictSchema: boolean): doc is Record<string, unknown>;
