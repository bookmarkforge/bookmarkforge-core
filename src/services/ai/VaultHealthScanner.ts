import { initDB } from "../../db/database";
import type {
  BookmarkDocType,
  ChunkDocType,
  DocumentDocType,
} from "../../db/schema";
import { vectorIndexService } from "./VectorIndexService";
import { securityVault } from "../SecurityVault";
import { logger } from "../../utils/logger";

const MAX_SCAN_ITEMS = 50_000;
const MAX_REPORTED_IDS = 100;

type VaultHealthIssueKind =
  | "pending-processing"
  | "missing-embedding"
  | "orphan-chunk"
  | "index-rebuild-recommended";

interface VaultHealthIssue {
  kind: VaultHealthIssueKind;
  count: number;
  sampleIds: string[];
}

export interface VaultHealthReport {
  scannedAt: string;
  isVaultLocked: boolean;
  complete: boolean;
  bookmarkCount: number;
  documentCount: number;
  chunkCount: number;
  issues: VaultHealthIssue[];
  vectorIndexStatus: string;
  vectorIndexLoadDurationMs: number | null;
}

interface CollectionLike<T> {
  find: (query?: Record<string, unknown>) => {
    exec: () => Promise<Array<T & { id: string; toJSON?: () => T }>>;
  };
}

interface HealthDb {
  bookmarks: CollectionLike<BookmarkDocType>;
  documents: CollectionLike<DocumentDocType>;
  chunks: CollectionLike<ChunkDocType>;
}

function createAbortError(): Error {
  const error = new Error("Vault health scan aborted");
  error.name = "AbortError";
  return error;
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
  if (securityVault.isLocked()) {
    const error = new Error("Vault health scan requires an unlocked vault");
    error.name = "VAULT_LOCKED";
    throw error;
  }
}

function asPlain<T>(value: T & { toJSON?: () => T }): T {
  return typeof value.toJSON === "function" ? value.toJSON() : value;
}

function sampleIds(ids: string[]): string[] {
  return ids.slice(0, MAX_REPORTED_IDS);
}

function addIssue(
  issues: VaultHealthIssue[],
  kind: VaultHealthIssueKind,
  ids: string[],
): void {
  if (ids.length > 0) {
    issues.push({ kind, count: ids.length, sampleIds: sampleIds(ids) });
  }
}

/**
 * Performs a bounded, local-only structural scan of the unlocked vault.
 * It deliberately does not inspect or return text, titles, URLs, prompts,
 * embeddings, or other user content.
 */
export async function scanVaultHealth(signal?: AbortSignal): Promise<VaultHealthReport> {
  assertActive(signal);
  const db = (await initDB()) as unknown as HealthDb;
  assertActive(signal);

  const [bookmarkRows, documentRows, chunkRows] = await Promise.all([
    db.bookmarks.find({ selector: { isDeleted: false } }).exec(),
    db.documents.find({ selector: { isDeleted: false } }).exec(),
    db.chunks.find().exec(),
  ]);
  assertActive(signal);

  const bookmarks = bookmarkRows.map(asPlain);
  const documents = documentRows.map(asPlain);
  const chunks = chunkRows.map(asPlain);
  const totalRows = bookmarks.length + documents.length + chunks.length;
  if (totalRows > MAX_SCAN_ITEMS) {
    logger.warn("[VaultHealthScanner] Scan limit reached", {
      rowCount: totalRows,
      limit: MAX_SCAN_ITEMS,
    });
  }

  const boundedBookmarks = bookmarks.slice(0, MAX_SCAN_ITEMS);
  const boundedDocuments = documents.slice(0, Math.max(0, MAX_SCAN_ITEMS - boundedBookmarks.length));
  const remaining = Math.max(0, MAX_SCAN_ITEMS - boundedBookmarks.length - boundedDocuments.length);
  const boundedChunks = chunks.slice(0, remaining);

  const pendingIds = [
    ...boundedBookmarks.filter((item) => item.processed !== true).map((item) => item.id),
    ...boundedDocuments.filter((item) => item.processed !== true).map((item) => item.id),
  ];
  const missingEmbeddingIds = [
    ...boundedBookmarks
      .filter((item) => !Array.isArray(item.embedding) || item.embedding.length === 0)
      .map((item) => item.id),
    ...boundedDocuments
      .filter((item) => !Array.isArray(item.embedding) || item.embedding.length === 0)
      .map((item) => item.id),
  ];

  const liveParents = new Set<string>([
    ...boundedBookmarks.map((item) => item.id),
    ...boundedDocuments.map((item) => item.id),
  ]);
  const orphanChunkIds = boundedChunks
    .filter((chunk) => !liveParents.has(chunk.parentId))
    .map((chunk) => chunk.id);

  const issues: VaultHealthIssue[] = [];
  addIssue(issues, "pending-processing", pendingIds);
  addIssue(issues, "missing-embedding", missingEmbeddingIds);
  addIssue(issues, "orphan-chunk", orphanChunkIds);

  const indexStatus = vectorIndexService.getLoadStatus();
  if (["unknown", "malformed-rebuilt", "legacy-rebuilt"].includes(indexStatus)) {
    issues.push({
      kind: "index-rebuild-recommended",
      count: 1,
      sampleIds: [],
    });
  }

  return {
    scannedAt: new Date().toISOString(),
    isVaultLocked: false,
    complete: totalRows <= MAX_SCAN_ITEMS,
    bookmarkCount: bookmarks.length,
    documentCount: documents.length,
    chunkCount: chunks.length,
    issues,
    vectorIndexStatus: indexStatus,
    vectorIndexLoadDurationMs: vectorIndexService.getLoadDurationMs(),
  };
}
