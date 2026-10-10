import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateDockerContext } from "../validate-docker-context.mjs";

describe("Docker build context", () => {
  it("excludes local secrets and generated artifacts", () => {
    const ignore = readFileSync(".dockerignore", "utf8");
    expect(validateDockerContext(ignore).errors).toEqual([]);
    for (const entry of [".env", "*.pem", "*.key", "node_modules", "dist", ".git"]) {
      expect(ignore).toContain(entry);
    }
  });
});
