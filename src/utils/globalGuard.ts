/**
 * Global Guard — Production crisis containment
 *
 * Fail-safe wrappers for fetch and async ops. Every rejection is contained,
 * sanitized via logger and reported locally via errorReporter (no remote sink).
 * Never lets an unhandled promise kill the tab.
 */

import { logger } from "./logger";
import { errorReporter } from "../telemetry/errorReporter";

/**
 * Fetch wrapper that never leaks secrets and always reports.
 * Use for any non-firewalled fetch where you want auto-reporting.
 */
export async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(input as RequestInfo, init);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${String(input).slice(0, 120)}`);
    }
    return res;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    try {
      void errorReporter.reportError(err, { source: "safeFetch", url: String(input).slice(0, 200) });
    } catch { /* INTENTIONAL SILENCE: reporting is best-effort; the original error must still reach the caller. */ }
    logger.error("[GlobalGuard] safeFetch failed", { url: String(input).slice(0, 200), error: err.message });
    throw err;
  }
}

/**
 * Wraps any async function so its rejection is always contained and reported.
 */
export function guardAsync<T extends (...args: unknown[]) => Promise<unknown>>(fn: T, context: string): T {
  return (async (...args: unknown[]) => {
    try {
      return await fn(...args);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      try {
        void errorReporter.reportError(err, { source: context });
      } catch { /* INTENTIONAL SILENCE: reporting is best-effort; the original promise rejection must still propagate. */ }
      logger.error(`[GlobalGuard] ${context} failed`, { error: err.message });
      throw err;
    }
  }) as unknown as T;
}

export function isQuotaError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "QuotaExceededError") ||
    (typeof e === "object" && e !== null && (e as { name?: string }).name === "QuotaExceededError")
  );
}

export function isResizeObserverNoise(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return msg.includes("ResizeObserver") || msg.includes("loop limit exceeded");
}
