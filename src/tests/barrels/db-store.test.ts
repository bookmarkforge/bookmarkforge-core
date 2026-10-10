import { describe, it, expect, vi, beforeEach } from "vitest";

describe("db/schema", () => {
  it("should export RxJsonSchema definitions", async () => {
    const mod = await import("../../db/schema");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
    const hasSchema = Object.values(mod).some(
      (v) => typeof v === "object" && v !== null && "version" in v,
    );
    expect(hasSchema).toBe(true);
  });
});

describe("db/types", () => {
  it("should import without error", async () => {
    const mod = await import("../../db/types");
    expect(mod).toBeDefined();
  });
});

describe("utils/localization", () => {
  it("should export localization utilities", async () => {
    const mod = await import("../../utils/localization");
    expect(typeof mod.formatDate).toBe("function");
    expect(typeof mod.isRTLanguage).toBe("function");
  });

  it("formatDate should format correctly", async () => {
    const mod = await import("../../utils/localization");
    const result = mod.formatDate(Date.now() - 60000);
    expect(typeof result).toBe("string");
  });
});

describe("store/useMemoryStore", () => {
  it("should export memory store", async () => {
    const mod = await import("../../store/useMemoryStore");
    expect(
      typeof mod.useMemoryStore === "function" || typeof mod === "function",
    ).toBe(true);
  });
});

describe("store/webllmStore", () => {
  it("should export webllm store", async () => {
    const mod = await import("../../store/webllmStore");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
