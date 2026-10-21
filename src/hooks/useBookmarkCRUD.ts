import { useCallback, useEffect, useRef, useState } from "react";
import type { Bookmark, TranslationFunction } from "../types";
import type { BookmarkDocType } from "../db/schema";
import { initDB } from "../db/database";
import { bulkUpdate } from "../db/rxdb-optimized";
import { logger } from "../utils/logger";
import { sanitizeUrl } from "../services/SanitizationService";
import { generateId } from "../utils/id";
import { hashString } from "../utils/crypto-core";

const MAX_HTML_IMPORT_BYTES = 50 * 1024 * 1024;
const MAX_HTML_IMPORT_LINKS = 100_000;
const MAX_IMPORTED_TITLE_LENGTH = 500;

/**
 * Handles all bookmark CRUD operations:
 * - Single-item: delete, addTag, removeTag, clearTags
 * - Bulk: delete, addTag, removeTag, clearTags
 * - Import: HTML file import
 */
export function useBookmarkCRUD(t: TranslationFunction) {
  const [isImporting, setIsImporting] = useState(false);
  const importRequestRef = useRef(0);
  const importInFlightRef = useRef(false);
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
      return;
    }
    const filename = file.name?.toLowerCase() ?? "";
    if (!filename.endsWith(".html") && !filename.endsWith(".htm")) {
      logger.warn("HTML import rejected: unsupported extension");
      return;
    }

    importInFlightRef.current = true;
    const requestId = ++importRequestRef.current;
    setIsImporting(true);
    try {
      const text = await file.text();
      if (text.length > MAX_HTML_IMPORT_BYTES) {
        logger.warn("HTML import rejected: content too large", {
          maxSize: MAX_HTML_IMPORT_BYTES,
        });
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
        return;
      }

      const db = await initDB();
      const bookmarksToInsert: Bookmark[] = [];
      const seenUrls = new Set<string>();
      for (const link of links) {
        const rawUrl = link.getAttribute("href")?.trim() ?? "";
        if (!/^https?:\/\//i.test(rawUrl)) {continue;}

        const sanitizedUrl = sanitizeUrl(rawUrl);
        if (!sanitizedUrl || seenUrls.has(sanitizedUrl)) {continue;}
        const urlHash = await hashString(sanitizedUrl);
        const existing = await db.bookmarks
          .findOne({ selector: { urlHash } })
          .exec();
        if (existing) {continue;}
        seenUrls.add(sanitizedUrl);

        const rawTitle = (link.textContent || sanitizedUrl).trim();
        bookmarksToInsert.push({
          id: generateId(),
          url: sanitizedUrl,
          urlHash,
          title: rawTitle.slice(0, MAX_IMPORTED_TITLE_LENGTH),
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
      }
      if (bookmarksToInsert.length > 0) {
        await db.bookmarks.bulkInsert(bookmarksToInsert);
      }
    } catch (error) {
      logger.error("Error importing HTML", { error });
    } finally {
      if (requestId === importRequestRef.current) {
        importInFlightRef.current = false;
        if (isMountedRef.current) {
          setIsImporting(false);
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
    isImporting,
  };
}
