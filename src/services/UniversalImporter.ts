import type { BookmarkForgeDB } from "../db/types";
import type {
  BookmarkDocType,
  DocumentDocType,
  FolderDocType,
} from "../db/schema";
import { logger } from "../utils/logger";
import { generateId } from "../utils/id";
import { hashString } from "../utils/crypto-core";
import {
  sanitizeTags,
  sanitizeUserInput,
  sanitizeUrl,
} from "./SanitizationService";
import { SanitizationService } from "./SanitizationService";
import { isFreeLimitError } from "./LicenseService";
import { STORAGE_KEYS } from "../constants/storage-keys";
import JSZip from "jszip";
import { attachmentStore } from "./documentAttachments";
import {
  isAttachmentPath,
  isMarkdownFilePath,
  mimeFromFilename,
  normalizeAttachmentRefPath,
  parseMarkdownNote,
  rewriteAttachmentRef,
  sanitizeFolderPath,
  type MarkdownLink,
  type ParsedMarkdownNote,
} from "./importer.markdown";

interface ImportResult {
  success: boolean;
  importedCount: number;
  skippedCount: number;
  error?: string;
  rollbackIncomplete?: boolean;
  /** True when the Free-tier wall stopped the import after a partial save. */
  limitReached?: boolean;
}

interface RollbackResult {
  completed: boolean;
}

interface ImportJournal {
  bookmarkIds: string[];
  documentIds: string[];
  folderIds: string[];
}

type CSVRecordSource = Iterable<string> | AsyncIterable<string>;

export interface ImportOptions {
  /** Abort parsing and database writes for a closing/cancelled import. */
  signal?: AbortSignal;
  /** Progress callback in the inclusive range 0..100. */
  onProgress?: (progress: number) => void;
}

type ImportExecutionOptions = ImportOptions & {
  journal: ImportJournal;
  recordsSeen: number;
  importedCount: number;
};

/** Internal control-flow error: a limit is a partial, honest result, not a rollback. */
class FreeTierImportLimitReached extends Error {
  constructor(
    readonly importedCount: number,
    readonly skippedCount: number,
  ) {
    super("FREE_LIMIT_REACHED");
    this.name = "FreeTierImportLimitReached";
  }
}

function createImportExecutionOptions(
  options: ImportOptions,
): ImportExecutionOptions {
  return {
    ...options,
    journal: createImportJournal(),
    recordsSeen: 0,
    importedCount: 0,
  };
}

function createImportJournal(): ImportJournal {
  return { bookmarkIds: [], documentIds: [], folderIds: [] };
}

const PENDING_ROLLBACK_STORAGE_KEY = STORAGE_KEYS.PENDING_IMPORT_ROLLBACK;
const PENDING_ROLLBACK_VERSION = 2;
const PENDING_ROLLBACK_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STORED_ROLLBACK_IDS = 100_000;

function isRollbackIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_STORED_ROLLBACK_IDS &&
    value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200)
  );
}

function loadPendingRollback(): ImportJournal | null {
  if (typeof sessionStorage === "undefined") {return null;}
  try {
    const raw = sessionStorage.getItem(PENDING_ROLLBACK_STORAGE_KEY);
    if (!raw) {return null;}
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      sessionStorage.removeItem(PENDING_ROLLBACK_STORAGE_KEY);
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const createdAt = record.createdAt;
    const age = typeof createdAt === "number" ? Date.now() - createdAt : Infinity;
    if (
      record.version !== PENDING_ROLLBACK_VERSION ||
      !Number.isFinite(createdAt) ||
      age < 0 ||
      age > PENDING_ROLLBACK_TTL_MS ||
      !isRollbackIdList(record.bookmarkIds) ||
      !isRollbackIdList(record.documentIds) ||
      !isRollbackIdList(record.folderIds) ||
      (record.bookmarkIds as string[]).length +
        (record.documentIds as string[]).length +
        (record.folderIds as string[]).length >
        MAX_STORED_ROLLBACK_IDS
    ) {
      sessionStorage.removeItem(PENDING_ROLLBACK_STORAGE_KEY);
      return null;
    }
    return {
      bookmarkIds: record.bookmarkIds as string[],
      documentIds: record.documentIds as string[],
      folderIds: record.folderIds as string[],
    };
  } catch {
    return null;
  }
}

function persistPendingRollback(journal: ImportJournal): void {
  if (typeof sessionStorage === "undefined") {return;}
  try {
    sessionStorage.setItem(
      PENDING_ROLLBACK_STORAGE_KEY,
      JSON.stringify({
        version: PENDING_ROLLBACK_VERSION,
        createdAt: Date.now(),
        bookmarkIds: journal.bookmarkIds,
        documentIds: journal.documentIds,
        folderIds: journal.folderIds,
      }),
    );
  } catch {
    // Memory fallback remains active for this page if sessionStorage is unavailable.
  }
}

function clearPersistedRollback(): void {
  if (typeof sessionStorage === "undefined") {return;}
  try {
    sessionStorage.removeItem(PENDING_ROLLBACK_STORAGE_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}

const ROLLBACK_BATCH_SIZE = 500;
const ROLLBACK_TIMEOUT_MS = 30_000;

async function yieldRollbackBatch(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function rollbackImport(
  db: BookmarkForgeDB,
  journal: ImportJournal,
): Promise<RollbackResult> {
  let bookmarkError: unknown;
  let documentError: unknown;
  const deadline = Date.now() + ROLLBACK_TIMEOUT_MS;
  for (
    let start = 0;
    start < journal.bookmarkIds.length;
    start += ROLLBACK_BATCH_SIZE
  ) {
    if (Date.now() >= deadline) {
      bookmarkError ??= new Error("Bookmark rollback timed out");
      break;
    }
    const ids = journal.bookmarkIds.slice(start, start + ROLLBACK_BATCH_SIZE);
    try {
      const bookmarks = await db.bookmarks
        .find({ selector: { id: { $in: ids } } })
        .exec();
      if (bookmarks.length > 0) {
        await db.bookmarks.bulkRemove(bookmarks);
      }
      await yieldRollbackBatch();
    } catch (error) {
      bookmarkError ??= error;
    }
  }
  for (
    let start = 0;
    start < journal.documentIds.length;
    start += ROLLBACK_BATCH_SIZE
  ) {
    if (Date.now() >= deadline) {
      documentError ??= new Error("Document rollback timed out");
      break;
    }
    const ids = journal.documentIds.slice(start, start + ROLLBACK_BATCH_SIZE);
    try {
      const documents = await db.documents
        .find({ selector: { id: { $in: ids } } })
        .exec();
      if (documents.length > 0) {
        await db.documents.bulkRemove(documents);
      }
      await yieldRollbackBatch();
    } catch (error) {
      documentError ??= error;
    }
  }
  if (bookmarkError || documentError) {
    logger.error("[UniversalImporter] Rollback failed", {
      bookmarkError:
        bookmarkError instanceof Error
          ? bookmarkError.message
          : bookmarkError
            ? String(bookmarkError)
            : undefined,
      documentError:
        documentError instanceof Error
          ? documentError.message
          : documentError
            ? String(documentError)
            : undefined,
      bookmarkCount: journal.bookmarkIds.length,
      documentCount: journal.documentIds.length,
      folderCount: journal.folderIds.length,
    });
  }
  let folderError: unknown;
  for (
    let start = 0;
    start < journal.folderIds.length;
    start += ROLLBACK_BATCH_SIZE
  ) {
    if (Date.now() >= deadline) {
      folderError ??= new Error("Folder rollback timed out");
      break;
    }
    const ids = journal.folderIds.slice(start, start + ROLLBACK_BATCH_SIZE);
    try {
      const folders = await db.folders
        .find({ selector: { id: { $in: ids } } })
        .exec();
      if (folders.length > 0) {
        await db.folders.bulkRemove(folders);
      }
      await yieldRollbackBatch();
    } catch (error) {
      folderError ??= error;
    }
  }
  if (folderError) {
    logger.error("[UniversalImporter] Folder rollback failed", {
      error: folderError instanceof Error ? folderError.message : String(folderError),
      folderCount: journal.folderIds.length,
    });
  }
  return { completed: !bookmarkError && !documentError && !folderError };
}

async function insertTrackedBookmark(
  db: BookmarkForgeDB,
  document: BookmarkDocType,
  journal?: ImportJournal,
): Promise<void> {
  await db.bookmarks.insert(document);
  journal?.bookmarkIds.push(document.id);
}

async function insertTrackedDocument(
  db: BookmarkForgeDB,
  document: DocumentDocType,
  journal?: ImportJournal,
): Promise<void> {
  await db.documents.insert(document);
  journal?.documentIds.push(document.id);
}

async function insertTrackedFolder(
  db: BookmarkForgeDB,
  folder: FolderDocType,
  journal?: ImportJournal,
): Promise<void> {
  await db.folders.insert(folder);
  journal?.folderIds.push(folder.id);
}

function getLimitResult(
  error: unknown,
  options: ImportExecutionOptions,
): ImportResult | null {
  if (!isFreeLimitError(error) && !(error instanceof FreeTierImportLimitReached)) {
    return null;
  }
  const importedCount =
    error instanceof FreeTierImportLimitReached
      ? error.importedCount
      : options.importedCount;
  const skippedCount =
    error instanceof FreeTierImportLimitReached ? error.skippedCount : 0;
  return {
    success: true,
    importedCount,
    skippedCount,
    limitReached: true,
    error: `Imported ${importedCount}; Free limit reached. New items were not imported.`,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {return;}
  const error = new Error("Import cancelled");
  error.name = "AbortError";
  throw error;
}

function reportProgress(options: ImportOptions, progress: number): void {
  options.onProgress?.(Math.max(0, Math.min(100, progress)));
}

const IMPORT_YIELD_EVERY = 50;
const MAX_IMPORT_RECORDS = 100_000;

function enforceImportRecordLimit(count: number): void {
  if (count > MAX_IMPORT_RECORDS) {
    throw new Error(
      `Import contains too many records (${count}); maximum is ${MAX_IMPORT_RECORDS}`,
    );
  }
}

/** Yield periodically so large imports do not monopolize the main thread. */
async function yieldImportWork(
  index: number,
  total: number,
  options: ImportExecutionOptions,
): Promise<void> {
  options.recordsSeen = Math.max(options.recordsSeen, index + 1);
  if (index === 0 || index % IMPORT_YIELD_EVERY !== 0) {return;}
  throwIfAborted(options.signal);
  const progress = total > 0 ? 10 + Math.round((index / total) * 85) : 10;
  reportProgress(options, progress);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  throwIfAborted(options.signal);
}

/**
 * Normalizes an untrusted source timestamp into an ISO-8601 string that
 * satisfies RxDB's `format: "date-time"` validation. Source exports differ:
 * Pocket uses unix seconds, Raindrop uses unix seconds or millis, Notion uses
 * ISO strings, and invalid/empty values must not crash the schema. Falls back
 * to `now` when the value cannot be parsed.
 */
function normalizeImportDate(value: string | undefined | null): string {
  if (!value) {return new Date().toISOString();}
  const trimmed = String(value).trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    const ms = n < 1e12 ? n * 1000 : n; // unix seconds vs millis
    const date = new Date(ms);
    return Number.isNaN(date.getTime())
      ? new Date().toISOString()
      : date.toISOString();
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

function normalizeOptionalImportDate(value: unknown): string | undefined {
  if (value === undefined || value === null) {return undefined;}
  const trimmed = String(value).trim();
  if (!trimmed) {return undefined;}
  const numericValue = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
  const timestamp =
    numericValue === undefined
      ? new Date(trimmed).getTime()
      : new Date(numericValue < 1e12 ? numericValue * 1000 : numericValue).getTime();
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

const IMPORT_TITLE_MAX_LENGTH = 500;
const IMPORT_CONTENT_MAX_LENGTH = 10_000;

function normalizeImportedTitle(value: unknown, fallback: string): string {
  const title =
    typeof value === "string"
      ? sanitizeUserInput(value, IMPORT_TITLE_MAX_LENGTH)
      : "";
  return title || fallback;
}

function normalizeImportedContent(value: unknown): string {
  return typeof value === "string"
    ? sanitizeUserInput(value, IMPORT_CONTENT_MAX_LENGTH)
    : "";
}

function normalizeImportedBlocks(value: unknown): unknown[] {
  if (!Array.isArray(value)) {return [];}

  const sanitizeValue = (
    candidate: unknown,
    key: string | undefined,
    depth: number,
  ): unknown => {
    if (depth > 10) {return undefined;}
    if (typeof candidate === "string") {
      const normalizedKey = key?.toLowerCase();
      if (
        normalizedKey === "url" ||
        normalizedKey === "href" ||
        normalizedKey === "src"
      ) {
        return sanitizeUrl(candidate);
      }
      return candidate.substring(0, IMPORT_CONTENT_MAX_LENGTH);
    }
    if (Array.isArray(candidate)) {
      return candidate
        .slice(0, 500)
        .map((item) => sanitizeValue(item, key, depth + 1))
        .filter((item) => item !== undefined);
    }
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .slice(0, 100)
          .filter(([entryKey]) =>
            entryKey.length <= 100 &&
            entryKey !== "__proto__" &&
            entryKey !== "constructor" &&
            entryKey !== "prototype",
          )
          .map(([entryKey, entryValue]) => [
            entryKey,
            sanitizeValue(entryValue, entryKey, depth + 1),
          ])
          .filter(([, entryValue]) => entryValue !== undefined),
      );
    }
    return candidate;
  };

  return normalizeImportedBlocksValue(sanitizeValue(value, undefined, 0));
}

function normalizeImportedBlocksValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((item) => item !== undefined) : [];
}

function normalizeImportedInteger(
  value: unknown,
  maximum: number,
  fallback = 0,
): number {
  const numericValue = typeof value === "number" || typeof value === "string"
    ? Number(value)
    : NaN;
  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(0, numericValue));
}

function normalizeImportedTags(value: unknown, maximum = 100): string[] {
  const candidates = typeof value === "string" ? [value] : value;
  return sanitizeTags(candidates).slice(0, maximum);
}

type PocketReadStateFields = {
  isRead?: boolean;
  archiveTag?: string;
};

/**
 * Pocket exports use `Unread`, `Read`, and `Archive` as human-facing status
 * values. Read state belongs in the bookmark schema so it remains queryable
 * and survives exports; archive is kept as a tag because BookmarkForge has no
 * separate archive lifecycle yet (and must never turn it into isDeleted).
 */
function pocketReadStateFields(value: unknown): PocketReadStateFields {
  if (typeof value !== "string") {return {};}
  const normalized = value.trim().toLowerCase().replace(/[._-]+/g, " ");
  if (!normalized) {return {};}
  if (/^unread$|^not read$/.test(normalized)) {
    return { isRead: false };
  }
  if (/^read$/.test(normalized)) {
    return { isRead: true };
  }
  if (/^archive$|^archived$/.test(normalized)) {
    return { isRead: true, archiveTag: "pocket-archive" };
  }
  return {};
}

function pocketReadStateTags(tags: string[], fields: PocketReadStateFields): string[] {
  return fields.archiveTag && !tags.includes(fields.archiveTag)
    ? [...tags, fields.archiveTag]
    : tags;
}

function pocketHtmlStatus(link: Element, headings: readonly Element[]): string | undefined {
  let latestHeading: Element | undefined;
  for (const heading of headings) {
    // DOCUMENT_POSITION_FOLLOWING = 4. The last heading before this anchor
    // is the Pocket section that contains it (Unread, Read, or Archive).
    if ((heading.compareDocumentPosition(link) & 4) !== 0) {
      latestHeading = heading;
    }
  }
  return latestHeading?.textContent?.trim();
}

function pocketCsvStatus(getColumn: (name: string) => string): string {
  return (
    getColumn("status") ||
    getColumn("state") ||
    getColumn("read_status") ||
    getColumn("readstate") ||
    getColumn("read_state") ||
    getColumn("archive") ||
    getColumn("archived") ||
    ""
  );
}

function normalizePocketHeader(value: string): string {
  return value
    .replace(/^\\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\\s-]+/g, "_");
}

export interface PocketImportPreview {
  source: "pocket";
  filename: string;
  linkCount: number;
  datedCount: number;
  uniqueTagCount: number;
  unreadCount: number;
  archivedCount: number;
  sampleTitles: string[];
}

function pocketPreviewFromRows(
  filename: string,
  rows: Array<{ title: string; url: string; date?: string; tags?: string; status?: string }>,
): PocketImportPreview | null {
  const links = rows.filter((row) => sanitizeUrl(row.url).startsWith("http"));
  if (links.length === 0) {return null;}
  const uniqueTags = new Set<string>();
  let datedCount = 0;
  let unreadCount = 0;
  let archivedCount = 0;
  for (const row of links) {
    if (normalizeOptionalImportDate(row.date)) {datedCount++;}
    for (const tag of (row.tags || "").split(/[,;|]/)) {
      const normalized = tag.trim().toLowerCase();
      if (normalized) {uniqueTags.add(normalized);}
    }
    const state = pocketReadStateFields(row.status);
    if (state.isRead === false) {unreadCount++;}
    if (state.archiveTag) {archivedCount++;}
  }
  return {
    source: "pocket",
    filename,
    linkCount: links.length,
    datedCount,
    uniqueTagCount: uniqueTags.size,
    unreadCount,
    archivedCount,
    sampleTitles: links
      .map((row) => row.title.trim())
      .filter(Boolean)
      .slice(0, 3),
  };
}

function normalizeImportedRelatedLinks(value: unknown): string[] {
  if (!Array.isArray(value)) {return [];}
  const links: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (links.length >= 100) {break;}
    if (typeof candidate !== "string" || candidate.length > 2_000) {continue;}
    const link = sanitizeUrl(candidate);
    if (!link.startsWith("http") || seen.has(link)) {continue;}
    seen.add(link);
    links.push(link);
  }
  return links;
}

function resolveImportedFolderParent(
  id: string,
  requestedParentId: string,
  parents: ReadonlyMap<string, string>,
  maxDepth = 20,
): string {
  if (requestedParentId === "root") {return "root";}
  let current = requestedParentId;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (current === id) {return "root";}
    const parent = parents.get(current);
    if (!parent || parent === "root") {return current;}
    current = parent;
  }
  return "root";
}

function normalizeImportedDocumentLinks(
  value: unknown,
  documentIdMap: ReadonlyMap<string, string>,
): string[] {
  if (!Array.isArray(value)) {return [];}
  const links: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (links.length >= 100) {break;}
    if (typeof candidate !== "string" || candidate.length > 200) {continue;}
    const link = documentIdMap.get(candidate);
    if (!link || seen.has(link)) {continue;}
    seen.add(link);
    links.push(link);
  }
  return links;
}

/**
 * UniversalImporter - Handles importing data from multiple formats
 * Supports Notion (JSON), Generic JSON, CSV, Pocket (HTML), Raindrop (CSV), Omnivore (JSON)
 */
export class UniversalImporter {
  private static readonly MAX_IMPORT_BYTES = 50 * 1024 * 1024;
  private static readonly MAX_ZIP_ENTRIES = 10_000;
  private static readonly MAX_ZIP_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
  private static readonly MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024;
  private pendingRollback: ImportJournal | null = loadPendingRollback();
  private pendingRollbackPromise: Promise<boolean> | null = null;

  /** Inspect a Pocket export without touching the database. */
  async previewPocketFile(file: File): Promise<PocketImportPreview | null> {
    return UniversalImporter.previewPocketFile(file);
  }

  static async previewPocketFile(file: File): Promise<PocketImportPreview | null> {
    const filename = file.name;
    const lowerFilename = filename.toLowerCase();
    const content = await file.text();

    if (lowerFilename.endsWith(".html") || lowerFilename.endsWith(".htm")) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, "text/html");
      const anchors = Array.from(doc.querySelectorAll("a"));
      const pocketShape =
        lowerFilename === "ril_export.html" ||
        content.includes("<!DOCTYPE NETSCAPE-Bookmark-file-1") ||
        anchors.some((anchor) =>
          anchor.hasAttribute("add_date") ||
          anchor.hasAttribute("tags") ||
          anchor.hasAttribute("data-status"),
        );
      if (!pocketShape) {return null;}
      return pocketPreviewFromRows(
        filename,
        anchors.map((anchor) => ({
          title: anchor.textContent || "",
          url: anchor.getAttribute("href") || "",
          date: anchor.getAttribute("add_date") || undefined,
          tags: anchor.getAttribute("tags") || "",
          status:
            anchor.getAttribute("status") ||
            anchor.getAttribute("data-status") ||
            anchor.getAttribute("data-read") ||
            pocketHtmlStatus(anchor, Array.from(doc.querySelectorAll("h3"))),
        })),
      );
    }

    if (lowerFilename.endsWith(".csv")) {
      const records = Array.from(this.iterateCSVRecords(content));
      const headerRecord = records.shift();
      if (!headerRecord) {return null;}
      const headers = this.parseCSVLine(headerRecord).map(normalizePocketHeader);
      const hasUrl = headers.includes("url") || headers.includes("link");
      const hasPocketField = headers.some((header) =>
        [
          "tags", "tag", "status", "state", "read_status", "read_state",
          "time_added", "time_read", "add_date", "date_added", "created", "created_at",
        ].includes(header),
      );
      if (!hasUrl || !hasPocketField) {return null;}
      const rows = records.map((record) => {
        const parts = this.parseCSVLine(record);
        const getByHeader = (names: string[]) => {
          const index = names.map(normalizePocketHeader).map((name) => headers.indexOf(name)).find((value) => value >= 0) ?? -1;
          return index >= 0 ? parts[index] || "" : "";
        };
        return {
          title: getByHeader(["title", "name"]),
          url: getByHeader(["url", "link"]),
          date: getByHeader(["time_added", "add_date", "created", "created_at", "date_added"]),
          tags: getByHeader(["tags", "tag"]),
          status: getByHeader(["status", "state", "read_status", "read_state", "archive", "archived"]),
        };
      });
      return pocketPreviewFromRows(filename, rows);
    }
    return null;
  }

  private static getSizeError(file: File): ImportResult | null {
    if (file.size <= UniversalImporter.MAX_IMPORT_BYTES) return null;
    return {
      success: false,
      importedCount: 0,
      skippedCount: 0,
      error: `File too large (${(file.size / 1e6).toFixed(0)} MB). Maximum: ${UniversalImporter.MAX_IMPORT_BYTES / 1e6} MB.`,
    };
  }

  /** Retries cleanup from the previous failed import before allowing another. */
  async retryPendingRollback(db: BookmarkForgeDB): Promise<boolean> {
    if (this.pendingRollbackPromise) {return this.pendingRollbackPromise;}
    const operation = (async () => {
      if (!this.pendingRollback) {return true;}
      const rollback = await rollbackImport(db, this.pendingRollback);
      if (rollback.completed) {
        this.pendingRollback = null;
        clearPersistedRollback();
      }
      return rollback.completed;
    })();
    const tracked = operation.finally(() => {
      if (this.pendingRollbackPromise === tracked) {
        this.pendingRollbackPromise = null;
      }
    });
    this.pendingRollbackPromise = tracked;
    return tracked;
  }

  private async importContent(
    db: BookmarkForgeDB,
    filename: string,
    content: string,
    options: ImportExecutionOptions,
  ): Promise<ImportResult> {
    throwIfAborted(options.signal);
    const normalizedFilename = filename.toLowerCase();
    if (normalizedFilename.endsWith(".json")) {
      return this.importFromJSON(db, content, options);
    }
    if (normalizedFilename.endsWith(".csv")) {
      return this.importFromCSV(db, content, options);
    }
    if (
      normalizedFilename.endsWith(".html") ||
      normalizedFilename.endsWith(".htm")
    ) {
      return this.importFromPocketHTML(db, content, options);
    }
    if (normalizedFilename.endsWith(".md")) {
      const note = parseMarkdownNote(filename, content);
      return this.importParsedMarkdown(db, [note], new Map(), options);
    }
    throw new Error(
      "Unsupported file format. Please use .json, .csv, .html, .md, or .zip (Markdown/Obsidian vault) files.",
    );
  }

  /**
   * Main import function
   */
  async importData(
    db: BookmarkForgeDB,
    file: File,
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    const sizeError = UniversalImporter.getSizeError(file);
    if (sizeError) return sizeError;
    if (!(await this.retryPendingRollback(db))) {
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        error: "A previous import rollback is incomplete; retry cleanup before importing again.",
      };
    }
    const importOptions = createImportExecutionOptions(options);
    try {
      throwIfAborted(importOptions.signal);
      reportProgress(importOptions, 10);
      const filename = file.name.toLowerCase();
      let result: ImportResult;

      if (filename.endsWith(".zip")) {
        result = await this.importFromMarkdownZip(db, file, importOptions);
      } else if (filename.endsWith(".csv")) {
        const records = UniversalImporter.iterateFileCSVRecords(
          file,
          importOptions.signal,
        );
        result =
          filename.includes("raindrop") || filename.includes("rain-drop")
            ? await this.importFromRaindropCSV(db, records, importOptions)
            : await this.importFromCSV(db, records, importOptions);
      } else {
        const content = await file.text();
        throwIfAborted(importOptions.signal);
        result = await this.importContent(
          db,
          file.name,
          content,
          importOptions,
        );
      }

      reportProgress(importOptions, 100);
      return result;
    } catch (error) {
      const limitResult = getLimitResult(error, importOptions);
      if (limitResult) {
        logger.info("[UniversalImporter] Free-tier limit reached", {
          importedCount: limitResult.importedCount,
        });
        return limitResult;
      }
      const rollback = await rollbackImport(db, importOptions.journal);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("[UniversalImporter] Import failed", {
        error: errorMessage,
        recordsSeen: importOptions.recordsSeen,
        rollbackCompleted: rollback.completed,
      });
      if (!rollback.completed) {
        this.pendingRollback = importOptions.journal;
        persistPendingRollback(this.pendingRollback);
      }
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        error: rollback.completed
          ? errorMessage
          : `${errorMessage}. Rollback incomplete; some imported records may remain.`,
        rollbackIncomplete: !rollback.completed,
      };
    }
  }

  /**
   * Detect source from file name and content, then dispatch
   */
  async importDataWithDetection(
    db: BookmarkForgeDB,
    file: File,
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    const sizeError = UniversalImporter.getSizeError(file);
    if (sizeError) return sizeError;
    if (!(await this.retryPendingRollback(db))) {
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        error: "A previous import rollback is incomplete; retry cleanup before importing again.",
      };
    }
    const importOptions = createImportExecutionOptions(options);
    try {
      throwIfAborted(importOptions.signal);
      reportProgress(importOptions, 10);
      const filename = file.name.toLowerCase();

      // A CSV file can be dispatched from its extension without reading the
      // complete file first. This keeps automatic detection consistent with
      // importData() and preserves the streaming path for large CSV exports.
      if (filename.endsWith(".csv")) {
        const records = UniversalImporter.iterateFileCSVRecords(
          file,
          importOptions.signal,
        );
        const result =
          filename.includes("raindrop") || filename.includes("rain-drop")
            ? await this.importFromRaindropCSV(db, records, importOptions)
            : await this.importFromCSV(db, records, importOptions);
        reportProgress(importOptions, 100);
        return result;
      }

      if (filename.endsWith(".zip")) {
        const zipResult = await this.importFromMarkdownZip(
          db,
          file,
          importOptions,
        );
        reportProgress(importOptions, 100);
        return zipResult;
      }
      if (filename.endsWith(".md")) {
        const markdownResult = await this.importFromMarkdownFile(
          db,
          file,
          importOptions,
        );
        reportProgress(importOptions, 100);
        return markdownResult;
      }

      const content = await file.text();
      throwIfAborted(importOptions.signal);

      let detectedResult: ImportResult | undefined;
      if (
        content.includes("<!DOCTYPE NETSCAPE-Bookmark-file-1") ||
        content.includes("<DT><A")
      ) {
        detectedResult = await this.importFromPocketHTML(
          db,
          content,
          importOptions,
        );
      } else if (
        filename.includes("raindrop") ||
        filename.includes("rain-drop")
      ) {
        detectedResult = await this.importFromRaindropCSV(
          db,
          content,
          importOptions,
        );
      } else if (
        filename.includes("omnivore") ||
        content.includes('"type":"article"') ||
        content.includes('"savedAt"')
      ) {
        detectedResult = await this.importFromOmnivoreJSON(
          db,
          content,
          importOptions,
        );
      }
      if (detectedResult) {
        reportProgress(importOptions, 100);
        return detectedResult;
      }
      // Reuse the content already read for detection. Calling importData here
      // would read the entire file a second time and temporarily double peak
      // memory for large (but still allowed) imports.
      const result = await this.importContent(
        db,
        filename,
        content,
        importOptions,
      );
      reportProgress(importOptions, 100);
      return result;
    } catch (error) {
      const limitResult = getLimitResult(error, importOptions);
      if (limitResult) {
        logger.info("[UniversalImporter] Free-tier limit reached", {
          importedCount: limitResult.importedCount,
        });
        return limitResult;
      }
      const rollback = await rollbackImport(db, importOptions.journal);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("[UniversalImporter] Detection failed", {
        error: errorMessage,
        recordsSeen: importOptions.recordsSeen,
        rollbackCompleted: rollback.completed,
      });
      if (!rollback.completed) {
        this.pendingRollback = importOptions.journal;
        persistPendingRollback(this.pendingRollback);
      }
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        error: rollback.completed
          ? errorMessage
          : `${errorMessage}. Rollback incomplete; some imported records may remain.`,
        rollbackIncomplete: !rollback.completed,
      };
    }
  }

  /**
   * Parse Pocket HTML export format.
   * Uses DOMParser instead of a fragile regex so that attribute order,
   * whitespace variation, and malformed HTML don't silently skip bookmarks.
   * Format: <DT><A HREF="url" ADD_DATE="ts" TAGS="tag1,tag2">title</A>
   */
  private async importFromPocketHTML(
    db: BookmarkForgeDB,
    content: string,
    options: ImportExecutionOptions,
  ): Promise<ImportResult> {
    let importedCount = 0;
    let skippedCount = 0;

    const parser = new DOMParser();
    const doc = parser.parseFromString(content, "text/html");
    const links = doc.querySelectorAll("a");
    const headings = Array.from(doc.querySelectorAll("h3"));
    enforceImportRecordLimit(links.length);

    for (let index = 0; index < links.length; index++) {
      await yieldImportWork(index, links.length, options);
      const link = links[index]!;
      throwIfAborted(options.signal);
      try {
        const href = link.getAttribute("href");
        const addDateAttr = link.getAttribute("add_date");
        const tagsAttr = link.getAttribute("tags");
        const rawTitle = (link.textContent || "").trim();
        const statusValue =
          link.getAttribute("status") ||
          link.getAttribute("data-status") ||
          link.getAttribute("data-read") ||
          pocketHtmlStatus(link, headings);
        const readState = pocketReadStateFields(statusValue);

        const url = sanitizeUrl(href || "");
        if (!url || !url.startsWith("http")) {
          skippedCount++;
          continue;
        }

        const title = normalizeImportedTitle(rawTitle, "Untitled");
        const tags = normalizeImportedTags((tagsAttr || "").split(","));
        const createdAt = normalizeImportDate(addDateAttr);

        const existing = await db.bookmarks
          .findOne({ selector: { urlHash: await hashString(url) } })
          .exec();

        if (!existing) {
          await insertTrackedBookmark(db, {
            id: generateId(),
            url,
            urlHash: await hashString(url),
            title,
            content: "",
            summary: "",
            tags: pocketReadStateTags(
              tags.length ? tags : ["pocket-import"],
              readState,
            ),
            ...(readState.isRead === undefined ? {} : { isRead: readState.isRead }),
            createdAt,
            updatedAt: new Date().toISOString(),
            isDeleted: false,
            isPrivate: false,
            processed: false,
            relatedLinks: [],
            visitCount: 0,
          } as BookmarkDocType, options.journal);
          importedCount++;
          options.importedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        if (isFreeLimitError(error)) {
          throw new FreeTierImportLimitReached(options.importedCount, skippedCount);
        }
        skippedCount++;
      }
    }

    return { success: true, importedCount, skippedCount };
  }

  /**
   * Parse Raindrop CSV export format
   * Columns: title, url, tags, domain, created, ...
   */
  private async importFromRaindropCSV(
    db: BookmarkForgeDB,
    content: string | CSVRecordSource,
    options: ImportExecutionOptions,
  ): Promise<ImportResult> {
    let importedCount = 0;
    let skippedCount = 0;
    let headers: string[] = [];
    let recordIndex = 0;
    const records =
      typeof content === "string"
        ? UniversalImporter.iterateCSVRecords(content)
        : content;

    for await (const record of records) {
      const index = recordIndex++;
      enforceImportRecordLimit(recordIndex);
      await yieldImportWork(index, MAX_IMPORT_RECORDS, options);
      throwIfAborted(options.signal);
      const line = record.trim();
      if (!line) {continue;}

      const parts = UniversalImporter.parseCSVLine(line);

      if (index === 0) {
        headers = parts.map((h) => h.toLowerCase());
        continue;
      }

      const getCol = (name: string): string => {
        const idx = headers.indexOf(name);
        return idx >= 0 ? parts[idx] || "" : "";
      };
      const readState = pocketReadStateFields(pocketCsvStatus(getCol));

      try {
        const url = sanitizeUrl(getCol("url") || parts[1] || "");
        const title = normalizeImportedTitle(
          getCol("title") || getCol("name") || parts[0],
          "Untitled",
        );
        const rawTags = getCol("tags") || getCol("tag") || "";
        const tags = normalizeImportedTags(rawTags.split(/[,;]/));

        if (!url || !url.startsWith("http")) {
          skippedCount++;
          continue;
        }

        const existing = await db.bookmarks
          .findOne({ selector: { urlHash: await hashString(url) } })
          .exec();

        if (!existing) {
          await insertTrackedBookmark(db, {
            id: generateId(),
            url,
            urlHash: await hashString(url),
            title,
            content: "",
            summary: SanitizationService.sanitizeHtml(
              normalizeImportedContent(
                getCol("description") || getCol("note") || "",
              ),
              true,
            ),
            tags: pocketReadStateTags(
              tags.length ? tags : ["raindrop-import"],
              readState,
            ),
            ...(readState.isRead === undefined ? {} : { isRead: readState.isRead }),
            createdAt: normalizeImportDate(getCol("created")),
            updatedAt: new Date().toISOString(),
            isDeleted: false,
            isPrivate: false,
            processed: false,
            relatedLinks: [],
            visitCount: 0,
          } as BookmarkDocType, options.journal);
          importedCount++;
          options.importedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        if (isFreeLimitError(error)) {
          throw new FreeTierImportLimitReached(options.importedCount, skippedCount);
        }
        skippedCount++;
      }
    }

    return { success: true, importedCount, skippedCount };
  }

  /**
   * Parse Omnivore JSON export format
   * Structure: { data: { articles: [{ id, title, url, savedAt, description, labels: [{ name }], ... }] } }
   */
  private async importFromOmnivoreJSON(
    db: BookmarkForgeDB,
    content: string,
    options: ImportExecutionOptions,
  ): Promise<ImportResult> {
    let importedCount = 0;
    let skippedCount = 0;

    try {
      const parsed = JSON.parse(content);
      const articles =
        parsed?.data?.articles || parsed?.articles || parsed || [];

      if (!Array.isArray(articles)) {
        skippedCount = 0;
        return {
          success: true,
          importedCount: 0,
          skippedCount: 0,
          error: "No articles array found",
        };
      }

      enforceImportRecordLimit(articles.length);
      for (let index = 0; index < articles.length; index++) {
        await yieldImportWork(index, articles.length, options);
        throwIfAborted(options.signal);
        const article = articles[index]!;
        try {
          const url = sanitizeUrl(article.url || article.originalUrl || "");
          const title = normalizeImportedTitle(
            article.title || article.slug,
            "Untitled",
          );
          const tags = normalizeImportedTags(
            Array.isArray(article.labels)
              ? article.labels.map((label: unknown) =>
                  typeof label === "string"
                    ? label
                    : typeof label === "object" && label !== null
                      ? String((label as { name?: unknown }).name || "")
                      : "",
                )
              : [],
          );

          if (!url || !url.startsWith("http")) {
            skippedCount++;
            continue;
          }

          const existing = await db.bookmarks
            .findOne({ selector: { urlHash: await hashString(url) } })
            .exec();

          if (!existing) {
            await insertTrackedBookmark(db, {
              id: generateId(),
              url,
              urlHash: await hashString(url),
              title,
              content: SanitizationService.sanitizeHtml(
                normalizeImportedContent(
                  article.description || article.content || "",
                ),
                true,
              ),
              summary: SanitizationService.sanitizeHtml(
                normalizeImportedContent(article.description || ""),
                true,
              ),
              tags: tags.length ? tags : ["omnivore-import"],
              createdAt: normalizeImportDate(
                article.savedAt || article.createdAt,
              ),
              updatedAt: normalizeImportDate(article.updatedAt),
              processed: false,
              isPrivate: false,
              isDeleted: false,
              relatedLinks: [],
              visitCount: 0,
            } as BookmarkDocType, options.journal);
            importedCount++;
            options.importedCount++;
          } else {
            skippedCount++;
          }
        } catch (error) {
          if (isFreeLimitError(error)) {
            throw new FreeTierImportLimitReached(options.importedCount, skippedCount);
          }
          skippedCount++;
        }
      }
    } catch (error) {
      if (error instanceof FreeTierImportLimitReached || isFreeLimitError(error)) {
        throw error;
      }
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        error: "Invalid Omnivore JSON format",
      };
    }

    return { success: true, importedCount, skippedCount };
  }

  /**
   * Imports from Notion-style JSON or generic JSON
   */
  private static safeParseJSON(content: string): Record<string, unknown> {
    const data = JSON.parse(content);
    if (data === null || typeof data !== "object" || Array.isArray(data))
      {return data;}
    const proto = Object.getPrototypeOf(data);
    if (proto !== null && proto !== Object.prototype) {
      return Object.assign({}, data);
    }
    const unsafeKeys = ["__proto__", "constructor", "prototype"];
    for (const key of unsafeKeys) {
      if (key in data) {
        const sanitized = { ...data };
        delete sanitized[key];
        return sanitized;
      }
    }
    return data;
  }

  private async importFromJSON(
    db: BookmarkForgeDB,
    content: string,
    options: ImportExecutionOptions,
  ): Promise<ImportResult> {
    const parsedData = UniversalImporter.safeParseJSON(content) as Record<
      string,
      unknown
    >;
    // UniversalExporter wraps collections under `data`; older Notion-style
    // files place them at the root. Accept both shapes for lossless roundtrip.
    const nestedData = parsedData.data;
    const data =
      nestedData &&
      typeof nestedData === "object" &&
      !Array.isArray(nestedData) &&
      (Array.isArray((nestedData as Record<string, unknown>).bookmarks) ||
        Array.isArray((nestedData as Record<string, unknown>).documents))
        ? (nestedData as Record<string, unknown>)
        : parsedData;
    let importedCount = 0;
    let skippedCount = 0;

    // 1. Handle Notion-style exports (structured JSON from BookmarkForge or similar)
    if (data.bookmarks || data.documents) {
      const bookmarkRecords = Array.isArray(data.bookmarks)
        ? data.bookmarks
        : [];
      const documentRecords = Array.isArray(data.documents)
        ? data.documents
        : [];
      const folderRecords = Array.isArray(data.folders) ? data.folders : [];
      enforceImportRecordLimit(
        bookmarkRecords.length + documentRecords.length + folderRecords.length,
      );

      const availableFolderIds = new Set<string>(["root"]);
      const folderParentMap = new Map<string, string>();
      const documentsReferenceFolders = documentRecords.some(
        (record) =>
          typeof record === "object" &&
          record !== null &&
          !Array.isArray(record) &&
          typeof (record as Record<string, unknown>).folderId === "string",
      );
      if (folderRecords.length > 0 || documentsReferenceFolders) {
        const existingFolders = await db.folders.find().exec();
        for (const folder of existingFolders) {
          if (typeof folder.id === "string") {
            availableFolderIds.add(folder.id);
            if (typeof folder.parentId === "string") {
              folderParentMap.set(folder.id, folder.parentId);
            }
          }
        }
      }
      for (let index = 0; index < folderRecords.length; index++) {
        await yieldImportWork(index, folderRecords.length, options);
        throwIfAborted(options.signal);
        const rawFolder = folderRecords[index];
        if (
          typeof rawFolder !== "object" ||
          rawFolder === null ||
          Array.isArray(rawFolder)
        ) {
          continue;
        }
        const folder = rawFolder as Record<string, unknown>;
        const id = typeof folder.id === "string" ? folder.id : "";
        if (!id || id.length > 100 || id === "root") {continue;}
        const existing = await db.folders
          .findOne({ selector: { id } })
          .exec();
        if (existing) {
          availableFolderIds.add(id);
          continue;
        }
        const rawParentId =
          typeof folder.parentId === "string" ? folder.parentId : "root";
        const parentId = availableFolderIds.has(rawParentId)
          ? resolveImportedFolderParent(id, rawParentId, folderParentMap)
          : "root";
        await insertTrackedFolder(
          db,
          {
            id,
            title: normalizeImportedTitle(folder.title, "Untitled Folder"),
            parentId,
            createdAt: normalizeImportDate(
              typeof folder.createdAt === "string" ? folder.createdAt : null,
            ),
          },
          options.journal,
        );
        availableFolderIds.add(id);
        folderParentMap.set(id, parentId);
        importedCount++;
        options.importedCount++;
      }

      // Import Bookmarks
      if (Array.isArray(data.bookmarks)) {
        for (let index = 0; index < data.bookmarks.length; index++) {
          await yieldImportWork(index, data.bookmarks.length, options);
          throwIfAborted(options.signal);
          const item = data.bookmarks[index]!;
          try {
            // Same contract as the CSV/HTML importers: a URL rejected by
            // sanitizeUrl (private/loopback/SSRF guard, invalid scheme) must
            // SKIP the row, never insert a bookmark with an empty url.
            const url = sanitizeUrl(item.url || "");
            if (!url || !url.startsWith("http")) {
              skippedCount++;
              continue;
            }

            // Query only after sanitization so raw attacker-controlled URLs do
            // not enter database selectors or duplicate checks.
            const existing = await db.bookmarks
              .findOne({ selector: { urlHash: await hashString(url) } })
              .exec();

            if (!existing) {
              const lastChecked = normalizeOptionalImportDate(item.lastChecked);
              const lastVisitedAt = normalizeOptionalImportDate(item.lastVisitedAt);
              const broken =
                typeof item.broken === "boolean" ? item.broken : undefined;
              await insertTrackedBookmark(db, {
                id: generateId(),
                url,
                urlHash: await hashString(url),
                title: normalizeImportedTitle(
                  item.title,
                  "Untitled Bookmark",
                ),
                content: SanitizationService.sanitizeHtml(
                  normalizeImportedContent(
                    item.description || item.content || "",
                  ),
                  true,
                ),
                // BMF self-exports carry the AI summary in `summary`; the
                // legacy Notion field `description` is kept as a fallback.
                // Reading only `description` silently dropped every bookmark
                // summary on a JSON export → import round-trip.
                summary: SanitizationService.sanitizeHtml(
                  normalizeImportedContent(
                    item.description || item.summary || "",
                  ),
                  true,
                ),
                tags: normalizeImportedTags(item.tags),
                createdAt: normalizeImportDate(
                  item.created_time || item.createdAt,
                ),
                updatedAt: normalizeImportDate(
                  item.last_edited_time || item.updatedAt,
                ),
                processed: false,
                isPrivate: false,
                isDeleted: false,
                ...(broken === undefined ? {} : { broken }),
                ...(lastChecked === undefined ? {} : { lastChecked }),
                ...(lastVisitedAt === undefined ? {} : { lastVisitedAt }),
                relatedLinks: normalizeImportedRelatedLinks(item.relatedLinks),
                visitCount: normalizeImportedInteger(item.visitCount, 1_000_000),
              } as BookmarkDocType, options.journal);
              importedCount++;
              options.importedCount++;
            } else {
              skippedCount++;
            }
          } catch (e) {
            if (isFreeLimitError(e)) {
              throw new FreeTierImportLimitReached(options.importedCount, skippedCount);
            }
            logger.warn("[UniversalImporter] Failed to import bookmark", {
              error: e instanceof Error ? e.message : String(e),
            });
            skippedCount++;
          }
        }
      }

      // Pre-allocate document IDs so links can be restored regardless of
      // document ordering in the backup file.
      const documentIdMap = new Map<string, string>();
      const documentIdsByIndex = new Map<number, string>();
      for (let index = 0; index < documentRecords.length; index++) {
        const rawDocument = documentRecords[index];
        const sourceId =
          typeof rawDocument === "object" &&
          rawDocument !== null &&
          !Array.isArray(rawDocument) &&
          typeof (rawDocument as Record<string, unknown>).id === "string" &&
          ((rawDocument as Record<string, unknown>).id as string).length <= 200
            ? ((rawDocument as Record<string, unknown>).id as string)
            : undefined;
        const newId = generateId();
        documentIdsByIndex.set(index, newId);
        if (sourceId && !documentIdMap.has(sourceId)) {
          documentIdMap.set(sourceId, newId);
        }
      }

      // Import Documents
      if (Array.isArray(data.documents)) {
        for (let index = 0; index < data.documents.length; index++) {
          await yieldImportWork(index, data.documents.length, options);
          throwIfAborted(options.signal);
          const item = data.documents[index]!;
          try {
            await insertTrackedDocument(db, {
              id: documentIdsByIndex.get(index) ?? generateId(),
              title: normalizeImportedTitle(
                item.title,
                "Untitled Document",
              ),
              textContent: normalizeImportedContent(
                item.textContent || item.content || "",
              ),
              // BMF self-exports carry the AI summary in `summary`; it was
              // previously never read, so document summaries were lost on a
              // JSON export → import round-trip.
              ...(typeof item.summary === "string"
                ? { summary: normalizeImportedContent(item.summary) }
                : {}),
              tags: Array.isArray(item.tags)
                ? item.tags.map((t: unknown) =>
                    sanitizeUserInput(String(t), 50),
                  )
                : [],
              createdAt: normalizeImportDate(
                item.created_time || item.createdAt,
              ),
              updatedAt: normalizeImportDate(
                item.last_edited_time || item.updatedAt,
              ),
              isDeleted: false,
              isPrivate: false,
              processed: false,
              folderId:
                typeof item.folderId === "string" &&
                availableFolderIds.has(item.folderId)
                  ? item.folderId
                  : "root",
              blocks: normalizeImportedBlocks(item.blocks),
              links: normalizeImportedDocumentLinks(
                item.links,
                documentIdMap,
              ),
            } as DocumentDocType, options.journal);
            importedCount++;
            options.importedCount++;
          } catch (e) {
            if (isFreeLimitError(e)) {
              throw new FreeTierImportLimitReached(options.importedCount, skippedCount);
            }
            logger.warn("[UniversalImporter] Failed to import document", {
              error: e instanceof Error ? e.message : String(e),
            });
            skippedCount++;
          }
        }
      }
    } else {
      throw new Error(
        "JSON format not recognized. Ensure it follows the Notion/BookmarkForge export structure.",
      );
    }

    return { success: true, importedCount, skippedCount };
  }

  /**
   * Iterates logical CSV records without allocating a full `split("\\n")`
   * array. Quoted newlines remain inside the same record.
   */
  private static async *iterateFileCSVRecords(
    file: File,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    if (typeof file.stream !== "function") {
      const content = await file.text();
      yield* UniversalImporter.iterateCSVRecords(content);
      return;
    }

    const reader = file.stream().getReader();
    const cancelReader = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal?.addEventListener("abort", cancelReader, { once: true });
    const decoder = new TextDecoder();
    let record = "";
    let inQuotes = false;
    let pendingQuote = false;

    try {
      for (;;) {
        throwIfAborted(signal);
        const { value, done } = await reader.read();
        const chunk = decoder.decode(value, { stream: !done });
        const text = pendingQuote ? `"${chunk}` : chunk;
        pendingQuote = false;

        for (let index = 0; index < text.length; index++) {
          const character = text[index]!;
          if (character === '"') {
            if (index === text.length - 1 && !done) {
              pendingQuote = true;
              continue;
            }
            if (inQuotes && text[index + 1] === '"') {
              record += '""';
              index++;
            } else {
              record += character;
              inQuotes = !inQuotes;
            }
          } else if (character === "\n" && !inQuotes) {
            yield record.endsWith("\r") ? record.slice(0, -1) : record;
            record = "";
          } else {
            record += character;
          }
        }

        if (done) {break;}
      }

      throwIfAborted(signal);
      if (pendingQuote) {
        record += '"';
        inQuotes = !inQuotes;
      }
      if (record.length > 0) {
        yield record;
      }
    } finally {
      signal?.removeEventListener("abort", cancelReader);
      reader.releaseLock();
    }
  }

  private static *iterateCSVRecords(content: string): Generator<string> {
    let recordStart = 0;
    let inQuotes = false;

    for (let index = 0; index < content.length; index++) {
      const character = content[index]!;
      if (character === '"') {
        if (inQuotes && content[index + 1] === '"') {
          index++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (character === "\n" && !inQuotes) {
        const record = content.slice(recordStart, index);
        yield record.endsWith("\r") ? record.slice(0, -1) : record;
        recordStart = index + 1;
      }
    }

    if (recordStart < content.length) {
      yield content.slice(recordStart);
    }
  }

  /**
   * Parse a single CSV line respecting RFC 4180 quoting.
   * Handles quoted fields with embedded commas, newlines, and escaped quotes.
   */
  private static parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;

      if (inQuotes) {
        if (ch === '"') {
          // Peek ahead for escaped quote ""
          if (line[i + 1] === '"') {
            current += '"';
            i++; // skip the second quote
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          fields.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim()); // last field
    return fields;
  }

  /**
   * Basic CSV Importer (URLs only or Title,URL)
   */
  private async importFromCSV(
    db: BookmarkForgeDB,
    content: string | CSVRecordSource,
    options: ImportExecutionOptions,
  ): Promise<ImportResult> {
    let importedCount = 0;
    let skippedCount = 0;
    let recordIndex = 0;
    let headers: string[] = [];
    const records =
      typeof content === "string"
        ? UniversalImporter.iterateCSVRecords(content)
        : content;

    for await (const record of records) {
      const index = recordIndex++;
      enforceImportRecordLimit(recordIndex);
      await yieldImportWork(index, MAX_IMPORT_RECORDS, options);
      throwIfAborted(options.signal);
      // Skip header, but retain names so Pocket-style status columns are mapped.
      if (index === 0) {
        headers = UniversalImporter.parseCSVLine(record).map((h) => h.toLowerCase());
        continue;
      }
      const line = record.trim();
      if (!line) {continue;}

      const parts = UniversalImporter.parseCSVLine(line);
      // Assume Format: Title, URL
      const rawTitle = parts[0]! || "";
      const rawUrl = parts[1]! || parts[0]! || "";

      // Sanitize against XSS and prototype pollution
      const title = normalizeImportedTitle(rawTitle, "");
      const url = sanitizeUrl(rawUrl);
      const getCol = (name: string): string => {
        const idx = headers.indexOf(name);
        return idx >= 0 ? parts[idx] || "" : "";
      };
      const readState = pocketReadStateFields(pocketCsvStatus(getCol));

      if (url && url.startsWith("http")) {
        try {
          const existing = await db.bookmarks
            .findOne({
              selector: { urlHash: await hashString(url) },
            })
            .exec();

          if (!existing) {
            await insertTrackedBookmark(db, {
              id: generateId(),
              url,
              urlHash: await hashString(url),
              title: title || url,
              content: "",
              summary: "",
              tags: pocketReadStateTags(["imported-csv"], readState),
              ...(readState.isRead === undefined ? {} : { isRead: readState.isRead }),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              processed: false,
              isPrivate: false,
              isDeleted: false,
              relatedLinks: [],
              visitCount: 0,
            } as BookmarkDocType, options.journal);
            importedCount++;
            options.importedCount++;
          } else {
            skippedCount++;
          }
        } catch (error) {
          if (isFreeLimitError(error)) {
            throw new FreeTierImportLimitReached(options.importedCount, skippedCount);
          }
          skippedCount++;
        }
      }
    }

    return { success: true, importedCount, skippedCount };
  }
  /**
   * Import a Markdown/Obsidian vault ZIP (the format UniversalExporter's
   * `exportToObsidian` emits): `.md` notes, mirrored `attachments/` files,
   * and `folder` frontmatter paths. Rejects ZIPs without Markdown notes.
   */
  private async importFromMarkdownZip(
    db: BookmarkForgeDB,
    file: File,
    options: ImportExecutionOptions,
  ): Promise<ImportResult> {
    throwIfAborted(options.signal);
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(await file.arrayBuffer());
    } catch {
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        error: "Invalid ZIP file. Upload a BookmarkForge or Obsidian export.",
      };
    }
    throwIfAborted(options.signal);

    const notes: ParsedMarkdownNote[] = [];
    const attachmentByBasename = new Map<string, Uint8Array>();
    const entryNames = Object.keys(zip.files);
    if (entryNames.length > UniversalImporter.MAX_ZIP_ENTRIES) {
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        error: `ZIP contains too many entries; maximum is ${UniversalImporter.MAX_ZIP_ENTRIES}.`,
      };
    }
    let totalUncompressedBytes = 0;
    for (const entryName of entryNames) {
      const entry = zip.files[entryName]!;
      const uncompressedSize = (entry as unknown as {
        _data?: { uncompressedSize?: number };
      })._data?.uncompressedSize;
      if (typeof uncompressedSize === "number" && Number.isFinite(uncompressedSize)) {
        if (uncompressedSize > UniversalImporter.MAX_ZIP_ENTRY_BYTES ||
            totalUncompressedBytes > UniversalImporter.MAX_ZIP_UNCOMPRESSED_BYTES - uncompressedSize) {
          return {
            success: false,
            importedCount: 0,
            skippedCount: 0,
            error: "ZIP contents exceed the safety size limit.",
          };
        }
        totalUncompressedBytes += uncompressedSize;
      }
    }
    enforceImportRecordLimit(entryNames.length);
    for (let index = 0; index < entryNames.length; index++) {
      await yieldImportWork(index, entryNames.length, options);
      const entryName = entryNames[index]!;
      const entry = zip.files[entryName]!;
      if (entry.dir) {continue;}
      const normalized = entryName.replace(/\\/g, "/");
      if (isMarkdownFilePath(normalized)) {
        const content = await entry.async("string");
        throwIfAborted(options.signal);
        // Post-decompression fallback: when JSZip does not expose the
        // uncompressed size via the private _data property (streaming entries,
        // future JSZip versions), we enforce the per-entry and cumulative
        // limits against the actual decompressed byte length to prevent zip
        // bombs from bypassing the preflight check.
        const contentBytes = new TextEncoder().encode(content).length;
        if (
          contentBytes > UniversalImporter.MAX_ZIP_ENTRY_BYTES ||
          totalUncompressedBytes > UniversalImporter.MAX_ZIP_UNCOMPRESSED_BYTES - contentBytes
        ) {
          return {
            success: false,
            importedCount: 0,
            skippedCount: 0,
            error: "ZIP contents exceed the safety size limit.",
          };
        }
        totalUncompressedBytes += contentBytes;
        notes.push(parseMarkdownNote(normalized, content));
      } else if (isAttachmentPath(normalized)) {
        const bytes = await entry.async("uint8array");
        throwIfAborted(options.signal);
        // Post-decompression fallback for attachments: same rationale as
        // above — enforce limits against the actual byte length.
        if (
          bytes.length > UniversalImporter.MAX_ZIP_ENTRY_BYTES ||
          totalUncompressedBytes > UniversalImporter.MAX_ZIP_UNCOMPRESSED_BYTES - bytes.length
        ) {
          return {
            success: false,
            importedCount: 0,
            skippedCount: 0,
            error: "ZIP contents exceed the safety size limit.",
          };
        }
        totalUncompressedBytes += bytes.length;
        const basename = normalized.split("/").pop()!;
        if (!attachmentByBasename.has(basename)) {
          attachmentByBasename.set(basename, bytes);
        }
      } else {
        // Non-markdown, non-attachment entries still consume decompressed
        // memory during extraction. Account for their size toward the
        // cumulative limit to prevent ZIP bombs that use many small
        // non-matching files to bypass the per-entry check.
        const entryBytes = await entry.async("uint8array");
        if (
          entryBytes.length > UniversalImporter.MAX_ZIP_ENTRY_BYTES ||
          totalUncompressedBytes > UniversalImporter.MAX_ZIP_UNCOMPRESSED_BYTES - entryBytes.length
        ) {
          return {
            success: false,
            importedCount: 0,
            skippedCount: 0,
            error: "ZIP contents exceed the safety size limit.",
          };
        }
        totalUncompressedBytes += entryBytes.length;
      }
    }
    if (notes.length === 0) {
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        error: "No Markdown notes found in the ZIP file.",
      };
    }
    return this.importParsedMarkdown(db, notes, attachmentByBasename, options);
  }

  /** Import a single `.md` note (raw file or one exported note). */
  private async importFromMarkdownFile(
    db: BookmarkForgeDB,
    file: File,
    options: ImportExecutionOptions,
  ): Promise<ImportResult> {
    const content = await file.text();
    throwIfAborted(options.signal);
    const note = parseMarkdownNote(file.name, content);
    return this.importParsedMarkdown(db, [note], new Map(), options);
  }

  /**
   * Two-pass Markdown import shared by the ZIP and single-file paths.
   *
   * Pass 1 assigns every note its final id and builds the slug → record map
   * so `[[wikilinks]]` resolve regardless of note order (and to notes that
   * were skipped as duplicates). Pass 2 mirrors `folder` frontmatter paths,
   * persists `attachments/` refs through AttachmentStore, resolves links and
   * inserts records — all tracked in the shared journal for rollback.
   */
  private async importParsedMarkdown(
    db: BookmarkForgeDB,
    notes: readonly ParsedMarkdownNote[],
    attachmentByBasename: ReadonlyMap<string, Uint8Array>,
    options: ImportExecutionOptions,
  ): Promise<ImportResult> {
    let importedCount = 0;
    let skippedCount = 0;
    enforceImportRecordLimit(notes.length);

    const slugMap = new Map<
      string,
      { type: "bookmark" | "document"; id: string; url?: string }
    >();
    const assignedIds = new Map<string, string>();
    const plan: Array<{
      note: ParsedMarkdownNote;
      id: string;
      folderId?: string;
    }> = [];

    for (let index = 0; index < notes.length; index++) {
      throwIfAborted(options.signal);
      const note = notes[index]!;

      // Bookmarks without the stable id contract dedup by URL hash, matching
      // the CSV/HTML/JSON importers.
      if (note.kind === "bookmark" && note.url && !note.bmfId) {
        const url = sanitizeUrl(note.url);
        if (url && url.startsWith("http")) {
          const existing = await db.bookmarks
            .findOne({ selector: { urlHash: await hashString(url) } })
            .exec();
          if (existing) {
            slugMap.set(note.slug, { type: "bookmark", id: existing.id, url });
            skippedCount++;
            continue;
          }
        }
      }

      // Stable dedup contract: bmf_id is the RxDB primary key, so a note
      // whose id already exists is the same record re-exported.
      if (note.bmfId) {
        const existing =
          note.kind === "bookmark"
            ? await db.bookmarks
                .findOne({ selector: { id: note.bmfId } })
                .exec()
            : await db.documents
                .findOne({ selector: { id: note.bmfId } })
                .exec();
        if (existing) {
          slugMap.set(note.slug, {
            type: note.kind,
            id: note.bmfId,
            url: note.url,
          });
          skippedCount++;
          continue;
        }
      }

      const id = note.bmfId && !assignedIds.has(note.bmfId)
        ? note.bmfId
        : generateId();
      if (note.bmfId) {assignedIds.set(note.bmfId, id);}
      plan.push({ note, id });
      slugMap.set(note.slug, { type: note.kind, id, url: note.url });
    }

    // Mirror document `folder` frontmatter paths into the folder tree.
    const folderPathToId = new Map<string, string>();
    for (const entry of plan) {
      const folderPath =
        entry.note.kind === "document" ? entry.note.folderPath : undefined;
      if (!folderPath) {continue;}
      const sanitized = sanitizeFolderPath(folderPath);
      if (!sanitized) {continue;}
      entry.folderId = await this.ensureFolderTree(
        db,
        sanitized,
        folderPathToId,
        options.journal,
      );
    }

    for (let index = 0; index < plan.length; index++) {
      await yieldImportWork(index, plan.length, options);
      throwIfAborted(options.signal);
      const entry = plan[index]!;
      const { note, id, folderId } = entry;
      try {
        if (note.kind === "bookmark") {
          const url = sanitizeUrl(note.url || "");
          if (!url || !url.startsWith("http")) {
            skippedCount++;
            continue;
          }
          const relatedLinks = resolveBookmarkRelatedLinks(
            note.relatedLinks,
            slugMap,
          );
          await insertTrackedBookmark(
            db,
            {
              id,
              url,
              urlHash: await hashString(url),
              title: normalizeImportedTitle(note.title, "Untitled Bookmark"),
              content: normalizeImportedContent(note.content),
              summary: normalizeImportedContent(note.summary),
              tags: normalizeImportedTags(note.tags),
              createdAt: normalizeImportDate(note.createdAt),
              updatedAt: normalizeImportDate(note.updatedAt),
              processed: false,
              isPrivate: false,
              isDeleted: false,
              relatedLinks,
              visitCount: 0,
            } as BookmarkDocType,
            options.journal,
          );
          importedCount++;
          options.importedCount++;
        } else {
          const textContent = await this.importNoteAttachments(
            db,
            id,
            note,
            attachmentByBasename,
          );
          const links = resolveDocumentLinks(note.linkedNotes, slugMap);
          await insertTrackedDocument(
            db,
            {
              id,
              folderId: folderId ?? "root",
              title: normalizeImportedTitle(note.title, "Untitled Document"),
              textContent: normalizeImportedContent(textContent),
              tags: normalizeImportedTags(note.tags),
              createdAt: normalizeImportDate(note.createdAt),
              updatedAt: normalizeImportDate(note.updatedAt),
              processed: false,
              isPrivate: false,
              isDeleted: false,
              blocks: [],
              links,
            } as DocumentDocType,
            options.journal,
          );
          importedCount++;
          options.importedCount++;
        }
      } catch (error) {
        if (isFreeLimitError(error)) {
          throw new FreeTierImportLimitReached(options.importedCount, skippedCount);
        }
        logger.warn("[UniversalImporter] Failed to import markdown note", {
          error: error instanceof Error ? error.message : String(error),
          slug: note.slug,
        });
        skippedCount++;
      }
    }

    return { success: true, importedCount, skippedCount };
  }

  /**
   * Persist the note's `attachments/` refs through AttachmentStore and
   * rewrite them to `bmf-attachment://<id>` refs (the inverse of the
   * exporter's data-URL extraction). Unmatched refs stay verbatim.
   */
  private async importNoteAttachments(
    db: BookmarkForgeDB,
    documentId: string,
    note: ParsedMarkdownNote,
    attachmentByBasename: ReadonlyMap<string, Uint8Array>,
  ): Promise<string> {
    if (note.attachmentRefs.length === 0 || attachmentByBasename.size === 0) {
      return note.textContent ?? "";
    }
    let text = note.textContent ?? "";
    const pathToStoredId = new Map<string, string>();
    for (const ref of note.attachmentRefs) {
      const normalized = normalizeAttachmentRefPath(ref.path);
      if (!normalized) {continue;}
      const basename = normalized.split("/").pop()!;
      const bytes = attachmentByBasename.get(basename);
      if (!bytes) {continue;}
      // SECURITY: never persist SVG attachments from an import. Backing a
      // vault can be attacker-controlled; an SVG may carry inline scripts
      // that execute when the exported attachment is opened as a file
      // (e.g. Obsidian/DOM renderers). The editor's own uploads are user
      // gestures, but imports are untrusted by the same policy that blocks
      // `data:` URIs in <img> (SanitizationService). Leave the ref verbatim.
      if (mimeFromFilename(basename) === "image/svg+xml") {continue;}
      const cacheKey = pathToStoredId.has(normalized) ? normalized : basename;
      let storedId = pathToStoredId.get(cacheKey);
      if (!storedId) {
        storedId = await attachmentStore.persistFile(
          documentId,
          new Blob([bytes.buffer as ArrayBuffer], {
            type: mimeFromFilename(basename),
          }),
          basename,
          db,
        );
        pathToStoredId.set(normalized, storedId);
        pathToStoredId.set(basename, storedId);
      }
      text = rewriteAttachmentRef(text, ref, storedId);
    }
    return text;
  }

  /** Create (and reuse) the folder tree for a document's `folder` path. */
  private async ensureFolderTree(
    db: BookmarkForgeDB,
    path: string,
    folderPathToId: Map<string, string>,
    journal?: ImportJournal,
  ): Promise<string | undefined> {
    const segments = path.split("/");
    let parentId = "root";
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const existing = folderPathToId.get(current);
      if (existing) {
        parentId = existing;
        continue;
      }
      const id = generateId();
      await insertTrackedFolder(
        db,
        {
          id,
          title: segment,
          parentId,
          createdAt: new Date().toISOString(),
        },
        journal,
      );
      folderPathToId.set(current, id);
      parentId = id;
    }
    return folderPathToId.get(path);
  }
}

/** Resolve `## Related` links: wikilinks → target bookmark URLs, URLs kept. */
function resolveBookmarkRelatedLinks(
  links: readonly MarkdownLink[],
  slugMap: ReadonlyMap<
    string,
    { type: "bookmark" | "document"; id: string; url?: string }
  >,
): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (resolved.length >= 100) {break;}
    if (link.kind === "url") {
      const url = sanitizeUrl(link.target);
      if (url.startsWith("http") && !seen.has(url)) {
        seen.add(url);
        resolved.push(url);
      }
      continue;
    }
    const target = slugMap.get(link.target);
    const url =
      target && target.type === "bookmark" ? sanitizeUrl(target.url || "") : "";
    if (url.startsWith("http") && !seen.has(url)) {
      seen.add(url);
      resolved.push(url);
    }
  }
  return resolved;
}

/** Resolve `## Linked notes` wikilinks to imported document ids. */
function resolveDocumentLinks(
  links: readonly string[],
  slugMap: ReadonlyMap<
    string,
    { type: "bookmark" | "document"; id: string; url?: string }
  >,
): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const targetName of links) {
    if (resolved.length >= 100) {break;}
    const target = slugMap.get(targetName);
    if (!target || target.type !== "document" || seen.has(target.id)) {continue;}
    seen.add(target.id);
    resolved.push(target.id);
  }
  return resolved;
}

export const universalImporter = new UniversalImporter();
