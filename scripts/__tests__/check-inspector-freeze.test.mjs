import { describe, expect, it } from "vitest";
import {
  runInspectorFreezeChecks,
  checkChain,
  adrNamesGate,
} from "../check-inspector-freeze.mjs";

const PKG = {
  scripts: {
    check:
      "npm run check:env && npm run check:csp && npm run check:docs-markdown",
  },
};

describe("inspector freeze (O-1)", () => {
  it("parses the gate tokens out of the check chain", () => {
    expect(checkChain(PKG)).toEqual(
      new Set(["check:env", "check:csp", "check:docs-markdown"]),
    );
  });

  it("passes when every chain gate is registered in the baseline or named by an ADR", () => {
    // check:docs-markdown is not grandfathered — an ADR names it.
    const result = runInspectorFreezeChecks({
      pkg: PKG,
      adrBody: "see check:docs-markdown in ADR-040",
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails when a new documentation-format gate has no ADR naming it", () => {
    const pkg = {
      scripts: { check: "npm run check:env && npm run check:new-docs-gate" },
    };
    const result = runInspectorFreezeChecks({ pkg, adrBody: "" });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("check:new-docs-gate");
    expect(result.failures[0]).toContain("ADR");
  });

  it("passes when an ADR names the new documentation-format gate", () => {
    const pkg = {
      scripts: { check: "npm run check:env && npm run check:new-docs-gate" },
    };
    const result = runInspectorFreezeChecks({
      pkg,
      adrBody: "the new check:new-docs-gate prevents the heading glitch",
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("rejects a new gate without an ADR even when it is not clearly docs", () => {
    // The freeze's default answer is no: an unregistered gate with no ADR
    // is a violation regardless of category — security/language gates are
    // accepted only when registered explicitly as protected core.
    const pkg = {
      scripts: { check: "npm run check:env && npm run check:some-other-gate" },
    };
    const result = runInspectorFreezeChecks({ pkg, adrBody: "" });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("check:some-other-gate");
  });

  it("adrNamesGate matches the check: token inside an ADR body", () => {
    expect(adrNamesGate("check:adr-render", "uses check:adr-render in CI")).toBe(true);
    expect(adrNamesGate("check:adr-render", "no mention here")).toBe(false);
    // A bare name without the check: prefix must not match.
    expect(adrNamesGate("check:adr-render", "adr-render")).toBe(false);
  });
});
