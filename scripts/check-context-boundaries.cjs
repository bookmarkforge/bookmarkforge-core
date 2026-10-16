#!/usr/bin/env node
/**
 * scripts/check-context-boundaries.cjs — architectural layer gate.
 *
 * Enforces import boundaries between the app's main layers so the
 * dependency graph stays acyclic and UI / workers / memory stay isolated:
 *
 *   - UI components (src/components) must never import workers, the
 *     memory subsystem, or the db layer directly (they go through
 *     services, hooks, zustand stores, or — for bootstrap — the DI
 *     container's database gate, src/container/database.ts).
 *   - Workers (src/workers) must never import components or memory.
 *   - The memory subsystem (src/memory) must never import components or
 *     workers.
 *   - Hooks (src/hooks) must never import components (the dependency runs
 *     the other way).
 *
 * Type-only imports (`import type { X } from "…"` / `export type { … } from
 * "…"`) are exempt from every rule: TypeScript erases them at compile time,
 * so they can never create a runtime edge between layers. RxDB collection
 * types (BookmarkDocType, BookmarkForgeDB, …) are intentionally consumed
 * across layers — enforcing them would be pure noise with zero coupling
 * benefit.
 *
 * components -> db background: the db layer was historically importable
 * from the UI without a gate, which let bootstrap calls (initDB/destroyDB)
 * spread across ~25 components. They now import from
 * src/container/database.ts (a leaf re-export, so the app-containing
 * bundle is unchanged) and the allowlist is expected to stay EMPTY — any
 * new components -> db runtime edge must be refactored, not allowlisted.
 *
 * Existing violations are documented in scripts/context-boundaries.allowlist.json;
 * NEW violations fail CI. Workers are allowed to share pure logic with
 * src/services (e.g. voy.worker.ts imports QuantizationService) — those are
 * leaf utilities, not cross-layer coupling.
 *
 * Usage:
 *   node scripts/check-context-boundaries.cjs          # CI gate (exit 1 on new violations)
 *   node scripts/check-context-boundaries.cjs --write-allowlist  # regenerate allowlist
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const ALLOWLIST_FILE = path.join(__dirname, "context-boundaries.allowlist.json");
const WRITE_ALLOWLIST = process.argv.includes("--write-allowlist");

// ── Layer map & rules ────────────────────────────────────────────────
const LAYERS = {
  components: "src/components",
  workers: "src/workers",
  memory: "src/memory",
  db: "src/db",
  services: "src/services",
  store: "src/store",
  hooks: "src/hooks",
  utils: "src/utils",
};

const RULES = [
  { from: "components", to: "workers", label: "UI must not import workers directly; use services/hooks (e.g. WorkerPool)." },
  { from: "components", to: "memory", label: "UI must not import the memory subsystem directly; use useMemoryStore / AgentService." },
  { from: "components", to: "db", label: "UI must not import the db layer directly; bootstrap through src/container/database.ts and query through services." },
  { from: "workers", to: "components", label: "Workers must not depend on UI components." },
  { from: "workers", to: "memory", label: "Workers must not depend on the memory subsystem." },
  { from: "memory", to: "components", label: "The memory subsystem must not depend on UI components." },
  { from: "memory", to: "workers", label: "The memory subsystem must not depend on workers." },
  { from: "hooks", to: "components", label: "Hooks must not import components; the dependency runs components -> hooks." },
];

function layerOf(relPath) {
  const norm = relPath.split(path.sep).join("/");
  for (const [key, dir] of Object.entries(LAYERS)) {
    if (norm.startsWith(dir + "/")) return key;
  }
  return null;
}

// ── Scan ─────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      // Skip test trees and node_modules-style dirs entirely.
      if (entry === "__tests__" || entry === "tests") continue;
      walk(p, out);
    } else if (/\.(ts|tsx|mts)$/.test(entry) && !/\.(test|spec)\./.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

// Anchored to statement boundaries and word-boundaries so string literals
// containing `from "..."` (docs, fixtures) don't produce false positives.
// String stripping is intentionally NOT applied: import specifiers live
// inside quotes, so stripping them would hide real imports.
const IMPORT_RE =
  /\b(import[^'"]*\bfrom\s+|export[^'"]*\bfrom\s+|import\s*\(\s*)[`'"]([^`'"]+)[`'"]/g;

function parseImports(source) {
  const cleaned = source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments
  const out = [];
  let m;
  while ((m = IMPORT_RE.exec(cleaned)) !== null) {
    const prefix = m[1] ?? "";
    const specifier = m[2] ?? "";
    // Type-only imports / re-exports are erased by TypeScript and can never
    // create a runtime edge between layers; they are exempt from every rule.
    if (/^(?:import|export)\s+type\b/.test(prefix)) {
      continue;
    }
    out.push(specifier);
  }
  return out;
}

/**
 * Normalize for allowlist matching: forward slashes, relative, keep the
 * source extension on files (import specifiers never carry one, so the
 * resolved target side is naturally extension-free).
 */
function normModule(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function scan() {
  const violations = []; // { file, target, rule }
  for (const file of walk(SRC_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    const fromKey = layerOf(normModule(file));
    if (!fromKey) continue;
    const dirOf = path.dirname(file);
    for (const spec of parseImports(source)) {
      if (!spec.startsWith(".")) continue;
      const resolved = path.resolve(dirOf, spec);
      const toKey = layerOf(normModule(resolved));
      if (!toKey) continue;
      for (const rule of RULES) {
        if (rule.from === fromKey && rule.to === toKey) {
          violations.push({
            file: normModule(file),
            target: normModule(resolved),
            rule,
          });
        }
      }
    }
  }
  return violations;
}

// ── Allowlist ────────────────────────────────────────────────────────
function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return new Map();
  return new Map(Object.entries(JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8"))));
}

// ── Main ─────────────────────────────────────────────────────────────
if (require.main === module) {
  if (WRITE_ALLOWLIST) {
    const seen = new Set();
    const next = {};
    for (const v of scan()) {
      const key = `${v.file} -> ${v.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next[key] = `allowlisted ${v.rule.from} -> ${v.rule.to} violation (${v.rule.label})`;
    }
    fs.writeFileSync(ALLOWLIST_FILE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `[check-context-boundaries] allowlist written: ${Object.keys(next).length} entries -> ${ALLOWLIST_FILE}`,
    );
    process.exit(0);
  }

  const allowlist = readAllowlist();
  const violations = [];
  const seen = new Set();
  for (const v of scan()) {
    const key = `${v.file} -> ${v.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (allowlist.has(key)) continue;
    violations.push({ key, rule: v.rule });
  }

  const stale = [...allowlist.keys()].filter((k) => !seen.has(k)).sort();

  if (violations.length > 0) {
    console.error(
      "[check-context-boundaries] NEW cross-layer violations (add to scripts/context-boundaries.allowlist.json only after refactoring the layer):",
    );
    for (const v of violations) {
      console.error(`  ${v.key}  [${v.rule.from} -> ${v.rule.to}] ${v.rule.label}`);
    }
  }
  if (stale.length > 0) {
    console.warn(`[check-context-boundaries] stale allowlist entries (no longer violated): ${stale.join(", ")}`);
  }
  const totalViolations = scan().length;
  console.log(
    `[check-context-boundaries] ${totalViolations} cross-layer imports, ${allowlist.size} allowlisted, ${violations.length} new violations`,
  );
  process.exit(violations.length > 0 ? 1 : 0);
} else {
  module.exports = { RULES, LAYERS, scan, readAllowlist, ALLOWLIST_FILE };
}
