/**
 * scripts/__tests__/check-vacuous-tests.test.mjs
 *
 * Contract tests for the assertion-integrity ratchet
 * (`scripts/check-vacuous-tests.mjs`) and the classification it shares with the
 * diagnostic (`scripts/tooling/vacuous-tests.mjs`).
 *
 * What is pinned, and why each one is here rather than in prose:
 *
 *  - the CLASSIFICATION, because the whole gate rests on it. The subtle rule is
 *    the sibling case: an `expect` after an `if` block is unconditional, and a
 *    visitor that keeps the flag set inflates the "real" count and lets theatre
 *    through. A fixture asserts both sides of that line.
 *  - the RATCHET, one test per failure class: growth, undeclared new theatre, a
 *    baselined file that disappeared, a baselined file that improved (the
 *    baseline must tighten), a suite without a reason, a malformed count.
 *  - the DECLARED SURFACE, including the approximate (`~`) test count and the
 *    single-spec row, because "the operator document overstates the suite" is
 *    half of the failure this gate was written for.
 *  - the REAL TREE, because a ratchet verified only against fixtures can be
 *    green while the shipped baseline is unrelated to the shipped suite.
 *
 * Fixtures live under a temp directory whose name contains a space: this repo
 * already paid once for a checkout path with spaces breaking CLI detection
 * (cli-detection-space-paths.test.mjs), and spawning the gate from such a cwd
 * is the cheapest way to stop paying twice.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import {
  BASELINE_PATH,
  DOC,
  SUITES,
  baselineFilesFor,
  measureSuites,
  ratchetFailures,
  surfaceFailures,
} from "../check-vacuous-tests.mjs";
import {
  analyzeSource,
  collectSpecFiles,
  declaredJobNames,
  measureSurface,
  parseDeclaredSurface,
  sectionText,
} from "../tooling/vacuous-tests.mjs";

const ROOT = process.cwd();
const SANDBOX = mkdtempSync(join(tmpdir(), "bmf vacuous-"));
const SUITE_DIR = "src/tests/human-like/examples";
const PERF_SPEC = "tests/e2e/perf-scale.nightly.spec.ts";
mkdirSync(join(SANDBOX, "tests/e2e"), { recursive: true });
writeFileSync(join(SANDBOX, PERF_SPEC), 'import { test } from "@playwright/test";\n');
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

const HEADER = 'import { test, expect } from "@playwright/test";\n';

/** Write a fixture suite and classify it exactly as the gate does. */
function suite(sources, dir = SUITE_DIR) {
  const abs = join(SANDBOX, dir);
  rmSync(abs, { recursive: true, force: true });
  mkdirSync(abs, { recursive: true });
  for (const [name, body] of Object.entries(sources)) {
    writeFileSync(join(abs, name), `${HEADER}${body}\n`);
  }
  const files = collectSpecFiles(abs).map((file) =>
    analyzeSource(file, readFileSync(file, "utf8"), { root: SANDBOX }),
  );
  return { dir, files };
}

const GUARDED = `
test("guarded", async ({ page }) => {
  const alert = page.locator("#alert");
  if (await alert.isVisible({ timeout: 500 }).catch(() => false)) {
    await expect(alert).toBeVisible();
  }
});
`;

const REAL = `
test("real", async ({ page }) => {
  const title = page.locator("h1");
  await expect(title).toHaveText("Bookmarks");
});
`;

describe("classification", () => {
  it("calls a test whose only assert is guarded vacuous", () => {
    const result = analyzeSource("a.spec.ts", `${HEADER}${GUARDED}`);
    expect(result.tests).toBe(1);
    expect(result.details[0].verdict).toBe("guarded");
    expect(result.vacuous).toBe(1);
  });

  it("calls a test with no assert at all empty (and therefore vacuous)", () => {
    const result = analyzeSource("a.spec.ts", `${HEADER}test("nothing", async () => {});\n`);
    expect(result.details[0].verdict).toBe("empty");
    expect(result.vacuous).toBe(1);
  });

  it("calls a test real when every assert is unconditional", () => {
    const result = analyzeSource("a.spec.ts", `${HEADER}${REAL}`);
    expect(result.details[0].verdict).toBe("real");
    expect(result.vacuous).toBe(0);
  });

  it("keeps a statement AFTER a guard block unconditional", () => {
    // The regression a naive visitor introduces: the `inIf` flag must not leak
    // to the siblings of an IfStatement, or theatre is counted as real.
    const result = analyzeSource(
      "a.spec.ts",
      `${HEADER}
test("sibling", async ({ page }) => {
  const el = page.locator("#a");
  if (await el.isVisible().catch(() => false)) {
    await expect(el).toBeVisible();
  }
  await expect(page.locator("h1")).toBeVisible();
});
`,
    );
    expect(result.details[0].guardedExpects).toBe(1);
    expect(result.details[0].unconditionalExpects).toBe(1);
    expect(result.details[0].verdict).toBe("mixed");
    expect(result.vacuous).toBe(0);
  });

  it("survives an arrow test with an expression body", () => {
    // This crashed the first multi-suite run: `cb.body.statements` is not a
    // block for `test("t", ({ page }) => page.goto("/"))`.
    const result = analyzeSource(
      "a.spec.ts",
      `${HEADER}test("tiny", ({ page }) => page.goto("/"));\n`,
    );
    expect(result.tests).toBe(1);
    expect(result.details[0].verdict).toBe("empty");
  });

  it("does not count describe, hooks or the skip/only modifiers as tests", () => {
    const result = analyzeSource(
      "a.spec.ts",
      `${HEADER}
test.describe("group", () => {
  test.beforeEach(async () => {});
  test.skip("skipped", async () => {});
  test("counted", async ({ page }) => {
    await expect(page.locator("h1")).toBeVisible();
  });
});
`,
    );
    expect(result.tests).toBe(1);
    expect(result.real).toBe(1);
  });

  it("separates the vacuous file from the real one in a directory", () => {
    const measured = suite({ "guarded.spec.ts": GUARDED, "real.spec.ts": REAL });
    expect(measured.files.length).toBe(2);
    expect(measured.files.find((file) => file.vacuous > 0).file).toMatch(/guarded\.spec\.ts$/);
    expect(measured.files.find((file) => file.vacuous === 0).file).toMatch(/real\.spec\.ts$/);
  });
});

describe("ratchet", () => {
  const baselineFor = (measured, files, reason = "imported wholesale on 2026-09-22") => ({
    suites: { [measured.dir]: { reason, files } },
  });

  it("passes when the tree matches the baseline", () => {
    const measured = suite({ "guarded.spec.ts": GUARDED });
    expect(ratchetFailures([measured], baselineFor(measured, { "guarded.spec.ts": 1 }))).toEqual([]);
  });

  it("fails when a baselined file grows", () => {
    const measured = suite({ "two.spec.ts": `${GUARDED}${GUARDED}` });
    const failures = ratchetFailures([measured], baselineFor(measured, { "two.spec.ts": 1 }));
    expect(failures.join("\n")).toMatch(/vacuous coverage grew/);
  });

  it("fails when new vacuous coverage appears undeclared", () => {
    const measured = suite({ "new.spec.ts": GUARDED });
    const failures = ratchetFailures([measured], baselineFor(measured, {}));
    expect(failures.join("\n")).toMatch(/undeclared vacuous coverage/);
  });

  it("does not require an entry for a file with no vacuous test", () => {
    const measured = suite({ "real.spec.ts": REAL });
    expect(baselineFilesFor(measured)).toEqual({});
    expect(ratchetFailures([measured], baselineFor(measured, {}))).toEqual([]);
  });

  it("fails on a baselined file that no longer exists", () => {
    const measured = suite({ "kept.spec.ts": REAL });
    const failures = ratchetFailures(
      [measured],
      baselineFor(measured, { "kept.spec.ts": 0, "deleted.spec.ts": 3 }),
    );
    expect(failures.join("\n")).toMatch(/stale baseline: .*deleted\.spec\.ts/);
  });

  it("fails when the debt is paid, so the baseline gets tightened", () => {
    const measured = suite({ "fixed.spec.ts": REAL });
    const failures = ratchetFailures([measured], baselineFor(measured, { "fixed.spec.ts": 4 }));
    expect(failures.join("\n")).toMatch(/the debt was paid/);
  });

  it("fails on a suite with no reason, and on a malformed count", () => {
    const measured = suite({ "a.spec.ts": GUARDED });
    expect(
      ratchetFailures([measured], { suites: { [measured.dir]: { files: {} } } }).join("\n"),
    ).toMatch(/baseline without a reason/);
    expect(
      ratchetFailures([measured], baselineFor(measured, { "a.spec.ts": "one" })).join("\n"),
    ).toMatch(/malformed baseline/);
  });

  it("keys the baseline by suite-relative name", () => {
    const measured = suite({ "guarded.spec.ts": GUARDED });
    expect(baselineFilesFor(measured)).toEqual({ "guarded.spec.ts": 1 });
  });
});

describe("declared surface", () => {
  const TABLE = `## 1. Suites y jobs

| Job | Suite | Shards | Timeout | Presupuesto (repo var) |
|---|---|---|---|---|
| \`human-like-sharded\` | 2 spec files / 3 tests (\`${SUITE_DIR}\`) | 4 | 60 min | \`NIGHTLY_HUMAN_LIKE_MAX_MINUTES\` |
| \`multiuser-sharded\` | 2 spec files / ~9 tests (\`tests/e2e\`, workers=1) | 2 | 45 min | \`NIGHTLY_MULTIUSER_MAX_MINUTES\` |
| \`performance\` | \`${PERF_SPEC}\` | 1 ("single") | 45 min | \`NIGHTLY_PERF_SCALE_MAX_MINUTES\` |

Jobs de apoyo: nada.`;

  /** The tree the table above describes. */
  const measure = (dir) =>
    dir === SUITE_DIR ? { files: 2, tests: 3 } : { files: 2, tests: 2 };
  const check = (overrides = {}) =>
    surfaceFailures({ tableText: TABLE, measure, root: SANDBOX, ...overrides });

  it("scopes the table to its own section", () => {
    const section = sectionText(`${TABLE}\n\n## 2. Otro\n\nnada\n`, "Suites y jobs");
    expect(section).toMatch(/^## 1\. Suites y jobs/);
    expect(section).not.toMatch(/## 2\./);
    expect(sectionText("no headings here", "Suites y jobs")).toBe(null);
  });

  it("reads the job rows of the table", () => {
    expect(declaredJobNames(TABLE)).toEqual([
      "human-like-sharded",
      "multiuser-sharded",
      "performance",
    ]);
  });

  it("parses the multi-user row despite the trailing ', workers=1'", () => {
    expect(parseDeclaredSurface(TABLE, "multiuser-sharded")).toEqual({
      kind: "suite",
      job: "multiuser-sharded",
      files: 2,
      tests: 9,
      testsApproximate: true,
      dir: "tests/e2e",
    });
  });

  it("parses the single-spec row as a path to verify, not a size", () => {
    expect(parseDeclaredSurface(TABLE, "performance")).toEqual({
      kind: "single-spec",
      job: "performance",
      path: PERF_SPEC,
    });
  });

  it("passes when the tree agrees, and notes the approximate count", () => {
    const { failures, notes } = check();
    expect(failures).toEqual([]);
    expect(notes.join("\n")).toMatch(/human-like-sharded: 2 spec file\(s\) \/ 3 test\(s\) — matches/);
    expect(notes.join("\n")).toMatch(/multiuser-sharded: 2 spec file\(s\) ok, test count declared approximate/);
    expect(notes.join("\n")).toMatch(/performance: single spec path verified/);
  });

  it("fails when the declared file count drifts", () => {
    const { failures } = check({ measure: () => ({ files: 5, tests: 3 }) });
    expect(failures.join("\n")).toMatch(/says "human-like-sharded" has 2 spec file\(s\); the tree has 5/);
  });

  it("fails when the declared test count drifts", () => {
    const { failures } = check({
      measure: (dir) => (dir === SUITE_DIR ? { files: 2, tests: 99 } : { files: 2, tests: 2 }),
    });
    expect(failures.join("\n")).toMatch(/says "human-like-sharded" has 3 test\(s\); the tree has 99/);
  });

  it("does not enforce a count declared approximate", () => {
    const { failures, notes } = check({ measure: () => ({ files: 2, tests: 999 }) });
    expect(failures.join("\n")).not.toMatch(/multiuser-sharded/);
    expect(notes.join("\n")).toMatch(/approximate \(9 vs 999 measured\)/);
  });

  it("fails on a declared suite directory that does not exist", () => {
    const { failures } = check({ measure: () => null });
    expect(failures.join("\n")).toMatch(/declared suite directory is missing: "tests\/e2e"/);
  });

  it("fails on a single-spec row whose file is gone", () => {
    const { failures } = check({ root: join(SANDBOX, "nowhere") });
    expect(failures.join("\n")).toMatch(/points "performance" at .*which does not exist/);
  });

  it("fails when a row declares no verifiable surface, unless the baseline excuses it", () => {
    const table = "## 1. Suites y jobs\n\n| `mystery` | 4 | 45 min |\n";
    expect(
      surfaceFailures({ tableText: table, measure, root: SANDBOX }).failures.join("\n"),
    ).toMatch(/unverifiable declaration: the row for "mystery"/);
    const excused = surfaceFailures({
      tableText: table,
      notEnforced: { mystery: "a manual job with no suite size" },
      measure,
      root: SANDBOX,
    });
    expect(excused.failures).toEqual([]);
    expect(excused.notes.join("\n")).toMatch(/declaration not verified — a manual job/);
  });

  it("fails on an excuse for a job the table no longer declares", () => {
    const { failures } = check({ notEnforced: { "gone-job": "stale" } });
    expect(failures.join("\n")).toMatch(
      /stale baseline: declaredSurface\.notEnforced lists "gone-job"/,
    );
  });

  it("never passes vacuously on an empty or missing table", () => {
    expect(
      surfaceFailures({ tableText: null, measure, root: SANDBOX }).failures.join("\n"),
    ).toMatch(/could not find the/);
    expect(
      surfaceFailures({
        tableText: "## 1. Suites y jobs\n\nnada\n",
        measure,
        root: SANDBOX,
      }).failures.join("\n"),
    ).toMatch(/declares no job row/);
  });
});

describe("the real tree", () => {
  it("budgets the suites the operator document describes", () => {
    const { measured, failures } = measureSuites(ROOT);
    expect(failures).toEqual([]);
    expect(measured.map((entry) => entry.dir)).toEqual(SUITES);
    expect(DOC).toBe("docs/ops-nightly.md");
    expect(BASELINE_PATH).toBe("scripts/vacuous-tests-baseline.json");
    expect(measureSurface(join(ROOT, "tests/e2e"), { root: ROOT }).files).toBeGreaterThan(0);
  });

  it("passes on the checkout as it ships", () => {
    const run = spawnSync("node", ["scripts/check-vacuous-tests.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(run.stderr).toBe("");
    expect(run.stdout).toMatch(/ok: 2 suite\(s\)/);
    expect(run.status).toBe(0);
  });

  it("reports machine-readable totals", () => {
    const run = spawnSync("node", ["scripts/check-vacuous-tests.mjs", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    const json = JSON.parse(run.stdout.slice(run.stdout.indexOf("{")));
    expect(json.failures).toEqual([]);
    expect(json.suites.map((entry) => entry.dir)).toEqual(SUITES);
    const human = json.suites.find((entry) => entry.dir === SUITES[0]).totals;
    expect(human.vacuous).toBeGreaterThan(1000);
    expect(human.vacuous).toBeLessThanOrEqual(human.tests);
  });
});
