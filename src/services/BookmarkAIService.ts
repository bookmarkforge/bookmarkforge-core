import { Bookmark, AIManager, TranslationFunction } from "../types";
import { initDB } from "../db/database";
import { ragEngine } from "./ai/RAGEngine";
import { logger } from "../utils/logger";
import { safeErrorForLog } from "../utils/safeErrorForLog";

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {return;}
  const error = new Error("Bookmark AI operation cancelled");
  error.name = "AbortError";
  throw error;
}

class BookmarkAIService {
  async summarize(
    bookmark: Bookmark,
    t: TranslationFunction,
    aiManager: AIManager,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const prompt = t("summarizePrompt", {
      title: bookmark.title,
      url: bookmark.url,
    });
    const systemPrompt = t("summarizeSystemPrompt");
    const res = await aiManager.generateText(prompt, systemPrompt, {
      isPrivate: bookmark.isPrivate !== false,
      signal,
    });
    throwIfAborted(signal);

    let embedding: number[] = [];
    try {
      embedding = await ragEngine.generateEmbedding(
        `${bookmark.title} ${res.text}`,
        signal,
      );
    } catch (err) {
      logger.warn("Could not generate embedding for bookmark", { error: safeErrorForLog(err) });
    }

    const db = await initDB();
    throwIfAborted(signal);
    const doc = await db.bookmarks.findOne(bookmark.id).exec();
    if (doc) {
      await doc.incrementalPatch({
        summary: res.text,
        embedding,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async generateDetailedContent(
    bookmark: Bookmark,
    t: TranslationFunction,
    aiManager: AIManager,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const info = aiManager.getProviderInfo();
    const prompt = t("detailedOverviewPrompt", {
      title: bookmark.title,
      url: bookmark.url,
    });
    const systemPrompt = t("detailedOverviewSystemPrompt");
    let detailedContent = "";
    if (info.provider === "gemini") {
      const response = await aiManager.generateText(prompt, systemPrompt, {
        tools: [{ urlContext: {} }],
        isPrivate: bookmark.isPrivate !== false,
        signal,
      });
      detailedContent = response.text || t("couldNotGenerateContent");
    } else {
      const res = await aiManager.generateText(prompt, systemPrompt, {
        isPrivate: bookmark.isPrivate !== false,
        signal,
      });
      detailedContent = res.text || t("couldNotGenerateContent");
    }
    throwIfAborted(signal);

    const db = await initDB();
    throwIfAborted(signal);
    const doc = await db.bookmarks.findOne(bookmark.id).exec();
    if (doc) {
      await doc.incrementalPatch({
        content: detailedContent,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async batchSummarize(
    bookmarks: Bookmark[],
    t: TranslationFunction,
    aiManager: AIManager,
    reportProgress: (id: string | null) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const unsummarized = bookmarks.filter((b) => !b.summary);
    const CONCURRENCY = 3;
    for (let i = 0; i < unsummarized.length; i += CONCURRENCY) {
      throwIfAborted(signal);
      const batch = unsummarized.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (bookmark) => {
          reportProgress(bookmark.id);
          try {
            await this.summarize(bookmark, t, aiManager, signal);
          } catch (err) {
            logger.error("Batch summarize failed for bookmark", {
              bookmarkId: bookmark.id,
              error: safeErrorForLog(err),
            });
          }
        }),
      );
    }
  }

  async batchGenerateOverviews(
    bookmarks: Bookmark[],
    t: TranslationFunction,
    aiManager: AIManager,
    reportProgress: (id: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const ungenerated = bookmarks.filter((b) => !b.content);
    const CONCURRENCY = 3;
    for (let i = 0; i < ungenerated.length; i += CONCURRENCY) {
      throwIfAborted(signal);
      const batch = ungenerated.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (bookmark) => {
          reportProgress(bookmark.id);
          try {
            await this.generateDetailedContent(bookmark, t, aiManager, signal);
          } catch (err) {
            logger.error("Batch overview failed for bookmark", {
              bookmarkId: bookmark.id,
              error: safeErrorForLog(err),
            });
          }
        }),
      );
    }
  }

  async batchGenerateOverviewsByIds(
    ids: Set<string>,
    t: TranslationFunction,
    aiManager: AIManager,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const db = await initDB();
    const docs = await db.bookmarks
      .find({ selector: { id: { $in: Array.from(ids) }, content: "" } })
      .exec();
    for (const doc of docs) {
      throwIfAborted(signal);
      await this.generateDetailedContent(
        doc.toJSON() as Bookmark,
        t,
        aiManager,
        signal,
      );
    }
  }

  async generateMissingEmbeddings(
    bookmarks: Bookmark[],
    reportProgress: () => void,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const missing = bookmarks.filter(
      (b) => !b.embedding || b.embedding.length === 0,
    );
    const db = await initDB();
    const CONCURRENCY = 5;
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      throwIfAborted(signal);
      const batch = missing.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (bookmark) => {
          try {
            const textToEmbed =
              `${bookmark.title} ${bookmark.summary || ""} ${bookmark.content || ""}`.trim();
            const embedding = await ragEngine.generateEmbedding(
              textToEmbed,
              signal,
            );
            throwIfAborted(signal);
            const doc = await db.bookmarks.findOne(bookmark.id).exec();
            if (doc) {
              await doc.incrementalPatch({
                embedding,
                updatedAt: new Date().toISOString(),
              });
            }
          } catch (err) {
            logger.error("Failed to generate embedding", {
              bookmarkId: bookmark.id,
              error: safeErrorForLog(err),
            });
          }
          reportProgress();
        }),
      );
    }
  }
}

export const bookmarkAIService = new BookmarkAIService();
