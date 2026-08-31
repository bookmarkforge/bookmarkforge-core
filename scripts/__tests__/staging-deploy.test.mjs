import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("staging deploy image tag contract", () => {
  it("rejects registry and digest syntax before Docker execution", () => {
    const source = readFileSync("scripts/staging-deploy.mjs", "utf8");
    expect(source).toContain('imageTag.includes(":")');
    expect(source).toContain('imageTag.includes("@")');
    expect(source).toContain("without registry or digest syntax");
  });
});
