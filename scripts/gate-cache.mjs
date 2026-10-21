/**
 * scripts/gate-cache.mjs — fingerprint-validated verdict cache for the
 * deterministic quality gates.
 *
 * Two gates in the `npm run check` chain re-scan the whole source tree on
 * every run even though their verdict is a pure function of the tree:
 * `check-english-only` (~1.9 s) and `check-pro-imports` (~1.8 s; both
 * measured 2026-09-17, cold). This module caches a PASS verdict keyed by a
 * full fingerprint of every file the gate could possibly read — relative
 * path, mtime and size — so a hit proves the tree is unchanged in every byte
 * the gate depends on. Cold and warm runs return the SAME verdict by
 * construction: a hit requires byte-level equality of the scanned surface.
 *
 * Design rules (fail-safe by construction):
 *   - Only PASS verdicts are cached. A cached FAIL would be a denial of the
 *     gate's own output on an unchanged tree; a FAIL re-runs every time and
 *     a tree that changed invalidates the cache anyway.
 *   - The fingerprint is stored INSIDE the cache file and must match exactly
 *     (same paths, mtimes, sizes). No TTL: these gates are deterministic, so
 *     fingerprint equality IS the truth. (npm-audit-payload keeps its TTL
 *     because npm audit consults the registry — a different trust model.)
 *   - The cache can only make a gate PASS, never fail it: any I/O error, any
 *     invalidation, any doubt re-runs the gate. Read failures, write
 *     failures and corrupt files degrade to a fresh run, never to an error.
 *   - A cached entry names the gate and a CACHE_VERSION constant; bumping
 *     the version (e.g. after changing a gate's scan logic) drops all
 *     entries. Gates must bump CACHE_VERSION when their computation changes.
 *   - `BMF_GATE_CACHE_OFF=1` bypasses the cache entirely (parity with the
 *     BMF_AUDIT_FRESH escape hatch of npm-audit-payload).
 *
 * Testability: treeFingerprint and getCachedVerdict take injectable
 * accessors (stat walker, now, logger), so
 * scripts/__tests__/gate-cache.test.mjs drives everything from memory.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TAG = "[gate-cache]";
export const CACHE_VERSION = 1;

const CACHE_DIR =
  process.env.BMF_GATE_CACHE_DIR ?? join(process.cwd(), "node_modules", ".cache", "bookmarkforge-gate-cache");

/**
 * Fingerprint of a file tree. Two modes:
 *
 * - `hash: true` (the security-correct mode): every file's relative path and
 *   SHA-256 of its CONTENT. Fingerprint equality ⇔ byte-level content
 *   equality of the whole scanned surface — immune to the mtime-tick hazard
 *   where a same-length edit inside one mtime granularity step is invisible
 *   to mtime+size fingerprints (this repo ships crypto; the gate cache gets
 *   the same standard). Costs one read per file (~hundreds of ms over src/),
 *   still far below the seconds the gates spend scanning.
 * - `hash: false`: relative path, mtimeMs and size — cheaper, but a
 *   same-length edit within one mtime tick can be missed. Only acceptable
 *   where the caller accepts ESLint-cache-grade guarantees.
 *
 * Deterministic (sorted by path) and complete — the gate's verdict is a
 * function of exactly this data.
 *
 * @param {{ root: string, extensions?: RegExp | Set<string>, skipDirs?: Set<string>, include?: (relPath: string) => boolean, hash?: boolean, stat?: (p: string) => object }} options
 */
export function treeFingerprint({ root, extensions = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, skipDirs = new Set(["node_modules", ".git", "dist", "coverage"]), include, hash = false, stat = statSync }) {
  const parts = [];
  const walk = (dir, relBase) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (skipDirs.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      // `extensions` accepts a RegExp (tested against the file name) or a
      // Set of EXTENSIONS (".ts"-style, tested against the extracted
      // extension — pro-boundary's SCAN_EXTENSIONS shape).
      if (extensions) {
        const matches =
          typeof extensions.test === "function"
            ? extensions.test(entry.name)
            : extensions.has(entry.name.slice(entry.name.lastIndexOf(".")));
        if (!matches) continue;
      }
      if (include && !include(rel)) continue;
      if (hash) {
        const digest = createHash("sha256").update(readFileSync(abs)).digest("hex");
        parts.push({ path: rel, sha256: digest });
      } else {
        parts.push({ path: rel, mtimeMs: stat(abs).mtimeMs, size: stat(abs).size });
      }
    }
  };
  walk(root, "");
  parts.sort((a, b) => (a.path < b.path ? -1 : 1));
  return JSON.stringify(parts);
}

/**
 * Read a cached PASS verdict for `gateName` when the stored fingerprint
 * matches `fingerprint` exactly. Returns undefined on any mismatch, TTL-less
 * staleness, corruption or I/O error — the caller then just runs the gate.
 *
 * @param {{ gateName: string, fingerprint: string, cacheDir?: string, now?: number, log?: (msg: string) => void }} options
 * @returns {string | undefined} the cached verdict ("pass")
 */
export function getCachedVerdict({ gateName, fingerprint, cacheDir = CACHE_DIR, log = () => {} } = {}) {
  if (process.env.BMF_GATE_CACHE_OFF === "1") return undefined;
  if (!fingerprint) return undefined;
  const path = join(cacheDir, `${gateName}.json`);
  try {
    if (!existsSync(path)) return undefined;
    const entry = JSON.parse(readFileSync(path, "utf8"));
    if (
      entry?.version === CACHE_VERSION &&
      entry?.gate === gateName &&
      entry?.fingerprint === fingerprint &&
      entry?.verdict === "pass"
    ) {
      log(`${TAG} cache hit (${gateName})`);
      return "pass";
    }
    log(`${TAG} cache miss (${gateName})`);
    return undefined;
  } catch {
    log(`${TAG} cache unreadable (${gateName}) — running the gate`);
    return undefined;
  }
}

/**
 * Persist a PASS verdict. Best-effort: a write failure is logged, never
 * thrown — the gate already computed its own result.
 *
 * @param {{ gateName: string, fingerprint: string, cacheDir?: string, log?: (msg: string) => void }} options
 */
export function putCachedVerdict({ gateName, fingerprint, cacheDir = CACHE_DIR, log = () => {} } = {}) {
  if (!fingerprint) return;
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, `${gateName}.json`),
      `${JSON.stringify({ version: CACHE_VERSION, gate: gateName, fingerprint, verdict: "pass" }, null, 2)}\n`,
    );
  } catch (error) {
    log(`${TAG} note: cache write failed (${error instanceof Error ? error.message : String(error)})`);
  }
}

/** Delete the cache directory (tests; BMF_GATE_CACHE_OFF users). */
export function clearGateCache({ dir = CACHE_DIR } = {}) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a cache we cannot delete is a cache we will not trust */
  }
}
