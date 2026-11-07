import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Bookmark, TranslationFunction } from "../types";
import type { BookmarkDocType } from "../db/schema";
import { initDB } from "../container/database";
import { bulkUpdate } from "../services/bookmarkBulkService";
import { logger } from "../utils/logger";
import { sanitizeUrl } from "../services/SanitizationService";
import { generateId } from "../utils/id";
import { hashString } from "../utils/crypto-core";

const MAX_HTML_IMPORT_BYTES = 50 * 1024 * 1024;
const MAX_HTML_IMPORT_LINKS = 100_000;
const MAX_IMPORTED_TITLE_LENGTH = 500;
/**
 * Links processed per batch (hash + existence query + insert). Batching keeps
 * the import off the critical path: each batch ends with a macrotask yield so
 * the UI can paint progress and handle cancellation between batches, instead
 * of one unbroken sequential pass over up to 100k links (audit M-10).
 */
const HTML_IMPORT_BATCH_SIZE = 200;

/**
 * Handles all bookmark CRUD operations:
 * - Single-item: delete, addTag, removeTag, clearTags
 * - Bulk: delete, addTag, removeTag, clearTags
 * - Import: HTML file import
 */
export function useBookmarkCRUD(t: TranslationFunction) {
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);
  const importRequestRef = useRef(0);
  const importInFlightRef = useRef(false);
  const importCancelRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      importRequestRef.current += 1;
      importInFlightRef.current = false;
    };
  }, []);

  // --- Single-item CRUD ---

  // All handlers depend only on module functions or `t`:
  // useCallback with stable deps so the memoized BookmarksTable rows do
  // not re-render on every parent state change.
  const handleDelete = useCallback(async (id: string) => {
    try {
      const db = await initDB();
      const doc = await db.bookmarks.findOne(id).exec();
      if (doc) {
        await doc.incrementalPatch({
          isDeleted: true,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.error("Failed to delete bookmark", { error: err });
    }
  }, []);

  const handleAddTag = useCallback(async (bookmark: Bookmark, tag: string) => {
    if (!tag.trim()) {return;}
    try {
      const db = await initDB();
      const doc = await db.bookmarks.findOne(bookmark.id).exec();
      if (doc) {
        const currentTags = doc.tags || [];
        if (!currentTags.includes(tag.trim())) {
          await doc.incrementalPatch({
            tags: [...currentTags, tag.trim()],
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      logger.error("Failed to add tag", { error: err });
    }
  }, []);

  const handleRemoveTag = useCallback(async (bookmark: Bookmark, tag: string) => {
    if (!tag.trim()) {return;}
    try {
      const db = await initDB();
      const doc = await db.bookmarks.findOne(bookmark.id).exec();
      if (doc) {
        const currentTags = doc.tags || [];
        await doc.incrementalPatch({
          tags: currentTags.filter((t: string) => t !== tag.trim()),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.error("Failed to remove tag", { error: err });
    }
  }, []);

  const handleClearTags = useCallback(async (bookmark: Bookmark) => {
    try {
      const db = await initDB();
      const doc = await db.bookmarks.findOne(bookmark.id).exec();
      if (doc) {
        await doc.incrementalPatch({
          tags: [],
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.error("Failed to clear tags", { error: err });
    }
  }, []);

  const handleUpdateTitle = useCallback(async (id: string, title: string) => {
    if (!title.trim()) {
      return;
    }
    try {
      const db = await initDB();
      const doc = await db.bookmarks.findOne(id).exec();
      if (doc) {
        await doc.incrementalPatch({
          title: title.trim(),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.error("Failed to update bookmark title", { error: err });
    }
  }, []);

  // --- Bulk CRUD ---

  const handleBulkDelete = useCallback(async (ids: Set<string>) => {
    try {
      const db = await initDB();
      const now = new Date().toISOString();
      await bulkUpdate(
        db.bookmarks,
        Array.from(ids).map((id) => ({
          id,
          data: {
            isDeleted: true,
            updatedAt: now,
          } as Partial<BookmarkDocType>,
        })),
      );
    } catch (err) {
      logger.error("Bulk delete failed", { error: err });
    }
  }, []);

  const handleBulkAddTag = useCallback(async (tag: string, ids: Set<string>) => {
    if (!tag.trim()) {return;}
    try {
      const db = await initDB();
      const trimmedTag = tag.trim();
      const docs = await db.bookmarks
        .find({ selector: { id: { $in: Array.from(ids) } } })
        .exec();
      for (const doc of docs) {
        const currentTags = doc.tags || [];
        if (!currentTags.includes(trimmedTag)) {
          await doc.incrementalPatch({
            tags: [...currentTags, trimmedTag],
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      logger.error("Bulk add tag failed", { error: err });
    }
  }, []);

  const handleBulkRemoveTag = useCallback(async (tag: string, ids: Set<string>) => {
    if (!tag.trim()) {return;}
    try {
      const db = await initDB();
      const trimmedTag = tag.trim();
      const docs = await db.bookmarks
        .find({ selector: { id: { $in: Array.from(ids) } } })
        .exec();
      for (const doc of docs) {
        const currentTags = doc.tags || [];
        if (currentTags.includes(trimmedTag)) {
          await doc.incrementalPatch({
            tags: currentTags.filter((t: string) => t !== trimmedTag),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      logger.error("Bulk remove tag failed", { error: err });
    }
  }, []);

  const handleBulkClearTags = useCallback(async (ids: Set<string>) => {
    try {
      const db = await initDB();
      const docs = await db.bookmarks
        .find({ selector: { id: { $in: Array.from(ids) } } })
        .exec();
      for (const doc of docs) {
        await doc.incrementalPatch({
          tags: [],
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.error("Bulk clear tags failed", { error: err });
    }
  }, []);

  // --- Import ---

  /** Stops the in-flight HTML import between batches. Already-inserted
   * batches stay in the database; re-importing is safe because dedupe is by
   * url hash. */
  const handleCancelImport = useCallback(() => {
    if (importInFlightRef.current) {
      importCancelRef.current = true;
    }
  }, []);

  const handleImportHTML = useCallback(async (file: File) => {
    if (importInFlightRef.current) {return;}
    if (!file || typeof file.text !== "function") {
      logger.warn("HTML import rejected: invalid file");
      return;
    }
    if (
      Number.isFinite(file.size) &&
      file.size > MAX_HTML_IMPORT_BYTES
    ) {
      logger.warn("HTML import rejected: file too large", {
        size: file.size,
        maxSize: MAX_HTML_IMPORT_BYTES,
      });
      toast.error(
        t("app_importFileTooLarge", {
          max: MAX_HTML_IMPORT_BYTES / (1024 * 1024),
        }),
      );
      return;
    }
    const filename = file.name?.toLowerCase() ?? "";
    if (!filename.endsWith(".html") && !filename.endsWith(".htm")) {
      logger.warn("HTML import rejected: unsupported extension");
      return;
    }

    importInFlightRef.current = true;
    importCancelRef.current = false;
    const requestId = ++importRequestRef.current;
    setIsImporting(true);
    setImportProgress(null);
    try {
      const text = await file.text();
      if (text.length > MAX_HTML_IMPORT_BYTES) {
        logger.warn("HTML import rejected: content too large", {
          maxSize: MAX_HTML_IMPORT_BYTES,
        });
        toast.error(
          t("app_importFileTooLarge", {
            max: MAX_HTML_IMPORT_BYTES / (1024 * 1024),
          }),
        );
        return;
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "text/html");
      const links = Array.from(doc.querySelectorAll("a"));
      if (links.length > MAX_HTML_IMPORT_LINKS) {
        logger.warn("HTML import rejected: too many links", {
          linkCount: links.length,
          maxLinks: MAX_HTML_IMPORT_LINKS,
        });
        toast.error(
          t("app_importTooManyLinks", {
            links: links.length,
            max: MAX_HTML_IMPORT_LINKS,
          }),
        );
        return;
      }

      const db = await initDB();
      const total = links.length;
      setImportProgress({ processed: 0, total });
      const seenUrls = new Set<string>();
      let lastReportedPercent = 0;
      for (let start = 0; start < total; start += HTML_IMPORT_BATCH_SIZE) {
        // Cancelled (user or unmount/newer request): stop between batches.
        if (importCancelRef.current || requestId !== importRequestRef.current) {
          break;
        }
        const slice = links.slice(start, start + HTML_IMPORT_BATCH_SIZE);

        // Sanitize + dedupe within the batch (sync, cheap).
        const candidates: { url: string; title: string }[] = [];
        for (const link of slice) {
          const rawUrl = link.getAttribute("href")?.trim() ?? "";
          if (!/^https?:\/\//i.test(rawUrl)) {continue;}
          const sanitizedUrl = sanitizeUrl(rawUrl);
          if (!sanitizedUrl || seenUrls.has(sanitizedUrl)) {continue;}
          seenUrls.add(sanitizedUrl);
          candidates.push({
            url: sanitizedUrl,
            title: (link.textContent || sanitizedUrl).trim(),
          });
        }

        if (candidates.length > 0) {
          const urlHashes = await Promise.all(
            candidates.map((candidate) => hashString(candidate.url)),
          );
          // One existence query per batch instead of one round-trip per link.
          const existingDocs = await db.bookmarks
            .find({ selector: { urlHash: { $in: urlHashes } } })
            .exec();
          // A4: stored urlHash is a per-vault keyed HMAC — it cannot be
          // compared against the plain SHA-256 candidates. The decrypted
          // `url` is the same identity the hash was computed from, so URL
          // equality is the equivalent dedup check.
          const existingUrls = new Set(existingDocs.map((row) => row.url));
          const bookmarksToInsert: Bookmark[] = [];
          candidates.forEach((candidate, index) => {
            // parallel array: one hash per candidate, same length
            const urlHash = urlHashes[index]!;
            if (existingUrls.has(candidate.url)) {return;}
            bookmarksToInsert.push({
              id: generateId(),
              url: candidate.url,
              urlHash,
              title: candidate.title.slice(0, MAX_IMPORTED_TITLE_LENGTH),
              content: t("importedFromBrowser"),
              summary: "",
              tags: [],
              processed: false,
              isPrivate: false,
              isDeleted: false,
              relatedLinks: [],
              embedding: [],
              visitCount: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          });
          if (bookmarksToInsert.length > 0) {
            await db.bookmarks.bulkInsert(bookmarksToInsert);
          }
        }

        const processed = Math.min(start + slice.length, total);
        const percent = total > 0 ? Math.floor((processed / total) * 100) : 100;
        if (percent !== lastReportedPercent) {
          lastReportedPercent = percent;
          setImportProgress({ processed, total });
        }
        // Macrotask yield: lets the UI paint the progress and process the
        // cancel click before the next batch starts.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      logger.error("Error importing HTML", { error });
    } finally {
      if (requestId === importRequestRef.current) {
        importInFlightRef.current = false;
        if (isMountedRef.current) {
          setIsImporting(false);
          setImportProgress(null);
        }
      }
    }
  }, [t]);

  return {
    handleDelete,
    handleAddTag,
    handleRemoveTag,
    handleClearTags,
    handleUpdateTitle,
    handleBulkDelete,
    handleBulkAddTag,
    handleBulkRemoveTag,
    handleBulkClearTags,
    handleImportHTML,
    handleCancelImport,
    isImporting,
    importProgress,
  };
}
