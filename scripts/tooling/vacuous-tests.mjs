/**
 * scripts/tooling/vacuous-tests.mjs — assertion-integrity analysis of a
 * Playwright suite.
 *
 * Why a module and not just a script: the diagnostic
 * (`scripts/analyze-vacuous-tests.mjs`) and the ratchet
 * (`scripts/check-vacuous-tests.mjs`) must classify a test the SAME way. If the
 * number a maintainer reads is produced by a different implementation than the
 * number the gate enforces, the gate is measuring something else than the
 * report says — the drift class this repo keeps paying for.
 *
 * Classification (per `test()` / `it()` call):
 *   empty    — zero `expect` calls: nothing can fail.
 *   guarded  — every `expect` sits inside an `if`, so all asserts vanish when
 *              the target is absent. This is the dominant pattern in the
 *              human-like suite:
 *                if (await loc.isVisible({ timeout: 5000 }).catch(() => false)) {
 *                  await expect(loc).toBeVisible();
 *                }
 *              which passes *exactly when the feature is missing*.
 *   mixed    — unconditional and guarded asserts coexist.
 *   real     — every assert is unconditional (the chain is live).
 *
 * `empty` + `guarded` are VACUOUS, and that is the unit the ratchet budgets.
 * The analysis is deliberately syntactic: it cannot tell an assertion that
 * means something from one that does not, but it can tell an assertion that
 * cannot run from one that can, and that is the failure this gate exists for.
 *
 * `parseDeclaredSurface` reads the declared suite size out of the operator
 * document. The declaration is what a reader budgets against, so the gate
 * compares it with the tree instead of trusting it (ADR-058's
 * declared-vs-actual rule, applied to the nightly surface).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

/** A conditional whose body is not guaranteed to run. */
export const GUARD_RE = /isVisible\s*\(|\.count\s*\(\s*\)|\.catch\s*\(/;
/** `locator("body")`-style assertions that carry no behaviour. */
export const TRIVIAL_LOCATOR_RE = /locator\s*\(\s*['"`](body|html|:root)['"`]\s*\)/;

/** The verdicts that mean "this test cannot fail for what it claims". */
export const VACUOUS_VERDICTS = Object.freeze(["empty", "guarded"]);

/** Repo-relative POSIX path: stable keys across platforms. */
export function toRepoPath(root, file) {
  return relative(root, file).split(sep).join("/");
}

/** Every `*.spec.ts` under `dir`, recursively, in a stable order. */
export function collectSpecFiles(dir) {
  const acc = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".spec.ts")) acc.push(path);
    }
  };
  walk(dir);
  return acc.sort();
}

/** Recursively visit nodes; `inIf` tracks conditional nesting. */
function visit(node, inIf, acc) {
  if (ts.isCallExpression(node)) {
    const exprText = node.expression.getText();
    if (exprText === "expect") {
      acc.totalExpects += 1;
      if (inIf) acc.guardedExpects += 1;
      else {
        acc.unconditionalExpects += 1;
        const argSrc = node.arguments.length ? node.arguments[0].getText() : "";
        if (TRIVIAL_LOCATOR_RE.test(argSrc)) acc.trivialExpects += 1;
      }
    }
  }
  if (ts.isIfStatement(node) && GUARD_RE.test(node.expression.getText())) {
    acc.guardIfs += 1;
  }
  const nextInIf = inIf || ts.isIfStatement(node);
  node.forEachChild((child) => visit(child, nextInIf, acc));
  // Sibling statements after an `if` are NOT inside it: forEachChild of the
  // Block visits each statement with the same `inIf` as the block itself, and
  // only the IfStatement's own bodies nest deeper. Correct as written.
}

function analyzeTest(callNode) {
  const cb = callNode.arguments.find(
    (arg) => ts.isFunctionExpression(arg) || ts.isArrowFunction(arg),
  );
  if (!cb) return null;
  const acc = {
    totalExpects: 0,
    guardedExpects: 0,
    unconditionalExpects: 0,
    trivialExpects: 0,
    guardIfs: 0,
    usesHuman: /createHumanBehavior|human\./.test(cb.getText()),
    // An arrow with an expression body (`test("t", ({ page }) => page.goto("/"))`)
    // has no `statements`; reading it unguarded crashed the first multi-suite
    // run. A body that is not a block is one statement for our purposes.
    statements: cb.body && ts.isBlock(cb.body) ? cb.body.statements.length : 1,
  };
  visit(cb.body, false, acc);
  const meaningful = acc.unconditionalExpects - acc.trivialExpects;
  let verdict;
  if (acc.totalExpects === 0) verdict = "empty";
  else if (meaningful <= 0) verdict = "guarded";
  else if (acc.guardedExpects > 0 || acc.guardIfs > 0) verdict = "mixed";
  else verdict = "real";
  return { ...acc, verdict };
}

/**
 * A call node that declares one test. `test.describe` / `test.beforeEach` are
 * not tests. Of the modifiers, only `test.only` and `test.fail` RUN a body, so
 * only those are a test for our purposes: `test.skip(cond, "msg")` (the only
 * shape the corpus uses, 15 times) and `test.fixme` declare a condition, not a
 * test, and counting a skipped body would inflate the surface the operator
 * document declares. (An earlier version listed `skip` here while still
 * returning true for it — the corpus never noticed because its skips carry no
 * callback; the fixture suite did. A rule that cannot survive its own test is
 * not a rule.)
 */
function isTestCall(node) {
  const expr = node.expression;
  if (ts.isIdentifier(expr)) return expr.text === "test" || expr.text === "it";
  return (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "test" &&
    ["only", "fail"].includes(expr.name.text)
  );
}

/** Per-file classification. `file` is stored repo-relative when `root` is set. */
export function analyzeSource(file, text, { root = null } = {}) {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const tests = [];
  const walk = (node) => {
    if (ts.isCallExpression(node) && isTestCall(node) && node.arguments.length >= 2) {
      const result = analyzeTest(node);
      if (result) {
        tests.push({
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          ...result,
        });
      }
    }
    node.forEachChild(walk);
  };
  walk(sourceFile);

  const perFile = { empty: 0, guarded: 0, mixed: 0, real: 0 };
  for (const test of tests) perFile[test.verdict] += 1;
  return {
    file: root ? toRepoPath(root, file) : file,
    tests: tests.length,
    ...perFile,
    vacuous: perFile.empty + perFile.guarded,
    lines: text.split(/\r?\n/).length,
    details: tests,
  };
}

/** Every spec file of a suite, classified, plus the suite totals. */
export function analyzeSuite(dir, { root = null } = {}) {
  const files = collectSpecFiles(dir).map((file) =>
    analyzeSource(file, readFileSync(file, "utf8"), { root }),
  );
  return { files, totals: summarizeTotals(files) };
}

/** Suite totals. `vacuous` is the budgeted quantity. */
export function summarizeTotals(files) {
  const totals = {
    files: files.length,
    tests: 0,
    empty: 0,
    guarded: 0,
    mixed: 0,
    real: 0,
    vacuous: 0,
  };
  for (const file of files) {
    totals.tests += file.tests;
    totals.empty += file.empty;
    totals.guarded += file.guarded;
    totals.mixed += file.mixed;
    totals.real += file.real;
  }
  totals.vacuous = totals.empty + totals.guarded;
  return totals;
}

/** The measured surface of a directory: how many spec files, how many tests. */
export function measureSurface(dir, { root = null } = {}) {
  const { totals } = analyzeSuite(dir, { root });
  return { files: totals.files, tests: totals.tests };
}

// "| `human-like-sharded` | 160 spec files / 2102 tests (`src/…/examples`) | …"
// The parens may carry more than the path (the multi-user row adds
// ", workers=1"), so the tail is tolerated rather than matched.
const DECLARED_SURFACE_RE =
  /(\d+)\s+spec files\s*\/\s*(~)?\s*(\d+)\s+tests?\s*\(`([^`]+)`[^)]*\)/;

/**
 * The body of one `## …` section of a Markdown document, up to the next `## `.
 * The declared-surface rules apply to the nightly table only: the same doc
 * lists artifacts and variables in other sections, and a row there is not a
 * suite.
 */
export function sectionText(docText, headingIncludes) {
  const lines = String(docText).split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line.startsWith("## ") && line.includes(headingIncludes),
  );
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const SINGLE_SPEC_RE = /`([^`]+\.spec\.ts)`/;

/**
 * The declared surface of the job whose row in the nightly table is `job`.
 *
 * Returns one of:
 *   { kind: "suite", files, tests, testsApproximate, dir } — a directory with a
 *     declared size; the gate compares both numbers against the tree.
 *   { kind: "single-spec", path } — the row declares one spec file, so there is
 *     no size to compare; the gate checks the file exists.
 *   null — the row does not declare a verifiable surface. The gate fails on
 *     those unless the baseline carries an explicit reason for the job, so
 *     "unparseable" never becomes "unchecked" by accident.
 */
export function parseDeclaredSurface(tableText, job) {
  for (const line of String(tableText).split(/\r?\n/)) {
    if (!line.includes(`\`${job}\``)) continue;
    const suite = DECLARED_SURFACE_RE.exec(line);
    if (suite) {
      return {
        kind: "suite",
        job,
        files: Number(suite[1]),
        // `~` marks a deliberately approximate test count: the suite
        // parameterizes tests in loops, so the AST count and the count
        // Playwright collects are not the same number.
        testsApproximate: Boolean(suite[2]),
        tests: Number(suite[3]),
        dir: suite[4],
      };
    }
    const single = SINGLE_SPEC_RE.exec(line);
    if (single) return { kind: "single-spec", job, path: single[1] };
    return null;
  }
  return null;
}

/** Every job cell of a table (first backticked cell of the row). */
export function declaredJobNames(tableText) {
  const jobs = [];
  for (const line of String(tableText).split(/\r?\n/)) {
    const match = /^\|\s*`([a-z][a-z0-9-]*)`\s*\|/.exec(line.trim());
    if (match) jobs.push(match[1]);
  }
  return jobs;
}
