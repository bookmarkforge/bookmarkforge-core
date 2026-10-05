/**
 * scripts/check-rxdb17.mjs — RxDB 17 migration gate.
 *
 * The project is migrating from rxdb 16.x + rxdb-hooks@6 to rxdb 17.x with
 * the official rxdb/plugins/react bindings (see docs/rxdb17-migration.md).
 * This gate keeps the migration honest and, once it lands, prevents silent
 * regressions back to the old stack:
 *
 *   1. `rxdb` must resolve to a 17.x major in package.json, in
 *      package-lock.json, and in the installed node_modules copy when
 *      present (a stale local install is as bad as a stale manifest).
 *   2. `rxdb-hooks` must not appear anywhere in the tree (package.json,
 *      package-lock.json, src, tests, configs) — the dependency must be
 *      removed in the SAME commit as the last call-site (R9 atomicity rule
 *      from the migration plan).
 *
 * docs/ is deliberately excluded: docs/rxdb17-migration.md documents the
 * migration FROM rxdb-hooks and legitimately mentions the name.
 *
 * The check logic is a pure function (`runRxdb17Checks`) so unit tests can
 * exercise it with in-memory fixtures; the CLI wrapper below only performs
 * the file I/O (reading package.json / lockfile / installed copy / tree)
 * and prints the result.
 *
 * Exit code is non-zero when any invariant is violated. Run via
 * `npm run check:rxdb17`; the aggregate `npm run check` and the CI
 * quality-gates job run it too.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PKG = join(ROOT, "package.json");
const LOCK = join(ROOT, "package-lock.json");
const INSTALLED_RXDB = join(ROOT, "node_modules", "rxdb", "package.json");

// Directories whose rxdb-hooks references are irrelevant (build output,
// reports, VCS metadata) or intentional (docs/ = the migration document).
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-extension",
  "docs",
  ".git",
  ".github",
  "coverage",
  "test-results",
  "playwright-report",
  "playwright-report-human-like",
  "playwright-report-nightly",
]);

const SCAN_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".htm",
]);

// ── Pure check logic (unit-testable with in-memory fixtures) ─────────

/** Major version of a semver spec ("^17.4.0", "~17.4.0", "17.x", ">=17 <18"). */
export function majorOf(spec) {
  if (typeof spec !== "string") return null;
  const m = spec.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function majorLabel(spec) {
  const major = majorOf(spec);
  return major === null ? "?" : String(major);
}

/**
 * Run all invariants against in-memory fixtures.
 *
 * @param {object} inputs
 * @param {string|null} inputs.pkgSpec        rxdb spec from package.json (null = undeclared)
 * @param {string|null} inputs.lockVersion    rxdb version from package-lock.json (null = no lock)
 * @param {string|null} inputs.installedVersion rxdb version from node_modules (null = not installed)
 * @param {Map<string,string>} inputs.treeFiles  rel-path → content, scanned for rxdb-hooks
 * @returns {{ ok: boolean, oks: string[], failures: string[] }}
 */
export function runRxdb17Checks({ pkgSpec, lockVersion, installedVersion, treeFiles }) {
  const failures = [];
  const oks = [];
  const fail = (msg) => failures.push(msg);
  const ok = (msg) => oks.push(msg);

  // Invariant 1 — rxdb must be 17.x everywhere it is pinned.
  if (pkgSpec === null || pkgSpec === undefined) {
    fail("rxdb not declared in package.json dependencies");
  } else if (majorOf(pkgSpec) !== 17) {
    fail(
      `rxdb in package.json is "${pkgSpec}" (major ${majorLabel(pkgSpec)}) — ` +
        "must be 17.x (see docs/rxdb17-migration.md)",
    );
  } else {
    ok(`package.json rxdb "${pkgSpec}" is 17.x`);
  }

  if (lockVersion === null || lockVersion === undefined) {
    ok("package-lock.json absent — skipped (fresh install in progress?)");
  } else if (majorOf(lockVersion) !== 17) {
    fail(
      `package-lock.json resolves rxdb to ${lockVersion} (major ${majorLabel(lockVersion)}) — ` +
        "run `npm install rxdb@^17.4.0` to regenerate the lockfile",
    );
  } else {
    ok(`package-lock.json rxdb ${lockVersion} is 17.x`);
  }

  if (installedVersion === null || installedVersion === undefined) {
    ok("node_modules/rxdb absent — skipped");
  } else if (majorOf(installedVersion) !== 17) {
    fail(
      `node_modules/rxdb is ${installedVersion} (major ${majorLabel(installedVersion)}) — ` +
        "stale install; run `npm install` (or npm ci) to pick up 17.x",
    );
  } else {
    ok(`node_modules/rxdb ${installedVersion} is 17.x`);
  }

  // Invariant 2 — rxdb-hooks must be gone from the whole tree.
  const offenders = [];
  for (const [rel, content] of treeFiles) {
    if (content.includes("rxdb-hooks")) {
      offenders.push(rel);
    }
  }
  if (offenders.length > 0) {
    fail(
      `rxdb-hooks still referenced in the tree (${offenders.length} file(s)): ` +
        `${offenders.slice(0, 8).join(", ")}${offenders.length > 8 ? ", …" : ""} — ` +
        "remove the dependency and migrate all call-sites to rxdb/plugins/react " +
        "in the same commit (R9)",
    );
  } else {
    ok("no rxdb-hooks references in the tree");
  }

  return { ok: failures.length === 0, oks, failures };
}

// ── CLI wrapper (file I/O + output) ──────────────────────────────────

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else {
      yield join(dir, entry.name);
    }
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  // Invariant 1 inputs.
  const pkgSpec = existsSync(PKG)
    ? (() => {
        const pkg = JSON.parse(readFileSync(PKG, "utf8"));
        return (
          pkg.dependencies?.rxdb ??
          pkg.devDependencies?.rxdb ??
          pkg.peerDependencies?.rxdb ??
          null
        );
      })()
    : null;
  const lockVersion = existsSync(LOCK)
    ? (JSON.parse(readFileSync(LOCK, "utf8")).packages?.["node_modules/rxdb"]
        ?.version ?? null)
    : null;
  const installedVersion = existsSync(INSTALLED_RXDB)
    ? (JSON.parse(readFileSync(INSTALLED_RXDB, "utf8")).version ?? null)
    : null;

  // Invariant 2 inputs — walk the tree once, skipping excluded dirs/exts
  // and the files that must legitimately mention the name to search for it
  // (this script and its own unit test, whose fixtures exercise the detector).
  const treeFiles = new Map();
  const MAY_MENTION = new Set([
    "scripts/check-rxdb17.mjs",
    "src/tests/scripts/check-rxdb17.test.ts",
  ]);
  for (const abs of walk(ROOT)) {
    const rel = abs.slice(ROOT.length + 1).replaceAll("\\", "/");
    if (MAY_MENTION.has(rel)) continue;
    const ext = rel.slice(rel.lastIndexOf("."));
    if (!SCAN_EXTS.has(ext)) continue;
    let content;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    treeFiles.set(rel, content);
  }

  const result = runRxdb17Checks({
    pkgSpec,
    lockVersion,
    installedVersion,
    treeFiles,
  });
  for (const o of result.oks) console.log(`[check-rxdb17] ok ${o}`);
  for (const f of result.failures) console.error(`[check-rxdb17] FAIL: ${f}`);
  if (!result.ok) {
    console.error(
      `[check-rxdb17] ${result.failures.length} violation(s) — the RxDB 17 migration is not complete on this branch`,
    );
    process.exit(1);
  }
  console.log("[check-rxdb17] all invariants hold — tree is on RxDB 17 without rxdb-hooks");
}
