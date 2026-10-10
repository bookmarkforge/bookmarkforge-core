/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/BackupService.ts`. No implementation is present in this repository.
 * Enforced constants pinned from the private source at export time
 * (claim gates verify against these numbers):
   AUTO_BACKUP_INTERVAL_MS = 86400000;
 */
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
    static createBackupData(password?: string | Uint8Array): Promise<{
        blob: Blob;
        metadata: BackupMetadata;
    }>;
    private static exportInFlight;
    private static autoBackupInFlight;
    static exportBackup(password?: string | Uint8Array): Promise<void>;
    private static exportBackupInternal;
    private static importCollectionsData;
    private static createRollbackSnapshot;
    private static importInFlight;
    static importBackup(file: File, password?: string | Uint8Array): Promise<void>;
    private static importBackupInternal;
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
    private static storeAutoBackupChunked;
    private static readAutoBackupBase64;
    static clearAutoBackup(): Promise<void>;
}
export {};
