/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/SyncService.ts`. No implementation is present in this repository. */
import { RxDatabase } from "rxdb";
export { SIGNAL_INIT_TIMEOUT_MS, SIGNAL_QUEUE_LIMIT, SYNC_TOPIC_DOMAIN, createSignalingSocketFactory, canonicalSignalPayload, deriveClientSignalKey, deriveSyncTopic, } from "./sync/signaling";
export { SYNC_ALLOWED_COLLECTIONS } from "./sync/replication";
export declare class SyncService {
    private replications;
    private startPromise;
    private startPromiseRoomId;
    private roomSecret;
    isSyncing: boolean;
    currentRoomId: string | null;
    connectedPeers: number;
    lastSyncTime: number | null;
    syncHealth: "healthy" | "warning" | "error" | "connecting";
    onSyncStateChange: ((syncing: boolean, roomId: string | null, peers: number, health: string, lastSync: number | null) => void) | null;
    private reconnectTimer;
    private healthCheckTimer;
    private onlineListener;
    private subscriptions;
    private privacyGuardSubscriptions;
    private operationCache;
    private dedupeConfig;
    private lastProcessedHashes;
    private hashTimestamps;
    private static readonly DEDUPE_GRACE_MS;
    private dedupeChannel;
    private dedupeChannelName;
    private dedupeRoomId;
    private notify;
    private generateOperationHash;
    private openDedupeChannel;
    private closeDedupeChannel;
    private broadcastDedupeHash;
    private isOperationDuplicate;
    private recordOperation;
    clearDedupeCache(): void;
    getDedupeStats(): {
        cacheSize: number;
        uniqueHashes: number;
    };
    private assertNoPrivateRecords;
    private installPrivacyGuards;
    startP2PSync(db: RxDatabase, roomId: string, sharedRoomSecret?: string): Promise<void>;
    private startP2PSyncInternal;
    private registerOnlineListener;
    simulatePartition(db: RxDatabase): Promise<void>;
    private reconnectAttempts;
    private sessionGeneration;
    private scheduleReconnect;
    private startHealthCheck;
    restartSync(db: RxDatabase): Promise<void>;
    stopAll(clearDedupe?: boolean): void;
    getRoomSecret(): string | null;
    private buildIceServersFromEnv;
    generateRoomId(): Promise<string>;
}
export declare const syncService: SyncService;
