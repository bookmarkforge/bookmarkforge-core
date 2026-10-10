import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PAIRS,
  computeStalePairs,
  formatStaleReport,
  runPreflight,
} from "../drift-preflight.mjs";

/**
 * Fixtures build a synthetic repo root in tmpdir with explicit mtimes, so
 * stale/fresh/missing states are deterministic (no sleeps, no real clocks).
 * Nothing here spawns npm or runs the real repo state.
 */

const T = 1_700_000_000_000; // fixed epoch for every fixture

function repoFixture(mtimes) {
  const root = mkdtempSync(join(tmpdir(), "drift-preflight-"));
  for (const [rel, mtimeMs] of Object.entries(mtimes)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, "x");
    utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
  }
  return root;
}

function writer() {
  const chunks = [];
  return { write: (s) => chunks.push(s), text: () => chunks.join("") };
}

const CLEAN_ROOTS = [];
function fixture(mtimes) {
  const root = repoFixture(mtimes);
  CLEAN_ROOTS.push(root);
  return root;
}

afterEach(() => {
  for (const root of CLEAN_ROOTS.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("PAIRS registry", () => {
  it("covers the three drift gates with script+baseline pairs", () => {
    expect(PAIRS).toHaveLength(3);
    for (const pair of PAIRS) {
      expect(pair.gate).toMatch(/^\S+$/);
      expect(pair.script).toMatch(/\.mjs$/);
      expect(pair.baseline.length).toBeGreaterThan(0);
    }
  });
});

describe("computeStalePairs", () => {
  it("flags a pair whose script is newer than its baseline", () => {
    const root = fixture({
      "scripts/audit-anchors.mjs": T + 1_000,
      "scripts/audit-anchors-baseline.json": T,
    });
    const stale = computeStalePairs(root, T + 2_000);
    expect(stale).toHaveLength(1);
    expect(stale[0].gate).toBe("audit-drift");
    expect(stale[0].reason).toContain("script newer than baseline");
  });

  it("a baseline newer than its script is fresh (normal post-refresh state)", () => {
    const root = fixture({
      "scripts/audit-anchors.mjs": T,
      "scripts/audit-anchors-baseline.json": T + 5_000,
    });
    expect(computeStalePairs(root, T + 6_000)).toHaveLength(0);
  });

  it("equal mtimes are fresh (single-tick batch)", () => {
    const root = fixture({
      "scripts/doctor-docs-index.mjs": T,
      "docs/docs-state-index.md": T,
    });
    expect(computeStalePairs(root, T)).toHaveLength(0);
  });

  it("a missing baseline is stale with its own reason", () => {
    const root = fixture({ "scripts/check-docs-markdown.mjs": T });
    const stale = computeStalePairs(root, T);
    expect(stale).toHaveLength(1);
    expect(stale[0].reason).toContain("baseline missing");
  });

  it("skips pairs whose script does not exist (repo without that gate)", () => {
    const root = fixture({}); // nothing at all
    expect(computeStalePairs(root, T)).toHaveLength(0);
  });

  it("is deterministic for identical inputs, and `now` shapes the delta", () => {
    const root = fixture({
      "scripts/audit-anchors.mjs": T + 1_000,
      "scripts/audit-anchors-baseline.json": T,
    });
    const a = computeStalePairs(root, T + 120_000);
    const b = computeStalePairs(root, T + 120_000);
    expect(a).toEqual(b);
    expect(a[0].reason).toContain("~2 min");
  });
});

describe("formatStaleReport", () => {
  it("names the gate, the remedy and the mtime escape hatch", () => {
    const report = formatStaleReport([
      { gate: "audit-drift", script: "s.mjs", baseline: "b.json", reason: "x" },
    ]);
    expect(report).toContain("audit-drift");
    expect(report).toContain("npm run gate:refresh");
    expect(report).toContain("checkout");
    expect(report).toContain("Advisory only");
  });
});

describe("runPreflight", () => {
  const staleRoot = () =>
    fixture({
      "scripts/audit-anchors.mjs": T + 1_000,
      "scripts/audit-anchors-baseline.json": T,
    });
  const freshRoot = () =>
    fixture({
      "scripts/audit-anchors.mjs": T,
      "scripts/audit-anchors-baseline.json": T + 1_000,
    });

  it("is advisory: exit 0 and a stderr warning even when stale", () => {
    const err = writer();
    const code = runPreflight({ root: staleRoot(), argv: [], err, now: T + 2_000 });
    expect(code).toBe(0);
    expect(err.text()).toContain("HALF-UPDATED");
    expect(err.text()).toContain("audit-drift");
  });

  it("is silent when every pair is fresh", () => {
    const err = writer();
    const out = writer();
    const code = runPreflight({ root: freshRoot(), argv: [], out, err, now: T });
    expect(code).toBe(0);
    expect(err.text()).toBe("");
    expect(out.text()).toBe("");
  });

  it("--strict exits 1 on stale pairs and 0 when fresh", () => {
    const err = writer();
    expect(
      runPreflight({ root: staleRoot(), argv: ["--strict"], err, now: T + 2_000 }),
    ).toBe(1);
    expect(err.text()).toContain("--strict");
    expect(
      runPreflight({ root: freshRoot(), argv: ["--strict"], err: writer(), now: T }),
    ).toBe(0);
  });

  it("--json emits machine output on stdout and nothing on stderr", () => {
    const out = writer();
    const err = writer();
    const code = runPreflight({
      root: staleRoot(),
      argv: ["--json"],
      out,
      err,
      now: T + 2_000,
    });
    expect(code).toBe(0);
    expect(err.text()).toBe("");
    const parsed = JSON.parse(out.text());
    expect(parsed.stale).toBe(1);
    expect(parsed.pairs[0].gate).toBe("audit-drift");
  });

  it("BMF_DRIFT_PREFLIGHT=off disables the check entirely", () => {
    const previous = process.env.BMF_DRIFT_PREFLIGHT;
    process.env.BMF_DRIFT_PREFLIGHT = "off";
    try {
      const err = writer();
      const code = runPreflight({ root: staleRoot(), argv: [], err, now: T + 2_000 });
      expect(code).toBe(0);
      expect(err.text()).toBe("");
    } finally {
      if (previous === undefined) delete process.env.BMF_DRIFT_PREFLIGHT;
      else process.env.BMF_DRIFT_PREFLIGHT = previous;
    }
  });

  it("importing the module has no side effects (reaching this test proves it)", () => {
    expect(typeof runPreflight).toBe("function");
  });
});
