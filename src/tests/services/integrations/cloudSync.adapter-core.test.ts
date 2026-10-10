import { describe, it, expect } from "vitest";
import { getErrorMessage } from "../../../services/integrations/cloudSync.adapter-core";
import { createAdapter } from "../../../services/integrations/cloudSync";

describe("getErrorMessage", () => {
  it("returns message for Error instances", () => {
    expect(getErrorMessage(new Error("foo"))).toBe("foo");
  });

  it("returns message for object-like errors", () => {
    expect(getErrorMessage({ message: "bar" })).toBe("bar");
  });

  it("returns fallback for non-error values", () => {
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
  });

  it("returns String(e) when no fallback given", () => {
    expect(getErrorMessage(42)).toBe("42");
  });
});

describe("createAdapter", () => {
  it("throws for unknown provider", () => {
    expect(() => createAdapter("unknown" as any)).toThrow(
      "Unknown provider: unknown",
    );
  });
});
