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
import { contentFetchService } from "../services/ContentFetchService";
import { loadFlashcardService, ProUnavailableError } from "../services/pro-access";

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
    getContentFetch: useCallback(() => contentFetchService, []),
    // Flashcard generation is Pro: the facade exposes the *promise* so the
    // caller can decide between the engine (Pro) and the upgrade message
    // (Free / Open Core export), instead of silently holding a dead ref.
    getFlashcards: useCallback(
      () =>
        loadFlashcardService().catch((err: unknown) => {
          if (!(err instanceof ProUnavailableError)) {
            throw err;
          }
          return null as unknown as never;
        }),
      [],
    ),
  };
}

// Re-export hooks that already wrap DB/services for convenience
export { useBookmarkData } from "./useBookmarkData";
export { useBookmarkCRUD } from "./useBookmarkCRUD";
export { useBookmarkAI } from "./useBookmarkAI";
