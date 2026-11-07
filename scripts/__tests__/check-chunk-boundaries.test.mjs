// @vitest-environment node
/**
 * scripts/__tests__/check-chunk-boundaries.test.mjs
 *
 * Contract tests for the P60 chunk-boundary gate's missing-`dist/` policy.
 *
 * The gate used to SKIP silently (exit 0) when no build was present, which
 * meant `npm run check` on a fresh checkout "passed" without analyzing a
 * single chunk. These tests pin the corrected contract:
 *
 *   - default: missing `dist/` is a HARD FAILURE (fail closed);
 *   - `--allow-missing-dist` is the only opt-out, it is EXPLICIT, it is
 *     reported as `status=skip`, and it is refused whenever `CI` is set;
 *   - the source-level `npm run check` aggregate is the one caller that
 *     passes the opt-out, so the chain stays green on a fresh checkout
 *     while every other caller (and every CI run) fails closed.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "check-chunk-boundaries.mjs");

/** A throwaway project root with no `dist/` (unless `assets` is requested). */
function fixtureRoot({ assets = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-chunk-boundaries-"));
  if (assets) mkdirSync(join(root, "dist", "assets"), { recursive: true });
  return root;
}

/**
 * Runs the gate in a fixture root. `CI` and `GITHUB_STEP_SUMMARY` are cleared
 * so a CI runner never changes what these tests observe; pass `ci: true` to
 * simulate GitHub Actions deliberately.
 */
function runGate({ args = [], assets = false, ci = false } = {}) {
  const cwd = fixtureRoot({ assets });
  const result = spawnSync(process.execPath, [SCRIPT, "--json", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: ci ? "true" : "", GITHUB_STEP_SUMMARY: "" },
  });
  rmSync(cwd, { recursive: true, force: true });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    report: result.stdout.trim() ? JSON.parse(result.stdout) : null,
  };
}

describe("check-chunk-boundaries missing-dist policy", () => {
  it("fails closed when dist/ is missing and no opt-out is passed", () => {
    const { status, report, stdout, stderr } = runGate();

    expect(status).toBe(1);
    expect(report.status).toBe("fail");
    expect(report.distPresent).toBe(false);
    expect(report.allowMissingDist).toBe(false);
    // The failure must tell the caller what to do, not just that it failed.
    expect(report.errors.join("\n")).toContain("dist/assets not found");
    expect(report.errors.join("\n")).toContain("npm run build:ci");
    expect(`${stdout}${stderr}`).toContain("--allow-missing-dist");
  });

  it("turns a missing dist/ into an explicit, reported skip with --allow-missing-dist", () => {
    const { status, report, stderr } = runGate({ args: ["--allow-missing-dist"] });

    expect(status).toBe(0);
    expect(report.status).toBe("skip");
    expect(report.allowMissingDist).toBe(true);
    expect(report.ciEnv).toBe(false);
    expect(report.reason).toContain("--allow-missing-dist");
    // The skip stays loud and keeps the marker ci-local-parallel watches for.
    expect(stderr).toContain("SKIP: dist/assets not found");
    expect(stderr).toContain("EXPLICIT");
  });

  it("refuses --allow-missing-dist when CI is set", () => {
    const { status, report } = runGate({ args: ["--allow-missing-dist"], ci: true });

    expect(status).toBe(1);
    expect(report.status).toBe("fail");
    expect(report.ciEnv).toBe(true);
    expect(report.errors.join("\n")).toContain("dist/assets not found");
  });

  it("keeps --require-dist a hard failure even alongside the opt-out", () => {
    const { status, report } = runGate({ args: ["--allow-missing-dist", "--require-dist"] });

    expect(status).toBe(1);
    expect(report.status).toBe("fail");
    expect(report.requireDist).toBe(true);
  });

  it("still fails when dist/assets exists but holds no JS chunks", () => {
    const { status, report } = runGate({ args: ["--allow-missing-dist"], assets: true });

    expect(status).toBe(1);
    expect(report.status).toBe("fail");
    expect(report.errors.join("\n")).toContain("no .js chunks");
  });

  it("keeps the source-level aggregate green while every other entry point fails closed", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const buildCi = readFileSync(join(ROOT, "scripts", "build-ci.mjs"), "utf8");

    // `npm run check` now uses tiered approach: check:quality includes check:chunks
    expect(pkg.scripts["check:quality"]).toContain("check:chunks");
    expect(pkg.scripts["check:chunks"]).toContain("--allow-missing-dist");
    // The build job verifies the real bundle and says so explicitly.
    expect(buildCi).toContain("check-chunk-boundaries.mjs");
    expect(buildCi).toContain("--require-dist");
  });
});
