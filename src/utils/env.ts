// src/utils/env.ts
//
// Migration target: this file used to expose `getEnvVar` / `isProdBuild`
// / `isTestMode` that read directly from `import.meta.env` and
// `process.env`. Those helpers now redirect to the central registry in
// `src/env.config.ts` so:
//   * The schema lives in one place — `ENV_REGISTRY` — and is the
//     single source of truth for env-var names, parsers, and defaults.
//   * Boot-time validation runs once, eagerly, at module import.
//   * The static checker (`scripts/check-env-config.mjs`) can audit all
//     remaining direct reads across `src/` against the registry.
//
// `getEnvVar(name)` remains for callers that need to look up an env var
// by dynamic key (e.g. feature-flag gating, runtime config injection).
// For all STATIC env reads, prefer `env.X` from `./env.config` directly
// — this wrapper exists only for backward compatibility with consumers
// that already use the old API.

import { env } from "../env.config";

/**
 * Dynamic-key escape hatch. Reads from the same source priority as the
 * registry (import.meta.env → process.env fallback) so behavior matches
 * the typed accessors for known keys.
 */
export function getEnvVar(name: string): string | undefined {
  // Vite-transform compatibility: do NOT cast `import.meta` to a
  // different shape. Vite's AST walker depends on the literal
  // identifier `import.meta.env` to inject the VITE_* dictionary.
  const meta = typeof import.meta !== "undefined" ? (import.meta as { env?: Record<string, string | undefined> }).env : undefined;
  if (meta && name in meta) return meta[name];
  if (typeof process !== "undefined" && process.env && name in process.env) {
    return process.env[name];
  }
  return undefined;
}

export function isProdBuild(): boolean {
  return env.isProd;
}

export function isTestMode(): boolean {
  return env.mode === "test";
}
