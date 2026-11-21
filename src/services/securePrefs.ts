/**
 * src/services/securePrefs.ts
 *
 * Async accessor for user-content preferences that must not sit in
 * localStorage (PLAN-N6-N7-storage-hardening, Fase 1).
 *
 * Backing store: `secureStorage` (IndexedDB, AES-GCM under the per-device
 * key — NOT the master-password vault, so no unlock is required). IDs are
 * namespaced `bmf_pref_<storageKey>` to avoid colliding with vault secrets.
 *
 * Read path is lazy-migrating: the first `securePrefGet` for a key whose
 * value still lives in localStorage re-encrypts it into IndexedDB and
 * removes the plaintext copy. `migrateAllSecurePrefs()` performs the same
 * sweep eagerly at startup (AppInitializer) so no plaintext window remains
 * for users who never open the affected feature.
 *
 * IMPORTANT — sync callers: `safeGet`/`safeSet` are synchronous and cannot
 * read this store. Any call site that needs the value during first paint
 * must either (a) hydrate async post-mount and re-render, or (b) keep a
 * non-sensitive localStorage shadow. Do NOT add new synchronous readers of
 * the keys in SECURE_PREF_STORAGE_KEYS.
 */
import { secureStorage } from "./SecureStorage";
import { safeGet, safeRemove, safeSet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { logger } from "../utils/logger";

const SECURE_PREF_PREFIX = "bmf_pref_";

/**
 * localStorage keys (STORAGE_KEYS values) cleared from plaintext storage.
 * Batch 1 = [secret]/[personal] keys whose consumers can tolerate async
 * reads. Extend per Fase 2 batches — never add [low] keys here.
 */
export const SECURE_PREF_STORAGE_KEYS = [
  STORAGE_KEYS.CUSTOM_PROMPTS,
  STORAGE_KEYS.CUSTOM_PROMPTS_SUMMARIZE,
  STORAGE_KEYS.CUSTOM_PROMPTS_TAGGING,
  STORAGE_KEYS.CUSTOM_PROMPTS_CHAT,
  STORAGE_KEYS.PENDING_AI_QUERY,
  STORAGE_KEYS.BMF_SUPPORT_HISTORY,
  // Gamification / AI-derived behavioral analytics (PLAN-N6-N7 Fase 2 lote 3).
  // These are inferences over private vault content — SecurityVault.
  // purgeAiDerivedCaches also deletes their bmf_pref_* records on lock.
  STORAGE_KEYS.BOOKMARKFORGE_PERSONALITY,
  STORAGE_KEYS.BOOKMARKFORGE_BLINDSPOTS,
  STORAGE_KEYS.BOOKMARKFORGE_RECENT_TOPICS,
  STORAGE_KEYS.BOOKMARKFORGE_READER_MOOD,
  STORAGE_KEYS.BOOKMARKFORGE_PUBLISHED_SITES,
  STORAGE_KEYS.BOOKMARKFORGE_FENGSHUI_APPLIED,
  STORAGE_KEYS.BOOKMARKFORGE_FENGSHUI_SUGGESTIONS,
  STORAGE_KEYS.BOOKMARKFORGE_LONGEST_STREAK,
  STORAGE_KEYS.BOOKMARKFORGE_CURRENT_STREAK,
] as const;

const secureId = (storageKey: string): string =>
  `${SECURE_PREF_PREFIX}${storageKey}`;

/**
 * Read a preference. Returns the decrypted value, or null when unset.
 * Lazily migrates a legacy localStorage copy on first access.
 *
 * Failure policy: if SecureStorage is unavailable (e.g. IDB blocked), falls
 * back to the plaintext localStorage copy so the feature keeps working;
 * the migration simply retries on the next call.
 */
export async function securePrefGet(storageKey: string): Promise<string | null> {
  try {
    const value = await secureStorage.getSecret(secureId(storageKey));
    if (value !== null) {return value;}
  } catch (error) {
    logger.warn("[securePrefs] SecureStorage read failed; using localStorage fallback", {
      key: storageKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return safeGet(storageKey);
  }

  const legacy = safeGet(storageKey);
  if (legacy !== null) {
    try {
      await secureStorage.setSecret(secureId(storageKey), legacy);
      safeRemove(storageKey);
    } catch (error) {
      logger.warn("[securePrefs] Legacy migration write failed; will retry", {
        key: storageKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return legacy;
}

/**
 * Write a preference to SecureStorage and scrub any plaintext copy left in
 * localStorage. On SecureStorage failure, falls back to localStorage so the
 * write is not lost (availability over secrecy for preferences).
 */
export async function securePrefSet(
  storageKey: string,
  value: string,
): Promise<void> {
  try {
    await secureStorage.setSecret(secureId(storageKey), value);
    safeRemove(storageKey);
    return;
  } catch (error) {
    logger.warn("[securePrefs] SecureStorage write failed; using localStorage fallback", {
      key: storageKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  safeSet(storageKey, value);
}

/** Delete a preference from both stores. */
export async function securePrefRemove(storageKey: string): Promise<void> {
  try {
    await secureStorage.deleteSecret(secureId(storageKey));
  } catch (error) {
    logger.warn("[securePrefs] SecureStorage delete failed", {
      key: storageKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  safeRemove(storageKey);
}

/**
 * Eager sweep: move every registered key's legacy localStorage copy into
 * SecureStorage. Idempotent — `migrateFromLocalStorage` no-ops when the
 * IndexedDB record already exists or localStorage is empty.
 */
export async function migrateAllSecurePrefs(): Promise<void> {
  for (const storageKey of SECURE_PREF_STORAGE_KEYS) {
    try {
      await secureStorage.migrateFromLocalStorage(
        storageKey,
        secureId(storageKey),
      );
    } catch (error) {
      logger.warn("[securePrefs] Migration failed for key", {
        key: storageKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
