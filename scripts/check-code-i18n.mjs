/**
 * check-code-i18n.mjs — code-vs-keys interpolation gate (batch-38).
 *
 * Every other i18n gate compares locales against en.json; NONE compares the
 * SOURCE CODE against the keys. That blind spot shipped real bugs:
 *
 *   - app_daysAgo / app_lastReadDaysAgo are plural keys ("{{count}} days
 *     ago" + _one/_few forms in cs/pl/ru/uk/hr) but call sites passed
 *     { days } — i18next never found `count`, so the UI rendered the literal
 *     "{{count}}" placeholder (or an empty slot) in ALL 30 languages.
 *   - t("app_storageVectors", "Vector Embeddings") called the tooltip key
 *     (which carries {{size}}) without options — the legend label rendered
 *     the placeholder instead of a static label.
 *
 * What this gate checks, for every literal-key t("key", ...) call in
 * src/ (tests and mocks excluded, mirroring src/tests/i18n/coverage.test.ts):
 *
 *   1. The key exists in en.json (flat keys + dot-keys), else the call can
 *      only ever render a fallback / raw key.
 *   2. Every {{placeholder}} in the en.json value is provided in the call's
 *      options object — either as `name:` or as shorthand `name,`. i18next
 *      auto-injects `count` for plural keys (_one/_few/_many/_other suffix
 *      or siblings), so `count` is considered provided.
 *
 * Not baseline-able: a wrong/missing interpolation argument or a dead key is
 * always a defect, like the en single-brace/brand-casing scans.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = "src";
const EN_PATH = "public/locales/en.json";
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", "dist-extension"]);
// Mirror coverage.test.ts scope: test fixtures and mocks use sentinel keys.
const SKIP_PATH = /(^|[\\/])(tests|mocks|__tests__)([\\/]|$)|\.(test|spec)\.(ts|tsx)$/;

const en = JSON.parse(readFileSync(EN_PATH, "utf8"));

// Flatten en.json: plain keys AND dot-keys (app.invalidPassword) both exist.
const flat = {};
(function walk(obj, prefix) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") flat[key] = v;
    else if (v && typeof v === "object") walk(v, key);
  }
})(en, "");

const files = [];
(function walkDir(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walkDir(p);
    } else if (/\.(ts|tsx)$/.test(name) && !SKIP_PATH.test(p)) {
      files.push(p);
    }
  }
})(SRC_DIR);

const PLURAL_SUFFIX = /(_one|_few|_many|_other|_zero|_two)$/;
const placeholderRe = /\{\{\s*([^}]+?)\s*\}\}/g;
// Literal first argument only (dynamic keys like `agent_${x}` can't be
// validated statically and are skipped by design).
const callRe = /\bt\(\s*(?:"([^"]+)"|'([^']+)')\s*,/g;

let calls = 0;
const issues = [];
const missingKeys = new Map();

for (const file of files) {
  const src = readFileSync(file, "utf8");
  callRe.lastIndex = 0;
  let m;
  while ((m = callRe.exec(src))) {
    const key = m[1] ?? m[2];
    const baseKey = key.replace(PLURAL_SUFFIX, "");
    calls++;
    const enVal = flat[baseKey] ?? flat[key];
    if (enVal === undefined) {
      if (!missingKeys.has(key)) missingKeys.set(key, []);
      missingKeys.get(key).push(file);
      continue;
    }
    const pluralKey =
      key !== baseKey ||
      flat[`${baseKey}_one`] !== undefined ||
      flat[`${baseKey}_few`] !== undefined;

    // Extract the rest of the call (balanced parens) to find the options.
    let depth = 0;
    let i = m.index + m[0].length;
    let seg = "";
    while (i < src.length) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth <= 0) break;
        depth--;
      }
      seg += ch;
      i++;
    }
    // Options object = the LAST top-level {...} in the segment (i18next
    // options are the final argument). Braces inside string literals
    // ("...{{reason}}..." fallbacks, URLs) must be ignored — track string
    // state so `{{` placeholders never count as object braces.
    const optNames = new Set();
    let open = -1;
    let close = -1;
    let depth2 = 0;
    let quote = null;
    let esc = false;
    for (let j = 0; j < seg.length; j++) {
      const ch = seg[j];
      if (quote) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "{") {
        if (depth2 === 0) open = j;
        depth2++;
      } else if (ch === "}") {
        depth2--;
        if (depth2 === 0) close = j;
      }
    }
    if (open >= 0 && close > open) {
      const body = seg.slice(open + 1, close);
      // Split into top-level fragments by commas (ignoring nested braces,
      // parens, strings) so `{ mode: x, memory }` yields both `mode:`
      // (named) and `memory` (shorthand).
      const parts = [];
      let cur = "";
      let d = 0;
      quote = null;
      esc = false;
      for (const ch of body) {
        if (quote) {
          cur += ch;
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
        if (ch === "{" || ch === "(") d++;
        else if (ch === "}" || ch === ")") d--;
        if (ch === "," && d === 0) {
          parts.push(cur);
          cur = "";
        } else cur += ch;
      }
      if (cur.trim()) parts.push(cur);
      for (const part of parts) {
        const t = part.trim();
        if (!t) continue;
        const named = t.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/);
        if (named) optNames.add(named[1]);
        else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)) optNames.add(t);
      }
    }
    if (pluralKey) optNames.add("count");

    placeholderRe.lastIndex = 0;
    const placeholders = [...enVal.matchAll(placeholderRe)].map((p) => p[1].trim());
    if (placeholders.length === 0) continue;
    for (const ph of placeholders) {
      if (!optNames.has(ph)) {
        issues.push(
          `${file}: t("${key}") → {{${ph}}} not provided (opts: ${[...optNames].join(", ") || "none"}) | en: "${enVal.replace(/\s+/g, " ").slice(0, 80)}${enVal.length > 80 ? "…" : ""}"`,
        );
        break;
      }
    }
  }
}

let failures = 0;
for (const [key, occ] of missingKeys) {
  console.error(
    `[check-code-i18n] FAIL: t("${key}") in ${occ.length} file(s) — key not in en.json (first: ${occ[0]})`,
  );
  failures += 1;
}
if (issues.length > 0) {
  console.error(
    `[check-code-i18n] FAIL: ${issues.length} interpolation issue(s) — ` +
      issues.slice(0, 4).join("\n  ") + (issues.length > 4 ? "\n  …" : ""),
  );
  failures += issues.length;
}
if (failures > 0) {
  process.exit(1);
}
console.log(
  `[check-code-i18n] ok: ${calls} literal t() calls, all keys present and all placeholders provided`,
);
