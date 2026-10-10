/**
 * scripts/__tests__/check-script-reachability.test.mjs
 *
 * The gate exists because two scripts were declared, wired into CI and
 * documented while the file each one runs had never been committed. So the
 * suite pins the three failure classes with fixtures AND runs the gate against
 * the checkout as it ships — a declared script whose local target is missing is
 * exactly the drift this suite must not be able to miss again.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  BASELINE_PATH,
  LIFECYCLE_ROOTS,
  inspect,
  npmRunReferences,
  phantomReferenceFailures,
  phantomTargetFailures,
  reachableScripts,
  scriptTargets,
  unreachableFailures,
} from "../check-script-reachability.mjs";

const ROOT = process.cwd();

function sandbox(files) {
  const dir = mkdtempSync(join(tmpdir(), "script-reachability-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe("script targets", () => {
  it("reads local entry points out of a script body", () => {
    expect(scriptTargets("node scripts/check-things.mjs --json")).toEqual([
      "scripts/check-things.mjs",
    ]);
    expect(scriptTargets("tsc --noEmit -p tsconfig.prod.json")).toEqual(["tsconfig.prod.json"]);
    expect(scriptTargets("playwright test --config=playwright.smoke.config.ts")).toEqual([
      "playwright.smoke.config.ts",
    ]);
    expect(scriptTargets("vitest run --config=vitest.extension.config.ts")).toEqual([
      "vitest.extension.config.ts",
    ]);
    expect(scriptTargets("tsx server/src/index.ts")).toEqual(["server/src/index.ts"]);
  });

  it("ignores command words, URLs and paths outside the repository", () => {
    expect(scriptTargets("vite build")).toEqual([]);
    expect(scriptTargets("eslint .")).toEqual([]);
    expect(scriptTargets("node scripts/x.mjs")).toContain("scripts/x.mjs");
    expect(scriptTargets("cd C:\\bookmark6-oculix-tests && mvn compile")).toEqual([]);
    expect(scriptTargets("node -e \"fetch('https://example.com/a.js')\"")).toEqual([]);
  });

  it("does not repeat a target mentioned twice", () => {
    expect(scriptTargets("node scripts/a.mjs --config=tsconfig.json --check scripts/a.mjs")).toEqual([
      "scripts/a.mjs",
      "tsconfig.json",
    ]);
  });
});

describe("phantom targets (rule 1)", () => {
  it("fails a declared script whose local entry point is missing", () => {
    const root = sandbox({ "present.mjs": "// ok\n" });
    const failures = phantomTargetFailures({
      root,
      scripts: {
        "check:present": "node present.mjs",
        "check:gone": "node scripts/never-committed.mjs",
      },
    });
    expect(failures.join("\n")).toMatch(/phantom target: `check:gone` runs scripts\/never-committed\.mjs/);
    expect(failures.join("\n")).not.toMatch(/check:present/);
  });

  it("fails a declared script whose config file is missing", () => {
    const root = sandbox({});
    expect(
      phantomTargetFailures({ root, scripts: { "e2e:gone": "playwright test --config=playwright.gone.config.ts" } }).join("\n"),
    ).toMatch(/phantom target: `e2e:gone` runs playwright\.gone\.config\.ts/);
  });
});

describe("phantom references (rule 2)", () => {
  it("fails a `npm run` that names an undeclared script", () => {
    const failures = phantomReferenceFailures({
      scripts: { "check:real": "node scripts/real.mjs" },
      references: [
        { name: "check:real", file: ".github/workflows/ci.yml" },
        { name: "check:ghost", file: ".github/workflows/ci.yml" },
      ],
    });
    expect(failures.join("\n")).toMatch(/\.github\/workflows\/ci\.yml runs `npm run check:ghost`/);
    expect(failures).toHaveLength(1);
  });

  it("reads references the way the corpus writes them", () => {
    expect(npmRunReferences("run: npm run check && npm run test:fast -- --watch")).toEqual([
      "check",
      "test:fast",
    ]);
  });
});

describe("reachability (rule 3)", () => {
  const scripts = {
    check: "npm run check:a && npm run check:b",
    "check:a": "node scripts/a.mjs",
    "check:b": "npm run check:deep",
    "check:deep": "node scripts/deep.mjs",
    "by-hand": "node scripts/hand.mjs",
    "dead:chain": "npm run dead:leaf",
    "dead:leaf": "node scripts/leaf.mjs",
  };

  it("walks transitively from the entry points only", () => {
    const reachable = reachableScripts({ scripts, entryReferences: ["check"] });
    expect([...reachable].sort()).toEqual(["check", "check:a", "check:b", "check:deep"]);
    expect(reachable.has("by-hand")).toBe(false);
    // A chain reachable from nothing does not make its leaf reachable.
    expect(reachable.has("dead:leaf")).toBe(false);
  });

  it("treats the npm lifecycle hooks as entry points", () => {
    expect(LIFECYCLE_ROOTS).toContain("prepare");
    const reachable = reachableScripts({
      scripts: { prepare: "npm run husky:setup", "husky:setup": "husky" },
      entryReferences: [],
    });
    expect(reachable.has("husky:setup")).toBe(true);
  });

  it("requires a reason for every unreachable script", () => {
    const reachable = reachableScripts({ scripts, entryReferences: ["check"] });
    const failures = unreachableFailures({ scripts, reachable, baseline: { knownUnreachable: {} } });
    expect(failures.join("\n")).toMatch(/unreachable script: .*`by-hand`/);
    expect(failures.join("\n")).toMatch(/unreachable script: .*`dead:chain`/);
    expect(failures.join("\n")).toMatch(/unreachable script: .*`dead:leaf`/);
    const excused = unreachableFailures({
      scripts,
      reachable,
      baseline: {
        knownUnreachable: { "by-hand": "a by-hand diagnostic", "dead:chain": "kept", "dead:leaf": "kept" },
      },
    });
    expect(excused).toEqual([]);
  });

  it("fails a baseline entry with no reason, a stale one, and a reachable one", () => {
    const reachable = reachableScripts({ scripts, entryReferences: ["check"] });
    const failures = unreachableFailures({
      scripts,
      reachable,
      baseline: {
        knownUnreachable: {
          "by-hand": "  ",
          "check:deep": "already reachable",
          "gone:script": "no longer declared",
        },
      },
    });
    const joined = failures.join("\n");
    expect(joined).toMatch(/baseline without a reason: knownUnreachable\["by-hand"\]/);
    expect(joined).toMatch(/stale baseline: knownUnreachable lists "check:deep", which an entry point reaches/);
    expect(joined).toMatch(/stale baseline: knownUnreachable lists "gone:script"/);
  });
});

describe("the real tree", () => {
  it("declares the baseline and the gate it documents", () => {
    expect(BASELINE_PATH).toBe("scripts/script-reachability-baseline.json");
    const baseline = JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), "utf8"));
    expect(Object.keys(baseline.knownUnreachable).length).toBeGreaterThan(0);
    for (const reason of Object.values(baseline.knownUnreachable)) {
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no phantom target and no phantom reference", () => {
    const result = inspect({ root: ROOT });
    expect(result.failures).toEqual([]);
    expect(result.unreachable.length).toBe(
      Object.keys(JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), "utf8")).knownUnreachable).length,
    );
    // The two scripts this gate was written for are reachable and present.
    expect(result.reachable.has("check:script-reachability")).toBe(true);
    expect(result.reachable.has("check:landing-smoke")).toBe(true);
  });

  it("passes on the checkout as it ships", () => {
    const run = spawnSync("node", ["scripts/check-script-reachability.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(run.stderr).toBe("");
    expect(run.stdout).toMatch(/ok: \d+ declared script\(s\), no phantom target/);
    expect(run.status).toBe(0);
  });

  it("reports machine-readable results", () => {
    const run = spawnSync("node", ["scripts/check-script-reachability.mjs", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    const json = JSON.parse(run.stdout.slice(run.stdout.indexOf("{")));
    expect(json.ok).toBe(true);
    expect(json.failures).toEqual([]);
    expect(json.reachable).toContain("check:landing-smoke");
    expect(json.reachable).toContain("check");
  });
});
