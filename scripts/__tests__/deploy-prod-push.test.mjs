import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("deploy-prod Phase G", () => {
  it("delegates SHA image publishing to shared pushImages with real helpers", async () => {
    const source = await readFile(join(process.cwd(), "scripts", "deploy-prod.mjs"), "utf8");
    const phaseG = source.slice(source.indexOf("// ── Phase G"), source.indexOf("// ── Phase H"));

    expect(phaseG).toContain("pushImages({");
    expect(phaseG).toContain("sha,");
    expect(phaseG).toContain("registry: REGISTRY");
    expect(phaseG).toContain("run,");
    expect(phaseG).toContain("runVisible,");
    expect(phaseG).not.toContain("docker push ${remote}");
  });

  it("does not interpolate sensitive commands into the shell (git/docker)", async () => {
    const source = await readFile(join(process.cwd(), "scripts", "deploy-prod.mjs"), "utf8");
    // Phase D: annotated tag creation via separate argv
    expect(source).toContain('["git", "tag", "-a", tagName, "-m", tagMsg]');
    // Collision check and tag push via separate argv
    expect(source).toContain('execFileSync("git", ["cat-file", "-t", tagName]');
    expect(source).toContain('["git", "push", "origin", tagName]');
    // docker tag via separate argv
    expect(source).toContain('["docker", "tag", `bookmarkforge/web:${sha}`');
    // The old interpolations are forbidden
    expect(source).not.toContain("run(`git tag -a ${tagName}");
    expect(source).not.toContain("execSync(`git cat-file -t ${tagName}`)");
    expect(source).not.toContain("run(`git push origin ${tagName}`)");
    expect(source).not.toContain("run(`docker tag bookmarkforge/web:${sha}`)");
  });
});
