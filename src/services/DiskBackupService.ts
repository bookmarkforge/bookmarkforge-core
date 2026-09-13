// src/services/DiskBackupService.ts
//
// Disk backups (roadmap F0-1): writes an encrypted copy of the daily
// auto-backup to the user's REAL filesystem (outside the browser's origin
// storage), so clearing site data, browser eviction or device loss can never
// destroy the vault and its backup together.
//
// Two paths:
//   1. Chrome/Edge — the user picks a folder once via the File System Access
//      API. The directory handle is persisted in IndexedDB (handles are
//      structured-cloneable) and reused across sessions while the browser
//      keeps the readwrite permission "granted".
//   2. Firefox/Safari — no folder picker; fall back to a normal download,
//      which lands in the OS Downloads folder. Still a real file on disk.
//
// A background write NEVER triggers a permission prompt: it only uses the
// folder when the permission is already "granted"; otherwise it degrades to
// a download. Picking the folder is always an explicit user action.
//
// Hygiene: only files matching our own naming pattern
// (`bookmarkforge-backup-*.bmf`) are ever pruned — nothing else in the
// chosen folder is touched.

import { logger } from "../utils/logger";
import { downloadBlobWithDetection } from "../utils/download";

declare global {
  interface Window {
    showDirectoryPicker(options?: {
      mode: "read" | "readwrite";
      startIn?:
        | "desktop"
        | "documents"
        | "downloads"
        | "music"
        | "pictures"
        | "videos";
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

const DB_NAME = "bmf-disk-backup";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const HANDLE_KEY = "backupFolder";

/** How many dated backup files to keep in the chosen folder (≈2 months daily). */
const MAX_BACKUP_FILES = 60;
const BACKUP_FILE_PREFIX = "bookmarkforge-backup-";

export interface BackupFolderInfo {
  /** Whether the File System Access API exists in this browser. */
  supported: boolean;
  /** Whether the user has chosen a folder. */
  configured: boolean;
  /** Folder name as reported by the browser (display only). */
  name?: string;
  /** "granted" | "prompt" | "denied" — undefined when not configured. */
  permission?: PermissionState;
}

export type DiskBackupResult =
  | { method: "folder"; name: string }
  | { method: "download"; name: string }
  | { method: "download-blocked"; name: string }
  | null;

export class DiskBackupService {
  /** In-memory handle (primary). Persistence to IndexedDB is best-effort. */
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  isSupported(): boolean {
    return (
      typeof window !== "undefined" && "showDirectoryPicker" in window
    );
  }

  /** Daily backup file name (date-only → same-day runs overwrite). */
  buildBackupFileName(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${BACKUP_FILE_PREFIX}${y}-${m}-${d}.bmf`;
  }

  /**
   * Explicit user action: open the folder picker and remember the choice.
   * Returns the picked folder name, or null when cancelled/unsupported.
   */
  async pickBackupFolder(): Promise<{ name: string } | null> {
    if (!this.isSupported()) {
      logger.warn("[DiskBackup] Folder picker not supported in this browser");
      return null;
    }
    try {
      const handle = await window.showDirectoryPicker({
        mode: "readwrite",
        startIn: "documents",
      });
      this.rootHandle = handle;
      try {
        await this.persistHandle(handle);
      } catch (persistError) {
        // The folder still works for this session; persistence failure only
        // means the user may need to re-pick it after a reload.
        logger.warn("[DiskBackup] Failed to persist folder handle", {
          error:
            persistError instanceof Error
              ? persistError.message
              : String(persistError),
        });
      }
      logger.info("[DiskBackup] Backup folder selected", { name: handle.name });
      return { name: handle.name };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return null; // user cancelled the picker
      }
      logger.warn("[DiskBackup] Folder picker failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Current folder configuration and permission state (no prompts). */
  async getBackupFolderInfo(): Promise<BackupFolderInfo> {
    if (!this.isSupported()) {
      return { supported: false, configured: false };
    }
    try {
      const handle = await this.getHandle();
      if (!handle) {
        return { supported: true, configured: false };
      }
      const permission = await handle.queryPermission({ mode: "readwrite" });
      return {
        supported: true,
        configured: true,
        name: handle.name,
        permission,
      };
    } catch (error) {
      logger.warn("[DiskBackup] Failed to read folder configuration", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { supported: true, configured: false };
    }
  }

  /** Forget the chosen folder (memory + persisted handle). */
  async clearBackupFolder(): Promise<void> {
    this.rootHandle = null;
    try {
      await this.deletePersistedHandle();
      logger.info("[DiskBackup] Backup folder cleared");
    } catch (error) {
      logger.warn("[DiskBackup] Failed to clear persisted folder handle", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Best-effort write of an ALREADY ENCRYPTED backup blob to the user's
   * disk. Returns the method used, or null when nothing could be written.
   * Never prompts: a folder whose permission is not "granted" degrades to a
   * download. Never throws — callers (the daily auto-backup) must not fail
   * because of a disk problem.
   */
  async writeBackupToDisk(
    blob: Blob,
    fileName: string,
  ): Promise<DiskBackupResult> {
    // Path 1: chosen folder (Chrome/Edge), only with an already-granted
    // readwrite permission.
    if (this.isSupported()) {
      try {
        const handle = await this.getHandle();
        if (handle) {
          const permission = await handle.queryPermission({
            mode: "readwrite",
          });
          if (permission === "granted") {
            await this.writeFileToFolder(handle, blob, fileName);
            await this.pruneOldBackups(handle);
            logger.info("[DiskBackup] Backup written to folder", {
              folder: handle.name,
              fileName,
            });
            return { method: "folder", name: handle.name };
          }
          if (permission === "denied") {
            logger.warn(
              "[DiskBackup] Folder permission denied — falling back to download",
            );
          }
          // "prompt": do not prompt from a background job — fall through.
        }
      } catch (error) {
        logger.warn(
          "[DiskBackup] Folder write failed — falling back to download",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    // Path 2: download fallback (Firefox/Safari + degraded folder).
    // Detect when the browser blocks the download because there is no
    // active user-gesture (common in auto-backup async callbacks).
    try {
      const result = await downloadBlobWithDetection(blob, fileName);
      if (result.blocked) {
        logger.warn(
          "[DiskBackup] Download blocked — browser requires user gesture",
          { fileName },
        );
        return {
          method: "download-blocked",
          name: fileName,
        } as DiskBackupResult;
      }
      logger.info("[DiskBackup] Backup written via download", { fileName });
      return { method: "download", name: fileName };
    } catch (error) {
      logger.warn("[DiskBackup] Download fallback failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async getHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (this.rootHandle) {return this.rootHandle;}
    try {
      const stored = await this.readPersistedHandle();
      if (
        stored &&
        typeof stored.name === "string" &&
        typeof stored.queryPermission === "function"
      ) {
        this.rootHandle = stored;
        return stored;
      }
      if (stored) {
        // Corrupted/legacy value (e.g. structured-cloned mock): drop it.
        logger.warn("[DiskBackup] Stored folder handle is unusable — dropping");
        await this.deletePersistedHandle();
      }
    } catch (error) {
      logger.warn("[DiskBackup] Failed to read persisted folder handle", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }

  private async writeFileToFolder(
    handle: FileSystemDirectoryHandle,
    blob: Blob,
    fileName: string,
  ): Promise<void> {
    const safeName = this.sanitizeFileName(fileName);
    const fileHandle = await handle.getFileHandle(safeName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
  }

  /** Keeps only the newest MAX_BACKUP_FILES dated backups (our prefix only). */
  private async pruneOldBackups(
    handle: FileSystemDirectoryHandle,
  ): Promise<void> {
    const names: string[] = [];
    for await (const entry of handle.values()) {
      if (
        entry.kind === "file" &&
        entry.name.startsWith(BACKUP_FILE_PREFIX) &&
        entry.name.endsWith(".bmf")
      ) {
        names.push(entry.name);
      }
    }
    // ISO date names sort lexicographically, oldest first.
    names.sort();
    const excess = names.length - MAX_BACKUP_FILES;
    for (let i = 0; i < excess; i++) {
      try {
        // i < excess <= names.length, so the index is in-bounds.
        await handle.removeEntry(names[i]!);
      } catch (error) {
        logger.warn("[DiskBackup] Failed to prune old backup file", {
          file: names[i],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (excess > 0) {
      logger.info(`[DiskBackup] Pruned ${excess} old backup file(s)`);
    }
  }

  /** Defensive: our names are generated, but never write outside the folder. */
  private sanitizeFileName(name: string): string {
    let cleaned = name
      .replace(/[/\\]/g, "_")
      .replace(/\.{2,}/g, "_")
      .replace(/^\.+/, "")
      // Block Windows-unsafe characters that cause download failures or path issues.
      .replace(/[*?:"<>|]/g, "_")
      .trim();
    cleaned = Array.from(cleaned)
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code >= 0x20 && code !== 0x7f;
      })
      .join("");
    const truncated = cleaned.slice(0, 200);
    return truncated.length > 0 ? truncated : "untitled";
  }

  // ── IndexedDB handle persistence (best-effort) ─────────────────────────

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) {return this.dbPromise;}
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open backup-handle DB"));
    });
    return this.dbPromise;
  }

  private async persistHandle(
    handle: FileSystemDirectoryHandle,
  ): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Failed to store folder handle"));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Folder handle transaction aborted"));
    });
  }

  private async readPersistedHandle(): Promise<FileSystemDirectoryHandle | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle) ?? null);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to read folder handle"));
    });
  }

  private async deletePersistedHandle(): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Failed to delete folder handle"));
    });
  }
}

export const diskBackupService = new DiskBackupService();
