/**
 * Dynamic import with caching, retry and timeout.
 *
 * The app already uses native React.lazy/Suspense for route components and
 * Vite's own chunking; this module only exists because MLC-WebLLM needs a
 * manual import with retry/timeout for a ~20 MB wasm-heavy module.
 */

import { logger } from "./logger";

interface ImportOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

interface LoadedModule {
  module: unknown;
  loadTime: number;
}

// Module cache
const moduleCache = new Map<string, Promise<LoadedModule>>();

/**
 * Import a module with caching, retry and timeout.
 */
export async function dynamicImport<T>(
  importer: () => Promise<T>,
  moduleId: string,
  options: ImportOptions = {},
): Promise<T> {
  const { timeout = 10000, retries = 2, retryDelay = 1000 } = options;

  // Check cache
  if (moduleCache.has(moduleId)) {
    const cached = await moduleCache.get(moduleId)!;
    return cached.module as T;
  }

  // Create loading promise
  const loadPromise = loadWithRetry(
    importer,
    moduleId,
    retries,
    retryDelay,
    timeout,
  );
  moduleCache.set(moduleId, loadPromise);

  try {
    const result = await loadPromise;
    return result.module as T;
  } catch (error) {
    moduleCache.delete(moduleId);
    throw error;
  }
}

/**
 * Load module with retry logic
 */
async function loadWithRetry<T>(
  importer: () => Promise<T>,
  moduleId: string,
  retries: number,
  retryDelay: number,
  timeout: number,
): Promise<LoadedModule> {
  const startTime = performance.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Import timeout: ${moduleId}`)),
          timeout,
        );
      });

      // Race between import and timeout
      const module = await Promise.race([importer(), timeoutPromise]);

      const loadTime = performance.now() - startTime;

      logger.info(
        `[DynamicImport] Loaded ${moduleId} in ${loadTime.toFixed(2)}ms`,
      );

      return {
        module,
        loadTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < retries) {
        logger.warn(
          `[DynamicImport] Retry ${attempt + 1}/${retries} for ${moduleId}:`,
          lastError.message,
        );
        await delay(retryDelay * (attempt + 1)); // Exponential backoff
      }
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  throw lastError || new Error(`Failed to load ${moduleId}`);
}

/**
 * Utility delay function
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
