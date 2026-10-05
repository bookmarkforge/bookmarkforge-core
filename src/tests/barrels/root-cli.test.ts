import { describe, it, expect } from "vitest";

describe("barrel: src/index (root)", () => {
  it("should export modules", async () => {
    const mod = await import("../../index");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  }, 30000);
});
