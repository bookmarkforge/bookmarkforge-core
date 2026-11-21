import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const GROUPS = JSON.parse(readFileSync(join(ROOT, "scripts", "ci-groups.json"), "utf8"));
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const RUNNER = readFileSync(join(ROOT, "scripts", "check-ci-groups.mjs"), "utf8");

describe("ci-groups", () => {
  it("every group command is an npm alias declared in package.json", () => {
    const declared = new Set(Object.keys(PACKAGE.scripts ?? {}));
    for (const group of GROUPS.groups) {
      for (const alias of group.commands) {
        expect(declared.has(alias), `${group.name} -> ${alias}`).toBe(true);
      }
    }
  });

  it("group names are unique and each group declares commands", () => {
    const names = GROUPS.groups.map((group) => group.name);
    expect(new Set(names).size).toBe(names.length);
    for (const group of GROUPS.groups) {
      expect(group.commands.length).toBeGreaterThan(0);
    }
  });

  it("the runner invokes npm run with the alias verbatim", () => {
    expect(RUNNER).toContain('["run", alias]');
    // The old runner stripped the prefix and ran only the bare alias name.
    expect(RUNNER).not.toMatch(/replace\(\s*\/\^check:/);
  });

  it("--list works without running any gate", () => {
    const output = execFileSync(process.execPath, [join(ROOT, "scripts", "check-ci-groups.mjs"), "--list"], {
      encoding: "utf8",
    });
    expect(output).toContain("Available CI groups");
    expect(output).toContain("core-integrity");
    expect(output).toContain("build-verification");
  });
});
