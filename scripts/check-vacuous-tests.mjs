#!/usr/bin/env node
/**
 * scripts/check-vacuous-tests.mjs — assertion-integrity ratchet for the E2E
 * suites, plus the declared-surface check for the nightly table.
 *
 * Failure class, measured on the tree this gate was written on (2026-09-24):
 *
 *   Commit bace7c2 ("Add 1360 new human-like Playwright tests for comprehensive
 *   coverage", 2026-09-22) grew `src/tests/human-like/examples` to 160 spec
 *   files / 2102 tests. 1657 of them (78.8%) are VACUOUS — written as
 *
 *       if (await loc.isVisible({ timeout: 5000 }).catch(() => false)) {
 *         await expect(loc).toBeVisible();
 *       }
 *
 *   so they pass exactly when the feature they name is absent (one of them even
 *   asserts the close button is still visible AFTER clicking it). The nightly
 *   `Human-like E2E` job is green whether the app works or not.
 *
 *   Nothing caught it, because it needed two observations at once, and each one
 *   was out of every gate's scope:
 *
 *     - assertion integrity: a vacuous test is indistinguishable from a passing
 *       one to Playwright, so only a static read of the suite can see it;
 *     - the declared surface: `docs/ops-nightly.md` still promised "15 spec
 *       files / 290 tests" (a 10x understatement) and "51 spec files" for a
 *       63-file multi-user directory. Nothing re-read the numbers the operators
 *       budget against — the same declared-vs-actual drift ADR-058 closed for
 *       the release target.
 *
 * Rules (all fail-closed, none of them a silent skip):
 *  1. the suite directory, the baseline, or the documented table is missing or
 *     unreadable → FAIL (never pass because the input was absent);
 *  2. a spec file with vacuous tests that the baseline does not list → FAIL
 *     (new theatre cannot be added silently);
 *  3. a baselined file whose vacuous count grew → FAIL;
 *  4. a baselined file that disappeared, or whose count dropped → FAIL (stale:
 *     the baseline is a reviewed artifact, so it tightens when the debt does);
 *  5. a suite entry without a reason a reader can check → FAIL;
 *  6. the suite table declares a size the tree does not have → FAIL;
 *  7. a row of the table that declares no verifiable surface, and that the
 *     baseline does not excuse with a reason → FAIL (as does an excuse for a
 *     job the table no longer declares).
 *
 * The debt itself is deliberately baselined rather than deleted here: turning
 * 94 spec files into real tests is a product decision, and it is recorded in
 * `docs/PENDIENTES.md`. What this gate refuses to allow is the number growing.
 *
 * Usage:
 *   node scripts/check-vacuous-tests.mjs            # verify
 *   node scripts/check-vacuous-tests.mjs --update   # rewrite the baseline
 *   node scripts/check-vacuous-tests.mjs --json     # machine-readable
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeSuite,
  declaredJobNames,
  measureSurface,
  parseDeclaredSurface,
  sectionText,
} from "./tooling/vacuous-tests.mjs";

/** The suites whose assertion integrity is budgeted. */
export const SUITES = ["src/tests/human-like/examples", "tests/e2e"];
/** The operator document that declares each suite's size. */
export const DOC = "docs/ops-nightly.md";
// The heading the operator document actually carries (it was translated to
// English in c57bf01 while the gate kept reading the Spanish one, so the gate
// failed on its own drift instead of on the suite it budgets). Pinned by
// `passes on the checkout as it ships` in check-vacuous-tests.test.mjs, which
// runs the gate against this tree.
export const DOC_SECTION = "Suites and jobs";
export const BASELINE_PATH = "scripts/vacuous-tests-baseline.json";

/** Name of a spec file relative to its suite directory (the baseline key). */
export function suiteRelativeName(suiteDir, repoPath) {
  const prefix = `${suiteDir}/`;
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath;
}

/**
 * Rules 2-5: the ratchet. `measured` is the output of `measureSuites`.
 * Exported so the contract tests can drive every failure class with fixtures.
 */
export function ratchetFailures(measured, baseline) {
  const failures = [];
  for (const suite of measured) {
    const entry = baseline?.suites?.[suite.dir];
    const reason = typeof entry?.reason === "string" ? entry.reason.trim() : "";
    if (!reason) {
      failures.push(
        `baseline without a reason: suites["${suite.dir}"] — every baselined ` +
          `suite needs a reason a reader can check`,
      );
    }
    const baselined = entry?.files ?? {};
    if (typeof baselined !== "object" || Array.isArray(baselined)) {
      failures.push(
        `malformed baseline: suites["${suite.dir}"].files must map a spec file ` +
          `name to its baselined vacuous test count`,
      );
      continue;
    }
    for (const file of suite.files) {
      const name = suiteRelativeName(suite.dir, file.file);
      const current = file.vacuous;
      if (!(name in baselined)) {
        if (current === 0) continue;
        failures.push(
          `undeclared vacuous coverage: ${file.file} has ${current} vacuous ` +
            `test(s) and is not in ${BASELINE_PATH} — assert unconditionally, ` +
            `or declare the new debt with --update and a reason`,
        );
        continue;
      }
      const known = baselined[name];
      if (!Number.isInteger(known) || known < 0) {
        failures.push(
          `malformed baseline: suites["${suite.dir}"].files["${name}"] must be ` +
            `a non-negative integer, got ${JSON.stringify(known)}`,
        );
        continue;
      }
      if (current > known) {
        failures.push(
          `vacuous coverage grew: ${file.file} now has ${current} vacuous ` +
            `test(s), baseline allows ${known}`,
        );
      } else if (current < known) {
        failures.push(
          `stale baseline (the debt was paid): ${file.file} has ${current} ` +
            `vacuous test(s), baseline allows ${known} — run --update to tighten it`,
        );
      }
    }
    for (const name of Object.keys(baselined)) {
      if (!suite.files.some((file) => suiteRelativeName(suite.dir, file.file) === name)) {
        failures.push(
          `stale baseline: suites["${suite.dir}"].files["${name}"] no longer ` +
            `exists in the suite`,
        );
      }
    }
  }
  return failures;
}

/**
 * Rules 6-7: the declared surface. `measure(dir)` returns the tree's
 * `{ files, tests }` for a directory, or null when the directory is absent.
 */
export function surfaceFailures({ tableText, notEnforced = {}, measure, root = "." }) {
  const failures = [];
  const notes = [];
  if (typeof tableText !== "string" || tableText.length === 0) {
    failures.push(
      `could not find the "${DOC_SECTION}" table in ${DOC} — the declared ` +
        `nightly surface has no owner`,
    );
    return { failures, notes };
  }
  const jobs = declaredJobNames(tableText);
  if (jobs.length === 0) {
    failures.push(
      `the "${DOC_SECTION}" table in ${DOC} declares no job row — the parser ` +
        `would report success on an empty table`,
    );
    return { failures, notes };
  }
  for (const job of jobs) {
    const declared = parseDeclaredSurface(tableText, job);
    if (declared === null) {
      const reason = notEnforced?.[job];
      if (typeof reason === "string" && reason.trim().length > 0) {
        notes.push(`${job}: declaration not verified — ${reason}`);
      } else {
        failures.push(
          `unverifiable declaration: the row for "${job}" in ${DOC} declares no ` +
            `"N spec files / M tests (\`path\`)" and the baseline excuses nothing`,
        );
      }
      continue;
    }
    if (declared.kind === "single-spec") {
      if (existsSync(join(root, declared.path))) {
        notes.push(`${job}: single spec path verified (${declared.path})`);
      } else {
        failures.push(
          `declared surface drift: ${DOC} points "${job}" at ` +
            `${declared.path}, which does not exist`,
        );
      }
      continue;
    }
    const measured = measure(declared.dir);
    if (!measured) {
      failures.push(
        `declared suite directory is missing: "${declared.dir}" (job "${job}")`,
      );
      continue;
    }
    if (measured.files !== declared.files) {
      failures.push(
        `declared surface drift: ${DOC} says "${job}" has ${declared.files} ` +
          `spec file(s); the tree has ${measured.files} — update the row`,
      );
    }
    if (declared.testsApproximate) {
      notes.push(
        `${job}: ${measured.files} spec file(s) ok, test count declared ` +
          `approximate (${declared.tests} vs ${measured.tests} measured)`,
      );
    } else if (measured.tests !== declared.tests) {
      failures.push(
        `declared surface drift: ${DOC} says "${job}" has ${declared.tests} ` +
          `test(s); the tree has ${measured.tests} — update the row`,
      );
    } else {
      notes.push(
        `${job}: ${measured.files} spec file(s) / ${measured.tests} test(s) ` +
          `— matches ${DOC}`,
      );
    }
  }
  for (const job of Object.keys(notEnforced ?? {})) {
    if (!jobs.includes(job)) {
      failures.push(
        `stale baseline: declaredSurface.notEnforced lists "${job}", which ` +
          `${DOC} no longer declares`,
      );
    }
  }
  return { failures, notes };
}

/** The vacuous counts to persist for one suite (only files that have debt). */
export function baselineFilesFor(suite) {
  const files = {};
  for (const file of [...suite.files].sort((a, b) => a.file.localeCompare(b.file))) {
    if (file.vacuous > 0) files[suiteRelativeName(suite.dir, file.file)] = file.vacuous;
  }
  return files;
}

/** Measure every suite. Missing directories are reported, not skipped. */
export function measureSuites(root, suites = SUITES) {
  const measured = [];
  const failures = [];
  for (const dir of suites) {
    const abs = join(root, dir);
    if (!existsSync(abs)) {
      failures.push(`suite directory is missing: ${dir}`);
      continue;
    }
    measured.push({ dir, ...analyzeSuite(abs, { root }) });
  }
  return { measured, failures };
}

function percent(part, total) {
  return total === 0 ? "0.0" : ((part / total) * 100).toFixed(1);
}

function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const asJson = args.includes("--json");
  const root = process.cwd();

  const docPath = join(root, DOC);
  if (!existsSync(docPath)) {
    console.error(`[check:vacuous-tests] the documented surface is missing: ${DOC}`);
    return 1;
  }
  const tableText = sectionText(readFileSync(docPath, "utf8"), DOC_SECTION);

  const baselinePath = join(root, BASELINE_PATH);
  let baseline = null;
  let failures = [];
  if (existsSync(baselinePath)) {
    try {
      baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    } catch (error) {
      failures.push(`unreadable baseline ${BASELINE_PATH}: ${error.message}`);
    }
  } else if (!update) {
    // With --update the baseline is written below, so its absence is not a
    // failure: it is the reason for the flag. Without it, this is the one
    // failure a fresh clone sees — never a vacuous pass.
    failures.push(
      `missing baseline ${BASELINE_PATH} — run \`node scripts/check-vacuous-tests.mjs --update\``,
    );
  }

  const { measured, failures: measureFailures } = measureSuites(root);
  failures = [...failures, ...measureFailures];

  if (update) {
    const next = {
      updatedAt: new Date().toISOString().slice(0, 10),
      suites: {},
      declaredSurface: { notEnforced: baseline?.declaredSurface?.notEnforced ?? {} },
    };
    for (const suite of measured) {
      const reason = baseline?.suites?.[suite.dir]?.reason;
      next.suites[suite.dir] = {
        ...(typeof reason === "string" && reason.trim() ? { reason } : {}),
        files: baselineFilesFor(suite),
      };
    }
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    baseline = next;
    console.log(`[check:vacuous-tests] rewrote ${BASELINE_PATH}`);
  }

  if (baseline && failures.length === 0) {
    failures = [...failures, ...ratchetFailures(measured, baseline)];
  }

  const surface =
    baseline && failures.length === 0
      ? surfaceFailures({
          tableText,
          notEnforced: baseline?.declaredSurface?.notEnforced ?? {},
          measure: (dir) => (existsSync(join(root, dir)) ? measureSurface(join(root, dir), { root }) : null),
          root,
        })
      : { failures: [], notes: [] };
  failures = [...failures, ...surface.failures];

  if (asJson) {
    // The JSON document is the WHOLE stdout when --json is set: the summary
    // lines would break every `node gate --json | jq` consumer, and the first
    // consumer of the flag was this repo's own contract test.
    console.log(
      JSON.stringify(
        {
          suites: measured.map((suite) => ({ dir: suite.dir, totals: suite.totals })),
          notes: surface.notes,
          failures,
        },
        null,
        2,
      ),
    );
    return failures.length === 0 ? 0 : 1;
  }

  for (const suite of measured) {
    const { totals } = suite;
    console.log(
      `[check:vacuous-tests] ${suite.dir}: ${totals.files} file(s), ` +
        `${totals.tests} test(s), ${totals.vacuous} vacuous ` +
        `(${percent(totals.vacuous, totals.tests)}%)`,
    );
  }
  for (const note of surface.notes) console.log(`[check:vacuous-tests] note: ${note}`);

  if (failures.length > 0) {
    for (const failure of failures) console.error(`[check:vacuous-tests] ${failure}`);
    console.error(
      "[check:vacuous-tests] remedy: a test that cannot fail is not coverage — " +
        "assert unconditionally, or record the debt in the baseline with a reason " +
        "(and in docs/PENDIENTES.md) so it is a decision instead of an oversight.",
    );
    return 1;
  }

  const totals = measured.reduce(
    (acc, suite) => ({
      tests: acc.tests + suite.totals.tests,
      vacuous: acc.vacuous + suite.totals.vacuous,
    }),
    { tests: 0, vacuous: 0 },
  );
  console.log(
    `ok: ${measured.length} suite(s), ${totals.tests} test(s), ` +
      `${totals.vacuous} vacuous (${percent(totals.vacuous, totals.tests)}%, baselined) · ` +
      `${surface.notes.length} declared row(s) checked`,
  );
  return 0;
}

// Repo idiom for "was I invoked as a CLI?": `import.meta.url` is
// percent-encoded, so a checkout under a path with spaces (`D:\Nueva carpeta\…`)
// never matches `process.argv[1]` by string comparison — the gate would exit 0
// as a no-op. scripts/__tests__/cli-detection-space-paths.test.mjs pins the fix.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
