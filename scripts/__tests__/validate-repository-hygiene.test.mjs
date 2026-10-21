import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateRepositoryHygiene } from "../validate-repository-hygiene.mjs";

describe("repository hygiene validation", () => {
  it("accepts the repository ignore policies", () => {
    const result = validateRepositoryHygiene(
      readFileSync(".gitignore", "utf8"),
      readFileSync(".dockerignore", "utf8"),
    );
    expect(result.errors).toEqual([]);
  });

  it("rejects an ignore policy that exposes local tooling", () => {
    const result = validateRepositoryHygiene(".env\n.env.*\n*.pem\n*.key\nnode_modules\ndist\n.git", ".env\n.env.*\n*.pem\n*.key\nnode_modules\ndist\n.git");
    expect(result.errors).toContain(".gitignore missing sensitive entry: .freebuff");
  });
});
