/**
 * watchedFolder.ts — local-folder watch (File System Access API).
 *
 * Chromium-only progressive enhancement: the user picks a folder once, the
 * FileSystemDirectoryHandle persists in IndexedDB, and a manual/periodic
 * scan imports new .md/.txt/.html files as encrypted documents. Dedup is by
 * content hash of path+size+mtime, kept in localStorage (metadata only —
 * never file contents). PDFs are counted but skipped: text extraction lives
 * in the Pro pipeline.
 *
 * There is no passive file-watching without an extension — scans run when
 * the app shell mounts and when the window regains focus.
 */
import { initDB } from "../../container/database";
import { generateId } from "../../utils/id";
import { hashString } from "../../utils/crypto-core";
import { safeGet, safeSet } from "../../store/safeStorage";
import { logger } from "../../utils/logger";

const IDB_NAME = "bmf-watched-folder";
const STORE_NAME = "handles";
const HANDLE_KEY = "watchedFolder";
const SEEN_KEY = "watched_folder_seen";
const MAX_SEEN = 5000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;
const IMPORT_EXTENSIONS = new Set([".md", ".txt", ".html", ".htm"]);

export interface WatchedFolderInfo {
  supported: boolean;
  configured: boolean;
  name?: string;
  permission?: PermissionState;
}

export interface WatchedFolderScanResult {
  imported: number;
  skippedDuplicates: number;
  skippedUnsupported: number;
  failed: number;
}

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "showDirectoryPicker" in window &&
    typeof indexedDB !== "undefined"
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("watched-folder idb open failed"));
  });
}

async function readHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    request.onsuccess = () =>
      resolve((request.result as FileSystemDirectoryHandle) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function writeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearHandle(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function loadSeen(): Set<string> {
  try {
    const raw = safeGet(SEEN_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>): void {
  const arr = [...seen];
  safeSet(SEEN_KEY, JSON.stringify(arr.slice(-MAX_SEEN)));
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/** Strip tags/scripts from .html so the vault stores readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function readFileText(file: File): Promise<string> {
  const ext = fileExtension(file.name);
  const raw = await file.text();
  const text = ext === ".html" || ext === ".htm" ? htmlToText(raw) : raw;
  return text.slice(0, MAX_TEXT_CHARS);
}

class WatchedFolderService {
  private handle: FileSystemDirectoryHandle | null = null;

  isSupported(): boolean {
    return isSupported();
  }

  async pickFolder(): Promise<{ name: string } | null> {
    if (!isSupported()) {
      return null;
    }
    try {
      const handle = await window.showDirectoryPicker({
        mode: "read",
        startIn: "documents",
      });
      this.handle = handle;
      try {
        await writeHandle(handle);
      } catch (error) {
        logger.warn("[WatchedFolder] Failed to persist handle", { error });
      }
      return { name: handle.name };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return null;
      }
      logger.warn("[WatchedFolder] Folder picker failed", { error });
      return null;
    }
  }

  async clearFolder(): Promise<void> {
    this.handle = null;
    await clearHandle();
  }

  async getInfo(): Promise<WatchedFolderInfo> {
    if (!isSupported()) {
      return { supported: false, configured: false };
    }
    const handle = this.handle ?? (await this.getHandle());
    if (!handle) {
      return { supported: true, configured: false };
    }
    const permission = await handle.queryPermission({ mode: "read" });
    return {
      supported: true,
      configured: true,
      name: handle.name,
      permission,
    };
  }

  private async getHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (this.handle) {
      return this.handle;
    }
    try {
      const stored = await readHandle();
      if (
        stored &&
        typeof stored.name === "string" &&
        typeof stored.queryPermission === "function"
      ) {
        this.handle = stored;
        return stored;
      }
    } catch (error) {
      logger.warn("[WatchedFolder] Failed to read persisted handle", {
        error,
      });
    }
    return null;
  }

  /**
   * Scan the watched folder and import new supported files as documents.
   * Safe to call repeatedly — already-seen files are skipped by hash.
   */
  async scan(): Promise<WatchedFolderScanResult> {
    const result: WatchedFolderScanResult = {
      imported: 0,
      skippedDuplicates: 0,
      skippedUnsupported: 0,
      failed: 0,
    };
    const handle = await this.getHandle();
    if (!handle) {
      return result;
    }
    const permission = await handle.requestPermission({ mode: "read" });
    if (permission !== "granted") {
      logger.info("[WatchedFolder] Permission not granted", { permission });
      return result;
    }

    const seen = loadSeen();
    const db = await initDB();
    const candidates: Array<{ entry: FileSystemFileHandle; file: File }> = [];

    for await (const entry of handle.values()) {
      if (entry.kind !== "file") {
        continue;
      }
      const ext = fileExtension(entry.name);
      if (ext === ".pdf") {
        result.skippedUnsupported++;
        continue;
      }
      if (!IMPORT_EXTENSIONS.has(ext)) {
        result.skippedUnsupported++;
        continue;
      }
      try {
        const file = await entry.getFile();
        if (file.size > MAX_FILE_BYTES) {
          result.skippedUnsupported++;
          continue;
        }
        candidates.push({ entry, file });
      } catch {
        result.failed++;
      }
    }

    for (const { entry, file } of candidates) {
      const fingerprint = await hashString(
        `${entry.name}:${file.size}:${file.lastModified}`,
      );
      if (seen.has(fingerprint)) {
        result.skippedDuplicates++;
        continue;
      }
      try {
        const text = await readFileText(file);
        if (!text.trim()) {
          seen.add(fingerprint);
          result.skippedDuplicates++;
          continue;
        }
        const documentId = generateId();
        const title = file.name.replace(/\.[^.]+$/, "") || file.name;
        await db.documents.insert({
          id: documentId,
          folderId: "root",
          title,
          blocks: [
            {
              type: "paragraph",
              content: text.slice(0, 50_000),
            },
          ],
          textContent: text,
          tags: ["imported", "watched-folder"],
          links: [],
          embedding: [],
          processed: false,
          isPrivate: false,
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        seen.add(fingerprint);
        result.imported++;
      } catch (error) {
        logger.warn("[WatchedFolder] Import failed", {
          name: entry.name,
          error,
        });
        result.failed++;
      }
    }

    saveSeen(seen);
    return result;
  }
}

export const watchedFolderService = new WatchedFolderService();
