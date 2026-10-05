/**
 * Regression test for scripts/build-extension.cjs OUTPUT_DIR resolution.
 *
 * The OUTPUT_DIR contract says the variable overrides the default and allows
 * an absolute output path (e.g. a temp dir or CI artifact dir). Regression
 * tracked here: path.join(ROOT, absoluteOutputDir) prepends the repo root to
 * the absolute path, producing ROOT + absolute on both POSIX and Windows.
 *
 * Mirrors the subprocess convention of the other scripts tests: spawn the
 * script with a synthetic extension/ source and an absolute OUTPUT_DIR, then
 * assert the packaged file lands at the exact absolute path (and NOT at
 * ROOT + absolute, the old buggy location).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPTS_DIR = join(import.meta.dirname, "..", "..", "..", "scripts");
const BUILD_SCRIPT = join(SCRIPTS_DIR, "build-extension.cjs");
const NODE = process.execPath;

describe("build-extension.cjs OUTPUT_DIR resolution", () => {
  const root = join(tmpdir(), `bmf-ext-out-test-${process.pid}`);
  const outAbs = join(root, "out-absolute");

  beforeAll(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, "extension"), { recursive: true });
    writeFileSync(join(root, "extension", "fake-entry.txt"), "payload");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("packages into an absolute OUTPUT_DIR verbatim (no ROOT prefix)", () => {
    const res = spawnSync(NODE, [BUILD_SCRIPT], {
      cwd: root,
      env: { ...process.env, OUTPUT_DIR: outAbs },
      encoding: "utf8",
    });

    expect(res.status).toBe(0);
    // The packaged file must land at the exact absolute path...
    expect(existsSync(join(outAbs, "fake-entry.txt"))).toBe(true);
    // ...and NOT at the buggy ROOT + absolute location.
    expect(existsSync(join(root, outAbs, "fake-entry.txt"))).toBe(false);
  });

  it("still packages into a relative OUTPUT_DIR under the cwd", () => {
    const res = spawnSync(NODE, [BUILD_SCRIPT], {
      cwd: root,
      env: { ...process.env, OUTPUT_DIR: "dist-extension-rel" },
      encoding: "utf8",
    });

    expect(res.status).toBe(0);
    expect(existsSync(join(root, "dist-extension-rel", "fake-entry.txt"))).toBe(true);
  });
});
