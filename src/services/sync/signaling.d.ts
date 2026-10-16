/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/sync/signaling.ts`. No implementation is present in this repository. */
interface SignalingSocketFactoryOptions {
    webSocketImpl?: typeof WebSocket;
    selfHostedSignalingUrl?: string | null;
}
export declare const SIGNAL_INIT_TIMEOUT_MS = 10000;
export declare const SIGNAL_QUEUE_LIMIT = 64;
export declare function deriveClientSignalKey(roomSecret: string, roomId: string): Promise<CryptoKey>;
export declare const SYNC_TOPIC_DOMAIN = "bookmarkforge-sync-topic:v1";
export declare function deriveSyncTopic(roomSecret: string, roomId: string, collectionName: string): Promise<string>;
export declare function canonicalSignalPayload(peerId: string, msg: Record<string, unknown>): string;
export declare function isSelfHostedSignalingUrl(socketUrl: string, configuredUrl: string | null | undefined): boolean;
export declare function createSignalingSocketFactory(roomSecret: string, roomId: string, options?: SignalingSocketFactoryOptions): (url: string) => WebSocket;
export declare const MAX_ICE_URL_LENGTH = 2048;
export declare const MAX_ICE_CREDENTIAL_LENGTH = 1024;
export declare function isSafeIceString(value: unknown, maxLength: number): value is string;
export declare function fetchIceServersFromSignaling(url: string): Promise<RTCIceServer[]>;
export {};
