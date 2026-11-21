import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-direct-cve.mjs");
const fixtureDirs = [];

/**
 * The CLI is exercised end to end — real `package.json`, real lockfile, real
 * exit codes — because the core unit tests cannot see the wiring (arg parsing,
 * baseline I/O, the fail-closed paths). Every fixture is synthetic so the raw
 * dev tree can be clean while this still proves the gate fires.
 */
function fixture({ pkg, lock, audit, baseline = { updatedAt: null, profile: null, accepted: [] } }) {
  const dir = mkdtempSync(join(tmpdir(), "direct-cve-"));
  fixtureDirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock));
  writeFileSync(join(dir, "audit.json"), JSON.stringify(audit));
  writeFileSync(join(dir, "baseline.json"), JSON.stringify(baseline));
  return dir;
}

function run(dir, args, env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterAll(() => {
  for (const dir of fixtureDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PKG = {
  name: "fixture",
  dependencies: { "own-http": "^1.2.0" },
  devDependencies: { eslint: "^9.39.5" },
};

const LOCK = {
  lockfileVersion: 3,
  packages: {
    "": { dependencies: PKG.dependencies, devDependencies: PKG.devDependencies },
    "node_modules/eslint": { version: "9.39.5", dependencies: { "@eslint/eslintrc": "^3.3.6" } },
    "node_modules/@eslint/eslintrc": { version: "3.3.6", dependencies: { "js-yaml": "^4.3.0" } },
    "node_modules/js-yaml": { version: "4.3.1" },
    "node_modules/own-http": { version: "1.2.0" },
  },
};

const JS_YAML_ENTRY = {
  name: "js-yaml",
  severity: "high",
  isDirect: false,
  via: [
    {
      source: 1193727,
      title: "js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources",
      url: "https://github.com/advisories/GHSA-2883-xcg3-v3hh",
      severity: "high",
      range: ">=4.0.0 <4.3.2",
    },
  ],
  range: "4.0.0 - 4.3.1",
  nodes: ["node_modules/js-yaml"],
  fixAvailable: true,
};

const OWN_ENTRY = {
  name: "own-http",
  severity: "critical",
  isDirect: true,
  via: [
    {
      title: "own-http: request smuggling",
      url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
      severity: "critical",
      range: "<1.2.5",
    },
  ],
  range: "1.2.0",
  nodes: ["node_modules/own-http"],
  fixAvailable: { name: "own-http", version: "1.2.5", isSemVerMajor: false },
};

const auditWith = (entries) => ({ vulnerabilities: Object.fromEntries(entries) });

describe("direct-CVE gate CLI", () => {
  it("passes a clean tree and says what it inspected", () => {
    const dir = fixture({ pkg: PKG, lock: LOCK, audit: auditWith([]) });
    const { status, output } = run(dir, ["--include-dev", "--audit-json", "audit.json"]);
    expect(status).toBe(0);
    expect(output).toContain("0 advisory(ies)");
  });

  it("fails an inherited advisory, naming the chain and the owner", () => {
    const dir = fixture({ pkg: PKG, lock: LOCK, audit: auditWith([["js-yaml", JS_YAML_ENTRY]]) });
    const { status, output } = run(dir, [
      "--include-dev",
      "--audit-json",
      "audit.json",
      "--baseline",
      "baseline.json",
    ]);
    expect(status).toBe(1);
    expect(output).toContain("inherited B");
    expect(output).toContain("eslint → @eslint/eslintrc → js-yaml");
    expect(output).toContain("GHSA-2883-xcg3-v3hh");
  });

  it("never lets a direct dependency be accepted into the baseline", () => {
    const dir = fixture({ pkg: PKG, lock: LOCK, audit: auditWith([["own-http", OWN_ENTRY]]) });
    const gate = run(dir, [
      "--include-dev",
      "--audit-json",
      "audit.json",
      "--baseline",
      "baseline.json",
    ]);
    expect(gate.status).toBe(1);
    expect(gate.output).toContain("own A");
    expect(gate.output).toContain("own-http: ^1.2.0 → ^1.2.5");

    const accept = run(dir, [
      "--include-dev",
      "--audit-json",
      "audit.json",
      "--baseline",
      "baseline.json",
      "--accept",
      "GHSA-aaaa-bbbb-cccc",
      "--reason",
      "trying to accept our own dependency",
    ]);
    expect(accept.status).toBe(1);
    expect(accept.output).toContain("cannot be baselined");
  });

  it("accepts an inherited advisory only with a reason, then passes", () => {
    const dir = fixture({ pkg: PKG, lock: LOCK, audit: auditWith([["js-yaml", JS_YAML_ENTRY]]) });
    const withoutReason = run(dir, [
      "--include-dev",
      "--audit-json",
      "audit.json",
      "--baseline",
      "baseline.json",
      "--accept",
      "GHSA-2883-xcg3-v3hh",
    ]);
    expect(withoutReason.status).toBe(2);

    const accepted = run(dir, [
      "--include-dev",
      "--audit-json",
      "audit.json",
      "--baseline",
      "baseline.json",
      "--accept",
      "GHSA-2883-xcg3-v3hh",
      "--reason",
      "dev-only YAML parser, no untrusted input",
    ]);
    expect(accepted.status).toBe(0);

    const gate = run(dir, [
      "--include-dev",
      "--audit-json",
      "audit.json",
      "--baseline",
      "baseline.json",
    ]);
    expect(gate.status).toBe(0);
    expect(gate.output).toContain("1 accepted with a reason");
  });

  it("fails a stale acceptance and prunes it on demand", () => {
    const dir = fixture({
      pkg: PKG,
      lock: LOCK,
      audit: auditWith([]),
      baseline: {
        updatedAt: null,
        profile: "dev",
        accepted: [
          {
            key: "GHSA-2883-xcg3-v3hh",
            package: "js-yaml",
            severity: "high",
            reason: "was accepted, advisory is gone now",
          },
        ],
      },
    });
    const stale = run(dir, [
      "--include-dev",
      "--audit-json",
      "audit.json",
      "--baseline",
      "baseline.json",
    ]);
    expect(stale.status).toBe(1);
    expect(stale.output).toContain("no longer reported");

    const prune = run(dir, [
      "--include-dev",
      "--audit-json",
      "audit.json",
      "--baseline",
      "baseline.json",
      "--update-baseline",
    ]);
    expect(prune.status).toBe(0);
    expect(prune.output).toContain("pruned stale acceptance GHSA-2883-xcg3-v3hh");
  });

  it("fails closed when the audit cannot be trusted", () => {
    const dir = fixture({ pkg: PKG, lock: LOCK, audit: { metadata: {} } });
    const malformed = run(dir, ["--include-dev", "--audit-json", "audit.json"]);
    expect(malformed.status).toBe(2);
    expect(malformed.output).toContain("no \"vulnerabilities\" map");

    const missing = run(dir, ["--include-dev", "--audit-json", "nope.json"]);
    expect(missing.status).toBe(2);
    expect(missing.output).toContain("not found");
  });

  it("writes a report without gating, and says so per advisory", () => {
    const dir = fixture({ pkg: PKG, lock: LOCK, audit: auditWith([["js-yaml", JS_YAML_ENTRY]]) });
    const { status, output } = run(dir, [
      "--include-dev",
      "--audit-json",
      "audit.json",
      "--offline",
      "--report",
      "report.md",
    ]);
    expect(status).toBe(0);
    expect(output).toContain("1 advisory(ies)");
    expect(output).toContain("inherited js-yaml 4.3.1");
  });

  it("appends the report to the job summary when --step-summary is set", () => {
    const dir = fixture({ pkg: PKG, lock: LOCK, audit: auditWith([["js-yaml", JS_YAML_ENTRY]]) });
    const summaryPath = join(dir, "step-summary.md");
    const { status, output } = run(
      dir,
      ["--include-dev", "--audit-json", "audit.json", "--offline", "--report", "report.md", "--step-summary"],
      { GITHUB_STEP_SUMMARY: summaryPath },
    );
    expect(status).toBe(0);
    expect(output).toContain("(+ job summary)");

    const summary = readFileSync(summaryPath, "utf8");
    // The heading names the profile: the nightly writes prod and dev into the
    // same summary file, so a bare repeat of the report title would read as a
    // duplicate of the previous table.
    expect(summary).toContain("## Dependency CVE report — dev (npm audit)");
    expect(summary).toContain("Inherited — transitive, with the lever");
    expect(summary).toContain("js-yaml");
    expect(summary).toContain("eslint → @eslint/eslintrc → js-yaml");
    // The artifact on disk is the durable output and stays untouched.
    expect(readFileSync(join(dir, "report.md"), "utf8")).toContain("# Dependency CVE report");
  });

  it("keeps a successful report successful when the summary cannot be written", () => {
    const dir = fixture({ pkg: PKG, lock: LOCK, audit: auditWith([["js-yaml", JS_YAML_ENTRY]]) });
    const args = ["--include-dev", "--audit-json", "audit.json", "--offline", "--report", "report.md", "--step-summary"];

    // No summary destination at all (a local run). The variable is cleared
    // explicitly instead of inherited: GitHub Actions sets GITHUB_STEP_SUMMARY
    // on every step, so an inherited environment would make this branch
    // unreachable in CI — the exact shape this assertion exists to protect.
    const local = run(dir, args, { GITHUB_STEP_SUMMARY: "" });
    expect(local.status).toBe(0);
    expect(local.output).toContain("GITHUB_STEP_SUMMARY is not set");
    expect(local.output).not.toContain("(+ job summary)");

    // A destination that cannot be opened: display sugar must never turn a
    // written report into a failed job.
    const broken = run(dir, args, { GITHUB_STEP_SUMMARY: join(dir, "missing-dir", "summary.md") });
    expect(broken.status).toBe(0);
    expect(broken.output).toContain("report file is the durable output");
    expect(broken.output).toContain("report → report.md");
  });
});
