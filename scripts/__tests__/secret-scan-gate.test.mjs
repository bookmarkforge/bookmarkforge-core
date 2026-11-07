import { describe, expect, it, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("secret-scan gate (build-ci.mjs)", () => {
  const tmpDir = join(tmpdir(), "secret-scan-test-" + Date.now());
  const assetsDir = join(tmpDir, "dist", "assets");

  beforeEach(() => {
    // Clean and recreate the directory for each test
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(assetsDir, { recursive: true });
  });

  function createJsFile(name, content) {
    writeFileSync(join(assetsDir, name), content, "utf8");
  }

  function scanForSecrets() {
    const SENSITIVE_KEYS = [
      "VITE_GEMINI_API_KEY",
      "VITE_OPENAI_API_KEY",
      "VITE_ANTHROPIC_API_KEY",
      "VITE_GROQ_API_KEY",
      "VITE_HUGGINGFACE_API_KEY",
    ];
    // Build pattern: KEY:\s*["'`][^"'`]+["'`]
    const pattern = new RegExp(
      SENSITIVE_KEYS.map((k) => k + ":\\s*[\"'`][^\"'`]+[\"'`]").join("|"),
      "g",
    );

    const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
    const leaks = [];

    for (const file of jsFiles) {
      const content = readFileSync(join(assetsDir, file), "utf8");
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null) {
        leaks.push({ file, match: match[0] });
      }
    }

    return { jsFiles, leaks };
  }

  it("passes when no secrets are present", () => {
    createJsFile("clean.js", 'const x = { VITE_APP_VERSION: "1.0.0" };');
    const { jsFiles, leaks } = scanForSecrets();
    expect(leaks).toHaveLength(0);
    expect(jsFiles.length).toBeGreaterThan(0);
  });

  it("detects VITE_GEMINI_API_KEY leak (double-quote)", () => {
    createJsFile(
      "leaked.js",
      'const env = { VITE_GEMINI_API_KEY: "AIzaSyTestKey123" };',
    );
    const { leaks } = scanForSecrets();
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.some((l) => l.match.includes("VITE_GEMINI_API_KEY"))).toBe(
      true,
    );
  });

  it("detects VITE_GEMINI_API_KEY leak (backtick)", () => {
    createJsFile(
      "leaked-backtick.js",
      "const env = { VITE_GEMINI_API_KEY: `AIzaSyBacktickKey` };",
    );
    const { leaks } = scanForSecrets();
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.some((l) => l.match.includes("VITE_GEMINI_API_KEY"))).toBe(
      true,
    );
  });

  it("detects VITE_OPENAI_API_KEY leak", () => {
    createJsFile(
      "leaked2.js",
      'const env = { VITE_OPENAI_API_KEY: "sk-test-key" };',
    );
    const { leaks } = scanForSecrets();
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.some((l) => l.match.includes("VITE_OPENAI_API_KEY"))).toBe(
      true,
    );
  });

  it("ignores keys with empty values", () => {
    createJsFile(
      "empty.js",
      'const env = { VITE_GEMINI_API_KEY: "" };',
    );
    const { leaks } = scanForSecrets();
    expect(leaks).toHaveLength(0);
  });

  it("ignores undefined values", () => {
    createJsFile(
      "undefined.js",
      "const env = { VITE_GEMINI_API_KEY: undefined };",
    );
    const { leaks } = scanForSecrets();
    expect(leaks).toHaveLength(0);
  });
});
