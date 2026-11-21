import { describe, expect, it } from "vitest";
import { normalizeRegistry, validateRegistry } from "../registry-policy.mjs";

describe("registry policy", () => {
  it("accepts simple registry hosts and ports", () => {
    expect(validateRegistry("registry.example.com")).toBe(true);
    expect(validateRegistry("registry.example.com:5000")).toBe(true);
    expect(validateRegistry("registry.example.com:65535")).toBe(true);
  });

  it("rejects schemes, paths, traversal, and separators", () => {
    for (const value of ["https://registry.example.com", "registry.example.com/path", "registry..example.com", "registry.example.com\\path", "registry.example.com:0", "registry.example.com:65536", "-registry.example.com", "registry-.example.com"]) {
      expect(validateRegistry(value)).toBe(false);
    }
  });

  it("normalizes a trailing slash only for valid registries", () => {
    expect(normalizeRegistry(" registry.example.com:5000/ ")).toBe("registry.example.com:5000");
    expect(normalizeRegistry("registry.example.com/path")).toBe("");
  });
});
