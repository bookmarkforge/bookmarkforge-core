/**
 * src/services/importer.journal.ts — import journal, pending-rollback
 * persistence and tracked inserts for UniversalImporter.
 *
 * Extracted from UniversalImporter.ts: the rollback
 * machinery is self-contained — it owns the sessionStorage journal schema,
 * the batched bulkRemove rollback and the insert helpers that record ids for
 * later undo. UniversalImporter keeps the format parsers and orchestration.
 */
import type { BookmarkForgeDB } from "../db/types";
import type {
  BookmarkDocType,
  DocumentDocType,
  FolderDocType,
} from "../db/schema";
import { logger } from "../utils/logger";
import { isFreeLimitError } from "./LicenseService";
import { STORAGE_KEYS } from "../constants/storage-keys";

export interface ImportResult {
  success: boolean;
  importedCount: number;
  skippedCount: number;
  error?: string;
  rollbackIncomplete?: boolean;
  /** True when the Free-tier wall stopped the import after a partial save. */
  limitReached?: boolean;
}

export interface RollbackResult {
  completed: boolean;
}

export interface ImportJournal {
  bookmarkIds: string[];
  documentIds: string[];
  folderIds: string[];
}

export type CSVRecordSource = Iterable<string> | AsyncIterable<string>;

export interface ImportOptions {
  /** Abort parsing and database writes for a closing/cancelled import. */
  signal?: AbortSignal;
  /** Progress callback in the inclusive range 0..100. */
  onProgress?: (progress: number) => void;
}

export type ImportExecutionOptions = ImportOptions & {
  journal: ImportJournal;
  recordsSeen: number;
  importedCount: number;
};

/** Internal control-flow error: a limit is a partial, honest result, not a rollback. */
export class FreeTierImportLimitReached extends Error {
  constructor(
    readonly importedCount: number,
    readonly skippedCount: number,
  ) {
    super("FREE_LIMIT_REACHED");
    this.name = "FreeTierImportLimitReached";
  }
}

export function createImportExecutionOptions(
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

export function loadPendingRollback(): ImportJournal | null {
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

export function persistPendingRollback(journal: ImportJournal): void {
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

export function clearPersistedRollback(): void {
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

export async function rollbackImport(
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

export async function insertTrackedBookmark(
  db: BookmarkForgeDB,
  document: BookmarkDocType,
  journal?: ImportJournal,
): Promise<void> {
  await db.bookmarks.insert(document);
  journal?.bookmarkIds.push(document.id);
}

export async function insertTrackedDocument(
  db: BookmarkForgeDB,
  document: DocumentDocType,
  journal?: ImportJournal,
): Promise<void> {
  await db.documents.insert(document);
  journal?.documentIds.push(document.id);
}

export async function insertTrackedFolder(
  db: BookmarkForgeDB,
  folder: FolderDocType,
  journal?: ImportJournal,
): Promise<void> {
  await db.folders.insert(folder);
  journal?.folderIds.push(folder.id);
}

export function getLimitResult(
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

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {return;}
  const error = new Error("Import cancelled");
  error.name = "AbortError";
  throw error;
}
