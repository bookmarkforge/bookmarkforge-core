import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const workflowPaths = [
  ".github/workflows/dast-nightly.yml",
  ".github/workflows/staging-deploy.yml",
  ".github/workflows/staging-rollback.yml",
];

describe("workflow security policy", () => {
  it("does not use dynamic staging commands or mutable ZAP containers", () => {
    for (const path of workflowPaths) {
      const text = readFileSync(path, "utf8");
      expect(text).not.toMatch(/STAGING_(?:DEPLOY|ROLLBACK)_COMMAND|bash\s+-c/i);
      if (path.includes("dast-nightly")) {
        expect(text).not.toMatch(/ghcr\.io\/zaproxy\/zaproxy:(?!sha256:)[^\s]+/i);
      }
    }
  });
});
