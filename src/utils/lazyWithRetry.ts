/**
 * lazyWithRetry — drop-in replacement for React.lazy that survives transient
 * chunk-load failures (offline flaps, dev-server restarts, SW update races).
 *
 * React.lazy caches the factory result forever: a single rejected dynamic
 * import (e.g. "Failed to fetch dynamically imported module" while offline)
 * permanently breaks that component until a full reload. This wrapper retries
 * the factory: while the browser reports itself offline it waits for the
 * `online` event without consuming retries, and once online it retries with
 * exponential backoff up to MAX_RETRIES before giving up.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { logger } from "./logger";

const MAX_RETRIES = 6;
const BASE_DELAY_MS = 1_000;
const ONLINE_WAIT_TIMEOUT_MS = 15_000;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|importing a module script failed|dynamically imported module|chunkloaderror|loading chunk \d+ failed|error loading module/i.test(
    message,
  );
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function waitForOnline(): Promise<void> {
  if (!isOffline()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("online", done);
      resolve();
    };
    window.addEventListener("online", done);
    // Safety net: if the online event never fires (some emulations), retry anyway.
    setTimeout(done, ONLINE_WAIT_TIMEOUT_MS);
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors React.lazy's own signature; a stricter props type breaks inference for every caller.
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    let onlineFailures = 0;
    for (;;) {
      try {
        return await factory();
      } catch (error) {
        if (!isChunkLoadError(error)) {
          throw error;
        }
        if (isOffline()) {
          // Offline flaps are free: park until connectivity returns instead of
          // burning retries on guaranteed-to-fail fetches.
          logger.warn("[lazyWithRetry] chunk load failed while offline, waiting for online", {
            error: error instanceof Error ? error.message : String(error),
          });
          await waitForOnline();
          continue;
        }
        onlineFailures += 1;
        if (onlineFailures > MAX_RETRIES) {
          throw error;
        }
        logger.warn("[lazyWithRetry] chunk load failed, retrying", {
          attempt: onlineFailures,
          error: error instanceof Error ? error.message : String(error),
        });
        await delay(BASE_DELAY_MS * 2 ** (onlineFailures - 1));
      }
    }
  });
}
