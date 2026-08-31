import { describe, expect, it } from "vitest";
import { validateCodeownersContent } from "../validate-codeowners.mjs";

describe("validateCodeownersContent", () => {
  it("accepts valid owners", () => {
    const result = validateCodeownersContent("* @acme/maintainers\n/src/ @acme/frontend\n", "acme");
    expect(result.errors).toEqual([]);
    expect(result.ownerRefs.size).toBe(2);
  });

  it("rejects placeholders and owners outside the configured org", () => {
    const result = validateCodeownersContent("* @YOUR_GITHUB_ORG/maintainers\n/src/ @other/frontend\n", "acme");
    expect(result.errors).toContain("line 1: placeholder owner detected");
    expect(result.errors).toContain("line 2: owner '@other/frontend' is outside configured CODEOWNERS_ORG 'acme'");
  });
});
