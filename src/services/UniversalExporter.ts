import type { BookmarkForgeDB } from "../db/types";
import { logger } from "../utils/logger";
import {
  BookmarkData,
  DocumentData,
  ExportData,
  ExportOptions,
  ExportResult,
} from "./exporter.types";
import {
  exportToNotion,
  exportToObsidian,
  exportToJSON,
  exportToJSONL,
  exportToCSV,
  exportToMarkdown,
  exportToHTML,
} from "./exporter.formatters";
import { attachmentStore } from "./documentAttachments";

export type { ExportOptions, ExportResult } from "./exporter.types";

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {return;}
  const error = new Error("Export cancelled");
  error.name = "AbortError";
  throw error;
}

function reportProgress(options: ExportOptions, progress: number): void {
  if (options.onProgress) {
    options.onProgress(Math.max(0, Math.min(100, progress)));
  }
}

const MAX_EXPORT_RECORDS = 100_000;
const EXPORT_YIELD_EVERY = 500;

/**
 * Materialize RxDocument proxies into plain data. RxDB v17 documents are
 * Proxy wrappers whose destructure/spread (`{ ...doc }`, `{ a, ...rest }`)
 * copies internal rxjs state (SafeSubscriber/Subscription trees) into the
 * result; JSON.stringify then dies with "Converting circular structure to
 * JSON" — every ExportDialog export failed this way. `toJSON()` returns the
 * clean record. The cast is deliberate: the pipeline types records as
 * plain data while the DB hands out RxDocuments.
 */
function toPlainRecords<T>(records: readonly T[]): T[] {
  return (records as unknown as Array<T | { toJSON(): T }>).map((record) => {
    if (
      typeof record === "object" &&
      record !== null &&
      "toJSON" in record &&
      typeof (record as { toJSON?: unknown }).toJSON === "function"
    ) {
      return (record as { toJSON(): T }).toJSON();
    }
    // Plain records are valid at this service boundary in tests and in
    // adapters that materialize RxDB documents before calling the exporter.
    return record as T;
  });
}

async function filterExportRecords<T>(
  records: readonly T[],
  predicate: (record: T) => boolean,
  options: ExportOptions,
  progressStart: number,
  progressEnd: number,
): Promise<T[]> {
  const result: T[] = [];
  for (let index = 0; index < records.length; index++) {
    throwIfAborted(options.signal);
    const record = records[index]!;
    if (predicate(record)) {result.push(record);}

    if (
      index > 0 &&
      (index % EXPORT_YIELD_EVERY === 0 || index === records.length - 1)
    ) {
      const ratio = (index + 1) / Math.max(records.length, 1);
      reportProgress(
        options,
        progressStart + Math.round((progressEnd - progressStart) * ratio),
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return result;
}

export class UniversalExporter {
  async exportData(
    db: BookmarkForgeDB,
    options: ExportOptions,
  ): Promise<ExportResult> {
    try {
      logger.info("[UniversalExporter] Starting export", {
        format: options.format,
      });
      throwIfAborted(options.signal);
      reportProgress(options, 0);

      const data = await this.prepareExportData(db, options);
      throwIfAborted(options.signal);
      reportProgress(options, 70);

      let result: ExportResult;

      switch (options.format) {
        case "notion":
          result = await exportToNotion(data, options);
          break;
        case "obsidian":
          result = await exportToObsidian(data, options);
          break;
        case "json":
          result = await exportToJSON(data, options);
          break;
        case "jsonl":
          result = await exportToJSONL(data, options);
          break;
        case "csv":
          result = await exportToCSV(data, options);
          break;
        case "markdown":
          result = await exportToMarkdown(data, options);
          break;
        case "html":
          result = await exportToHTML(data, options);
          break;
        default:
          throw new Error(`Unsupported export format: ${options.format}`);
      }

      throwIfAborted(options.signal);
      reportProgress(options, 100);
      logger.info("[UniversalExporter] Export completed", {
        format: options.format,
        success: result.success,
        size: result.size,
      });

      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          success: false,
          format: options.format,
          size: 0,
          filename: "",
          blob: new Blob(),
          error: error.message,
        };
      }
      logger.error("[UniversalExporter] Export failed", {
        format: options.format,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        format: options.format,
        size: 0,
        filename: "",
        blob: new Blob(),
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async prepareExportData(
    db: BookmarkForgeDB,
    options: ExportOptions,
  ): Promise<ExportData> {
    // Export all records; a fixed limit would silently omit the tail of a
    // large vault and produce an incomplete user export.
    throwIfAborted(options.signal);
    // Keep soft-deleted/private records out of the export pipeline entirely.
    // The later in-memory predicates remain defense in depth if a record changes
    // between the query and formatter stages.
    const bookmarks = await db.bookmarks
      .find({ selector: { isDeleted: false, isPrivate: false } })
      .exec();
    reportProgress(options, 20);
    throwIfAborted(options.signal);
    const documents = await db.documents
      .find({ selector: { isDeleted: false, isPrivate: false } })
      .exec();
    reportProgress(options, 40);
    throwIfAborted(options.signal);
    const folders = options.includeFolders
      ? await db.folders.find().exec()
      : [];
    reportProgress(options, 50);

    // Filter out soft-deleted and private items before export.
    // Users expect exports to contain only their visible, non-sensitive data.
    const tagSet = options.tags?.length ? new Set(options.tags) : null;
    const query = options.searchQuery?.toLowerCase() || "";
    const start = options.dateRange?.start.getTime();
    const end = options.dateRange?.end.getTime();
    const matchesDate = (createdAt: string | undefined): boolean => {
      if (start === undefined || end === undefined) {return true;}
      const timestamp = createdAt ? new Date(createdAt).getTime() : NaN;
      return Boolean(createdAt) && timestamp >= start && timestamp <= end;
    };
    const matchesTags = (tags: string[] | undefined): boolean =>
      !tagSet || Boolean(tags?.some((tag) => tagSet.has(tag)));

    const filteredBookmarks = await filterExportRecords(
      bookmarks,
      (b: BookmarkData) =>
        !b.isDeleted &&
        b.isPrivate === false &&
        matchesDate(b.createdAt) &&
        matchesTags(b.tags) &&
        (!query ||
          b.title.toLowerCase().includes(query) ||
          b.url.toLowerCase().includes(query) ||
          Boolean(b.summary?.toLowerCase().includes(query)) ||
          Boolean(b.content?.toLowerCase().includes(query))),
      options,
      50,
      58,
    );
    const filteredDocuments = await filterExportRecords(
      documents,
      (d: DocumentData) =>
        !d.isDeleted &&
        d.isPrivate === false &&
        matchesDate(d.createdAt) &&
        matchesTags(d.tags) &&
        (!query ||
          d.title.toLowerCase().includes(query) ||
          Boolean(d.textContent?.toLowerCase().includes(query))),
      options,
      58,
      65,
    );

    throwIfAborted(options.signal);
    const selectedFolderCount = options.includeFolders ? folders.length : 0;
    const exportRecordCount =
      filteredBookmarks.length +
      filteredDocuments.length +
      selectedFolderCount;
    if (exportRecordCount > MAX_EXPORT_RECORDS) {
      throw new Error(
        `Export contains too many records (${exportRecordCount}); maximum is ${MAX_EXPORT_RECORDS}`,
      );
    }
    reportProgress(options, 65);

    // Embeddings are large sensitive payloads and are not part of the public
    // export contract unless explicitly requested. Create shallow export
    // records instead of mutating RxDB documents or retaining vectors in the
    // formatter pipeline by default.
    // Records must be plain data BEFORE any destructure/spread: RxDB v17
    // documents are proxies whose spread copies rxjs internals (see
    // toPlainRecords). The RxDB schema carries `embedding` vectors even
    // though the static BookmarkData/DocumentData types omit the field;
    // strip it from the plain records without leaking implicit any.
    const plainBookmarks = toPlainRecords(filteredBookmarks);
    const exportBookmarks = options.includeEmbeddings
      ? plainBookmarks
      : (plainBookmarks as (BookmarkData & { embedding?: unknown })[]).map(
          ({ embedding: _embedding, ...bookmark }) => bookmark,
        );

    // Block-editor attachments persist as `bmf-attachment://<id>` refs in
    // textContent. Resolve them to self-contained `data:` URLs before the
    // formatters run, so the Obsidian exporter can extract them into an
    // `attachments/` folder and JSON/Markdown exports stay faithful instead
    // of shipping dead refs. Spread the PLAIN record (see toPlainRecords).
    const plainDocuments = toPlainRecords(filteredDocuments);
    const resolvedDocuments = await Promise.all(
      plainDocuments.map(async (document) => ({
        ...document,
        textContent: await attachmentStore.resolveTextForExport(
          document.id,
          document.textContent || "",
          db,
        ),
      })),
    );
    const exportDocuments = options.includeEmbeddings
      ? resolvedDocuments
      : (resolvedDocuments as (DocumentData & { embedding?: unknown })[]).map(
          ({ embedding: _embedding, ...document }) => document,
        );

    return {
      bookmarks: exportBookmarks,
      documents: exportDocuments,
      folders: options.includeFolders ? toPlainRecords(folders) : [],
    };
  }
}

export const universalExporter = new UniversalExporter();
