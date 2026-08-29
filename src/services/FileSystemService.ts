import { generateId } from "../utils/id";
import type { DocumentDocument, BookmarkForgeDB } from "../db/types";
import type { DocumentDocType } from "../db/schema";
import { logger } from "../utils/logger";

declare global {
  interface Window {
    showDirectoryPicker(options?: {
      mode: "read" | "readwrite";
      startIn?:
        "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
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

  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<
      FileSystemFileHandle | FileSystemDirectoryHandle
    >;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
    getDirectoryHandle(
      name: string,
      options?: { create?: boolean },
    ): Promise<FileSystemDirectoryHandle>;
  }
}

/**
 * FileSystemService - Handles interaction with the local file system
 * using the File System Access API (PWA-only).
 */
export class FileSystemService {
  private static readonly MAX_MARKDOWN_FILES = 10_000;
  private static readonly MAX_MARKDOWN_FILE_BYTES = 10 * 1024 * 1024;
  private rootHandle: FileSystemDirectoryHandle | null = null;

  /**
   * Checks if the File System Access API is supported by the browser.
   */
  isSupported(): boolean {
    return "showDirectoryPicker" in window;
  }

  /**
   * Checks if the application is running inside an iframe.
   * The File System Access API is restricted in cross-origin iframes.
   */
  isInIframe(): boolean {
    try {
      return window.self !== window.top;
    } catch (_err) {
      return true;
    }
  }

  /**
   * Requests permission to access a local directory.
   */
  async requestDirectoryAccess(): Promise<boolean> {
    if (!this.isSupported()) {
      logger.error("File System Access API is not supported.");
      return false;
    }

    if (this.rootHandle) {
      try {
        const permission = await this.rootHandle.queryPermission({
          mode: "readwrite",
        });
        if (permission === "granted") {
          return true;
        }
        const request = await this.rootHandle.requestPermission({
          mode: "readwrite",
        });
        return request === "granted";
      } catch (err) {
        logger.warn(
          "Error checking/requesting permission, falling back to picker:",
          err,
        );
      }
    }

    try {
      this.rootHandle = await window.showDirectoryPicker({
        mode: "readwrite",
      });
      return true;
    } catch (err) {
      logger.error("Error accessing directory", { error: err });
      return false;
    }
  }

  /**
   * Reads all markdown files from the selected directory.
   */
  async readMarkdownFiles(): Promise<{ name: string; content: string }[]> {
    if (!this.rootHandle) {
      throw new Error("No directory access");
    }

    const files: { name: string; content: string }[] = [];
    let markdownFileCount = 0;
    for await (const entry of this.rootHandle.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".md")) {
        markdownFileCount++;
        if (markdownFileCount > FileSystemService.MAX_MARKDOWN_FILES) {
          throw new Error(
            `Markdown directory exceeds the limit of ${FileSystemService.MAX_MARKDOWN_FILES} files`,
          );
        }
        const file = await entry.getFile();
        if (
          typeof file.size === "number" &&
          file.size > FileSystemService.MAX_MARKDOWN_FILE_BYTES
        ) {
          throw new Error(
            `Markdown file "${entry.name}" exceeds the ${FileSystemService.MAX_MARKDOWN_FILE_BYTES / 1024 / 1024} MB limit`,
          );
        }
        const content = await file.text();
        files.push({ name: entry.name, content });
      }
    }
    return files;
  }

  /**
   * Reads all markdown files plus their `lastModified` timestamp (needed by
   * FolderSyncService as the file side's conflict clock).
   */
  async readMarkdownFilesWithMeta(): Promise<
    { name: string; content: string; lastModified: number }[]
  > {
    if (!this.rootHandle) {
      throw new Error("No directory access");
    }

    const files: { name: string; content: string; lastModified: number }[] = [];
    let markdownFileCount = 0;
    for await (const entry of this.rootHandle.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".md")) {
        markdownFileCount++;
        if (markdownFileCount > FileSystemService.MAX_MARKDOWN_FILES) {
          throw new Error(
            `Markdown directory exceeds the limit of ${FileSystemService.MAX_MARKDOWN_FILES} files`,
          );
        }
        const file = await entry.getFile();
        if (
          typeof file.size === "number" &&
          file.size > FileSystemService.MAX_MARKDOWN_FILE_BYTES
        ) {
          throw new Error(
            `Markdown file "${entry.name}" exceeds the ${FileSystemService.MAX_MARKDOWN_FILE_BYTES / 1024 / 1024} MB limit`,
          );
        }
        const content = await file.text();
        files.push({
          name: entry.name,
          content,
          lastModified:
            typeof file.lastModified === "number" ? file.lastModified : 0,
        });
      }
    }
    return files;
  }

  /**
   * Removes a markdown file from the selected directory. Fails silently on
   * an unknown name (a file that was already removed is a converged state).
   */
  async removeMarkdownFile(name: string): Promise<void> {
    if (!this.rootHandle) {
      throw new Error("No directory access");
    }
    const safeName = this.sanitizeFileName(name);
    try {
      await this.rootHandle.removeEntry(safeName);
    } catch (err) {
      logger.warn(`[FolderSync] could not remove "${safeName}"`, err);
    }
  }

  /**
   * Reads binary attachment files from the `attachments/` subdirectory.
   * Returns an empty list when the subdirectory does not exist yet.
   */
  async readAttachmentFiles(): Promise<
    { name: string; bytes: Uint8Array }[]
  > {
    if (!this.rootHandle) {
      throw new Error("No directory access");
    }
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await this.rootHandle.getDirectoryHandle("attachments");
    } catch {
      return [];
    }
    const files: { name: string; bytes: Uint8Array }[] = [];
    for await (const entry of dir.values()) {
      if (entry.kind !== "file") {continue;}
      const file = await entry.getFile();
      if (file.size > FileSystemService.MAX_MARKDOWN_FILE_BYTES) {
        throw new Error(
          `Attachment "${entry.name}" exceeds the ${FileSystemService.MAX_MARKDOWN_FILE_BYTES / 1024 / 1024} MB limit`,
        );
      }
      files.push({
        name: entry.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }
    return files;
  }

  /**
   * Writes a binary attachment into the `attachments/` subdirectory,
   * creating the subdirectory on first use.
   */
  async writeAttachmentFile(name: string, bytes: Uint8Array): Promise<void> {
    if (!this.rootHandle) {
      throw new Error("No directory access");
    }
    const safeName = this.sanitizeFileName(name);
    const dir = await this.rootHandle.getDirectoryHandle("attachments", {
      create: true,
    });
    const fileHandle = await dir.getFileHandle(safeName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([bytes as unknown as BlobPart]));
    await writable.close();
  }

  /** Removes an attachment file (no-op when the subdirectory is absent). */
  async removeAttachmentFile(name: string): Promise<void> {
    if (!this.rootHandle) {
      throw new Error("No directory access");
    }
    try {
      const dir = await this.rootHandle.getDirectoryHandle("attachments");
      await dir.removeEntry(this.sanitizeFileName(name));
    } catch (err) {
      logger.warn(
        `[FolderSync] could not remove attachment "${name}"`,
        err,
      );
    }
  }

  /**
   * Sanitizes a file name so it cannot escape the granted directory
   * (strips path separators, "..", leading dots, and control characters).
   */
  private sanitizeFileName(name: string): string {
    let cleaned = name
      .replace(/[/\\]/g, "_")
      .replace(/\.{2,}/g, "_")
      .replace(/^\.+/, "")
      .trim();
    // Remove control characters (0x00-0x1f and 0x7f) without using a literal
    // control-char range in the regex.
    cleaned = Array.from(cleaned)
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code >= 0x20 && code !== 0x7f;
      })
      .join("");
    const truncated = cleaned.slice(0, 200);
    return truncated.length > 0 ? truncated : "untitled";
  }

  /**
   * Writes content to a file in the selected directory.
   */
  async writeMarkdownFile(name: string, content: string): Promise<void> {
    if (!this.rootHandle) {
      throw new Error("No directory access");
    }

    const safeName = this.sanitizeFileName(name);
    const contentBytes = new TextEncoder().encode(content).byteLength;
    if (contentBytes > FileSystemService.MAX_MARKDOWN_FILE_BYTES) {
      throw new Error(
        `Markdown content exceeds the ${FileSystemService.MAX_MARKDOWN_FILE_BYTES / 1024 / 1024} MB limit`,
      );
    }
    const fileHandle = await this.rootHandle.getFileHandle(safeName, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  /**
   * Synchronizes local markdown files with RxDB.
   *
   * @param db The RxDB instance.
   */
  async syncFiles(db: BookmarkForgeDB): Promise<void> {
    const files = await this.readMarkdownFiles();

    const existingDocs: DocumentDocument[] = await db.documents
      .find({
        selector: { tags: { $elemMatch: { $eq: "imported" } } },
      })
      .exec();

    const stripMd = (s: string) => s.replace(/\.md$/i, "");
    const existingDocsMap = new Map(
      existingDocs.map((doc) => [stripMd(doc.title), doc]),
    );
    const newDocs: DocumentDocType[] = [];
    const updatedDocs: {
      doc: DocumentDocument;
      patch: Record<string, unknown>;
    }[] = [];

    for (const file of files) {
      const existing = existingDocsMap.get(stripMd(file.name));
      if (existing) {
        if (existing.textContent !== file.content) {
          updatedDocs.push({
            doc: existing,
            patch: {
              textContent: file.content,
              processed: false,
              updatedAt: new Date().toISOString(),
            },
          });
        }
        existingDocsMap.delete(stripMd(file.name));
      } else {
        newDocs.push({
          id: generateId(),
          folderId: "root",
          title: file.name,
          blocks: [],
          textContent: file.content,
          summary: "",
          tags: ["imported"],
          links: [],
          embedding: [],
          processed: false,
          isPrivate: false,
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    if (newDocs.length > 0) {
      await db.documents.bulkInsert(newDocs);
      logger.info(`[FileSystemSync] Inserted ${newDocs.length} new files.`);
    }

    for (const update of updatedDocs) {
      await update.doc.incrementalPatch(update.patch);
    }
    if (updatedDocs.length > 0) {
      logger.info(`[FileSystemSync] Updated ${updatedDocs.length} files.`);
    }

    const docsToRemove = Array.from(existingDocsMap.values());
    for (const doc of docsToRemove) {
      await doc.remove();
    }
    if (docsToRemove.length > 0) {
      logger.info(
        `[FileSystemSync] Removed ${docsToRemove.length} obsolete files.`,
      );
    }
  }
}

export const fileSystemService = new FileSystemService();
