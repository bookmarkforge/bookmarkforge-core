/**
 * scripts/i18n-completeness.mjs — translation completeness gate.
 *
 * Compares every locale in public/locales/ against the English source
 * (en.json) and verifies the untranslated-key backlog does not regress
 * beyond the committed baseline (scripts/i18n-backlog-baseline.json).
 *
 * ALSO verifies the code → en.json direction: every t() key requested in
 * src/ must be defined in en.json (static literals and registered dynamic
 * patterns alike). A key used in code but missing from the English source
 * renders as the raw key or the t() fallback in every language, so this
 * check is NOT baseline-able — it always fails hard.
 *
 * Usage:
 *   node scripts/i18n-completeness.mjs            # gate (fail on regression)
 *   node scripts/i18n-completeness.mjs --fix      # update the baseline
 *
 * The baseline records each locale's untranslated count at the last
 * intentional change. Translators lower it; code changes may raise it
 * slightly — raising it requires an explicit `--fix` commit so regressions
 * stay visible in review.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LOCALES_DIR = join(ROOT, "public", "locales");
const BASELINE_PATH = join(ROOT, "scripts", "i18n-backlog-baseline.json");
const MAX_REGRESSION = 50;

/** Flatten a nested JSON dictionary into dotted keys. */
function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else if (typeof v === "string") {
      out[key] = v;
    }
  }
  return out;
}

const files = readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

const en = flatten(JSON.parse(readFileSync(join(LOCALES_DIR, "en.json"), "utf8")));
const enKeys = Object.keys(en);

let baseline = { total: enKeys.length, locales: {}, updatedAt: null };
if (existsSync(BASELINE_PATH)) {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

const results = [];
let failures = 0;

for (const file of files) {
  if (file === "en.json") continue;
  const locale = file.replace(/\.json$/, "");
  const dict = flatten(JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8")));
  const missing = enKeys.filter((k) => dict[k] === undefined);
  const prev = baseline.locales?.[locale]?.untranslated ?? missing.length;
  const delta = missing.length - prev;

  if (missing.length > prev + MAX_REGRESSION) {
    console.error(
      `[i18n-completeness] FAIL ${locale}: ${missing.length} untranslated ` +
        `(baseline ${prev}) — regression > ${MAX_REGRESSION}; run --fix only if intentional`,
    );
    failures += 1;
  } else {
    const sign = delta > 0 ? "+" : "";
    console.log(
      `[i18n-completeness] ok ${locale}: ${missing.length}/${enKeys.length} ` +
        `untranslated (baseline ${prev}, delta ${sign}${delta})`,
    );
  }
  results.push({ locale, total: enKeys.length, untranslated: missing.length });
}

// ————————————————————————————————————————————————————————————————
// Code → en.json key coverage.
//
// The per-locale loop above can only verify keys that EXIST in en.json; a
// t() call referencing a key missing from the English source is invisible
// to it — the UI renders the raw key or the t() fallback. This section
// scans src/ for every key the app actually requests and fails hard when
// one is not defined in en.json (no baseline tolerance, unlike the
// untranslated backlog).
//
// Scope: src/**/*.ts(x), excluding tests (src/tests/**, *.test.*, *.spec.*,
// __tests__, mocks) — same convention as src/tests/i18n/coverage.test.ts.
// Forms recognized: t("key") / t('key') / t(`key`) / i18n.t("key") /
// <Trans i18nKey="key">. Non-literal (dynamic) constructions cannot be
// expanded statically, so each pattern MUST be registered in
// DYNAMIC_KEY_EXPANSIONS below with the exact keys it produces; every
// registered key is verified against en.json, and an unregistered pattern
// fails CI so new dynamic constructions are a deliberate, reviewed change.
const SRC_DIR = join(ROOT, "src");

function walkCodeFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === SRC_DIR && entry.name === "tests") continue;
      if (entry.name === "__tests__" || entry.name === "mocks") continue;
      if (entry.name.startsWith(".")) continue;
      walkCodeFiles(p, acc);
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)
    ) {
      acc.push(p);
    }
  }
  return acc;
}

/** Static quoted first-arg, excluding concat ("day_" + d) which is dynamic. */
const STATIC_T_RE = /\bt\s*\(\s*["']([^"']+)["'](?!\s*\+)/g;
/** Backtick template first-arg; without ${} it is a static key. */
const TEMPLATE_T_RE = /\bt\s*\(\s*`([^`]*)`/g;
/** Concat first-arg: t("prefix" + expr) → dynamic signature "prefix"+${x}. */
const CONCAT_T_RE = /\bt\s*\(\s*["']([^"']+)["']\s*\+/g;
/** react-i18next <Trans i18nKey="key" />. */
const TRANS_KEY_RE = /i18nKey\s*=\s*["']([^"']+)["']/g;

/**
 * Dynamic key patterns and the exact keys they expand to. Keep in sync with
 * the variable domains at each call site (CustomPromptsSection's key list,
 * CalendarView's DAYS array). Any t() construction not listed here fails CI.
 */
const DYNAMIC_KEY_EXPANSIONS = {
  "app_${x}PromptLabel": [
    "app_summarizePromptLabel",
    "app_taggingPromptLabel",
    "app_chatPromptLabel",
  ],
  "app_${x}PromptPlaceholder": [
    "app_summarizePromptPlaceholder",
    "app_taggingPromptPlaceholder",
    "app_chatPromptPlaceholder",
  ],
  "day_${x}": [
    "day_sun", "day_mon", "day_tue", "day_wed", "day_thu", "day_fri", "day_sat",
  ],
  "app_maintenanceReason_${x}": [
    "app_maintenanceReason_vault-locked",
    "app_maintenanceReason_disabled",
    "app_maintenanceReason_page-hidden",
    "app_maintenanceReason_battery-low",
    "app_maintenanceReason_memory-pressure",
  ],
};

const staticUsage = new Map(); // key -> Set(file)
const dynamicUsage = new Map(); // signature -> Set(file)
for (const file of walkCodeFiles(SRC_DIR)) {
  const text = readFileSync(file, "utf8");
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
  let m;
  for (const re of [STATIC_T_RE, TEMPLATE_T_RE, CONCAT_T_RE, TRANS_KEY_RE]) {
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const arg = m[1];
      let sig;
      if (re === CONCAT_T_RE) {
        // t("prefix" + expr): the prefix alone is never the key — the
        // registry entry "prefix${x}" carries the expanded keys.
        sig = arg + "${x}";
      } else if (arg.includes("${")) {
        // t(`app_${key}…`): normalize every interpolated segment to ${x}.
        sig = arg.replace(/\$\{[^}]*\}/g, "${x}");
      }
      if (sig !== undefined) {
        if (!dynamicUsage.has(sig)) dynamicUsage.set(sig, new Set());
        dynamicUsage.get(sig).add(rel);
      } else {
        if (!staticUsage.has(arg)) staticUsage.set(arg, new Set());
        staticUsage.get(arg).add(rel);
      }
    }
  }
}

const codeKeyIssues = [];
for (const [key, filesSet] of staticUsage) {
  if (en[key] === undefined) {
    codeKeyIssues.push(
      `t("${key}") — missing from en.json (used in ${[...filesSet].join(", ")})`,
    );
  }
}
for (const [sig, filesSet] of dynamicUsage) {
  const expansions = DYNAMIC_KEY_EXPANSIONS[sig];
  if (!expansions) {
    codeKeyIssues.push(
      `unregistered dynamic key pattern t(\`${sig}\`) — add its expansions to ` +
        `DYNAMIC_KEY_EXPANSIONS in scripts/i18n-completeness.mjs (used in ` +
        `${[...filesSet].join(", ")})`,
    );
    continue;
  }
  for (const key of expansions) {
    if (en[key] === undefined) {
      codeKeyIssues.push(
        `dynamic key "${key}" (pattern ${sig}) — missing from en.json ` +
          `(used in ${[...filesSet].join(", ")})`,
      );
    }
  }
}

if (codeKeyIssues.length > 0) {
  console.error(
    `[i18n-completeness] FAIL code: ${codeKeyIssues.length} t() key(s) missing from en.json —\n  ` +
      codeKeyIssues.join("\n  "),
  );
  failures += 1;
} else {
  console.log(
    `[i18n-completeness] ok code: ${staticUsage.size} static + ${dynamicUsage.size} dynamic t() key pattern(s) used in src/, all present in en.json`,
  );
}

if (process.argv.includes("--fix")) {
  const next = {
    total: enKeys.length,
    locales: Object.fromEntries(results.map((r) => [r.locale, { untranslated: r.untranslated }])),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
  console.log(`[i18n-completeness] baseline updated: ${results.length} locales`);
}

if (failures > 0) {
  console.error(`[i18n-completeness] ${failures} failure(s)`);
  process.exit(1);
}
