// @vitest-environment node
/**
 * scripts/__tests__/build-landings-sync.test.mjs
 *
 * Contract test for build-landings' artifact sync: the versioned copy of
 * templates/landing/language-links.json is an OUTPUT of the write path —
 * when it is missing or stale the build regenerates it, and when it already
 * matches the derivation the build must be a no-op.
 *
 * Why a contract test, and why here: the artifact used to be a silent INPUT
 * (read-if-exists with an `[]` fallback), so a clean clone rendered all 31
 * pages with an EMPTY language switcher and exited 0 — the same
 * silent-degradation shape that let the pre-30-locale builder ship 7 pages
 * without complaint. The sync inverted that into a loud output, and this file
 * pins the behaviour so a refactor cannot quietly drop it again:
 *
 *   - missing  → created (the clean-clone case);
 *   - stale    → regenerated (the drifted-copy case);
 *   - in sync  → strict no-op: no rewrite (mtime unchanged to nanosecond
 *     resolution), no byte change, no log line;
 *   - the no-op is EOL-safe: a `autocrlf` checkout materializes the artifact
 *     as CRLF and must NOT count as drift (that bug would have made every
 *     Windows build "regenerate" the file while changing nothing).
 *
 * Every test drives syncLanguageLinksFile against a temp file (the parameter
 * is injectable exactly for this) — the real repo artifact is never touched.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { syncLanguageLinksFile } = require("../build-landings.cjs");
const { buildLanguageLinks } = require("../generate-language-links.cjs");

// The whole point of the sync is the full locale set; pin its size so a
// locale addition/removal has to walk past this contract consciously.
const LINKS = buildLanguageLinks();
if (LINKS.length !== 30) {
  throw new Error(
    `expected the 30-locale derivation, found ${LINKS.length} — update this contract when the locale set changes`,
  );
}

let tmpRoot;

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  }
});

function makeTarget() {
  tmpRoot = mkdtempSync(join(tmpdir(), "build-landings-sync-"));
  return join(tmpRoot, "language-links.json");
}

/** Capture console.log so the Created/Regenerated/no-op contract is asserted,
 * not just the file bytes. */
function captureLog(fn) {
  const orig = console.log;
  let logged = "";
  console.log = (...args) => {
    logged += args.join(" ");
  };
  try {
    return [fn(), logged];
  } finally {
    console.log = orig;
  }
}

describe("build-landings: language-links.json sync contract", () => {
  it("creates the artifact when it is missing (clean clone)", () => {
    const file = makeTarget();
    expect(existsSync(file)).toBe(false);

    const [, logged] = captureLog(() => syncLanguageLinksFile(file));

    expect(existsSync(file)).toBe(true);
    expect(logged).toContain("Created templates/landing/language-links.json (30 locales)");
    // The full derivation, not a partial copy: JSON round-trip equality.
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual(LINKS);
  });

  it("regenerates a stale artifact and preserves its CRLF line endings", () => {
    const file = makeTarget();
    // Stale = a 2-locale copy in the artifact's own shape (JSON.stringify,
    // no trailing newline), with the CRLF endings an autocrlf checkout
    // materializes when the checked-in blob is LF.
    const stale = JSON.stringify(LINKS.slice(0, 2), null, 2).replace(/\n/g, "\r\n");
    writeFileSync(file, stale, "utf-8");

    const [, logged] = captureLog(() => syncLanguageLinksFile(file));

    expect(logged).toContain("Regenerated templates/landing/language-links.json (30 locales)");
    const now = readFileSync(file, "utf-8");
    expect(JSON.parse(now)).toEqual(LINKS);
    // The rewrite kept the file's existing EOL: byte diff stays minimal and
    // the next build is a no-op (see the EOL test below).
    expect(now).toBe(JSON.stringify(LINKS, null, 2).replace(/\n/g, "\r\n"));
  });

  it("is a strict no-op when the artifact already matches (LF)", () => {
    const file = makeTarget();
    // Byte-exact form of the checked-in artifact: JSON.stringify, LF, and
    // deliberately NO trailing newline.
    const fresh = JSON.stringify(LINKS, null, 2);
    writeFileSync(file, fresh, "utf-8");
    const before = fs_stat(file);

    const [, logged] = captureLog(() => syncLanguageLinksFile(file));

    expect(logged).toBe("");
    expect(fs_stat(file)).toBe(before);
    expect(readFileSync(file, "utf-8")).toBe(fresh);
  });

  it("does not treat an autocrlf (CRLF) checkout as drift", () => {
    const file = makeTarget();
    const freshCrlf = JSON.stringify(LINKS, null, 2).replace(/\n/g, "\r\n");
    writeFileSync(file, freshCrlf, "utf-8");
    const before = fs_stat(file);

    const [, logged] = captureLog(() => syncLanguageLinksFile(file));

    // The regression this pins: comparing bytes made every CRLF checkout
    // report "Regenerated" on every build while writing identical content.
    expect(logged).toBe("");
    expect(fs_stat(file)).toBe(before);
    expect(readFileSync(file, "utf-8")).toBe(freshCrlf);
  });
});

/** Nanosecond mtime as a string — a rewrite always moves it, so "unchanged"
 * proves no write happened even below filesystem timestamp granularity. */
function fs_stat(file) {
  return require("node:fs").statSync(file, { bigint: true }).mtimeNs.toString();
}
