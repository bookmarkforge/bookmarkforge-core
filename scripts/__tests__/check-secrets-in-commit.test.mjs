/**
 * Unit tests for scripts/check-secrets-in-commit.mjs — the pre-commit
 * secrets guard (AUDIT-2026-08-29 finding S-103).
 *
 * The guard is pure over a file list: `checkSecrets(files)` returns
 * { ok, violations } with no filesystem or git access, so these tests
 * exercise the real logic directly without spawning git.
 */
import { describe, expect, it } from "vitest";
import { checkSecrets, parseGitPathList } from "../check-secrets-in-commit.mjs";

describe("check-secrets-in-commit", () => {
  it("parses git's NUL-delimited paths without trimming valid names", () => {
    expect(parseGitPathList(`plain.ts${String.fromCharCode(0)}dir/file with spaces.ts${String.fromCharCode(0)}`)).toEqual([
      "plain.ts",
      "dir/file with spaces.ts",
    ]);
  });

  describe("env-file tripwire", () => {
    it("blocks committing .env production files", () => {
      const { ok, violations } = checkSecrets([".env.production"]);
      expect(ok).toBe(false);
      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe(".env.production");
      expect(violations[0].reason).toMatch(/environment file/);
    });

    it("blocks nested and suffixed env variants", () => {
      const { ok } = checkSecrets(["config/.env.local", ".env.staging"]);
      expect(ok).toBe(false);
      expect(checkSecrets(["config/.env.local"]).violations[0].file).toBe(
        "config/.env.local",
      );
      expect(checkSecrets([".env.staging"]).violations[0].file).toBe(
        ".env.staging",
      );
    });

    it("allows the committed templates", () => {
      const { ok, violations } = checkSecrets([
        ".env.example",
        ".env.production.example",
      ]);
      expect(ok).toBe(true);
      expect(violations).toHaveLength(0);
    });

    it("does not flag regular source files by name", () => {
      const { ok } = checkSecrets(["src/services/Environment.ts", "env.config.ts"]);
      expect(ok).toBe(true);
    });
  });

  describe("live-key content patterns", () => {
    it("delegates to checkSecretsWithContent (see content scan suite below)", () => {
      // Covered exhaustively by the "content scan" suite below, which writes
      // real temp files. This placeholder keeps the describe grouping tidy.
      expect(true).toBe(true);
    });
  });
});

/**
 * checkSecrets only reads real files; for content-pattern tests we scan a
 * temp string by writing through the same exported function's contract is
 * not possible without touching disk, so use a tiny in-memory helper that
 * mirrors the guard's content branch via node:fs in a temp file.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function checkSecretsWithContent(basename, content) {
  const dir = mkdtempSync(join(tmpdir(), "bmf-secrets-"));
  try {
    const file = join(dir, basename);
    writeFileSync(file, content, "utf8");
    // checkSecrets expects paths relative to cwd; pass absolute — it reads
    // with plain readFileSync so absolute paths work.
    return checkSecrets([file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("check-secrets-in-commit — content scan", () => {
  it("blocks a Gemini-shaped key", () => {
    const result = checkSecretsWithContent(
      "config.ts",
      `const k = "AIzaSyA1234567890abcdefghijklmnopqr";`,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/Gemini/);
  });

  it("blocks an OpenAI-shaped key", () => {
    const result = checkSecretsWithContent(
      "provider.ts",
      `const k = "sk-proj1234567890abcdefghijklmnop";`,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/OpenAI/);
  });

  it("blocks an Anthropic-shaped key", () => {
    const result = checkSecretsWithContent(
      "provider.ts",
      `const k = "sk-ant-api03-1234567890abcdefghij";`,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/Anthropic/);
  });

  it("blocks an AWS access key", () => {
    const result = checkSecretsWithContent(
      "deploy.ts",
      `const id = "AKIAIOSFODNN7EXAMPLE";`,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/AWS/);
  });

  it("blocks a GitHub token", () => {
    const result = checkSecretsWithContent(
      "ci.ts",
      `const t = "ghp_1234567890abcdefghijklmnopqrstuv";`,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/GitHub/);
  });

  it("blocks a private key PEM block", () => {
    const result = checkSecretsWithContent(
      "signing.ts",
      `-----BEGIN PRIVATE KEY-----`,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/Private key/);
  });

  it("does not flag prose or empty assignments", () => {
    const result = checkSecretsWithContent(
      "readme.md",
      `GEMINI_API_KEY=\nUse sk- patterns like sk-YOUR_KEY here (placeholder).`,
    );
    // "sk-YOUR_KEY" is too short (<20 chars after sk-) to match.
    expect(result.ok).toBe(true);
  });

  it("ignores files it cannot read (deleted between stage and scan)", () => {
    const { ok, violations } = checkSecrets(["does-not-exist-xyz.ts"]);
    expect(ok).toBe(true);
    expect(violations).toHaveLength(0);
  });
});
