/**
 * Safe localStorage helpers — silently handle quota exceeded,
 * private browsing restrictions, or missing storage.
 *
 * **Sync by design.** These helpers are intentionally synchronous because they
 * wrap `localStorage`, which is a synchronous API. All call sites (React state
 * initializers, Zustand persist adapters, service constructors) rely on this to
 * avoid async waterfall regressions. If the underlying storage ever needs to
 * change (e.g., wrapping IndexedDB or cloud sync), every call site would need
 * updating — this is the deliberate trade-off for simplicity and perf.
 */
import { type StateStorage } from "zustand/middleware";
import { logRateLimited } from "../utils/boundedLog";
import { logger } from "../utils/logger";

export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (_err) {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    logger.warn(`[safeStorage] Failed to set key "${key}"`, { error });
  }
}

export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    logger.warn(`[safeStorage] Failed to remove key "${key}"`, { error });
  }
}

export function safeClear(): void {
  try {
    localStorage.clear();
  } catch (error) {
    logger.warn(`[safeStorage] Failed to clear localStorage`, { error });
  }
}

export function safeSessionClear(): void {
  try {
    sessionStorage.clear();
  } catch (error) {
    logger.warn(`[safeStorage] Failed to clear sessionStorage`, { error });
  }
}

/**
 * Default read serializer — infers parsing from the default value's type.
 */
function defaultRead<T>(raw: string | null, defaultValue: T): T {
  if (raw === null) return defaultValue;
  if (typeof defaultValue === "boolean") return (raw === "true") as T;
  if (typeof defaultValue === "number") {
    const n = Number(raw);
    return (isNaN(n) ? defaultValue : n) as T;
  }
  return raw as T;
}

/**
 * Default write serializer — infers formatting from the value's type.
 */
function defaultWrite<T>(value: T): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Creates a Zustand StateStorage adapter that maps individual state fields to
 * individual localStorage keys (legacy key pattern).
 *
 * @param keyMap   - Maps each persisted state key to its localStorage key.
 * @param defaults - Default values for every key in `keyMap`.
 * @param serializers - Optional per-key read/write serializers.
 */
export function createStorageAdapter<T extends Record<string, unknown>>(
  keyMap: Record<keyof T, string>,
  defaults: T,
  serializers?: {
    read?: Partial<{ [K in keyof T]: (raw: string | null, defaultValue: T[K]) => T[K] }>;
    write?: Partial<{ [K in keyof T]: (value: T[K]) => string }>;
  },
): StateStorage {
  return {
    getItem: (_name: string): string | null => {
      const state: Record<string, unknown> = {};
      for (const k of Object.keys(keyMap) as Array<keyof T>) {
        const raw = safeGet(keyMap[k]);
        const custom = serializers?.read?.[k];
        state[k as string] = custom
          ? custom(raw, defaults[k])
          : defaultRead(raw, defaults[k]);
      }
      return JSON.stringify({ state, version: 0 });
    },
    setItem: (_name: string, value: string): void => {
      try {
        const parsed = JSON.parse(value) as { state: Partial<T> };
        const s = parsed.state;
        for (const k of Object.keys(keyMap) as Array<keyof T>) {
          if (s[k] !== undefined) {
            const custom = serializers?.write?.[k];
            safeSet(keyMap[k], custom ? custom(s[k]!) : defaultWrite(s[k]!));
          }
        }
      } catch (error) {
        // A malformed persisted slice is discarded deliberately, but the
        // failure is observable without allowing corrupted state to crash
        // every store write.
        logRateLimited(
          "warn",
          "safe-storage-malformed-state",
          "Discarded malformed persisted state",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    },
    removeItem: (_name: string): void => {
      for (const storageKey of Object.values(keyMap)) {
        safeRemove(storageKey);
      }
    },
  };
}

/**
 * Creates a simple Zustand StateStorage adapter that passes through to
 * safeGet/safeSet/safeRemove, optionally scoped to a single storage key.
 *
 * @param storageKey - If provided, all reads/writes use this key (ignoring the
 *                     `name` that persist passes). If omitted, the persist name
 *                     is used as the localStorage key.
 */
/**
 * Creates a Zustand StateStorage adapter that signs stored values on write
 * and verifies signatures on read. The caller provides the sign/verify
 * callbacks (e.g. for HMAC, JWT, or any other signing scheme).
 *
 * The `sign` callback receives the raw value and must return a signed string.
 * The `verify` callback receives the stored string, verifies it, and returns
 * the original value on success, or `null` if the value is invalid/tampered.
 * If `verify` returns `null`, `getItem` returns `null` (the persist middleware
 * will fall back to the default state).
 *
 * @example
 * ```ts
 * const storage = createSignedStorageAdapter(
 *   async (value) => `${value}:${await hmac(value)}`,
 *   async (stored) => {
 *     const idx = stored.lastIndexOf(":");
 *     if (idx === -1) return null;
 *     if ((await hmac(stored.slice(0, idx))) !== stored.slice(idx + 1)) return null;
 *     return stored.slice(0, idx);
 *   },
 * );
 * ```
 */
export function createSignedStorageAdapter(
  sign: (value: string) => Promise<string>,
  verify: (stored: string) => Promise<string | null>,
): StateStorage {
  return {
    getItem: async (name: string): Promise<string | null> => {
      const raw = safeGet(name);
      if (!raw) return null;
      return verify(raw);
    },
    setItem: async (name: string, value: string): Promise<void> => {
      const signed = await sign(value);
      safeSet(name, signed);
    },
    removeItem: (name: string): void => {
      safeRemove(name);
    },
  };
}

export function createSafeStorageAdapter(storageKey?: string): StateStorage {
  if (storageKey) {
    return {
      getItem: () => safeGet(storageKey),
      setItem: (_name, value) => safeSet(storageKey, value),
      removeItem: () => safeRemove(storageKey),
    };
  }
  return {
    getItem: (name) => safeGet(name),
    setItem: (name, value) => safeSet(name, value),
    removeItem: (name) => safeRemove(name),
  };
}
