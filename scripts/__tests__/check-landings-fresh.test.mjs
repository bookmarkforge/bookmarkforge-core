// @vitest-environment node
/**
 * scripts/__tests__/check-landings-fresh.test.mjs
 *
 * Adversarial suite for the landings-freshness gate (ADR-051). The gate
 * renders the real templates/translations in memory (via build-landings'
 * renderAll) and diffs against the committed public/ files. Tests pin:
 *
 *   - a tree matching the render passes, with the full 31-page contract
 *     (30 locale landings + pocket-alternative; the locale expansion added
 *     24 of them, so a stale count here is a stale contract, not a bug);
 *   - a one-line hand edit fails naming the file and the diff line;
 *   - a missing generated page fails (coverage never shrinks silently);
 *   - orphan detection (generator output names the build no longer produces)
 *     while declared static files (404.html) stay exempt;
 *   - non-generated pages in public/ are ignored;
 *   - CRLF checkouts pass (EOL-normalized comparison);
 *   - the gate is read-only: the checked directory is byte-unchanged.
 *
 * Hermeticity: the render always uses the repo's real templates/translations
 * (that is the point — it is the same render CI would do), but the COMPARISON
 * directory is a temp copy, so no test touches the working public/.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createRequire } from "node:module";
import { checkLandingsFresh } from "../check-landings-fresh.mjs";

const require = createRequire(import.meta.url);
const builder = require(join(process.cwd(), "scripts", "build-landings.cjs"));

let tmpRoot;

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  }
});

/** Fresh render of the repo's real sources (what CI would produce). */
const RENDER = builder.renderAll();
const PAGE_NAMES = RENDER.map((r) => basename(r.path)).sort();

/** Seed a temp public/ with the fresh render, or explicit overrides. */
function makePublicDir(overrides = {}, { includeRender = true } = {}) {
  tmpRoot = mkdtempSync(join(tmpdir(), "landings-fresh-"));
  const pub = join(tmpRoot, "public");
  mkdirSync(pub, { recursive: true });
  if (includeRender) {
    for (const { path, html } of RENDER) {
      writeFileSync(join(pub, basename(path)), html);
    }
  }
  for (const [name, content] of Object.entries(overrides)) {
    const p = join(pub, name);
    mkdirSync(join(p, ".."), { recursive: true });
    if (content === null) rmSync(p, { force: true });
    else writeFileSync(p, content);
  }
  return pub;
}

describe("check-landings-fresh: contract", () => {
  it("passes on a fresh tree and checks the full 31-page contract", () => {
    const pub = makePublicDir();
    const r = checkLandingsFresh({ publicDir: pub });
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(31);
    // The generator's complete output, pinned: a page that disappears (or a
    // locale that joins) must show up as a diff here instead of silently
    // shrinking what check:landings-fresh covers.
    expect(PAGE_NAMES).toEqual([
      "ar.html", "bg.html", "cs.html", "da.html", "de.html", "el.html",
      "es.html", "fi.html", "fr.html", "he.html", "hi.html", "hr.html",
      "hu.html", "id.html", "it.html", "ja.html", "ko.html", "landing.html",
      "nl.html", "no.html", "pl.html", "pocket-alternative.html", "pt.html",
      "ro.html", "ru.html", "sv.html", "th.html", "tr.html", "uk.html",
      "vi.html", "zh.html",
    ]);
  });

  it("ignores pages the generator does not own", () => {
    const pub = makePublicDir({
      "privacy-and-terms.html": "<p>hand-maintained</p>\n",
      "404.html": "<p>declared static until the TODO lands</p>\n",
      "index.html": "<p>not a generator output</p>\n",
    });
    expect(checkLandingsFresh({ publicDir: pub }).failures).toEqual([]);
  });

  it("is read-only: the checked directory is byte-unchanged", () => {
    const pub = makePublicDir();
    const before = Object.fromEntries(
      PAGE_NAMES.map((n) => [n, readFileSync(join(pub, n)).toString("base64")]),
    );
    checkLandingsFresh({ publicDir: pub });
    for (const [name, b64] of Object.entries(before)) {
      expect(readFileSync(join(pub, name)).toString("base64")).toBe(b64);
    }
  });
});

describe("check-landings-fresh: drift, missing, orphans", () => {
  it("fails on a one-line hand edit naming the file and the diff line", () => {
    const pub = makePublicDir();
    const p = join(pub, "pocket-alternative.html");
    const drifted = readFileSync(p, "utf8")
      .replace("Smart search is included free", "Smart search is included at no extra cost");
    expect(drifted).not.toEqual(readFileSync(p, "utf8")); // the edit must bite
    writeFileSync(p, drifted);
    const r = checkLandingsFresh({ publicDir: pub });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].file).toBe("public/pocket-alternative.html");
    expect(r.failures[0].reason).toMatch(/^stale: .* line \d+ \(fix: npm run build:landings\)$/);
  });

  it("fails when a generated page is missing from the tree", () => {
    const pub = makePublicDir({ "landing.html": null });
    const r = checkLandingsFresh({ publicDir: pub });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].file).toBe("public/landing.html");
    expect(r.failures[0].reason).toMatch(/^missing: /);
  });

  it("flags orphan files matching generator output names, but not 404", () => {
    const pub = makePublicDir({
      "pocket-alternative-fr.html": "<p>stale orphan</p>\n",
      "404-fr.html": "<p>declared static</p>\n",
    });
    const r = checkLandingsFresh({ publicDir: pub });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].file).toBe("public/pocket-alternative-fr.html");
    expect(r.failures[0].reason).toMatch(/^stale: matches a generator output name/);
    expect(existsSync(join(pub, "404-fr.html"))).toBe(true);
  });

  it("reports every drifted page, not just the first", () => {
    const pub = makePublicDir();
    for (const name of ["es.html", "de.html", "pt.html"]) {
      const p = join(pub, name);
      writeFileSync(p, readFileSync(p, "utf8").replace(/\n/, "\n<!-- drifted -->\n"));
    }
    const r = checkLandingsFresh({ publicDir: pub });
    expect(r.failures).toHaveLength(3);
  });
});

describe("check-landings-fresh: checkout realities", () => {
  it("passes with CRLF line endings (git autocrlf checkouts)", () => {
    const pub = makePublicDir();
    const p = join(pub, "fr.html");
    writeFileSync(p, readFileSync(p, "utf8").replace(/\n/g, "\r\n"));
    expect(checkLandingsFresh({ publicDir: pub }).failures).toEqual([]);
  });

  it("passes with lone CR line endings (classic Mac / misconfigured editor)", () => {
    const pub = makePublicDir();
    const p = join(pub, "fr.html");
    // Strip ALL CRs first so we end up with pure LF, then convert LF→CR.
    // This avoids the double-CR artifact when the builder already emits CRLF
    // on Windows (the builder writes templates through Nunjucks which may
    // produce CRLF depending on the OS and template line endings).
    const lf = readFileSync(p, "utf8").replace(/\r/g, "");
    writeFileSync(p, lf.replace(/\n/g, "\r"));
    expect(checkLandingsFresh({ publicDir: pub }).failures).toEqual([]);
  });

  it("passes when git autocrlf produces double-CR before LF (regression: extra \r left by old normalizeEol)", () => {
    // Simulates the exact Windows scenario that broke the gate:
    // 1. git autocrlf converts LF→CRLF (file now has \r\n)
    // 2. a test or tool does replace(/\n/g, "\r\n") on the CRLF content
    // 3. result contains \r\r\n (extra \r before each existing \r\n)
    const pub = makePublicDir();
    const p = join(pub, "fr.html");
    const alreadyCrlf = readFileSync(p, "utf8").replace(/\n/g, "\r\n");
    const doubleCr = alreadyCrlf.replace(/\n/g, "\r\n");
    // Verify the double-CR is actually present (the regression的前提条件)
    expect(doubleCr).toContain("\r\r\n");
    writeFileSync(p, doubleCr);
    expect(checkLandingsFresh({ publicDir: pub }).failures).toEqual([]);
  });

  it("still detects a real content change inside a CRLF file", () => {
    const pub = makePublicDir();
    const p = join(pub, "fr.html");
    const crlf = readFileSync(p, "utf8").replace(/\n/g, "\r\n")
      .replace("BookmarkForge", "BookmarkForgee");
    expect(crlf).not.toContain("BookmarkForge\r\nBookmarkForgee");
    writeFileSync(p, crlf.replace("BookmarkForgee", "BookmarkForgeX"));
    const r = checkLandingsFresh({ publicDir: pub });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].file).toBe("public/fr.html");
  });

  it("still detects a real content change inside a double-CR file", () => {
    const pub = makePublicDir();
    const p = join(pub, "fr.html");
    const alreadyCrlf = readFileSync(p, "utf8").replace(/\n/g, "\r\n");
    const doubleCr = alreadyCrlf.replace(/\n/g, "\r\n")
      .replace("BookmarkForge", "BookmarkForgeX");
    writeFileSync(p, doubleCr);
    const r = checkLandingsFresh({ publicDir: pub });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].file).toBe("public/fr.html");
    expect(r.failures[0].reason).toMatch(/^stale: /);
  });
});
