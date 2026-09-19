import { logger } from "../../utils/logger";
import { safeSet } from "../../store/safeStorage";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import { loadBackupService } from "../pro-access";
import { securityVault } from "../SecurityVault";
import { zeroPasswordBytes } from "../../utils/crypto-core";
import { createAdapter, getErrorMessage } from "./cloudSync.adapters";
import {
  createRemoteIntegritySidecar,
  getSidecarFileName,
  verifyRemoteBackupIntegrity,
  type RemoteIntegrityResult,
} from "./cloudSync.integrity";
import type { CloudProviderAdapter } from "./cloudSync.adapters";
export type { CloudProviderAdapter } from "./cloudSync.adapters";
export { createAdapter } from "./cloudSync.adapters";
export type {
  CloudProvider,
  CloudSyncConfig,
  SyncResult,
  CloudSyncProviderMetrics,
  ConflictStrategy,
  SyncConflict,
  ConflictResolution,
  SyncMetadata,
} from "./cloudSync.types";
import type {
  CloudProvider,
  CloudSyncConfig,
  SyncResult,
  CloudSyncProviderMetrics,
  SyncConflict,
  ConflictResolution,
  ConflictStrategy,
} from "./cloudSync.types";

/**
 * Manages vault synchronization across multiple cloud providers
 * (Google Drive, Dropbox, OneDrive, S3, WebDAV, SFTP, etc.).
 * Handles authentication, conflict detection/resolution, retry with
 * exponential backoff, and per-provider metrics tracking.
 *
 * @example
 * ```ts
 * const sync = new CloudSyncService({ provider: 'drive', authToken: '...' });
 * sync.setLocalDataProvider(() => vault.exportData());
 * const result = await sync.sync();
 * ```
 */
interface SyncOptions {
  signal?: AbortSignal;
}

export class CloudSyncService {
  private config?: CloudSyncConfig;
  private adapter?: CloudProviderAdapter;
  private dataProvider?: () => Promise<unknown>;
  private backoffConfig = {
    baseMs: 200,
    capMs: 2000,
    jitter: true,
    maxRetries: 3,
  };
  private static readonly DEFAULT_ENABLED_PROVIDERS: CloudProvider[] = [
    "drive",
    "dropbox",
    "onedrive",
    "s3",
    "webdav",
  ];
  private metrics: Record<CloudProvider, CloudSyncProviderMetrics> =
    {} as Record<CloudProvider, CloudSyncProviderMetrics>;
  private syncAllLock: Promise<unknown> | null = null;

  private getProviderMetrics(
    provider: CloudProvider,
  ): CloudSyncProviderMetrics {
    const existing = this.metrics[provider];
    if (existing) {return existing;}
    const fresh: CloudSyncProviderMetrics = {
      provider,
      attempts: 0,
      successCount: 0,
      failureCount: 0,
      retryCount: 0,
      lastDurationMs: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
    };
    this.metrics[provider] = fresh;
    return fresh;
  }

  /** Returns a snapshot of sync metrics for all providers. */
  public getSyncMetrics(): Record<CloudProvider, CloudSyncProviderMetrics> {
    return { ...this.metrics };
  }
  protected sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Sync cancelled", "AbortError"));
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        cleanup();
        reject(new DOMException("Sync cancelled", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException("Sync cancelled", "AbortError");
    }
  }
  /**
   * Updates retry/backoff configuration for network errors.
   * @param cfg - Partial config: baseMs, capMs, jitter, maxRetries
   */
  public setBackoffConfig(cfg: {
    baseMs?: number;
    capMs?: number;
    jitter?: boolean;
    maxRetries?: number;
  }): void {
    Object.assign(this.backoffConfig, cfg);
  }
  /** Returns a copy of the current backoff configuration. */
  public getBackoffConfig(): {
    baseMs: number;
    capMs: number;
    jitter: boolean;
    maxRetries: number;
  } {
    return { ...this.backoffConfig };
  }
  /**
   * Returns the stored token for a specific cloud provider.
   * @param provider - The cloud provider to query
   */
  public getProviderToken(provider: CloudProvider): string | undefined {
    if (provider === "drive")
      {return this.config?.driveToken || this.config?.authToken;}
    if (provider === "dropbox") {return this.config?.dropboxToken;}
    if (provider === "onedrive") {return this.config?.onedriveToken;}
    if (provider === "box") {return this.config?.boxToken;}
    if (provider === "pcloud") {return this.config?.pcloudToken;}
    if (provider === "s3" || provider === "webdav") {return undefined;}
    return this.config?.authToken;
  }
  private getProviderConfig(
    provider: CloudProvider,
  ): Record<string, unknown> | undefined {
    if (provider === "webdav")
      {return this.config?.webdavConfig as unknown as
        Record<string, unknown> | undefined;}
    if (provider === "s3")
      {return this.config?.s3Config as unknown as
        Record<string, unknown> | undefined;}
    return undefined;
  }
  private hasSyncCredentials(provider: CloudProvider): boolean {
    if (provider === "webdav") {return !!this.config?.webdavConfig;}
    if (provider === "s3") {return !!this.config?.s3Config;}
    return !!this.getProviderToken(provider);
  }
  private isProviderEnabled(provider: CloudProvider): boolean {
    const enabled =
      this.config?.enabledProviders ??
      CloudSyncService.DEFAULT_ENABLED_PROVIDERS;
    return enabled.includes(provider);
  }
  private getSyncTargets(): Array<{
    provider: CloudProvider;
    token?: string;
    config?: Record<string, unknown>;
  }> {
    const orderedProviders: CloudProvider[] = [
      "drive",
      "dropbox",
      "onedrive",
      "box",
      "pcloud",
      "s3",
      "webdav",
    ];
    return orderedProviders
      .filter((provider) => this.isProviderEnabled(provider))
      .filter((provider) => this.hasSyncCredentials(provider))
      .map((provider) => ({
        provider,
        token: this.getProviderToken(provider),
        config: this.getProviderConfig(provider),
      }));
  }
  private computeBackoff(attempt: number): number {
    const { baseMs, capMs, jitter } = this.backoffConfig;
    let delay = Math.min(capMs, baseMs * Math.pow(2, attempt - 1));
    if (jitter) {
      const jitterFactor = 0.5 + Math.random() * 0.5;
      delay = Math.floor(delay * jitterFactor);
    }
    return Math.max(0, delay);
  }
  private isAuthError(message: string): boolean {
    return /(Unauthorized|401|invalid token|token expired)/i.test(message);
  }
  private isForbiddenError(message: string): boolean {
    return /(403|Forbidden|permission|denied)/i.test(message);
  }
  private isNetworkError(message: string): boolean {
    return /(Network|timeout|ECONN|network error)/i.test(message);
  }
  /**
   * Initializes or reconfigures the sync service with new provider settings.
   * @param config - Cloud provider configuration
   */
  constructor(config?: CloudSyncConfig) {
    this.config = config;
    if (config) {this.init(config);}
  }
  /**
   * Configures the cloud provider adapter.
   * @param config - Cloud provider configuration including auth tokens
   */
  init(config: CloudSyncConfig): void {
    this.config = config;
    this.adapter = createAdapter(
      config.provider,
      config.authToken,
      this.getProviderConfig(config.provider),
    );
  }
  /**
   * Registers the function that returns local vault data for sync uploads.
   * @param dp - Async function returning the local data payload
   */
  setLocalDataProvider(dp: () => Promise<unknown>): void {
    this.dataProvider = dp;
  }
  private ensureAdapter(): CloudProviderAdapter {
    if (!this.adapter && this.config) {
      this.adapter = createAdapter(
        this.config.provider,
        this.config.authToken,
        this.getProviderConfig(this.config.provider),
      );
    }
    if (!this.adapter)
      {throw new Error("CloudSyncService: adapter not configured");}
    return this.adapter;
  }
  /**
   * Initiates OAuth/auth flow for the configured provider.
   * @returns The auth token string after successful authentication
   */
  async authenticate(): Promise<string> {
    const adapter = this.ensureAdapter();
    return adapter.authenticate();
  }
  /**
   * Syncs local vault data to the configured cloud provider.
   * Uploads a timestamped JSON file. Handles auth, permission, and
   * network errors with automatic retries for transient failures.
   * @returns Sync result indicating success/failure and any errors
   */
  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    const adapter = this.ensureAdapter();
    return this.syncWithAdapter(adapter, options);
  }
  /**
   * Detects whether local and remote data differ.
   * @param local - Local data snapshot
   * @param remote - Remote data snapshot
   * @param localModified - Timestamp of last local modification
   * @param remoteModified - Timestamp of last remote modification
   * @returns Conflict object if data differs, `null` if identical
   */
  detectConflict(
    local: unknown,
    remote: unknown,
    localModified: number,
    remoteModified: number,
  ): SyncConflict | null {
    if (!local || !remote) {return null;}
    const localStr = JSON.stringify(local);
    const remoteStr = JSON.stringify(remote);
    if (localStr === remoteStr) {return null;}
    return {
      id: this.generateConflictId(local, remote),
      localVersion: local,
      remoteVersion: remote,
      localModified,
      remoteModified,
      strategy: "newer-wins",
    };
  }

  /**
   * Resolves a sync conflict using the specified strategy.
   * @param conflict - The detected conflict with local/remote versions
   * @returns Resolution containing the winning data and strategy used
   */
  resolveConflict(conflict: SyncConflict): ConflictResolution {
    const {
      strategy,
      localVersion,
      remoteVersion,
      localModified,
      remoteModified,
    } = conflict;
    let resolved: unknown;
    switch (strategy) {
      case "local-wins":
        resolved = localVersion;
        break;
      case "remote-wins":
        resolved = remoteVersion;
        break;
      case "newer-wins":
        resolved =
          localModified > remoteModified ? localVersion : remoteVersion;
        break;
      case "manual":
        resolved = null;
        break;
      default:
        resolved =
          localModified > remoteModified ? localVersion : remoteVersion;
    }
    return { resolved, strategy, timestamp: Date.now() };
  }

  /**
   * Merges local and remote data using the given conflict strategy.
   * @param local - Local data
   * @param remote - Remote data
   * @param strategy - Resolution strategy: 'local-wins', 'remote-wins', 'newer-wins', or 'manual'
   * @returns Merged data, or `null` if strategy is 'manual'
   */
  mergeData(
    local: unknown,
    remote: unknown,
    strategy: ConflictStrategy,
  ): unknown {
    if (strategy === "manual") {return null;}
    if (!local) {return remote;}
    if (!remote) {return local;}
    const conflict: SyncConflict = {
      id: this.generateConflictId(local, remote),
      localVersion: local,
      remoteVersion: remote,
      localModified: 0,
      remoteModified: 0,
      strategy,
    };
    return this.resolveConflict(conflict).resolved;
  }

  /**
   * Persist the wall-clock time of the last successful offsite upload
   * (F1-F criterion 2). The counter is best-effort: a full/stale localStorage
   * must never fail an otherwise successful sync, so failures are logged and
   * swallowed.
   */
  private recordOffsiteBackupSuccess(): void {
    try {
      safeSet(
        STORAGE_KEYS.BOOKMARKFORGE_CLOUD_LASTBACKUP,
        Date.now().toString(),
      );
    } catch (error) {
      logger.warn("cloudSync.recordOffsiteBackupSuccess", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private generateConflictId(local: unknown, remote: unknown): string {
    const combined = JSON.stringify({ local, remote });
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Keeps a bounded set of timestamped backups when the provider supports
   * deletion. Providers without a delete API still retain immutable,
   * timestamped versions and are never overwritten by this client.
   */
  private async pruneRemoteBackups(
    adapter: CloudProviderAdapter,
    signal?: AbortSignal,
  ): Promise<void> {
    const deleteFile = adapter.deleteFile;
    // Only opt in when the setting is present. This preserves the behavior of
    // legacy encrypted configurations while the UI writes the default (10)
    // for newly saved configurations.
    if (!deleteFile || this.config?.remoteRetentionCount === undefined) {
      return;
    }
    const configured = this.config.remoteRetentionCount;
    const retention = Math.max(1, Math.min(100, Math.floor(configured)));
    try {
      const files = await adapter.listFiles(signal);
      // Retention matches only payload backups; `.integrity.json` sidecars
      // are pruned separately below so a payload and its tag always share
      // the same lifetime on the provider.
      const backups = files
        .filter((file) =>
          /^bookmarkforge_sync_[a-z]+_\d{13}(?:_net\d+)?\.json$/.test(
            file.name,
          ) &&
          !file.name.endsWith(".integrity.json"),
        )
        .sort((a, b) => {
          const aTime = a.modifiedTime
            ? Date.parse(a.modifiedTime)
            : Number(a.name.match(/_(\d{13})(?:_net\d+)?\.json$/)?.[1] ?? 0);
          const bTime = b.modifiedTime
            ? Date.parse(b.modifiedTime)
            : Number(b.name.match(/_(\d{13})(?:_net\d+)?\.json$/)?.[1] ?? 0);
          return bTime - aTime;
        });
      const stale = new Set(
        backups.slice(retention).map((file) => file.name),
      );
      for (const file of files) {
        if (
          file.name.endsWith(".integrity.json") &&
          stale.has(file.name.slice(0, -".integrity.json".length))
        ) {
          stale.add(file.name);
        }
      }
      for (const name of stale) {
        const file = files.find((f) => f.name === name);
        if (!file) {continue;}
        try {
          await deleteFile.call(adapter, file.id, signal);
        } catch (error) {
          // Retention is best-effort; never report a successful upload as failed.
          logger.warn("cloudSync.pruneRemoteBackups", {
            provider: adapter.providerName,
            file: file.name,
            error: getErrorMessage(error, "delete failed"),
          });
        }
      }
    } catch (error) {
      logger.warn("cloudSync.pruneRemoteBackups", {
        provider: adapter.providerName,
        error: getErrorMessage(error, "listing failed"),
      });
    }
  }

  private async syncWithAdapter(
    adapter: CloudProviderAdapter,
    options: SyncOptions = {},
  ): Promise<SyncResult> {
    const provider = adapter.providerName;
    const m = this.getProviderMetrics(provider);
    const { signal } = options;
    this.throwIfAborted(signal);
    const start =
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();

    m.attempts += 1;
    if (!this.dataProvider) {
      const message = "No local data provider registered";
      m.failureCount += 1;
      m.lastFailureAt = Date.now();
      m.lastError = message;
      return { success: false, errors: [message] };
    }

    let local: unknown;
    try {
      local = await this.dataProvider();
      this.throwIfAborted(signal);
    } catch (error) {
      const message = getErrorMessage(error, "Local data provider failed");
      m.failureCount += 1;
      m.lastFailureAt = Date.now();
      m.lastError = message;
      logger.error("cloudSync.syncWithAdapter", {
        provider: adapter.providerName,
        error: message,
        phase: "local-data",
      });
      return { success: false, errors: [message] };
    }
    if (!local) {
      const message = "No local data to sync";
      m.failureCount += 1;
      m.lastFailureAt = Date.now();
      m.lastError = message;
      return { success: false, errors: [message] };
    }
    try {
      this.throwIfAborted(signal);
      const payload = JSON.stringify(local);
      const filename = `bookmarkforge_sync_${adapter.providerName}_${Date.now()}.json`;
      await adapter.uploadFile(filename, payload, "application/json", signal);
      // Publish the per-version HMAC sidecar AFTER the payload so a crash
      // between the two uploads leaves an untagged (but intact) backup, never
      // a dangling tag without data. Best-effort: a sidecar failure never
      // invalidates a successful upload.
      await this.uploadIntegritySidecar(
        adapter,
        filename,
        payload,
        signal,
      );
      this.throwIfAborted(signal);
      await this.pruneRemoteBackups(adapter, signal);
      const end =
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      m.lastDurationMs = Math.max(0, Math.round(end - start));
      m.successCount += 1;
      m.lastSuccessAt = Date.now();
      m.lastError = null;
      this.recordOffsiteBackupSuccess();
      return { success: true, syncedItems: [filename] };
    } catch (e) {
      if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) {
        m.lastError = "Sync cancelled";
        return { success: false, errors: ["Sync cancelled"] };
      }
      const msg = getErrorMessage(e);
      logger.error("cloudSync.syncWithAdapter", {
        provider: adapter?.providerName,
        error: msg,
        attempt: 1,
      });
      const end =
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      m.lastDurationMs = Math.max(0, Math.round(end - start));
      m.failureCount += 1;
      m.lastFailureAt = Date.now();
      m.lastError = msg || "unknown";
      if (this.isAuthError(msg)) {
        logger.warn("cloudSync.syncWithAdapter", {
          provider: adapter?.providerName,
          action: "auth-failed",
        });
        return {
          success: false,
          errors: [
            "Authentication failed. Please re-authenticate this provider.",
          ],
        };
      }
      if (this.isForbiddenError(msg)) {
        logger.warn("cloudSync.syncWithAdapter", {
          provider: adapter?.providerName,
          action: "forbidden",
        });
        return { success: false, errors: [msg || "Permission denied"] };
      }
      if (this.isNetworkError(msg)) {
        for (
          let attempt = 1;
          attempt <= this.backoffConfig.maxRetries;
          attempt++
        ) {
          m.retryCount += 1;
          const delay = this.computeBackoff(attempt);
          logger.info("cloudSync.syncWithAdapter", {
            provider: adapter?.providerName,
            action: "network-retry",
            attempt,
            delay,
          });
          try {
            await this.sleep(delay, signal);
          } catch (retryWaitError) {
            if (
              signal?.aborted ||
              (retryWaitError instanceof Error && retryWaitError.name === "AbortError")
            ) {
              m.lastError = "Sync cancelled";
              return { success: false, errors: ["Sync cancelled"] };
            }
            throw retryWaitError;
          }
          try {
            this.throwIfAborted(signal);
            const retryPayload = JSON.stringify(local);
            const retryFilename = `bookmarkforge_sync_${adapter.providerName}_${Date.now()}_net${attempt}.json`;
            await adapter.uploadFile(
              retryFilename,
              retryPayload,
              "application/json",
              signal,
            );
            await this.uploadIntegritySidecar(
              adapter,
              retryFilename,
              retryPayload,
              signal,
            );
            this.throwIfAborted(signal);
            await this.pruneRemoteBackups(adapter, signal);
            const retryEnd =
              typeof performance !== "undefined" &&
              typeof performance.now === "function"
                ? performance.now()
                : Date.now();
            m.lastDurationMs = Math.max(0, Math.round(retryEnd - start));
            m.successCount += 1;
            m.lastSuccessAt = Date.now();
            m.lastError = null;
            this.recordOffsiteBackupSuccess();
            return { success: true, syncedItems: [retryFilename] };
          } catch (retryErr) {
            if (
              signal?.aborted ||
              (retryErr instanceof Error && retryErr.name === "AbortError")
            ) {
              m.lastError = "Sync cancelled";
              return { success: false, errors: ["Sync cancelled"] };
            }
            const retryMsg = getErrorMessage(retryErr);
            if (
              !this.isNetworkError(retryMsg) ||
              attempt === this.backoffConfig.maxRetries
            ) {
              logger.error("cloudSync.syncWithAdapter", {
                provider: adapter?.providerName,
                action: "network-retry-failed",
              });
              return {
                success: false,
                errors: [getErrorMessage(retryErr, "Network retry failed")],
              };
            }
          }
        }
      }
      return {
        success: false,
        errors: [getErrorMessage(e, "Unknown error during sync")],
      };
    }
  }

  /**
   * Computes and uploads the HMAC integrity sidecar for a remote backup
   * version. Best-effort by design: a sidecar failure is logged but never
   * invalidates the payload upload that already succeeded.
   */
  private async uploadIntegritySidecar(
    adapter: CloudProviderAdapter,
    payloadFileName: string,
    payload: string,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const payloadBytes = new TextEncoder().encode(payload);
      await securityVault.withMasterPasswordBytes(
        integrityCaller,
        async (passwordBytes) => {
          if (!passwordBytes) {return;}
          const sidecar = await createRemoteIntegritySidecar(
            payloadBytes,
            payloadFileName,
            passwordBytes,
          );
          await adapter.uploadFile(
            getSidecarFileName(payloadFileName),
            sidecar,
            "application/json",
            signal,
          );
        },
      );
    } catch (error) {
      logger.warn("cloudSync.uploadIntegritySidecar", {
        provider: adapter.providerName,
        file: getSidecarFileName(payloadFileName),
        error: getErrorMessage(error, "sidecar upload failed"),
      });
    }
  }

  /**
   * Verifies a downloaded backup against its integrity sidecar BEFORE the
   * payload is decoded or decrypted. Missing sidecars (legacy backups, or
   * uploads whose sidecar crashed) return `status: "missing"` so callers
   * decide whether to proceed; a present-but-invalid tag is a hard failure.
   *
   * @param payloadBytes Exact downloaded bytes.
   * @param remoteFileName Remote filename the payload was downloaded from.
   */
  async verifyRemoteBackup(
    payloadBytes: Uint8Array,
    remoteFileName: string,
    options: SyncOptions = {},
  ): Promise<RemoteIntegrityResult> {
    this.throwIfAborted(options.signal);
    // A provider-modified or attacker-chosen fileName must never make us
    // read a sidecar for a different version: reject anything that does not
    // look exactly like one of our payload backups.
    if (!/^bookmarkforge_sync_[a-z]+_\d{13}(?:_net\d+)?\.json$/.test(remoteFileName)) {
      return { status: "missing" };
    }
    const adapter = this.ensureAdapter();
    let sidecarJson: string | null = null;
    try {
      // Sidecars are resolved through listFiles → provider id, because
      // tokenized adapters (Drive/Dropbox/OneDrive/Box/pCloud) download by
      // opaque id, not by name. One extra list per restore is acceptable:
      // restore is user-initiated and rare.
      const files = await adapter.listFiles(options.signal);
      const sidecarEntry = files.find(
        (file) => file.name === getSidecarFileName(remoteFileName),
      );
      if (sidecarEntry) {
        const data = await adapter.downloadFile(sidecarEntry.id, options.signal);
        sidecarJson = new TextDecoder().decode(data);
      }
    } catch {
      sidecarJson = null; // listing/download failed → treat as untagged
    }
    this.throwIfAborted(options.signal);
    return securityVault.withMasterPasswordBytes(
      integrityCaller,
      async (passwordBytes) => {
        if (!passwordBytes) {
          return { status: "missing" } as RemoteIntegrityResult;
        }
        return verifyRemoteBackupIntegrity(
          payloadBytes,
          sidecarJson,
          passwordBytes,
          remoteFileName,
        );
      },
    );
  }

  /**
   * Lists files available in the cloud provider's sync directory.
   * @returns Array of file entries with id, name, and modification time
   */
  async listFiles(options: SyncOptions = {}): Promise<
    Array<{ id: string; name: string; modifiedTime?: string }>
  > {
    this.throwIfAborted(options.signal);
    const adapter = this.ensureAdapter();
    const files = await adapter.listFiles(options.signal);
    this.throwIfAborted(options.signal);
    return files;
  }

  /**
   * Downloads a file from the cloud provider by its identifier.
   * @param id - The file identifier returned by {@link listFiles}
   * @returns The file contents as a Buffer
   */
  async downloadFile(id: string, options: SyncOptions = {}): Promise<Buffer> {
    this.throwIfAborted(options.signal);
    const adapter = this.ensureAdapter();
    const data = await adapter.downloadFile(id, options.signal);
    this.throwIfAborted(options.signal);
    return data;
  }

  /**
   * Syncs vault data to ALL enabled providers that have valid credentials.
   * Each provider is synced independently; one failure doesn't block others.
   * @returns Per-provider sync results
   */
  syncAll(options: SyncOptions = {}): Promise<Record<CloudProvider, SyncResult>> {
    // Reentrancy guard: a concurrent syncAll would duplicate uploads and
    // corrupt per-provider metrics. Serialize overlapping calls by returning
    // the SAME in-flight promise (identity-preserving so callers can dedupe).
    if (this.syncAllLock) {
      logger.warn("cloudSync.syncAll", {
        action: "skipped",
        reason: "in-flight",
      });
      return this.syncAllLock as Promise<Record<CloudProvider, SyncResult>>;
    }
    const run = async (): Promise<Record<CloudProvider, SyncResult>> => {
      logger.info("cloudSync.syncAll", { action: "start" });
      const results: Partial<Record<CloudProvider, SyncResult>> = {};
      const targets = this.getSyncTargets();

      for (const { provider, token, config } of targets) {
        this.throwIfAborted(options.signal);
        const adapter = createAdapter(provider, token, config);
        results[provider] = await this.syncWithAdapter(adapter, options);
      }

      logger.info("cloudSync.syncAll", {
        action: "complete",
        providers: Object.keys(results),
      });
      return results as Record<CloudProvider, SyncResult>;
    };
    this.syncAllLock = run().finally(() => {
      this.syncAllLock = null;
    });
    return this.syncAllLock as Promise<Record<CloudProvider, SyncResult>>;
  }
}

export const cloudSyncService = new CloudSyncService();

const localBackupCaller = {};
securityVault.registerCaller(localBackupCaller);

const integrityCaller = {};
securityVault.registerCaller(integrityCaller);

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const cleanup = () => {
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };
    const fail = (error: unknown) => {
      if (settled) {return;}
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    reader.onload = () => {
      if (settled) {return;}
      if (typeof reader.result !== "string") {
        fail(new Error("Failed to read backup as base64"));
        return;
      }
      const [, base64] = reader.result.split(",", 2);
      if (!base64) {
        fail(new Error("Backup base64 data is empty"));
        return;
      }
      settled = true;
      cleanup();
      resolve(base64);
    };
    reader.onerror = () => fail(reader.error ?? new Error("Failed to read backup"));
    reader.onabort = () => fail(new DOMException("Backup read aborted", "AbortError"));
    try {
      reader.readAsDataURL(blob);
    } catch (error) {
      fail(error);
    }
  });
}

/** Registers the encrypted local-vault payload used by manual and startup sync. */
export function registerLocalBackupProvider(
  service: CloudSyncService = cloudSyncService,
): void {
  service.setLocalDataProvider(async () =>
    securityVault.withMasterPasswordBytes(
      localBackupCaller,
      async (passwordBytes) => {
        if (!passwordBytes) {
          throw new Error("Vault is locked");
        }
try {
           const { blob } = await (
             await loadBackupService()
           ).createBackupData(passwordBytes);
           return {
             encrypted: true,
             data: await blobToBase64(blob),
             timestamp: Date.now(),
           };
} finally {
             if (passwordBytes) {
               zeroPasswordBytes(passwordBytes);
             }
           }
         },
       ),
    );
  }
