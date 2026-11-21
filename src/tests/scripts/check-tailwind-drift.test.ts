/**
 * Integration tests for scripts/check-tailwind-rule-drift.mjs
 * (npm run check:tailwind-drift).
 *
 * (a) against the real repo the declared defense utilities must be
 * covered by DEFENSE_RE (exit 0); (b) against a temp-dir scaffold whose
 * src/index.css declares a `.text-ellipsis` custom utility — the
 * canonical stale-regex case the rule does not yet accept — the gate
 * must fail (exit 1) so DEFENSE_RE cannot rot silently.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runNpm } from "./run-npm";

describe("check:tailwind-drift (CLI integration)", () => {
  let npmDir: string;

  beforeAll(() => {
    npmDir = join(tmpdir(), `bmf-tailwind-drift-${process.pid}`);
    rmSync(npmDir, { recursive: true, force: true });
    mkdirSync(join(npmDir, "scripts"), { recursive: true });
    mkdirSync(join(npmDir, "src"), { recursive: true });
    writeFileSync(
      join(npmDir, "package.json"),
      JSON.stringify(
        { scripts: { "check:tailwind-drift": "node scripts/check-tailwind-rule-drift.mjs" } },
        null,
        2,
      ) + "\n",
    );
    copyFileSync(
      join(process.cwd(), "scripts", "check-tailwind-rule-drift.mjs"),
      join(npmDir, "scripts", "check-tailwind-rule-drift.mjs"),
    );
    // The gate imports DEFENSE_RE from eslint-rules/lib/jsx-utils.mjs
    // (no transitive imports) — mirror it into the scaffold.
    mkdirSync(join(npmDir, "eslint-rules", "lib"), { recursive: true });
    copyFileSync(
      join(process.cwd(), "eslint-rules", "lib", "jsx-utils.mjs"),
      join(npmDir, "eslint-rules", "lib", "jsx-utils.mjs"),
    );
    // The canonical drift: a real truncation utility DEFENSE_RE does not
    // know. Declared as a custom utility class -> the gate must flag it.
    writeFileSync(
      join(npmDir, "src", "index.css"),
      [
        ".text-ellipsis {",
        "  overflow: hidden;",
        "  text-overflow: ellipsis;",
        "  white-space: nowrap;",
        "}",
        "",
      ].join("\n"),
    );
  });

  afterAll(() => {
    rmSync(npmDir, { recursive: true, force: true });
  });

  it("npm run check:tailwind-drift exits 0 against the real repo", () => {
    const { status, stdout } = runNpm(process.cwd(), "check:tailwind-drift");
    expect(status).toBe(0);
    expect(stdout).toContain("0 drift");
  });

  it("npm run check:tailwind-drift exits 1 when index.css declares an unaccepted defense", () => {
    const { status, stderr } = runNpm(npmDir, "check:tailwind-drift");
    expect(status).toBe(1);
    expect(stderr).toContain("DRIFT");
    expect(stderr).toContain("text-ellipsis");
  });
});
