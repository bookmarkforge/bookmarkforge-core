import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { QUICK_GATES, runQuickChecks } from "../check-quick.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** In-memory spawn: returns the scripted result per call and records argv. */
function fakeSpawn(results = []) {
  const calls = [];
  const spawn = (file, argv, opts) => {
    calls.push({ file, argv, opts });
    return results[calls.length - 1] ?? { status: 0, stdout: "", stderr: "" };
  };
  return { spawn, calls };
}

const TWO_GATES = [
  { gate: "check:alpha", script: "scripts/alpha.mjs" },
  { gate: "check:beta", script: "scripts/beta.mjs", args: ["--flag"] },
];

describe("check:quick tier", () => {
  it("runs every gate and reports PASS when all succeed", () => {
    const { spawn, calls } = fakeSpawn([{ status: 0, stdout: "ok\n" }]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = runQuickChecks({ gates: TWO_GATES, spawn });

    expect(result.failed).toBe(false);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.status === "PASS")).toBe(true);
    expect(result.summary).toContain("2/2 gates");
    // Each gate spawns node itself (no shell), piping output, utf8.
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.file).toBe(process.execPath);
      expect(call.opts.encoding).toBe("utf8");
      expect(call.opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    }
    logSpy.mockRestore();
  });

  it("threads gate args through to the spawned script", () => {
    const { spawn, calls } = fakeSpawn();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    runQuickChecks({ gates: TWO_GATES, spawn });

    expect(calls[0].argv).toEqual(["scripts/alpha.mjs"]);
    // e.g. check:license-keys must stay read-only via --check.
    expect(calls[1].argv).toEqual(["scripts/beta.mjs", "--flag"]);
    logSpy.mockRestore();
  });

  it("fails fast: the first red gate stops the tier and prints its output", () => {
    const { spawn, calls } = fakeSpawn([
      { status: 0, stdout: "alpha ok\n" },
      { status: 3, stdout: "", stderr: "contract broken\n" },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = runQuickChecks({ gates: TWO_GATES, spawn });

    expect(result.failed).toBe(true);
    expect(result.rows).toHaveLength(2); // gate 3 never runs
    expect(result.rows[1].status).toBe("FAIL(exit 3)");
    expect(result.rows[1].out).toContain("contract broken");
    expect(result.summary).toContain("FAIL");
    expect(result.summary).toContain("npm run check"); // pointer to the real gate
    expect(calls).toHaveLength(2);
    logSpy.mockRestore();
  });

  it("captures stdout+stderr into the row and never throws on empty output", () => {
    const { spawn } = fakeSpawn([{ status: 0, stdout: "" }, { status: 1, stdout: "a\n", stderr: "b\n" }]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = runQuickChecks({ gates: TWO_GATES, spawn });

    expect(result.rows[0].out).toBe("");
    expect(result.rows[1].out).toBe("a\nb\n");
    expect(result.failed).toBe(true);
    logSpy.mockRestore();
  });

  it("keeps the duration floor honest (ms is never negative)", () => {
    const { spawn } = fakeSpawn();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = runQuickChecks({ gates: TWO_GATES, spawn });

    for (const row of result.rows) {
      expect(row.ms).toBeGreaterThanOrEqual(0);
      expect(row.ms).toBeLessThan(1000);
    }
    expect(result.total).toBe(result.rows.reduce((sum, r) => sum + r.ms, 0));
    logSpy.mockRestore();
  });

  // Contract: the tier is a read-only selector of EXISTING frozen gates.
  // Every entry must (a) be registered in the freeze's KNOWN_GATES with a
  // boundary-appropriate category (security, or meta for boundaries — the
  // import-edge gate) and (b) point at a script that exists on disk — so a
  // rename in either place fails here instead of breaking the tier at run time.
  it("every QUICK_GATES entry is a registered gate with a real script", () => {
    const freezeSource = readFileSync(
      join(REPO_ROOT, "scripts", "check-inspector-freeze.mjs"),
      "utf8",
    );
    for (const { gate, script } of QUICK_GATES) {
      expect(freezeSource).toMatch(new RegExp(`"${gate}":\\s*"(security|meta)"`));
      expect(existsSync(join(REPO_ROOT, script))).toBe(true);
    }
  });

  // Contract: sub-second subset only. The slow gates measured in the 62 s
  // chain (lint 21 s, no-unbounded-text 13.4 s, CVE scans, audit-drift) must
  // never leak into the fast tier — they stay in `npm run check`.
  it("excludes the known slow gates from the fast tier", () => {
    const slowScripts = [
      "check-no-unbounded-text",
      "check-direct-cve",
      "check-override-cve",
      "check-audit-drift",
      "lint-bounded",
    ];
    const serialized = JSON.stringify(QUICK_GATES);
    for (const slow of slowScripts) {
      expect(serialized).not.toContain(slow);
    }
    expect(QUICK_GATES.length).toBeLessThanOrEqual(10);
  });

  // Contract: additive only. check:quick must never appear in the `npm run
  // check` chain, or the inspector freeze (O-1) would demand an ADR for it.
  it("stays out of the official check chain (O-1 additive contract)", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["check:quick"]).toContain("check-quick.mjs");
    expect(pkg.scripts.check).not.toContain("check:quick");
  });
});
