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
});
