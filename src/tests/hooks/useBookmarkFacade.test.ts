import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBookmarkFacade } from "../../hooks/useBookmarkFacade";

// The facade is the P1-4 anti-corruption layer for bookmark UI: it hands out
// the production singletons. Mock every backing module so the test stays a
// pure wiring check and never boots heavy services (RxDB, RAG, TTS).
vi.mock("../../db/database", () => ({ initDB: vi.fn() }));
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: { id: "aiManager-mock" },
}));
vi.mock("../../services/ai/RAGEngine", () => ({
  ragEngine: { id: "ragEngine-mock" },
}));
vi.mock("../../services/ai/TTSService", () => ({
  ttsService: { id: "ttsService-mock" },
}));
// Flashcard generation is Pro: the facade hands out the loader promise, so
// the double is installed at the pro-access loader instead of the Pro module.
vi.mock("../../services/pro-access", () => ({
  loadFlashcardService: () =>
    Promise.resolve({ id: "flashcardService-mock" }),
  ProUnavailableError: class ProUnavailableError extends Error {},
}));
vi.mock("../../services/ContentFetchService", () => ({
  contentFetchService: { id: "contentFetchService-mock" },
}));

describe("useBookmarkFacade", () => {
  it("exposes the production singletons through a single seam", async () => {
    const { result } = renderHook(() => useBookmarkFacade());

    expect(result.current.getDB).toBeTypeOf("function");
    expect(result.current.getAIManager()).toMatchObject({ id: "aiManager-mock" });
    expect(result.current.getRAGEngine()).toMatchObject({ id: "ragEngine-mock" });
    expect(result.current.getTTS()).toMatchObject({ id: "ttsService-mock" });
    expect(await result.current.getFlashcards()).toMatchObject({
      id: "flashcardService-mock",
    });
    expect(result.current.getContentFetch()).toMatchObject({
      id: "contentFetchService-mock",
    });
  });

  it("getDB resolves to initDB() on every call", () => {
    const { result } = renderHook(() => useBookmarkFacade());
    const db = result.current.getDB();
    expect(db).toBeUndefined(); // initDB mocked; call must not throw
  });

  it("re-exports the bookmark hook wrappers for convenience", async () => {
    const mod = await import("../../hooks/useBookmarkFacade");
    expect(typeof mod.useBookmarkData).toBe("function");
    expect(typeof mod.useBookmarkCRUD).toBe("function");
    expect(typeof mod.useBookmarkAI).toBe("function");
  });

  it("keeps getters stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useBookmarkFacade());
    const first = result.current;
    rerender();
    expect(result.current.getDB).toBe(first.getDB);
    expect(result.current.getDB).toBeTypeOf("function");
  });
});
