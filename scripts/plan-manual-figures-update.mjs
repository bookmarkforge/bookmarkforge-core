#!/usr/bin/env node
/**
 * scripts/plan-manual-figures-update.mjs
 *
 * Change-planning companion to check-manual-figures.mjs (ADR-049). When a
 * pricing/license/config constant changes in code, the manual-figures and
 * page-figures gates start failing — this tool answers "which exact lines do
 * I have to update?" BEFORE you touch the docs.
 *
 *   node scripts/plan-manual-figures-update.mjs --set proRegularPrice=70
 *   node scripts/plan-manual-figures-update.mjs --set freeMaxBookmarks=2000 --pages
 *   node scripts/plan-manual-figures-update.mjs --set refundDays=45 --json
 *
 * Mechanism: the tree must be green (else error). Each requested key is
 * probed by re-running the shared evaluator over every manual (and, with
 * --pages, every generated page) with ONE sentinel value substituted into
 * the truth — a value that is not itself quotable under the canonical sets,
 * so the probe changes exactly the rule it targets. A line that fails under
 * the new truth but not under the current one must be updated; the failure
 * message carries the offending figure, file and line.
 *
 * Exit codes: 0 plan printed (possibly "no lines affected"), 1 red baseline,
 * 2 usage/config errors (unknown key, non-numeric value, no-op change).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

const MANUAL_GATE = await import(
  pathToFileURL(join(THIS_DIR, "check-manual-figures.mjs")).href
);
const PAGE_GATE = await import(
  pathToFileURL(join(THIS_DIR, "check-page-figures.mjs")).href
);

/** Keys a caller may change, with the sentinel each probe uses. Sentinels
 * must never collide with a canonical value the rules assert (nor trigger a
 * rule by themselves: bookmark/supply sentinels are not round hundreds). */
export const PROBES = {
  proPrice: 10,
  proEarlyBirdPrice: 10,
  proRegularPrice: 11,
  proFullPrice: 12,
  upgradePriceNew: 13,
  upgradePriceOwner: 14,
  freeMaxBookmarks: 444,
  freeMaxDevices: 5,
  proMaxDevices: 7,
  refundDays: 90,
  revalidationHours: 96,
  recoveryWords: 30,
  minPasswordLength: 16,
  upgradeDiscountPct: 55,
  earlyBirdCapEarly: 250,
};

/** Group failure strings (they embed "label:line") by doc file label. */
export function failuresByLabel(failures) {
  const byLabel = new Map();
  for (const f of failures) {
    const m = f.match(/^(.*?):(\d+):/);
    const label = m ? m[1] : "(unknown)";
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(f);
  }
  return byLabel;
}

function parseSpecs(specs) {
  const changes = [];
  for (const spec of specs) {
    const eq = spec.indexOf("=");
    if (eq < 1) {
      throw Object.assign(new Error(`--set expects KEY=VALUE, got: ${spec}`), { code: "usage" });
    }
    const key = spec.slice(0, eq);
    const value = Number(spec.slice(eq + 1));
    if (!(key in PROBES)) {
      throw Object.assign(
        new Error(`unknown constant "${key}". planable keys: ${Object.keys(PROBES).join(", ")}`),
        { code: "usage" },
      );
    }
    if (!Number.isFinite(value)) {
      throw Object.assign(new Error(`${key} needs a finite number, got "${spec.slice(eq + 1)}"`), {
        code: "usage",
      });
    }
    changes.push({ key, value });
  }
  if (!changes.length) {
    throw Object.assign(
      new Error(`nothing to plan. usage: --set KEY=VALUE [...] [--pages] [--json]\n  keys: ${Object.keys(PROBES).join(", ")}`),
      { code: "usage" },
    );
  }
  return changes;
}

/**
 * Build the update plan. Throws Error with a `code` of "usage" (bad specs),
 * "noop" (value already equals current truth) or "baseline" (tree fails the
 * manual-figures gate — a plan over a red tree would misattribute lines).
 */
export function buildPlan(root, specs, { pages = false } = {}) {
  const requested = parseSpecs(specs);
  const truthOld = MANUAL_GATE.loadTruth(root);

  const truthNew = { ...truthOld };
  const changes = [];
  for (const { key, value } of requested) {
    if (truthNew[key] === value) {
      throw Object.assign(new Error(`nothing to do: ${key} is already ${value}`), { code: "noop" });
    }
    changes.push({ key, from: truthOld[key], to: value });
    truthNew[key] = value;
  }

  const allowedOld = MANUAL_GATE.allowedValueSets(truthOld);
  const allowedNew = MANUAL_GATE.allowedValueSets(truthNew);

  // Stale-value warning: if the retired value is still legal under the new
  // truth (e.g. proPrice 79→70 while proRegularPrice stays 79 — the pricing
  // table keeps quoting 79), the gates cannot flag those lines. Say so
  // instead of letting a silent "no lines affected" be read as "docs done".
  const stale = changes.filter(
    ({ from }) =>
      allowedNew.prices.has(from) ||
      allowedNew.deviceCounts.has(from) ||
      allowedNew.bookmarkCaps.has(from) ||
      allowedNew.supplyCaps.has(from),
  );

  // Baseline must be green — a plan over a red tree would misattribute lines.
  const base = MANUAL_GATE.scanManuals(root);
  if (base.failures.length || base.missing.length) {
    throw Object.assign(
      new Error(
        `the baseline is not green (${base.failures.length} failures, ${base.missing.length} missing manuals); fix the tree before planning`,
      ),
      { code: "baseline", sample: base.failures.slice(0, 5) },
    );
  }

  // Per-file failures under old and new truth, then diff them.
  const collect = (allowed, truth) => {
    const perFile = new Map();
    for (const rel of MANUAL_GATE.MANUAL_SOURCE_PATHS) {
      let src;
      try {
        src = readFileSync(join(root, rel), "utf8");
      } catch {
        continue; // missing manuals already flagged on the baseline check
      }
      const label = rel.split(/[\\/]/).pop() ?? rel;
      perFile.set(label, MANUAL_GATE.evaluateManual(src, allowed, label));
    }
    if (pages) {
      const pageResult = PAGE_GATE.scanPages(root, { allowed, truth });
      for (const [label, fails] of failuresByLabel(pageResult.failures)) {
        perFile.set(label, fails);
      }
    }
    return perFile;
  };

  const oldByFile = collect(allowedOld, truthOld);
  const newByFile = collect(allowedNew, truthNew);

  // One line per affected file+line: fails under the new truth but not under
  // the current one. Dedupe identical failure strings across rules.
  const actionable = [];
  for (const [label, newFails] of newByFile) {
    const oldSet = new Set(oldByFile.get(label) ?? []);
    for (const f of newFails) if (!oldSet.has(f)) actionable.push(f);
  }
  actionable.sort();

  return { changes, stale, actionable, affectedFiles: failuresByLabel(actionable).size };
}

function printPlan(plan, pages) {
  for (const { key, from, to } of plan.changes) {
    console.log(`[plan-manual-figures] change: ${key} ${from} → ${to}`);
  }
  for (const { key, from } of plan.stale) {
    console.log(
      `[plan-manual-figures] WARNING: retired value ${from} (${key}) is still canonical ` +
        `under the new truth, so lines quoting it will NOT be flagged. ` +
        `If they should follow ${key}, change the other constant(s) that still produce ${from} too ` +
        `(or review those mentions by hand).`,
    );
  }
  if (!plan.actionable.length) {
    console.log("[plan-manual-figures] no manual/page lines are affected by this change.");
    return;
  }
  const target = `check:manual-figures${pages ? " + check:page-figures" : ""}`;
  console.log(`\nUpdate these ${plan.actionable.length} line(s) to pass ${target}:\n`);
  for (const [label, fails] of failuresByLabel(plan.actionable)) {
    console.log(`  ${label}`);
    for (const f of fails) console.log(`    ${f.slice(label.length + 1)}`);
  }
  console.log(
    `\n${plan.actionable.length} affected line(s) across ${plan.affectedFiles} file(s). ` +
      `After editing, run: npm run check:manual-figures${pages ? " && npm run check:page-figures" : ""}`,
  );
}

function main() {
  const argv = process.argv.slice(2);
  const sets = [];
  let pages = false;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pages") pages = true;
    else if (a === "--json") json = true;
    else if (a === "--set") sets.push(argv[++i] ?? "");
    else {
      console.error(`[plan-manual-figures] unknown argument: ${a}`);
      process.exit(2);
    }
  }

  let plan;
  try {
    plan = buildPlan(process.cwd(), sets, { pages });
  } catch (error) {
    console.error(`[plan-manual-figures] FAIL: ${error.message}`);
    if (error.sample) for (const f of error.sample) console.error(`  - ${f}`);
    process.exit(error.code === "baseline" ? 1 : 2);
  }

  if (json) {
    console.log(
      JSON.stringify(
        { changes: plan.changes, warnings: plan.stale, affectedLines: plan.actionable, affectedFiles: plan.affectedFiles },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  printPlan(plan, pages);
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isMain) {
  main();
}
