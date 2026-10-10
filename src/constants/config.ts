/**
 * Configuration Constants
 * Centralized magic numbers and configuration values for better maintainability
 */

import { env } from "../env.config";

// Database Configuration
//
// The init timeout is ADAPTIVE: createDBInstance adds a per-row migration
// budget (MIGRATION_PER_ROW_BUDGET_MS × rows already in the vault, counted
// cheaply via IndexedDB before opening the RxDB instance) on top of the
// base INITIAL_TIMEOUT_MS. This exists because the F-06 authenticated
// v6→v7 rewrite costs ~8-21ms/row on a mid-range machine (benchmarked via
// tests/e2e/migrate-benchmark.spec.ts: 10k rows ≈ 211s), far above any
// fixed budget — a small fixed timeout made every vault over ~2k rows
// fall back to Memory storage and present an EMPTY vault.
export const DB_CONFIG = {
  // Base budget for an empty or small vault (no migration pending).
  INITIAL_TIMEOUT_MS: 10000,
  // Hard cap: even a 100k-row vault gets 10s + 100000×40ms ≈ 67min; the
  // cap keeps a pathological/corrupt store from blocking forever.
  MAX_TIMEOUT_MS: 900000,
  // Per-row migration budget (ms). 2-5× headroom over the observed
  // 8-21ms/row so a healthy migration never trips the timeout.
  MIGRATION_PER_ROW_BUDGET_MS: 40,
  MAX_RETRIES: 3,
  RETRY_DELAY_BASE_MS: 1000,
  PBKDF2_ITERATIONS: 600000,
  DB_NAME: "bookmarkforge_v5",
  SECURE_DB_NAME: "bookmarkforge_secure_vault",
  SECURE_STORE_NAME: "secrets",
} as const;

export const SECURITY_CONFIG = {
  SESSION_TOKEN_TTL_MS: 30 * 60 * 1000, // 30 minutes
  SESSION_ROTATION_INTERVAL_MS: 15 * 60 * 1000, // 15 minutes
  KEY_ROTATION_INTERVAL_DAYS: 90,
  ENCRYPTION_KEY_VERSION: 4, // Argon2id (V4)
  MIN_PASSWORD_LENGTH: 12,
  BATTERY_CRITICAL_THRESHOLD: 0.15, // 15%
  MAX_TAB_INSTANCES: 3,
} as const;

// AI Configuration — centralized model names to avoid hardcoding across the codebase
export const AI_MODELS = {
  GEMINI_DEFAULT: "gemini-2.0-flash",
  GEMINI_EXP: "gemini-2.0-flash-exp",
  GEMINI_PREVIEW: "gemini-2.0-flash-preview",
  GEMINI_3_FLASH_PREVIEW: "gemini-3-flash-preview",
  OLLAMA_DEFAULT: "llama3.2",
  WEBLLM_DEFAULT: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  WEBLLM_LOW_RAM: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
  WEBLLM_MED_RAM: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  WEBLLM_HIGH_RAM: "Phi-3.5-mini-instruct-q4f16_1-MLC",
  ANTHROPIC_DEFAULT: "claude-3-5-sonnet-latest",
  ANTHROPIC_HAIKU: "claude-3-5-haiku-latest",
  ANTHROPIC_OPUS: "claude-3-opus-latest",
  GROQ_DEFAULT: "llama-3.3-70b-versatile",
  OPENAI_DEFAULT: "gpt-4o-mini",
} as const;

export const AI_CONFIG = {
  REQUEST_TIMEOUT_MS: 30000,
  MAX_RETRIES: 3,
  INITIAL_RETRY_DELAY_MS: 1000,
  REQUEST_CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
  REQUEST_CACHE_MAX_SIZE: 200,
  WEBLLM_TIMEOUT_MS: 15000,
  OLLAMA_CACHE_TTL_MS: 60 * 1000, // 1 minute
  OLLAMA_CHECK_TIMEOUT_MS: 3000,
  PROMPT_MAX_LENGTH: 100000,
  SYSTEM_PROMPT_MAX_LENGTH: 50000,
  GEMINI_CONTENT_MAX_LENGTH: 8000,
  WEBLLM_CHUNK_SIZE: 20,
  WEBLLM_CHUNK_DELAY_MS: 30,
} as const;

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Sync Configuration
export const SYNC_CONFIG = {
  DEDUPE_WINDOW_MS: 5000,
  DEDUPE_MAX_SIZE: 1000,
  HEALTH_CHECK_INTERVAL_MS: 30000,
  RECONNECT_MAX_DELAY_MS: 60000,
  RECONNECT_BASE_DELAY_MS: 2000,
} as const;

// AutoProcessor Configuration
export const AUTOPROCESSOR_CONFIG = {
  DEBOUNCE_MS: 500,
  CONCURRENCY_LIMIT: 2,
  BATTERY_CRITICAL_THRESHOLD: 0.15, // 15%
  CHUNK_CONCURRENCY_LIMIT: 3,
  CHUNK_SIZE: 1000,
  CHUNK_OVERLAP: 200,
} as const;

// Environment Variable Validation
interface EnvValidationResult {
  isValid: boolean;
  missing: string[];
  warnings: string[];
  errors: string[];
}

export function validateEnvVars(): EnvValidationResult {
  const result: EnvValidationResult = {
    isValid: true,
    missing: [],
    warnings: [],
    errors: [],
  };

  // Test-only bypasses must never be shipped in a production bundle.
  if (env.isProd) {
    if (env.disableNetworkFirewall) {
      result.errors.push(
        "[BUILD FATAL] VITE_DISABLE_NETWORK_FIREWALL cannot be enabled in production.",
      );
    }
    if (env.forceMemoryStorage) {
      result.errors.push(
        "[BUILD FATAL] VITE_FORCE_MEMORY_STORAGE cannot be enabled in production; it would disable persistence.",
      );
    }
    if (env.testBuild) {
      result.errors.push(
        "[BUILD FATAL] VITE_TEST_BUILD cannot be enabled in production; it disables security-audit noise gates.",
      );
    }
  }

  // Development warnings
  if (env.isDev) {
    if (!env.devMode) {
      result.warnings.push(
        "Running in dev mode without explicit VITE_DEV_MODE flag",
      );
    }
  }

  result.isValid = result.errors.length === 0 && result.missing.length === 0;
  return result;
}

/**
 * Throws if any production-time validation rule fails.
 * Call from build pipeline (vite plugin) or main.tsx top-level.
 */
export function assertValidForBuild(): void {
  const result = validateEnvVars();
  if (result.errors.length > 0) {
    const message = result.errors.join("\n");
    throw new Error(message);
  }
}

// Runtime environment check — routed through env.config.ts so the
// schema is documented in one place and the registry owns the Vite-
// prefix invariants.
export function getEnvironmentInfo(): Record<string, string | boolean> {
  return {
    isDev: env.isDev,
    isProd: env.isProd,
    mode: env.mode ?? "unknown",
    baseUrl: env.baseUrl ?? "/",
  };
}
