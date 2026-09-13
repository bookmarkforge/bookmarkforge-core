/**
 * useBookmarkFacade — unified facade for bookmark UI (P1-4)
 * Components should import bookmark-related services via this facade, not directly.
 * Keeps dependency graph acyclic and testable.
 */

import { useCallback } from "react";
import { initDB } from "../db/database";
import { aiManager } from "../services/ai/ProviderManager";
import { ragEngine } from "../services/ai/RAGEngine";
import { ttsService } from "../services/ai/TTSService";
import { flashcardService } from "../services/ai/FlashcardService";
import { contentFetchService } from "../services/ContentFetchService";

export function useBookmarkFacade() {
  const getDB = useCallback(() => initDB(), []);

  return {
    getDB,
    // Return getter functions (not invoked values) so callers always get
    // the current singleton reference — prevents stale references after
    // vault reset/re-initialization when singletons are replaced.
    getAIManager: useCallback(() => aiManager, []),
    getRAGEngine: useCallback(() => ragEngine, []),
    getTTS: useCallback(() => ttsService, []),
    getFlashcards: useCallback(() => flashcardService, []),
    getContentFetch: useCallback(() => contentFetchService, []),
  };
}

// Re-export hooks that already wrap DB/services for convenience
export { useBookmarkData } from "./useBookmarkData";
export { useBookmarkCRUD } from "./useBookmarkCRUD";
export { useBookmarkAI } from "./useBookmarkAI";
