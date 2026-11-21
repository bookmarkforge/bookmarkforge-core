/**
 * Mock for @huggingface/transformers used by vitest resolve alias.
 *
 * The real package's exports map uses "node" and "default" conditions
 * without a bare "import" entry, which causes Vite's import-analysis
 * plugin to fail at build time in the test environment.
 *
 * This mock provides the minimal shape expected by RAGEngine.ts
 * and SemanticCacheService.ts.
 */
export const pipeline = () => Promise.resolve(() => null);
export const env = { allowLocalModels: true, useBrowserCache: true };
// NOTE: the real module has NO default export (verified at runtime) —
// production code must read `env`/`pipeline` as named exports only.
