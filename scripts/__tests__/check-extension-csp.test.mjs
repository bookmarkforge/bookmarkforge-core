/**
 * scripts/__tests__/check-extension-csp.test.mjs
 *
 * Vitest unit tests for `scripts/check-extension-csp.mjs`. Covers the
 * seven guarantees the gate provides:
 *   (a) both manifests canonical CSP → ok on both
 *   (b) MV3 manifest without `content_security_policy` → reported as
 *       missing-CSP failure (reason: "no-csp")
 *   (c) MV2 manifest with a CSP string ≠ canonical → reported as drift
 *       failure (ok: false, actual ≠ canonical)
 *   (d) `node scripts/check-extension-csp.mjs --fix` rewrites both
 *       manifests verbatim AND leaves every other manifest field untouched
 *       (proves the fix is narrowly scoped, not "rewrite the whole file")
 *   (e) manifest containing invalid JSON → reported as `json-parse`
 *       failure (proves the gate does not silently skip malformed input)
 *   (f) `--print` emits exactly the canonical CSP plus one line ending,
 *       with no prefix, suffix, or stderr noise
 *   (g) `--fix` rewrites valid drift but skips malformed JSON and leaves
 *       the malformed manifest byte-for-byte untouched
 *
 * Strategy: every test builds a fresh `mkdtempSync()` directory containing
 * only the `extension/manifest.json` and `extension/manifest-firefox.json`
 * fixtures the gate needs, then chdirs there. Tests (a)–(c) and (e) test
 * `checkManifest()` directly via dynamic import (with `?v=` cache-buster
 * so each chdir'd cwd is observed); test (d) spawns the script via
 * `spawnSync("node", [SCRIPT_PATH], { cwd: tmpDir })` because `--fix`
 * only fires inside `main()`, which is intentionally not exported.
 *
 * `mkdtempSync()` + chdir isolation means the real `extension/manifest*.json`
 * in the repo is never touched; CI failure of one sub-test cannot
 * bleed state into the others.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "check-extension-csp.mjs");

/**
 * Canonical CSP — must match `CANONICAL_CSP` exported by the gate. We
 * hardcode it here instead of importing from the script because we want
 * the test to fail loudly if the canonical string ever changes (rather
 * than silently adapting to whatever the gate currently exports).
 *
 * Note: `style-src 'self'` (no `'unsafe-inline'`) was tightened in this
 * hardening wave — see extension/popup.css + popup.html's `<link>`
 * + popup.js's `hidden` / `.is-open` class toggling.
 */
const CANONICAL_CSP =
  "script-src 'self'; object-src 'none'; connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'; style-src 'self'";

/** Extract CSP for an MV3 manifest — mirrors the one in the script body. */
function extractMv3(manifest) {
  const csp = manifest?.content_security_policy;
  if (csp === undefined || csp === null) return null;
  if (typeof csp === "string") return csp;
  if (typeof csp === "object" && typeof csp.extension_pages === "string") {
    return csp.extension_pages;
  }
  return null;
}

/** Extract CSP for an MV2 manifest — mirrors the one in the script body. */
function extractMv2(manifest) {
  const csp = manifest?.content_security_policy;
  return typeof csp === "string" ? csp : null;
}

/**
 * Build a deliberately non-trivial MV3 manifest. The extra fields
 * (icons, background, action, permissions, host_permissions, version,
 * description) exist so test (d) can prove the --fix injector leaves
 * them intact — if any of these drift, the "preserves other fields"
 * assertion fails.
 */
function buildMv3Manifest(cspExtensionPages) {
  return {
    manifest_version: 3,
    name: "BookmarkForge Clip",
    version: "0.4.0",
    description: "Capture and share bookmarks through a local-first vault.",
    icons: {
      "16": "icon-16.png",
      "48": "icon-48.png",
      "128": "icon-128.png",
    },
    background: { service_worker: "background.js" },
    action: {
      default_popup: "popup.html",
      default_icon: { "128": "icon-128.png" },
    },
    permissions: ["storage", "tabs"],
    host_permissions: ["https://bookmarkforgeapp.com/*"],
    content_security_policy: { extension_pages: cspExtensionPages },
  };
}

/** MV2 counterpart (no `host_permissions`, has `browser_action`). */
function buildMv2Manifest(csp) {
  return {
    manifest_version: 2,
    name: "BookmarkForge Clip",
    version: "0.4.0",
    description: "Capture and share bookmarks through a local-first vault.",
    icons: {
      "16": "icon-16.png",
      "48": "icon-48.png",
      "128": "icon-128.png",
    },
    browser_action: {
      default_popup: "popup.html",
      default_icon: { "128": "icon-128.png" },
    },
    permissions: ["storage", "<all_urls>", "https://bookmarkforgeapp.com/*"],
    content_security_policy: csp,
  };
}

/** Build a tmpdir tree containing only the manifest files listed in `files`. */
function setupFakeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "ext-csp-test-"));
  for (const [relPath, body] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

/**
 * Dynamic import of the gate with a per-test cache-buster. The script
 * captures `MANIFESTS[].path` against `process.cwd()` at module-eval
 * time (when `existsSync(path)` and `readFileSync(path, "utf8")` are
 * called inside `checkManifest()`). Because the script is itself
 * side-effect-free at import time, the cache-buster is mainly here to
 * avoid any vitest module graph pinning errors should a future change
 * hoist reads above the call boundary.
 */
async function importScript(cacheBuster) {
  return import(pathToFileURL(SCRIPT_PATH).href + `?v=${cacheBuster}`);
}

/** Invoke the gate's CLI in a subprocess from a controlled cwd. */
function runGateCli({ cwd, args = [] }) {
  // Pass the script as a plain filesystem path. Node accepts forward
  // and back slashes on Windows; passing `pathToFileURL(SCRIPT_PATH).href`
  // would be treated as the literal module-name "file:///...mjs" by
  // Node's resolver, which fails on Windows because the URL gets
  // joined with cwd as if it were relative.
  const proc = spawnSync("node", [SCRIPT_PATH, ...args], {
    cwd,
    encoding: "utf8",
  });
  return proc;
}

let savedCwd;
let createdTmpDirs = [];

beforeEach(() => {
  savedCwd = process.cwd();
  createdTmpDirs = [];
});

afterEach(() => {
  try {
    process.chdir(savedCwd);
  } catch {
    process.chdir(REPO_ROOT);
  }
  for (const dir of createdTmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

function newFakeRepo(files) {
  const dir = setupFakeRepo(files);
  createdTmpDirs.push(dir);
  process.chdir(dir);
  return dir;
}

describe("check-extension-csp gate — seven contract assertions", () => {
  test("(a) ok with both manifests carrying the canonical CSP", async () => {
    newFakeRepo({
      "extension/manifest.json": JSON.stringify(
        buildMv3Manifest(CANONICAL_CSP),
        null,
        2,
      ) + "\n",
      "extension/manifest-firefox.json": JSON.stringify(
        buildMv2Manifest(CANONICAL_CSP),
        null,
        2,
      ) + "\n",
    });
    const mod = await importScript("a");
    expect(mod.CANONICAL_CSP).toBe(CANONICAL_CSP);

    const mv3 = mod.checkManifest({
      label: "Chrome MV3",
      path: "extension/manifest.json",
      extract: extractMv3,
    });
    expect(mv3.ok).toBe(true);
    expect(mv3.reason).toBeUndefined();
    expect(mv3.actual).toBe(CANONICAL_CSP);

    const mv2 = mod.checkManifest({
      label: "Firefox MV2",
      path: "extension/manifest-firefox.json",
      extract: extractMv2,
    });
    expect(mv2.ok).toBe(true);
    expect(mv2.reason).toBeUndefined();
    expect(mv2.actual).toBe(CANONICAL_CSP);
  });

  test("(b) MV3 manifest missing content_security_policy → 'no-csp' failure on MV3, MV2 still ok", async () => {
    const mv3NoCsp = buildMv3Manifest(CANONICAL_CSP);
    delete mv3NoCsp.content_security_policy;
    newFakeRepo({
      "extension/manifest.json": JSON.stringify(mv3NoCsp, null, 2) + "\n",
      "extension/manifest-firefox.json": JSON.stringify(
        buildMv2Manifest(CANONICAL_CSP),
        null,
        2,
      ) + "\n",
    });
    const mod = await importScript("b");

    const mv3 = mod.checkManifest({
      label: "Chrome MV3",
      path: "extension/manifest.json",
      extract: extractMv3,
    });
    expect(mv3.ok).toBe(false);
    expect(mv3.reason).toBe("no-csp");
    expect(mv3.canonical).toBe(CANONICAL_CSP);

    // MV2 still passes alongside the MV3 failure — proves the gate
    // reports per-manifest, does not collectively short-circuit.
    const mv2 = mod.checkManifest({
      label: "Firefox MV2",
      path: "extension/manifest-firefox.json",
      extract: extractMv2,
    });
    expect(mv2.ok).toBe(true);
  });

  test("(c) MV2 manifest with mismatched CSP string → 'drift' failure with actual vs canonical", async () => {
    const WRONG_CSP = "script-src *; object-src *; connect-src https:";
    newFakeRepo({
      "extension/manifest.json": JSON.stringify(
        buildMv3Manifest(CANONICAL_CSP),
        null,
        2,
      ) + "\n",
      "extension/manifest-firefox.json": JSON.stringify(
        buildMv2Manifest(WRONG_CSP),
        null,
        2,
      ) + "\n",
    });
    const mod = await importScript("c");

    const mv3 = mod.checkManifest({
      label: "Chrome MV3",
      path: "extension/manifest.json",
      extract: extractMv3,
    });
    expect(mv3.ok).toBe(true);

    const mv2 = mod.checkManifest({
      label: "Firefox MV2",
      path: "extension/manifest-firefox.json",
      extract: extractMv2,
    });
    expect(mv2.ok).toBe(false);
    expect(mv2.reason).toBeUndefined(); // drift path doesn't set a reason key
    expect(mv2.actual).toBe(WRONG_CSP);
    expect(mv2.canonical).toBe(CANONICAL_CSP);
    expect(mv2.actual).not.toBe(mv2.canonical);
  });

  test("(d) --fix rewrites CSP verbatim AND preserves every other manifest field", async () => {
    const repo = newFakeRepo({
      "extension/manifest.json": JSON.stringify(
        buildMv3Manifest("script-src 'self'"),
        null,
        2,
      ) + "\n",
      "extension/manifest-firefox.json": JSON.stringify(
        buildMv2Manifest("script-src 'self'"),
        null,
        2,
      ) + "\n",
    });

    // Snapshot the entire pre-fix manifest so any field can be checked
    // for preservation post-fix.
    const beforeMv3 = JSON.parse(
      readFileSync(join(repo, "extension/manifest.json"), "utf8"),
    );
    const beforeMv2 = JSON.parse(
      readFileSync(join(repo, "extension/manifest-firefox.json"), "utf8"),
    );

    const proc = runGateCli({ cwd: repo, args: ["--fix"] });
    // --fix exits 0 because `failures > 0 && !fix` is false (fix=true).
    expect(proc.status, `stdout=${proc.stdout}\nstderr=${proc.stderr}`).toBe(0);
    expect(proc.stdout).toMatch(/--fix rewrote \d+ manifest\(s\)/);

    // CSP is now canonical on both manifests.
    const afterMv3 = JSON.parse(
      readFileSync(join(repo, "extension/manifest.json"), "utf8"),
    );
    expect(afterMv3.content_security_policy).toEqual({
      extension_pages: CANONICAL_CSP,
    });
    expect(afterMv3.content_security_policy).not.toEqual(
      beforeMv3.content_security_policy,
    );

    const afterMv2 = JSON.parse(
      readFileSync(join(repo, "extension/manifest-firefox.json"), "utf8"),
    );
    expect(afterMv2.content_security_policy).toBe(CANONICAL_CSP);
    expect(afterMv2.content_security_policy).not.toBe(
      beforeMv2.content_security_policy,
    );

    // Every OTHER field is preserved verbatim — proves the injector is
    // narrowly scoped (it does not rewrite the whole file).
    expect(afterMv3.manifest_version).toBe(beforeMv3.manifest_version);
    expect(afterMv3.name).toBe(beforeMv3.name);
    expect(afterMv3.version).toBe(beforeMv3.version);
    expect(afterMv3.description).toBe(beforeMv3.description);
    expect(afterMv3.icons).toEqual(beforeMv3.icons);
    expect(afterMv3.background).toEqual(beforeMv3.background);
    expect(afterMv3.action).toEqual(beforeMv3.action);
    expect(afterMv3.permissions).toEqual(beforeMv3.permissions);
    expect(afterMv3.host_permissions).toEqual(beforeMv3.host_permissions);

    expect(afterMv2.manifest_version).toBe(beforeMv2.manifest_version);
    expect(afterMv2.name).toBe(beforeMv2.name);
    expect(afterMv2.version).toBe(beforeMv2.version);
    expect(afterMv2.description).toBe(beforeMv2.description);
    expect(afterMv2.icons).toEqual(beforeMv2.icons);
    expect(afterMv2.browser_action).toEqual(beforeMv2.browser_action);
    expect(afterMv2.permissions).toEqual(beforeMv2.permissions);
  });

  test("(e) JSON parse error on malformed manifest → 'json-parse' failure", async () => {
    newFakeRepo({
      "extension/manifest.json": JSON.stringify(
        buildMv3Manifest(CANONICAL_CSP),
        null,
        2,
      ) + "\n",
      "extension/manifest-firefox.json": "{ this is not valid JSON and never will be",
    });
    const mod = await importScript("e");

    const mv3 = mod.checkManifest({
      label: "Chrome MV3",
      path: "extension/manifest.json",
      extract: extractMv3,
    });
    expect(mv3.ok).toBe(true);

    const mv2 = mod.checkManifest({
      label: "Firefox MV2",
      path: "extension/manifest-firefox.json",
      extract: extractMv2,
    });
    expect(mv2.ok).toBe(false);
    expect(mv2.reason).toBe("json-parse");
    expect(mv2.error).toBeDefined();
    // The error carried through is the JSON.parse SyntaxError; checks
    // for the typical lexical signature without depending on Node version.
    expect(String(mv2.error?.message ?? mv2.error)).toMatch(
      /JSON|JSON.parse|SyntaxError/i,
    );

    // Sanity: the malformed file is still on disk (the gate does NOT
    // attempt to "fix" parse errors — that's out of scope by design).
    expect(existsSync("extension/manifest-firefox.json")).toBe(true);
  });

  test("(f) --print writes exactly the canonical CSP with no prefix or extra whitespace", () => {
    const repo = newFakeRepo({});
    const proc = runGateCli({ cwd: repo, args: ["--print"] });

    expect(proc.status, `stdout=${proc.stdout}\nstderr=${proc.stderr}`).toBe(0);
    expect(proc.stderr).toBe("");
    expect(proc.stdout).toBe(`${CANONICAL_CSP}\n`);
    expect(proc.stdout.trim()).toBe(CANONICAL_CSP);
  });

  test("(g) --fix rewrites valid drift but leaves malformed JSON untouched", () => {
    const malformed = "{ this is not valid JSON and must remain byte-for-byte unchanged";
    const repo = newFakeRepo({
      "extension/manifest.json": JSON.stringify(
        buildMv3Manifest("script-src 'self'"),
        null,
        2,
      ) + "\n",
      "extension/manifest-firefox.json": malformed,
    });
    const malformedPath = join(repo, "extension/manifest-firefox.json");
    const beforeMalformed = readFileSync(malformedPath, "utf8");

    const proc = runGateCli({ cwd: repo, args: ["--fix"] });

    expect(proc.status, `stdout=${proc.stdout}\nstderr=${proc.stderr}`).toBe(0);
    expect(proc.stdout).toMatch(/--fix rewrote 1 manifest\(s\)/);
    expect(proc.stderr).toMatch(/--fix skipped Firefox MV2 — malformed JSON left untouched/);

    const afterMv3 = JSON.parse(
      readFileSync(join(repo, "extension/manifest.json"), "utf8"),
    );
    expect(afterMv3.content_security_policy).toEqual({
      extension_pages: CANONICAL_CSP,
    });
    expect(readFileSync(malformedPath, "utf8")).toBe(beforeMalformed);
  });
});
