/**
 * scripts/check-brand-logo-consistency.mjs — brand-mark single-source gate.
 *
 * Fails the build if any icon PNG or inline brand SVG deviates from the
 * canonical artwork (public/icons/logo-512.png), so a "standard" placeholder
 * logo can never sneak back into the app, landing pages, or the extension.
 *
 * Two surfaces are guarded:
 *
 *   1. PNG icons — every icon PNG referenced from the known brand surfaces
 *      (PWA manifest, extension manifests, browserconfig, favicon /
 *      apple-touch links in HTML, embedded <image> data-URIs in public
 *      SVGs like the og-image card) is decoded and pixel-compared against
 *      the canonical artwork after box-resampling to 64×64. A missing,
 *      non-square, undecodable, or visually-different icon fails the gate.
 *      The similarity threshold (THRESHOLD) absorbs resampler differences
 *      between icon renditions; a genuinely different mark measures ~4×
 *      over it.
 *
 *   2. Inline brand SVGs — hand-drawn placeholder logo SVGs (viewBox
 *      "0 0 128 128", the old trapezoid path, brand-tile rects) in HTML /
 *      TSX / JS / SVG sources fail the gate: the brand mark must be the
 *      canonical PNG (/logo-64.png), never a re-typed approximation.
 *
 *   3. OG share-card copy — the pricing card's text (tier names, prices,
 *      highlights) must stay backed by the live landing #pricing section,
 *      and the main card's title/tagline must be the registered brand copy
 *      (BRAND_NAME / BRAND_SLOGAN below — the slogan lives only on the
 *      cards, so the gate is its single source). A landing copy change
 *      that orphans a card highlight fails the gate with the missing
 *      words named.
 *
 * Pure gate, no --fix. Node core only — runs even in a broken
 * node_modules (deliberately does NOT depend on sharp).
 *
 * Usage:
 *   node scripts/check-brand-logo-consistency.mjs
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { dirname, join, relative, resolve } from "node:path";

// Like scripts/check-extension-dist.mjs, the repo root comes from cwd (all
// npm-script/CI invocations run from the repo root) and every exported
// evaluator takes an explicit `root` so tests can drive fixture trees
// without touching the real repo or chdir races.
const REPO_ROOT = process.cwd();
const TAG = "[check-brand-logo-consistency]";

/** Canonical artwork every guarded mark must match. */
export const CANONICAL_LOGO = "public/icons/logo-512.png";

/**
 * Mean |RGBA| difference per byte (0–255) tolerated between a candidate
 * icon and the canonical artwork at 64×64. Real renditions of the same
 * artwork (different resamplers/palettes at 16–192px) measure ≤ ~20;
 * a different mark measures ~99. 45 sits far from both clusters.
 */
export const THRESHOLD = 45;

/** Compare size for the similarity check. */
const COMPARE_SIZE = 64;

/** File extensions scanned for inline brand SVGs. */
const SVG_SCAN_EXTS = new Set([".html", ".htm", ".svg", ".tsx", ".jsx", ".ts", ".js", ".mjs", ".cjs"]);

/** Directories never scanned (build output, deps, caches). */
const SCAN_SKIP_DIRS = new Set([
  "node_modules", "dist", "dist-extension", ".git", "coverage",
  "playwright-report", "test-results", ".freebuff", ".zap", ".tmp-docs-retire-blocked-repro",
]);

// ---------------------------------------------------------------------------
// PNG decoding (pure Node core: zlib + PNG unfiltering)
// ---------------------------------------------------------------------------

/**
 * Decode a PNG buffer into flat RGBA. Supports color types 0/2/3/4/6,
 * bit depths 1/2/4/8, non-interlaced — the superset produced by the
 * icon tooling in this repo (sharp, palette-optimized exports).
 */
export function decodePngToRgba(buffer) {
  if (buffer.length < 57 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("not a PNG file");
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  let palette = null;
  let trns = null;
  while (pos + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      trns = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (interlace !== 0) throw new Error("interlaced PNG not supported");
  if (width === 0 || height === 0) throw new Error("empty PNG");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) throw new Error(`unsupported color type ${colorType}`);
  if (![1, 2, 4, 8].includes(bitDepth)) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (colorType === 3 && !palette) throw new Error("palette PNG missing PLTE");

  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  const expected = (stride + 1) * height;
  if (raw.length < expected) throw new Error("truncated PNG data");
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);

  const sampleAt = (line, x) => {
    if (bitDepth === 8) return line[x];
    if (bitDepth === 4) return (x % 2 === 0 ? line[x >> 1] >> 4 : line[x >> 1] & 0xf);
    if (bitDepth === 2) return (line[x >> 2] >> (6 - 2 * (x & 3))) & 3;
    return (line[x >> 3] >> (7 - (x & 7))) & 1; // 1-bit
  };
  const scaleGray = (v) => Math.round((v * 255) / ((1 << bitDepth) - 1));

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const line = Buffer.from(raw.subarray(rowStart + 1, rowStart + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      const v = line[x];
      let val;
      switch (filter) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unsupported filter ${filter}`);
      }
      line[x] = val & 0xff;
    }
    prev = line;
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      if (colorType === 6) {
        out[di] = line[x * 4];
        out[di + 1] = line[x * 4 + 1];
        out[di + 2] = line[x * 4 + 2];
        out[di + 3] = line[x * 4 + 3];
      } else if (colorType === 2) {
        out[di] = line[x * 3];
        out[di + 1] = line[x * 3 + 1];
        out[di + 2] = line[x * 3 + 2];
        out[di + 3] = 255;
      } else if (colorType === 3) {
        const idx = sampleAt(line, x);
        out[di] = palette[idx * 3];
        out[di + 1] = palette[idx * 3 + 1];
        out[di + 2] = palette[idx * 3 + 2];
        out[di + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 0) {
        const g = scaleGray(sampleAt(line, x));
        out[di] = out[di + 1] = out[di + 2] = g;
        out[di + 3] = 255;
      } else {
        out[di] = out[di + 1] = out[di + 2] = line[x * 2];
        out[di + 3] = line[x * 2 + 1];
      }
    }
  }
  return { width, height, rgba: out };
}

/**
 * Alpha-weighted box resample to `size`×`size` RGBA (premultiplied
 * averaging avoids dark/light halos around transparency).
 */
export function boxResample({ width, height, rgba }, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const x0 = Math.floor((dx * width) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * width) / size));
      const y0 = Math.floor((dy * height) / size);
      const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * height) / size));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const si = (y * width + x) * 4;
          const alpha = rgba[si + 3] / 255;
          r += rgba[si] * alpha;
          g += rgba[si + 1] * alpha;
          b += rgba[si + 2] * alpha;
          a += rgba[si + 3];
          n++;
        }
      }
      const di = (dy * size + dx) * 4;
      const meanA = a / Math.max(1, n);
      const weight = Math.max(meanA / 255, 1e-4);
      out[di] = Math.round(r / n / weight);
      out[di + 1] = Math.round(g / n / weight);
      out[di + 2] = Math.round(b / n / weight);
      out[di + 3] = Math.round(meanA);
    }
  }
  return out;
}

/** Mean absolute difference per byte between two same-length RGBA buffers. */
export function meanDiff(a, b) {
  if (a.length !== b.length) throw new Error("buffer size mismatch");
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** Load the canonical artwork resampled to COMPARE_SIZE. */
export function loadCanonicalReference(root = REPO_ROOT) {
  const canonicalPath = resolve(root, CANONICAL_LOGO);
  if (!existsSync(canonicalPath)) throw new Error(`canonical logo missing: ${CANONICAL_LOGO}`);
  const decoded = decodePngToRgba(readFileSync(canonicalPath));
  return boxResample(decoded, COMPARE_SIZE);
}

// ---------------------------------------------------------------------------
// Guard 1: referenced PNG icons must exist and match the canonical artwork
// ---------------------------------------------------------------------------

/** Extract paths referenced from a JSON manifest's icon blocks. */
function manifestIconPaths(manifest, baseDir) {
  const out = [];
  const push = (src) => {
    if (typeof src === "string") out.push({ src, baseDir });
  };
  for (const src of Object.values(manifest.icons ?? {})) push(src);
  push(manifest.action?.default_icon);
  for (const src of Object.values(manifest.action?.default_icon ?? {})) push(src);
  for (const src of Object.values(manifest.browser_action?.default_icon ?? {})) push(src);
  for (const shortcut of manifest.shortcuts ?? []) {
    for (const icon of shortcut.icons ?? []) push(icon.src);
  }
  return out;
}

/** Extract href/src attribute paths from HTML/XML-ish content. */
function attrIconPaths(content, baseDir) {
  const out = [];
  for (const m of content.matchAll(/(?:href|src)=["']([^"'#]+)["']/g)) {
    out.push({ src: m[1], baseDir });
  }
  return out;
}

/** Extract embedded data:image/png base64 payloads from content. */
function embeddedPngDataUris(content) {
  return [...content.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map((m) => m[1]);
}

/**
 * Collect every guarded PNG asset for a repo root:
 *  - icon references from public/manifest.json, extension manifests,
 *    browserconfig.xml and HTML link/shortcut attributes
 *  - embedded base64 PNGs inside public SVGs (og-image card)
 * Returns { fileRefs: [{file, src, resolved}], dataUris: [{file, index}] }.
 */
export function collectGuardedPngAssets(root = REPO_ROOT) {
  const fileRefs = [];
  const dataUris = [];
  const seen = new Set();
  const addRef = (ref) => {
    if (/^(https?:)?\/\//i.test(ref.src) || ref.src.startsWith("data:")) return;
    // Web-root URLs ("/icons/logo-192.png") resolve against public/ — the
    // served web root — while relative refs resolve against the referencing
    // file's directory (e.g. extension manifests, extension popup.html).
    const resolved = ref.src.startsWith("/")
      ? resolve(root, "public", "." + ref.src)
      : resolve(ref.baseDir ?? root, ref.src);
    const key = resolved.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    fileRefs.push({ ...ref, resolved });
  };

  const jsonRefFiles = [
    "public/manifest.json",
    "extension/manifest.json",
    "extension/manifest-firefox.json",
  ];
  for (const rel of jsonRefFiles) {
    const abs = resolve(root, rel);
    if (!existsSync(abs)) continue;
    const baseDir = dirname(abs);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(abs, "utf8"));
    } catch {
      continue; // malformed manifests are other gates' problem
    }
    for (const ref of manifestIconPaths(manifest, baseDir)) addRef(ref);
  }

  const attrRefFiles = [
    "public/browserconfig.xml",
    "index.html",
    ...listFiles(resolve(root, "public"), root).filter((f) => f.endsWith(".html")),
  ].map((rel) => resolve(root, rel));
  for (const abs of attrRefFiles) {
    if (!existsSync(abs)) continue;
    for (const ref of attrIconPaths(readFileSync(abs, "utf8"), dirname(abs))) {
      if (/\.(png|ico)(\?|$)/i.test(ref.src)) addRef(ref);
    }
  }

  for (const abs of listFiles(resolve(root, "public"), root).filter((f) => f.endsWith(".svg"))) {
    for (const b64 of embeddedPngDataUris(readFileSync(abs, "utf8"))) {
      dataUris.push({ file: abs, b64 });
    }
  }
  return { fileRefs, dataUris };
}

// ---------------------------------------------------------------------------
// Guard 2: no inline brand-SVG placeholders in sources
// ---------------------------------------------------------------------------

const BRAND_SVG_PATTERNS = [
  {
    id: "canvas-128",
    reason:
      'inline SVG with viewBox "0 0 128 128" (the hand-typed placeholder canvas) — use the canonical PNG (/logo-64.png) instead',
    pattern: /viewBox=["']0 0 128 128["']/,
  },
  {
    id: "placeholder-path",
    reason: "inline SVG containing the old placeholder trapezoid path (M28 40h72…) — use the canonical PNG (/logo-64.png) instead",
    pattern: /M28 40h72/,
  },
  {
    id: "brand-tile-rect",
    reason: "inline SVG brand tile (128×128 rect filled #0f1c2e) — use the canonical PNG (/logo-64.png) instead",
    pattern: /<rect[^>]*(fill=["']#0f1c2e["'][^>]*width=["']128["']|width=["']128["'][^>]*fill=["']#0f1c2e["'])/i,
  },
];

/** Scan one file's content for inline brand-SVG violations. */
export function scanForInlineBrandSvgs(content) {
  const hits = [];
  for (const rule of BRAND_SVG_PATTERNS) {
    const m = content.match(rule.pattern);
    if (m) {
      const line = content.slice(0, m.index ?? 0).split("\n").length;
      hits.push({ id: rule.id, reason: rule.reason, line });
    }
  }
  return hits;
}

/** Recursively list scannable source files under `dir`. */
function listFiles(dir, root, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      listFiles(abs, root, acc);
    } else if (SVG_SCAN_EXTS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      acc.push(abs);
    }
  }
  return acc;
}

/**
 * Test trees are excluded from Guard 2: tests legitimately embed the
 * placeholder patterns as fixtures (and this gate's own suite does), and
 * test files never ship to users.
 */
const TEST_DIR_NAMES = new Set(["__tests__", "tests"]);

/** This gate's own source — its pattern strings must never self-match. */
const SELF_BASENAME = "check-brand-logo-consistency.mjs";

function isTestPath(relPath) {
  const parts = relPath.split(/[\\/]/);
  if (parts.some((p) => TEST_DIR_NAMES.has(p))) return true;
  return /\.test\.[a-z]+$|\.spec\.[a-z]+$/i.test(relPath);
}

/** Scan the whole repo (minus skip dirs) for inline brand SVGs. */
export function collectInlineBrandSvgViolations(root = REPO_ROOT) {
  const violations = [];
  for (const abs of listFiles(root, root)) {
    const rel = relative(root, abs);
    if (rel.split(/[\\/]/).pop() === SELF_BASENAME) continue;
    if (isTestPath(rel)) continue;
    const hits = scanForInlineBrandSvgs(readFileSync(abs, "utf8"));
    for (const hit of hits) {
      violations.push({ file: rel, ...hit });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Evaluation (pure — testable against any repo root)
// ---------------------------------------------------------------------------

/**
 * Evaluate every brand-mark guarantee for the repo rooted at `root`.
 * Pure: no printing, no process.exit — returns the verdict so tests can
 * drive failure modes against isolated fixture trees.
 */
// ---------------------------------------------------------------------------
// OG share-card copy sync (Guard 3)
// ---------------------------------------------------------------------------

/**
 * Landing locales — derived from scripts/landing-registry.mjs (the single
 * source of truth). The old hand-maintained 6-row mirror stayed at 6 while
 * the site moved to 30 locales; a localized share card added tomorrow would
 * have failed here with "unknown lang" against a correct SEO registry.
 */
import { metaContent } from "./check-seo.mjs";
import { LANDING_LOCALES as REGISTRY_LOCALES } from "./landing-registry.mjs";
export const LANDING_LOCALES = REGISTRY_LOCALES;
export const LANDING_FILE = "public/landing.html";

/** The canonical share cards guarded for copy sync.
 *
 * The localized cards (og-image-<lang>.png) are generated from the same
 * template as og-image.png (navy bg, accent rules, embedded logo, the
 * BookmarkForge wordmark) with only the tagline line localized, so they
 * are covered by the same logo-artwork guard (Guard 1) and only the
 * localized tagline needs a per-card copy check below. We list the SVG
 * sources here (the PNGs are the rendered output and are guarded as icon
 * assets by Guard 1 / check:seo's asset-existence checks).
 */
export const OG_CARD_FILES = [
  "public/og-image.svg",
  "public/og-image-pricing.svg",
  "public/og-image-es.png",
  "public/og-image-fr.png",
  "public/og-image-de.png",
  "public/og-image-pt.png",
  "public/og-image-it.png",
];

/**
 * Brand copy registered here — the single source for the main card's
 * title/tagline. The slogan exists only on the share cards (the landing's
 * footer and meta descriptions deliberately use other phrasings), so the
 * gate is its source of truth: changing the slogan is a brand decision
 * that must touch this file and the card in the same commit.
 */
export const BRAND_NAME = "BookmarkForge";
export const BRAND_SLOGAN = "Your Local-First Digital Brain";

/** Words too generic to anchor card copy to the landing section. */
const COPY_STOPWORDS = new Set(["for", "the", "and", "with", "your", "of", "in", "to", "a", "an"]);

/**
 * Significant tokens of a copy string: words of ≥2 letters (minus
 * stopwords) plus any number — "79" and "3" anchor prices and device
 * counts, "ai" survives despite its length.
 */
export function copyTokens(s) {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !COPY_STOPWORDS.has(t) && (t.length >= 2 || /\d/.test(t)));
}

/** Normalized form for exact copy comparison (case/punctuation-insensitive). */
export function normalizeCopy(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Decode the HTML entities an SVG/HTML text run can carry. */
function decodeEntities(s) {
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (match, hex, dec, named) => {
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    if (dec !== undefined) return String.fromCodePoint(parseInt(dec, 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named.toLowerCase()] ?? match;
  });
}

/** Content of every <text> element in an SVG (entities decoded). */
export function extractSvgTextRuns(svg) {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
    decodeEntities(m[1].trim()),
  );
}

/** Tags-stripped text of <section id="...">…</section>, or null. */
export function extractSectionText(html, sectionId) {
  const re = new RegExp(
    `<section\\b[^>]*\\bid=["']${sectionId}["'][^>]*>([\\s\\S]*?)</section>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return null;
  return decodeEntities(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Pure evaluator for Guard 3. `cards` = [{ file, svg, kind, lang? }] with
 * kind "pricing" (live-synced against the landing #pricing section), "lang"
 * (localized PNG tagline must match the matching landing's og:description), or
 * "main" (must carry only registered brand copy). Card highlights may condense
 * several landing bullets into one line — the rule is token-based: every
 * significant token of a pricing-card text run must exist somewhere in the
 * live #pricing text, so a landing copy change that orphans a highlight
 * (price, device count, feature name) fails with the missing words named.
 * Localized cards use the same rule against the matching landing's og:description.
 * The caller (evaluateBrandConsistency) passes `root` so the evaluator can read
 * localized landing files only when both sides are present on disk.
 * Returns an array of failure strings.
 */
export function evaluateCardCopySync({ landingHtml, cards, root }) {
  const failures = [];
  const pricingText = extractSectionText(landingHtml, "pricing");
  if (pricingText == null) {
    failures.push(
      `${LANDING_FILE}: #pricing section not found — cannot verify share-card copy sync`,
    );
    return failures;
  }
  const landingTokens = new Set(copyTokens(pricingText));

  for (const c of cards) {
    const { file, svg, kind, lang } = c;
    if (kind === "pricing") {
      for (const run of extractSvgTextRuns(svg)) {
        const missing = copyTokens(run).filter((t) => !landingTokens.has(t));
        if (missing.length > 0) {
          failures.push(
            `${file}: card text "${run}" is not backed by the live #pricing section (missing: ${missing.join(", ")}) — update the card and the landing together`,
          );
        }
      }
    } else if (kind === "lang") {
      // Localized tagline must appear (token-wise) in the matching landing's
      // og:description, so a localized copy change that orphans a card tagline
      // fails with the missing words named.
      const langPage = LANDING_LOCALES.find((l) => l.lang === lang);
      if (!langPage) {
        failures.push(
          `${file}: localized card for unknown lang "${lang}" — add it to LANDING_LOCALES in scripts/landing-registry.mjs`,
        );
        continue;
      }
      const landPath = join(root, langPage.file);
      if (!existsSync(landPath)) continue;
      const landHtml = readFileSync(landPath, "utf8");
      const ogDesc = metaContent(landHtml, "og:description");
      if (!ogDesc) {
        failures.push(
          `${file}: localized card but ${langPage.file} has no og:description — add the localized tagline there`,
        );
        continue;
      }
      const pageTokens = new Set(copyTokens(ogDesc));
      for (const run of extractSvgTextRuns(svg)) {
        const missing = copyTokens(run).filter((t) => !pageTokens.has(t));
        if (missing.length > 0) {
          failures.push(
            `${file}: card tagline "${run}" is not backed by the live ${langPage.file} og:description (missing: ${missing.join(", ")}) — update the card and the landing together`,
          );
        }
      }
    } else {
      const registered = new Set([normalizeCopy(BRAND_NAME), normalizeCopy(BRAND_SLOGAN)]);
      for (const run of extractSvgTextRuns(svg)) {
        if (copyTokens(run).length === 0) continue; // decorative ("$" etc.)
        if (!registered.has(normalizeCopy(run))) {
          failures.push(
            `${file}: card text "${run}" is not registered brand copy (expected "${BRAND_NAME}" / "${BRAND_SLOGAN}") — the gate is the slogan's single source; update both together`,
          );
        }
      }
    }
  }
  return failures;
}

export function evaluateBrandConsistency(root = REPO_ROOT) {
  const failures = [];
  const notes = [];
  const fail = (msg) => failures.push(msg);

  let canonical;
  try {
    canonical = loadCanonicalReference(root);
  } catch (e) {
    return {
      ok: false,
      checked: 0,
      failures: [`canonical artwork unavailable — ${e.message}`],
      notes,
    };
  }

  let checked = 0;

  // Guard 1a: referenced icon files
  const { fileRefs, dataUris } = collectGuardedPngAssets(root);
  for (const ref of fileRefs) {
    const rel = relative(root, ref.resolved);
    if (!existsSync(ref.resolved)) {
      fail(`referenced icon missing: ${rel} (referenced as "${ref.src}")`);
      continue;
    }
    checked += 1;
    try {
      const decoded = decodePngToRgba(readFileSync(ref.resolved));
      if (decoded.width !== decoded.height) {
        fail(`${rel} is ${decoded.width}×${decoded.height}, expected square icon`);
        continue;
      }
      const diff = meanDiff(boxResample(decoded, COMPARE_SIZE), canonical);
      if (diff > THRESHOLD) {
        fail(`${rel} deviates from the canonical logo artwork (diff ${diff.toFixed(1)} > ${THRESHOLD}) — regenerate from ${CANONICAL_LOGO}`);
        continue;
      }
      notes.push(`ok  ${rel} (diff ${diff.toFixed(1)})`);
    } catch (e) {
      fail(`${rel} cannot be decoded as a PNG icon — ${e.message}`);
    }
  }

  // Guard 1b: embedded PNG data-URIs in public SVGs (og-image card)
  for (const item of dataUris) {
    const rel = relative(root, item.file);
    checked += 1;
    try {
      const decoded = decodePngToRgba(Buffer.from(item.b64, "base64"));
      const diff = meanDiff(boxResample(decoded, COMPARE_SIZE), canonical);
      if (diff > THRESHOLD) {
        fail(`${rel} embeds a PNG that deviates from the canonical logo artwork (diff ${diff.toFixed(1)} > ${THRESHOLD})`);
        continue;
      }
      notes.push(`ok  ${rel} embedded logo (diff ${diff.toFixed(1)})`);
    } catch (e) {
      fail(`${rel} embeds an undecodable PNG data-URI — ${e.message}`);
    }
  }

  // Guard 2: inline brand SVGs in sources
  const svgViolations = collectInlineBrandSvgViolations(root);
  for (const v of svgViolations) {
    fail(`${v.file}:${v.line} [${v.id}] — ${v.reason}`);
  }
  if (svgViolations.length === 0) {
    checked += 1;
    notes.push("ok  no inline brand-SVG placeholders in sources");
  }

  // Guard 3: OG share-card copy in sync with the live landing copy.
  // Runs only when both sides exist (fixture trees are partial); file
  // existence itself is guarded by check:seo's og:image asset checks.
  const landingPath = join(root, LANDING_FILE);
  const cardFiles = OG_CARD_FILES.filter((f) => existsSync(join(root, f)));
  if (cardFiles.length > 0 && existsSync(landingPath)) {
    const landingHtml = readFileSync(landingPath, "utf8");
    const cards = cardFiles.map((f) => {
      let kind = "main";
      let lang = null;
      if (f.includes("pricing")) {
        kind = "pricing";
      } else {
        const ml = f.match(/og-image-(es|fr|de|pt|it)\.png$/);
        if (ml) {
          kind = "lang";
          lang = ml[1];
        }
      }
      return { file: f, svg: readFileSync(join(root, f), "utf8"), kind, lang };
    })
    for (const msg of evaluateCardCopySync({ landingHtml, cards, root })) fail(msg);
    checked += 1;
    notes.push(
      `ok  share-card copy in sync (${cards.length} card(s) vs ${LANDING_FILE} #pricing + registered brand copy + localized landing taglines)`,
    );
  }

  return { ok: failures.length === 0, checked, failures, notes };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(root = REPO_ROOT) {
  const { ok, checked, failures, notes } = evaluateBrandConsistency(root);
  for (const note of notes) console.log(`${TAG} ${note}`);
  for (const msg of failures) console.error(`${TAG} FAIL: ${msg}`);
  if (!ok) {
    console.error(`${TAG} FAIL: ${failures.length} violation(s) — every brand mark must be the canonical artwork (${CANONICAL_LOGO})`);
    process.exit(1);
  }
  console.log(`${TAG} ok: brand-mark consistency verified across ${checked} asset(s) + source scan`);
  process.exit(0);
}

// Direct-invocation guard (matches scripts/check-extension-dist.mjs,
// scripts/check-extension-csp.mjs). BRAND_LOGO_CONSISTENCY_ROOT optionally
// overrides the repo root — a test/isolation hook so CLI exit codes can be
// exercised against fixture trees without chdir races.
function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryBase = entry.split(/[\\/]/).pop();
  const moduleBase = import.meta.url.split("/").pop();
  return entryBase === moduleBase;
}

if (isDirectInvocation()) {
  const envRoot = process.env.BRAND_LOGO_CONSISTENCY_ROOT;
  main(envRoot ? resolve(envRoot) : REPO_ROOT);
}
