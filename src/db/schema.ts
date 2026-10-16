import { RxJsonSchema } from "rxdb";

export interface VectorIndexDocType {
  id: string;
  documentId: string;
  chunkId: string;
  embedding: number[];
  createdAt: string;
}

export interface BookmarkDocType {
  id: string;
  url: string;
  /** SHA-256 hex of the normalized URL — clear-text, indexed for dedup. */
  urlHash: string;
  title: string;
  content?: string;
  summary?: string;
  tags: string[];
  relatedLinks: string[];
  embedding?: number[];
  processed: boolean;
  isPrivate: boolean; // Force local AI
  isDeleted: boolean;
  broken?: boolean;
  lastChecked?: string;
  visitCount: number;
  lastVisitedAt?: string;
  /** Read state imported from Pocket or set by the user; omitted means legacy/unknown. */
  isRead?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentAttachmentDocType {
  id: string;
  documentId: string;
  /** Original file name (for exports). */
  filename: string;
  /** MIME type of the attachment (e.g. image/png). */
  mimeType: string;
  /** Full `data:<mime>;base64,...` URL — encrypted at rest. */
  dataUrl: string;
  /** Byte size of the decoded payload. */
  size: number;
  createdAt: string;
}

export interface DocumentDocType {
  id: string;
  folderId: string;
  title: string;
  blocks: unknown[];
  textContent?: string;
  summary?: string;
  tags: string[];
  links: string[];
  embedding?: number[];
  processed: boolean;
  isPrivate: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FolderDocType {
  id: string;
  title: string;
  parentId: string;
  createdAt: string;
}

export interface TemplateDocType {
  id: string;
  title: string;
  blocks: unknown[];
  createdAt: string;
}

export interface VersionDocType {
  id: string;
  documentId: string;
  blocks: unknown[];
  createdAt: string;
}

export interface FlashcardDocType {
  id: string;
  documentId: string;
  sourceType: "document" | "bookmark";
  question: string;
  answer: string;
  nextReview: string;
  interval: number;
  easeFactor: number;
  repetition: number;
  createdAt: string;
}

export interface MessageDocType {
  id: string;
  role: string;
  content: string;
  sources?: unknown[];
  groundingMetadata?: unknown;
  sourceOrigin?: "local" | "web";
  isTranslationKey?: boolean;
  isError?: boolean;
  retryQuery?: string;
  createdAt: string;
}

export interface HighlightDocType {
  id: string;
  bookmarkId: string;
  text: string;
  color: string;
  note: string;
  createdAt: string;
}

export interface ChunkDocType {
  id: string;
  parentId: string;
  parentType: "document" | "bookmark";
  /** Copied from the parent at creation; missing legacy metadata is private by default. */
  isPrivate: boolean;
  content: string;
  embedding: number[];
  index: number;
  createdAt: string;
}

export const bookmarkSchema: RxJsonSchema<BookmarkDocType> = {
  title: "bookmark schema",
  // v5: url stays plaintext because it is indexed for dedup — encrypted
  // fields cannot be indexed (see folder/highlight/insight schemas). It was
  // previously encrypted+indexed, which silently broke findOne-by-url dedup
  // (queries match ciphertext, never plaintext) and crashed the Memory
  // storage with "maxLength not set" on the stripped url index.
  //
  // v6: url moves back to encrypted — dedup now uses urlHash (a clear-text
  // SHA-256 hex of the normalized URL). urlHash is indexed and non-encrypted;
  // the actual URL is ciphertext at rest. Migration v6 backfills urlHash for
  // all existing bookmarks.
  // content/summary/relatedLinks also gain explicit maxLength so oversized
  // documents fail schema validation cleanly instead of relying on implicit
  // bounds.
  //
  // v7: authenticated-at-rest envelope (F-06). The document shape is
  // unchanged; the bump forces RxDB to rewrite every row through the
  // authenticatedEncryptionStorage layer, upgrading legacy rows to the
  // tamper-evident format.
  //
  // v8: preserve an explicit read state for imports (Pocket Unread/Read).
  // Archive is not overloaded into deletion; Pocket archive is retained as
  // the `pocket-archive` tag until a first-class archive lifecycle exists.
  version: 8,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    url: { type: "string", maxLength: 2000 },
    urlHash: { type: "string", maxLength: 64 }, // SHA-256 hex, clear-text for dedup
    title: { type: "string", maxLength: 500 },
    content: { type: "string", maxLength: 10_000_000 }, // DOM Snapshot / Markdown
    summary: { type: "string", maxLength: 100_000 }, // AI Generated
    tags: { type: "array", items: { type: "string" } },
    relatedLinks: { type: "array", items: { type: "string", maxLength: 2000 } },
    embedding: { type: "array", items: { type: "number" } }, // Vector for RAG
    processed: { type: "boolean" },
    isPrivate: { type: "boolean" }, // Force local AI
    isDeleted: { type: "boolean" }, // Soft delete
    broken: { type: "boolean" },
    lastChecked: { type: "string", format: "date-time", maxLength: 100 },
    lastVisitedAt: { type: "string", format: "date-time", maxLength: 100 },
    visitCount: { type: "number", multipleOf: 1, minimum: 0, maximum: 1000000 },
    isRead: { type: "boolean" },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
    updatedAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: [
    "id",
    "url",
    "urlHash",
    "title",
    "createdAt",
    "updatedAt",
    "processed",
    "isPrivate",
    "isDeleted",
  ],
  indexes: [
    "urlHash", // Deduplication on import/capture (findOne by urlHash)
    "createdAt",
    "updatedAt",
    "processed",
    "isDeleted",
    ["isPrivate", "isDeleted", "createdAt"], // Private bookmarks filter
    // Compound indexes for common query patterns (sorted by query frequency)
    ["isDeleted", "createdAt"], // Main listing query
    ["isDeleted", "updatedAt"], // Recently updated
    ["processed", "isDeleted"], // Processing queue
    ["processed", "createdAt"], // Batch operations
    ["isDeleted", "processed", "createdAt"], // Combined filter + sort
  ],
  encrypted: [
    "url",
    "title",
    "content",
    "summary",
    "relatedLinks",
    "embedding",
  ],
};

export const documentAttachmentSchema: RxJsonSchema<DocumentAttachmentDocType> =
  {
    title: "document attachment schema",
    // v1: bytes travel as a `data:` URL string because the CryptoJS
    // encryption wrapper JSON-serializes fields (Blob/Uint8Array cannot
    // survive the round-trip). The data URL is self-describing (carries its
    // own MIME type) and the Obsidian exporter already decodes data: URLs.
    // documentId stays plaintext (indexed); filename/mimeType/dataUrl are
    // encrypted at rest alongside every other user payload.
    // v2: authenticated-at-rest envelope (F-06) — identity migration.
    version: 2,
    primaryKey: "id",
    type: "object",
    properties: {
      id: { type: "string", maxLength: 200 },
      documentId: { type: "string", maxLength: 100 },
      filename: { type: "string", maxLength: 500 },
      mimeType: { type: "string", maxLength: 200 },
      // base64 of ~15 MB binary ≈ 20M chars; 20_000_000 is the explicit cap.
      dataUrl: { type: "string", maxLength: 20_000_000 },
      size: {
        type: "number",
        multipleOf: 1,
        minimum: 0,
        maximum: 20_000_000,
      },
      createdAt: { type: "string", format: "date-time", maxLength: 100 },
    },
    required: [
      "id",
      "documentId",
      "filename",
      "mimeType",
      "dataUrl",
      "size",
      "createdAt",
    ],
    indexes: ["documentId"],
    encrypted: ["filename", "mimeType", "dataUrl"],
  };

export const documentSchema: RxJsonSchema<DocumentDocType> = {
  title: "document schema",
  // v2: authenticated-at-rest envelope (F-06) — identity migration.
  version: 2,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    folderId: { type: "string", maxLength: 100 }, // ID of the folder
    title: { type: "string", maxLength: 500 },
    blocks: { type: "array", items: { type: "object" } }, // Notion-like blocks
    textContent: { type: "string" }, // Plain text for embeddings
    summary: { type: "string" }, // AI Generated
    tags: { type: "array", items: { type: "string" } },
    links: { type: "array", items: { type: "string" } }, // IDs of linked documents
    embedding: { type: "array", items: { type: "number" } }, // Vector for RAG
    processed: { type: "boolean" },
    isPrivate: { type: "boolean" }, // Force local AI
    isDeleted: { type: "boolean" }, // Soft delete
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
    updatedAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: [
    "id",
    "title",
    "createdAt",
    "folderId",
    "updatedAt",
    "processed",
    "isPrivate",
    "isDeleted",
  ],
  indexes: [
    "createdAt",
    "updatedAt",
    "folderId",
    "processed",
    "isDeleted",
    // Compound indexes optimized for real query patterns
    ["folderId", "isDeleted", "createdAt"], // Folder view with sorting
    ["folderId", "isDeleted", "updatedAt"], // Folder view recently updated
    ["isDeleted", "createdAt"], // Global recent docs
    ["isDeleted", "updatedAt"], // Global recently updated
    ["isPrivate", "isDeleted", "createdAt"], // Private docs filter
    ["processed", "isDeleted"], // AI processing queue
  ],
  encrypted: [
    "title",
    "blocks",
    "textContent",
    "summary",
    "links",
    "embedding",
  ],
};

export const folderSchema: RxJsonSchema<FolderDocType> = {
  title: "folder schema",
  // v3: title encrypted at rest. parentId/createdAt stay plaintext — they
  // are indexed (subtree queries) and encrypted fields cannot be indexed.
  // v4: authenticated-at-rest envelope (F-06) — identity migration.
  version: 4,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    title: { type: "string", maxLength: 500 },
    parentId: { type: "string", maxLength: 100 }, // For subfolders
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: ["id", "title", "parentId", "createdAt"],
  indexes: ["parentId"],
  encrypted: ["title"],
};

export const templateSchema: RxJsonSchema<TemplateDocType> = {
  title: "template schema",
  // v2: title + blocks encrypted at rest (templates have no indexed fields).
  // v3: authenticated-at-rest envelope (F-06) — identity migration.
  version: 3,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    title: { type: "string", maxLength: 500 },
    blocks: { type: "array", items: { type: "object" } },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: ["id", "title", "blocks", "createdAt"],
  encrypted: ["title", "blocks"],
};

export const versionSchema: RxJsonSchema<VersionDocType> = {
  title: "version schema",
  // v2: authenticated-at-rest envelope (F-06) — identity migration.
  version: 2,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    documentId: { type: "string", maxLength: 100 },
    blocks: { type: "array", items: { type: "object" } },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: ["id", "documentId", "blocks", "createdAt"],
  indexes: ["documentId", "createdAt"],
  encrypted: ["blocks"],
};

export const flashcardSchema: RxJsonSchema<FlashcardDocType> = {
  title: "flashcard schema",
  // v2: authenticated-at-rest envelope (F-06) — identity migration.
  version: 2,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    documentId: { type: "string", maxLength: 100 },
    sourceType: { type: "string", maxLength: 20 },
    question: { type: "string", maxLength: 1000 },
    answer: { type: "string", maxLength: 5000 },
    nextReview: { type: "string", format: "date-time", maxLength: 100 },
    interval: { type: "number", multipleOf: 1, minimum: 0, maximum: 36500 }, // Days (0 to 100 years)
    easeFactor: {
      type: "number",
      multipleOf: 0.01,
      minimum: 1.0,
      maximum: 3.0,
    }, // SM-2 algorithm
    repetition: { type: "number", multipleOf: 1, minimum: 0, maximum: 10000 },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: [
    "id",
    "documentId",
    "sourceType",
    "question",
    "answer",
    "nextReview",
    "interval",
    "createdAt",
  ],
  indexes: [
    "documentId",
    "nextReview",
    // Compound index for spaced repetition queries
    ["documentId", "nextReview"],
    // Index for finding cards due for review across all documents
    ["nextReview", "interval"],
  ],
  encrypted: ["question", "answer"],
};

export const messageSchema: RxJsonSchema<MessageDocType> = {
  title: "message schema",
  // v2 adds optional grounding metadata/source origin fields. Keep the
  // version explicit so RxDB migrates existing encrypted message records
  // instead of opening them against a changed schema silently.
  // v3: authenticated-at-rest envelope (F-06) — identity migration.
  // v4: persisted retryable provider-error messages.
  version: 4,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    role: { type: "string", maxLength: 50 },
    content: { type: "string" },
    sources: { type: "array", items: { type: "object" } },
    groundingMetadata: { type: "object" },
    sourceOrigin: { type: "string", enum: ["local", "web"] },
    isTranslationKey: { type: "boolean" },
    isError: { type: "boolean" },
    retryQuery: { type: "string", maxLength: 100000 },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: ["id", "role", "content", "createdAt"],
  indexes: ["createdAt", "role"],
  encrypted: ["content", "sources", "groundingMetadata", "retryQuery"],
};

export const highlightSchema: RxJsonSchema<HighlightDocType> = {
  title: "highlight schema",
  // v2: user-authored text/note encrypted at rest. bookmarkId stays
  // plaintext — it is indexed and encrypted fields cannot be indexed.
  // v3: authenticated-at-rest envelope (F-06) — identity migration.
  version: 3,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    bookmarkId: { type: "string", maxLength: 100 },
    text: { type: "string" },
    color: { type: "string", maxLength: 50 },
    note: { type: "string" },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: ["id", "bookmarkId", "text", "color", "createdAt"],
  indexes: ["bookmarkId"],
  encrypted: ["text", "note"],
};

export interface InsightDocType {
  id: string;
  type: "connection" | "summary" | "suggestion";
  title: string;
  content: string;
  relatedIds: string[];
  isRead: boolean;
  createdAt: string;
}

export const insightSchema: RxJsonSchema<InsightDocType> = {
  title: "insight schema",
  // v2: AI-generated title/content + relatedIds encrypted at rest.
  // type/createdAt stay plaintext (indexed); isRead is a non-sensitive flag.
  // v3: authenticated-at-rest envelope (F-06) — identity migration.
  version: 3,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    type: { type: "string", maxLength: 20 },
    title: { type: "string" },
    content: { type: "string" },
    relatedIds: { type: "array", items: { type: "string" } },
    isRead: { type: "boolean" },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: [
    "id",
    "type",
    "title",
    "content",
    "relatedIds",
    "isRead",
    "createdAt",
  ],
  indexes: ["type", "createdAt"],
  encrypted: ["title", "content", "relatedIds"],
};

export const chunkSchema: RxJsonSchema<ChunkDocType> = {
  title: "chunk schema",
  // v2: every chunk carries the parent's privacy decision. Public RAG uses an
  // exact `isPrivate: false` selector so legacy/malformed rows cannot match.
  // v3: authenticated-at-rest envelope (F-06) — identity migration.
  version: 3,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    parentId: { type: "string", maxLength: 100 },
    parentType: { type: "string", maxLength: 20 }, // 'document' | 'bookmark'
    isPrivate: { type: "boolean" },
    content: { type: "string" },
    embedding: { type: "array", items: { type: "number" } },
    index: { type: "number", multipleOf: 1, minimum: 0, maximum: 100000 },
    createdAt: { type: "string", format: "date-time", maxLength: 100 },
  },
  required: [
    "id",
    "parentId",
    "parentType",
    "isPrivate",
    "content",
    "embedding",
    "index",
    "createdAt",
  ],
  indexes: [
    "parentId",
    "parentType",
    "index",
    // Compound index for ordered chunk retrieval
    ["parentId", "parentType", "index"],
    ["isPrivate", "parentType", "parentId"], // Public/private RAG partition
    // Index for chunks by creation time
    ["parentId", "createdAt"],
  ],
  encrypted: ["content", "embedding"],
};
