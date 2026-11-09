/**
 * src/modules/translation/cache/translationCache.ts
 *
 * Encrypted (source, translation) pair cache — Core (MIT).
 *
 * Why SecureStorage and not a new RxDB collection:
 *   The vault runs 12 RxDB collections and RxDB 17's OSS open-collection cap is
 *   13. Spending the last slot on a derived cache — data that can always be
 *   regenerated — would block the next real collection. SecureStorage already
 *   gives us exactly the required properties:
 *     - IndexedDB, per document bundle;
 *     - AES-GCM at rest with the device key (AGENTS.md §2 S9 separation);
 *     - fail-closed when the vault is locked (the device key is wrapped), so a
 *       later XSS cannot read the cache either.
 *
 * Layout:
 *   bmf_translation_cache_v1:<key>   -> one document bundle (JSON, encrypted)
 *   bmf_translation_cache_index_v1   -> LRU index (key, doc, updatedAt, pairs)
 *
 * The cache is an OPTIMIZATION: every failure path logs and degrades to a
 * cache miss. It never blocks or fails a translation.
 */

import { logger } from "../../../utils/logger";
import { secureStorage } from "../../../services/SecureStorage";
import { hashString } from "../../../utils/crypto-core";
import {
  TRANSLATION_CACHE_FLUSH_DEBOUNCE_MS,
  TRANSLATION_CACHE_MAX_DOCUMENTS,
  TRANSLATION_CACHE_MAX_PAIRS_PER_DOCUMENT,
  TRANSLATION_CACHE_VERSION,
} from "../constants";
import type { TranslationPair } from "../types";

const INDEX_KEY = "bmf_translation_cache_index_v1";
const BUNDLE_PREFIX = "bmf_translation_cache_v1:";

export interface TranslationCacheContext {
  documentId: string;
  sourceLocale: string;
  targetLocale: string;
  /** Engine family (webllm|ollama|nllb|cloud) — see engineFamily(). */
  engineFamily: string;
  /** Prompt pack version: a prompt change invalidates translations. */
  promptVersion: string;
}

interface CachedDocument {
  version: number;
  documentId: string;
  sourceLocale: string;
  targetLocale: string;
  engineFamily: string;
  promptVersion: string;
  updatedAt: string;
  pairs: TranslationPair[];
}

interface CacheIndexEntry {
  key: string;
  documentId: string;
  targetLocale: string;
  updatedAt: string;
  pairCount: number;
}

interface CacheIndex {
  version: number;
  documents: CacheIndexEntry[];
}

function cacheKeyFor(context: TranslationCacheContext): Promise<string> {
  return hashString(
    [
      context.documentId,
      context.sourceLocale,
      context.targetLocale,
      context.engineFamily,
      context.promptVersion,
    ].join("|"),
  ).then((hash) => hash.slice(0, 40));
}

function isPair(value: unknown): value is TranslationPair {
  const pair = value as Partial<TranslationPair> | null;
  return Boolean(
    pair &&
      typeof pair.index === "number" &&
      typeof pair.hash === "string" &&
      typeof pair.sourceText === "string" &&
      typeof pair.translatedText === "string",
  );
}

class TranslationCache {
  private memory = new Map<string, Map<string, TranslationPair>>();
  private pendingFlush = new Map<string, ReturnType<typeof setTimeout>>();
  private index: CacheIndex | null = null;
  private indexLoading: Promise<CacheIndex> | null = null;
  // Per-key epoch: invalidate() bumps it so an already-running writeBundle
  // cannot resurrect a bundle the user just dropped. The persisted index is
  // LRU-capped, but this in-memory map had no bound — cap it the same way.
  private generations = new Map<string, number>();
  private static readonly MAX_MEMORY_KEYS =
    TRANSLATION_CACHE_MAX_DOCUMENTS * 4;

  /** Insert/refresh a memory entry, evicting the oldest key past the cap. */
  private setMemory(key: string, byHash: Map<string, TranslationPair>): void {
    // Refresh recency: delete+set moves the key to the newest position.
    this.memory.delete(key);
    this.memory.set(key, byHash);
    while (this.memory.size > TranslationCache.MAX_MEMORY_KEYS) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) {break;}
      this.memory.delete(oldest);
    }
  }

  /**
   * Load the cached pairs of one document for a hash-keyed lookup.
   * Returns an empty map on any failure (cache miss), never throws.
   */
  async load(context: TranslationCacheContext): Promise<Map<string, TranslationPair>> {
    const key = await cacheKeyFor(context);
    const cached = this.memory.get(key);
    if (cached) {
      this.setMemory(key, cached);
      return cached;
    }

    const byHash = new Map<string, TranslationPair>();
    try {
      const raw = await secureStorage.getSecret(BUNDLE_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CachedDocument>;
        if (
          parsed.version === TRANSLATION_CACHE_VERSION &&
          parsed.promptVersion === context.promptVersion &&
          Array.isArray(parsed.pairs)
        ) {
          for (const pair of parsed.pairs) {
            if (isPair(pair)) {byHash.set(pair.hash, pair);}
          }
        }
      }
    } catch (error) {
      // Corrupt bundle or locked vault: a cache miss is the correct outcome.
      // Do not delete here — the next flush overwrites it.
      logger.warn("[translation] cache read failed; treating as a miss", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.setMemory(key, byHash);
    return byHash;
  }

  /** Cached pair for a chunk hash, or null. Never returns a mismatched source. */
  async get(
    context: TranslationCacheContext,
    hash: string,
    sourceText: string,
  ): Promise<TranslationPair | null> {
    const byHash = await this.load(context);
    const pair = byHash.get(hash);
    if (!pair) {return null;}
    // Defence against a hash collision or a mutated chunk: the plaintext must
    // match byte-for-byte, otherwise the cached translation is wrong content.
    if (pair.sourceText !== sourceText) {
      byHash.delete(hash);
      return null;
    }
    return pair;
  }

  /** Store/refresh one pair in memory and schedule an encrypted flush. */
  async put(context: TranslationCacheContext, pair: TranslationPair): Promise<void> {
    const key = await cacheKeyFor(context);
    if (!this.memory.has(key)) {
      await this.load(context);
    }
    let byHash = this.memory.get(key) ?? new Map<string, TranslationPair>();
    byHash.set(pair.hash, pair);

    if (byHash.size > TRANSLATION_CACHE_MAX_PAIRS_PER_DOCUMENT) {
      // Bound memory and the at-rest bundle: keep the newest pairs by index.
      const sorted = [...byHash.values()].sort((a, b) => a.index - b.index);
      byHash = new Map(
        sorted.slice(0, TRANSLATION_CACHE_MAX_PAIRS_PER_DOCUMENT).map((entry) => [
          entry.hash,
          entry,
        ]),
      );
      this.setMemory(key, byHash);
    }

    this.scheduleFlush(key, context, byHash);
  }

  private scheduleFlush(
    key: string,
    context: TranslationCacheContext,
    byHash: Map<string, TranslationPair>,
  ): void {
    const existing = this.pendingFlush.get(key);
    if (existing) {clearTimeout(existing);}
    const timer = setTimeout(() => {
      this.pendingFlush.delete(key);
      void this.writeBundle(key, context, byHash);
    }, TRANSLATION_CACHE_FLUSH_DEBOUNCE_MS);
    this.pendingFlush.set(key, timer);
  }

  private async writeBundle(
    key: string,
    context: TranslationCacheContext,
    byHash: Map<string, TranslationPair>,
  ): Promise<void> {
    // Captured before the first await: an invalidate() that lands while this
    // write is in flight must not let the stale bundle/index entry back in.
    const generation = this.generations.get(key) ?? 0;
    const isStale = () => (this.generations.get(key) ?? 0) !== generation;
    const bundle: CachedDocument = {
      version: TRANSLATION_CACHE_VERSION,
      documentId: context.documentId,
      sourceLocale: context.sourceLocale,
      targetLocale: context.targetLocale,
      engineFamily: context.engineFamily,
      promptVersion: context.promptVersion,
      updatedAt: new Date().toISOString(),
      pairs: [...byHash.values()].sort((a, b) => a.index - b.index),
    };

    try {
      if (isStale()) {return;}
      await secureStorage.setSecret(BUNDLE_PREFIX + key, JSON.stringify(bundle));
      if (isStale()) {return;}
      await this.touchIndex(key, context, bundle.pairs.length);
    } catch (error) {
      logger.warn("[translation] cache write failed; keeping it in memory only", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async loadIndex(): Promise<CacheIndex> {
    if (this.index) {return this.index;}
    if (this.indexLoading) {return this.indexLoading;}
    this.indexLoading = (async () => {
      try {
        const raw = await secureStorage.getSecret(INDEX_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as CacheIndex;
          if (parsed.version === TRANSLATION_CACHE_VERSION && Array.isArray(parsed.documents)) {
            return parsed;
          }
        }
      } catch (error) {
        logger.warn("[translation] cache index unreadable; rebuilding", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { version: TRANSLATION_CACHE_VERSION, documents: [] };
    })();
    this.index = await this.indexLoading;
    this.indexLoading = null;
    return this.index;
  }

  private async touchIndex(
    key: string,
    context: TranslationCacheContext,
    pairCount: number,
  ): Promise<void> {
    const index = await this.loadIndex();
    const now = new Date().toISOString();
    const entry: CacheIndexEntry = {
      key,
      documentId: context.documentId,
      targetLocale: context.targetLocale,
      updatedAt: now,
      pairCount,
    };
    const others = index.documents.filter((doc) => doc.key !== key);
    const documents = [entry, ...others]
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, TRANSLATION_CACHE_MAX_DOCUMENTS);

    // Best-effort eviction of bundles that fell out of the LRU window: the
    // index is the only enumeration surface (SecureStorage has no key scan).
    const keep = new Set(documents.map((doc) => doc.key));
    const evicted = others.filter((doc) => !keep.has(doc.key));
    for (const doc of evicted) {
      try {
        await secureStorage.deleteSecret(BUNDLE_PREFIX + doc.key);
      } catch (error) {
        logger.warn("[translation] cache eviction failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    index.documents = documents;
    await secureStorage.setSecret(INDEX_KEY, JSON.stringify(index));
  }

  /** Force pending writes now (call at the end of a pipeline run). */
  async flush(context: TranslationCacheContext): Promise<void> {
    const key = await cacheKeyFor(context);
    const timer = this.pendingFlush.get(key);
    if (timer) {
      clearTimeout(timer);
      this.pendingFlush.delete(key);
    }
    const byHash = this.memory.get(key);
    if (byHash) {await this.writeBundle(key, context, byHash);}
  }

  /** Drop one document's cached pairs (source edited beyond repair). */
  async invalidate(context: TranslationCacheContext): Promise<void> {
    const key = await cacheKeyFor(context);
    this.memory.delete(key);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    const timer = this.pendingFlush.get(key);
    if (timer) {
      clearTimeout(timer);
      this.pendingFlush.delete(key);
    }
    try {
      await secureStorage.deleteSecret(BUNDLE_PREFIX + key);
      const index = await this.loadIndex();
      index.documents = index.documents.filter((doc) => doc.key !== key);
      await secureStorage.setSecret(INDEX_KEY, JSON.stringify(index));
    } catch (error) {
      logger.warn("[translation] cache invalidation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Test hook / vault lock: drop in-memory state and pending timers. */
  reset(): void {
    for (const timer of this.pendingFlush.values()) {clearTimeout(timer);}
    this.pendingFlush.clear();
    this.memory.clear();
    this.index = null;
    this.indexLoading = null;
    this.generations.clear();
  }
}

export const translationCache = new TranslationCache();
