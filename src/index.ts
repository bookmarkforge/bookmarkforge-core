// Re-export only what's needed — avoid wildcard exports that defeat tree-shaking.
// Import schemas and types directly from their source files.
export type {
  BookmarkDocType,
  DocumentDocType,
  FolderDocType,
  TemplateDocType,
  FlashcardDocType,
  VectorIndexDocType,
  ChunkDocType,
} from "./db/schema";
export type {
  Prettify,
  Optional,
  Nullable,
  DeepPartial,
  DeepReadonly,
  Result,
  Ok,
  Err,
} from "./utils/types";

export { useMainAppState, useAppInit } from "./hooks/useMainAppState";

export { securityVault } from "./services/SecurityVault";
export { aiManager } from "./services/ai/ProviderManager";

export { initDB, getDB, destroyDB } from "./container/database";

export { useSecurityStore } from "./hooks/useSecurityStore";
export { useTabManager } from "./hooks/useTabManager";

import type { RxDatabase } from "rxdb";
import type { ReactNode } from "react";

export type { RxDatabase, ReactNode };
