/**
 * FNV-1a 32-bit hash (hex), shared by the AI services for non-cryptographic
 * local cache keys.
 *
 * This is deliberately NOT cryptographic — it only needs to be deterministic
 * and cheap for keys like `kind:lang:hash(text)`. Do not use it for secrets,
 * integrity, or anything where collisions matter; use `hashString` from
 * `crypto-core` (SHA-256) for those.
 *
 * Output is byte-for-byte identical to the previous per-service copies, so
 * existing cache keys and persisted ids (e.g. flashcard `fc_…` ids) remain
 * stable across this refactor.
 */
export function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Dual FNV-style digest for in-memory AI cache keys that must not retain the
 * original prompt/content. Two independent 32-bit accumulators (FNV-1a plus a
 * position-mixed companion) plus the input length keep accidental collisions
 * very unlikely for bounded session caches.
 *
 * Output is byte-for-byte identical to the previous per-service copies
 * (AgentService, AIRequestCache, WebSearchService, RAGEngine), so existing
 * session cache keys are unaffected.
 */
export function hashCacheKey(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${value.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}
