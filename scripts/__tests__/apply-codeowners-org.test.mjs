import { describe, expect, it } from "vitest";
import { applyCodeownersOrg } from "../apply-codeowners-org.mjs";

describe("applyCodeownersOrg", () => {
  it("replaces the placeholder org in owners and comments", () => {
    const input =
      "# Sustituye YOUR_GITHUB_ORG por la organizacion real\n" +
      "* @YOUR_GITHUB_ORG/maintainers\n" +
      "/src/ @YOUR_GITHUB_ORG/frontend\n";
    const { content, replacedCount, errors } = applyCodeownersOrg(input, "acme");
    expect(errors).toEqual([]);
    expect(replacedCount).toBe(3);
    expect(content).toContain("* @acme/maintainers");
    expect(content).toContain("/src/ @acme/frontend");
    expect(content).not.toContain("YOUR_GITHUB_ORG");
  });

  it("strips a leading @ from the org argument", () => {
    const { content, errors } = applyCodeownersOrg(
      "* @YOUR_GITHUB_ORG/maintainers\n",
      "@acme",
    );
    expect(errors).toEqual([]);
    expect(content).toContain("@acme/maintainers");
  });

  it("reports nothing to do when no placeholders exist", () => {
    const input = "* @acme/maintainers\n";
    const { replacedCount, errors } = applyCodeownersOrg(input, "acme");
    expect(replacedCount).toBe(0);
    expect(errors).toEqual([]);
  });

  it("refuses placeholder-like organizations", () => {
    const { errors } = applyCodeownersOrg(
      "* @YOUR_GITHUB_ORG/maintainers\n",
      "YOUR_GITHUB_ORG",
    );
    expect(errors).toContain(
      "'YOUR_GITHUB_ORG' looks like a placeholder; refusing to write it as an owner",
    );
  });

  it("rejects owners from a different organization after substitution", () => {
    const input = "* @YOUR_GITHUB_ORG/maintainers\n/server/ @other/frontend\n";
    const { errors } = applyCodeownersOrg(input, "acme");
    expect(errors).toContain(
      "line 2: owner '@other/frontend' is outside configured CODEOWNERS_ORG 'acme'",
    );
  });

  it("requires an organization name", () => {
    const { errors } = applyCodeownersOrg("* @YOUR_GITHUB_ORG/maintainers\n", "");
    expect(errors.length).toBeGreaterThan(0);
  });
});
