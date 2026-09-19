export type CloudProvider =
  "drive" | "dropbox" | "onedrive" | "box" | "pcloud" | "s3" | "webdav";

export interface CloudSyncConfig {
  provider: CloudProvider;
  enabledProviders?: CloudProvider[];
  authToken?: string;
  driveToken?: string;
  dropboxToken?: string;
  onedriveToken?: string;
  boxToken?: string;
  pcloudToken?: string;
  webdavConfig?: {
    url: string;
    username?: string;
    password?: string;
  };
  s3Config?: {
    endpoint: string;
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  refreshToken?: string;
  endpoint?: string;
  /** Number of timestamped remote backups to retain per provider. */
  remoteRetentionCount?: number;
}

export interface SyncResult {
  success: boolean;
  syncedItems?: string[];
  errors?: string[];
}

export interface CloudSyncProviderMetrics {
  provider: CloudProvider;
  attempts: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  lastDurationMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
}

export type ConflictStrategy =
  "local-wins" | "remote-wins" | "manual" | "newer-wins";

export interface SyncConflict {
  id: string;
  localVersion: unknown;
  remoteVersion: unknown;
  localModified: number;
  remoteModified: number;
  strategy: ConflictStrategy;
}

export interface ConflictResolution {
  resolved: unknown;
  strategy: ConflictStrategy;
  timestamp: number;
}

export interface SyncMetadata {
  lastSync?: number;
  version: string;
  checksum?: string;
}
