// RAGEngine - Retrieval Augmented Generation using backend embeddings
// Now using dynamic imports to avoid loading transformers at startup

import { resourceManager } from "./ResourceManager";
import { getWorkerPool } from "../../utils/WorkerPool";
import { configureModelIntegrity } from "../../utils/modelIntegrity";
// Vite's static detection only compiles workers for `new Worker(new URL(...))`
// patterns. This worker is created indirectly via getWorkerPool(), so the
// `?worker&url` suffix is required: without it the raw .ts source was emitted
// into dist/assets (embedding.worker-*.ts) and the browser tried to run
// TypeScript as a worker module, throwing on `import type` syntax.
import embeddingWorkerUrl from "./embedding.worker.ts?worker&url";
import type { ProgressCallback as _ProgressCallback } from "../../utils/WorkerPool";
import { logger } from "../../utils/logger";
import { securityVault } from "../SecurityVault";
import { hashCacheKey } from "../../utils/hash";
import type { Bookmark } from "../../types";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_PIPELINE_OPTIONS,
} from "./embeddingModel";

type EmbeddingProgressListener = (
  status: "loading" | "ready",
  message?: string,
) => void;
const progressListeners = new Set<EmbeddingProgressListener>();

export function onEmbeddingProgress(
  listener: EmbeddingProgressListener,
): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

function notifyProgress(status: "loading" | "ready", message?: string) {
  progressListeners.forEach((listener) => {
    try {
      listener(status, message);
    } catch (error) {
      // UI progress listeners are observers and must never change the
      // success/failure semantics of an embedding request.
      logger.warn("[RAGEngine] Embedding progress listener failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

// Cache for dynamically imported module
let transformersModule: { pipeline: unknown; env: unknown } | null = null;
let initPromise: Promise<void> | null = null;
let transformersGeneration = 0;
// Track the active main-thread pipeline for deterministic disposal on unload.
// @huggingface/transformers pipelines hold WASM/ONNX model weights that are
// only released by dispose() — GC cannot reclaim them promptly.
let activePipelineRef: { dispose?: () => void } | null = null;

export type BookmarkWithSimilarity = Bookmark & { similarity: number };

// Dynamically import transformers only when needed
async function getTransformers() {
  if (transformersModule) {return transformersModule;}

  if (initPromise) {return initPromise.then(() => transformersModule!);}

  const generation = transformersGeneration;
  const operation = (async () => {
    const module = await import("@huggingface/transformers");
    if (generation !== transformersGeneration) {
      throw new DOMException(
        "Embedding model initialization invalidated",
        "AbortError",
      );
    }

    // Configure environment - prefer local models for offline-first support.
    // env is a named export; the module has NO default export, so the old
    // (module as any).default.env access threw at runtime (undefined.env).
    const hfEnv = module.env;
    hfEnv.allowLocalModels = true;
    hfEnv.useBrowserCache = true;
    hfEnv.remoteHost = "https://huggingface.co";
    hfEnv.remotePathTemplate = "{model}/resolve/{revision}/";
    // SECURITY (supply chain): install the verifying custom cache on the
    // main-thread fallback path too — same fail-closed digest enforcement.
    configureModelIntegrity(hfEnv);

    if (generation !== transformersGeneration) {
      throw new DOMException(
        "Embedding model initialization invalidated",
        "AbortError",
      );
    }
    transformersModule = { pipeline: module.pipeline, env: hfEnv };
  })();
  initPromise = operation;
  try {
    await operation;
    return transformersModule!;
  } finally {
    if (initPromise === operation) {
      initPromise = null;
    }
  }
}

/**
 * RAGEngine - Retrieval Augmented Generation using backend embeddings.
 * Handles embedding generation, caching, and similarity search via HNSW.
 * Optimized with WorkerPool for parallel processing.
 */
class RAGEngine {
  private embeddingCache: Map<string, number[]> = new Map();
  private inFlightEmbeddings: Map<string, Promise<number[]>> = new Map();
  private MAX_CACHE_SIZE = 1000; // Increased cache size
  private initializationPromise: Promise<void> | null = null;
  private prefetchPromise: Promise<void> | null = null;
  private lifecycleGeneration = 0;
  // A completed embedding request may resolve after a vault transition. The
  // generation prevents that stale result from repopulating this cache.
  private cacheGeneration = 0;
  // SECURITY/PERF: the worker pool must NOT be created at module load time.
  // Field-initialized getWorkerPool(...) instantiated 2 Web Workers on every
  // static import of RAGEngine (which the app shell pulls in at startup) —
  // the same import-time side-effect pattern as the deleted ProviderSelector.
  // Created on first real demand (generateEmbedding) instead.
  private _workerPool: ReturnType<typeof getWorkerPool> | null = null;

  private get workerPool() {
    if (typeof window === "undefined") {return null;}
    if (!this._workerPool) {
      this._workerPool = getWorkerPool("embeddings", embeddingWorkerUrl, 2);
    }
    return this._workerPool;
  }

  /**
   * Unloads the RAGEngine to free up memory.
   */
  async unload(): Promise<void> {
    this.lifecycleGeneration += 1;
    // Allow a post-unlock init() to start immediately. The old operation's
    // finally callback is identity-guarded and cannot clear the new promise.
    this.initializationPromise = null;
    this.clearCache();
    this.inFlightEmbeddings.clear();
    this._workerPool?.terminate();
    this._workerPool = null;
    this.prefetchPromise = null;
    transformersGeneration += 1;
    transformersModule = null;
    initPromise = null;
    // Dispose the main-thread ONNX pipeline to release WASM model memory
    // deterministically instead of waiting for GC.
    if (activePipelineRef?.dispose) {
      try {
        activePipelineRef.dispose();
      } catch {
        /* INTENTIONAL SILENCE: dispose may fail if the runtime already released resources */
      }
    }
    activePipelineRef = null;
  }

  /**
   * Warm the embedding worker after the user explicitly opens a semantic
   * feature. This deliberately does not generate or cache a user embedding.
   * The app shell never calls this method, so startup remains WASM/model-free.
   */
  prefetch(): Promise<void> {
    if (this.prefetchPromise) {return this.prefetchPromise;}
    if (typeof window === "undefined") {return Promise.resolve();}

    try {
      const pool = this.workerPool;
      if (!pool) {return Promise.resolve();}

      const operationRef: { current?: Promise<void> } = {};
      const operation = pool
        .execute<null, boolean>(
          "prefetch",
          null,
          undefined,
          (_taskId, status, message) => {
            if (status === "loading") {
              notifyProgress("loading", message || "Preparing semantic search...");
            } else if (status === "ready") {
              notifyProgress("ready");
            }
          },
        )
        .then(() => undefined)
        .catch((error: unknown) => {
          // Prefetch is an optimization. A failed warm-up must not make the
          // semantic feature unusable; the first real query still owns the
          // normal worker/main-thread fallback path. Clear only this request
          // so reopening the semantic feature can retry, without allowing an
          // old operation to clear a newer one after unload().
          if (this.prefetchPromise === operationRef.current) {
            this.prefetchPromise = null;
          }
          logger.warn("[RAGEngine] Semantic model prefetch failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      operationRef.current = operation;

      this.prefetchPromise = operation;
      return operation;
    } catch (error: unknown) {
      logger.warn("[RAGEngine] Semantic model prefetch unavailable", {
        error: error instanceof Error ? error.message : String(error),
      });
      return Promise.resolve();
    }
  }

  /**
   * Get worker pool stats for monitoring.
   */
  getStats() {
    return {
      cacheSize: this.embeddingCache.size,
      workerStats: this._workerPool?.getStats() ?? null,
    };
  }

  /**
   * Clears user-derived embeddings and invalidates in-flight cache writes.
   * Embeddings are not persisted, but retaining them across vault contexts
   * would still allow one vault's content to influence another vault.
   */
  clearCache(): void {
    this.cacheGeneration += 1;
    this.embeddingCache.clear();
    // Do not let requests from the previous vault context deduplicate with
    // requests created after the transition.
    this.inFlightEmbeddings.clear();
  }

  /**
   * Initializes the RAGEngine.
   */
  init(): Promise<void> {
    if (this.initializationPromise) {return this.initializationPromise;}

    const lifecycleGeneration = this.lifecycleGeneration;
    const operation = (async () => {
      try {
        await resourceManager.switchToRAG();
        if (lifecycleGeneration !== this.lifecycleGeneration) {return;}
        // Preload transformers module
        await getTransformers();
      } catch (e) {
        logger.warn("[RAGEngine] Init warning", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    const tracked = operation.finally(() => {
      if (this.initializationPromise === tracked) {
        this.initializationPromise = null;
      }
    });
    this.initializationPromise = tracked;
    return tracked;
  }

  private addToCache(cacheKey: string, embedding: number[]): void {
    if (this.embeddingCache.has(cacheKey)) {
      this.embeddingCache.set(cacheKey, embedding.slice());
      return;
    }
    if (this.MAX_CACHE_SIZE <= 0) {return;}
    if (this.embeddingCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.embeddingCache.keys().next().value;
      if (firstKey !== undefined) {
        this.embeddingCache.delete(firstKey);
      }
    }
    // Callers receive their own vector copy; otherwise mutating a returned
    // embedding would corrupt the shared cache and affect later searches.
    this.embeddingCache.set(cacheKey, embedding.slice());
  }

  /**
   * Generates an embedding vector for the given text.
   *
   * @param text The text to generate an embedding for.
   * @returns A promise resolving to an array of numbers representing the embedding vector.
   */
  async generateEmbedding(
    text: string,
    signal?: AbortSignal,
  ): Promise<number[]> {
    if (signal?.aborted) {
      const error = new DOMException("Embedding request aborted", "AbortError");
      throw error;
    }
    if (!text || typeof text !== "string") {
      return new Array(EMBEDDING_MODEL_DIMENSIONS).fill(0);
    }

    // Keep document text out of the in-memory Map key. The embedding itself
    // is still cleared on vault transitions and bounded by MAX_CACHE_SIZE.
    const cacheKey = hashCacheKey(text);
    if (this.embeddingCache.has(cacheKey)) {
      // Never expose the cache's mutable array to callers.
      return this.embeddingCache.get(cacheKey)!.slice();
    }

    // Abortable callers own their request. Sharing only non-abortable work
    // avoids one consumer cancelling another consumer's operation.
    if (!signal) {
      const existing = this.inFlightEmbeddings.get(cacheKey);
      if (existing) {
        return existing.then((embedding) => embedding.slice());
      }
    }

    const request = this.generateEmbeddingInternal(text, cacheKey, signal);
    if (signal) {return request;}

    this.inFlightEmbeddings.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (this.inFlightEmbeddings.get(cacheKey) === request) {
        this.inFlightEmbeddings.delete(cacheKey);
      }
    }
  }

  private async generateEmbeddingInternal(
    text: string,
    cacheKey: string,
    signal?: AbortSignal,
  ): Promise<number[]> {
    const requestGeneration = this.cacheGeneration;

    // If semantic mode was just opened, let the explicit model warm-up finish
    // before dispatching the first real query. This keeps the query on the
    // already-warmed worker and avoids a second concurrent WASM download.
    if (this.prefetchPromise) {
      await this.prefetchPromise;
    }

    // Use WorkerPool for parallel embedding generation
    if (this.workerPool) {
      try {
        notifyProgress("loading", "Generating embedding...");
        const embedding = await this.workerPool.execute<string, number[]>(
          "embed",
          text,
          undefined,
          (_taskId, status, message) => {
            if (status === "loading") {
              notifyProgress("loading", message || "Downloading model...");
            } else if (status === "ready") {
              notifyProgress("ready");
            }
          },
          signal,
        );
        if (requestGeneration !== this.cacheGeneration) {
          throw new DOMException(
            "Embedding request invalidated by vault transition",
            "AbortError",
          );
        }
        this.addToCache(cacheKey, embedding);
        notifyProgress("ready");
        return embedding;
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === "AbortError" ||
            error.name === "WorkerPoolCapacityError")
        ) {
          // Capacity rejection is backpressure, not worker failure. Falling
          // back to the main thread here would bypass the queue limit and
          // create exactly the memory spike the pool is protecting against.
          throw error;
        }
        if (requestGeneration !== this.cacheGeneration) {
          throw new DOMException(
            "Embedding request invalidated by vault transition",
            "AbortError",
          );
        }
        logger.warn(
          "[RAGEngine] Worker pool failed, falling back to main thread",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }

    if (requestGeneration !== this.cacheGeneration) {
      throw new DOMException(
        "Embedding request invalidated by vault transition",
        "AbortError",
      );
    }

    if (signal?.aborted) {
      throw new DOMException("Embedding request aborted", "AbortError");
    }

    // Fallback to main thread if worker pool is not available
    return this.generateEmbeddingMainThread(text, requestGeneration, signal);
  }

  private async generateEmbeddingMainThread(
    text: string,
    requestGeneration: number,
    signal?: AbortSignal,
  ): Promise<number[]> {
    try {
      const { pipeline } = (await getTransformers()) as unknown as {
        pipeline: (
          task: string,
          model: string,
          options?: Record<string, unknown>,
        ) => Promise<
          (
            text: string,
            options: Record<string, unknown>,
          ) => { data: { slice: () => number[] } }
        >;
      };
      const embedFn = await pipeline(
        "feature-extraction",
        EMBEDDING_MODEL_ID,
        { ...EMBEDDING_MODEL_PIPELINE_OPTIONS },
      );
      // Track for disposal on unload so WASM memory is released deterministically.
      // Dispose any previous pipeline first to prevent WASM memory leaks when
      // multiple concurrent calls create overlapping pipeline instances.
      if (activePipelineRef?.dispose) {
        try {
          activePipelineRef.dispose();
        } catch {
          /* INTENTIONAL SILENCE: dispose may fail if the runtime already released resources */
        }
      }
      activePipelineRef = embedFn as unknown as { dispose?: () => void };

      if (signal?.aborted) {
        throw new DOMException("Embedding request aborted", "AbortError");
      }

      const output = await embedFn(text, { pooling: "mean", normalize: true });
      if (signal?.aborted) {
        throw new DOMException("Embedding request aborted", "AbortError");
      }
      const embedding = (output as { data: number[] }).data;

      if (requestGeneration !== this.cacheGeneration) {
        throw new DOMException(
          "Embedding request invalidated by vault transition",
          "AbortError",
        );
      }
      this.addToCache(hashCacheKey(text), embedding);
      return embedding;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      if (requestGeneration !== this.cacheGeneration) {
        throw new DOMException(
          "Embedding request invalidated by vault transition",
          "AbortError",
        );
      }
      logger.error("[RAGEngine] Failed to generate embedding", {
        error: error instanceof Error ? error.message : String(error),
      });
      return new Array(EMBEDDING_MODEL_DIMENSIONS).fill(0);
    }
  }

  /**
   * Search for similar bookmarks using vector similarity.
   *
   * @param query The search query text.
   * @param bookmarks The array of bookmarks to search through.
   * @param limit Maximum number of results to return.
   * @returns An array of bookmarks sorted by similarity.
   */
  async searchSimilar<T extends { embedding?: number[] }>(
    query: string,
    bookmarks: T[],
    limit: number = 10,
    signal?: AbortSignal,
  ): Promise<(T & { similarity: number })[]> {
    if (signal?.aborted) {
      throw new DOMException("Semantic search aborted", "AbortError");
    }
    const resultLimit = Number.isFinite(limit)
      ? Math.max(0, Math.floor(limit))
      : 10;
    if (!query || !query.trim()) {
      return bookmarks
        .slice(0, resultLimit)
        .map((b) => ({ ...b, similarity: 0 }));
    }
    if (resultLimit === 0) {return [];}

    try {
      const queryEmbedding = await this.generateEmbedding(query, signal);

      // For the common small-limit case, retain only the best candidates
      // instead of allocating and sorting a result object for every bookmark.
      // Ties are inserted after existing equal scores to preserve stable order.
      if (resultLimit < bookmarks.length) {
        const topResults: (T & { similarity: number })[] = [];
        for (const bookmark of bookmarks) {
          const similarity = bookmark.embedding && bookmark.embedding.length > 0
            ? this.cosineSimilarity(queryEmbedding, bookmark.embedding)
            : 0;
          const candidate = { ...bookmark, similarity };
          const last = topResults[topResults.length - 1];
          if (
            topResults.length >= resultLimit &&
            last &&
            similarity <= last.similarity
          ) {continue;}
          let insertionIndex = topResults.length;
          while (
            insertionIndex > 0 &&
            topResults[insertionIndex - 1]!.similarity < similarity
          ) {
            insertionIndex -= 1;
          }
          topResults.splice(insertionIndex, 0, candidate);
          if (topResults.length > resultLimit) {topResults.pop();}
        }
        return topResults;
      }

      const results = bookmarks.map((bookmark) => {
        if (!bookmark.embedding || bookmark.embedding.length === 0) {
          return { ...bookmark, similarity: 0 };
        }

        const similarity = this.cosineSimilarity(
          queryEmbedding,
          bookmark.embedding,
        );
        return { ...bookmark, similarity };
      });

      return results.sort((a, b) => b.similarity - a.similarity);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      logger.error("[RAGEngine] Search failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return bookmarks.slice(0, resultLimit).map((b) => ({ ...b, similarity: 0 }));
    }
  }

  /**
   * Calculates cosine similarity between two vectors.
   * Public for use by GraphView and KnowledgeGraphService.
   */
  public cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {return 0;}

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i]! * vecB[i]!;
      normA += vecA[i]! * vecA[i]!;
      normB += vecB[i]! * vecB[i]!;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Cluster items based on embedding similarity using HDBSCAN-like approach.
   * Returns a Map of item id -> cluster id. Items with similarity above threshold
   * are grouped in the same cluster.
   */
  public clusterItems<T extends { id: string; embedding?: number[] }>(
    items: T[],
    similarityThreshold: number = 0.8,
  ): Map<string, number> {
    const clusterMap = new Map<string, number>();
    let nextClusterId = 1;

    // Track which items have been assigned to clusters
    const assigned = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      const itemA = items[i]!;
      if (!itemA?.embedding || itemA.embedding.length === 0) {
        clusterMap.set(itemA.id, 0); // Noise cluster
        continue;
      }

      if (assigned.has(itemA.id)) {continue;}

      // Start a new cluster with this item
      const currentClusterId = nextClusterId++;
      clusterMap.set(itemA.id, currentClusterId);
      assigned.add(itemA.id);

      // Find all similar items for this cluster
      for (let j = i + 1; j < items.length; j++) {
        const itemB = items[j]!;
        if (!itemB?.embedding || assigned.has(itemB.id)) {continue;}

        const similarity = this.cosineSimilarity(
          itemA.embedding,
          itemB.embedding,
        );
        if (similarity >= similarityThreshold) {
          clusterMap.set(itemB.id, currentClusterId);
          assigned.add(itemB.id);
        }
      }
    }

    // Mark any remaining unassigned items as noise
    for (const item of items) {
      if (!clusterMap.has(item.id)) {
        clusterMap.set(item.id, 0);
      }
    }

    return clusterMap;
  }
}

export const ragEngine = new RAGEngine();

// Embeddings are derived from vault content. Invalidate them whenever the
// vault changes state, including an unlock into a different context. A lock
// also unloads the worker so an in-flight task cannot retain user text.
securityVault.onLock(() => {
  void ragEngine.unload();
});
securityVault.onUnlock(() => ragEngine.clearCache());
