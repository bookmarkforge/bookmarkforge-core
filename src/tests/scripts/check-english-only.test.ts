/**
 * Unit + integration tests for scripts/check-english-only.mjs
 *
 * Unit: `analyzeText` and `scanFile` are exercised with in-memory
 * fixtures. Integration: the CLI is spawned (a) against the real repo
 * (exit 0) and (b) against a temp-dir scaffold whose src/ contains
 * non-English text in a comment (exit 1).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analyzeText, scanFile } from "../../../scripts/check-english-only.mjs";
import { runNpm } from "./run-npm";

// ─── Unit: analyzeText ───────────────────────────────────────────────

describe("analyzeText (unit)", () => {
  it("returns null for clean ASCII English", () => {
    expect(analyzeText("Hello world")).toBeNull();
  });

  it("flags accented non-English letters", () => {
    const hit = analyzeText("Configuraci\u00F3n de usuario");
    expect(hit).not.toBeNull();
    expect(hit?.signal).toMatch(/non-English letters/);
  });

  it("flags non-Latin scripts", () => {
    expect(analyzeText("\u0395\u03BB\u03BB\u03B7\u03BD\u03B9\u03BA\u03AC test")).not.toBeNull();
  });

  it("returns null when the text carries the i18n-allow pragma", () => {
    expect(analyzeText("// i18n-allow Configuraci\u00F3n")).toBeNull();
  });
});

// ─── Unit: scanFile ──────────────────────────────────────────────────

describe("scanFile (unit)", () => {
  it("flags a non-English t() fallback", () => {
    const findings = scanFile('t("key", "Configuraci\u00F3n");\n');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.scope).toBe("t() fallback");
  });

  it("suppresses the finding when the line carries the pragma", () => {
    const src = 't("key", "Configuraci\u00F3n"); // i18n-allow\n';
    expect(scanFile(src)).toHaveLength(0);
  });
});

// ─── CLI integration ─────────────────────────────────────────────────

describe("CLI integration", () => {
  let npmDir: string;

  beforeAll(() => {
    npmDir = join(tmpdir(), `bmf-english-only-${process.pid}`);
    rmSync(npmDir, { recursive: true, force: true });
    mkdirSync(join(npmDir, "scripts"), { recursive: true });
    mkdirSync(join(npmDir, "src"), { recursive: true });
    // Mirror the real repo: package.json wires the documented npm script.
    writeFileSync(
      join(npmDir, "package.json"),
      JSON.stringify(
        { scripts: { "check:english-only": "node scripts/check-english-only.mjs" } },
        null,
        2,
      ) + "\n",
    );
    copyFileSync(
      join(process.cwd(), "scripts", "check-english-only.mjs"),
      join(npmDir, "scripts", "check-english-only.mjs"),
    );
    // Non-English in a comment — the position the gate guards.
    writeFileSync(join(npmDir, "src", "dirty.ts"), "// Configuraci\u00F3n de usuario\n");
  });

  afterAll(() => {
    rmSync(npmDir, { recursive: true, force: true });
  });

  it("npm run check:english-only exits 0 against the real repo", () => {
    const { status, stdout } = runNpm(process.cwd(), "check:english-only");
    expect(status).toBe(0);
    expect(stdout).toContain("ok:");
  });

  it("npm run check:english-only exits 1 against the dirty scaffold", () => {
    const { status, stderr } = runNpm(npmDir, "check:english-only");
    expect(status).toBe(1);
    expect(stderr).toContain("[check-english-only] FAIL:");
  });
});
