/**
 * scripts/pro-history-check.mjs
 *
 * Shared primitives for one question: does this checkout still carry Pro code
 * in its git history?
 *
 * Two consumers, one implementation — deliberately:
 *   - `scripts/check-no-pro-history.mjs`, the CI gate in the public export;
 *   - `.devin/scrub-public-export-history.mjs`, the local verifier/rewriter.
 *
 * Duplicating the export discriminator or the path walk in both places is how
 * the boundary drifts: this audit already found three copies of the SSRF range
 * logic and two copies of the unlock flow. One module, imported by both.
 *
 * The Pro path list comes from `pro-boundary.mjs`, the same source the exporter
 * and `check:open-core` read, so a reclassification cannot leave a gate behind.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PRO_MODULE_PATHS } from "./pro-boundary.mjs";

export { PRO_MODULE_PATHS };

/** Run git in `root`, returning trimmed stdout. Throws when git fails. */
export function git(root, ...argv) {
  return execFileSync("git", ["-c", `safe.directory=${root}`, ...argv], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/**
 * An export checkout ships an auditable root `manifest.json` with
 * `license: "MIT"`; the private repository does not. Identity, not contents:
 * deciding by "does it contain Pro code?" made an export look private and the
 * leak invisible to the gate written to catch it (C2, 2026-10-20 audit).
 */
export function isExportTree(root) {
  const manifest = join(root, "manifest.json");
  if (!existsSync(manifest)) {return false;}
  try {
    return JSON.parse(readFileSync(manifest, "utf8")).license === "MIT";
  } catch {
    return false;
  }
}

/** True when `root` is inside a git work tree. Quiet: no git stderr. */
export function isGitRepo(root) {
  try {
    return (
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === "true"
    );
  } catch {
    return false;
  }
}

/**
 * True for a truncated clone. A depth-1 checkout sees one commit, so a
 * "history is clean" verdict from it is a false negative — callers fail closed.
 */
export function isShallowClone(root) {
  try {
    return git(root, "rev-parse", "--is-shallow-repository") === "true";
  } catch {
    return false;
  }
}

/** `<hash> <subject>` for every reachable commit that still contains a Pro path. */
export function historyHits(root) {
  return git(root, "log", "--all", "--format=%h %s", "--", ...PRO_MODULE_PATHS)
    .split("\n")
    .filter(Boolean);
}

/** Pro paths present in the committed tree of HEAD. */
export function headHits(root) {
  const committed = git(root, "ls-tree", "-r", "HEAD", "--name-only").split("\n");
  const pro = new Set(PRO_MODULE_PATHS);
  return committed.filter((file) => pro.has(file));
}

/** Pro paths present in the working tree (deletion not committed yet). */
export function worktreeHits(root) {
  return PRO_MODULE_PATHS.filter((file) => existsSync(join(root, file)));
}
