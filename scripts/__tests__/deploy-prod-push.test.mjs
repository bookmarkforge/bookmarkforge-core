import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("deploy-prod Fase G", () => {
  it("delegates SHA image publishing to shared pushImages with real helpers", async () => {
    const source = await readFile(join(process.cwd(), "scripts", "deploy-prod.mjs"), "utf8");
    const phaseG = source.slice(source.indexOf("// ── Fase G"), source.indexOf("// ── Fase H"));

    expect(phaseG).toContain("pushImages({");
    expect(phaseG).toContain("sha,");
    expect(phaseG).toContain("registry: REGISTRY");
    expect(phaseG).toContain("run,");
    expect(phaseG).toContain("runVisible,");
    expect(phaseG).not.toContain("docker push ${remote}");
  });

  it("non interpola comandi sensibili nella shell (git/docker)", async () => {
    const source = await readFile(join(process.cwd(), "scripts", "deploy-prod.mjs"), "utf8");
    // Fase D: creazione tag anotato via argv separati
    expect(source).toContain('["git", "tag", "-a", tagName, "-m", tagMsg]');
    // Collision check e push tag via argv separati
    expect(source).toContain('execFileSync("git", ["cat-file", "-t", tagName]');
    expect(source).toContain('["git", "push", "origin", tagName]');
    // docker tag via argv separati
    expect(source).toContain('["docker", "tag", `bookmarkforge/web:${sha}`');
    // Vietate le vecchie interpolazioni
    expect(source).not.toContain("run(`git tag -a ${tagName}");
    expect(source).not.toContain("execSync(`git cat-file -t ${tagName}`)");
    expect(source).not.toContain("run(`git push origin ${tagName}`)");
    expect(source).not.toContain("run(`docker tag bookmarkforge/web:${sha}`)");
  });
});
