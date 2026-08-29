/**
 * Request Deduplication Utility
 * Prevents duplicate simultaneous network requests
 *
 * Usage:
 * const deduper = new RequestDeduper();
 * const result = await deduper.dedupe('api/users', () => fetch('/api/users'));
 */

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
  /** Identifies this request generation when a key is reused after expiry. */
  id: symbol;
}

export class RequestDeduper {
  private pendingRequests = new Map<string, PendingRequest<unknown>>();
  private completedResults = new Map<
    string,
    { result: unknown; timestamp: number }
  >();
  private readonly dedupeWindow: number; // ms
  private readonly cacheWindow: number; // ms
  private readonly maxCompletedEntries: number;

  constructor(
    dedupeWindow: number = 5000,
    cacheWindow: number = 100,
    maxCompletedEntries: number = 1000,
  ) {
    this.dedupeWindow = dedupeWindow;
    this.cacheWindow = cacheWindow;
    this.maxCompletedEntries = maxCompletedEntries;
  }

  /**
   * Deduplicates a request. If the same key is already in flight,
   * returns the existing promise. Otherwise executes the factory function.
   */
  async dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const now = Date.now();

    // Expired completed results should not remain resident until the size
    // limit is reached. Prune them lazily so this utility does not need a
    // process-wide timer just to manage a short-lived cache.
    for (const [completedKey, completed] of this.completedResults) {
      if (now - completed.timestamp >= this.cacheWindow) {
        this.completedResults.delete(completedKey);
      }
    }

    // Check for cached recent result
    const cached = this.completedResults.get(key);
    if (cached) {
      return cached.result as T;
    }

    // Check for in-flight request. A request may still be running after its
    // dedupe window expires; starting a new generation is intentional, but
    // its eventual completion must not delete or overwrite that newer entry.
    const pending = this.pendingRequests.get(key);
    if (pending && now - pending.timestamp < this.dedupeWindow) {
      return pending.promise as Promise<T>;
    }

    const requestId = Symbol(key);
    let factoryPromise: Promise<T>;
    try {
      factoryPromise = Promise.resolve(factory());
    } catch (error) {
      factoryPromise = Promise.reject(error);
    }

    const promise = factoryPromise.then(
      (result) => {
        const current = this.pendingRequests.get(key);
        if (current?.id === requestId) {
          // Cache successful results only for the active request generation.
          // An older request completing late must not resurrect stale data.
          if (this.maxCompletedEntries > 0) {
            if (this.completedResults.size >= this.maxCompletedEntries) {
              const oldestKey = this.completedResults.keys().next().value;
              if (oldestKey !== undefined) {
                this.completedResults.delete(oldestKey);
              }
            }
            this.completedResults.set(key, {
              result,
              timestamp: Date.now(),
            });
          }
          // Always release the in-flight slot, including when result caching
          // is disabled with maxCompletedEntries=0.
          this.pendingRequests.delete(key);
        }
        return result;
      },
      (error: unknown) => {
        // Do not remove a newer request that reused the same key.
        if (this.pendingRequests.get(key)?.id === requestId) {
          this.pendingRequests.delete(key);
        }
        throw error;
      },
    );

    this.pendingRequests.set(key, {
      promise: promise as Promise<unknown>,
      timestamp: now,
      id: requestId,
    });

    return promise;
  }

  /**
   * Clear all pending and cached requests
   */
  clear(): void {
    this.pendingRequests.clear();
    this.completedResults.clear();
  }
}

// Global instance for app-wide deduplication
export const globalRequestDeduper = new RequestDeduper();
