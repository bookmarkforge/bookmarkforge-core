/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/BackupService.ts`. No implementation is present in this repository.
 * Enforced constants pinned from the private source at export time
 * (claim gates verify against these numbers):
   AUTO_BACKUP_INTERVAL_MS = 86400000;
 */
type BackupCredential = string | Uint8Array;
interface BackupMetadata {
    date: string;
    size: number;
    encrypted: boolean;
    collections: string[];
    docCount: number;
}
export declare class BackupService {
    private static encryptData;
    private static decryptData;
    private static toUsableCredential;
    static createBackupData(password?: string | Uint8Array): Promise<{
        blob: Blob;
        metadata: BackupMetadata;
    }>;
    private static exportInFlight;
    private static autoBackupInFlight;
    static exportBackup(password?: BackupCredential): Promise<void>;
    private static exportBackupInternal;
    private static importCollectionsData;
    private static createRollbackSnapshot;
    private static restoreSnapshot;
    private static attachOutcome;
    private static importInFlight;
    static importBackup(file: File, password?: BackupCredential): Promise<void>;
    private static importBackupInternal;
    private static importBackupWithRollback;
    static runAutoBackup(): Promise<BackupMetadata | null>;
    static getAutoBackupInfo(): Promise<{
        available: boolean;
        metadata?: BackupMetadata;
        age?: number;
    }>;
    static getDiskBackupInfo(): {
        method: "folder" | "download" | "download-blocked" | null;
        timestamp: number | null;
        error: string | null;
    };
    static restoreFromAutoBackup(): Promise<boolean>;
    private static base64ToBuffer;
    private static blobToBase64;
    private static autoBackupChunkKey;
    private static newGenerationId;
    private static parseManifest;
    private static storeAutoBackupChunked;
    private static readGenerationChunks;
    private static readAutoBackupBase64;
    static clearAutoBackup(): Promise<void>;
}
export {};
