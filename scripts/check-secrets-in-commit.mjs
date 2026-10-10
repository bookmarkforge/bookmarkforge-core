#!/usr/bin/env node
/**
 * scripts/check-secrets-in-commit.mjs — pre-commit guard for secrets.
 *
 * Blocks committing files that look like environment/secret files, plus a
 * targeted content scan for common provider-key patterns. Complements
 * `.gitignore` (which already excludes `.env*`): gitignore is passive and
 * it does nothing for files that were force-added or renamed, and it
 * cannot catch a real key pasted into a source file. This guard is the
 * active tripwire.
 *
 * Motivation (AUDIT-2026-08-29.md finding S-103): a real `.env.production`
 * containing live provider keys was found sitting in the working tree.
 * Gitignored or not, one `git add -f` away from leaking. This gate makes
 * that mistake loud at the exact moment it would happen.
 *
 * Failure policy — hard exit 1:
 *   - Any staged file whose basename matches an env-file pattern
 *     (`.env`, `.env.local`, `.env.production`, …) other than the two
 *     committed templates (`.env.example`, `.env.production.example`).
 *   - Any staged file whose content matches a live provider-key pattern
 *     (Gemini `AIza…`, AWS `AKIA…`, GitHub `gh[pousr]_…`, Slack `xox…`,
 *     OpenAI `sk-…`, Anthropic `sk-ant-…`, Whop/Bearer `sk_live_…`,
 *     private key PEM blocks).
 *
 * Bypass (intentionally allowed, audited): `git commit --no-verify`.
 *
 * Usage:
 *   node scripts/check-secrets-in-commit.mjs            # gate (exit 1 on hits)
 *   node scripts/check-secrets-in-commit.mjs <files...> # scan explicit files
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// ── Patterns ─────────────────────────────────────────────────────────

/** Committed templates that are safe to be in the repo. */
const ALLOWED_ENV_BASENAMES = new Set([".env.example", ".env.production.example"]);

/** Filenames that should never be committed (gitignore-adjacent tripwire). */
const ENV_FILE_RE = /^\.env(\..+)?$/i;

/**
 * Live-key content patterns. Deliberately narrow: each pattern targets a
 * vendor-specific token shape with enough entropy that a false positive
 * would be an actual key, not prose. Tested against:
 *   - Gemini:     AIza[0-9A-Za-z_-]{30,}
 *   - OpenAI:     sk-[A-Za-z0-9]{20,}
 *   - Anthropic:  sk-ant-[A-Za-z0-9-]{20,}
 *   - AWS:        AKIA[0-9A-Z]{16}
 *   - GitHub:     gh[pousr]_[A-Za-z0-9]{30,}
 *   - Slack:      xox[baprs]-[A-Za-z0-9-]{10,}
 *   - Whop:       sk_live_[A-Za-z0-9]{15,}
 *   - Generic:    PRIVATE KEY PEM block header
 */
const KEY_PATTERNS = [
  { name: "Gemini", re: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: "OpenAI", re: /sk-[A-Za-z0-9]{20,}/ },
  { name: "Anthropic", re: /sk-ant-[A-Za-z0-9-]{20,}/ },
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "Whop live key", re: /sk_live_[A-Za-z0-9]{15,}/ },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
];

// ── Helpers ──────────────────────────────────────────────────────────

/** Parse the NUL-delimited path output produced by git. */
export function parseGitPathList(output) {
  return output.split(String.fromCharCode(0)).filter(Boolean);
}

/** Basenames of files staged for the current commit (staged-new or modified). */
export function stagedFiles() {
  if (!existsSync(".git")) {
    throw new Error(".git unavailable; refusing to scan an unknown staged set");
  }
  try {
    const out = execFileSync(
      "git",
      [
        "-c",
        `safe.directory=${process.cwd()}`,
        "diff-index",
        "--cached",
        "--name-only",
        "--diff-filter=ACMR",
        "-z",
        "HEAD",
        "--",
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    return parseGitPathList(out);
  } catch (error) {
    throw new Error(
      `could not enumerate staged files; refusing to scan an unknown set (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
}

/** Read a file, returning null when unreadable (deleted/renamed). */
function readSafe(file) {
  try {
    return readFileSyncUtf8(file);
  } catch {
    return null;
  }
}

function readFileSyncUtf8(file) {
  return readFileSync(file, "utf8");
}

// ── Checks ───────────────────────────────────────────────────────────

export function checkSecrets(files) {
  const violations = [];

  for (const rel of files) {
    const base = rel.split(/[\\/]/).pop() ?? rel;

    // 1. Env-file tripwire (unless explicitly allowed template).
    if (ENV_FILE_RE.test(base) && !ALLOWED_ENV_BASENAMES.has(base)) {
      violations.push({
        file: rel,
        reason: `environment file '${base}' must not be committed (gitignored; use .env.example / .env.production.example templates)`,
      });
      continue;
    }

    // 2. Live-key content patterns.
    const content = readSafe(rel);
    if (content === null) continue; // deleted between staging and now
    for (const { name, re } of KEY_PATTERNS) {
      if (re.test(content)) {
        violations.push({ file: rel, reason: `content matches a live ${name} credential pattern` });
        break; // one hit per file is enough
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

// ── Main ─────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  let files;
  try {
    files = process.argv.slice(2).length > 0
      ? process.argv.slice(2)
      : stagedFiles();
  } catch (error) {
    console.error(`[check-secrets] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const { ok, violations } = checkSecrets(files);
  if (!ok) {
    console.error("\n[check-secrets] FAIL — refusing to commit:\n");
    for (const v of violations) {
      console.error(`  ${v.file}`);
      console.error(`    → ${v.reason}\n`);
    }
    console.error(
      "  How to fix:\n" +
        "   - Move real keys into a secret manager (or .env.production, gitignored).\n" +
        "   - Templates live in .env.example / .env.production.example (committed, empty).\n" +
        "   - If this is a FALSE POSITIVE, verify and bypass with: git commit --no-verify\n" +
        "     (bypasses are audited: note why in the commit body).\n",
    );
    process.exit(1);
  }
  console.log(`[check-secrets] ${files.length} staged files scanned — no secrets detected`);
  process.exit(0);
}
