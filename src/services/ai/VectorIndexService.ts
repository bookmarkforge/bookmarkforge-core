import { initDB } from "../../db/database";
import type { QuantizationMode } from "./QuantizationService";
import { securityVault } from "../SecurityVault";
// ADR-046 parity (voy index): the Voy index key derivation must NOT reuse a
// bundle-wide Argon2id salt — that is the exact RFC 9106 violation A-1 fixed
// for the master-key corpus (one harvested dictionary usable against every
// vault). The index key is instead derived under the SAME per-vault KDF salt
// the master key uses, read from the crypto layer.
import { getVaultKdfSaltHex } from "../../utils/crypto-core";
import { logger } from "../../utils/logger";
import { safeErrorForLog } from "../../utils/safeErrorForLog";

const MAX_INDEXED_EMBEDDINGS = 50_000;

interface WorkerMessage {
  id: number;
  type: string;
  payload?: unknown;
}

interface _WorkerResponse {
  id: number;
  type: "SUCCESS" | "ERROR";
  payload?: unknown;
  error?: string;
}

interface DocData {
  id: string;
  title?: string;
  content?: string;
  url?: string;
  parentId?: string;
  parentType?: string;
  embedding?: number[];
  embeddings?: number[];
}

interface CollectionWithFind {
  find: (query: { limit: number; skip: number }) => {
    exec(): Promise<{ toJSON?: () => DocData; [key: string]: unknown }[]>;
  };
}

interface DBWithCollections {
  chunks: CollectionWithFind;
  memory: CollectionWithFind;
}

interface LoadIndexResult {
  loaded: boolean;
  mode: QuantizationMode;
  legacyNormalized?: boolean;
  malformed?: boolean;
  legacyPurged?: boolean;
}

type VectorIndexLoadStatus =
  | "unknown"
  | "initializing"
  | "locked"
  | "loaded"
  | "legacy-normalized"
  | "rebuilt"
  | "malformed-rebuilt"
  | "legacy-rebuilt";

/** Typed result from the Voy HNSW worker's SEARCH operation. */
export interface VectorSearchResult {
  neighbors: Array<{ id: string; title?: string; url?: string; similarity?: number }>;
}

/**
 * Service to manage the HNSW vector index for instant semantic search via WebWorker.
 */
class VectorIndexService {
  private worker: Worker | null = null;
  private isInitialized = false;
  private initializePromise: Promise<void> | null = null;
  private commitPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private messageId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();
  private readonly MAX_PENDING_REQUESTS = 50; // Prevent memory leaks from stuck requests
  private quantizationMode: QuantizationMode = "polar8";
  private vaultKeyConfigured = false;
  private vaultKeyPromise: Promise<void> | null = null;
  // Invalidates initialization and database work that finishes after a vault
  // lock, worker replacement, or explicit clear.
  private lifecycleGeneration = 0;
  private loadStatus: VectorIndexLoadStatus = "unknown";
  private loadDurationMs: number | null = null;

  /** Returns local-only diagnostics; they contain no vault content or IDs. */
  getLoadStatus(): VectorIndexLoadStatus {
    return this.loadStatus;
  }

  getLoadDurationMs(): number | null {
    return this.loadDurationMs;
  }

  constructor() {
    // Keep the worker key lifecycle aligned with the vault lifecycle. The
    // callbacks are intentionally fire-and-forget because SecurityVault
    // notifies synchronously after changing its state.
    securityVault.onUnlock(() => {
      const operation = this.setVaultKey();
      this.vaultKeyPromise = operation;
      void operation
        .catch((error: unknown) => {
          logger.warn("[VectorIndex] Failed to install vault key", {
            error: safeErrorForLog(error),
          });
        })
        .finally(() => {
          if (this.vaultKeyPromise === operation) {
            this.vaultKeyPromise = null;
          }
        });
    });
    securityVault.onLock(() => {
      this.vaultKeyConfigured = false;
      void this.lockVault().catch((error: unknown) =>
        logger.warn("[VectorIndex] Failed to clear index on vault lock", {
          error: safeErrorForLog(error),
        }),
      );
    });
  }

  private async setVaultKey(): Promise<void> {
    if (!this.worker || securityVault.isLocked()) {return;}

    // ADR-046 parity (voy index): derive the index key under the per-vault
    // Argon2id salt, never the retired bundle-wide constant. The unlock path
    // installs the salt before onUnlock listeners fire, so it is available
    // here; failing closed (skip SET_KEY) keeps in-memory search working
    // (ensureVaultKey degrades) while at-rest persistence stays disabled —
    // an index written under a wrong salt would be unreadable after reload.
    const vaultSalt = getVaultKdfSaltHex();
    if (!vaultSalt) {
      logger.warn(
        "[VectorIndex] Encrypted persistence unavailable: no per-vault KDF salt installed (vault locked or legacy salt pending provisioning)",
      );
      return;
    }

const passwordBytes = securityVault.withMasterPasswordBytes(
       this,
       (bytes) => bytes,
     );
     if (!passwordBytes) {return;}
     const pw = passwordBytes as Uint8Array;
     try {
       await this.sendMessage("SET_KEY", {
         passwordBytes: pw,
         vaultSalt,
         keyId: crypto.randomUUID(),
       });
       this.vaultKeyConfigured = true;
       // SET_KEY intentionally wipes the worker's in-memory index. If a key is
       // installed into an already-running worker, force a clean reinitialize
       // rather than allowing SEARCH to run against a null Voy instance.
       if (this.isInitialized) {
         this.isInitialized = false;
         this.terminateWorker("Voy key installed; reinitializing index");
       }
     } finally {
       for (let i = 0; i < pw.length; i++) { pw[i] = pw[i]! ^ 0xAA; }
       pw.fill(0);
     }
   }

  private async ensureVaultKey(): Promise<void> {
    try {
      if (this.vaultKeyConfigured) {return;}
      if (this.vaultKeyPromise) {
        await this.vaultKeyPromise;
      }
      if (!this.vaultKeyConfigured && !securityVault.isLocked()) {
        await this.setVaultKey();
      }
    } catch (error: unknown) {
      // Search remains available in memory, but persistence stays disabled
      // until a later unlock can install a valid key.
      logger.warn("[VectorIndex] Encrypted persistence unavailable", {
        error: safeErrorForLog(error),
      });
      this.vaultKeyConfigured = false;
    }
  }

  private async sendMessage(
    type: string,
    payload?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.worker) {throw new Error("Worker not initialized");}
    if (signal?.aborted) {
      throw new DOMException("Vector index request aborted", "AbortError");
    }

    // Prevent memory leaks by limiting pending requests
    if (this.pendingRequests.size >= this.MAX_PENDING_REQUESTS) {
      // Clean up oldest requests
      const oldestKeys = Array.from(this.pendingRequests.keys()).slice(
        0,
        this.pendingRequests.size - this.MAX_PENDING_REQUESTS + 1,
      );
      oldestKeys.forEach((key) => {
        const request = this.pendingRequests.get(key);
        if (request) {
          request.reject(new Error("Request timed out due to queue overflow"));
          this.pendingRequests.delete(key);
        }
      });
    }

    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pendingRequests.set(id, { resolve, reject });

      // Set timeout to prevent orphaned promises
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          this.isInitialized = false;
          // A timed-out worker may still hold the request and block every
          // subsequent operation. Retire it and reject all siblings rather
          // than leaving a half-alive index service behind.
          this.terminateWorker(`Request ${type} timed out after 30s`);
          wrappedReject(new Error(`Request ${type} timed out after 30s`));
        }
      }, 30000);

      let onAbort = (): void => undefined;
      // Wrap resolve/reject to clear timeout and abort listener.
      const cleanup = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
      };
      const wrappedResolve = (val: unknown) => {
        cleanup();
        resolve(val);
      };
      const wrappedReject = (err: Error) => {
        cleanup();
        reject(err);
      };

      onAbort = () => {
        if (!this.pendingRequests.has(id)) {return;}
        // Voy has no portable cancellation message for an async search. Drop
        // this request before retiring the worker so the abort error is not
        // replaced by the generic worker-termination error.
        this.pendingRequests.delete(id);
        this.isInitialized = false;
        this.terminateWorker("Vector index request aborted");
        wrappedReject(new DOMException("Vector index request aborted", "AbortError"));
      };

      // Update stored callbacks
      this.pendingRequests.set(id, {
        resolve: wrappedResolve,
        reject: wrappedReject,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      try {
        this.worker!.postMessage({ id, type, payload } as WorkerMessage);
      } catch (error) {
        this.pendingRequests.delete(id);
        this.isInitialized = false;
        this.terminateWorker("Vector index worker rejected a message");
        wrappedReject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  }

  private enqueueMutation<T>(
    generation: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.mutationQueue;
    const run = () => {
      if (generation !== this.lifecycleGeneration) {
        throw new DOMException(
          "Vector mutation invalidated",
          "AbortError",
        );
      }
      return operation();
    };
    const queued = previous.then(run, run);
    this.mutationQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  setQuantizationMode(mode: QuantizationMode) {
    this.quantizationMode = mode;
  }

  async getStats() {
    if (!this.isInitialized) {return null;}
    return await this.sendMessage("GET_STATS");
  }

  async rebuild() {
    await this.clear(); // Clear memory and disk first
    await this.initialize();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {return;}
    if (this.initializePromise) {
      return this.initializePromise;
    }

    const operation = this.initializeInternal();
    this.initializePromise = operation;
    try {
      await operation;
    } catch (error) {
      // Initialization may fail after creating the worker (IDB failure,
      // malformed index, or INIT rejection). Tear it down so a later retry
      // cannot orphan the failed worker or stack a second one on top.
      if (!this.isInitialized) {
        this.terminateWorker("Vector index initialization failed");
      }
      throw error;
    } finally {
      if (this.initializePromise === operation) {
        this.initializePromise = null;
      }
    }
  }

  private async initializeInternal(): Promise<void> {
    if (this.isInitialized) {return;}
    const startedAt = Date.now();
    this.loadStatus = "initializing";
    this.loadDurationMs = null;
    const generation = this.lifecycleGeneration;
    const assertCurrent = (): void => {
      if (generation !== this.lifecycleGeneration) {
        throw new DOMException(
          "Vector index initialization invalidated",
          "AbortError",
        );
      }
    };

    // Initialize worker
    const worker = new Worker(
      new URL("../../workers/voy.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );

    this.worker = worker;
    worker.onmessage = (e: MessageEvent) => {
      // A stale worker must not resolve requests belonging to its replacement.
      if (this.worker !== worker) {return;}
      const { id, type, payload, error, fatal } = e.data;
      const request = this.pendingRequests.get(id);
      if (request) {
        if (type === "SUCCESS") {
          request.resolve(payload);
        } else {
          request.reject(new Error(error));
        }
        this.pendingRequests.delete(id);
      }
      if (fatal === true) {
        // A fatal worker response can mean an uninterruptible search is still
        // running behind Promise.race. Retire the worker before any queued
        // request can observe or mutate the poisoned Voy instance.
        this.isInitialized = false;
        this.terminateWorker(
          `Fatal vector index worker error: ${error || "unknown"}`,
        );
      }
    };

    worker.onerror = (err: ErrorEvent) => {
      if (this.worker !== worker) {return;}
      logger.error("[VectorIndex] Worker error", { error: safeErrorForLog(err) });
      for (const [, req] of this.pendingRequests) {
        req.reject(new Error(`Worker crashed: ${err.message}`));
      }
      this.pendingRequests.clear();
      this.isInitialized = false;
      this.worker = null;
    };

    // Install the vault key before reading persisted data. If the vault is
    // locked, this is a no-op and the worker remains usable in memory only.
    await this.ensureVaultKey();

    // Try loading from IndexedDB first
    let loadStatusFromWorker: "malformed" | "legacyPurged" | "empty" | "error" =
      "empty";
    assertCurrent();
    try {
      const loadResult = (await this.sendMessage(
        "LOAD_INDEX",
      )) as LoadIndexResult;
      if (loadResult && loadResult.loaded) {
        logger.info(`[VectorIndex] Loaded index from disk`, {
          mode: loadResult.mode,
        });
        this.quantizationMode = loadResult.mode;
        this.loadStatus = loadResult.legacyNormalized
          ? "legacy-normalized"
          : "loaded";
        if (loadResult.legacyNormalized) {
          // Persist the normalized IDs once, so subsequent unlocks do not
          // repeatedly carry the legacy representation in memory.
          await this.sendMessage("SAVE_INDEX");
        }
        this.isInitialized = true;
        this.loadDurationMs = Math.max(0, Date.now() - startedAt);
        return;
      }
      if (loadResult?.malformed) {
        loadStatusFromWorker = "malformed";
      } else if (loadResult?.legacyPurged) {
        loadStatusFromWorker = "legacyPurged";
      }
    } catch (err: unknown) {
      loadStatusFromWorker = "error";
      if (generation !== this.lifecycleGeneration) {throw err;}
      logger.warn(
        "[VectorIndex] Failed to load index from disk, rebuilding...",
        { error: safeErrorForLog(err) },
      );
    }

    // Load embeddings from RxDB. The worker distinguishes an empty source,
    // a purged legacy record, and malformed encrypted metadata so diagnostics
    // can explain why a rebuild happened without exposing vault contents.
    assertCurrent();
    const db = (await initDB()) as unknown as DBWithCollections;
    assertCurrent();
    const allEmbeddings: {
      id: string;
      title: string;
      url: string;
      embeddings: number[];
    }[] = [];

    // Collections to index. The unified `memory` collection also holds atoms,
    // so we scan it with a `type: "atom"` selector — the indexer treats the
    // prefix as the storage slot ("atom:") and never reads the content of
    // profiles/sessions/messages.
    const collections: { name: keyof DBWithCollections; prefix: string; selector?: Record<string, unknown> }[] = [
      { name: "chunks", prefix: "chunk:" },
      { name: "memory", prefix: "atom:", selector: { type: "atom" } },
    ];

    for (const col of collections) {
      let offset = 0;
      let hasMore = true;
      const batchSize = 1000;
      const collection = db[col.name] as CollectionWithFind;

      while (hasMore) {
        const docs = await collection
          .find({
            ...(col.selector ? { selector: col.selector } : {}),
            limit: batchSize,
            skip: offset,
          })
          .exec();
        // Abort promptly when the vault changes while a large collection is
        // being paged. Without this check, a lock could leave tens of
        // thousands of embeddings retained until the whole rebuild finished.
        assertCurrent();

        if (docs.length === 0) {
          hasMore = false;
          break;
        }

        for (const doc of docs) {
          assertCurrent();
          const data = (
            typeof doc.toJSON === "function" ? doc.toJSON() : doc
          ) as DocData;
          const embedding = data.embedding || data.embeddings;
          if (embedding && embedding.length > 0) {
            if (allEmbeddings.length >= MAX_INDEXED_EMBEDDINGS) {
              throw new Error(
                `Vector index exceeds the ${MAX_INDEXED_EMBEDDINGS} embedding limit`,
              );
            }
            allEmbeddings.push({
              id: String(col.prefix) + (data.id || ""),
              title: data.title || data.content || data.parentId || "No Title",
              url: data.url || data.parentType || "",
              embeddings: embedding as number[],
            });
          }
        }

        offset += docs.length;
        if (docs.length < batchSize) {hasMore = false;}
        logger.debug(
          `[VectorIndex] Loaded ${offset} embeddings from ${String(col.name)}...`,
        );
      }
    }

    if (loadStatusFromWorker === "malformed") {
      this.loadStatus = "malformed-rebuilt";
    } else if (loadStatusFromWorker === "legacyPurged") {
      this.loadStatus = "legacy-rebuilt";
    } else {
      this.loadStatus = "rebuilt";
    }

    // Initialize Voy index in worker
    assertCurrent();
    await this.sendMessage("INIT", {
      embeddings: allEmbeddings,
      quantizationMode: this.quantizationMode,
    });

    // Save the rebuilt index to disk
    assertCurrent();
    await this.sendMessage("SAVE_INDEX");

    this.isInitialized = true;
    this.loadDurationMs = Math.max(0, Date.now() - startedAt);
  }

  async commit(): Promise<void> {
    if (this.commitPromise) {
      return this.commitPromise;
    }
    if (!this.isInitialized) {return;}

    const generation = this.lifecycleGeneration;
    const operation = this.enqueueMutation(generation, async () => {
      await this.sendMessage("COMMIT");
      // A lock, clear, or worker replacement invalidates the persistence
      // generation. Never issue SAVE_INDEX for the retired worker/context.
      if (generation !== this.lifecycleGeneration || !this.isInitialized) {
        return;
      }
      await this.sendMessage("SAVE_INDEX");
    });
    this.commitPromise = operation;
    try {
      await operation;
    } finally {
      if (this.commitPromise === operation) {
        this.commitPromise = null;
      }
    }
  }

  async lockVault() {
    this.loadStatus = "locked";
    this.loadDurationMs = null;
    if (!this.worker && !this.isInitialized && !this.initializePromise) {return;}
    try {
      if (this.isInitialized) {
        await this.sendMessage("CLEAR_MEMORY");
      }
    } finally {
      this.isInitialized = false;
      this.terminateWorker("Vault locked");
      this.loadStatus = "locked";
      this.loadDurationMs = null;
    }
  }

  private terminateWorker(reason = "Vector index worker terminated"): void {
    this.lifecycleGeneration += 1;
    this.loadStatus = "unknown";
    this.loadDurationMs = null;
    this.vaultKeyConfigured = false;
    this.initializePromise = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const request of this.pendingRequests.values()) {
      request.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  async add(
    id: string,
    embedding: number[],
    title: string,
    url: string,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) {
      throw new DOMException("Vector index add aborted", "AbortError");
    }
    if (!this.isInitialized) {await this.initialize();}
    if (signal?.aborted) {
      throw new DOMException("Vector index add aborted", "AbortError");
    }

    const generation = this.lifecycleGeneration;
    await this.enqueueMutation(generation, () =>
      this.sendMessage(
        "ADD",
        {
          id,
          title,
          url,
          embeddings: embedding,
        },
        signal,
      ),
    );
  }

  async batchAdd(
    items: { id: string; embedding: number[]; title: string; url: string }[],
  ) {
    // Avoid starting a worker just to process an empty batch.
    if (items.length === 0) {return;}
    if (!this.isInitialized) {await this.initialize();}

    const generation = this.lifecycleGeneration;
    await this.enqueueMutation(generation, () =>
      this.sendMessage("BATCH_ADD", {
        items: items.map((item) => ({
          id: item.id,
          title: item.title,
          url: item.url,
          embeddings: item.embedding,
        })),
      }),
    );
  }

  /**
   * Replaces one source generation in the worker atomically. This prevents
   * deleted chunks from remaining as stale vector neighbors after a rebuild.
   */
  async replace(
    removeIds: string[],
    items: { id: string; embedding: number[]; title: string; url: string }[],
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException("Vector index replacement aborted", "AbortError");
    }
    if (removeIds.length === 0 && items.length === 0) {return;}
    if (!this.isInitialized) {await this.initialize();}
    if (signal?.aborted) {
      throw new DOMException("Vector index replacement aborted", "AbortError");
    }

    const generation = this.lifecycleGeneration;
    await this.enqueueMutation(generation, () =>
      this.sendMessage(
        "REPLACE",
        {
          removeIds,
          items: items.map((item) => ({
            id: item.id,
            title: item.title,
            url: item.url,
            embeddings: item.embedding,
          })),
        },
        signal,
      ),
    );
  }

  /**
   * Removes vectors only when the in-memory worker is already initialized.
   * Cleanup must never bootstrap a worker while the vault is locked or after
   * a lifecycle transition has retired the index.
   */
  async remove(ids: string[], signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException("Vector index removal aborted", "AbortError");
    }
    if (ids.length === 0 || !this.isInitialized) {return;}
    const generation = this.lifecycleGeneration;
    await this.enqueueMutation(generation, () =>
      this.sendMessage(
        "REPLACE",
        { removeIds: ids, items: [] },
        signal,
      ),
    );
  }

  async search(
    embedding: number[],
    topK: number = 5,
    signal?: AbortSignal,
  ): Promise<VectorSearchResult> {
    if (signal?.aborted) {
      throw new DOMException("Vector search aborted", "AbortError");
    }
    if (!this.isInitialized) {await this.initialize();}
    if (signal?.aborted) {
      throw new DOMException("Vector search aborted", "AbortError");
    }
    return (await this.sendMessage("SEARCH", { embedding, topK }, signal)) as VectorSearchResult;
  }

  async clear() {
    if (!this.worker && !this.isInitialized && !this.initializePromise) {return;}
    try {
      if (this.isInitialized) {
        await this.sendMessage("CLEAR");
      }
    } finally {
      this.isInitialized = false;
      this.terminateWorker("Vector index cleared");
    }
  }
}

export const vectorIndexService = new VectorIndexService();
securityVault.registerCaller(vectorIndexService);
