import { describe, it, expect } from "vitest";

describe("barrel: src/services/ai/providers/index", () => {
  it("should export modules", async () => {
    const mod = await import("../../services/ai/providers/index");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
