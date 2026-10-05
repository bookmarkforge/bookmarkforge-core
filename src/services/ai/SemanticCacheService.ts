/**
 * Provides provider-level prompt caching advisory based on model capabilities.
 * Anthropic and OpenAI both offer prompt caching for long system prompts:
 * when the same prefix appears in many requests, the provider caches the KV state
 * and charges ~10% of the base input cost for the cached portion.
 *
 * Usage: Structure prompts so the static system content comes FIRST, followed
 * by the variable user prompt. This maximizes cache hit rates across users.
 */
import { logger } from "../../utils/logger";
import { safeErrorForLog } from "../../utils/safeErrorForLog";
import { getIndexedDB } from "../../utils/indexedDB";
import { AIResponse, AIProvider } from "./types";
import { encryptionService } from "../EncryptionService";
import { securityVault } from "../SecurityVault";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_PIPELINE_OPTIONS,
} from "./embeddingModel";

// Extend the Neighbor interface to include distance property that voy-search actually returns
// despite not being in the official type definitions
type VoyNeighbor = { id: string; distance: number };

// Based on voy-search types, Neighbor may not have distance property directly
// Let's define our own type based on what we actually use
interface VoySearchResult {
  neighbors: Array<VoyNeighbor> | null;
}

interface CachedIntent {
  id: string;
  response: AIResponse;
  timestamp: number;
}

/** Plaintext payload encrypted before it is written to IndexedDB. */
interface PersistedIntent extends CachedIntent {
  // Optional for backward compatibility with already-encrypted entries. New
  // entries deliberately omit the query because Voy and the lookup map do not
  // need to retain user text after deriving the embedding.
  query?: string;
  embedding: number[];
}

/** Only the random cache id remains plaintext as the IndexedDB keyPath. */
interface PersistedEnvelope {
  id: string;
  ciphertext: string;
}

const semanticCacheCaller = {};
securityVault.registerCaller(semanticCacheCaller);

/**
 * IndexedDB database that stores the semantic cache across sessions so the
 * ~22MB embedding model load pays off from the very first query of a session.
 *
 * PRIVACY: ProviderManager only calls `semanticCache.add` for non-private
 * requests (isPrivate skips both the request cache and the semantic cache),
 * so this store never contains `isPrivate` content. It still holds AI
 * responses derived from user data, so it is wiped by Nuclear Forget
 * (see NuclearForgetService) and by `wipePersistence()`.
 */
export const SEMANTIC_CACHE_DB = "bookmarkforge-semantic-cache";
const PERSIST_STORE = "entries";
const PERSIST_VERSION = 1;

export class SemanticCacheService {
  private voy: import("voy-search").Voy | null = null;
  private extractor:
    import("@huggingface/transformers").FeatureExtractionPipeline | null = null;
  private isReady = false;
  private isInitializing = false;
  // Embeddings are an optional optimization. When the browser cannot load
  // the model, avoid retrying on every AI request and flooding the console.
  private initializationFailedUntil = 0;
  private readonly INITIALIZATION_RETRY_COOLDOWN_MS = 60_000;

  // IndexedDB persistence (lazily opened, null-safe when unavailable)
  private db: IDBDatabase | null = null;
  private dbOpen: Promise<IDBDatabase> | null = null;

  // Storage mapping ID -> Response data
  private intentStore = new Map<string, CachedIntent>();
  private readonly SIMILARITY_THRESHOLD = 0.92;
  private readonly MAX_CACHE_SIZE = 100;
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  private vaultGeneration = 0;
  private invalidationPromise: Promise<void> | null = null;
  private readonly unsubscribeVaultLock: () => void;
  private readonly unsubscribeVaultUnlock: () => void;

  constructor() {
    // Semantic responses are derived from vault content. Wipe both memory and
    // IndexedDB on every vault transition so a different vault cannot restore
    // the previous vault's generated response or embedding.
    const invalidate = () => {
      // A new vault may have a different runtime/model environment; allow a
      // fresh initialization attempt after every lock/unlock transition.
      this.initializationFailedUntil = 0;
      const pending = this.wipePersistence();
      const wrapped = pending.finally(() => {
        if (this.invalidationPromise === wrapped) {
          this.invalidationPromise = null;
        }
      });
      this.invalidationPromise = wrapped;
    };
    this.unsubscribeVaultLock = securityVault.onLock(invalidate);
    this.unsubscribeVaultUnlock = securityVault.onUnlock(invalidate);
  }

  // NOTE: the embedding model is only loaded on first real demand (findSimilar/add) and never at module
  // import time, so an app session that never exercises the semantic cache
  // pays nothing for it.

  private async init() {
    if (this.isReady || this.isInitializing) {return;}
    if (this.initializationFailedUntil > Date.now()) {return;}
    this.isInitializing = true;

    try {
      logger.info("[SemanticCache] Initializing local embedding model...");

      // 1. Load light embedding model (~22MB) via Web Worker or main thread.
      // The real module has NO default export — env/pipeline are named
      // exports. Reading (hf as any).default.env would be undefined.env and
      // throw, silently disabling the semantic cache.
      const hf = await import("@huggingface/transformers");
      const { pipeline, env } = hf;
      env.allowLocalModels = true;
      this.extractor = (await pipeline(
        "feature-extraction",
        EMBEDDING_MODEL_ID,
        { ...EMBEDDING_MODEL_PIPELINE_OPTIONS },
      )) as unknown as import("@huggingface/transformers").FeatureExtractionPipeline;

      // 2. Initialize Voy vector database
      // Voy requires providing the dimension of the vectors.
      const { Voy } = await import("voy-search");
      const resource = {
        embeddings: [
          {
            id: "init",
            title: "init",
            url: "init",
            embeddings: new Array(EMBEDDING_MODEL_DIMENSIONS).fill(0),
          },
        ],
      };
      this.voy = new Voy(resource);
      // Remove the init vector immediately
      this.voy.clear();

      // 3. Restore the index persisted by previous sessions (best-effort —
      //    a corrupted/unavailable store must not disable the cache).
      try {
        await this.restoreFromPersist();
      } catch (e: unknown) {
        logger.warn("[SemanticCache] Failed to restore persisted index", {
          error: safeErrorForLog(e),
        });
      }

      this.isReady = true;
      this.initializationFailedUntil = 0;
      logger.info("[SemanticCache] Ready. Semantic caching is active.");
    } catch (error) {
      // Leave the service usable as a no-op. The model can be retried after a
      // cooldown, but a failed optional optimization must not spam every chat
      // request or retain a half-created extractor/index.
      this.isReady = false;
      this.extractor = null;
      this.voy = null;
      this.initializationFailedUntil =
        Date.now() + this.INITIALIZATION_RETRY_COOLDOWN_MS;
      logger.warn("[SemanticCache] Embedding model unavailable; cache paused", {
        error: safeErrorForLog(error),
        retryAfterMs: this.INITIALIZATION_RETRY_COOLDOWN_MS,
      });
    } finally {
      this.isInitializing = false;
    }
  }

  // ---- IndexedDB persistence ------------------------------------------

  private async getDB(): Promise<IDBDatabase | null> {
    const factory = getIndexedDB();
    if (!factory) {return null;}
    if (this.db) {return this.db;}
    if (!this.dbOpen) {
      this.dbOpen = new Promise<IDBDatabase>((resolve, reject) => {
        const req = factory.open(SEMANTIC_CACHE_DB, PERSIST_VERSION);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(PERSIST_STORE)) {
            d.createObjectStore(PERSIST_STORE, { keyPath: "id" });
          }
        };
        req.onsuccess = () => {
          this.db = req.result;
          resolve(req.result);
        };
        req.onerror = () => {
          this.dbOpen = null;
          reject(req.error ?? new Error("IDB open failed"));
        };
      });
    }
    return this.dbOpen;
  }/** Rebuild Voy + intentStore from the encrypted persisted index (TTL-filtered). */
  private async restoreFromPersist(): Promise<void> {
    if (!this.voy) {return;}
    const generation = this.vaultGeneration;

    const fresh = await this.withVaultPassword(async (masterPasswordBytes) => {
      if (generation !== this.vaultGeneration) {return [] as PersistedIntent[];}
      const db = await this.getDB();
      if (!db) {return [] as PersistedIntent[];}

      const entries = await new Promise<unknown[]>((resolve, reject) => {
        const tx = db.transaction(PERSIST_STORE, "readonly");
        const req = tx.objectStore(PERSIST_STORE).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as unknown[]);
        req.onerror = () => reject(req.error ?? new Error("IDB read failed"));
      }).catch(() => [] as unknown[]);

      const now = Date.now();
      const freshEntries: PersistedIntent[] = [];
      for (const raw of entries) {
        if (generation !== this.vaultGeneration) {return [] as PersistedIntent[];}
        const envelope = raw as Partial<PersistedEnvelope> | null;
        if (
          !envelope ||
          typeof envelope.id !== "string" ||
          typeof envelope.ciphertext !== "string"
        ) {
          // Legacy plaintext entries are never loaded. Remove them instead
          // of exposing their query, response, or embedding in memory.
          if (envelope && typeof envelope.id === "string") {
            this.deletePersisted(envelope.id);
          }
          continue;
        }

        try {
          const decrypted = await encryptionService.decryptWithBytes(
            envelope.ciphertext,
            new Uint8Array(masterPasswordBytes),
          );
          const parsed = JSON.parse(decrypted) as Partial<PersistedIntent>;
          if (
            typeof parsed.id !== "string" ||
            parsed.id !== envelope.id ||
            typeof parsed.timestamp !== "number" ||
            !Number.isFinite(parsed.timestamp) ||
            !Array.isArray(parsed.embedding) ||
            parsed.embedding.length !== EMBEDDING_MODEL_DIMENSIONS ||
            !parsed.embedding.every((value) => typeof value === "number" && Number.isFinite(value)) ||
            typeof parsed.response !== "object" ||
            parsed.response === null
          ) {
            throw new Error("Invalid semantic cache payload");
          }
          const entry = parsed as PersistedIntent;
          if (now - entry.timestamp < this.CACHE_TTL_MS) {
            if (freshEntries.length < this.MAX_CACHE_SIZE) {
              freshEntries.push(entry);
            } else {
              // Do not retain or restore legacy overflow entries. Keeping the
              // persisted store bounded prevents an old/corrupt cache from
              // expanding memory during the first session after upgrade.
              this.deletePersisted(entry.id);
            }
          } else {
            this.deletePersisted(entry.id);
          }
        } catch (error) {
          // Wrong vault key, corruption, or legacy ciphertext must not be
          // restored. Keep the cache best-effort and remove unusable data.
          this.deletePersisted(envelope.id);
          logger.warn("[SemanticCache] Dropped unreadable persisted entry", {
            error: safeErrorForLog(error),
          });
        }
      }
      return freshEntries;
    });

    if (generation !== this.vaultGeneration || !fresh || fresh.length === 0) {return;}

    // Defensive cap: never restore more than the in-memory limit allows.
    const capped = fresh.slice(0, this.MAX_CACHE_SIZE);
    this.voy.index({
      embeddings: capped.map((e) => ({
        id: e.id,
        // The vector index only needs a stable id; never put query text into
        // its metadata, where it would remain plaintext in memory.
        title: e.id,
        url: "",
        embeddings: e.embedding,
      })),
    });
    for (const e of capped) {
      this.intentStore.set(e.id, {
        id: e.id,
        response: e.response,
        timestamp: e.timestamp,
      });
    }
    logger.info(`[SemanticCache] Restored ${capped.length} entries from IndexedDB`);
  }

  private async withVaultPassword<T>(
    operation: (passwordBytes: Uint8Array) => Promise<T>,
  ): Promise<T | null> {
    const passwordBytes = securityVault.withMasterPasswordBytes(
      semanticCacheCaller,
      (bytes) => bytes,
    );
    if (!passwordBytes) {return null;}
    const pw = passwordBytes as Uint8Array;
    try {
      return await operation(pw);
    } finally {
      for (let i = 0; i < pw.length; i++) { pw[i] = pw[i]! ^ 0xAA; }
      pw.fill(0);
    }
  }

   private async persistEntry(
    e: PersistedIntent,
    generation: number,
  ): Promise<void> {
    if (generation !== this.vaultGeneration) {return;}
    const ciphertext = await this.withVaultPassword((masterPasswordBytes) =>
      encryptionService.encryptWithBytes(
        JSON.stringify(e),
        new Uint8Array(masterPasswordBytes),
      ),
    );
    if (!ciphertext || generation !== this.vaultGeneration) {return;}
    const db = await this.getDB();
    if (!db || generation !== this.vaultGeneration) {return;}
    try {
      const envelope: PersistedEnvelope = { id: e.id, ciphertext };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PERSIST_STORE, "readwrite");
        tx.objectStore(PERSIST_STORE).put(envelope);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IDB put failed"));
      });
    } catch (err) {
      logger.warn("[SemanticCache] Persist failed", { error: safeErrorForLog(err) });
    }
  }

  private deletePersisted(id: string): void {
    this.getDB()
      .then((db) => {
        if (!db) {return;}
        return new Promise<void>((resolve, reject) => {
          const tx = db.transaction(PERSIST_STORE, "readwrite");
          tx.objectStore(PERSIST_STORE).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () =>
            reject(tx.error ?? new Error("IDB delete failed"));
        });
      })
      .catch((e: unknown) =>
        logger.warn("[SemanticCache] Persisted delete failed", {
          error: safeErrorForLog(e),
        }),
      );
  }

  private clearPersisted(): Promise<void> {
    return this.getDB()
      .then((db) => {
        if (!db) {return;}
        return new Promise<void>((resolve, reject) => {
          const tx = db.transaction(PERSIST_STORE, "readwrite");
          tx.objectStore(PERSIST_STORE).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () =>
            reject(tx.error ?? new Error("IDB clear failed"));
        });
      })
      .catch((e: unknown) =>
        logger.warn("[SemanticCache] Persisted clear failed", {
          error: safeErrorForLog(e),
        }),
      );
  }

  /**
   * Wipe the in-memory index and the persisted store, then release the
   * IndexedDB connection so a subsequent `indexedDB.deleteDatabase` is not
   * blocked. Used by Nuclear Forget to honor "Right to be Forgotten".
   */
  async wipePersistence(): Promise<void> {
    // Invalidate persistence operations before clearing the store. Without a
    // generation bump, an encryption/IDB put already in flight could recreate
    // sensitive cache data after the wipe has completed.
    this.vaultGeneration++;
    this.initializationFailedUntil = 0;
    this.intentStore.clear();
    this.voy?.clear();
    try {
      await this.clearPersisted();
    } finally {
      this.db?.close();
      this.db = null;
      this.dbOpen = null;
    }
  }

  // ---- Embeddings & query API ------------------------------------------

  /**
   * Generate 384D embedding vector for a given text
   */
  private async getEmbedding(text: string): Promise<number[]> {
    if (!this.extractor) {throw new Error("Extractor not initialized");}

    // Generate embeddings
    const output = await this.extractor(text, {
      pooling: "mean",
      normalize: true,
    });

    // Output is a Tensor, convert to standard JS array
    return Array.from(output.data as Float32Array);
  }

  /**
   * Search for a semantically identical intent in the cache
   */
  async findSimilar(
    prompt: string,
    systemPrompt?: string,
  ): Promise<AIResponse | null> {
    await this.invalidationPromise;
    const generation = this.vaultGeneration;
    if (!this.isReady && !this.isInitializing) {
      void this.init();
      return null;
    }
    if (!this.isReady || !this.voy) {return null;}
    this.pruneExpiredEntries();

    try {
      const queryContext = systemPrompt ? `${systemPrompt}\n${prompt}` : prompt;
      const queryEmbedding = await this.getEmbedding(queryContext);

      // Search top 1 nearest neighbor
      const results = this.voy.search(
        new Float32Array(queryEmbedding),
        1,
      ) as unknown as VoySearchResult;

      if (generation !== this.vaultGeneration) {return null;}
      if (results && results.neighbors && results.neighbors.length > 0) {
        // Access the first neighbor and cast to VoyNeighbor to access distance property
        const bestMatch = results.neighbors[0] as unknown as VoyNeighbor;

        // Check if similarity meets our strict threshold
        // P1 audit finding: Verify voy-search metric behavior.
        // Current assumption: voy-search returns Euclidean distance (0 = identical, higher = farther).
        // Conversion: similarity = 1 - min(distance, 1) maps [0,1] distance to [1,0] similarity.
        // Threshold validation: See src/tests/services/ai/SemanticCacheService.test.ts for
        // regression tests on this conversion with known vectors.
        const id = bestMatch.id;
        const distance = bestMatch.distance;
        const score = distance !== undefined ? 1 - Math.min(distance, 1) : 0; // Convert distance to similarity

        if (score >= this.SIMILARITY_THRESHOLD) {
          const cached = this.intentStore.get(id);
          if (cached) {
            logger.info("[SemanticCache] 🎯 Semantic Cache HIT!", {
              score,
            });

            if (Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
              return cached.response;
            } else {
              this.remove(id);
            }
          }
        } else {
          logger.debug("[SemanticCache] Cache miss (score too low)", { score });
        }
      }
      return null;
    } catch (error) {
      logger.warn("[SemanticCache] Search failed", {
        error: safeErrorForLog(error),
      });
      return null;
    }
  }

  /**
   * Add a new interaction to the semantic cache
   * P1 audit fix: enforce privacy context as an invariant of the component.
   * The caller MUST explicitly specify isPrivate and provider; the service
   * rejects private content to prevent vault data from persisting in the cache.
   */
  async add(
    prompt: string,
    response: AIResponse,
    systemPrompt?: string,
    options?: { isPrivate?: boolean; provider?: string },
  ): Promise<void> {
    // P1 audit fix: fail-closed privacy enforcement. Reject private content
    // at the boundary to make this an invariant of the component, not a
    // convention that callers must remember.
    if (options?.isPrivate !== false) {
      logger.warn("[SemanticCache] Rejected private content - semantic cache only accepts public requests");
      return;
    }

    await this.invalidationPromise;
    const generation = this.vaultGeneration;
    if (!this.isReady && !this.isInitializing) {
      void this.init();
      return;
    }
    if (!this.isReady || !this.voy) {return;}
    this.pruneExpiredEntries();

    try {
      const queryContext = systemPrompt ? `${systemPrompt}\n${prompt}` : prompt;
      const embedding = await this.getEmbedding(queryContext);
      if (generation !== this.vaultGeneration) {return;}

      const id = crypto.randomUUID();

      // Enforce size limit
      if (this.intentStore.size >= this.MAX_CACHE_SIZE) {
        this.evictOldest();
      }

      // Add to Voy index
      const data = [
        {
          id,
          // Do not retain query text in Voy metadata; the embedding is enough
          // to perform nearest-neighbor lookup.
          title: id,
          url: "",
          embeddings: embedding,
        },
      ];

      this.voy.index({ embeddings: data });

      // Store payload with provider metadata for consistency with strict cache
      const timestamp = Date.now();
      this.intentStore.set(id, {
        id,
        response: { ...response, provider: (options?.provider || response.provider) as AIProvider },
        timestamp,
      });

      // Persist to IndexedDB so the entry survives this session (best-effort).
      this.persistEntry(
        {
          id,
          response: { ...response, provider: (options?.provider || response.provider) as AIProvider },
          timestamp,
          embedding,
        },
        generation,
      ).catch((e: unknown) =>
        logger.warn("[SemanticCache] Entry persistence failed", {
          error: safeErrorForLog(e),
        }),
      );

      logger.debug("[SemanticCache] Intent added to cache");
    } catch (error) {
      logger.warn("[SemanticCache] Failed to add to cache", {
        error: safeErrorForLog(error),
      });
    }
  }

  private pruneExpiredEntries(now = Date.now()): void {
    for (const [id, entry] of this.intentStore) {
      if (now - entry.timestamp >= this.CACHE_TTL_MS) {
        this.remove(id);
      }
    }
  }

  private remove(id: string) {
    this.voy?.remove([
      { id, title: "", url: "", embeddings: [] },
    ] as unknown as Parameters<NonNullable<typeof this.voy>["remove"]>[0]);
    this.intentStore.delete(id);
    this.deletePersisted(id);
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    this.intentStore.forEach((value, key) => {
      if (value.timestamp < oldestTimestamp) {
        oldestTimestamp = value.timestamp;
        oldestKey = key;
      }
    });

    if (oldestKey) {
      this.remove(oldestKey);
    }
  }

  clear(): void {
    this.vaultGeneration++;
    this.initializationFailedUntil = 0;
    this.intentStore.clear();
    // Re-initialize Voy since we can't clear it easily without wiping
    this.voy?.clear();
    void this.clearPersisted();
    logger.info("[SemanticCache] Cache wiped");
  }

  /** Release lifecycle subscriptions when a test/app host disposes the service. */
  dispose(): void {
    this.unsubscribeVaultLock();
    this.unsubscribeVaultUnlock();
    this.vaultGeneration++;
    this.initializationFailedUntil = 0;
    this.intentStore.clear();
    this.voy?.clear();
    this.db?.close();
    this.db = null;
    this.dbOpen = null;
  }
}

export const semanticCache = new SemanticCacheService();
