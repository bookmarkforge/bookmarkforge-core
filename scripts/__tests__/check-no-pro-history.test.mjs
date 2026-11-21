/**
 * scripts/__tests__/check-no-pro-history.test.mjs
 *
 * Contract pins for the public-export history gate.
 *
 * C2 (2026-10-20 audit): the export shipped five Pro implementations in nine
 * commits while `check:open-core` stayed green, because that gate reads the
 * working tree. The replacement gate must (a) fail when ANY reachable commit
 * still carries a Pro path, (b) pass only after the history is clean, and
 * (c) fail closed when it cannot see the history at all — a shallow clone that
 * reports "ok" is the exact failure mode this gate exists to prevent.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PRO_MODULE_PATHS } from "../pro-boundary.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "check-no-pro-history.mjs",
);

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

const roots = [];
afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

function git(cwd, ...argv) {
  return execFileSync("git", argv, { cwd, encoding: "utf8", env: GIT_ENV });
}

/** Export-shaped repo (`manifest.json` with an MIT licence) and one commit. */
function exportRepo({ withProHistory }) {
  const root = mkdtempSync(join(tmpdir(), "bmf-pro-history-"));
  roots.push(root);
  git(root, "init", "-q");
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ license: "MIT" }));
  writeFileSync(join(root, "README.md"), "# export\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "baseline");
  // Two commits on purpose: `git clone --depth 1` of a single-commit repo is
  // NOT shallow (git has nothing to truncate), so the shallow case would test
  // nothing.
  writeFileSync(join(root, "CHANGELOG.md"), "# changelog\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "second");

  if (withProHistory) {
    const proPath = PRO_MODULE_PATHS[0];
    mkdirSync(dirname(join(root, proPath)), { recursive: true });
    writeFileSync(join(root, proPath), "export class Leak {}\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "add pro implementation");
    git(root, "rm", "-q", proPath);
    git(root, "commit", "-qm", "delete pro implementation");
  }
  return root;
}

function run(target) {
  return execFileSync(process.execPath, [SCRIPT, target], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("check-no-pro-history", () => {
  it("fails when a deleted Pro file is still reachable in history", () => {
    const root = exportRepo({ withProHistory: true });

    let failure;
    try {
      run(root);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeDefined();
    expect(failure.status).toBe(1);
    expect(failure.stderr).toContain("still contain Pro implementations");
  });

  it("passes an export whose history never carried Pro code", () => {
    const root = exportRepo({ withProHistory: false });

    expect(run(root)).toContain("Pro path(s) appears in any reachable commit");
  });

  it("fails closed on a shallow clone instead of reporting a clean history", () => {
    const root = exportRepo({ withProHistory: false });
    const shallow = `${root}-shallow`;
    roots.push(shallow);
    // A URL (not a plain path): git IGNORES --depth for local-path clones, so a
    // plain path would silently produce a full clone and test nothing.
    execFileSync("git", [
      "clone",
      "-q",
      "--depth",
      "1",
      pathToFileURL(root).href,
      shallow,
    ]);

    let failure;
    try {
      run(shallow);
    } catch (error) {
      failure = error;
    }

    expect(failure?.status).toBe(1);
    expect(failure.stderr).toContain("shallow clone");
  });

  it("fails closed when the export is not a git checkout", () => {
    const root = exportRepo({ withProHistory: false });
    const plain = `${root}-plain`;
    roots.push(plain);
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, "manifest.json"), JSON.stringify({ license: "MIT" }));

    let failure;
    try {
      run(plain);
    } catch (error) {
      failure = error;
    }

    expect(failure?.status).toBe(1);
    expect(failure.stderr).toContain("not a git checkout");
  });
});
