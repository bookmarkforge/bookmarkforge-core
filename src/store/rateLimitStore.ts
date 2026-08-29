import { create } from "zustand";
import {
  persist,
  createJSONStorage,
  type StateStorage,
} from "zustand/middleware";
import { safeGet, safeSet, safeRemove } from "./safeStorage";
import { secureStorage } from "../services/SecureStorage";
import { logger } from "../utils/logger";

interface RateLimitState {
  unlockAttempts: number;
  lockoutUntil: number;
  incrementAttempt: () => void;
  resetAttempts: () => void;
  setLockout: (until: number) => void;
}

const STORAGE_KEY = "bookmarkforge-rate-limit";

/**
 * HMAC-sign the persisted rate-limit state to detect client-side tampering.
 * The HMAC key is ephemeral (per-session) and derived via Web Crypto,
 * never stored in localStorage — unlike the previous approach where the
 * key was co-located with the data it protected.
 *
 * On page reload, the key is regenerated. Any tampered state from the
 * previous session is silently dropped, and a fresh rate-limit counter
 * begins. This is acceptable: rate limiting is a server-side concern
 * for the server; the client-side store is defense-in-depth.
 */
let hmacKey: CryptoKey | null = null;

function isDeviceKeyUnavailable(error: unknown): boolean {
  const name =
    error instanceof Error
      ? error.name
      : (error as { name?: unknown } | null)?.name;
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === "DEVICE_KEY_WRAPPED" ||
    message.includes("Device key is wrapped") ||
    message.includes("unlock the vault first")
  );
}

async function getOrCreateHmacKey(): Promise<CryptoKey> {
  if (hmacKey) {return hmacKey;}
  try {
    let seedHex = await secureStorage.getSecret("rate_limit_hmac_seed");
    if (!seedHex) {
      const seed = new Uint8Array(32);
      crypto.getRandomValues(seed);
      seedHex = Array.from(seed, (b) => b.toString(16).padStart(2, "0")).join(
        "",
      );
      await secureStorage.setSecret("rate_limit_hmac_seed", seedHex);
    }
    const seedBytes = new Uint8Array(
      seedHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
    );
    hmacKey = await crypto.subtle.importKey(
      "raw",
      seedBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return hmacKey;
  } catch (error) {
    // The persist middleware hydrates before the vault is unlocked. A wrapped
    // device key is therefore an expected lifecycle state, not an integrity
    // failure; let getItem discard the unverifiable snapshot quietly.
    if (!isDeviceKeyUnavailable(error)) {
      logger.warn(
        "[RateLimitStore] Failed to create HMAC key, rate-limit integrity disabled",
        error,
      );
    }
    hmacKey = null;
    throw error;
  }
}

async function computeHmac(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await getOrCreateHmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(sig), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

const UNSIGNED_PREFIX = "u:";

/**
 * Serializes async persist writes. `setItem` awaits Web Crypto HMAC signing,
 * so two rapid increments can resolve out of order and leave a STALE state in
 * localStorage (write#1 lands after write#2). Under normal use increments are
 * spaced by user interaction, but burst calls (tests, rapid failed unlocks)
 * exposed the race: the persisted counter could regress. Chaining writes keeps
 * the last-write-wins ordering that the Zustand persist middleware assumes.
 */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * @internal Exported for unit tests: resolves when every queued persist write
 * has landed in localStorage. The rate-limit suite clears localStorage in
 * `beforeEach`; without draining first, an async HMAC write from the previous
 * test can still be in flight and land AFTER the clear, polluting the next
 * test's assertions with stale state (visible under coverage instrumentation).
 */
export const flushRateLimitWrites = (): Promise<void> => writeQueue;

/**
 * Detect whether the app is running in a production build.
 *
 * Vite statically replaces `import.meta.env.PROD` at build time, which makes
 * `vi.stubEnv` ineffective in Vitest. To keep the logic testable, we first
 * check `process.env.PROD` (controlled by `vi.stubEnv`/tests), and fall back
 * to `import.meta.env.PROD` for real Vite production builds.
 */
function isProduction(): boolean {
  // Some browser shells expose a partial `process` shim without `env`.
  // Read the nested object separately so that this guard never throws while
  // handling a rejected unlock or restoring persisted state.
  const runtimeEnv =
    typeof process !== "undefined" ? process.env : undefined;
  const runtimeProd = runtimeEnv ? runtimeEnv.PROD : undefined;
  if (runtimeProd !== undefined) {
    return runtimeProd === "true";
  }
  const viteEnv = (
    import.meta as ImportMeta & {
      env?: { PROD?: boolean | string };
    }
  ).env;
  const prod = viteEnv ? viteEnv.PROD : undefined;
  return typeof prod === "boolean" ? prod : prod === "true";
}

/** @internal Exported for unit testing the storage layer. */
export const rateLimitStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const raw = safeGet(name);
    if (!raw) {return null;}
    // Unsigned state is only accepted in development/test. In production it is
    // erased so that tampered lockout state cannot be reloaded.
    if (raw.startsWith(UNSIGNED_PREFIX)) {
      if (isProduction()) {
        safeRemove(name);
        return null;
      }
      return raw.slice(UNSIGNED_PREFIX.length);
    }
    const colonIdx = raw.lastIndexOf(":");
    if (colonIdx === -1) {
      safeRemove(name);
      return null;
    }
    const statePart = raw.slice(0, colonIdx);
    const sigPart = raw.slice(colonIdx + 1);
    try {
      const expectedSig = await computeHmac(statePart);
      if (sigPart !== expectedSig) {
        logger.warn("[RateLimitStore] Tampered state detected, resetting");
        safeRemove(name);
        return null;
      }
    } catch (error) {
      // Never hydrate unverified persisted state in production. When the vault
      // is still locked this is expected: the client-side counter is reset in
      // memory and the server remains the authoritative rate limiter.
      if (isDeviceKeyUnavailable(error) || isProduction()) {
        safeRemove(name);
        return null;
      }
      // Development/test keeps the historical best-effort fallback so local
      // tests and non-production diagnostics remain usable when Web Crypto is
      // unavailable, but production must fail closed above.
      return statePart;
    }
    return statePart;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    // The queued task rejects only in production (refusing unsigned state).
    // writeQueue itself must NEVER reject: a rejected chain would stall every
    // future write. The awaiting caller still sees the original rejection via
    // `task`, while the chain stays alive for the next setItem.
    const task = writeQueue.then(async () => {
      try {
        const sig = await computeHmac(value);
        safeSet(name, `${value}:${sig}`);
      } catch (error) {
        // In production, never persist unsigned rate-limit state. The caller
        // will fall back to in-memory defaults.
        if (isProduction()) {
          logger.warn(
            "[RateLimitStore] HMAC signing failed in production, refusing to persist unsigned state",
            error,
          );
          throw new Error("[RateLimitStore] Refusing to persist unsigned state");
        }
        logger.warn(
          "[RateLimitStore] HMAC signing failed, persisting unsigned state to preserve lockout",
        );
        safeSet(name, `${UNSIGNED_PREFIX}${value}`);
      }
    });
    writeQueue = task.catch(() => undefined);
    await task;
  },
  removeItem: (name: string): void => {
    safeRemove(name);
  },
};

export const useRateLimitStore = create<RateLimitState>()(
  persist(
    (set) => ({
      unlockAttempts: 0,
      lockoutUntil: 0,
      incrementAttempt: () =>
        set((state) => ({ unlockAttempts: state.unlockAttempts + 1 })),
      resetAttempts: () => set({ unlockAttempts: 0 }),
      setLockout: (until: number) =>
        set({ lockoutUntil: until, unlockAttempts: 0 }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => rateLimitStorage),
    },
  ),
);

export const getRateLimitState = () => useRateLimitStore.getState();
