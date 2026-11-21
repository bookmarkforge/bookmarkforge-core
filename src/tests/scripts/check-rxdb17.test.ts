/**
 * Unit + integration tests for scripts/check-rxdb17.mjs
 *
 * Unit: `runRxdb17Checks` is a pure function — fixtures are in-memory
 * (pkg spec, lock version, installed version, tree map). Integration: the
 * CLI is spawned (a) against the real repo (exit 0) and (b) against a
 * temp-dir scaffold that pins rxdb 16.x (exit 1).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  majorOf,
  majorLabel,
  runRxdb17Checks,
} from "../../../scripts/check-rxdb17.mjs";
import { runNpm } from "./run-npm";

// ─── Unit: pure function ─────────────────────────────────────────────

const GREEN_TREE = new Map<string, string>([
  ["src/db/database.core.ts", "import { createRxDatabase } from 'rxdb/plugins/core';"],
  ["src/App.tsx", "import { useRxDB } from 'rxdb/plugins/react';"],
]);

const GREEN = {
  pkgSpec: "^17.4.0",
  lockVersion: "17.4.0",
  installedVersion: "17.4.0",
  treeFiles: GREEN_TREE,
};

describe("runRxdb17Checks (unit)", () => {
  it("passes when rxdb is 17.x everywhere and rxdb-hooks is gone", () => {
    const result = runRxdb17Checks(GREEN);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.oks).toContain('package.json rxdb "^17.4.0" is 17.x');
    expect(result.oks).toContain("package-lock.json rxdb 17.4.0 is 17.x");
    expect(result.oks).toContain("node_modules/rxdb 17.4.0 is 17.x");
    expect(result.oks).toContain("no rxdb-hooks references in the tree");
  });

  it("fails when package.json pins rxdb 16.x", () => {
    const result = runRxdb17Checks({ ...GREEN, pkgSpec: "^16.21.0" });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain(
      'rxdb in package.json is "^16.21.0" (major 16) — must be 17.x',
    );
  });

  it("fails when rxdb is undeclared", () => {
    const result = runRxdb17Checks({ ...GREEN, pkgSpec: null });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "rxdb not declared in package.json dependencies",
    );
  });

  it("fails when the lockfile resolves to an old major", () => {
    const result = runRxdb17Checks({ ...GREEN, lockVersion: "16.25.0" });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain(
      "package-lock.json resolves rxdb to 16.25.0 (major 16)",
    );
  });

  it("fails when the installed copy is stale", () => {
    const result = runRxdb17Checks({ ...GREEN, installedVersion: "16.25.0" });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("node_modules/rxdb is 16.25.0 (major 16)");
  });

  it("fails when rxdb-hooks appears anywhere in the tree", () => {
    const tree = new Map(GREEN_TREE);
    tree.set("src/hooks/useRxQuery.ts", "import { useRxQuery } from 'rxdb-hooks';");
    const result = runRxdb17Checks({ ...GREEN, treeFiles: tree });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain(
      "rxdb-hooks still referenced in the tree (1 file(s)): src/hooks/useRxQuery.ts",
    );
  });

  it("accepts absent lockfile and installed copy", () => {
    const result = runRxdb17Checks({
      pkgSpec: "^17.4.0",
      lockVersion: null,
      installedVersion: null,
      treeFiles: GREEN_TREE,
    });
    expect(result.ok).toBe(true);
    expect(result.oks).toContain(
      "package-lock.json absent — skipped (fresh install in progress?)",
    );
    expect(result.oks).toContain("node_modules/rxdb absent — skipped");
  });

  it("parses major from a range spec", () => {
    expect(majorOf(">=17 <18")).toBe(17);
    expect(majorOf("17.x")).toBe(17);
    expect(majorLabel("^16.21.0")).toBe("16");
    expect(majorOf(undefined)).toBeNull();
  });
});

// ─── Integration: CLI as a subprocess ────────────────────────────────

const CLI = join(process.cwd(), "scripts", "check-rxdb17.mjs");

function runCli(cwd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [CLI], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("check-rxdb17.mjs CLI integration", () => {
  let staleDir: string;

  beforeAll(() => {
    staleDir = join(tmpdir(), `bmf-rxdb17-stale-${process.pid}`);
    rmSync(staleDir, { recursive: true, force: true });
    mkdirSync(join(staleDir, "src"), { recursive: true });
    writeFileSync(
      join(staleDir, "package.json"),
      JSON.stringify({ dependencies: { rxdb: "^16.21.0" } }, null, 2) + "\n",
    );
    writeFileSync(
      join(staleDir, "package-lock.json"),
      JSON.stringify({ packages: { "node_modules/rxdb": { version: "16.25.0" } } }, null, 2) + "\n",
    );
    writeFileSync(
      join(staleDir, "src", "hooks.ts"),
      "import { useRxQuery } from 'rxdb-hooks';\n",
    );
  });

  afterAll(() => {
    rmSync(staleDir, { recursive: true, force: true });
  });

  it("exits 0 against the real repo", () => {
    const { status, stdout } = runCli(process.cwd());
    expect(status).toBe(0);
    expect(stdout).toContain("all invariants hold");
  });

  it("exits 1 against a stale scaffold and reports the violations", () => {
    const { status, stderr } = runCli(staleDir);
    expect(status).toBe(1);
    expect(stderr).toContain('rxdb in package.json is "^16.21.0" (major 16)');
    expect(stderr).toContain("package-lock.json resolves rxdb to 16.25.0");
    expect(stderr).toContain("rxdb-hooks still referenced in the tree");
  });
});

describe("npm run check:rxdb17 integration", () => {
  let npmDir: string;

  beforeAll(() => {
    npmDir = join(tmpdir(), `bmf-rxdb17-npm-${process.pid}`);
    rmSync(npmDir, { recursive: true, force: true });
    mkdirSync(join(npmDir, "src"), { recursive: true });
    mkdirSync(join(npmDir, "scripts"), { recursive: true });
    // Mirror the real repo layout: package.json wires the documented npm
    // script, then drifts (rxdb 16.x + rxdb-hooks in the tree).
    writeFileSync(
      join(npmDir, "package.json"),
      JSON.stringify(
        {
          scripts: { "check:rxdb17": "node scripts/check-rxdb17.mjs" },
          dependencies: { rxdb: "^16.21.0" },
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(
      join(npmDir, "package-lock.json"),
      JSON.stringify(
        { packages: { "node_modules/rxdb": { version: "16.25.0" } } },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(
      join(npmDir, "src", "hooks.ts"),
      "import { useRxQuery } from 'rxdb-hooks';\n",
    );
    // The npm script resolves `node scripts/check-rxdb17.mjs` relative to cwd.
    copyFileSync(
      join(process.cwd(), "scripts", "check-rxdb17.mjs"),
      join(npmDir, "scripts", "check-rxdb17.mjs"),
    );
  });

  afterAll(() => {
    rmSync(npmDir, { recursive: true, force: true });
  });

  it("npm run check:rxdb17 exits 0 against the real repo", () => {
    const { status, stdout } = runNpm(process.cwd(), "check:rxdb17");
    expect(status).toBe(0);
    expect(stdout).toContain("all invariants hold");
  });

  it("npm run check:rxdb17 exits 1 against the stale scaffold", () => {
    const { status, stderr } = runNpm(npmDir, "check:rxdb17");
    expect(status).toBe(1);
    expect(stderr).toContain('rxdb in package.json is "^16.21.0" (major 16)');
    expect(stderr).toContain("rxdb-hooks still referenced in the tree");
  });
});
