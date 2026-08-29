/**
 * Bounded logging — rate-limited warn/error emission for error paths that
 * repeat frequently.
 *
 * Use this instead of a bare `catch {}` (or a raw logger.warn) where the
 * failure is a swallowed, non-fatal condition that can fire in a tight loop
 * (corrupt caches, per-bookmark parsing, clipboard unavailability, AI output
 * that fails to parse). The first occurrence is logged with full detail;
 * repeats within the window are counted and reported the next time the log
 * actually emits, so operators see the suppressed volume without log spam.
 *
 * Implemented as its own module (not an export of logger.ts) so test files
 * that `vi.mock("../../utils/logger", ...)` with a hand-rolled stub keep
 * working: those mocks would not include a logger.ts export, and a missing
 * function would crash the very catch block this helper is meant to fix.
 */
import { logger } from "./logger";

type BoundedLogLevel = "warn" | "error";

/** Distinct keys tracked before the stalest entry is evicted. */
const MAX_KEYS = 64;
/** Re-emission window per key (rolling). */
const WINDOW_MS = 60_000;

interface RateLimitedEntry {
  lastEmit: number;
  /** Attempts suppressed since the last emission. */
  suppressed: number;
}

const state = new Map<string, RateLimitedEntry>();

function evictStalest(): void {
  let oldestKey: string | undefined;
  let oldestEmit = Infinity;
  for (const [key, entry] of state) {
    if (entry.lastEmit < oldestEmit) {
      oldestEmit = entry.lastEmit;
      oldestKey = key;
    }
  }
  if (oldestKey !== undefined) {
    state.delete(oldestKey);
  }
}

/**
 * Emits `message` through the logger at most once per key per WINDOW_MS.
 * Subsequent calls with the same key within the window are counted and
 * reported as `(N suppressed since last log)` on the next emission.
 *
 * @param level - "warn" for non-fatal degradations, "error" for failures
 *   that should reach the error sink.
 * @param key - Stable identifier for the failure site (e.g. the component
 *   and condition), never interpolated user data — it becomes the log
 *   prefix and the rate-limit identity.
 * @param message - Static description; pass dynamic details via `data`
 *   (the logger redacts secrets in both).
 */
export function logRateLimited(
  level: BoundedLogLevel,
  key: string,
  message: string,
  ...data: unknown[]
): void {
  const now = Date.now();
  const existing = state.get(key);

  if (existing && now - existing.lastEmit < WINDOW_MS) {
    existing.suppressed += 1;
    return;
  }

  if (state.size >= MAX_KEYS) {
    evictStalest();
  }
  const suppressed = existing?.suppressed ?? 0;
  state.set(key, { lastEmit: now, suppressed: 0 });

  const suffix =
    suppressed > 0
      ? ` (${suppressed} occurrence(s) suppressed since last log)`
      : "";
  const emit = (level === "error" ? logger.error : logger.warn).bind(logger);
  emit(`[${key}] ${message}${suffix}`, ...data);
}

/** Clears all rate-limit windows (used by tests and by design on lock). */
export function resetRateLimitedLogging(): void {
  state.clear();
}
