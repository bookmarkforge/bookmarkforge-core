import { initDB } from "../../db/database";
import { taggingService } from "./TaggingService";
import { ragEngine } from "./RAGEngine";
import { vectorIndexService } from "./VectorIndexService";
import { ChunkingService } from "./ChunkingService";
import {
  Subscription,
  debounceTime,
  BehaviorSubject,
  combineLatest,
  exhaustMap,
  from,
} from "rxjs";
import { generateId } from "../../utils/id";
import type { RxDocument } from "rxdb";
import type {
  BookmarkDocType,
  DocumentDocType,
  FolderDocType,
  ChunkDocType,
} from "../../db/schema";
import { AUTOPROCESSOR_CONFIG } from "../../constants/config";
import { logger } from "../../utils/logger";
import { safeErrorForLog } from "../../utils/safeErrorForLog";
import { safeGet } from "../../store/safeStorage";
import { aiManager } from "./ProviderManager";
export interface AutoProcessorStatus {
  isProcessing: boolean;
  totalItems: number;
  processedItems: number;
  currentItem?: string;
}

class AutoProcessorService {
  private subscription: Subscription | null = null;
  private isProcessing = false;
  private useCount = 0;
  private statusSubject = new BehaviorSubject<AutoProcessorStatus>({
    isProcessing: false,
    totalItems: 0,
    processedItems: 0,
  });

  // Audit #6: per-item retry backoff (in-memory; only survives the session —
  // on reload, unprocessed items simply retry immediately, which is the safe
  // default). Prevents the infinite hot retry loop when the AI pipeline
  // persistently fails (network down, quota exhausted, vault locked).
  private retryState = new Map<
    string,
    { failures: number; nextAttemptAt: number }
  >();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private forceReprocessInFlight: Promise<number> | null = null;
  private startInFlight: Promise<void> | null = null;
  private lifecycleGeneration = 0;
  private processingGeneration: number | null = null;
  private activeBatchController: AbortController | null = null;
  private readonly RETRY_BASE_MS = 5_000;
  private readonly RETRY_MAX_MS = 300_000;
  private readonly RETRY_STATE_LIMIT = 5_000;

  public status$ = this.statusSubject.asObservable();

  async start(): Promise<void> {
    this.useCount++;
    await this.ensureStarted();
  }

  private async ensureStarted(): Promise<void> {
    if (this.subscription) {return;}
    if (this.startInFlight) {
      return this.startInFlight;
    }

    const operation = (async () => {
      while (this.useCount > 0 && !this.subscription) {
        const generation = this.lifecycleGeneration;
        const db = await initDB();
        if (generation !== this.lifecycleGeneration || this.useCount <= 0) {
          // The start was invalidated while initDB was pending. If a new
          // consumer still exists, loop and initialize against the current
          // lifecycle instead of creating a stale subscription.
          continue;
        }

        // Combine unprocessed bookmarks and documents
        const bookmark$ = db.bookmarks.find({
          selector: { processed: { $ne: true } },
        }).$;
        const document$ = db.documents.find({
          selector: { processed: { $ne: true } },
        }).$;

        this.subscription = combineLatest([bookmark$, document$])
          .pipe(
            debounceTime(AUTOPROCESSOR_CONFIG.DEBOUNCE_MS),
            exhaustMap((results: unknown[]) => from(this.processBatch(results))),
          )
          .subscribe({
            error: (err) =>
              logger.error("[AutoProcessor] Fatal error in processing pipeline", {
                error: safeErrorForLog(err),
              }),
          });
      }
    })();

    this.startInFlight = operation;
    try {
      await operation;
    } finally {
      if (this.startInFlight === operation) {
        this.startInFlight = null;
      }
    }
  }

  private async processBatch(results: unknown[]): Promise<void> {
    // Audit #6: never overlap batches (a retry-timer may fire while a
    // stream-triggered batch is still running) — defer instead.
    if (this.isProcessing) {
      this.scheduleRetryCheck(this.RETRY_BASE_MS);
      return;
    }

    const [bookmarks, documents] = results as [
      RxDocument<BookmarkDocType>[],
      RxDocument<DocumentDocType>[],
    ];
    logger.info("[AutoProcessor] Detected unprocessed items", {
      bookmarks: bookmarks?.length || 0,
      documents: documents?.length || 0,
    });

    if (bookmarks?.length > 0) {
      const firstBookmark = bookmarks[0]!;
      logger.debug("[AutoProcessor] First bookmark", {
        id: firstBookmark.id,
        processed: firstBookmark.processed,
        updatedAt: firstBookmark.updatedAt,
      });
    }
    if (documents?.length > 0) {
      const firstDoc = documents[0]!;
      logger.debug("[AutoProcessor] First document", {
        id: firstDoc.id,
        processed: firstDoc.processed,
        updatedAt: firstDoc.updatedAt,
      });
    }

    const batchGeneration = this.lifecycleGeneration;
    const batchController = new AbortController();
    this.isProcessing = true;
    this.processingGeneration = batchGeneration;
    this.activeBatchController = batchController;

    // Battery check: Suspend background processing if battery is critically low
    interface BatteryManager {
      charging: boolean;
      level: number;
    }

    if ("getBattery" in navigator) {
      try {
        const battery = await (
          navigator as Navigator & { getBattery: () => Promise<BatteryManager> }
        ).getBattery();
        if (
          !battery.charging &&
          battery.level < AUTOPROCESSOR_CONFIG.BATTERY_CRITICAL_THRESHOLD
        ) {
          logger.warn(
            "[AutoProcessor] Battery critically low (<15%). Pausing background processing to save power.",
          );
          this.isProcessing = false;
          this.processingGeneration = null;
          this.activeBatchController = null;
          batchController.abort();
          return;
        }
      } catch (e) {
        logger.warn("[AutoProcessor] Battery API failed", { error: safeErrorForLog(e) });
      }
    }

    const allItems = [
      ...(bookmarks || []).map((b: RxDocument<BookmarkDocType>) => ({
        item: b,
        type: "bookmark" as const,
      })),
      ...(documents || []).map((d: RxDocument<DocumentDocType>) => ({
        item: d,
        type: "document" as const,
      })),
    ];

    if (allItems.length === 0) {
      logger.info("[AutoProcessor] No new items to process");
      this.isProcessing = false;
      this.processingGeneration = null;
      this.activeBatchController = null;
      batchController.abort();
      return;
    }

    // Audit #6: skip items still inside their retry backoff window and
    // schedule a re-check for the soonest deadline, so a persistent failure
    // does not hot-loop the AI pipeline on every DB emission.
    const now = Date.now();
    const dueItems = allItems.filter(
      ({ item }) => !this.isInBackoff(item.id, now),
    );
    if (dueItems.length !== allItems.length) {
      const inBackoff = allItems.filter(({ item }) =>
        this.isInBackoff(item.id, now),
      );
      const soonest = Math.min(
        ...inBackoff.map(
          ({ item }) => this.retryState.get(item.id)!.nextAttemptAt - now,
        ),
        this.RETRY_MAX_MS,
      );
      this.scheduleRetryCheck(Math.max(1_000, soonest));
    }
    if (dueItems.length === 0) {
      logger.info(
        "[AutoProcessor] All pending items are in backoff; retry scheduled",
        { pending: allItems.length },
      );
      this.isProcessing = false;
      this.processingGeneration = null;
      this.activeBatchController = null;
      batchController.abort();
      return;
    }

    // Check if API key is configured before processing
    const apiKey = aiManager.getApiKey();
    const provider = aiManager.getProviderInfo().provider;
    if (!apiKey && provider !== "ollama" && provider !== "webllm") {
      logger.warn(
        "[AutoProcessor] No API key configured. Skipping automatic processing.",
      );
      logger.info(
        "[AutoProcessor] Please configure an API key in Settings to enable automatic AI processing.",
      );
      this.isProcessing = false;
      this.processingGeneration = null;
      this.activeBatchController = null;
      batchController.abort();
      return;
    }

    this.updateStatus({
      isProcessing: true,
      totalItems: dueItems.length,
      processedItems: 0,
    });

    try {
      const concurrencyLimit = AUTOPROCESSOR_CONFIG.CONCURRENCY_LIMIT;
      const queue = [...dueItems];
      let processedCount = 0;

      const workers = Array(Math.min(concurrencyLimit, allItems.length))
        .fill(null)
        .map(async () => {
          while (queue.length > 0) {
            if (batchGeneration !== this.lifecycleGeneration || this.useCount <= 0) {
              queue.length = 0;
              break;
            }
            const task = queue.shift();
            if (!task) {break;}

            this.updateStatus({ currentItem: task.item.title });

            try {
              if (task.type === "bookmark") {
                await this.processBookmark(task.item, batchController.signal);
              } else {
                await this.processDocument(task.item, batchController.signal);
              }
            } catch (err) {
              logger.error(`[AutoProcessor] Failed to process ${task.type}`, {
                // Title may contain user content (private bookmark titles).
                // Truncate to avoid leaking a full title into diagnostics
                // logs; the id is already enough to correlate.
                title:
                  typeof task.item.title === "string"
                    ? task.item.title.slice(0, 80)
                    : undefined,
                error: safeErrorForLog(err),
              });
            }

            if (batchGeneration !== this.lifecycleGeneration || this.useCount <= 0) {
              queue.length = 0;
              break;
            }
            processedCount++;
            this.updateStatus({ processedItems: processedCount });
          }
        });

      await Promise.all(workers);
    } catch (error) {
      logger.error("[AutoProcessor] Error in processing loop", { error });
    } finally {
      if (this.processingGeneration === batchGeneration) {
        this.isProcessing = false;
        this.processingGeneration = null;
        if (this.activeBatchController === batchController) {
          this.activeBatchController = null;
        }
        this.updateStatus({
          isProcessing: false,
          totalItems: 0,
          processedItems: 0,
          currentItem: undefined,
        });
      }
    }
  }

  private updateStatus(patch: Partial<AutoProcessorStatus>) {
    this.statusSubject.next({ ...this.statusSubject.value, ...patch });
  }

  // ── Audit #6: retry backoff ────────────────────────────────────────────

  private isInBackoff(id: string, now: number): boolean {
    const state = this.retryState.get(id);
    return !!state && state.nextAttemptAt > now;
  }

  /** Registers a failed attempt with exponential backoff (5s → 10s → … capped at 5min). */
  private recordFailure(id: string): void {
    const state = this.retryState.get(id) ?? { failures: 0, nextAttemptAt: 0 };
    const failures = state.failures + 1;
    this.retryState.set(id, {
      failures,
      nextAttemptAt: Date.now() +
        Math.min(this.RETRY_MAX_MS, this.RETRY_BASE_MS * 2 ** failures),
    });
    if (this.retryState.size > this.RETRY_STATE_LIMIT) {
      const oldestKey = this.retryState.keys().next().value;
      if (oldestKey !== undefined) {this.retryState.delete(oldestKey);}
    }
  }

  /** Schedules a re-check of pending items (single-flight). */
  private scheduleRetryCheck(delayMs: number): void {
    if (this.retryTimer) {return;}
    const generation = this.lifecycleGeneration;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (generation !== this.lifecycleGeneration || this.useCount <= 0) {
        return;
      }
      this.runRetryCheck(generation).catch((err) =>
        logger.error("[AutoProcessor] Retry check failed", { error: safeErrorForLog(err) }),
      );
    }, delayMs);
  }

  private async runRetryCheck(generation = this.lifecycleGeneration): Promise<void> {
    if (generation !== this.lifecycleGeneration || this.useCount <= 0) {
      return;
    }
    if (this.isProcessing) {
      this.scheduleRetryCheck(this.RETRY_BASE_MS);
      return;
    }
    const db = await initDB();
    if (generation !== this.lifecycleGeneration || this.useCount <= 0) {
      return;
    }
    const [bookmarks, documents] = await Promise.all([
      db.bookmarks.find({
        selector: { processed: { $ne: true } },
      }).exec(),
      db.documents.find({
        selector: { processed: { $ne: true } },
      }).exec(),
    ]);
    if (generation !== this.lifecycleGeneration || this.useCount <= 0) {
      return;
    }
    await this.processBatch([bookmarks, documents]);
  }

  private async processDocument(
    doc: RxDocument<DocumentDocType>,
    signal?: AbortSignal,
  ) {
    logger.info("[AutoProcessor] Processing document", {
      // Mirror the catch-block truncation: titles may contain user content
      // (including private documents), and the id is enough to correlate.
      title:
        typeof doc.title === "string" ? doc.title.slice(0, 80) : undefined,
    });
    try {
      const text = doc.textContent || "";
      const lang = (safeGet("i18nextLng") || "en").startsWith("es")
        ? "es"
        : "en";
      // Missing privacy metadata fails closed to the local provider.
      const isPrivate = doc.isPrivate !== false;

      // Parallelize AI metadata generation
      const [embedding, summary, tags] = await Promise.all([
        doc.embedding && doc.embedding.length > 0
          ? Promise.resolve(doc.embedding)
          : ragEngine.generateEmbedding(text || doc.title, signal),
        taggingService.generateSummary(text, doc.title, lang, isPrivate, signal),
        taggingService.suggestTags(
          text,
          lang,
          doc.title,
          doc.tags || [],
          isPrivate,
          signal,
        ),
      ]);
      if (signal?.aborted) {return;}

      // 4. Suggest Folder if it's in 'root'
      let folderId = doc.folderId;
      if (folderId === "root") {
        const db = await initDB();
        const existingFolders = await db.folders.find({ limit: 500 }).exec();
        const folderNames = existingFolders.map(
          (f: RxDocument<FolderDocType>) => f.title,
        );

        const suggestedFolderName = await taggingService.suggestFolder(
          text,
          doc.title,
          folderNames,
          lang,
          isPrivate,
          signal,
        );

        // Find if folder exists or create it
        let targetFolder = existingFolders.find(
          (f: RxDocument<FolderDocType>) =>
            f.title.toLowerCase() === suggestedFolderName.toLowerCase(),
        );

        if (
          !targetFolder &&
          suggestedFolderName.toLowerCase() !== "root" &&
          suggestedFolderName.toLowerCase() !== "general"
        ) {
          targetFolder = await db.folders.insert({
            id: generateId(),
            title: suggestedFolderName,
            parentId: "",
            createdAt: new Date().toISOString(),
          });
          logger.info("[AutoProcessor] Created new folder", {
            name: suggestedFolderName,
          });
        }

        if (targetFolder) {
          folderId = targetFolder.id;
        }
      }

      if (signal?.aborted) {return;}

      // Build the replacement chunk set before marking the item processed. If
      // chunk persistence is cancelled or fails, the item remains eligible
      // for a later retry instead of appearing fully processed.
      await this.processChunks(
        doc.id,
        "document",
        text || doc.title,
        signal,
        isPrivate,
      );
      if (signal?.aborted) {return;}

      await doc.incrementalPatch({
        embedding,
        summary,
        tags,
        folderId,
        processed: true,
        updatedAt: new Date().toISOString(),
      });

      this.retryState.delete(doc.id);
      logger.info("[AutoProcessor] Finished processing document", {
        // Truncate for the same privacy reason as the catch block.
        title:
          typeof doc.title === "string" ? doc.title.slice(0, 80) : undefined,
      });
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        return;
      }
      // Audit #6: backoff — the item stays unprocessed but won't be retried
      // in a hot loop; a retry timer re-checks it after the backoff window.
      this.recordFailure(doc.id);
      logger.error("[AutoProcessor] Error processing document", {
        // Title may contain user content (private document titles); mirror
        // the truncation used in the batch worker above.
        title:
          typeof doc.title === "string" ? doc.title.slice(0, 80) : undefined,
        error: safeErrorForLog(error),
      });
    }
  }

  private async processBookmark(
    bookmark: RxDocument<BookmarkDocType>,
    signal?: AbortSignal,
  ) {
    logger.info("[AutoProcessor] Processing bookmark", {
      // Mirror the catch-block truncation: titles may contain private data.
      title:
        typeof bookmark.title === "string"
          ? bookmark.title.slice(0, 80)
          : undefined,
    });

    try {
      const text = bookmark.content || "";
      const lang = (safeGet("i18nextLng") || "en").startsWith("es")
        ? "es"
        : "en";
      // Missing privacy metadata fails closed to the local provider.
      const isPrivate = bookmark.isPrivate !== false;

      // Parallelize AI metadata generation
      const [summary, tags, embedding] = await Promise.all([
        taggingService.generateSummary(text, bookmark.title, lang, isPrivate, signal),
        taggingService.suggestTags(
          text,
          lang,
          bookmark.title,
          bookmark.tags || [],
          isPrivate,
          signal,
        ),
        bookmark.embedding && bookmark.embedding.length > 0
          ? Promise.resolve(bookmark.embedding)
          : ragEngine.generateEmbedding(text || bookmark.title, signal),
      ]);
      if (signal?.aborted) {return;}

      // 4. Generate Smart Links
      if (signal?.aborted) {return;}
      const _db = await initDB();

      // OPTIMIZATION: Use vectorIndexService instead of loading all bookmarks
      const similar = await vectorIndexService.search(embedding, 10);
      if (signal?.aborted) {return;}

      // similar.neighbors is an array of { id, similarity, title, url }
      // In VectorIndexService, we stored parentId in 'title' and parentType in 'url'
      const relatedLinks = (
        similar as {
          neighbors: Array<{
            id: string;
            similarity: number;
            title: string;
            url: string;
          }>;
        }
      ).neighbors
        .filter(
          (n) =>
            n.similarity > 0.75 &&
            n.title !== bookmark.id &&
            n.url === "bookmark",
        )
        .map((n) => n.title) as string[];

      // Build the replacement chunk set before marking the item processed. If
      // chunk persistence is cancelled or fails, the item remains eligible
      // for a later retry instead of appearing fully processed.
      if (signal?.aborted) {return;}
      await this.processChunks(
        bookmark.id,
        "bookmark",
        text || bookmark.title,
        signal,
        isPrivate,
      );
      if (signal?.aborted) {return;}

      await bookmark.incrementalPatch({
        summary,
        tags,
        relatedLinks: [...new Set(relatedLinks)], // Unique links
        embedding,
        processed: true,
        updatedAt: new Date().toISOString(),
      });

      this.retryState.delete(bookmark.id);
      logger.info("[AutoProcessor] Finished processing bookmark", {
        // Truncate for the same privacy reason as the catch block.
        title:
          typeof bookmark.title === "string"
            ? bookmark.title.slice(0, 80)
            : undefined,
      });
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        return;
      }
      // Audit #6: backoff (see processDocument).
      this.recordFailure(bookmark.id);
      logger.error("[AutoProcessor] Error processing bookmark", {
        title:
          typeof bookmark.title === "string"
            ? bookmark.title.slice(0, 80)
            : undefined,
        error: safeErrorForLog(error),
      });
    }
  }

  private async processChunks(
    parentId: string,
    parentType: "document" | "bookmark",
    text: string,
    signal?: AbortSignal,
    // Direct/internal callers without a parent record fail closed.
    isPrivate = true,
  ) {
    if (signal?.aborted) {return;}
    const db = await initDB();
    if (signal?.aborted) {return;}
    const chunks = ChunkingService.splitText(
      text,
      AUTOPROCESSOR_CONFIG.CHUNK_SIZE,
      AUTOPROCESSOR_CONFIG.CHUNK_OVERLAP,
    );

    // Keep old chunks intact until all replacement embeddings are ready. This
    // makes cancellation during AI work non-destructive.
    // Process chunks in parallel with a concurrency limit.
    const concurrencyLimit = AUTOPROCESSOR_CONFIG.CHUNK_CONCURRENCY_LIMIT;
    const chunkData: {
      id: string;
      embedding: number[];
      content: string;
      index: number;
    }[] = [];

    for (let i = 0; i < chunks.length; i += concurrencyLimit) {
      if (signal?.aborted) {return;}
      const batch = chunks.slice(i, i + concurrencyLimit);
      const results = await Promise.all(
        batch.map(async (content, idx) => {
          const embedding = await ragEngine.generateEmbedding(content, signal);
          return {
            id: generateId(),
            content,
            embedding,
            index: i + idx,
          };
        }),
      );
      chunkData.push(...results);
      if (signal?.aborted) {return;}
    }

    if (signal?.aborted) {return;}
    const oldChunks = (await db.chunks
      .find({ selector: { parentId, parentType } })
      .exec()) as RxDocument<ChunkDocType>[];
    if (signal?.aborted) {return;}
    const oldChunkIds = oldChunks.map((c: RxDocument<ChunkDocType>) => c.id);
    const newChunkIds = chunkData.map((data) => data.id);

    // An empty replacement is not a safe commit point: keep the previous
    // generation rather than turning a transient chunker/provider result into
    // destructive data loss.
    if (chunkData.length === 0) {return;}

    const newChunkDocuments = chunkData.map((data) => ({
      id: data.id,
      parentId,
      parentType,
      isPrivate,
      content: data.content,
      embedding: data.embedding,
      index: data.index,
      createdAt: new Date().toISOString(),
    }));
    const oldChunkDocuments = oldChunks.map((chunk: RxDocument<ChunkDocType>) => {
      const candidate = chunk as RxDocument<ChunkDocType> & {
        toJSON?: () => ChunkDocType;
      };
      return (typeof candidate.toJSON === "function"
        ? candidate.toJSON()
        : candidate) as ChunkDocType;
    });

    const getBulkErrors = (result: unknown): unknown[] => {
      if (!result || typeof result !== "object") {return [];}
      const errors = (result as { error?: unknown }).error;
      return Array.isArray(errors) ? errors : [];
    };

    const rollbackNewChunks = async (): Promise<void> => {
      if (newChunkIds.length === 0) {return;}
      try {
        // Roll back by id (bulkRemove accepts string[]; the old cast to
        // ChunkDocType[] forced a wrong overload under the real rxdb types).
        await db.chunks.bulkRemove(newChunkIds);
      } catch (error) {
        logger.warn("[AutoProcessor] Failed to roll back replacement chunks", {
          error,
        });
      }
    };

    const restoreOldChunks = async (): Promise<void> => {
      if (oldChunkDocuments.length === 0) {return;}
      try {
        const current = (await db.chunks
          .find({ selector: { id: { $in: oldChunkIds } } })
          .exec()) as RxDocument<ChunkDocType>[];
        const currentIds = new Set(current.map((chunk) => chunk.id));
        const missing = oldChunkDocuments.filter(
          (chunk) => !currentIds.has(chunk.id),
        );
        if (missing.length > 0) {
          const result = await db.chunks.bulkInsert(missing);
          if (getBulkErrors(result).length > 0) {
            throw new Error("Some old chunks could not be restored");
          }
        }
      } catch (error) {
        logger.error("[AutoProcessor] Failed to restore old chunks", { error });
      }
    };

    // Insert replacements first, while the old generation remains intact.
    // Any partial/failed insert is compensated using only this generation's
    // IDs, so cancellation cannot delete chunks from another run.
    if (newChunkDocuments.length > 0) {
      try {
        const result = await db.chunks.bulkInsert(newChunkDocuments);
        if (getBulkErrors(result).length > 0) {
          throw new Error("Some replacement chunks could not be inserted");
        }
      } catch (error) {
        await rollbackNewChunks();
        throw error;
      }
      if (signal?.aborted) {
        await rollbackNewChunks();
        return;
      }
    }

    let oldRemovalStarted = false;
    let vectorWriteStarted = false;
    try {
      if (signal?.aborted) {
        throw new DOMException("Chunk replacement aborted", "AbortError");
      }
      if (oldChunkIds.length > 0) {
        oldRemovalStarted = true;
        const result = await db.chunks.bulkRemove(oldChunks);
        if (getBulkErrors(result).length > 0) {
          throw new Error("Some old chunks could not be removed");
        }
      }
      if (signal?.aborted) {
        throw new DOMException("Chunk replacement aborted", "AbortError");
      }
      if (newChunkDocuments.length > 0) {
        vectorWriteStarted = true;
        await vectorIndexService.replace(
          oldChunkIds.flatMap((id) => [id, `chunk:${id}`]),
          chunkData.map((data) => ({
            id: `chunk:${data.id}`,
            embedding: data.embedding,
            title: parentId,
            url: parentType,
          })),
          signal,
        );
      }
      if (signal?.aborted) {
        throw new DOMException("Chunk replacement aborted", "AbortError");
      }
    } catch (error) {
      await rollbackNewChunks();
      if (oldRemovalStarted) {
        await restoreOldChunks();
      }
      // BATCH_ADD has no per-item remove operation. Rebuild the in-memory
      // index from the restored RxDB generation when a vector write started.
      if (vectorWriteStarted && typeof vectorIndexService.rebuild === "function") {
        try {
          await vectorIndexService.rebuild();
        } catch (rebuildError) {
          logger.error("[AutoProcessor] Failed to rebuild vector index rollback", {
            error: safeErrorForLog(rebuildError),
          });
        }
      }
      throw error;
    }
  }

  /**
   * Processes one bounded page of pending items without touching the long-lived
   * RxDB subscription. This is the entry point used by intelligent maintenance
   * so a repair cycle really is bounded; starting and immediately stopping the
   * subscription would only schedule its debounce timer and repair nothing.
   */
  async processPendingItems(
    maxItems = 5,
    signal?: AbortSignal,
  ): Promise<{ processed: number; failed: number; skipped: number }> {
    if (signal?.aborted) {
      throw new DOMException("Pending processing aborted", "AbortError");
    }
    if (this.isProcessing) {
      return { processed: 0, failed: 0, skipped: Math.max(0, Math.floor(maxItems)) };
    }

    const limit = Math.max(1, Math.min(5, Math.floor(maxItems)));
    if (this.useCount === 0) {
      this.useCount = 1;
    }
    const generation = this.lifecycleGeneration;
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (signal) {
      signal.addEventListener("abort", abortFromCaller, { once: true });
    }
    this.isProcessing = true;
    this.processingGeneration = generation;
    this.activeBatchController = controller;

    try {
      const db = await initDB();
      const bookmarks = await db.bookmarks.find({
        selector: { processed: { $ne: true }, isDeleted: false },
        limit,
      }).exec();
      const remaining = Math.max(0, limit - bookmarks.length);
      const documents = remaining > 0
        ? await db.documents.find({
            selector: { processed: { $ne: true }, isDeleted: false },
            limit: remaining,
          }).exec()
        : [];
      const items = [
        ...bookmarks.map((item) => ({ item, type: "bookmark" as const })),
        ...documents.map((item) => ({ item, type: "document" as const })),
      ];
      let processed = 0;
      let failed = 0;

      for (const task of items) {
        if (generation !== this.lifecycleGeneration) {
          throw new DOMException("Pending processing invalidated", "AbortError");
        }
        if (controller.signal.aborted) {
          throw new DOMException("Pending processing aborted", "AbortError");
        }
        try {
          if (task.type === "bookmark") {
            await this.processBookmark(task.item, controller.signal);
          } else {
            await this.processDocument(task.item, controller.signal);
          }

          const refreshed = task.type === "bookmark"
            ? await db.bookmarks.findOne(task.item.id).exec()
            : await db.documents.findOne(task.item.id).exec();
          if (refreshed?.processed === true) {
            processed += 1;
          } else {
            failed += 1;
          }
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") throw error;
          failed += 1;
          logger.warn("[AutoProcessor] Bounded pending repair failed", {
            error: safeErrorForLog(error),
          });
        }
      }

      return { processed, failed, skipped: 0 };
    } finally {
      signal?.removeEventListener("abort", abortFromCaller);
      if (this.processingGeneration === generation) {
        this.isProcessing = false;
        this.processingGeneration = null;
        if (this.activeBatchController === controller) {
          this.activeBatchController = null;
        }
      }
    }
  }

  /**
   * Forces all items to be marked as unprocessed so they get re-indexed.
   * Concurrent callers share one database sweep.
   */
  async forceReprocessAll(): Promise<number> {
    if (this.forceReprocessInFlight) {
      return this.forceReprocessInFlight;
    }
    const operation = this.forceReprocessAllExclusive();
    this.forceReprocessInFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.forceReprocessInFlight === operation) {
        this.forceReprocessInFlight = null;
      }
    }
  }

  private async forceReprocessAllExclusive(): Promise<number> {
    const db = await initDB();

    // Audit #6: a forced re-process must clear any pending backoff state.
    this.retryState.clear();

    logger.info("[AutoProcessor] Forcing re-process of all items");

    const markAllUnprocessed = async <T extends RxDocument<BookmarkDocType> | RxDocument<DocumentDocType>>(
      getBatch: () => Promise<T[]>,
    ): Promise<number> => {
      let count = 0;
      // Iteration cap (pruneVersions OOM class): the loop's only exits are
      // data-volume checks (empty / short page). A collection that keeps
      // returning a full 500-doc page — e.g. a mock that does not reflect
      // patches — would otherwise allocate forever. 1000 iterations x 500
      // docs covers 500k items per collection, far beyond the vault scale
      // target, while still hard-stopping a pathological loop.
      let iterations = 0;
      const MAX_ITERATIONS = 1000;
      for (;;) {
        if (iterations >= MAX_ITERATIONS) {
          logger.warn(
            "[AutoProcessor] Reprocess mark hit max iterations; aborting to avoid an unbounded loop",
            { count },
          );
          break;
        }
        iterations++;
        const batch = await getBatch();
        if (batch.length === 0) break;
        await Promise.all(batch.map((doc) => doc.incrementalPatch({ processed: false })));
        count += batch.length;
        // A short page is the final page. This also avoids retrying forever
        // against a test/mock collection that does not reflect patches.
        if (batch.length < 500) break;
      }
      return count;
    };

    const [bookmarkCount, documentCount] = await Promise.all([
      markAllUnprocessed(() =>
        db.bookmarks.find({
          selector: { processed: true },
          limit: 500,
        }).exec(),
      ),
      markAllUnprocessed(() =>
        db.documents.find({
          selector: { processed: true },
          limit: 500,
        }).exec(),
      ),
    ]);

    const count = bookmarkCount + documentCount;
    logger.info("[AutoProcessor] Marked items for re-processing", {
      count,
    });
    return count;
  }

  stop() {
    this.useCount = Math.max(0, this.useCount - 1);
    if (this.useCount > 0) {return;}
    this.lifecycleGeneration++;
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    // Audit #6: cancel any pending retry re-check and clear backoff state.
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryState.clear();
    // Reset processing state
    this.isProcessing = false;
    this.processingGeneration = null;
    this.activeBatchController?.abort();
    this.activeBatchController = null;
    this.updateStatus({
      isProcessing: false,
      totalItems: 0,
      processedItems: 0,
      currentItem: undefined,
    });
  }
}

export const autoProcessorService = new AutoProcessorService();
