// @vitest-environment node
/**
 * scripts/__tests__/check-release-target.test.mjs
 *
 * Contract tests for the release-target gate. They pin the three invariants a
 * release depends on — the declared target exists, the git remote exists, and
 * the two agree — plus the placeholder detection and the two modes, because
 * the difference between "blocks the release" and "warns in the chain" is the
 * whole point of this gate.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkReleaseTarget,
  githubTargets,
  normalizeTarget,
  provisionalReason,
  readRemotes,
  reportResult,
} from "../check-release-target.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "check-release-target.mjs");

const CONFIRMED = "https://github.com/acme/forge.git";

/** A throwaway checkout with the given package.json and optional files. */
function fixture({ repository = CONFIRMED, files = {}, rawPackage } = {}) {
  const root = mkdtempSync(join(tmpdir(), "release-target-"));
  const pkg = { name: "bookmarkforge", version: "1.0.0" };
  if (repository) pkg.repository = { type: "git", url: repository };
  writeFileSync(join(root, "package.json"), rawPackage ?? JSON.stringify(pkg, null, 2));
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

function withRemotes(root, remotes) {
  return { root, remotes };
}

const kindsOf = (result) => result.findings.map((finding) => finding.kind);

describe("check-release-target target parsing", () => {
  it("normalizes https, .git, ssh and path suffixes to owner/repo", () => {
    expect(normalizeTarget("https://github.com/acme/forge.git")).toBe("acme/forge");
    expect(normalizeTarget("git@github.com:acme/forge.git")).toBe("acme/forge");
    expect(normalizeTarget("ssh://git@github.com/acme/forge.git")).toBe("acme/forge");
    expect(normalizeTarget("https://github.com/acme/forge/")).toBe("acme/forge");
    // A product site is not a repository target.
    expect(normalizeTarget("https://bookmarkforge.com")).toBeNull();
  });

  it("finds the target inside badge and workflow URLs", () => {
    expect(githubTargets("https://github.com/bookmarkforge/core/actions/workflows/ci.yml")).toEqual([
      "bookmarkforge/core",
    ]);
    expect(githubTargets("git@github.com:TU_USUARIO/bookmarkforge.git")).toEqual([
      "tu_usuario/bookmarkforge",
    ]);
  });

  it("recognizes the provisional slug and placeholder owners", () => {
    expect(provisionalReason("bookmarkforge/core")).toContain("provisional slug");
    expect(provisionalReason("tu_usuario/bookmarkforge")).toContain("placeholder");
    expect(provisionalReason("your-org/forge")).toContain("placeholder");
    expect(provisionalReason("acme/forge")).toBeNull();
  });
});

describe("check-release-target findings", () => {
  it("passes when the declared and actual targets agree and are confirmed", () => {
    const root = fixture();
    const result = checkReleaseTarget(
      withRemotes(root, [{ name: "origin", url: CONFIRMED, kind: "fetch", target: "acme/forge" }]),
    );

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.declaredTarget).toBe("acme/forge");
    rmSync(root, { recursive: true, force: true });
  });

  it("flags the provisional slug in package.json and in the remote", () => {
    const root = fixture({ repository: "https://github.com/bookmarkforge/core.git" });
    const result = checkReleaseTarget(
      withRemotes(root, [
        {
          name: "origin",
          url: "https://github.com/bookmarkforge/core.git",
          kind: "fetch",
          target: "bookmarkforge/core",
        },
      ]),
    );

    expect(result.ok).toBe(false);
    expect(kindsOf(result)).toContain("declared-provisional");
    expect(kindsOf(result)).toContain("remote-provisional");
    // The finding points at the exact JSON line declaring the slug.
    const declared = result.findings.find((finding) => finding.kind === "declared-provisional");
    const raw = readFileSync(join(root, "package.json"), "utf8").split(/\r?\n/);
    const line = Number(declared.location.split(":")[1]);
    expect(raw[line - 1]).toContain("bookmarkforge/core");
    rmSync(root, { recursive: true, force: true });
  });

  it("fails when the declared target and the remote disagree", () => {
    const root = fixture();
    const result = checkReleaseTarget(
      withRemotes(root, [
        { name: "origin", url: "https://github.com/acme/other.git", kind: "fetch", target: "acme/other" },
      ]),
    );

    expect(result.ok).toBe(false);
    expect(kindsOf(result)).toEqual(["declared-actual-drift"]);
    expect(result.findings[0].reason).toContain("acme/other");
    rmSync(root, { recursive: true, force: true });
  });

  it("treats a missing remote or a missing repository field as unconfirmed", () => {
    const noRemote = checkReleaseTarget(withRemotes(fixture(), []));
    expect(kindsOf(noRemote)).toEqual(["remote-missing"]);

    const bare = fixture({ repository: null });
    const noDeclared = checkReleaseTarget(withRemotes(bare, []));
    expect(kindsOf(noDeclared)).toContain("declared-missing");
    expect(kindsOf(noDeclared)).toContain("remote-missing");

    rmSync(noDeclared.root ?? "", { recursive: true, force: true });
  });

  it("flags provisional URLs in release-shipping artifacts", () => {
    const root = fixture({
      files: {
        "README.md": "[![CI](https://github.com/bookmarkforge/core/actions/workflows/ci.yml)]\n",
        "scripts/public-export/RELEASE-NOTES-v1.0.0.md":
          "# Notes\n\ngit clone https://github.com/bookmarkforge/core.git\n",
      },
    });
    const result = checkReleaseTarget(
      withRemotes(root, [{ name: "origin", url: CONFIRMED, kind: "fetch", target: "acme/forge" }]),
    );

    expect(kindsOf(result)).toEqual(["artifact-provisional", "artifact-provisional"]);
    expect(result.findings.map((finding) => finding.location)).toEqual([
      "README.md:1",
      "scripts/public-export/RELEASE-NOTES-v1.0.0.md:3",
    ]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("check-release-target modes", () => {
  it("keeps the advisory mode green while still reporting every finding", () => {
    const root = fixture({ repository: "https://github.com/bookmarkforge/core.git" });
    const result = checkReleaseTarget(withRemotes(root, []));

    const lines = [];
    const stream = { stdout: { write: (l) => lines.push(l) }, stderr: { write: (l) => lines.push(l) } };
    const report = reportResult(result, { advisory: true, stream });

    expect(report.status).toBe("fail");
    expect(report.mode).toBe("advisory");
    expect(lines.join("")).toContain("ADVISORY");
    expect(lines.join("")).toContain("does NOT block");
    expect(report.remedies.length).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps the JSON document alone on stdout", () => {
    const root = fixture({ repository: "https://github.com/bookmarkforge/core.git" });
    const result = checkReleaseTarget(withRemotes(root, []));
    const stdout = [];
    const stderr = [];
    const stream = {
      stdout: { write: (l) => stdout.push(l) },
      stderr: { write: (l) => stderr.push(l) },
    };

    reportResult(result, { advisory: false, json: true, stream });

    expect(() => JSON.parse(stdout.join(""))).not.toThrow();
    expect(JSON.parse(stdout.join("")).status).toBe("fail");
    expect(stderr.join("")).toContain("FAIL");
    rmSync(root, { recursive: true, force: true });
  });

  it("fails in blocking mode and passes in advisory mode from the CLI", () => {
    const root = fixture({ repository: "https://github.com/bookmarkforge/core.git" });
    const env = { ...process.env, BMF_RELEASE_TARGET_ROOT: root, GITHUB_STEP_SUMMARY: "" };

    const blocking = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env });
    const advisory = spawnSync(process.execPath, [SCRIPT, "--advisory"], { encoding: "utf8", env });
    const json = spawnSync(process.execPath, [SCRIPT, "--json"], { encoding: "utf8", env });

    expect(blocking.status).toBe(1);
    expect(advisory.status).toBe(0);
    expect(json.status).toBe(1);
    // stdout stays machine-parseable even on the failing path.
    expect(JSON.parse(json.stdout).status).toBe("fail");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("check-release-target remote reading", () => {
  it("reads the real git remotes and collapses fetch/push into one target", () => {
    const root = fixture();
    const git = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
    if (git.status !== 0) return; // no git available: contract covered above
    spawnSync("git", ["remote", "add", "origin", CONFIRMED], { cwd: root, encoding: "utf8" });

    const { remotes, error } = readRemotes(root);

    expect(error).toBeNull();
    expect(remotes).toHaveLength(1);
    expect(remotes[0]).toMatchObject({ name: "origin", kind: "fetch", target: "acme/forge" });
    rmSync(root, { recursive: true, force: true });
  });
});
