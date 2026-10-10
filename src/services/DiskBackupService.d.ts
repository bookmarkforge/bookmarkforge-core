/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/DiskBackupService.ts`. No implementation is present in this repository. */
declare global {
    interface Window {
        showDirectoryPicker(options?: {
            mode: "read" | "readwrite";
            startIn?: "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
        }): Promise<FileSystemDirectoryHandle>;
    }
    interface FileSystemHandle {
        queryPermission(descriptor: {
            mode: "read" | "readwrite";
        }): Promise<PermissionState>;
        requestPermission(descriptor: {
            mode: "read" | "readwrite";
        }): Promise<PermissionState>;
    }
}
export interface BackupFolderInfo {
    supported: boolean;
    configured: boolean;
    name?: string;
    permission?: PermissionState;
}
export type DiskBackupResult = {
    method: "folder";
    name: string;
} | {
    method: "download";
    name: string;
} | {
    method: "download-blocked";
    name: string;
} | null;
export declare class DiskBackupService {
    private rootHandle;
    private dbPromise;
    isSupported(): boolean;
    buildBackupFileName(date?: Date): string;
    pickBackupFolder(): Promise<{
        name: string;
    } | null>;
    getBackupFolderInfo(): Promise<BackupFolderInfo>;
    clearBackupFolder(): Promise<void>;
    writeBackupToDisk(blob: Blob, fileName: string): Promise<DiskBackupResult>;
    private getHandle;
    private writeFileToFolder;
    private pruneOldBackups;
    private sanitizeFileName;
    private openDb;
    private persistHandle;
    private readPersistedHandle;
    private deletePersistedHandle;
}
export declare const diskBackupService: DiskBackupService;
