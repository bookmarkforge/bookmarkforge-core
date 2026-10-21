import { describe, it, expect } from "vitest";

describe("barrel: src/services/api/index", () => {
  it("should export modules", async () => {
    const mod = await import("../../services/api/index");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
