#!/usr/bin/env node
/**
 * check-sensitive-localstorage.mjs — PLAN-N6-N7-storage-hardening, Fase 3.
 *
 * Static gate: fails if a key that was migrated OUT of plaintext browser
 * storage is read/written through localStorage/sessionStorage/safeGet/
 * safeSet/safeRemove outside the documented allowlist.
 *
 * The forbidden set below is the migrated [secret]/[personal] surface:
 * custom prompts, pending AI query, support history, provider endpoint
 * URLs, and the gamification/AI-derived analytics batch. If you migrate a
 * new key to securePrefs, ADD its literal here — that is the point of the
 * gate (prevent regression).
 *
 * Allowlist rationale:
 *  - safeStorage.ts / securePrefs.ts: the storage primitives themselves.
 *  - SecurityVault.ts / NuclearForgetService.ts: must be able to purge
 *    every store, including SecureStorage and legacy plaintext.
 *  - ProviderConfiguration.ts / SettingsService.ts: legacy cleanup paths
 *    that only REMOVE the migrated localStorage keys.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_DIR = "src";
const STORAGE_KEYS_FILE = join(SRC_DIR, "constants", "storage-keys.ts");

/** localStorage literals that must never be persisted again. */
const FORBIDDEN_LITERALS = new Set([
  // Custom prompts (user-authored prompt text)
  "custom_prompts",
  "custom_prompts_summarize",
  "custom_prompts_tagging",
  "custom_prompts_chat",
  // Transient user query handoff
  "pending_ai_query",
  // Support chat history
  "bmf_support_history",
  // Provider endpoint URLs (SecureStorage bmf_provider_* is canonical)
  "ollama_url",
  "custom_ai_base_url",
  // Gamification / AI-derived analytics (bmf_pref_* in SecureStorage)
  "bookmarkforge_personality",
  "bookmarkforge_blindspots",
  "bookmarkforge_recent_topics",
  "bookmarkforge_reader_mood",
  "bookmarkforge_published_sites",
  "bookmarkforge_fengshui_applied",
  "bookmarkforge_fengshui",
  "bookmarkforge_longest_streak",
  "bookmarkforge_current_streak",
]);

/** Files permitted to touch the forbidden keys (cleanup/migration only). */
const ALLOWLIST = new Set([
  join(SRC_DIR, "store", "safeStorage.ts"),
  join(SRC_DIR, "services", "securePrefs.ts"),
  join(SRC_DIR, "services", "SecurityVault.ts"),
  join(SRC_DIR, "services", "NuclearForgetService.ts"),
  join(SRC_DIR, "services", "ai", "ProviderConfiguration.ts"),
  join(SRC_DIR, "services", "SettingsService.ts"),
  join(SRC_DIR, "constants", "storage-keys.ts"),
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) {continue;}
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

function isTestFile(path) {
  return (
    /\.(test|spec)\.(ts|tsx)$/.test(path) ||
    path.includes(`${join("src", "tests")}`) ||
    path.includes("__tests__")
  );
}

/** Parse STORAGE_KEYS member -> literal value from storage-keys.ts. */
function loadStorageKeys() {
  const map = new Map();
  const src = readFileSync(STORAGE_KEYS_FILE, "utf8");
  for (const m of src.matchAll(/(\w+):\s*"([^"]+)"/g)) {
    map.set(m[1], m[2]);
  }
  return map;
}

const STORAGE_KEYS = loadStorageKeys();

// Matches persistence calls whose first argument is a string literal or a
// STORAGE_KEYS member reference.
const CALL_RE =
  /(?:safeGet|safeSet|safeRemove|localStorage\.(?:get|set|remove)Item|sessionStorage\.(?:get|set|remove)Item)\s*\(\s*(?:"([^"]+)"|STORAGE_KEYS\.(\w+))/g;

const violations = [];

for (const file of walk(SRC_DIR)) {
  const rel = relative(process.cwd(), file).replaceAll("\\", "/");
  const normalized = join(SRC_DIR, ...rel.split("/").slice(1));
  if (ALLOWLIST.has(normalized) || isTestFile(rel)) {continue;}

  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(CALL_RE)) {
    const literal = m[1];
    const member = m[2];
    const resolved = literal ?? (member ? STORAGE_KEYS.get(member) : undefined);
    if (resolved && FORBIDDEN_LITERALS.has(resolved)) {
      const line = src.slice(0, m.index).split("\n").length;
      violations.push(`${rel}:${line} persists forbidden key "${resolved}"`);
    }
  }
  // The SecureStorage namespace is owned by securePrefs — nobody else may
  // write bmf_pref_* records directly.
  if (/"bmf_pref_|`bmf_pref_/.test(src) && !ALLOWLIST.has(normalized)) {
    const lines = src.split("\n");
    lines.forEach((text, i) => {
      if (/"bmf_pref_|`bmf_pref_/.test(text)) {
        violations.push(
          `${rel}:${i + 1} references bmf_pref_ outside securePrefs`,
        );
      }
    });
  }
}

if (violations.length > 0) {
  console.error(
    "[check-sensitive-localstorage] FAIL — migrated keys found in plaintext storage:",
  );
  for (const v of violations) {console.error(`  ${v}`);}
  console.error(
    "\nUse securePrefGet/securePrefSet (src/services/securePrefs.ts) for these keys,",
  );
  console.error("or extend the allowlist in scripts/check-sensitive-localstorage.mjs.");
  process.exit(1);
}

console.log(
  `[check-sensitive-localstorage] OK — ${FORBIDDEN_LITERALS.size} migrated keys clean`,
);
