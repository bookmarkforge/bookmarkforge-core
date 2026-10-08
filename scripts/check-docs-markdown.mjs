#!/usr/bin/env node
/**
 * scripts/check-docs-markdown.mjs — the unified documentation-markdown gate.
 *
 * Implements ADR-040: the three original Markdown inspectors (heading
 * hierarchy, list style, minimal metadata) are fused into ONE gate validating
 * form, format and hygiene of every Markdown file under docs/ (recursive),
 * with actionable per-file/per-line failures. Per ADR-040 this gate is intentionally NOT
 * registered in the freeze's KNOWN_GATES — its admission path is the ADR
 * that names it (`docs/ADR-040-docs-markdown-gate-fusion.md` contains the
 * token `check:docs-markdown`, so the freeze accepts it self-enforcingly).
 *
 * Rules (ADR-040 scope: heading hierarchy, list style, minimal metadata):
 *   docs-markdown/heading-hierarchy   first heading is H1; no level skips
 *   docs-markdown/list-style          no mixed list markers in a same-indent block
 *   docs-markdown/file-metadata       every file starts with an H1 title
 *
 * The ADR template contract (Estado/Fecha/Contexto/Decisión/Consecuencias on
 * docs/ADR-*.md) is folded in per ADR-040 ("no re-fragmentation"): the gate
 * imports the REAL eslint-rules/require-adr-template.mjs rule and runs it
 * through eslint-rules/lib/markdown-parser.mjs — one implementation, two
 * surfaces (npm run lint and this gate), never a divergent reimplementation.
 *
 * Drift baseline (ADR-028): scripts/docs-markdown-baseline.json records the
 * rule inventory, per-rule PER-FILE finding counts, files scanned and a
 * fold-in fingerprint. The gate fails closed on: a missing baseline, new
 * findings in any file, a changed rule set (removal = silent weakening),
 * dropped coverage, or a stale fold-in fingerprint. The negative path is
 * exercised in scripts/__tests__/check-docs-markdown.test.mjs.
 *
 * Usage:
 *   node scripts/check-docs-markdown.mjs              # verify vs baseline
 *   node scripts/check-docs-markdown.mjs --update     # regenerate baseline
 *   node scripts/check-docs-markdown.mjs --json       # machine-readable
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Linter } from "eslint";
import markdownParser from "../eslint-rules/lib/markdown-parser.mjs";
import adrRule from "../eslint-rules/require-adr-template.mjs";

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, "scripts", "docs-markdown-baseline.json");
const SCHEMA_VERSION = 1;
const ADR_RE = /^ADR-\d{3}.*\.md$/;

// ── corpus discovery ────────────────────────────────────────────────────────
function walkDocs(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // docs/ missing (fresh harness) — the scan simply finds no files
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkDocs(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}// ── native hygiene rules (fence-aware) ──────────────────────────────────────
/**
 * Scan one file for the native rules. Returns findings:
 *   { rule, line, message }
 * Headings and list blocks ignore fenced code (``` / ~~~) contents.
 */
function scanNative(text) {
  const findings = [];
  const lines = text.split(/\r\n|\r|\n/);
  const headings = [];
  const listBlocks = new Map(); // indent → Set(marker)
  let inFence = false;

  lines.forEach((raw, idx) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) {
      headings.push({ line: idx + 1, level: h[1].length, text: h[2] });
      return;
    }
    const li = /^(\s*)([-*+])\s+\S/.exec(raw);
    if (li) {
      const indent = li[1].length;
      if (!listBlocks.has(indent)) listBlocks.set(indent, new Set());
      listBlocks.get(indent).add(li[2]);
    }
  });

  if (headings.length === 0) {
    findings.push({ rule: "docs-markdown/file-metadata", line: 1, message: "file has no headings at all — start docs with an `# H1` title" });
  } else {
    if (headings[0].line !== 1) {
      findings.push({ rule: "docs-markdown/file-metadata", line: headings[0].line, message: "first heading is not on line 1 — docs files must start with the `# H1` title (preamble before H1 is not allowed)" });
    }
    if (headings[0].level !== 1) {
      findings.push({ rule: "docs-markdown/heading-hierarchy", line: headings[0].line, message: `first heading is H${headings[0].level}, must be H1` });
    }
    if (headings.filter((h) => h.level === 1).length > 1) {
      findings.push({ rule: "docs-markdown/heading-hierarchy", line: headings[0].line, message: "multiple H1 headings — use H2 subsections" });
    }
    for (let i = 1; i < headings.length; i++) {
      if (headings[i].level > headings[i - 1].level + 1) {
        findings.push({ rule: "docs-markdown/heading-hierarchy", line: headings[i].line, message: `heading level skip H${headings[i - 1].level} → H${headings[i].level}` });
      }
    }
  }

  for (const [indent, markers] of [...listBlocks.entries()].sort((a, b) => a[0] - b[0])) {
    if (markers.size > 1) {
      findings.push({ rule: "docs-markdown/list-style", line: 1, message: `mixed list markers (${[...markers].sort().join(" / ")}) at indent ${indent}` });
    }
  }
  return findings;
}

// ── ADR-template fold-in (single source of truth: the ESLint rule) ─────────
const linter = new Linter({ configType: "flat" });

function lintAdrFile(file, text) {
  // The Linter's config glob is anchored at docs/ — feed it a docs-anchored
  // filename (basename preserved; the rule self-gates on the basename and the
  // header-number check uses it) so the fold-in behaves identically for any
  // scan root, including the tmp roots the tests scan.
  const lintFilename = `docs/${file.split(sep).pop()}`;
  return linter
    .verify(
      text,
      {
        plugins: { bmf: { rules: { "require-adr-template": adrRule } } },
        files: ["docs/ADR-*.md"],
        languageOptions: { parser: markdownParser },
        rules: { "bmf/require-adr-template": "error" },
      },
      { filename: lintFilename },
    )
    .map((m) => ({
      rule: "docs-markdown/adr-template",
      line: m.line,
      message: `${m.message} [folded from bmf/require-adr-template]`,
    }));
}

// ── fold-in fingerprint (ADR-028 negative path: weakening is detectable) ───
/**
 * Fingerprint of the folded-in implementation, so a weakened edit of the
 * rule, a swap for a divergent reimplementation, or an ESLint bump changes
 * the fingerprint (a reviewed scope change, never silent drift). Uses
 * git-blob hashes of the two files plus the ESLint version.
 */
function foldInFingerprint() {
  const hash = (p) =>
    execFileSync("git", ["-c", `safe.directory=${ROOT}`, "hash-object", p], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  let ruleHash = "unavailable";
  let parserHash = "unavailable";
  try {
    ruleHash = hash("eslint-rules/require-adr-template.mjs");
    parserHash = hash("eslint-rules/lib/markdown-parser.mjs");
  } catch {
    /* INTENTIONAL SILENCE: git can be unavailable in sandboxed runs; the
       fingerprint then pins only the ESLint version, which still detects the
       most common drift (toolchain move). The FS-based tests also pin the
       rule inventory directly, so weakening stays caught without git. */
  }
  return {
    rule: ruleHash,
    parser: parserHash,
    eslint: Linter.version,
  };
}

// ── gate core (pure, testable) ──────────────────────────────────────────────
/**
 * Compare scan vs baseline and produce ok/failure lists. The baseline records
 * per-rule PER-FILE finding counts (not just totals): "fix file A, break file
 * B" keeps the total equal and must still fail. A missing baseline fails
 * closed — first run must be an explicit --update after review.
 */
export function evaluateScan(scan, baseline, { update = false } = {}) {
  const failures = [];
  const oks = [];

  if (update) {
    oks.push("baseline regenerated (--update)");
    return { ok: true, oks, failures: [], baseline: scan };
  }

  if (!baseline) {
    failures.push(
      "no baseline at scripts/docs-markdown-baseline.json — run `node scripts/check-docs-markdown.mjs --update` " +
        "after reviewing the findings below, then commit the baseline",
    );
    for (const f of scan.findings) {
      failures.push(`${f.file}:${f.line} ${f.rule} — ${f.message}`);
    }
    return { ok: false, oks, failures, baseline };
  }

  // 1. Rule inventory drift (ADR-028: a removed rule is silent weakening;
  //    a new rule is a scope change that must be reviewed).
  const scanRules = Object.keys(scan.ruleCounts).sort();
  const baseRules = Object.keys(baseline.ruleCounts ?? {}).sort();
  if (JSON.stringify(scanRules) !== JSON.stringify(baseRules)) {
    const removed = baseRules.filter((r) => !scanRules.includes(r));
    const added = scanRules.filter((r) => !baseRules.includes(r));
    failures.push(
      `rule inventory drift — removed: [${removed.join(", ") || "none"}], added: [${added.join(", ") || "none"}]. ` +
        `Removing a rule silently weakens the gate; adding one changes reviewed scope. ` +
        `Update scripts/docs-markdown-baseline.json with --update only after reviewing.`,
    );
  } else {
    oks.push(`rule inventory stable: ${scanRules.length} rules`);
  }

  // 2. Per-rule, per-file comparison: any file above its baseline count (or
  //    newly carrying findings for a rule) is a regression, even when the
  //    global total stays equal (fix A / break B must fail).
  const basePerFile = baseline.perFile ?? {};
  for (const rule of scanRules) {
    const scanForRule = scan.perFile?.[rule] ?? {};
    const baseForRule = basePerFile[rule] ?? {};
    const files = [...new Set([...Object.keys(scanForRule), ...Object.keys(baseForRule)])].sort();
    let regressed = 0;
    let improved = 0;
    for (const file of files) {
      const before = baseForRule[file] ?? 0;
      const now = scanForRule[file] ?? 0;
      if (now > before) {
        regressed += 1;
        // The regression itself always fails — even when the scan carries no
        // detail findings (synthetic baselines). ADR-028: this path must be
        // unable to pass silently.
        failures.push(
          `${file}: ${rule} regressed vs baseline (${before} → ${now} finding(s)) — new doc-hygiene violation. Fix the docs or regenerate the baseline with --update after review.`,
        );
        for (const f of (scan.findings ?? []).filter((x) => x.rule === rule && x.file === file)) {
          failures.push(`${f.file}:${f.line} ${f.rule} — ${f.message}`);
        }
      } else if (now < before) {
        improved += 1;
      }
    }
    if (regressed === 0 && improved === 0) {
      oks.push(`${rule}: ${scan.ruleCounts[rule]} finding(s), matches baseline`);
    } else if (regressed === 0) {
      oks.push(`${rule}: improved in ${improved} file(s) (baseline tightens on next --update)`);
    }
  }

  // 3. Coverage drift (files disappearing from the scan = silent narrowing).
  if (scan.fileCount < baseline.fileCount) {
    failures.push(
      `coverage drift — ${baseline.fileCount - scan.fileCount} file(s) no longer scanned ` +
        `(baseline ${baseline.fileCount}, scan ${scan.fileCount}). Docs files must not silently leave gate coverage.`,
    );
  } else if (scan.fileCount === baseline.fileCount) {
    oks.push(`coverage stable: ${scan.fileCount} docs files`);
  } else {
    oks.push(`coverage grew: ${baseline.fileCount} → ${scan.fileCount} files (baseline widens on next --update)`);
  }

  // 4. Fold-in fingerprint drift (the folded rule/parser/eslint changed).
  if (baseline.foldIn) {
    const changed = ["rule", "parser", "eslint"].filter(
      (k) => scan.foldIn?.[k] !== baseline.foldIn[k],
    );
    if (changed.length > 0) {
      failures.push(
        `fold-in fingerprint changed: [${changed.join(", ")}] — the folded ADR-template implementation ` +
          `(eslint-rules/require-adr-template.mjs, lib/markdown-parser.mjs) or ESLint itself moved. ` +
          `Review that the ADR-template contract still holds on docs/ADR-*.md, then --update.`,
      );
    } else {
      oks.push("fold-in fingerprint unchanged");
    }
  }

  return { ok: failures.length === 0, oks, failures, baseline };
}

/** Scan the whole docs/ tree. Keys are relative to the scan root (NOT the
 * module ROOT) so baselines match regardless of where the scan runs — the
 * tests scan tmp roots, and across-drive relative() would otherwise yield
 * absolute keys that can never match a baseline. */
export function scanDocs({ root = ROOT } = {}) {
  const rel = (p) => relative(root, p).split(sep).join("/");
  const files = walkDocs(join(root, "docs")).sort();
  const findings = [];
  const ruleCounts = {
    "docs-markdown/heading-hierarchy": 0,
    "docs-markdown/list-style": 0,
    "docs-markdown/file-metadata": 0,
    "docs-markdown/adr-template": 0,
  };
  let adrFiles = 0;

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const f of scanNative(text)) {
      findings.push({ ...f, file: rel(file) });
    }
    if (ADR_RE.test(file.split(sep).pop())) {
      adrFiles += 1;
      for (const f of lintAdrFile(file, text)) {
        findings.push({ ...f, file: rel(file) });
      }
    }
  }
  for (const f of findings) ruleCounts[f.rule] += 1;

  // Per-rule, per-file counts — the baseline's regression unit (a total-only
  // baseline would let "fix file A, break file B" pass at equal counts).
  const perFile = {};
  for (const rule of Object.keys(ruleCounts)) perFile[rule] = {};
  for (const f of findings) {
    perFile[f.rule][f.file] = (perFile[f.rule][f.file] ?? 0) + 1;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    fileCount: files.length,
    adrFileCount: adrFiles,
    findings,
    ruleCounts,
    perFile,
    foldIn: foldInFingerprint(),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function main() {
  const update = process.argv.includes("--update");
  const json = process.argv.includes("--json");
  const scan = scanDocs();
  let baseline = null;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (update) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(scan, null, 2)}\n`);
    console.log(
      `[check-docs-markdown] baseline regenerated: ${scan.fileCount} files, ${scan.adrFileCount} ADRs, ${scan.findings.length} findings`,
    );
  }

  const result = evaluateScan(scan, update ? scan : baseline, { update });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const o of result.oks) console.log(`[check-docs-markdown] ok ${o}`);
    for (const f of result.failures) console.error(`[check-docs-markdown] FAIL ${f}`);
  }
  if (!result.ok) {
    console.error(`[check-docs-markdown] ${result.failures.length} problem(s) in docs/ markdown`);
    process.exit(1);
  }
  console.log(`[check-docs-markdown] docs/ markdown clean (${scan.fileCount} files)`);
}

const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isMain) {
  main();
}
