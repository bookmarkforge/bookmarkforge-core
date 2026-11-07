/**
 * scripts/check-e2e-selectors.mjs
 *
 * Cross-references every selector used by tests/e2e/** against production
 * code (src/, excluding its own tests) so a fabricated selector — one that
 * exists only in a unit-test mock, like the lazy BlockNoteView stub's
 * "blocknote-view" — can never reach an E2E spec unnoticed. A fabricated
 * selector in an E2E is a selector that can never fail on production drift:
 * if production renames or drops the attribute, the spec times out (or worse,
 * was passing against nothing at all), which is exactly the failure class the
 * mock-audit (self-verifying mocks) exposed on the unit side.
 *
 * Verified selector classes (three tiers):
 *   1. LITERAL: `data-testid="x"` and `[data-attr="y"]` as literals must
 *      appear in production source.
 *   2. DYNAMIC BINDING, checked EXACTLY: production renders some attributes
 *      via JSX bindings (`data-tab-id={item.id}`), so the attribute never
 *      appears as a literal. For those (DYNAMIC_ATTRS) the gate imports the
 *      shared constants module that production itself consumes —
 *      src/constants/navigation.ts (tab ids) and src/constants/locales.ts
 *      (locale codes; same zero-side-effect contract text-fit-helpers.ts
 *      already relies on) — under Node 24 type-stripping and checks the E2E
 *      value against the EXACT exported set. A value outside the set fails;
 *      so does a constants module that no longer exports the expected
 *      symbols. If the import fails (non-Node-24 runtime, moved file), the
 *      gate falls back to a string-literal scan but marks every dynamic
 *      value as UNVERIFIED and exits 1 — a silently weakened gate is worse
 *      than a red build.
 *   3. INTERPOLATED: `locator(`[attr="${var}"]`)` cannot be resolved
 *      mechanically. Each one must be verified BY HAND against production
 *      and documented in MANUALLY_VERIFIED with the evidence; an undocumented
 *      interpolated selector fails the gate.
 *
 * Tripwires: known mock-only selectors (unit-test stub testids) must NEVER
 * appear in any E2E file — a leak fails even if the file has no other issue.
 *
 * Wired as a named step of the `quality` job in .github/workflows/ci.yml so
 * a fabricated selector surfaces as its own red check instead of being
 * buried in a generic failure.
 *
 * CLI: `node scripts/check-e2e-selectors.mjs` — exit 0 clean, exit 1 with
 * FAIL lines otherwise. E2E_SELECTOR_AUDIT_ROOT optionally overrides the
 * repo root — a test/isolation hook so CLI exit codes can be exercised
 * against fixture trees without chdir races (same pattern as
 * scripts/check-brand-logo-consistency.mjs).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = process.cwd();

// ---- Allowlist for data-attr values that cannot be verified by either
// tier below. Every entry must carry a provenance reason; an entry without
// one is a bug in this scanner, not a pass.
// (Class selectors like ".bn-editor" are out of scope by design: they are a
// third-party @blocknote contract, not an our-source testid/attr, and the
// MOCK_ONLY tripwires below cover the mock-only class of risk.)
const ALLOWLIST = new Set([]);

// Attributes production renders via JSX bindings, mapped to the shared
// constants module that is the attribute's exact value space. Each module
// exports a CSV PROJECTION of its own typed array (e.g.
// `DATA_TAB_ID_VALUES_CSV = DATA_TAB_ID_VALUES.join(",")`), derived in the
// same tsc-checked module so it cannot drift from the array. The gate reads
// that literal from the file text — no .ts execution — so it works on any
// Node runtime (including Node 20 CI, which cannot type-strip) and under
// vitest (whose module graph cannot load repo-external .ts fixtures).
const DYNAMIC_ATTRS = new Map([
  [
    "data-tab-id",
    {
      file: "src/constants/navigation.ts",
      symbols: ["DATA_TAB_ID_VALUES_CSV"],
      // Sidebar.tsx / SupportChat.tsx render data-tab-id={item.id}.
      description: "sidebar + support-center tab ids",
    },
  ],
  [
    "data-bottom-nav-tab",
    {
      file: "src/constants/navigation.ts",
      symbols: ["BOTTOM_NAV_TAB_ID_VALUES_CSV"],
      // BottomNav.tsx renders data-bottom-nav-tab={item.id}.
      description: "mobile bottom-nav tab ids",
    },
  ],
  [
    "data-language-code",
    {
      file: "src/constants/locales.ts",
      symbols: ["SUPPORTED_LOCALE_CODES_CSV"],
      // LanguageSelector.tsx renders data-language-code={lang.code}.
      description: "UI locale codes",
    },
  ],
]);

// Interpolated E2E values (locator(`[attr="${var}"]`)) cannot be resolved
// mechanically; each one must be verified BY HAND and documented here.
const MANUALLY_VERIFIED = new Map([
  [
    'data-language-code="${code}"',
    "vault-locale-switch.spec.ts iterates the 30-locale list. Exact source: " +
      "src/constants/locales.ts SUPPORTED_LOCALE_CODES — the same constant " +
      "this gate imports for the literal tier — verified 30/30 including " +
      "the RTL pair ar/he the test also asserts.",
  ],
]);

// Unit-test stub testids that production never renders. Their presence in an
// E2E file is always a fabrication leak.
const MOCK_ONLY = [
  "blocknote-view",
  "panel-chat",
  "panel-history",
  "panel-backlinks",
  "panel-agents",
];

function walkFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) walkFiles(p, acc);
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) acc.push(p);
  }
  return acc;
}

/** Collect every selector used by the E2E tree, by class. */
export function collectUsedSelectors(e2eRoot) {
  const files = walkFiles(e2eRoot).filter((f) => !f.includes("-snapshots"));
  const usedTestIds = new Set();
  const usedDataAttrs = new Map(); // attr -> Set of values
  const usedAriaLabelledby = new Set();

  for (const f of files) {
    const text = readFileSync(f, "utf8");
    // data-testid="x"  (JSX attr + locator('[data-testid="x"]') + helpers)
    for (const m of text.matchAll(/data-testid=["']([^"']+)["']/g)) {
      usedTestIds.add(m[1]);
    }
    // getByTestId("x")
    for (const m of text.matchAll(/getByTestId\(\s*["']([^"']+)["']\s*\)/g)) {
      usedTestIds.add(m[1]);
    }
    // locator('[data-x="y"]') — any data-* attribute with a literal value
    for (const m of text.matchAll(
      /\[\s*(data-[a-z-]+)\s*=\s*["']([^"']+)["']\s*\]/g,
    )) {
      if (!usedDataAttrs.has(m[1])) usedDataAttrs.set(m[1], new Set());
      usedDataAttrs.get(m[1]).add(m[2]);
    }
    // [aria-labelledby="z"]
    for (const m of text.matchAll(/aria-labelledby\s*=\s*["']([^"']+)["']/g)) {
      usedAriaLabelledby.add(m[1]);
    }
  }
  return { files, usedTestIds, usedDataAttrs, usedAriaLabelledby };
}

/** Load the production corpus (src/**, excluding src/tests) as one string. */
export function loadProductionCorpus(srcRoot) {
  const files = [];
  (function walkSrc(dir, relDir = "") {
    for (const entry of readdirSync(dir)) {
      const rel = relDir ? `${relDir}/${entry}` : entry;
      // The production corpus excludes the project's own test tree
      // (src/tests/**): unit-test mocks define selectors like
      // "blocknote-view" that production never renders, and counting them
      // would make the gate pass on fabrications.
      if (rel === "tests" || rel.startsWith("tests/")) continue;
      const p = join(dir, entry);
      let s;
      try {
        s = statSync(p);
      } catch {
        continue;
      }
      if (s.isDirectory()) walkSrc(p, rel);
      else if (/\.(ts|tsx)$/.test(entry)) files.push(p);
    }
  })(srcRoot);
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}

/**
 * Extract the CSV projections from the shared constants files and build
 * attr -> Set(values).
 *
 * Returns { vocabulary, errors }. On any read/parse error the attr's entry
 * is absent and `errors` carries a FAIL line — the caller must not
 * silently fall back to a weaker check (see header, tier 2).
 *
 * Defense in depth: every CSV entry must also appear as a plain string
 * literal in the same file. With the projection derived from the array
 * (`.join(",")`) this always holds; it fails if someone hardcodes the CSV
 * or breaks the derivation, keeping the file the single source of truth.
 */
export function loadVocabularyFromSource(root) {
  const vocabulary = new Map(); // attr -> Set<string>
  const errors = [];

  for (const [attr, spec] of DYNAMIC_ATTRS) {
    const fileAbs = join(root, spec.file);
    let text;
    try {
      text = readFileSync(fileAbs, "utf8");
    } catch (e) {
      errors.push(
        `dynamic-vocabulary load failed for ${attr} (${spec.description}): ` +
          `cannot read ${spec.file}: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }

    const values = new Set();
    let ok = true;
    for (const sym of spec.symbols) {
      const m = text.match(
        new RegExp(`export const ${sym}\\s*=\\s*"([^"]*)"`),
      );
      if (!m) {
        errors.push(
          `${spec.file} does not contain the CSV projection export ` +
            `"${sym}" — the projection contract documented in that file's ` +
            `header was broken; cannot verify ${attr} values exactly`,
        );
        ok = false;
        continue;
      }
      for (const v of m[1].split(",")) {
        if (v) values.add(v);
      }
    }

    if (ok) {
      for (const v of values) {
        if (!text.includes(`"${v}"`)) {
          errors.push(
            `${spec.file}: the ${attr} CSV projection contains "${v}" ` +
              `which is not a string literal in the same file — the ` +
              `projection must stay derived from the typed array`,
          );
          ok = false;
        }
      }
    }

    if (ok) {
      vocabulary.set(attr, values);
    }
  }
  return { vocabulary, errors };
}

/**
 * Run every tier + tripwire; returns { verified, failures }.
 *
 * `vocabulary` (attr -> Set of exact values) upgrades tier 2 from a
 * string-literal scan to an exact check against the shared constants. When
 * an attr has no vocabulary entry, the fallback scan still runs but emits
 * an UNVERIFIED failure so a weakened gate is visible.
 */
export function evaluateSelectorContract(e2eRoot, srcRoot, { vocabulary } = {}) {
  const { files, usedTestIds, usedDataAttrs, usedAriaLabelledby } =
    collectUsedSelectors(e2eRoot);
  const srcText = loadProductionCorpus(srcRoot);

  const verified = [];
  const failures = [];

  // Tier 1: literal testids.
  for (const id of [...usedTestIds].sort()) {
    if (
      srcText.includes(`data-testid="${id}"`) ||
      srcText.includes(`data-testid='${id}'`)
    ) {
      verified.push(`testid  ${id}`);
    } else {
      failures.push(
        `testid "${id}" used in E2E but not found in production src/`,
      );
    }
  }

  // Tier 2 (exact via shared constants) / fallback for data attributes.
  for (const [attr, values] of [...usedDataAttrs.entries()].sort()) {
    const exact = vocabulary?.get(attr);
    for (const v of [...values].sort()) {
      const needle = `${attr}="${v}"`;
      if (srcText.includes(needle) || ALLOWLIST.has(needle)) {
        verified.push(`attr    ${needle}`);
      } else if (v.includes("${")) {
        // Tier 3: interpolated — only a documented manual verification passes.
        if (MANUALLY_VERIFIED.has(needle)) {
          verified.push(
            `attr    ${needle}  (manual: ${MANUALLY_VERIFIED.get(needle).slice(0, 80)}...)`,
          );
        } else {
          failures.push(
            `${needle} is interpolated in E2E — verify the value set against production by hand, then document it in MANUALLY_VERIFIED`,
          );
        }
      } else if (exact) {
        if (exact.has(v)) {
          verified.push(
            `attr    ${needle}  (exact: shared constants ${DYNAMIC_ATTRS.get(attr).file})`,
          );
        } else {
          failures.push(
            `${needle} is not in the shared constants ${DYNAMIC_ATTRS.get(attr).file} (${DYNAMIC_ATTRS.get(attr).description}) — the tab id was renamed or removed`,
          );
        }
      } else if (srcText.includes(`"${v}"`)) {
        // Fallback (no vocabulary available): string-literal scan. Reported
        // as a failure so an exact-tier outage is never silent.
        failures.push(
          `${needle} matched only by fallback string scan — vocabulary unavailable for ${attr}, fix loadVocabularyFromSource`,
        );
      } else {
        failures.push(`${needle} used in E2E but not found in production src/`);
      }
    }
  }

  // aria-labelledby targets must exist as real ids.
  for (const id of [...usedAriaLabelledby].sort()) {
    if (srcText.includes(`id="${id}"`)) {
      verified.push(`aria    #${id}`);
    } else {
      failures.push(
        `[aria-labelledby="${id}"] used in E2E but no id="${id}" in production src/`,
      );
    }
  }

  // Tripwires: mock-only stub testids must never leak into E2E.
  for (const sel of MOCK_ONLY) {
    const hit = files.filter((f) => readFileSync(f, "utf8").includes(sel));
    if (hit.length > 0) {
      failures.push(
        `mock-only selector "${sel}" (unit-test stub) leaked into E2E: ${hit.join(", ")}`,
      );
    } else {
      verified.push(`clean   "${sel}" absent from E2E (unit-stub tripwire)`);
    }
  }

  return { verified, failures };
}

async function main(root = REPO_ROOT) {
  const e2eRoot = join(root, "tests", "e2e");
  const srcRoot = join(root, "src");

  const { vocabulary, errors } = loadVocabularyFromSource(root);
  const { verified, failures } = evaluateSelectorContract(e2eRoot, srcRoot, {
    vocabulary,
  });
  failures.unshift(...errors);

  console.log(`E2E selector audit — tests/e2e scanned.`);
  console.log(
    `  vocabulary: ${[...DYNAMIC_ATTRS.keys()]
      .map((a) => (vocabulary.has(a) ? `${a} ✓` : `${a} ✗`))
      .join(", ")}`,
  );
  console.log(`  verified: ${verified.length}`);
  for (const v of verified) console.log(`    ok  ${v}`);
  if (failures.length > 0) {
    console.error(`\n  FAILURES: ${failures.length}`);
    for (const f of failures) console.error(`    FAIL  ${f}`);
    console.error(
      "\nA selector that exists only in a unit-test mock (or a typo) reached tests/e2e,",
    );
    console.error(
      "or the shared constants modules drifted. Fix the selector / constants, or (for new interpolated classes) document them in MANUALLY_VERIFIED with evidence.",
    );
    process.exit(1);
  }
  console.log(
    "\nAll E2E selectors resolve to production code (or a documented allowance).",
  );
}

function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryBase = entry.split(/[\\/]/).pop();
  const moduleBase = import.meta.url.split("/").pop();
  return entryBase === moduleBase;
}

if (isDirectInvocation()) {
  const envRoot = process.env.E2E_SELECTOR_AUDIT_ROOT;
  // No top-level await: vitest transforms this module too (the contract
  // tests import it), and TLA changes that pipeline. main() always exits
  // the process on completion or failure, so the floating promise is safe.
  main(envRoot ? resolve(envRoot) : REPO_ROOT).catch((e) => {
    console.error("selector gate crashed:", e);
    process.exit(1);
  });
}
