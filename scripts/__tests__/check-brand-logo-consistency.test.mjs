/**
 * scripts/__tests__/check-brand-logo-consistency.test.mjs
 *
 * Vitest unit tests for `scripts/check-brand-logo-consistency.mjs`. Covers
 * the guarantees the gate provides:
 *   (a) a fixture tree whose icons are all the canonical artwork → ok
 *   (b) an icon PNG that deviates from the canonical artwork → failure
 *       ("deviates from the canonical logo artwork")
 *   (c) an icon referenced by a manifest/HTML but missing on disk →
 *       "referenced icon missing"
 *   (d) a non-square icon → "expected square icon"
 *   (e) a garbage .png that cannot be decoded → "cannot be decoded as a PNG"
 *   (f) a missing canonical logo-512.png → "canonical artwork unavailable"
 *   (g) inline brand-SVG placeholders (all three patterns) are flagged with
 *       line numbers; the gate's own source file never self-matches
 *   (h) the og-image-style SVG with an embedded canonical PNG passes; with
 *       a different embedded PNG it fails
 *   (i) CLI: exit 0 on a healthy fixture tree, exit 1 with FAIL lines on a
 *       broken one (via BRAND_LOGO_CONSISTENCY_ROOT — no chdir races)
 *
 * Every test builds a fresh `mkdtempSync()` fixture tree containing only
 * the assets the gate needs; the real repo assets are never modified.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { deflateSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodePngToRgba,
  boxResample,
  meanDiff,
  loadCanonicalReference,
  collectGuardedPngAssets,
  scanForInlineBrandSvgs,
  evaluateBrandConsistency,
  evaluateCardCopySync,
  copyTokens,
  normalizeCopy,
  extractSvgTextRuns,
  extractSectionText,
  BRAND_SLOGAN,
  THRESHOLD,
} from "../check-brand-logo-consistency.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "check-brand-logo-consistency.mjs");
const CANONICAL_SOURCE = join(REPO_ROOT, "public", "icons", "logo-512.png");

// ---------------------------------------------------------------------------
// Minimal PNG encoder (color type 6, 8-bit, filter 0) for fixtures
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode raw RGBA into a valid PNG buffer. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function solidRgba(width, height, [r, g, b, a]) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Fixture-tree builders
// ---------------------------------------------------------------------------

let fixtureRoot;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "brand-logo-gate-"));
  mkdirSync(join(fixtureRoot, "public", "icons"), { recursive: true });
  mkdirSync(join(fixtureRoot, "extension"), { recursive: true });
  copyFileSync(CANONICAL_SOURCE, join(fixtureRoot, "public", "icons", "logo-512.png"));
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Healthy fixture: every referenced icon is a copy of the canonical artwork. */
function writeHealthyFixture() {
  writeFileSync(
    join(fixtureRoot, "public", "manifest.json"),
    JSON.stringify({
      icons: { 192: "/icons/logo-192.png", 512: "/icons/logo-512.png" },
      shortcuts: [{ name: "S", url: "/x", icons: [{ src: "/icons/logo-192.png", sizes: "192x192" } ] }],
    }),
  );
  copyFileSync(CANONICAL_SOURCE, join(fixtureRoot, "public", "icons", "logo-192.png"));
  writeFileSync(join(fixtureRoot, "extension", "manifest.json"), JSON.stringify({ icons: { 128: "icon-128.png" } }));
  copyFileSync(CANONICAL_SOURCE, join(fixtureRoot, "extension", "icon-128.png"));
  writeFileSync(
    join(fixtureRoot, "index.html"),
    '<html><head><link rel="icon" type="image/png" href="/favicon.png"></head></html>',
  );
  copyFileSync(CANONICAL_SOURCE, join(fixtureRoot, "public", "favicon.png"));
}

// ---------------------------------------------------------------------------

describe("pure helpers", () => {
  test("decodePngToRgba round-trips a solid-color PNG", () => {
    const png = encodePng(4, 3, solidRgba(4, 3, [10, 200, 30, 255]));
    const { width, height, rgba } = decodePngToRgba(png);
    expect(width).toBe(4);
    expect(height).toBe(3);
    expect(rgba[0]).toBe(10);
    expect(rgba[1]).toBe(200);
    expect(rgba[2]).toBe(30);
    expect(rgba[3]).toBe(255);
  });

  test("decodePngToRgba rejects garbage input", () => {
    expect(() => decodePngToRgba(Buffer.from("not a png at all"))).toThrow(/not a PNG/);
  });

  test("meanDiff is 0 for identical buffers and large for different ones", () => {
    const a = solidRgba(2, 2, [0, 0, 0, 255]);
    const b = solidRgba(2, 2, [200, 100, 50, 255]);
    expect(meanDiff(a, a)).toBe(0);
    expect(meanDiff(a, b)).toBeCloseTo((200 + 100 + 50 + 0) / 4, 5);
  });

  test("boxResample downscales and preserves alpha-weighted color", () => {
    const big = { width: 2, height: 2, rgba: solidRgba(2, 2, [0, 0, 255, 255]) };
    const out = boxResample(big, 1);
    expect([...out]).toEqual([0, 0, 255, 255]);
  });
});

describe("inline brand-SVG scanner", () => {
  test("flags the placeholder 128-canvas with a line number", () => {
    const hits = scanForInlineBrandSvgs('<div>\n  <svg viewBox="0 0 128 128"></svg>\n</div>');
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe("canvas-128");
    expect(hits[0].line).toBe(2);
  });

  test("flags the placeholder trapezoid path", () => {
    const hits = scanForInlineBrandSvgs('<path d="M28 40h72l-10 48H38L28 40Z"/>');
    expect(hits.map((h) => h.id)).toContain("placeholder-path");
  });

  test("flags the brand-tile rect regardless of attribute order", () => {
    const a = scanForInlineBrandSvgs('<rect width="128" fill="#0f1c2e"/>');
    const b = scanForInlineBrandSvgs('<rect fill="#0f1c2e" width="128"/>');
    expect(a.map((h) => h.id)).toContain("brand-tile-rect");
    expect(b.map((h) => h.id)).toContain("brand-tile-rect");
  });

  test("ignores ordinary SVGs (icons, charts, logos referenced as PNG)", () => {
    expect(scanForInlineBrandSvgs('<svg viewBox="0 0 24 24"><path d="M4 4h16"/></svg>')).toHaveLength(0);
  });
});

describe("collectGuardedPngAssets", () => {
  test("resolves web-root refs against public/ and relative refs against the manifest dir", () => {
    writeHealthyFixture();
    const { fileRefs } = collectGuardedPngAssets(fixtureRoot);
    const resolved = fileRefs.map((r) => r.resolved.replace(/\\/g, "/"));
    expect(resolved).toContain(`${fixtureRoot.replace(/\\/g, "/")}/public/icons/logo-192.png`);
    expect(resolved).toContain(`${fixtureRoot.replace(/\\/g, "/")}/public/favicon.png`);
    expect(resolved).toContain(`${fixtureRoot.replace(/\\/g, "/")}/extension/icon-128.png`);
  });
});

describe("evaluateBrandConsistency", () => {
  test("(a) healthy fixture tree passes", () => {
    writeHealthyFixture();
    const result = evaluateBrandConsistency(fixtureRoot);
    expect(result.ok).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.checked).toBeGreaterThanOrEqual(4);
  });

  test("(b) an icon that deviates from the canonical artwork fails", () => {
    writeHealthyFixture();
    writeFileSync(join(fixtureRoot, "public", "icons", "logo-192.png"), encodePng(64, 64, solidRgba(64, 64, [220, 40, 40, 255])));
    const result = evaluateBrandConsistency(fixtureRoot);
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toMatch(/logo-192\.png deviates from the canonical logo artwork/);
  });

  test("(c) a referenced-but-missing icon fails", () => {
    writeHealthyFixture();
    rmSync(join(fixtureRoot, "public", "favicon.png"));
    const result = evaluateBrandConsistency(fixtureRoot);
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toMatch(/referenced icon missing: public[\\/]favicon\.png/);
  });

  test("(d) a non-square icon fails", () => {
    writeHealthyFixture();
    writeFileSync(join(fixtureRoot, "extension", "icon-128.png"), encodePng(64, 32, solidRgba(64, 32, [0, 0, 0, 255])));
    const result = evaluateBrandConsistency(fixtureRoot);
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toMatch(/expected square icon/);
  });

  test("(e) an undecodable .png fails instead of being skipped", () => {
    writeHealthyFixture();
    writeFileSync(join(fixtureRoot, "extension", "icon-128.png"), Buffer.from("this is not a png"));
    const result = evaluateBrandConsistency(fixtureRoot);
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toMatch(/cannot be decoded as a PNG icon/);
  });

  test("(f) a missing canonical artwork aborts with a clear message", () => {
    rmSync(join(fixtureRoot, "public", "icons", "logo-512.png"));
    const result = evaluateBrandConsistency(fixtureRoot);
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toMatch(/canonical artwork unavailable/);
  });

  test("(h) og-image-style SVG: embedded canonical PNG passes, foreign PNG fails", () => {
    writeHealthyFixture();
    const b64 = readFileSync(CANONICAL_SOURCE).toString("base64");
    writeFileSync(
      join(fixtureRoot, "public", "og-image.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,${b64}"/></svg>`,
    );
    expect(evaluateBrandConsistency(fixtureRoot).ok).toBe(true);

    writeFileSync(
      join(fixtureRoot, "public", "og-image.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,${encodePng(32, 32, solidRgba(32, 32, [250, 250, 0, 255])).toString("base64")}"/></svg>`,
    );
    const bad = evaluateBrandConsistency(fixtureRoot);
    expect(bad.ok).toBe(false);
    expect(bad.failures.join("\n")).toMatch(/og-image\.svg embeds a PNG that deviates/);
  });

  test("(g) inline brand-SVG placeholders in sources fail the evaluation", () => {
    writeHealthyFixture();
    mkdirSync(join(fixtureRoot, "src", "components"), { recursive: true });
    writeFileSync(
      join(fixtureRoot, "src", "components", "Sidebar.tsx"),
      '<a class="brand"><svg width="32" viewBox="0 0 128 128"><rect width="128" fill="#0f1c2e"/></svg></a>',
    );
    const result = evaluateBrandConsistency(fixtureRoot);
    expect(result.ok).toBe(false);
    const joined = result.failures.join("\n");
    expect(joined).toMatch(/\[canvas-128\]/);
    expect(joined).toMatch(/\[brand-tile-rect\]/);
    expect(joined).toMatch(/Sidebar\.tsx:\d+ \[canvas-128\] —/);
  });
});

describe("CLI exit codes", () => {
  test("(i) exit 0 on a healthy fixture, exit 1 with FAIL lines on a broken one", () => {
    writeHealthyFixture();
    const good = spawnSync("node", [SCRIPT_PATH], {
      encoding: "utf8",
      env: { ...process.env, BRAND_LOGO_CONSISTENCY_ROOT: fixtureRoot },
    });
    expect(good.status).toBe(0);
    expect(good.stdout).toMatch(/brand-mark consistency verified across/);

    writeFileSync(
      join(fixtureRoot, "public", "icons", "logo-192.png"),
      encodePng(64, 64, solidRgba(64, 64, [220, 40, 40, 255])),
    );
    const bad = spawnSync("node", [SCRIPT_PATH], {
      encoding: "utf8",
      env: { ...process.env, BRAND_LOGO_CONSISTENCY_ROOT: fixtureRoot },
    });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/FAIL: .*deviates from the canonical logo artwork/);
  });
});

// ---------------------------------------------------------------------------
// Guard 3: OG share-card copy sync
// ---------------------------------------------------------------------------

describe("card copy sync helpers", () => {
  test("copyTokens keeps numbers and significant words, drops stopwords", () => {
    expect(copyTokens("P2P sync across 3 devices")).toEqual(["p2p", "sync", "across", "3", "devices"]);
    expect(copyTokens("$79 one-time")).toEqual(["79", "one", "time"]);
    expect(copyTokens("Everything in Free")).toEqual(["everything", "free"]);
    expect(copyTokens("&")).toEqual([]);
  });
  test("normalizeCopy is case/punctuation-insensitive", () => {
    expect(normalizeCopy("Your  Local-First Digital Brain")).toBe("your local first digital brain");
  });
  test("extractSvgTextRuns decodes entities and trims", () => {
    expect(extractSvgTextRuns('<svg><text x="1">A &amp; B</text><text x="2">  C  </text></svg>')).toEqual(["A & B", "C"]);
  });
  test("extractSectionText strips tags within the requested section only", () => {
    const html = '<section id="a">Alpha</section><section id="pricing"><h3>Pro</h3> $79</section><section id="b">Beta</section>'; 
    expect(extractSectionText(html, "pricing")).toBe("Pro $79");
    expect(extractSectionText(html, "missing")).toBeNull();
  });
});

describe("evaluateCardCopySync", () => {
  const LANDING = `<section id="pricing"><h2>Simple, Fair Pricing</h2><p>Core app is free forever.</p>
    <article><h3>Free</h3>$0<span>/month</span></article>
    <ul><li>Unlimited bookmarks</li><li>P2P sync across 3 devices</li><li>Local AI</li></ul>
    <article><h3>Pro</h3>$79<span>one-time</span></article>
    <ul><li>Everything in Free</li><li>Priority support</li></ul>
  </section>`;

  test("a live-backed pricing card passes", () => {
    const card = { file: "public/og-image-pricing.svg", kind: "pricing", svg: "<text>PRO</text><text>$79 one-time</text><text>P2P sync across 3 devices</text><text>FREE</text><text>$0 /month</text>" };
    const fails = evaluateCardCopySync({ landingHtml: LANDING, cards: [card] });
    expect(fails).toEqual([]);
  });

  test("an orphaned highlight names the missing words", () => {
    const card = { file: "public/og-image-pricing.svg", kind: "pricing", svg: "<text>FREE</text><text>$0 /month</text><text>Free VPN included</text>" };
    const fails = evaluateCardCopySync({ landingHtml: LANDING, cards: [card] });
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatch(/og-image-pricing\.svg: card text "Free VPN included" is not backed by the live #pricing section \(missing: vpn, included\)/);
  });

  test("a changed landing price orphans the old card copy", () => {
    const drifted = LANDING.replace("$79", "$99");
    const card = { file: "public/og-image-pricing.svg", kind: "pricing", svg: "<text>$79 one-time</text>" };
    const fails = evaluateCardCopySync({ landingHtml: drifted, cards: [card] });
    expect(fails[0]).toMatch(/missing: 79/);
  });

  test("the main card must carry only registered brand copy", () => {
    const main = { file: "public/og-image.svg", kind: "main", svg: `<text>BookmarkForge</text><text>${BRAND_SLOGAN}</text>` };
    expect(evaluateCardCopySync({ landingHtml: LANDING, cards: [main] })).toEqual([]);

    const stale = { file: "public/og-image.svg", kind: "main", svg: "<text>BookmarkForge</text><text>Old Slogan Here</text>" };
    const fails = evaluateCardCopySync({ landingHtml: LANDING, cards: [stale] });
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatch(/not registered brand copy/);
  });

  test("a missing #pricing section fails with an actionable message", () => { 
    const fails = evaluateCardCopySync({ landingHtml: "<section id=\"other\">x</section>", cards: [{ file: "c.svg", kind: "pricing", svg: "<text>$79</text>" }] });
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatch(/#pricing section not found/);
  });
});

describe("Guard 3 integration", () => {
  test("(j) the real repo passes end-to-end with copy sync active", () => {
    const result = evaluateBrandConsistency(REPO_ROOT);
    expect(result.ok).toBe(true);
    expect(result.notes.join("\n")).toMatch(/share-card copy in sync/);

    // Documented Guard 3 contract: a tree without landing + cards skips
    // the copy-sync check silently (fixture trees are partial) — a healthy
    // icon-only fixture stays green.
    writeHealthyFixture();
    const partial = evaluateBrandConsistency(fixtureRoot);
    expect(partial.ok).toBe(true);
    expect(partial.notes.join("\n")).not.toMatch(/share-card copy in sync/);
  });

  test("(k) a drifted pricing card fails the evaluation; fixture without cards/landing skips the guard", () => {
    writeHealthyFixture();
    const b64 = readFileSync(CANONICAL_SOURCE).toString("base64");
    writeFileSync(
      join(fixtureRoot, "public", "og-image-pricing.svg"),
      `<svg><image href="data:image/png;base64,${b64}"/><text>$79 one-time</text></svg>`,
    );
    // The guard needs both sides: add a landing whose #pricing no longer
    // says $79 — the card copy is now orphaned and must fail the gate.
    mkdirSync(join(fixtureRoot, "public"), { recursive: true });
    writeFileSync(
      join(fixtureRoot, "public", "landing.html"),
      '<html><body><section id="pricing"><h2>Simple, Fair Pricing</h2>$99 one-time</section></body></html>',
    );
    const bad = evaluateBrandConsistency(fixtureRoot);
    expect(bad.ok).toBe(false);
    expect(bad.failures.join("\n")).toMatch(/not backed by the live #pricing section/);

    // No cards, no landing → guard silent (fixture trees are partial).
    rmSync(join(fixtureRoot, "public", "og-image-pricing.svg"));
    rmSync(join(fixtureRoot, "public", "landing.html"));
    const clean = evaluateBrandConsistency(fixtureRoot);
    expect(clean.ok).toBe(true);
  });
});

describe("real repo calibration", () => {
  test("the canonical artwork loads and the threshold separates same-artwork noise from foreign marks", () => {
    const canonical = loadCanonicalReference(REPO_ROOT);
    expect(canonical).toHaveLength(64 * 64 * 4);
    // The repo's own favicon (same artwork, different resampler) sits far
    // below the threshold; a solid red mark sits far above it.
    const favicon = boxResample(decodePngToRgba(readFileSync(join(REPO_ROOT, "public", "favicon.png"))), 64);
    expect(meanDiff(favicon, canonical)).toBeLessThan(THRESHOLD);
    const foreign = boxResample(
      { width: 64, height: 64, rgba: solidRgba(64, 64, [220, 40, 40, 255]) },
      64,
    );
    expect(meanDiff(foreign, canonical)).toBeGreaterThan(THRESHOLD);
  });
});
