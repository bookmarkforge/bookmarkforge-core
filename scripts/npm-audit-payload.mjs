/**
 * scripts/npm-audit-payload.mjs — single shared `npm audit --json` acquisition.
 *
 * The `npm run check` chain runs TWO CVE gates back to back that historically
 * each executed their own `npm audit --json` against the same tree
 * (check-override-cve.mjs and check-direct-cve.mjs, ~1.7 s each; measured
 * 2026-09-17). The payload they need is byte-identical: same profile
 * (`--omit=dev` unless `--include-dev`), same tree, seconds apart. This module
 * runs the audit once and hands the parsed payload to both.
 *
 * Cache design (fail-closed by construction):
 *   - Payload files live under node_modules/.cache/bookmarkforge-npm-audit/
 *     (ignored by git, wiped by a fresh `npm ci`), one per profile:
 *     `audit-prod.json` / `audit-dev.json`.
 *   - A cached payload is valid ONLY while package.json and package-lock.json
 *     have not changed since it was written (mtime+size fingerprints are
 *     stored inside the payload file) AND its age is under TTL_MS. An edit to
 *     either manifest, or staleness, forces a fresh `npm audit` run — the
 *     cache can never vouch for a tree it does not describe.
 *   - Every failure mode (npm produced no JSON, cache unreadable/corrupt,
 *     fingerprint mismatch, TTL expired) degrades to running the audit, and
 *     if THAT fails the error propagates exactly like before: each gate keeps
 *     its fail-closed contract ("audit unavailable" is not evidence of clean).
 *   - Explicit escape hatches: BMF_AUDIT_FRESH=1 always re-runs; the existing
 *     --audit-json <path> flag of both gates bypasses this module entirely.
 *
 * Exported for tests: getAuditPayload (with injectable now/spawn), clearCache.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const TAG = "[npm-audit-payload]";
const TTL_MS = 10 * 60 * 1000; // 10 minutes: plenty for one check-chain run.

const CACHE_DIR =
  process.env.BMF_AUDIT_CACHE_DIR ?? join(ROOT, "node_modules", ".cache", "bookmarkforge-npm-audit");

/** Fingerprint of the manifests the payload describes. */
function manifestFingerprint(root) {
  const parts = [];
  for (const name of ["package.json", "package-lock.json"]) {
    const path = join(root, name);
    if (!existsSync(path)) return null; // no manifests → nothing to vouch for
    const st = statSync(path);
    parts.push(`${name}:${st.mtimeMs}:${st.size}`);
  }
  return parts.join("|");
}

/**
 * Run `npm audit --json` for the requested profile (throws on failure).
 *
 * Use an argument array rather than a shell command string. On Windows the
 * executable is the npm.cmd shim, so resolving that explicitly avoids both
 * command injection risk and Node's DEP0190 shell warning. (Body moved here
 * verbatim from check-direct-cve.mjs so both gates share one implementation.)
 */
export function runNpmAudit({ includeDev = false, spawn = spawnSync, cwd = ROOT } = {}) {
  const useWindowsShim = process.platform === "win32";
  const executable = useWindowsShim ? process.execPath : "npm";
  const args = useWindowsShim
    ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), "audit", "--json"]
    : ["audit", "--json"];
  if (!includeDev) args.push("--omit=dev");
  const result = spawn(executable, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  if (!stdout.trim()) {
    throw new Error(
      `npm ${args.join(" ")} produced no JSON (exit ${result.status ?? "?"}) — ` +
        `${(result.stderr ?? "").trim().split("\n").slice(-3).join(" ").trim() || "is npm installed and is the network reachable?"}`,
    );
  }
  return JSON.parse(stdout);
}

/** Delete the cache directory (used by tests and by BMF_AUDIT_FRESH=1). */
export function clearCache({ dir = CACHE_DIR } = {}) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a cache we cannot delete is a cache we will not trust: it is also
       fingerprint-checked, so leaving it behind never yields a stale verdict */
  }
}

/**
 * Return the parsed `npm audit --json` payload for the profile, from cache
 * when it provably describes the current manifests, else by running the audit.
 *
 * @param {{ includeDev?: boolean, now?: number, spawn?: typeof spawnSync, cacheDir?: string, root?: string, log?: (msg: string) => void }} [options]
 */
export function getAuditPayload({ includeDev = false, now = Date.now(), spawn, cacheDir = CACHE_DIR, root = ROOT, log = console.log } = {}) {
  const fingerprint = manifestFingerprint(root);
  const path = join(cacheDir, includeDev ? "audit-dev.json" : "audit-prod.json");

  const fresh = process.env.BMF_AUDIT_FRESH === "1";
  if (!fresh && fingerprint) {
    try {
      if (existsSync(path)) {
        const cached = JSON.parse(readFileSync(path, "utf8"));
        const meta = cached?.__npm_audit_payload_meta;
        const payload = cached?.payload;
        const validShape =
          meta && payload && typeof payload.vulnerabilities === "object" && payload.vulnerabilities !== null;
        if (
          validShape &&
          meta.fingerprint === fingerprint &&
          typeof meta.cachedAt === "number" &&
          now - meta.cachedAt <= TTL_MS
        ) {
          log(`${TAG} cache hit (${includeDev ? "dev" : "prod"}, ${path})`);
          return payload;
        }
        if (validShape) {
          log(`${TAG} cache stale (manifests changed or TTL elapsed) — re-running npm audit`);
        }
      }
    } catch {
      log(`${TAG} cache unreadable — re-running npm audit`);
    }
  }

  const payload = runNpmAudit({ includeDev, spawn, cwd: root });
  if (fingerprint) {
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(
        path,
        `${JSON.stringify({ __npm_audit_payload_meta: { fingerprint, cachedAt: now }, payload }, null, 2)}\n`,
      );
    } catch (error) {
      // The audit itself succeeded; failing to persist the cache must not
      // fail the gate. The next run simply pays for its own audit.
      log(`${TAG} note: cache write failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return payload;
}
