#!/usr/bin/env node
/**
 * scripts/check-baseline-drift.mjs — visual baseline regeneration drift gate.
 *
 * Flags when a tracked Playwright visual baseline (a `*.png` inside any
 * `*.spec.ts-snapshots/` directory under tests/e2e) changes by more than
 * `--max-ratio` (default 0.10 ≈ 10 % of pixels) between a reference git ref
 * and the current working tree — so a *content* change in a regenerated
 * baseline gets reviewed BEFORE it is committed (CI companion job in
 * `ci.yml`: `visual-baseline-drift`).
 *
 * Rationale (AGENTS.md §7: "regenerating baselines is an intentional act —
 * review pixel diffs"): a shallow bump of `maxDiffPixelRatio` can mask real
 * layout/content shifts. `--update-snapshots` rewrites the baseline without
 * reporting how much it drifted; this gate answers that question by
 * pixelmatching the NEW baseline against the tracked one at the base ref.
 *
 * Usage:
 *   node scripts/check-baseline-drift.mjs                      # vs HEAD
 *   node scripts/check-baseline-drift.mjs --base origin/main   # PR base ref
 *   node scripts/check-baseline-drift.mjs --max-ratio 0.05     # stricter
 *   node scripts/check-baseline-drift.mjs --root /abs/out/dir  # test override
 *
 * Exit codes:
 *   0 — no tracked baseline drifted beyond the threshold
 *   1 — baseline(s) regenerated with drift > maxRatio (details on stderr)
 *   2 — usage / IO error (not a git work tree, unreadable PNG, …)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import process from "node:process";
import PNGlib from "pngjs";
import pixelmatch from "pixelmatch";

let ROOT = process.env.CHECK_BASELINE_DRIFT_ROOT ?? process.cwd();
const MAX_RATIO_DEFAULT = 0.1;
// Test/update artifacts never live in git; defense-in-depth in case one gets
// committed by accident — they are not baselines and must not be compared.
const ARTIFACT_NAME_RE = /(__diffs__|__snapshots__|[-_.](diff|actual|expected)(\.|$))/i;

// ── git helpers (spawnSync so a non-zero status does not throw raw) ────────
// Explicit safe.directory keeps the gate working on checkouts where git flags
// dubious ownership (common on shared/non-privileged dev machines); harmless
// in CI where the checkout already belongs to the runner.
function gitArgs(args) {
  return ["-C", ROOT, "-c", `safe.directory=${ROOT}`, ...args];
}

function gitStatusOr(args) {
  return spawnSync("git", gitArgs(args), { encoding: "utf8" });
}

function gitBytes(args) {
  const res = spawnSync("git", gitArgs(args), { maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(res.stderr ?? "").toString().trim()}`,
    );
  }
  return Buffer.from(res.stdout);
}

// ── baseline discovery ─────────────────────────────────────────────────────
const SNAPSHOT_DIR_RE = /\.spec\.ts-snapshots$/;

function walkSnapshotDirs() {
  const e2eRoot = join(ROOT, "tests", "e2e");
  if (!existsSync(e2eRoot)) return [];
  const result = [];
  let entries;
  try {
    entries = readdirSync(e2eRoot, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !SNAPSHOT_DIR_RE.test(entry.name)) continue;
    const dir = join(e2eRoot, entry.name);
    let files;
    try {
      files = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".png")) continue;
      if (ARTIFACT_NAME_RE.test(file.name)) continue;
      // Always emit POSIX separators so git paths match regardless of OS.
      result.push(relative(ROOT, join(dir, file.name)).split(sep).join("/"));
    }
  }
  return result.sort();
}

/** Baselines tracked at a ref (ls-tree), same filter as the worktree walk. */
function trackedAtRef(ref) {
  const res = spawnSync("git", gitArgs(["ls-tree", "-r", "--name-only", ref, "--", "tests/e2e"]), {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error(
      `[check-baseline-drift] cannot read ref "${ref}": ${(res.stderr ?? "").toString().trim()}`,
    );
    process.exit(2);
  }
  return (res.stdout ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(
      (path) =>
        /\.spec\.ts-snapshots\/[^/]+\.png$/.test(path) &&
        !ARTIFACT_NAME_RE.test(basename(path)),
    )
    .sort();
}

// ── pixel comparison ───────────────────────────────────────────────────────
/**
 * Decode two PNG buffers and return the pixelmismatch ratio (0..1), matching
 * Playwright's maxDiffPixelRatio semantics. Dimensions must agree; a resize is
 * reported as full drift (ratio 1). Throws on an unreadable PNG.
 */
export function comparePngBytes(oldBytes, newBytes) {
  let oldPng;
  let newPng;
  try {
    oldPng = PNGlib.PNG.sync.read(oldBytes);
    newPng = PNGlib.PNG.sync.read(newBytes);
  } catch (error) {
    throw new Error(`cannot decode PNG: ${error?.message ?? String(error)}`);
  }
  if (oldPng.width !== newPng.width || oldPng.height !== newPng.height) {
    return { ratio: 1, reason: `resized ${oldPng.width}×${oldPng.height} → ${newPng.width}×${newPng.height}` };
  }
  if (oldBytes.equals(newBytes)) return { ratio: 0 };
  const diff = Buffer.alloc(oldPng.width * oldPng.height * 4);
  const mismatched = pixelmatch(
    oldPng.data,
    newPng.data,
    diff,
    oldPng.width,
    oldPng.height,
    { threshold: 0.1 },
  );
  const total = oldPng.width * oldPng.height;
  return { ratio: mismatched / total, reason: undefined };
}

function pct(ratio) {
  return `${(ratio * 100).toFixed(1)}%`;
}

// ── CLI ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { base: "HEAD", maxRatio: MAX_RATIO_DEFAULT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") args.base = argv[++i];
    else if (argv[i] === "--max-ratio") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        console.error(`[check-baseline-drift] --max-ratio must be a ratio in [0,1], got "${argv[i]}"`);
        process.exit(2);
      }
      args.maxRatio = value;
    } else if (argv[i] === "--root") {
      // Test-only override: point the scan at a different repo root.
      args.root = argv[++i];
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Usage: check-baseline-drift.mjs [--base <ref>] [--max-ratio <0..1>] [--root <dir>]");
      process.exit(0);
    } else {
      console.error(`[check-baseline-drift] unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.root) {
    ROOT = args.root;
  }

  const gitCheck = gitStatusOr(["rev-parse", "--is-inside-work-tree"]);
  if (gitCheck.status !== 0) {
    console.error("[check-baseline-drift] not inside a git work tree (or git unavailable)");
    process.exit(2);
  }

  // Union of worktree baselines and baselines tracked at the base ref: an
  // `--update-snapshots` run may add (new view/locale) or remove baselines.
  const worktree = walkSnapshotDirs();
  const baseRef = args.base;
  const inBase = new Set(trackedAtRef(baseRef));
  const candidates = [...new Set([...worktree, ...inBase])].sort();

  if (candidates.length === 0) {
    console.log("[check-baseline-drift] no visual baselines to check");
    process.exit(0);
  }

  const failures = [];
  const added = [];
  const removed = [];
  let compared = 0;

  for (const path of candidates) {
    const onDisk = existsSync(join(ROOT, path));
    const trackedInBase = inBase.has(path);
    if (!onDisk && trackedInBase) {
      removed.push(path);
      continue;
    }
    if (onDisk && !trackedInBase) {
      added.push(path);
      continue;
    }
    if (!onDisk && !trackedInBase) continue; // unreachable, defensive

    // Same path on disk and in git: compare old (base ref) vs new (worktree).
    let oldBytes;
    try {
      oldBytes = gitBytes(["show", `${baseRef}:${path}`]);
    } catch (error) {
      // Race-free fallback: file tracked at baseRef but deleted meanwhile.
      console.error(`[check-baseline-drift] cannot read ${baseRef}:${path} — ${error.message}`);
      process.exit(2);
    }
    let newBytes;
    try {
      newBytes = readFileSync(join(ROOT, path));
    } catch (error) {
      console.error(`[check-baseline-drift] cannot read ${path} — ${error?.message ?? error}`);
      process.exit(2);
    }
    compared += 1;
    if (oldBytes.equals(newBytes)) {
      console.log(`[check-baseline-drift] ok ${path} — unchanged`);
      continue;
    }
    let result;
    try {
      result = comparePngBytes(oldBytes, newBytes);
    } catch (error) {
      console.error(`[check-baseline-drift] ERROR ${path} — ${error.message}`);
      process.exit(2);
    }
    if (result.ratio > args.maxRatio) {
      const reason = result.reason ? ` (${result.reason})` : "";
      failures.push({ path, ratio: result.ratio, reason });
      console.error(
        `[check-baseline-drift] FAIL ${path} — drift ${pct(result.ratio)} > ${pct(args.maxRatio)}${reason}. ` +
          `Content changed — review the visual diff before committing the regenerated baseline.`,
      );
    } else {
      const reason = result.reason ? ` (${result.reason})` : "";
      console.log(
        `[check-baseline-drift] ok ${path} — drift ${pct(result.ratio)} ≤ ${pct(args.maxRatio)}${reason}`,
      );
    }
  }

  for (const path of added) {
    console.log(`[check-baseline-drift] new ${path} — added baseline (no prior version to drift against)`);
  }
  for (const path of removed) {
    console.log(`[check-baseline-drift] removed ${path} — baseline deleted (not a drift)`);
  }

  const summary = `[check-baseline-drift] totals: ${compared} compared vs ${baseRef}, ${failures.length} drifted > ${pct(args.maxRatio)}, ${added.length} added, ${removed.length} removed`;
  if (failures.length > 0) {
    console.error(summary);
    process.exit(1);
  }
  console.log(summary);
  process.exit(0);
}

// Only run main when invoked directly (so comparePngBytes is importable).
function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  return entry.split(/[\\/]/).pop() === import.meta.url.split("/").pop();
}

if (isDirectInvocation()) {
  try {
    main();
  } catch (error) {
    console.error(`[check-baseline-drift] FATAL: ${error?.message ?? String(error)}`);
    process.exit(2);
  }
}