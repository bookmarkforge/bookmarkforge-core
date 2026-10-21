/**
 * Integration tests for the check:license-keys gate
 * (`node scripts/generate-license-keys.mjs --check`).
 *
 * (a) against the real repo the committed public key + fixture signature
 * must pass the sign/verify self-test (exit 0); (b) against a temp-dir
 * scaffold whose committed module carries a broken public key, the gate
 * must fail (exit 1) instead of silently accepting a corrupt key.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runNpm } from "./run-npm";

describe("check:license-keys (CLI integration)", () => {
  let npmDir: string;

  beforeAll(() => {
    npmDir = join(tmpdir(), `bmf-license-keys-${process.pid}`);
    rmSync(npmDir, { recursive: true, force: true });
    mkdirSync(join(npmDir, "scripts"), { recursive: true });
    mkdirSync(join(npmDir, "src", "services"), { recursive: true });
    writeFileSync(
      join(npmDir, "package.json"),
      JSON.stringify(
        { scripts: { "check:license-keys": "node scripts/generate-license-keys.mjs --check" } },
        null,
        2,
      ) + "\n",
    );
    copyFileSync(
      join(process.cwd(), "scripts", "generate-license-keys.mjs"),
      join(npmDir, "scripts", "generate-license-keys.mjs"),
    );
    // Committed module with the public key payload replaced by "QQ=="
    // (valid base64 for a single byte — never a valid SPKI key). The
    // gate must reject it instead of parsing a garbage key.
    const real = readFileSync(
      join(process.cwd(), "src", "services", "licenseKeys.ts"),
      "utf8",
    );
    const corrupted = real.replace(
      /(LICENSE_PUBLIC_KEY_SPKI =\s*\n?\s*)"[^"]*"/,
      '$1"QQ=="',
    );
    writeFileSync(join(npmDir, "src", "services", "licenseKeys.ts"), corrupted);
  });

  afterAll(() => {
    rmSync(npmDir, { recursive: true, force: true });
  });

  it("npm run check:license-keys exits 0 against the real repo", () => {
    const { status, stdout } = runNpm(process.cwd(), "check:license-keys");
    expect(status).toBe(0);
    expect(stdout).toContain("committed public key OK (fixture signature verifies)");
  });

  it("npm run check:license-keys exits 1 against a corrupted key module", () => {
    const { status, stderr } = runNpm(npmDir, "check:license-keys");
    expect(status).toBe(1);
    expect(stderr).toContain("[generate-license-keys]");
  });
});
