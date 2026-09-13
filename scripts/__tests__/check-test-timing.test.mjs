// @vitest-environment node
/**
 * Tests for the test-timing regression guard: log parsing, the two
 * detection layers (absolute slow-file threshold + per-file regression
 * budget), coverage/noise tolerance, fail-closed hygiene paths, update
 * mode, and the env-mode resolution contract.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateTimings,
  parseTimings,
  resolveTimingMode,
  TIMING_SCHEMA_LABEL,
} from "../check-test-timing.mjs";

const ESC = String.fromCharCode(27);
const BS = String.fromCharCode(92);
const LOG = [
  `${ESC}[32m✓${ESC}[0m src/tests/components/Omnibar.test.tsx (33 tests) 8500ms`,
  ` ✓ src/tests/services/SecureStorage.test.ts (44 tests | 2 failed) 5600ms`,
  `✓ src/tests/services/SyncService.test.ts (78 tests) 700ms`,
  `× src/tests/db/database.test.ts (146 tests) 400ms`,
  `✓ src/tests/components/QuickCapture.test.tsx (17 tests) 5800ms`,
  `✓ src${BS}tests${BS}db${BS}auth-encryption.test.ts (4 tests) 900ms`,
].join("\n");

const BASE = (files, schema = TIMING_SCHEMA_LABEL) => ({
  schema,
  updated: "2026-09-04",
  thresholdMs: 5000,
  budgetFactor: 2,
  files,
});

describe("parseTimings", () => {
  it("parses vitest per-file lines, strips ANSI, normalizes separators", () => {
    const map = parseTimings(LOG);
    expect(map.size).toBe(6);
    expect(map.get("src/tests/components/Omnibar.test.tsx")).toEqual({ tests: 33, ms: 8500 });
    expect(map.get("src/tests/db/database.test.ts")).toEqual({ tests: 146, ms: 400 });
    expect(map.get("src/tests/db/auth-encryption.test.ts")).toEqual({ tests: 4, ms: 900 });
  });

  it("returns an empty map for unrelated output", () => {
    expect(parseTimings("all good, nothing to see").size).toBe(0);
  });
});

describe("evaluateTimings — hygiene paths", () => {
  it("fails closed with a re-pin hint when the baseline is missing", () => {
    const r = evaluateTimings(parseTimings(LOG), null, "enforce");
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain("no baseline");
    expect(r.violations[0]).toContain("update");
  });

  it("fails on schema drift (weakening detection)", () => {
    const r = evaluateTimings(parseTimings(LOG), BASE({}, "bmf.test-timing/0"), "enforce");
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain("schema mismatch");
  });

  it("fails when the log parses to zero files", () => {
    const r = evaluateTimings(new Map(), BASE({}), "enforce");
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain("no per-file timings");
  });
});

describe("evaluateTimings — detection layers", () => {
  it("flags a new file at the absolute threshold; pinned files are exempt", () => {
    const r = evaluateTimings(parseTimings(LOG), BASE({
      "src/tests/components/Omnibar.test.tsx": 8500,
    }), "enforce");
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes("SecureStorage.test.ts: 5600ms ≥ 5000ms") && v.includes("(new file)"))).toBe(true);
    expect(r.violations.some((v) => v.includes("QuickCapture.test.tsx: 5800ms ≥ 5000ms"))).toBe(true);
    // Pinned file over the threshold but within its budget: no violation.
    expect(r.violations.some((v) => v.includes("Omnibar.test.tsx"))).toBe(false);
  });

  it("flags a sub-threshold regression past the pinned budget", () => {
    const r = evaluateTimings(
      new Map([["src/tests/services/SyncService.test.ts", { tests: 78, ms: 1500 }]]),
      BASE({ "src/tests/services/SyncService.test.ts": 700 }),
      "enforce",
    );
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain("1500ms exceeds 2x its pinned 700ms budget");
  });

  it("flags a pinned file past its own budget even while over the threshold", () => {
    const r = evaluateTimings(
      new Map([["src/tests/components/Omnibar.test.tsx", { tests: 33, ms: 17100 }]]),
      BASE({ "src/tests/components/Omnibar.test.tsx": 8500 }),
      "enforce",
    );
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain("17100ms exceeds 2x its pinned 8500ms budget");
  });
  it("does not flag a regression at exactly the budget boundary", () => {
    const r = evaluateTimings(
      new Map([["src/tests/services/SyncService.test.ts", { tests: 78, ms: 1400 }]]),
      BASE({ "src/tests/services/SyncService.test.ts": 700 }),
      "enforce",
    );
    expect(r.ok).toBe(true);
  });

  it("passes a clean run with a summary line", () => {
    const r = evaluateTimings(
      new Map([["src/tests/services/SyncService.test.ts", { tests: 78, ms: 700 }]]),
      BASE({ "src/tests/services/SyncService.test.ts": 700 }),
      "enforce",
    );
    expect(r.ok).toBe(true);
    expect(r.lines.at(-1)).toContain("OK — 1 file(s) within budgets");
  });
});

describe("evaluateTimings — noise tolerance", () => {
  it("does not judge a run that exercised too little of the baseline", () => {
    const r = evaluateTimings(
      new Map([["src/tests/db/database.test.ts", { tests: 146, ms: 400 }]]),
      BASE({ "a.test.ts": 6000, "b.test.ts": 6000, "c.test.ts": 6000, "src/tests/db/database.test.ts": 400 }),
      "enforce",
    );
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("run not judged");
  });
});

describe("evaluateTimings — profile-aware coverage", () => {
  it("judges a profile run against only the baseline files it can contain", () => {
    const r = evaluateTimings(
      new Map([["src/tests/services/SyncService.test.ts", { tests: 78, ms: 700 }]]),
      BASE({
        "src/tests/services/SyncService.test.ts": 700,
        "src/tests/components/Omnibar.test.tsx": 8090,
        "src/tests/chaos/never-in-fast.test.ts": 9000,
      }),
      "enforce",
      { expectedFiles: new Set(["src/tests/services/SyncService.test.ts"]) },
    );
    // Baseline files outside this profile's file list must not count against
    // coverage — the fast profile never runs them, so it is judged on its own.
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).not.toContain("not judged");
  });

  it("still fails closed when profile baseline files are missing from the run", () => {
    const r = evaluateTimings(
      new Map([["src/tests/services/SyncService.test.ts", { tests: 78, ms: 700 }]]),
      BASE({
        "src/tests/services/SyncService.test.ts": 700,
        "src/tests/services/MissingService.test.ts": 6000,
      }),
      "enforce",
      { expectedFiles: new Set(["src/tests/services/SyncService.test.ts", "src/tests/services/MissingService.test.ts"]) },
    );
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("run not judged");
  });
});

describe("evaluateTimings — update mode", () => {
  it("pins only files at/over the threshold and emits a fresh document", () => {
    const r = evaluateTimings(parseTimings(LOG), null, "update");
    expect(r.ok).toBe(true);
    expect(r.baseline.schema).toBe(TIMING_SCHEMA_LABEL);
    expect(r.baseline.files).toEqual({
      "src/tests/components/Omnibar.test.tsx": 8500,
      "src/tests/services/SecureStorage.test.ts": 5600,
      "src/tests/components/QuickCapture.test.tsx": 5800,
    });
    expect(r.baseline.files["src/tests/db/database.test.ts"]).toBeUndefined();
  });

  it("keeps an already-pinned entry that dipped below the threshold", () => {
    const prev = BASE({ "src/tests/components/Omnibar.test.tsx": 8400 });
    const r = evaluateTimings(
      new Map([["src/tests/components/Omnibar.test.tsx", { tests: 33, ms: 4500 }]]),
      prev,
      "update",
    );
    expect(r.baseline.files["src/tests/components/Omnibar.test.tsx"]).toBe(4500);
  });
});

describe("resolveTimingMode", () => {
  it("OFF wins over everything (visible opt-out)", () => {
    expect(resolveTimingMode({ BMF_TEST_TIMING_OFF: "1", BMF_TEST_TIMING: "1" })).toBe("off");
  });
  it("explicit env beats the CI default", () => {
    expect(resolveTimingMode({ BMF_TEST_TIMING: "update" }, { isCI: true })).toBe("update");
    expect(resolveTimingMode({ BMF_TEST_TIMING: "1" }, { isCI: false })).toBe("enforce");
    expect(resolveTimingMode({ BMF_TEST_TIMING: "true" }, { isCI: false })).toBe("enforce");
  });
  it("defaults: enforce on CI, warn locally", () => {
    expect(resolveTimingMode({}, { isCI: true })).toBe("enforce");
    expect(resolveTimingMode({}, { isCI: false })).toBe("warn");
  });
});
