import { BookmarkDocType, DocumentDocType, FolderDocType } from "../db/schema";

export interface BookmarkData extends Omit<BookmarkDocType, "embedding"> {
  embedding?: number[];
  description?: string;
  favicon?: string;
  archived?: boolean;
  folderId?: string;
}

export interface DocumentData extends Omit<DocumentDocType, "embedding"> {
  embedding?: number[];
}

type FolderData = FolderDocType;

export interface ExportData {
  bookmarks: BookmarkData[];
  documents: DocumentData[];
  folders: FolderData[];
}

export interface ExportOptions {
  format:
    | "notion"
    | "obsidian"
    | "json"
    | "jsonl"
    | "csv"
    | "markdown"
    | "html";
  includeEmbeddings?: boolean;
  includeFolders?: boolean;
  dateRange?: { start: Date; end: Date };
  tags?: string[];
  searchQuery?: string;
  /** Abort an export before its final Blob is generated. */
  signal?: AbortSignal;
  /** Progress callback in the inclusive range 0..100. */
  onProgress?: (progress: number) => void;
}

export interface ExportResult {
  success: boolean;
  format: string;
  size: number;
  filename: string;
  blob: Blob;
  error?: string;
}
