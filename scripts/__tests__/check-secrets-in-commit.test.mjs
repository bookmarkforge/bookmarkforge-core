/**
 * Unit tests for scripts/check-secrets-in-commit.mjs — the pre-commit
 * secrets guard (AUDIT-2026-08-29 finding S-103).
 *
 * The guard is pure over a file list: `checkSecrets(files)` returns
 * { ok, violations } with no filesystem or git access, so these tests
 * exercise the real logic directly without spawning git.
 */
import { describe, expect, it } from "vitest";
import {
  checkSecrets,
  isScannableFile,
  parseGitPathList,
  parseScanRequest,
  requireNonEmpty,
  stagedFiles,
  staleFixtureExemptions,
  SYNTHETIC_FIXTURE_FILES,
  treeFiles,
} from "../check-secrets-in-commit.mjs";

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
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
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

/**
 * Whole-tree scope. The staged-only scan was blind to the leak class that
 * motivated this widening: a live key pasted into an UNTRACKED file, and — in
 * CI, where a clean checkout has nothing staged — to the whole tree, reporting
 * success for an empty scan.
 *
 * The helpers below run against throwaway git checkouts, so the new scope is
 * exercised without touching this repository.
 */
function withTempGitRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), "bmf-secrets-repo-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

/** Commit everything so `HEAD` exists (staged mode diffs the index against it). */
function commitAll(dir) {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=secrets-guard@example.com",
      "-c",
      "user.name=secrets-guard",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "-m",
      "init",
    ],
    { cwd: dir },
  );
}

describe("check-secrets-in-commit — whole-tree scope", () => {
  it("skips build output, lockfiles and binaries but keeps source and docs", () => {
    for (const skipped of [
      "node_modules/pkg/package.json",
      "dist/assets/app.js",
      "dist-extension/manifest.json",
      "coverage/lcov.info",
      "test-results-3/trace.zip",
      "playwright-report/index.html",
      ".d/tmp/pro-dts/tsconfig.tsbuildinfo",
      "package-lock.json",
      "tsconfig.tsbuildinfo",
      "public/logo.png",
      "public/fonts/inter.woff2",
      "docs/manual.pdf",
    ]) {
      expect(isScannableFile(skipped)).toBe(false);
    }
    for (const kept of [
      "src/services/AffiliateService.ts",
      "docs/GITHUB-SECRETS.md",
      "scripts/check-secrets-in-commit.mjs",
      "public/favicon.svg",
    ]) {
      expect(isScannableFile(kept)).toBe(true);
    }
  });

  it("enumerates this repository's tree, deduplicated and sorted", () => {
    const files = treeFiles();
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("package.json");
    expect(files).toContain("scripts/check-secrets-in-commit.mjs");
    expect([...files].sort()).toEqual(files);
    expect(new Set(files).size).toBe(files.length);
    expect(files.every((rel) => isScannableFile(rel))).toBe(true);
    expect(files.some((rel) => rel.startsWith("node_modules/") || rel.startsWith("dist/"))).toBe(
      false,
    );
  });

  it("finds a key in an UNTRACKED file, the leak the staged scan never saw", () => {
    withTempGitRepo((dir) => {
      writeFileSync(join(dir, "README.md"), "# notes\n", "utf8");
      commitAll(dir);
      const key = `apik_${"C".repeat(48)}`;
      writeFileSync(join(dir, "DEPLOY-NOTES.md"), `step 1\nkey: ${key}\nstep 2\n`, "utf8");

      expect(stagedFiles({ cwd: dir })).not.toContain("DEPLOY-NOTES.md");
      const files = treeFiles({ cwd: dir });
      expect(files).toContain("DEPLOY-NOTES.md");

      const { ok, violations } = checkSecrets(files.map((rel) => join(dir, rel)));
      expect(ok).toBe(false);
      expect(violations[0].reason).toMatch(/Whop API key/);
      expect(violations[0].line).toBe(2);
    });
  });

  it("leaves gitignored env files to the staged mode", () => {
    withTempGitRepo((dir) => {
      writeFileSync(join(dir, ".gitignore"), ".env*\n", "utf8");
      writeFileSync(
        join(dir, ".env.production"),
        `WHOP_API_KEY=apik_${"E".repeat(48)}\n`,
        "utf8",
      );
      expect(treeFiles({ cwd: dir })).not.toContain(".env.production");
    });
  });

  it("staged mode and tree mode see different sets", () => {
    withTempGitRepo((dir) => {
      writeFileSync(join(dir, "kept.ts"), "export const a = 1;\n", "utf8");
      commitAll(dir);
      writeFileSync(join(dir, "staged.ts"), "export const b = 2;\n", "utf8");
      writeFileSync(join(dir, "untracked.ts"), "export const c = 3;\n", "utf8");
      execFileSync("git", ["add", "staged.ts"], { cwd: dir });

      const staged = stagedFiles({ cwd: dir });
      expect(staged).toContain("staged.ts");
      expect(staged).not.toContain("untracked.ts");

      const tree = treeFiles({ cwd: dir });
      expect(tree).toContain("untracked.ts");
      expect(tree).toContain("kept.ts");
    });
  });
});

describe("check-secrets-in-commit — redaction, patterns and fail-closed paths", () => {
  it("never puts the matched value in a finding", () => {
    const key = `apik_${"D".repeat(48)}`;
    const result = checkSecretsWithContent(
      "NOTES.md",
      `line one\nline two\nkey = ${key}\ntail\n`,
    );
    expect(result.ok).toBe(false);
    const finding = result.violations[0];
    expect(finding.line).toBe(3);
    expect(Object.keys(finding).every((k) => ["file", "line", "reason"].includes(k))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(result)).not.toContain("D".repeat(48));
  });

  it("blocks a Whop apik_ dashboard key", () => {
    const result = checkSecretsWithContent(
      "deploy.md",
      "WHOP_API_KEY=apik_GoXfL7exjyWNl_C6995495_C_2a660c07c2bc73cf152330824f4bf3fba5a15a5e92423e3414ac9314190fe8",
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/Whop API key/);
  });

  it("does not flag a short apik_ placeholder", () => {
    expect(checkSecretsWithContent("readme.md", "set apik_YOUR_KEY in the dashboard").ok).toBe(
      true,
    );
  });

  it("refuses to scan a directory that is not a git checkout", () => {
    const dir = mkdtempSync(join(tmpdir(), "bmf-no-git-"));
    try {
      expect(() => treeFiles({ cwd: dir })).toThrow(/refusing to scan an unknown tree/);
      expect(() => stagedFiles({ cwd: dir })).toThrow(/refusing to scan an unknown staged set/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when git cannot enumerate", () => {
    const dir = mkdtempSync(join(tmpdir(), "bmf-git-broken-"));
    try {
      mkdirSync(join(dir, ".git"));
      const brokenGit = () => {
        throw new Error("git missing");
      };
      expect(() => treeFiles({ cwd: dir, exec: brokenGit })).toThrow(/could not enumerate/);
      expect(() => stagedFiles({ cwd: dir, exec: brokenGit })).toThrow(
        /could not enumerate staged files/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to report success for an empty scan", () => {
    expect(() => requireNonEmpty([], "tree")).toThrow(/0 files/);
    expect(requireNonEmpty(["a.ts"], "tree")).toEqual(["a.ts"]);
  });

  it("rejects unknown or contradictory flags instead of silently rescoping", () => {
    expect(() => parseScanRequest(["--staged-only"])).toThrow(/unknown flag/);
    expect(() => parseScanRequest(["--tree", "--staged"])).toThrow(/mutually exclusive/);
    expect(() => parseScanRequest(["--staged", "a.ts"])).toThrow(/cannot be combined/);
    expect(parseScanRequest(["a.ts", "b.ts"])).toEqual({
      mode: "explicit",
      files: ["a.ts", "b.ts"],
    });
  });

  it("exempts only the reviewed synthetic fixtures, each with a reason", () => {
    expect(SYNTHETIC_FIXTURE_FILES.size).toBe(6);
    for (const [rel, reason] of SYNTHETIC_FIXTURE_FILES) {
      expect(isScannableFile(rel)).toBe(true);
      expect(reason.trim().length).toBeGreaterThan(20);
    }
    expect(staleFixtureExemptions()).toEqual([]);
    expect(staleFixtureExemptions(["does/not/exist.ts"])).toEqual(["does/not/exist.ts"]);
  });

  it("counts an exempt fixture instead of scanning it", () => {
    const { ok, stats } = checkSecrets(["src/tests/utils/logger.test.ts"]);
    expect(ok).toBe(true);
    expect(stats.exempt).toBe(1);
    expect(stats.scanned).toBe(0);
  });
});
