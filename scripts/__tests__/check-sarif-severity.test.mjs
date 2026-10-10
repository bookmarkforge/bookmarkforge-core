import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeSarif,
  analyzeSarifWithPolicy,
  applyBaseline,
  buildFindingsTable,
  buildSummaryTable,
  classifySeverity,
  isBlocking,
  loadSarifFiles,
  matchesBaselineEntry,
  normalizePath,
  parseBaseline,
  resolveThreshold,
  SEVERITY_RANK,
} from "../check-sarif-severity.mjs";

const FIXTURES = "scripts/__tests__/fixtures/sarif";

const sarifWith = (results, toolName = "CodeQL") => ({
  version: "2.1.0",
  runs: [
    {
      tool: { driver: { name: toolName } },
      results,
    },
  ],
});

const resultWith = (overrides) => ({
  ruleId: "test/rule",
  level: "error",
  message: { text: "finding" },
  locations: [
    {
      physicalLocation: {
        artifactLocation: { uri: "src/index.ts" },
        region: { startLine: 1 },
      },
    },
  ],
  ...overrides,
});

describe("classifySeverity", () => {
  it("maps security-severity properties (CodeQL style)", () => {
    expect(classifySeverity(resultWith({ properties: { "security-severity": "high" } }))).toBe("high");
    expect(classifySeverity(resultWith({ properties: { "security-severity": "Critical" } }))).toBe("critical");
  });

  it("maps SARIF levels (Semgrep style)", () => {
    expect(classifySeverity(resultWith({ level: "error" }))).toBe("high");
    expect(classifySeverity(resultWith({ level: "warning" }))).toBe("medium");
    expect(classifySeverity(resultWith({ level: "note" }))).toBe("low");
  });

  it("reports unknown when no severity information exists", () => {
    expect(classifySeverity(resultWith({ level: undefined, properties: {} }))).toBe("unknown");
  });
});

describe("isBlocking", () => {
  it("blocks at or above the threshold and is fail-closed for unknown", () => {
    expect(isBlocking("critical", "high")).toBe(true);
    expect(isBlocking("high", "high")).toBe(true);
    expect(isBlocking("medium", "high")).toBe(false);
    expect(isBlocking("low", "medium")).toBe(false);
    expect(isBlocking("unknown", "high")).toBe(true);
  });

  it("treats invalid thresholds as blocking", () => {
    expect(isBlocking("high", "bogus")).toBe(true);
  });
});

describe("analyzeSarif", () => {
  it("blocks when a high finding is present", () => {
    const sarif = sarifWith([
      resultWith({ properties: { "security-severity": "high" } }),
    ]);
    const { findings, blocking } = analyzeSarif(sarif, "high");
    expect(findings).toHaveLength(1);
    expect(blocking).toHaveLength(1);
    expect(findings[0].ruleId).toBe("test/rule");
    expect(findings[0].file).toBe("src/index.ts");
    expect(findings[0].line).toBe(1);
  });

  it("blocks on a raw error level without security-severity", () => {
    const sarif = sarifWith([resultWith({ properties: undefined })], "Semgrep");
    expect(analyzeSarif(sarif, "high").blocking).toHaveLength(1);
  });

  it("does not block on warning findings at the high threshold", () => {
    const sarif = sarifWith(
      [resultWith({ level: "warning", properties: undefined })],
      "Semgrep",
    );
    const { findings, blocking } = analyzeSarif(sarif, "high");
    expect(findings).toHaveLength(1);
    expect(blocking).toHaveLength(0);
  });

  it("parses the committed high-severity fixture", () => {
    const sarif = JSON.parse(readFileSync(join(FIXTURES, "sample-high.sarif"), "utf8"));
    const { findings, blocking } = analyzeSarif(sarif, "high");
    expect(findings[0].ruleId).toBe("js/command-line-injection");
    expect(findings[0].severity).toBe("high");
    expect(blocking).toHaveLength(1);
  });

  it("passes the committed clean fixture", () => {
    const sarif = JSON.parse(readFileSync(join(FIXTURES, "sample-clean.sarif"), "utf8"));
    const { blocking } = analyzeSarif(sarif, "high");
    expect(blocking).toHaveLength(0);
  });
});

describe("loadSarifFiles", () => {
  it("returns .sarif files from a directory", () => {
    const files = loadSarifFiles(FIXTURES);
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.endsWith(".sarif"))).toBe(true);
  });

  it("accepts a single file", () => {
    const files = loadSarifFiles(join(FIXTURES, "sample-high.sarif"));
    expect(files).toEqual([join(FIXTURES, "sample-high.sarif")]);
  });

  it("returns an empty list for a directory without sarif files", () => {
    const dir = mkdtempSync(join(tmpdir(), "sarif-gate-"));
    try {
      expect(loadSarifFiles(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws for a missing path", () => {
    expect(() => loadSarifFiles("scripts/__tests__/fixtures/sarif/nope.sarif")).toThrow(/does not exist/);
  });
});

describe("SEVERITY_RANK", () => {
  it("orders severities from critical to none", () => {
    expect(SEVERITY_RANK.critical).toBeLessThan(SEVERITY_RANK.high);
    expect(SEVERITY_RANK.high).toBeLessThan(SEVERITY_RANK.medium);
    expect(SEVERITY_RANK.medium).toBeLessThan(SEVERITY_RANK.low);
    expect(SEVERITY_RANK.low).toBeLessThan(SEVERITY_RANK.none);
  });
});

describe("normalizePath", () => {
  it("normalizes separators and leading ./", () => {
    expect(normalizePath("src\\index.ts")).toBe("src/index.ts");
    expect(normalizePath("./src/index.ts")).toBe("src/index.ts");
    expect(normalizePath("  server/src/a.ts ")).toBe("server/src/a.ts");
  });
});

describe("resolveThreshold", () => {
  it("falls back to the global threshold", () => {
    expect(resolveThreshold({ global: "high", byTool: {} }, "CodeQL")).toBe("high");
    expect(resolveThreshold(undefined, "CodeQL")).toBe("high");
  });

  it("applies per-tool overrides case-insensitively", () => {
    const thresholds = { global: "high", byTool: { semgrep: "medium" } };
    expect(resolveThreshold(thresholds, "Semgrep")).toBe("medium");
    expect(resolveThreshold(thresholds, "CodeQL")).toBe("high");
  });
});

describe("analyzeSarifWithPolicy", () => {
  const twoToolSarif = {
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "CodeQL" } },
        results: [resultWith({ ruleId: "js/x", properties: { "security-severity": "high" } })],
      },
      {
        tool: { driver: { name: "Semgrep" } },
        results: [resultWith({ ruleId: "y", level: "warning", properties: undefined })],
      },
    ],
  };

  it("blocks per tool when the threshold is tightened", () => {
    const { blocking } = analyzeSarifWithPolicy(twoToolSarif, {
      global: "high",
      byTool: { semgrep: "medium" },
    });
    expect(blocking).toHaveLength(2);
  });

  it("respects a laxer per-tool threshold", () => {
    const { blocking } = analyzeSarifWithPolicy(twoToolSarif, {
      global: "high",
      byTool: { codeql: "critical" },
    });
    expect(blocking).toHaveLength(0);
  });
});

describe("parseBaseline", () => {
  const valid = [
    { ruleId: "js/x", file: "src/index.ts", tool: "CodeQL", line: 10, approved: true, justification: "fp documentado" },
  ];

  it("accepts valid entries", () => {
    expect(parseBaseline(JSON.stringify(valid))).toHaveLength(1);
  });

  it("rejects invalid JSON and non-arrays", () => {
    expect(() => parseBaseline("nope")).toThrow(/JSON/);
    expect(() => parseBaseline('{"ruleId":"x"}')).toThrow(/array/);
  });

  it("requires ruleId and file", () => {
    expect(() => parseBaseline(JSON.stringify([{ file: "f", approved: true, justification: "j" }]))).toThrow(/ruleId/);
    expect(() => parseBaseline(JSON.stringify([{ ruleId: "x", approved: true, justification: "j" }]))).toThrow(/file/);
  });

  it("requires approved: true and a justification", () => {
    expect(() => parseBaseline(JSON.stringify([{ ruleId: "x", file: "f", justification: "j" }]))).toThrow(/approved/);
    expect(() => parseBaseline(JSON.stringify([{ ruleId: "x", file: "f", approved: true }]))).toThrow(/justification/);
  });
});

describe("matchesBaselineEntry", () => {
  const finding = { toolName: "CodeQL", ruleId: "js/x", file: "src/index.ts", line: 10 };
  const entry = (overrides) => ({
    ruleId: "js/x",
    file: "src/index.ts",
    tool: "CodeQL",
    approved: true,
    justification: "j",
    ...overrides,
  });

  it("matches on tool, rule, file and line", () => {
    expect(matchesBaselineEntry(finding, entry({}))).toBe(true);
  });

  it("matches any line when line is omitted", () => {
    expect(matchesBaselineEntry({ ...finding, line: 42 }, entry({ line: undefined }))).toBe(true);
  });

  it("does not match a different tool or line", () => {
    expect(matchesBaselineEntry(finding, entry({ tool: "Semgrep" }))).toBe(false);
    expect(matchesBaselineEntry(finding, entry({ line: 99 }))).toBe(false);
  });

  it("normalizes path separators in entries", () => {
    expect(matchesBaselineEntry(finding, entry({ file: ".\\src\\index.ts" }))).toBe(true);
  });
});

describe("applyBaseline", () => {
  const findings = [
    { toolName: "CodeQL", ruleId: "js/x", file: "src/index.ts", line: 10 },
    { toolName: "CodeQL", ruleId: "js/x", file: "src/index.ts", line: 11 },
  ];

  it("ignores approved findings and reports no stale entries", () => {
    const entries = [
      { ruleId: "js/x", file: "src/index.ts", tool: "CodeQL", line: 10, approved: true, justification: "fp" },
      { ruleId: "js/x", file: "src/index.ts", tool: "CodeQL", approved: true, justification: "line shifted" },
    ];
    const { remaining, ignored, stale } = applyBaseline(findings, entries);
    expect(ignored).toHaveLength(2);
    expect(remaining).toHaveLength(0);
    expect(stale).toHaveLength(0);
  });

  it("reports stale entries when a finding is fixed", () => {
    const { stale } = applyBaseline(findings, [
      { ruleId: "js/other", file: "src/other.ts", approved: true, justification: "fixed" },
    ]);
    expect(stale).toHaveLength(1);
  });
});

describe("buildSummaryTable", () => {
  it("renders a header and PASS/FAIL rows", () => {
    const rows = buildSummaryTable([
      { tool: "CodeQL", threshold: "high", total: 3, blocking: 2 },
      { tool: "Semgrep", threshold: "medium", total: 1, blocking: 0 },
    ]);
    expect(rows[0]).toContain("Tool");
    expect(rows[1]).toContain("FAIL");
    expect(rows[2]).toContain("PASS");
  });
});

describe("buildFindingsTable", () => {
  it("renders severity, rule and location", () => {
    const rows = buildFindingsTable([
      { severity: "high", ruleId: "js/x", toolName: "CodeQL", file: "src/a.ts", line: 3 },
    ]);
    expect(rows[0]).toContain("Severity");
    expect(rows[1]).toContain("high");
    expect(rows[1]).toContain("src/a.ts:3");
  });
});

describe("CLI", () => {
  const runCli = (args) =>
    spawnSync(process.execPath, ["scripts/check-sarif-severity.mjs", ...args], { encoding: "utf8" });
  const high = join(FIXTURES, "sample-high.sarif");
  const clean = join(FIXTURES, "sample-clean.sarif");

  it("blocks a high finding by default", () => {
    const result = runCli([high]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FAIL");
  });

  it("passes a medium finding at the high threshold", () => {
    expect(runCli([clean]).status).toBe(0);
  });

  it("blocks when a per-tool threshold is tightened", () => {
    const result = runCli(["--min-severity-for", "semgrep=medium", clean]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FAIL");
  });

  it("ignores findings approved in the baseline", () => {
    const dir = mkdtempSync(join(tmpdir(), "sarif-baseline-"));
    try {
      const baseline = join(dir, "baseline.json");
      writeFileSync(
        baseline,
        JSON.stringify([
          {
            ruleId: "js/command-line-injection",
            file: "server/src/proxy-utils.ts",
            tool: "CodeQL",
            line: 42,
            approved: true,
            justification: "test-approved",
          },
        ]),
      );
      const result = runCli(["--baseline", baseline, high]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("ignored");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when the baseline file is missing", () => {
    expect(runCli(["--baseline", "no-such-file.json", high]).status).toBe(1);
  });

  it("prints the summary table in table format", () => {
    const result = runCli(["--format", "table", high]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Tool");
    expect(result.stdout).toContain("Summary per tool");
  });
});
