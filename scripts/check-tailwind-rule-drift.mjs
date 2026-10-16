/**
 * scripts/check-tailwind-rule-drift.mjs — Tailwind ↔ lint-rule drift gate.
 *
 * The no-unbounded-text rule (and its companion rules) accept a hardcoded
 * set of "defensive" Tailwind utilities — see DEFENSE_RE in
 * eslint-rules/lib/jsx-utils.mjs: `truncate`, `line-clamp(-N)` and
 * `max-w-*` (+ arbitrary values). A defense only protects a layout if
 * Tailwind actually provides it, and the set is a contract: the moment the
 * team adds a NEW defense utility (say `text-ellipsis`) to a safelist or
 * theme, DEFENSE_RE becomes stale — the lint rule would flag code that
 * uses a legitimate defense (false positive) until someone widens the
 * regex.
 *
 * This gate parses the project's Tailwind configuration sources and
 * verifies every explicitly-declared defense-family utility is accepted by
 * DEFENSE_RE. A mismatch = drift = stale regex. Sources, all optional
 * except the CSS-first @theme block (this repo is Tailwind v4):
 *
 *   1. tailwind.config.js / tailwind.config.ts   — v3-style config, if a
 *      legacy config is ever reintroduced. Statically parsed (maxWidth /
 *      lineClamp theme keys + plain `safelist: [...]` string entries) —
 *      never imported/executed.
 *   2. tailwind.config.safe-list                 — flat whitespace-separated
 *      class list, if present.
 *   3. src/index.css @theme block                — Tailwind v4 CSS-first
 *      config: `--max-width-*` → `max-w-*`, `--line-clamp-*` →
 *      `line-clamp-*` tokens.
 *   4. src/index.css custom utility classes       — literal `.truncate-2`,
 *      `.line-clamp-4`, `.max-w-foo` style classes defined by hand.
 *
 * The defense family is deliberately the rule's accepted families PLUS
 * `text-ellipsis` (a real single-line truncation utility the regex does
 * not yet know — the canonical stale-regex case). If the team declares it,
 * the gate fails until DEFENSE_RE grows.
 *
 * Usage (pure gate — no --fix; fixing drift means editing DEFENSE_RE):
 *   node scripts/check-tailwind-rule-drift.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFENSE_RE } from "../eslint-rules/lib/jsx-utils.mjs";

const ROOT = process.cwd();
const SOURCES = [
  { kind: "tailwind.config.js", path: join(ROOT, "tailwind.config.js") },
  { kind: "tailwind.config.ts", path: join(ROOT, "tailwind.config.ts") },
  { kind: "tailwind.config.safe-list", path: join(ROOT, "tailwind.config.safe-list") },
  { kind: "src/index.css", path: join(ROOT, "src", "index.css") },
];

// A utility belongs to the defense family if it is one of the rule's
// accepted prefixes (`truncate`, `line-clamp`, `max-w-`) or the canonical
// not-yet-accepted single-line truncation utility `text-ellipsis`.
// NOTE: when the team introduces a NEW defense class outside these four
// prefixes (e.g. `overflow-ellipsis`, `text-clip`), extend this regex too
// — otherwise the gate cannot see it and drift goes undetected.
const DEFENSE_FAMILY_RE = /^(?:truncate|text-ellipsis|line-clamp|max-w-)/;

/** Pull plain string entries out of a `safelist: [...]` array. */
function extractSafelistStrings(text) {
  const out = [];
  const m = text.match(/safelist\s*:\s*\[([\s\S]*?)\]/);
  if (!m) return out;
  for (const lit of m[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
    out.push(lit[1]);
  }
  return out;
}

/** Pull `key:` names out of a `maxWidth: { key: v, ... }` theme block.
 *  NOTE: requires the closing brace on its own line — an inline v3 block
 *  like `maxWidth: { xl: '36rem' },` is skipped silently. No legacy config
 *  exists in this repo today, so this is future-proofing only; revisit if
 *  a real tailwind.config.{js,ts} ever lands with inline theme blocks. */
function extractThemeKeys(text, themeKey) {
  const out = [];
  const re = new RegExp(`${themeKey}\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    for (const k of m[1].matchAll(/(\b[\w-]+)\s*:/g)) out.push(k[1]);
  }
  return out;
}

/** Statically parse a v3-style tailwind.config.{js,ts} (never executed). */
function parseLegacyConfig(text) {
  const candidates = [];
  for (const entry of extractSafelistStrings(text)) candidates.push(entry);
  for (const key of extractThemeKeys(text, "maxWidth")) candidates.push(`max-w-${key}`);
  for (const key of extractThemeKeys(text, "lineClamp")) candidates.push(`line-clamp-${key}`);
  return candidates;
}

/** Parse the Tailwind v4 @theme block in a CSS file. */
function parseV4Theme(cssText) {
  const candidates = [];
  const block = cssText.match(/@theme\s*\{([\s\S]*?)\n\}/);
  if (block) {
    for (const m of block[1].matchAll(/--max-width-([\w-]+)\s*:/g)) {
      candidates.push(`max-w-${m[1]}`);
    }
    for (const m of block[1].matchAll(/--line-clamp-([\w-]+)\s*:/g)) {
      candidates.push(`line-clamp-${m[1]}`);
    }
  }
  return candidates;
}

/** Parse literal custom utility class definitions (.truncate-2 etc.). */
function parseCustomUtilityClasses(cssText) {
  const out = [];
  for (const m of cssText.matchAll(/\.([\w-]+)\s*\{/g)) {
    const name = m[1];
    if (DEFENSE_FAMILY_RE.test(name)) out.push(name);
  }
  return out;
}

/** Parse a flat safe-list file: whitespace/comma-separated class names. */
function parseSafeListFile(text) {
  return text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

/** @returns {Array<{source: string, utility: string, covered: boolean}>} */
function collectCandidates() {
  const rows = [];
  for (const { kind, path } of SOURCES) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    let utilities = [];
    if (kind === "tailwind.config.js" || kind === "tailwind.config.ts") {
      utilities = parseLegacyConfig(text);
    } else if (kind === "tailwind.config.safe-list") {
      utilities = parseSafeListFile(text);
    } else if (kind === "src/index.css") {
      utilities = [
        ...parseV4Theme(text),
        ...parseCustomUtilityClasses(text),
      ];
    }
    for (const utility of utilities) {
      if (!DEFENSE_FAMILY_RE.test(utility)) continue;
      rows.push({ source: kind, utility, covered: DEFENSE_RE.test(utility) });
    }
  }
  return rows;
}

const rows = collectCandidates();
const drift = rows.filter((r) => !r.covered);
const covered = rows.filter((r) => r.covered);

for (const { source, utility } of covered) {
  console.log(`[check-tailwind-rule-drift] ok  ${utility.padEnd(22)} (${source})`);
}
for (const { source, utility } of drift) {
  console.error(
    `[check-tailwind-rule-drift] DRIFT  ${utility.padEnd(22)} (${source}) — ` +
      `DEFENSE_RE in eslint-rules/lib/jsx-utils.mjs does not accept this defense utility; ` +
      `the no-unbounded-text rule would false-positive on it. Widen the regex or remove the declaration.`,
  );
}

const missing = SOURCES.filter(({ path }) => !existsSync(path))
  .map(({ kind }) => kind);
if (missing.length > 0) {
  console.log(`[check-tailwind-rule-drift] absent sources (ok): ${missing.join(", ")}`);
}

if (drift.length > 0) {
  console.error(
    `[check-tailwind-rule-drift] FAIL: ${drift.length} defense utility(ies) not covered by DEFENSE_RE`,
  );
  process.exit(1);
}

console.log(
  `[check-tailwind-rule-drift] ok: ${covered.length} defense utility(ies) covered, 0 drift`,
);
process.exit(0);
