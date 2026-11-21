import { describe, it, expect } from "vitest";

describe("barrel: src/db/schema", () => {
  it("should export modules", async () => {
    const mod = await import("../../db/schema");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
