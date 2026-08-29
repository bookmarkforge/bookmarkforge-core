/**
 * scripts/check-static-brand-tokens.mjs — brand-token single-source gate.
 *
 * Each static surface has ONE place its brand palette and (when applicable)
 * the Inter Variable @font-face may live:
 *
 *   • web static pages        → public/brand-tokens.css
 *   • browser extension popup → extension/brand-tokens.css
 *
 * This gate fails if a page/component sheet regresses and reintroduces a
 * duplicate copy of either:
 *
 *   1. @font-face blocks — a font used by one of these surfaces must be
 *      declared exclusively in that surface's brand-tokens.css.
 *   2. Brand token definitions — a sheet must not re-declare the canonical
 *      token names (--bg, --accent, --divider, …); it should consume them
 *      via var(--…) from the shared file. Component-local overrides that are
 *      NOT brand tokens (e.g. --accent-text, --card-fill, --success) stay
 *      allowed.
 *   3. Brand hex literals — the exact #hex palette values that appear in a
 *      surface's brand-tokens.css must never be hardcoded in one of its
 *      sheets; they should come from a var(--…).
 *
 * The guarded palette is DERIVED from each surface's brand-tokens.css (every
 * #hex literal it contains), so the gate stays in sync automatically if the
 * brand tokens are ever recolored — no second list to drift.
 *
 * For each scanned sheet it also identifies the HTML in the same directory
 * that links it and verifies brand-tokens.css is linked BEFORE the page sheet
 * (the intended single-source wiring).
 *
 * Pure gate, no --fix. Node core only — runs even in a broken node_modules.
 *
 * Usage:
 *   node scripts/check-static-brand-tokens.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TAG = "[check-static-brand-tokens]";

const APPS = [
  {
    name: "public static pages",
    dir: "public",
    tokensName: "brand-tokens.css",
    requireFontFaces: true,
  },
  {
    name: "extension popup",
    dir: "extension",
    tokensName: "brand-tokens.css",
    requireFontFaces: false,
  },
];

// Canonical brand token names — pages/component sheets consume these via
// var(--…); they may never be re-declared outside a surface's
// brand-tokens.css. Component-local overrides (--accent-text, --card-fill,
// --success, …) are not in this set and stay allowed.
const BRAND_TOKEN_NAMES = new Set([
  "--bg", "--bg-surface", "--bg-card",
  "--text", "--text-muted", "--text-on-accent",
  "--accent", "--accent-strong", "--accent-soft",
  "--accent-glow", "--accent-glow-strong",
  "--divider",
  "--radius-card", "--radius-btn", "--radius-item",
]);

/** Normalize a CSS hex (3- or 6-digit, any case) to 6-digit lowercase. */
function normHex(h) {
  const v = h.slice(1).toLowerCase();
  if (v.length === 3) return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
  return `#${v}`;
}

/** Every #hex literal in a stylesheet (values + comments). */
function hexLiterals(css) {
  const set = new Set();
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,6}\b/g)) set.add(normHex(m[0]));
  return set;
}

/** Custom-property names declared by a stylesheet (`--foo:` in a block). */
function declaredProperties(css) {
  const names = new Set();
  for (const m of css.matchAll(/--([\w-]+)\s*:/g)) names.add(`--${m[1]}`);
  return names;
}

function listSheets(dir, tokensName) {
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(".css") && f !== tokensName)
    .map((f) => join(ROOT, dir, f));
}

/** For a page sheet, find the HTML in the same dir that links it. */
function findOwningHtml(dir, sheetName) {
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(".html"))
    .find((f) => {
      const h = readFileSync(join(ROOT, dir, f), "utf8");
      // Matches both absolute (/sheet.css) and relative (sheet.css) links.
      return new RegExp(`href=["']/?${sheetName}["']`).test(h);
    });
}

const failures = [];

function fail(msg) {
  failures.push(msg);
  console.error(`${TAG} FAIL: ${msg}`);
}

let scannedSheets = 0;

for (const app of APPS) {
  const dirPath = join(ROOT, app.dir);
  const tokensPath = join(dirPath, app.tokensName);

  let tokensSrc = "";
  try {
    tokensSrc = readFileSync(tokensPath, "utf8");
  } catch (_e) {
    fail(`${app.dir}/${app.tokensName} missing — required as the single source for "${app.name}"`);
    continue;
  }

  const tokenFaces = (tokensSrc.match(/@font-face/g) || []).length;
  if (app.requireFontFaces && tokenFaces === 0) {
    fail(`${app.dir}/${app.tokensName} must declare the Inter Variable @font-face (single source) — it has ${tokenFaces}`);
  }

  const BRAND_HEXES = hexLiterals(tokensSrc);

  for (const sheetPath of listSheets(app.dir, app.tokensName)) {
    scannedSheets += 1;
    const name = sheetPath.split(/[\\/]/).pop();
    const css = readFileSync(sheetPath, "utf8");

    // 1) @font-face only in brand-tokens.css
    const faces = (css.match(/@font-face/g) || []).length;
    if (faces > 0) {
      fail(`${app.dir}/${name} declares ${faces} @font-face block(s) — move them to ${app.dir}/${app.tokensName}`);
    }

    // 2) Brand token names must not be re-declared
    const dupes = [...declaredProperties(css)]
      .filter((d) => BRAND_TOKEN_NAMES.has(d))
      .sort();
    if (dupes.length > 0) {
      fail(`${app.dir}/${name} re-declares brand token(s): ${dupes.join(", ")} — use var(--…) from ${app.dir}/${app.tokensName}`);
    }

    // 3) Brand hex literals must not be hardcoded
    const hexHits = [...hexLiterals(css)].filter((h) => BRAND_HEXES.has(h)).sort();
    if (hexHits.length > 0) {
      fail(`${app.dir}/${name} hardcodes brand color(s): ${hexHits.join(", ")} — use var(--…) from ${app.dir}/${app.tokensName}`);
    }

    // 4) brand-tokens.css must be linked before this sheet in its HTML
    const htmlName = findOwningHtml(app.dir, name);
    if (htmlName) {
      const html = readFileSync(join(dirPath, htmlName), "utf8");
      let iTok = html.indexOf(`/${app.tokensName}`);
      if (iTok === -1) iTok = html.indexOf(`"${app.tokensName}`);
      if (iTok === -1) iTok = html.indexOf(`'${app.tokensName}`);
      let iSheet = html.indexOf(`/${name}`);
      if (iSheet === -1) iSheet = html.indexOf(`"${name}`);
      if (iSheet === -1) iSheet = html.indexOf(`'${name}`);
      if (iTok === -1 || iSheet === -1 || iTok >= iSheet) {
        fail(`${app.dir}/${htmlName} must link /${app.tokensName} before ${name}`);
      }
    } else {
      fail(`${app.dir}/${name} has no owning HTML in ${app.dir}/ — single-source wiring can't be verified`);
    }

    console.log(`${TAG} ok  ${app.dir}/${name} (${faces} @font-face, ${dupes.length} token dupes, ${hexHits.length} brand hex)`);
  }
}

if (failures.length > 0) {
  console.error(`${TAG} FAIL: ${failures.length} violation(s) — brand tokens belong only in each surface's brand-tokens.css`);
  process.exit(1);
}

console.log(
  `${TAG} ok: ${scannedSheets} sheet(s) clean — all brand tokens/fonts sourced from per-surface brand-tokens.css`,
);
process.exit(0);