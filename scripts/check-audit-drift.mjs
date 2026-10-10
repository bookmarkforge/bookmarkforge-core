/**
 * scripts/check-audit-drift.mjs — audit drift gate (batch-29).
 *
 * Turns the finding of scripts/gen-audit-report.mjs (placeholder and
 * untranslated-English audit) into a CI gate with a baseline, the same
 * pattern as scripts/check-i18n-quality.mjs:
 *
 *   node scripts/check-audit-drift.mjs            # gate — falla si delta > 0
 *   node scripts/check-audit-drift.mjs --fix      # rebaseline al estado actual
 *   node scripts/check-audit-drift.mjs --strict-discovery # zero-discoveries policy
 *   node scripts/check-audit-drift.mjs --strict   # compatibility spelling
 *
 * It also chains the regression-anchors gate (scripts/audit-anchors.mjs),
 * which fails when any post-audit hardening test has been removed. The
 * anchors are security decisions (ADR-026 / ADR-027) and cannot disappear
 * without an explicit ADR change — exactly the kind of silent regression
 * this gate catches. The canonical list lives in scripts/audit-anchors.mjs
 * (imported), not here, to avoid duplication.
 *
 * The audit reports 0 affected keys today; the baseline is committed at that
 * level so the PR that reintroduces a raw placeholder (A) or untranslated
 * English (B) breaks CI, while keeping the status quo passes. The
 * classification lives ONLY in scripts/audit-core.mjs — shared with the
 * report generator — so any threshold change is reflected in both.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAudit } from "./audit-core.mjs";
import {
  runAuditAnchors,
  strictDiscoveryRequested,
} from "./audit-anchors.mjs";

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, "scripts", "audit-drift-baseline.json");

const { files, perLang, total, unique, all29 } = runAudit();

let baseline = { locales: {}, unique: 0, updatedAt: null };
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

let failures = 0;

// Per-locale totals: placeholders (A) + untranslated English (B). A
// regression in any locale (NET new broken values) pushes the count above
// its baseline. A new locale without a baseline entry starts at 0 — if it
// brings issues, it fails (the desired behavior).
for (const [lang, counts] of Object.entries(perLang)) {
  const prev = baseline.locales?.[lang]?.issues ?? 0;
  const issues = counts.a + counts.b;
  const delta = issues - prev;
  if (issues > prev) {
    console.error(
      `[check-audit-drift] FAIL ${lang}: ${issues} (baseline ${prev}, delta +${delta}) — ` +
        `placeholders A=${counts.a}, untranslated B=${counts.b}`,
    );
    failures += 1;
  } else {
    console.log(
      `[check-audit-drift] ok ${lang}: ${issues} (baseline ${prev}, delta ${delta})`,
    );
  }
}

// Unique keys affected in total: a new broken key shows up here even if it
// touches a single language (the per-locale line already fails too). This
// metric does NOT catch net-zero movements (a key fixed in one locale and
// broken in another that already had issues changes neither unique nor any
// per-locale count) — it is an informative root-cause metric, not additional
// coverage. Deltas are measured per-locale: a bug landing in a clean locale
// (0→1) is caught by the per-locale line.
if (unique > baseline.unique) {
  console.error(
    `[check-audit-drift] FAIL unique keys: ${unique} (baseline ${baseline.unique})`,
  );
  failures += 1;
} else {
  console.log(
    `[check-audit-drift] ok unique: ${unique} (baseline ${baseline.unique})`,
  );
}

console.log(
  `[check-audit-drift] totals: ${total} values across ${unique} keys, ${all29} broken in all ${files.length} locales`,
);

// ---------------------------------------------------------------------------
// Regression anchors — chained here so a single `npm run check:audit-drift`
// covers both gates and `npm run check:audit-drift:fix` refreshes both
// baselines. Adding or removing an anchor is an ADR-level change, not a
// baseline action; see scripts/audit-anchors.mjs for the catalog.
// ---------------------------------------------------------------------------
const fixMode = process.argv.includes("--fix");
const strictDiscovery = strictDiscoveryRequested(process.argv);
const anchorReport = runAuditAnchors({
  fix: fixMode,
  strictDiscovery,
});
for (const present of anchorReport.present) {
  // Open Core export: an anchor whose subject is entirely replaced by the Pro
  // boundary resolves to nothing. That is an explicit skip — visible, counted
  // separately, and never mistaken for a real resolution.
  if (present.proBoundarySkip) {
    console.log(
      `[check-audit-drift] anchor SKIP ${present.id} — subject replaced by the Open Core Pro boundary in this tree`,
    );
    continue;
  }
  const matchLabel =
    present.matches.length === 1
      ? present.matches[0]
      : `${present.matches.length} files`;
  console.log(
    `[check-audit-drift] anchor ok ${present.id} — ${matchLabel}`,
  );
}
for (const missing of anchorReport.failures) {
  if (missing.type === "malformed-catalog") {
    console.error(
      `[check-audit-drift] anchor FAIL malformed catalog ${missing.id} — ` +
        `${missing.description}: ${missing.glob}`,
    );
  } else if (missing.type === "catalog-inflation") {
    console.error(
      `[check-audit-drift] anchor FAIL catalog inflation ${missing.id} — ` +
        missing.description,
    );
  } else if (missing.type === "strict-discovery") {
    console.error(
      `[check-audit-drift] FAIL strict discovery — ${missing.description}: ` +
        missing.matches.join(", "),
    );
  } else {
    console.error(
      `[check-audit-drift] anchor FAIL ${missing.id} (${missing.adr}) — ` +
        `no file matches ${missing.glob} (${missing.description})`,
    );
  }
  failures += 1;
}
// Surface new canonical-shape regression tests that are not in the anchor
// catalog. Default mode is advisory; `--strict` makes these discoveries fatal.
for (const d of anchorReport.discovered ?? []) {
  const basename = d.split("/").pop() ?? d;
  console.log(
    `[check-audit-drift] anchor NEW ${basename} discovered — not yet anchored (add to scripts/audit-anchors.mjs ANCHORS[] to formalize)`,
  );
}
const missingAnchorCount = anchorReport.failures.filter(
  (failure) => !failure.type,
).length;
const proBoundarySkips = anchorReport.present.filter(
  (present) => present.proBoundarySkip,
).length;
const discoveryPolicy = strictDiscovery ? "strict" : "advisory";
console.log(
  `[check-audit-drift] anchor totals: ${anchorReport.present.length}/${anchorReport.total} present ` +
    `(${proBoundarySkips} skipped by the Open Core Pro boundary), ${missingAnchorCount} missing, ` +
    `${anchorReport.discovered?.length ?? 0} discovered (${discoveryPolicy})`,
);

if (process.argv.includes("--fix")) {
  const next = {
    locales: Object.fromEntries(
      Object.entries(perLang).map(([lang, counts]) => [
        lang,
        { issues: counts.a + counts.b },
      ]),
    ),
    unique,
    total,
    all29,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
  console.log(
    `[check-audit-drift] baseline updated: ${Object.keys(perLang).length} locales, unique=${unique}`,
  );
}

if (failures > 0) {
  console.error(`[check-audit-drift] ${failures} failure(s)`);
  process.exit(1);
}
