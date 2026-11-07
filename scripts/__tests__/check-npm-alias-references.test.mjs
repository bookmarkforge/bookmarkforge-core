// npm-alias-fixtures: check:ghost, missing:command

/**
 * scripts/__tests__/check-npm-alias-references.test.mjs
 *
 * The gate exists because an e2e spec documented a dropped alias and a chain
 * fixture named a gate that was never a script. The suite therefore pins BOTH
 * halves: what counts as an invocation (docs code spans, `run:` blocks, code
 * literals, backticked comment commands) and what does not (prose, test
 * titles, `${…}` placeholders, plain comments).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  checkNpmAliasReferences,
  fixtureAliases,
  scanFile,
  snippetAliases,
} from "../check-npm-alias-references.mjs";

const ROOT = join(import.meta.dirname, "..", "..");

function sandbox(files, scripts = { test: "vitest", "check:env": "node scripts/env.mjs" }) {
  const root = mkdtempSync(join(tmpdir(), "npm-alias-references-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts }));
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

function aliasesOf(file, content) {
  return scanFile(file, content).map(({ alias }) => alias);
}

describe("what counts as an invocation", () => {
  it("reads Markdown code spans and fenced blocks, not prose", () => {
    const text = [
      "The first npm run rebaselines the baseline.",
      "",
      "Run `npm run check:env` before pushing.",
      "",
      "```bash",
      "npm run check:ghost",
      "```",
    ].join("\n");
    expect(aliasesOf("docs/runbook.md", text)).toEqual(["check:env", "check:ghost"]);
  });

  it("reads YAML run scalars and block scalars", () => {
    const text = [
      "jobs:",
      "  verify:",
      "    steps:",
      "      - run: npm run check:env",
      "      - run: |",
      "          npm run test",
      "          npm run check:ghost",
      "      - name: prose",
      "        # npm run ignored:comment",
    ].join("\n");
    expect(aliasesOf(".github/workflows/ci.yml", text)).toEqual([
      "check:env",
      "test",
      "check:ghost",
    ]);
  });

  it("reads command literals and backticked commands in comments, not titles", () => {
    const text = [
      "// Run with `npm run check:ghost`.",
      "// the first npm run rebaselines the baseline",
      "const command = \"npm run check:env && npm run test\";",
      "const template = `npm run ${alias} --silent`;",
      "it(\"the second npm run exits 0\", () => {});",
    ].join("\n");
    expect(aliasesOf("tests/e2e/sample.spec.ts", text)).toEqual(["check:ghost", "check:env", "test"]);
  });

  it("splits chains and strips shell prompts", () => {
    expect(snippetAliases("$ npm run test && npm run check:env; npm run lint")).toEqual([
      "test",
      "check:env",
      "lint",
    ]);
  });
});

describe("reporting", () => {
  it("fails an undeclared alias with file and line", () => {
    const root = sandbox({ "docs/runbook.md": "intro\n\nRun `npm run missing:command`\n" });
    const result = checkNpmAliasReferences({ root, scripts: { test: "vitest" } });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      { alias: "missing:command", file: "docs/runbook.md", line: 3 },
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("exempts a file's declared fixtures only, and fails stale entries", () => {
    const root = sandbox({
      "tests/fixture.spec.ts":
        "// npm-alias-fixtures: check:ghost, check:foo\nconst a = \"npm run check:ghost\";\n",
    });
    const result = checkNpmAliasReferences({ root, scripts: { test: "vitest" } });
    expect(result.missing).toEqual([]);
    expect(result.stale).toEqual([{ alias: "check:foo", file: "tests/fixture.spec.ts" }]);
    expect(result.ok).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("reads the pragma without swallowing a trailing reason", () => {
    const aliases = fixtureAliases("// npm-alias-fixtures: check:a, check:b — deliberate fixtures");
    expect([...aliases]).toEqual(["check:a", "check:b"]);
  });
});

describe("the real tree", () => {
  it("has no reference to an undeclared alias", () => {
    const run = spawnSync("node", ["scripts/check-npm-alias-references.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(run.stderr).toBe("");
    expect(run.stdout).toMatch(/ok: \d+ declared script\(s\)/);
    expect(run.status).toBe(0);
  });
});
