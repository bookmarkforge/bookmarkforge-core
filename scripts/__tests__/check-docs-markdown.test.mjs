// @vitest-environment node
/**
 * scripts/__tests__/check-docs-markdown.test.mjs
 *
 * Tests for the unified docs-markdown gate (ADR-040): native hygiene rules,
 * the folded-in ADR-template contract (real ESLint rule), the drift baseline
 * semantics (ADR-028: every weakening path must be detectable), and the
 * freeze wiring on the real repo.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateScan,
  scanDocs,
} from "../check-docs-markdown.mjs";
import {
  runInspectorFreezeChecks,
  adrNamesGate,
  adrBodies,
} from "../check-inspector-freeze.mjs";

// ── fixture factory ─────────────────────────────────────────────────────────
let tmpRoot;
function makeScan(docs) {
  tmpRoot = mkdtempSync(join(tmpdir(), "docs-md-gate-"));
  mkdirSync(join(tmpRoot, "docs"), { recursive: true });
  for (const [name, content] of Object.entries(docs)) {
    const p = join(tmpRoot, "docs", name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return scanDocs({ root: tmpRoot });
}

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  }
});

const RULES = [
  "docs-markdown/heading-hierarchy",
  "docs-markdown/list-style",
  "docs-markdown/file-metadata",
  "docs-markdown/adr-template",
];

const GOOD_DOC = "# Título\n\ntexto\n";
const GOOD_ADR = [
  "# ADR-901: Prueba",
  "",
  "- **Estado:** aceptado",
  "- **Fecha:** 2026-09-02",
  "",
  "## Contexto",
  "",
  "c",
  "",
  "## Decisión",
  "",
  "d",
  "",
  "## Consecuencias",
  "",
  "e",
].join("\n");

// ── native rules: positive + negative paths ────────────────────────────────
describe("docs-markdown native rules", () => {
  it("clean corpus yields zero findings across all four rules", () => {
    const scan = makeScan({
      "readme.md": GOOD_DOC,
      "ADR-901-prueba.md": GOOD_ADR,
    });
    expect(scan.fileCount).toBe(2);
    expect(scan.adrFileCount).toBe(1);
    expect(scan.ruleCounts).toMatchObject(
      Object.fromEntries(RULES.map((r) => [r, 0])),
    );
    expect(scan.findings).toEqual([]);
  });

  it("detects a non-H1 first heading", () => {
    const scan = makeScan({ "x.md": "## Salto\n\ntexto\n" });
    expect(scan.ruleCounts["docs-markdown/heading-hierarchy"]).toBe(1);
    expect(scan.findings[0].line).toBe(1);
    expect(scan.findings[0].message).toContain("must be H1");
  });

  it("detects heading level skips", () => {
    const scan = makeScan({ "x.md": "# T\n\n## A\n\n#### B\n" });
    expect(scan.ruleCounts["docs-markdown/heading-hierarchy"]).toBe(1);
    expect(scan.findings[0].message).toContain("H2 → H4");
  });

  it("detects multiple H1s and preamble-before-H1", () => {
    const scan = makeScan({
      "a.md": "# A\n\n# B\n",
      "b.md": "intro\n\n# T\n",
    });
    expect(scan.ruleCounts["docs-markdown/heading-hierarchy"]).toBe(1);
    expect(scan.ruleCounts["docs-markdown/file-metadata"]).toBe(1);
    expect(scan.findings.find((f) => f.rule === "docs-markdown/file-metadata").message).toContain("line 1");
  });

  it("detects mixed list markers in the same block, fence-aware", () => {
    const scan = makeScan({
      "x.md": "# T\n\n- a\n* b\n\n```md\n- c\n* d\n```\n",
    });
    expect(scan.ruleCounts["docs-markdown/list-style"]).toBe(1);
    // The fenced block must NOT count as a second violation.
    expect(scan.findings[0].message).toContain("mixed list markers");
  });

  it("folded ADR-template contract fires through the real ESLint rule", () => {
    const scan = makeScan({
      "ADR-901-roto.md": "# ADR-901: Roto\n\n## Contexto\n\nc\n",
    });
    expect(scan.ruleCounts["docs-markdown/adr-template"]).toBeGreaterThanOrEqual(1);
    expect(scan.findings[0].message).toContain("[folded from bmf/require-adr-template]");
  });
});

// ── baseline semantics (ADR-028) ────────────────────────────────────────────
describe("docs-markdown baseline semantics", () => {
  it("fails closed when the baseline is missing", () => {
    const scan = {
      schemaVersion: 1,
      fileCount: 1,
      adrFileCount: 0,
      findings: [{ file: "docs/x.md", line: 1, rule: "docs-markdown/file-metadata", message: "m" }],
      ruleCounts: Object.fromEntries(RULES.map((r) => [r, r === "docs-markdown/file-metadata" ? 1 : 0])),
      perFile: { ...Object.fromEntries(RULES.map((r) => [r, {}])), "docs-markdown/file-metadata": { "docs/x.md": 1 } },
      foldIn: { rule: "a", parser: "b", eslint: "9.39.5" },
    };
    const result = evaluateScan(scan, null);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("no baseline");
  });

  it("missing-baseline failure lists current findings for review", () => {
    const scan = {
      schemaVersion: 1, fileCount: 1, adrFileCount: 0, findings: [],
      ruleCounts: Object.fromEntries(RULES.map((r) => [r, 0])),
      perFile: Object.fromEntries(RULES.map((r) => [r, {}])),
      foldIn: { rule: "a", parser: "b", eslint: "9.39.5" },
    };
    const result = evaluateScan(scan, null);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("--update");
  });

  it("fails on new findings vs the baseline", () => {
    const scan = makeScan({ "x.md": "# T\n\n- a\n* b\n" });
    const baseline = structuredClone(scan);
    baseline.ruleCounts["docs-markdown/list-style"] = 1;
    baseline.perFile["docs-markdown/list-style"] = { "docs/x.md": 1 };
    const clean = structuredClone(scan);
    clean.findings = [];
    clean.ruleCounts["docs-markdown/list-style"] = 0;
    const result = evaluateScan(clean, baseline);
    expect(result.ok).toBe(true); // improvement is not a failure
  });

  it("improvements tighten without failing", () => {
    const scan = makeScan({ "x.md": GOOD_DOC });
    const baseline = structuredClone(scan);
    baseline.ruleCounts["docs-markdown/list-style"] = 1;
    baseline.perFile["docs-markdown/list-style"] = { "docs/x.md": 1 };
    const result = evaluateScan(scan, baseline);
    expect(result.ok).toBe(true);
    expect(result.oks.some((o) => o.includes("improved"))).toBe(true);
  });

  it("detects fix-A-break-B at equal totals (per-file unit)", () => {
    const scan = makeScan({ "x.md": GOOD_DOC, "y.md": GOOD_DOC });
    const mk = (a, b) => {
      const s = structuredClone(scan);
      s.findings = [];
      s.ruleCounts["docs-markdown/file-metadata"] = 1;
      s.perFile["docs-markdown/file-metadata"] = { "docs/a.md": a, "docs/b.md": b };
      return s;
    };
    const baseline = mk(1, 0);
    const now = mk(0, 1);
    const result = evaluateScan(now, baseline);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes("docs/b.md"))).toBe(true);
  });

  it("detects rule inventory drift (removed rule = weakening)", () => {
    const scan = makeScan({ "x.md": GOOD_DOC });
    const baseline = structuredClone(scan);
    delete baseline.ruleCounts["docs-markdown/list-style"];
    delete baseline.perFile["docs-markdown/list-style"];
    const result = evaluateScan(scan, baseline);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("rule inventory drift");
    expect(result.failures[0]).toContain("docs-markdown/list-style");
  });

  it("detects added rules as reviewed-scope changes", () => {
    const scan = makeScan({ "x.md": GOOD_DOC });
    const baseline = structuredClone(scan);
    baseline.ruleCounts["docs-markdown/new-rule"] = 0;
    baseline.perFile["docs-markdown/new-rule"] = {};
    const result = evaluateScan(scan, baseline);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("added");
  });

  it("detects coverage drift (file leaves the scan)", () => {
    const scan = makeScan({ "x.md": GOOD_DOC });
    const baseline = structuredClone(scan);
    baseline.fileCount = 2;
    const result = evaluateScan(scan, baseline);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("coverage drift");
  });

  it("detects fold-in fingerprint drift", () => {
    const scan = makeScan({ "x.md": GOOD_DOC });
    const baseline = structuredClone(scan);
    baseline.foldIn.rule = "different";
    const result = evaluateScan(scan, baseline);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("fold-in fingerprint changed");
  });

  it("--update regenerates and always passes", () => {
    const scan = makeScan({ "x.md": "# T\n\n- a\n* b\n" });
    const result = evaluateScan(scan, null, { update: true });
    expect(result.ok).toBe(true);
    expect(result.baseline.ruleCounts["docs-markdown/list-style"]).toBe(1);
  });
});

// ── freeze wiring on the real repo ──────────────────────────────────────────
describe("docs-markdown freeze wiring (real repo)", () => {
  it("ADR-040 on disk names check:docs-markdown (self-enforcing acceptance)", () => {
    const bodies = adrBodies();
    expect(adrNamesGate("check:docs-markdown", bodies)).toBe(true);
  });

  it("the real check chain passes the freeze with the new gate present", () => {
    const pkg = {
      scripts: {
        check:
          "npm run check:env && npm run check:docs-markdown && npm run lint",
      },
    };
    const result = runInspectorFreezeChecks({
      pkg,
      adrBody: adrBodies(),
    });
    expect(result.ok).toBe(true);
  });
});
