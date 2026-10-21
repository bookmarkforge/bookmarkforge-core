import type { RxDocument, RxCollection, RxDatabase } from "rxdb";
import type {
  DocumentDocType,
  DocumentAttachmentDocType,
  TemplateDocType,
  FlashcardDocType,
  BookmarkDocType,
  FolderDocType,
  VersionDocType,
  MessageDocType,
  ChunkDocType,
  HighlightDocType,
  InsightDocType,
} from "./schema";
import type {
  MemoryRecord,
} from "../memory/MemoryTypes";

export type DocumentDocument = RxDocument<DocumentDocType>;
export type TemplateDocument = RxDocument<TemplateDocType>;
export type FlashcardDocument = RxDocument<FlashcardDocType>;

type RxDatabaseWithMethods = RxDatabase & {
  addCollections(collections: Record<string, unknown>): Promise<unknown>;
  destroy(): Promise<void>;
};

export type BookmarkForgeDB = RxDatabaseWithMethods & {
  bookmarks: RxCollection<BookmarkDocType>;
  documents: RxCollection<DocumentDocType>;
  documentAttachments: RxCollection<DocumentAttachmentDocType>;
  folders: RxCollection<FolderDocType>;
  templates: RxCollection<TemplateDocType>;
  versions: RxCollection<VersionDocType>;
  flashcards: RxCollection<FlashcardDocType>;
  messages: RxCollection<MessageDocType>;
  chunks: RxCollection<ChunkDocType>;
  highlights: RxCollection<HighlightDocType>;
  memory: RxCollection<MemoryRecord>;
  insights: RxCollection<InsightDocType>;
};
