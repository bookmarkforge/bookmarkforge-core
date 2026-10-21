import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  checkDocumentedNpmCommands,
  collectDocumentedCommands,
  documentedFiles,
} from "../check-documented-npm-commands.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "check-documented-npm-commands.mjs");

function fixture(files, scripts = { test: "vitest" }) {
  const root = mkdtempSync(join(tmpdir(), "documented-npm-commands-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts }));
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

describe("check-documented-npm-commands", () => {
  it("collects npm run references from supported documentation roots", () => {
    const root = fixture({
      "README.md": "Run `npm run test`.",
      "docs/runbook.md": "Then run `npm run check:env`.",
      "scripts/ignored.md": "npm run not-a-real-script",
    }, { test: "vitest", "check:env": "node check.mjs" });

    expect(documentedFiles(root).map((file) => relative(root, file).replaceAll("\\", "/"))).toEqual([
      "README.md",
      "docs/runbook.md",
    ]);
    expect(collectDocumentedCommands(root).map((item) => item.command)).toEqual([
      "test",
      "check:env",
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("passes when every documented command is declared", () => {
    const root = fixture({ "docs/runbook.md": "npm run test\nnpm run check:env" }, {
      test: "vitest",
      "check:env": "node check.mjs",
    });
    const result = checkDocumentedNpmCommands({
      root,
      packageJson: { scripts: { test: "vitest", "check:env": "node check.mjs" } },
    });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("reports the file, line and command when documentation drifts", () => {
    const root = fixture({ "docs/runbook.md": "## Commands\n\nnpm run missing:command\n" });
    const result = checkDocumentedNpmCommands({
      root,
      packageJson: { scripts: { test: "vitest" } },
    });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      expect.objectContaining({
        command: "missing:command",
        file: "docs/runbook.md",
        line: 3,
      }),
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("fails closed through the CLI and exits cleanly on a healthy fixture", () => {
    const broken = fixture({ "docs/runbook.md": "npm run missing:command" });
    const failed = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, DOCUMENTED_NPM_COMMANDS_ROOT: broken },
    });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("docs/runbook.md:1");
    expect(failed.stderr).toContain("npm run missing:command");
    rmSync(broken, { recursive: true, force: true });

    const healthy = fixture({ "docs/runbook.md": "npm run test" });
    const passed = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, DOCUMENTED_NPM_COMMANDS_ROOT: healthy },
    });
    expect(passed.status).toBe(0);
    expect(passed.stdout).toContain("all documented commands exist");
    rmSync(healthy, { recursive: true, force: true });
  });
});
