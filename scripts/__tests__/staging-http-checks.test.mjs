import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("staging HTTP checks target policy", () => {
  it("uses the shared strict staging URL validator", () => {
    const source = readFileSync("scripts/staging-http-checks.mjs", "utf8");
    expect(source).toContain('import { validateStagingUrl }');
    expect(source).toContain("if (!validateStagingUrl(baseUrl))");
  });
});
